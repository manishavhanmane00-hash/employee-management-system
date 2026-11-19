const crypto = require('crypto');
const ChatKnowledge = require('../models/ChatKnowledge');
const ChatFeedback = require('../models/ChatFeedback');
const ChatTicket = require('../models/ChatTicket');
const ActivityLog = require('../models/ActivityLog');
const CentralRequest = require('../models/CentralRequest');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const LeaveAllocation = require('../models/LeaveAllocation');
const Payroll = require('../models/Payroll');
const Performance = require('../models/Performance');
const { resolvePermissionsForRole } = require('./permissionController');
const { resolveEmployeeForUser, managerAssignedEmployees } = require('../services/employeeIdentity');
const { publishNotification } = require('../services/notificationEvents');
const { getLeaveBalance } = require('./leaveController');
const { PERSONAL_INTENTS, classifyIntent, normalizeChatText } = require('../services/chatIntent');
const { classifyQuestion, generateGroundedAnswer, isAIConfigured } = require('../services/chatAI');

const ROLES = ['Admin', 'HR', 'Manager', 'Employee'];
const TICKET_STATUSES = ['Open', 'Pending', 'Assigned', 'In Progress', 'Resolved', 'Closed'];

const completeOnboarding = user => user.role !== 'Employee'
  || (user.registrationStatus === 'approved'
    && user.accountStatus === 'active'
    && user.onboardingStatus === 'completed'
    && user.personalInfoApprovalStatus === 'approved'
    && user.documentVerificationStatus === 'verified');

const hasModulePermission = async (user, permission) => {
  if (user.role === 'Admin') return true;
  const { permissions } = await resolvePermissionsForRole(user.role);
  return permissions[permission] === true;
};

const issueKeyFor = question => normalizeChatText(question).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 500);
const tokenize = text => new Set(String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []);
const relevance = (query, article) => {
  const queryTokens = tokenize(normalizeChatText(query));
  const articleTokens = tokenize(`${article.title} ${article.category} ${article.module} ${article.content}`);
  if (!queryTokens.size) return 0;
  let score = 0;
  for (const token of queryTokens) if (articleTokens.has(token)) score += token.length > 4 ? 2 : 1;
  return score / Math.sqrt(queryTokens.size);
};

const getSuggestions = async (req, res) => {
  try {
    const module = String(req.query.module || 'general').slice(0, 80);
    const suggestions = [];
    const add = items => {
      if (items && suggestions.length < 5) suggestions.push(...items);
    };
    const allowed = await Promise.all([
      hasModulePermission(req.user, 'attendance.history'),
      hasModulePermission(req.user, 'leave.balance'),
      hasModulePermission(req.user, 'payroll.payslips'),
      hasModulePermission(req.user, 'leave.approval'),
      hasModulePermission(req.user, 'employees.documents'),
      hasModulePermission(req.user, 'reports'),
      hasModulePermission(req.user, 'chatbot.tickets'),
    ]);
    const permissions = {
      attendance: allowed[0], leave: allowed[1], payroll: allowed[2],
      approvals: allowed[3], employees: allowed[4], reports: allowed[5], ticketManage: allowed[6],
    };
    const role = req.user.role;
    const byModule = {
      attendance: permissions.attendance ? ['How can I correct my attendance?', 'Show my attendance history.', 'Why are my working hours incorrect?'] : [],
      leave: permissions.leave ? ['What is my remaining leave balance?', 'How can I apply for leave?', 'What is the status of my leave request?'] : [],
      payroll: permissions.payroll ? ['Show my salary slip.', 'Explain my salary calculation.', 'Explain my deductions.'] : [],
      dashboard: role === 'Manager' && permissions.approvals
        ? ['Show my team’s pending leave requests.', 'Which assigned employees have incomplete attendance?']
        : role === 'Admin' || role === 'HR'
          ? ['Show pending approvals.', 'Show unresolved support tickets.'] : [],
      employees: role === 'HR' && permissions.employees ? ['Which employee documents need verification?'] : [],
    };
    add(byModule[module] || []);
    if (suggestions.length < 5) {
      if (role === 'Employee') {
        add(['How do I contact support?']);
      } else if (role === 'Manager') {
        add(['How can I review my team’s requests?']);
      } else if (role === 'Admin' || role === 'HR') {
        add(['How do I manage support tickets?']);
      }
    }
    res.json({ success: true, module, suggestions: suggestions.slice(0, 5), ticketManagement: role === 'Admin' || (role === 'HR' && permissions.ticketManage) });
  } catch (error) {
    console.error('[Chat suggestions]', error.message);
    res.status(500).json({ success: false, message: 'Unable to load assistant suggestions.' });
  }
};

const personalLookupFailure = (intent, reason) => {
  const nextStep = {
    payslip: 'Open My Salary in the employee portal to view payslips.',
    leave_balance: 'Open My Leave in the employee portal to check your leave balance.',
    attendance: 'Open My Attendance in the employee portal to review your attendance.',
    profile: 'Open My Profile in the employee portal to review your account details.',
  }[intent] || 'Open the relevant section in the employee portal.';
  return {
    text: `${nextStep} I could not match this account to an active employee record, so I have not accessed any personal data.${reason ? ` ${reason}` : ''} EMS Assistant has opened an account verification ticket for HR.`,
    source: 'EMS account and portal guidance',
    escalate: true,
    category: 'Employee Account Verification',
  };
};

const findWorkflowAnswer = (user, question) => {
  const q = normalizeChatText(question);
  const employee = user.role === 'Employee';
  if (/\b(leave|vacation)\b/.test(q) && /\b(apply|application|request|take|submit)\b/.test(q)) {
    return {
      text: 'You can submit a leave request from My Leave. Review the dates and leave type before submitting; the request follows the existing approval workflow.',
      source: 'EMS leave application workflow',
      navigation: employee ? '/employee/leave' : '/leave/apply',
    };
  }
  if (/\b(attendance|check in|check out)\b/.test(q) && /\b(correct|correction|missing|incorrect|wrong)\b/.test(q)) {
    return {
      text: 'Review your attendance in My Attendance. If a record is missing or incorrect, submit an attendance correction request through the existing HR support workflow; the assistant cannot change attendance records.',
      source: 'EMS attendance workflow',
      navigation: employee ? '/employee/attendance' : '/attendance/history',
    };
  }
  if (/\b(profile|personal details|personal information)\b/.test(q)
    && /\b(wrong|incorrect|update|edit|change)\b/.test(q)) {
    return {
      text: 'Review your details in My Profile. Changes that require verification must be submitted through the existing profile update and approval workflow; the assistant cannot edit employee records.',
      source: 'EMS employee profile workflow',
      navigation: '/employee/profile',
    };
  }
  if (/\bsalary\b/.test(q) && /\b(check|where|how|view|access|download)\b/.test(q)) {
    return {
      text: 'Open My Salary to review your authorized salary information and available payslips.',
      source: 'EMS payroll navigation',
      navigation: employee ? '/employee/payroll' : '/my-salary',
    };
  }
  return null;
};

const findLiveAnswer = async (user, question, module, intent) => {
  if (!completeOnboarding(user)) {
    if (PERSONAL_INTENTS.has(intent)) {
      console.warn('[Chat unresolved]', JSON.stringify({
        userId: user.id, intent, reason: 'employee_onboarding_incomplete', module,
      }));
      return {
        text: 'Complete employee onboarding and receive approval before viewing personal EMS records. EMS Assistant has opened an account verification ticket for HR.',
        source: 'EMS account and portal guidance',
        escalate: true,
        category: 'Employee Account Verification',
      };
    }
    return null;
  }
  const q = normalizeChatText(question);
  const self = user.role === 'Employee';
  const manager = user.role === 'Manager';
  const administrativeApprovalQuestion = intent !== 'support_contact'
    && /pending|approval|unresolved|ticket|incomplete attendance|verification|document|onboard/.test(q);
  if (administrativeApprovalQuestion && (user.role === 'Admin' || user.role === 'HR')) {
    const results = [];
    if (/onboard|registration|employee approval|pending approval/.test(q) && await hasModulePermission(user, 'employees.documents')) {
      const count = await User.countDocuments({ role: 'Employee', registrationStatus: 'pending', accountStatus: 'pending' });
      results.push(`${count} employee registration request(s) await initial approval.`);
    }
    if (/onboard|profile|document|employee approval|pending approval/.test(q) && await hasModulePermission(user, 'employees.documents')) {
      const users = await User.find({
        role: 'Employee', registrationStatus: 'approved',
        $or: [{ personalInfoApprovalStatus: 'pending' }, { documentVerificationStatus: 'pending' }],
      }).select('name employeeId personalInfoApprovalStatus documentVerificationStatus').limit(20).lean();
      results.push(users.length
        ? `Employee profile/document submissions awaiting review:\n${users.map(item => `${item.name} (${item.employeeId || 'No Employee ID'}): profile ${item.personalInfoApprovalStatus}, documents ${item.documentVerificationStatus}`).join('\n')}`
        : 'No employee profile or document submissions are awaiting review.');
    }
    if (/pending approval/.test(q) && await hasModulePermission(user, 'leave.approval')) {
      const count = await Leave.countDocuments({ status: 'pending' });
      results.push(`${count} leave request(s) are pending approval.`);
    }
    if (/hr request|pending requests/.test(q) && await hasModulePermission(user, 'leave.requests')) {
      const requests = await CentralRequest.find({ status: { $in: ['Pending', 'Review'] } })
        .sort({ submittedAt: -1 }).limit(10).select('requesterName employeeId requestType status submittedAt').lean();
      results.push(requests.length
        ? `Pending HR queue requests:\n${requests.map(item => `${item.requestType} · ${item.requesterName} (${item.employeeId || 'No Employee ID'}) · ${item.status}`).join('\n')}`
        : 'There are no pending requests in the HR queue.');
    }
    if (/unresolved|open tickets|ticket count|number of tickets/.test(q)
      && await hasModulePermission(user, 'chatbot.tickets')) {
      const count = await ChatTicket.countDocuments({ status: { $nin: ['Resolved', 'Closed'] } });
      results.push(`${count} unresolved support ticket(s) are open.`);
    }
    if (results.length) return { text: results.join('\n'), source: 'Current EMS approval and support records' };
  }
  if (manager && /pending leave|leave requests|team.*leave/.test(q)
    && await hasModulePermission(user, 'leave.approval')) {
    const team = await managerAssignedEmployees(user);
    const employeeIds = team.map(item => item.employeeId).filter(Boolean);
    const emails = team.map(item => item.email).filter(Boolean);
    const userIds = team.map(item => item.userId).filter(Boolean);
    if (!employeeIds.length && !emails.length && !userIds.length) {
      return { text: 'No active employees are currently assigned to your manager account.', source: 'Assigned team records' };
    }
    const pending = await Leave.find({
      status: 'pending',
      $or: [
        ...(employeeIds.length ? [{ employeeId: { $in: employeeIds } }] : []),
        ...(emails.length ? [{ email: { $in: emails } }] : []),
        ...(userIds.length ? [{ userId: { $in: userIds } }] : []),
      ],
    }).sort({ createdAt: -1 }).limit(10).select('employeeName leaveType startDate endDate days').lean();
    return {
      text: pending.length
        ? `Pending leave requests from your assigned team:\n${pending.map(item => `${item.employeeName || 'Employee'} · ${item.leaveType} · ${item.startDate} to ${item.endDate} (${item.days} days)`).join('\n')}`
        : 'There are no pending leave requests from employees assigned to your team.',
      source: 'Assigned team leave records',
    };
  }
  if (manager && /incomplete attendance|missing attendance/.test(q)
    && await hasModulePermission(user, 'attendance.history')) {
    const team = await managerAssignedEmployees(user);
    const employeeIds = team.map(item => item.employeeId).filter(Boolean);
    const employees = team.filter(item => item.employeeId);
    if (!employees.length) return { text: 'No active employees are currently assigned to your manager account.', source: 'Assigned team records' };
    const today = new Date().toISOString().slice(0, 10);
    const records = await Attendance.find({ employeeId: { $in: employeeIds }, date: today }).select('employeeId status').lean();
    const present = new Set(records.map(item => item.employeeId));
    const missing = employees.filter(item => !present.has(item.employeeId));
    return {
      text: missing.length
        ? `No attendance record is recorded for these assigned employees today (${today}):\n${missing.map(item => `${item.name} (${item.employeeId})`).join('\n')}`
        : `All ${employees.length} assigned employees have an attendance record for today (${today}).`,
      source: 'Assigned team attendance records',
    };
  }
  if (manager && /team.*performance|performance.*team/.test(q)
    && await hasModulePermission(user, 'performance.reviews')) {
    const team = await managerAssignedEmployees(user);
    const employeeIds = team.map(item => item.employeeId).filter(Boolean);
    if (!employeeIds.length) return { text: 'No active employees are currently assigned to your manager account.', source: 'Assigned team records' };
    const reviews = await Performance.find({ employeeId: { $in: employeeIds } })
      .sort({ reviewDate: -1 }).limit(20).select('employeeId employeeName reviewPeriod overallRating status').lean();
    return {
      text: reviews.length
        ? `Performance review records for your assigned team:\n${reviews.map(item => `${item.employeeName || item.employeeId}${item.reviewPeriod ? ` · ${item.reviewPeriod}` : ''}: ${item.overallRating}/5 (${item.status})`).join('\n')}`
        : 'No performance reviews are recorded for your assigned team.',
      source: 'Assigned team performance records',
    };
  }
  const isAttendance = intent === 'attendance';
  const isLeave = intent === 'leave_balance';
  const isPayroll = intent === 'payslip';
  let employee = null;
  if (PERSONAL_INTENTS.has(intent)) {
    if (!self) {
      console.warn('[Chat unresolved]', JSON.stringify({
        userId: user.id, intent, reason: 'personal_data_requires_employee_account', module,
      }));
      return personalLookupFailure(intent);
    }
    const resolved = await resolveEmployeeForUser(user);
    employee = resolved.employee;
    if (!employee) {
      console.warn('[Chat unresolved]', JSON.stringify({
        userId: user.id, intent, reason: resolved.error || 'employee_not_linked', module,
      }));
      return personalLookupFailure(intent, resolved.error);
    }
    if (intent === 'profile') {
      return {
        text: `Your employee profile:\nName: ${employee.name || user.name}\nEmployee ID: ${employee.employeeId || 'Not recorded'}\nDepartment: ${employee.department || 'Not recorded'}\nDesignation: ${employee.designation || employee.position || 'Not recorded'}\nStatus: ${employee.status || 'Not recorded'}`,
        source: 'Your linked employee profile',
      };
    }
  }

  if (isAttendance && (self || await hasModulePermission(user, 'attendance.history'))) {
    let conditions = [];
    if (self) {
      conditions = [{ userId: user.id }, { employeeId: employee.employeeId }, ...(employee.email ? [{ email: employee.email }] : [])];
    } else if (manager) {
      const team = await managerAssignedEmployees(user);
      const ids = team.map(item => item.employeeId).filter(Boolean);
      const emails = team.map(item => item.email).filter(Boolean);
      const userIds = team.map(item => item.userId).filter(Boolean);
      if (!ids.length && !emails.length && !userIds.length) return null;
      conditions = [{ $or: [...(ids.length ? [{ employeeId: { $in: ids } }] : []), ...(emails.length ? [{ email: { $in: emails } }] : []), ...(userIds.length ? [{ userId: { $in: userIds } }] : [])] }];
    } else if (user.role === 'Admin' || user.role === 'HR') {
      conditions = [{}];
    }
    if (!conditions.length) return null;
    const records = await Attendance.find(self ? { $or: conditions } : (conditions.length === 1 && conditions[0].$or ? conditions[0] : {}))
      .sort({ date: -1 }).limit(10).select('date status hours overtime checkIn checkOut employeeName employeeId').lean();
    if (!records.length) return { text: 'There are no attendance records available for the requested scope.', source: 'Attendance records' };
    const rows = records.map(record => `${record.date}: ${record.status}, ${Number(record.hours || 0).toFixed(2)} hours${record.employeeName && !self ? ` (${record.employeeName})` : ''}`);
    return { text: `Here are the latest attendance records from EMS:\n${rows.join('\n')}`, source: 'Attendance records' };
  }

  if (isLeave && (self || await hasModulePermission(user, 'leave.balance'))) {
    const conditions = self
      ? [{ userId: user.id }, { employeeId: employee.employeeId }, ...(employee.email ? [{ email: employee.email }] : [])]
      : manager ? null : [];
    if (conditions === null) return null;
    if (conditions.length) {
      const allocations = await LeaveAllocation.find({ $or: conditions }).sort({ leaveType: 1 }).lean();
      const leaves = await Leave.find({ $or: conditions }).sort({ createdAt: -1 }).limit(5).select('leaveType startDate endDate status days').lean();
      if (/status|request|pending/.test(q)) {
        return {
          text: leaves.length
            ? `Your recent leave requests:\n${leaves.map(item => `${item.leaveType}: ${item.status} (${item.startDate} to ${item.endDate})`).join('\n')}`
            : 'No leave requests were found for your account.',
          source: 'Leave records',
        };
      }
      if (/balance|remaining/.test(q)) {
        const leaveTypes = Leave.schema.path('leaveType').enumValues;
        const balances = await Promise.all(leaveTypes.map(async leaveType => ({
          leaveType,
          balance: await getLeaveBalance(user.id, leaveType),
        })));
        return {
          text: `Your current leave balances:\n${balances.map(({ leaveType, balance }) => `${leaveType}: ${leaveType === 'Unpaid Leave' ? 'unlimited' : `${balance?.remaining ?? 0} days remaining of ${balance?.totalAllocated ?? 0} allocated`}`).join('\n')}`,
          source: 'EMS leave balance calculation',
        };
      }
      if (allocations.length) return { text: `Your configured leave allocations:\n${allocations.map(item => `${item.leaveType}: ${item.allocatedDays} days allocated`).join('\n')}`, source: 'Leave allocation records' };
      return { text: 'No leave allocation or request records were found for your account.', source: 'Leave records' };
    }
  }

  if (isPayroll && self) {
    const records = await Payroll.find({
      $or: [
        { userId: user.id },
        { employeeId: employee.employeeId },
        ...(employee.email ? [{ email: employee.email }] : []),
      ],
    }).sort({ year: -1, month: -1 }).limit(6)
      .select('month year gross net status currency basic hra allowances bonus tax insurance otherDeductions employeePF employerPF overtimeEarnings leaveDeduction advanceDeductions')
      .lean();
    if (!records.length) return { text: 'No payroll records are available for this account.', source: 'Payroll records' };
    const formatAmount = (amount, currency) => {
      if (amount === undefined || amount === null) return 'not recorded';
      const value = Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });
      if (currency === 'INR') return `₹${value}`;
      if (currency === 'USD') return `USD ${value}`;
      return `${value} (currency unverified)`;
    };
    return {
      text: `Your latest payroll records (historical amounts and currencies are shown as stored):\n${records.map(item => {
        const currency = item.currency || 'UNVERIFIED';
        const summary = `${item.month} ${item.year}: gross ${formatAmount(item.gross, currency)}, net ${formatAmount(item.net, currency)} (${item.status}; ${currency})`;
        if (!/explain|calculation|deduction|breakdown/.test(q)) return summary;
        return `${summary}\n  Basic ${formatAmount(item.basic, currency)} · HRA ${formatAmount(item.hra, currency)} · allowances ${formatAmount(item.allowances, currency)} · bonus ${formatAmount(item.bonus, currency)} · overtime ${formatAmount(item.overtimeEarnings, currency)}\n  Tax ${formatAmount(item.tax, currency)} · insurance ${formatAmount(item.insurance, currency)} · other deductions ${formatAmount(item.otherDeductions, currency)} · employee PF ${formatAmount(item.employeePF, currency)} · advance deductions ${formatAmount(item.advanceDeductions, currency)} · leave deductions ${formatAmount(item.leaveDeduction, currency)}`;
      }).join('\n')}`,
      source: 'Payroll records',
    };
  }
  return null;
};

const ticketCategoryFor = (module, intent, question) => {
  if (intent === 'profile' || /employee account verification/.test(question)) return 'Employee Account Verification';
  if (module === 'payroll' || intent === 'payslip' || /salary|payroll|payslip/.test(question)) return 'Payroll';
  if (module === 'leave' || intent === 'leave_balance' || /leave|vacation/.test(question)) return 'Leave';
  if (module === 'attendance' || intent === 'attendance' || /attendance|check in|check out/.test(question)) return 'Attendance';
  if (module === 'employees' || intent === 'profile') return 'Employee Management';
  return 'General';
};

const createAutomaticTicket = async (user, question, module, requestedCategory, intent) => {
  const issueKey = issueKeyFor(question);
  const existing = await ChatTicket.findOne({
    requesterId: user.id,
    issueKey,
    status: { $nin: ['Resolved', 'Closed'] },
  }).sort({ updatedAt: -1 });
  if (existing) return { ...existing.toObject(), reused: true };

  const ticketId = `EMS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const category = requestedCategory || ticketCategoryFor(module, intent, normalizeChatText(question));
  const ticket = await ChatTicket.create({
    ticketId,
    requesterId: user.id,
    requesterName: user.name,
    requesterRole: user.role,
    employeeId: user.employeeId || '',
    module,
    category,
    subject: question.slice(0, 160) || 'Unresolved EMS Assistant question',
    description: `Employee question: ${question.slice(0, 3500)}\n\nReason: Verified EMS data or approved knowledge did not resolve this request.`,
    issueKey,
    history: [{
      type: 'created', status: 'Open',
      message: 'Automatically escalated by EMS Assistant because verified information was unavailable.',
      performedBy: user.id, performedByName: user.name, performedByRole: user.role,
    }],
  });
  await ActivityLog.create({
    userId: user.id,
    userName: user.name,
    userRole: user.role,
    employeeId: user.employeeId || '',
    module: 'chatbot',
    action: 'automatic_support_escalation',
    recordId: String(ticket._id),
    updatedValue: { ticketId, category, issueKey },
  });

  const recipients = await User.find({ isActive: true, role: { $in: ['Admin', 'HR'] } }).select('_id role').lean();
  const eligibleRecipients = [];
  for (const recipient of recipients) {
    if (recipient.role === 'Admin' || await hasModulePermission(recipient, 'chatbot.tickets')) eligibleRecipients.push(recipient);
  }
  await Promise.all(eligibleRecipients.map(recipient =>
    notifyUser(recipient._id, `Support ticket ${ticket.ticketId}`, `${category} issue submitted by ${user.name}: ${ticket.subject}`, '/chatbot')
  ));
  return ticket.toObject();
};

const answer = async (req, res) => {
  try {
    const question = typeof req.body.question === 'string' ? req.body.question.trim().slice(0, 2000) : '';
    const module = typeof req.body.module === 'string' ? req.body.module.trim().slice(0, 80) || 'general' : 'general';
    if (!question) return res.status(400).json({ success: false, message: 'A question is required.' });
    const classified = classifyIntent(question);
    let { intent, confidence, normalized } = classified;
    if (confidence < 0.6 && isAIConfigured()) {
      const aiIntent = await classifyQuestion(question);
      if (aiIntent) {
        intent = aiIntent;
        confidence = 0.75;
      }
    }
    const live = await findLiveAnswer(req.user, question, module, intent);
    let text = live?.text;
    let source = live?.source || null;
    let navigation = live?.navigation || null;
    let verifiedContext = live && !live.escalate
      ? { source: live.source, answer: live.text }
      : null;
    let aiUsed = false;
    if (!text) {
      const articles = await ChatKnowledge.find({
        active: true,
        verified: true,
        audience: req.user.role,
      }).select('title category module content source').sort({ updatedAt: -1 }).limit(200).lean();
      const best = articles.map(article => ({ article, score: relevance(normalized, article) }))
        .sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 0.35) {
        text = best.article.content;
        source = `${best.article.title} · ${best.article.source}`;
        verifiedContext = {
          title: best.article.title,
          category: best.article.category,
          module: best.article.module,
          content: best.article.content,
          source: best.article.source,
        };
      } else {
        const workflow = findWorkflowAnswer(req.user, question);
        if (workflow) {
          text = workflow.text;
          source = workflow.source;
          navigation = workflow.navigation;
          verifiedContext = { source: workflow.source, answer: workflow.text };
        } else if (isAIConfigured() && articles.length) {
          const knowledgeContext = articles.slice(0, 20).map(article => ({
            title: article.title,
            category: article.category,
            module: article.module,
            content: article.content,
            source: article.source,
          }));
          const generated = await generateGroundedAnswer({
            question, role: req.user.role, module, context: { approvedKnowledgeArticles: knowledgeContext },
          });
          if (generated) {
            text = generated;
            source = 'Verified EMS Knowledge Base';
            aiUsed = true;
          }
        }
        if (!text) {
          const reason = best ? 'verified_article_below_relevance_threshold' : 'no_verified_article_match';
          console.warn('[Chat unresolved]', JSON.stringify({
            userId: req.user.id, intent, confidence, reason, module,
          }));
          text = intent === 'support_contact'
            ? 'You can contact the EMS support team by creating a support ticket here. Review the ticket details and confirm submission; updates will appear in the Tickets tab.'
            : 'I could not find verified EMS information that answers this. EMS Assistant has opened a support ticket for the responsible team to review.';
          source = intent === 'support_contact' ? 'EMS Assistant support workflow' : null;
        }
      }
    }
    const personalRequest = PERSONAL_INTENTS.has(intent);
    if (!aiUsed && verifiedContext && isAIConfigured() && (!personalRequest || process.env.EMS_AI_ALLOW_PERSONAL_DATA === 'true')) {
      const generated = await generateGroundedAnswer({
        question, role: req.user.role, module, context: verifiedContext,
      });
      if (generated) {
        text = generated;
        aiUsed = true;
      }
    }
    if (confidence < 0.6 && source) {
      console.warn('[Chat low-confidence intent]', JSON.stringify({
        userId: req.user.id, intent, confidence, reason: 'answer_found_for_unclassified_query', module,
      }));
    }
    const responseId = crypto.randomUUID();
    const shouldEscalate = Boolean(live?.escalate)
      || (!live && !source && intent !== 'support_contact');
    const ticket = shouldEscalate
      ? await createAutomaticTicket(req.user, question, module, live?.category, intent)
      : null;
    res.json({
      success: true,
      response: {
        id: responseId, text, source, navigation,
        needsClarification: !live && !source && !ticket,
        canEscalate: intent === 'support_contact' || (!ticket && !source),
        ticket: ticket ? { id: ticket._id, ticketId: ticket.ticketId, status: ticket.status, reused: ticket.reused } : null,
      },
      context: { module, role: req.user.role, ai: { configured: isAIConfigured(), used: aiUsed } },
    });
  } catch (error) {
    console.error('[Chat answer]', error.message);
    res.status(500).json({ success: false, message: 'Unable to answer this question right now.' });
  }
};

const searchKnowledge = async (req, res) => {
  try {
    const query = String(req.query.q || '').trim().slice(0, 200);
    if (!query) return res.json({ success: true, data: [] });
    const articles = await ChatKnowledge.find({
      active: true,
      verified: true,
      audience: req.user.role,
      $text: { $search: query },
    }).select('title category module content source updatedAt').limit(20).lean();
    res.json({ success: true, data: articles });
  } catch (error) {
    if (error.code === 27 || error.codeName === 'IndexNotFound') {
      return res.status(503).json({ success: false, message: 'Knowledge search is not available until the database text index is ready.' });
    }
    console.error('[Chat knowledge search]', error.message);
    res.status(500).json({ success: false, message: 'Unable to search the knowledge base.' });
  }
};

const saveFeedback = async (req, res) => {
  try {
    const { responseId, helpful, question, answer: responseText, comment = '', module = 'general' } = req.body || {};
    if (typeof responseId !== 'string' || !responseId.trim() || typeof helpful !== 'boolean'
      || typeof question !== 'string' || !question.trim() || typeof responseText !== 'string' || !responseText.trim()) {
      return res.status(400).json({ success: false, message: 'Response reference, answer rating, question, and response are required.' });
    }
    const feedback = await ChatFeedback.findOneAndUpdate(
      { responseId: responseId.trim(), userId: req.user.id },
      {
        responseId: responseId.trim(), userId: req.user.id, userRole: req.user.role,
        helpful, question: question.trim().slice(0, 2000), answer: responseText.trim().slice(0, 8000),
        issueKey: issueKeyFor(question), comment: typeof comment === 'string' ? comment.slice(0, 1000) : '',
        module: typeof module === 'string' ? module.slice(0, 80) : 'general',
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ success: true, data: { id: feedback._id, helpful: feedback.helpful } });
  } catch (error) {
    console.error('[Chat feedback]', error.message);
    res.status(500).json({ success: false, message: 'Unable to save feedback.' });
  }
};

const getFeedbackAnalytics = async (req, res) => {
  try {
    const [summary, unhelpful] = await Promise.all([
      ChatFeedback.aggregate([
        { $group: { _id: '$helpful', count: { $sum: 1 } } },
      ]),
      ChatFeedback.aggregate([
        { $match: { helpful: false } },
        { $sort: { createdAt: 1 } },
        { $group: { _id: '$issueKey', count: { $sum: 1 }, latestQuestion: { $last: '$question' }, latestComment: { $last: '$comment' }, latestModule: { $last: '$module' } } },
        { $sort: { count: -1 } }, { $limit: 30 },
      ]),
    ]);
    res.json({ success: true, summary: { helpful: summary.find(item => item._id === true)?.count || 0, notHelpful: summary.find(item => item._id === false)?.count || 0 }, unhelpful });
  } catch (error) {
    console.error('[Chat feedback analytics]', error.message);
    res.status(500).json({ success: false, message: 'Unable to load feedback analytics.' });
  }
};

const saveArticle = async (req, res) => {
  try {
    const { title, slug, category, module = 'general', content, audience, active = true } = req.body || {};
    if (typeof title !== 'string' || !title.trim() || typeof content !== 'string' || !content.trim()
      || typeof category !== 'string' || !category.trim()) {
      return res.status(400).json({ success: false, message: 'Title, category, and content are required.' });
    }
    const normalizedSlug = (slug || title).toString().toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
    if (!normalizedSlug) return res.status(400).json({ success: false, message: 'A valid article slug is required.' });
    const roles = Array.isArray(audience) ? [...new Set(audience.filter(role => ROLES.includes(role)))] : ROLES;
    if (!roles.length) return res.status(400).json({ success: false, message: 'Select at least one valid audience role.' });
    const article = await ChatKnowledge.findOneAndUpdate(
      { slug: normalizedSlug },
      { slug: normalizedSlug, title: title.trim(), category: category.trim(), module: String(module).slice(0, 80), content: content.trim(), audience: roles, verified: true, active: Boolean(active), source: 'Admin-verified company knowledge', updatedBy: req.user.id },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ success: true, data: article });
  } catch (error) {
    console.error('[Chat knowledge update]', error.message);
    res.status(500).json({ success: false, message: 'Unable to save the knowledge article.' });
  }
};

const listArticles = async (req, res) => {
  try {
    const articles = await ChatKnowledge.find({}).sort({ updatedAt: -1 }).limit(200).lean();
    res.json({ success: true, data: articles });
  } catch (error) {
    console.error('[Chat knowledge list]', error.message);
    res.status(500).json({ success: false, message: 'Unable to load knowledge articles.' });
  }
};

const deleteArticle = async (req, res) => {
  try {
    const article = await ChatKnowledge.findByIdAndDelete(req.params.id);
    if (!article) return res.status(404).json({ success: false, message: 'Knowledge article not found.' });
    res.json({ success: true, message: 'Knowledge article deleted.' });
  } catch (error) {
    console.error('[Chat knowledge delete]', error.message);
    res.status(500).json({ success: false, message: 'Unable to delete the knowledge article.' });
  }
};

const notifyUser = async (userId, title, message, actionUrl) => {
  const notification = await Notification.create({ userId, title, message, type: 'support_ticket', actionUrl });
  publishNotification(userId, notification.toJSON());
};

const createTicket = async (req, res) => {
  try {
    const { subject, description, module = 'general', category = 'General' } = req.body || {};
    if (typeof subject !== 'string' || !subject.trim() || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ success: false, message: 'A ticket subject and description are required.' });
    }
    const ticketId = `EMS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const ticket = await ChatTicket.create({
      ticketId,
      requesterId: req.user.id,
      requesterName: req.user.name,
      requesterRole: req.user.role,
      employeeId: req.user.employeeId || '',
      subject: subject.trim().slice(0, 160),
      description: description.trim().slice(0, 4000),
      module: typeof module === 'string' ? module.slice(0, 80) : 'general',
      category: typeof category === 'string' ? category.slice(0, 80) : 'General',
      history: [{ type: 'created', status: 'Open', message: 'Support ticket created.', performedBy: req.user.id, performedByName: req.user.name, performedByRole: req.user.role }],
    });
    const recipients = await User.find({ isActive: true, role: { $in: ['Admin', 'HR'] } }).select('_id role').lean();
    const eligibleRecipients = [];
    for (const recipient of recipients) {
      if (recipient.role === 'Admin' || await hasModulePermission(recipient, 'chatbot.tickets')) eligibleRecipients.push(recipient);
    }
    await Promise.all(eligibleRecipients.map(recipient =>
      notifyUser(recipient._id, `Support ticket ${ticket.ticketId}`, `${req.user.name} submitted: ${ticket.subject}`, '/chatbot')
    ));
    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    console.error('[Chat ticket create]', error.message);
    res.status(500).json({ success: false, message: 'Unable to create the support ticket.' });
  }
};

const listTickets = async (req, res) => {
  try {
    const isManager = req.user.role === 'Admin' || (req.user.role === 'HR' && await hasModulePermission(req.user, 'chatbot.tickets'));
    let filter;
    if (isManager) filter = {};
    else filter = { requesterId: req.user.id };
    const tickets = await ChatTicket.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
    res.json({ success: true, data: tickets });
  } catch (error) {
    console.error('[Chat ticket list]', error.message);
    res.status(500).json({ success: false, message: 'Unable to load support tickets.' });
  }
};

const updateTicket = async (req, res) => {
  try {
    const { status, assignedTo, comment } = req.body || {};
    if (status !== undefined && !TICKET_STATUSES.includes(status)) return res.status(400).json({ success: false, message: 'Invalid ticket status.' });
    if (comment !== undefined && (typeof comment !== 'string' || !comment.trim())) return res.status(400).json({ success: false, message: 'Ticket comments cannot be empty.' });
    const ticket = await ChatTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Support ticket not found.' });
    if (status !== undefined) {
      ticket.status = status;
      ticket.history.push({ type: 'status', status, message: `Status changed to ${status}.`, performedBy: req.user.id, performedByName: req.user.name, performedByRole: req.user.role });
    }
    if (assignedTo !== undefined) {
      if (assignedTo === null || assignedTo === '') {
        ticket.assignedTo = null;
        ticket.assignedName = '';
      } else {
        if (!/^[a-f\d]{24}$/i.test(String(assignedTo))) return res.status(400).json({ success: false, message: 'Invalid assignee.' });
        const assignee = await User.findOne({ _id: assignedTo, isActive: true, role: { $in: ['Admin', 'HR'] } }).select('name role').lean();
        if (!assignee || (assignee.role === 'HR' && !await hasModulePermission(assignee, 'chatbot.tickets'))) {
          return res.status(400).json({ success: false, message: 'The selected user is not authorized to manage support tickets.' });
        }
        ticket.assignedTo = assignee._id;
        ticket.assignedName = assignee.name;
      }
      ticket.history.push({ type: 'assignment', message: ticket.assignedName ? `Assigned to ${ticket.assignedName}.` : 'Assignment cleared.', performedBy: req.user.id, performedByName: req.user.name, performedByRole: req.user.role });
    }
    if (comment !== undefined) ticket.history.push({ type: 'comment', message: comment.trim().slice(0, 2000), performedBy: req.user.id, performedByName: req.user.name, performedByRole: req.user.role });
    await ticket.save();
    await notifyUser(ticket.requesterId, `Support ticket ${ticket.ticketId} updated`, `Your ticket is now ${ticket.status}${comment ? `: ${comment.trim().slice(0, 500)}` : '.'}`, '/chatbot');
    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('[Chat ticket update]', error.message);
    res.status(500).json({ success: false, message: 'Unable to update the support ticket.' });
  }
};

const addTicketComment = async (req, res) => {
  try {
    const message = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, 2000) : '';
    if (!message) return res.status(400).json({ success: false, message: 'A comment is required.' });
    const ticket = await ChatTicket.findOne({ _id: req.params.id, requesterId: req.user.id });
    if (!ticket) return res.status(404).json({ success: false, message: 'Support ticket not found.' });
    ticket.history.push({ type: 'comment', message, performedBy: req.user.id, performedByName: req.user.name, performedByRole: req.user.role });
    await ticket.save();
    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('[Chat ticket comment]', error.message);
    res.status(500).json({ success: false, message: 'Unable to add a comment.' });
  }
};

const requireTicketManager = async (req, res, next) => {
  try {
    if (req.user.role === 'Admin' || (req.user.role === 'HR' && await hasModulePermission(req.user, 'chatbot.tickets'))) return next();
    return res.status(403).json({ success: false, message: 'You do not have permission to manage support tickets.' });
  } catch (error) {
    console.error('[Chat ticket permission]', error.message);
    return res.status(500).json({ success: false, message: 'Unable to verify ticket permissions.' });
  }
};

module.exports = {
  getSuggestions, answer, searchKnowledge, saveFeedback, getFeedbackAnalytics,
  saveArticle, listArticles, deleteArticle, createTicket, listTickets,
  updateTicket, addTicketComment, requireTicketManager,
};
