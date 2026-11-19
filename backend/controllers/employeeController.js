const Employee = require('../models/Employee');
const User     = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const Notification = require('../models/Notification');
const { resolveEmployeeForUser, linkEmployeeAccount, managerAssignedEmployees } = require('../services/employeeIdentity');
const { listEmployeeOptions } = require('../services/employeeDirectory');
const { resolvePermissionsForRole } = require('./permissionController');
const { publishNotification } = require('../services/notificationEvents');

const exactMatch = value => new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

const resolveManagerReference = async (managerUserId, legacyName) => {
  if (managerUserId !== undefined) {
    if (!managerUserId) return { manager: null };
    const manager = await User.findOne({ _id: managerUserId, role: 'Manager', isActive: true }).select('_id name');
    return manager ? { manager } : { error: 'Select an active Manager account.' };
  }
  const name = String(legacyName || '').trim();
  if (!name) return { manager: null };
  const manager = await User.findOne({
    role: 'Manager',
    isActive: true,
    $or: ['name', 'email', 'employeeId'].map(field => ({ [field]: exactMatch(name) })),
  }).select('_id name');
  return manager ? { manager } : { error: 'Select a reporting manager from the active Manager list.' };
};

const notifyReportingChange = async ({ employee, account, manager, previousManagerId }) => {
  const recipients = new Map();
  const add = (userId, message) => {
    if (userId) recipients.set(String(userId), { userId, message });
  };
  add(account?._id, manager
    ? `Your reporting manager is now ${manager.name}.`
    : 'Your reporting manager assignment has been removed.');
  add(manager?._id, `${employee.name} has been ${manager ? 'added to' : 'removed from'} your team.`);
  if (previousManagerId && String(previousManagerId) !== String(manager?._id || '')) {
    const previousManager = await User.findById(previousManagerId).select('_id').lean();
    add(previousManager?._id, `${employee.name} was removed from your team.`);
  }
  const administrators = await User.find({ role: 'Admin', isActive: true }).select('_id').lean();
  administrators.forEach(admin => add(admin._id, `Reporting relationship updated for ${employee.name}.`));
  if (recipients.size) {
    await Notification.insertMany([...recipients.values()].map(({ userId, message }) => ({
      userId,
      employeeId: employee.employeeId || '',
      title: 'Team reporting relationship updated',
      message,
      type: 'reporting',
    })));
  }
};

const notifyDirectoryChange = async (account, message) => {
  const recipients = await User.find({
    role: { $in: ['Admin', 'HR', 'Manager'] },
    isActive: true,
  }).select('_id').lean();
  if (!recipients.length) return;
  await Notification.insertMany(recipients.map(recipient => ({
    userId: recipient._id,
    employeeId: account.employeeId || '',
    title: 'Employee directory updated',
    message: message || `${account.name} (${account.role}) is now available in role-appropriate employee selectors.`,
    type: 'directory',
  })));
};

const salaryFieldsProjection = async user => {
  if (user.role === 'Admin') return '';
  if (['HR', 'Manager'].includes(user.role)) {
    const { permissions } = await resolvePermissionsForRole(user.role);
    if (permissions['payroll.allRecords'] === true) return '';
  }
  return '-salary -hra -allowances -bonus -deductions';
};

const employeeAccountStatus = account => {
  if (!account.isActive || account.accountStatus === 'suspended' || account.registrationStatus === 'rejected') return 'inactive';
  if (account.registrationStatus === 'pending' || account.accountStatus === 'pending') return 'pending';
  return 'active';
};

const employeeRecordFromAccount = account => ({
  _id: account._id,
  userId: account._id,
  employeeId: account.employeeId || account.registrationEmployeeId || '',
  name: account.name || '',
  email: account.email || '',
  phone: account.phone || '',
  department: account.department || '',
  designation: account.designation || '',
  position: account.designation || '',
  joiningDate: '',
  employmentType: '',
  status: employeeAccountStatus(account),
  role: 'Employee',
  accountOnly: true,
  createdAt: account.createdAt,
});

// Normalize incoming employee data — merge firstName/lastName into name, sync designation/position
const normalizeEmployeeData = (body) => {
  const data = { ...body };
  if (!data.name && (data.firstName || data.lastName)) {
    data.name = `${data.firstName || ''} ${data.lastName || ''}`.trim();
  }
  if (!data.designation && data.position) data.designation = data.position;
  if (!data.position && data.designation) data.position = data.designation;
  if (!data.joiningDate && data.dateOfJoining) data.joiningDate = String(data.dateOfJoining).split('T')[0];
  // Never accept client-supplied salary/role escalations through mass assignment silently —
  // salary is allowed but role/userId are stripped explicitly.
  delete data.role;
  delete data.userId;
  delete data.managerUserId;
  delete data.reportingManagerId;
  return data;
};

/**
 * Generate the next sequential employee ID (EMP-0001, EMP-0002, ...).
 * Scans the highest existing numeric suffix across BOTH Employee and User
 * collections so IDs never collide, even if a login account exists without a
 * matching employee record (or vice versa).
 */
const generateEmployeeId = async () => {
  const parseMax = (docs) => docs.reduce((max, d) => {
    const m = /^EMP-(\d+)$/.exec(d.employeeId || '');
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);

  const [empLast, userLast] = await Promise.all([
    Employee.findOne({ employeeId: /^EMP-\d+$/ }).sort({ employeeId: -1 }),
    User.findOne({ employeeId: /^EMP-\d+$/ }).sort({ employeeId: -1 }),
  ]);

  const next = parseMax([empLast, userLast].filter(Boolean)) + 1;
  return `EMP-${String(next).padStart(4, '0')}`;
};

/**
 * Generate a unique employee ID, retrying if a concurrent create grabbed the
 * same number. Guards against the (rare) race between read and write.
 */
const generateUniqueEmployeeId = async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = await generateEmployeeId();
    const [empExists, userExists] = await Promise.all([
      Employee.exists({ employeeId: candidate }),
      User.exists({ employeeId: candidate }),
    ]);
    if (!empExists && !userExists) return candidate;
  }
  // Fallback: timestamp-based ID guaranteed unique
  return `EMP-${Date.now().toString().slice(-8)}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/employees?page=&limit=&search=&department=&designation=&status=
//  Employee role: only their own linked record
// ─────────────────────────────────────────────────────────────────────────────
const getEmployees = async (req, res) => {
  try {
    const {
      page = 1, limit = 10, search, department, designation, status,
    } = req.query;

    // Employees can only fetch their own record
    if (req.user.role === 'Employee') {
      const me = await Employee.findOne({ $or: [{ userId: req.user.id }, { email: req.user.email }] });
      return res.json({ success: true, count: me ? 1 : 0, data: me ? [me] : [] });
    }
    const salaryProjection = await salaryFieldsProjection(req.user);

    // Exclude drafts from the main employee list — they live in a separate resume list.
    const filter = { isDraft: { $ne: true } };
    if (req.user.role === 'Manager') {
      const team = await managerAssignedEmployees(req.user);
      filter._id = { $in: team.map(employee => employee._id) };
    }
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { employeeId: rx }, { phone: rx }];
    }
    if (department) filter.department = department;
    if (designation) filter.designation = designation;
    if (status) filter.status = status;

    const pageNum  = Math.max(1, parseInt(page, 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * pageSize;

    const [profileTotal, linkedProfiles] = await Promise.all([
      Employee.countDocuments(filter),
      ['Admin', 'HR'].includes(req.user.role)
        ? Employee.find({ isDraft: { $ne: true } }).select('_id userId employeeId email').lean()
        : [],
    ]);
    const accountOnlyRecords = ['Admin', 'HR'].includes(req.user.role)
      ? await User.find({ role: 'Employee' })
        .select('name email employeeId registrationEmployeeId registrationEmployeeRef phone department designation employeeRef isActive accountStatus registrationStatus createdAt')
        .lean()
      : [];
    const linkedUserIds = new Set(linkedProfiles.filter(employee => employee.userId).map(employee => String(employee.userId)));
    const linkedProfileIds = new Set(linkedProfiles.map(employee => String(employee._id)));
    const linkedEmployeeIds = new Set(linkedProfiles.map(employee => employee.employeeId).filter(Boolean));
    const linkedEmails = new Set(linkedProfiles.map(employee => String(employee.email || '').toLowerCase()).filter(Boolean));
    const searchRegex = search
      ? new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      : null;
    const standaloneAccounts = accountOnlyRecords
      .filter(account =>
        !linkedUserIds.has(String(account._id))
        && !linkedProfileIds.has(String(account.employeeRef || account.registrationEmployeeRef || ''))
        && !(account.employeeId && linkedEmployeeIds.has(account.employeeId))
        && !(account.registrationEmployeeId && linkedEmployeeIds.has(account.registrationEmployeeId))
        && !(account.email && linkedEmails.has(account.email.toLowerCase()))
      )
      .map(employeeRecordFromAccount)
      .filter(employee =>
        (!searchRegex || searchRegex.test([employee.name, employee.email, employee.employeeId, employee.phone].join(' ')))
        && (!department || employee.department === department)
        && (!designation || employee.designation === designation)
        && (!status || employee.status === status)
      )
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
        || String(b._id).localeCompare(String(a._id)));
    const total = profileTotal + standaloneAccounts.length;
    const profileSkip = Math.min(skip, profileTotal);
    const profileLimit = Math.max(0, Math.min(pageSize, profileTotal - profileSkip));
    const employees = profileLimit ? await Employee.find(filter)
      .select(salaryProjection)
      .sort({ createdAt: -1, _id: -1 })
      .skip(profileSkip)
      .limit(profileLimit)
      .lean() : [];
    const linkedAccounts = employees.length ? await User.find({
      $or: [
        { _id: { $in: employees.map(employee => employee.userId).filter(Boolean) } },
        { employeeRef: { $in: employees.map(employee => employee._id) } },
        { employeeId: { $in: employees.map(employee => employee.employeeId).filter(Boolean) } },
        { email: { $in: employees.map(employee => employee.email).filter(Boolean) } },
      ],
    }).select('role employeeRef employeeId email').lean() : [];
    const accountsByUserId = new Map(linkedAccounts.map(account => [String(account._id), account]));
    const accountsByEmployeeRef = new Map(linkedAccounts.filter(account => account.employeeRef)
      .map(account => [String(account.employeeRef), account]));
    const accountsByEmployeeId = new Map(linkedAccounts.filter(account => account.employeeId)
      .map(account => [account.employeeId, account]));
    const accountsByEmail = new Map(linkedAccounts.filter(account => account.email)
      .map(account => [account.email.toLowerCase(), account]));
    const profileData = employees.map(employee => {
      const account = accountsByUserId.get(String(employee.userId))
        || accountsByEmployeeRef.get(String(employee._id))
        || accountsByEmployeeId.get(employee.employeeId)
        || accountsByEmail.get(String(employee.email || '').toLowerCase());
      return { ...employee, role: account?.role || 'Employee' };
    });
    const accountSkip = Math.max(0, skip - profileTotal);
    const accountLimit = Math.max(0, pageSize - profileData.length);
    const data = [
      ...profileData,
      ...standaloneAccounts.slice(accountSkip, accountSkip + accountLimit),
    ];

    res.json({
      success: true,
      count: data.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / pageSize),
      data,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/employees/:id
//  Employee role: can only view their own record
// ─────────────────────────────────────────────────────────────────────────────
const getEmployeeById = async (req, res) => {
  try {
    const salaryProjection = req.user.role === 'Employee' ? '' : await salaryFieldsProjection(req.user);
    const employee = await Employee.findById(req.params.id).select(salaryProjection);
    if (!employee) {
      const account = await User.findOne({ _id: req.params.id, role: 'Employee' })
        .select('name email employeeId registrationEmployeeId registrationEmployeeRef phone department designation employeeRef isActive accountStatus registrationStatus createdAt')
        .lean();
      if (!account) return res.status(404).json({ success: false, message: 'Employee not found' });
      if (req.user.role === 'Employee' && String(account._id) !== req.user.id) {
        return res.status(403).json({ success: false, message: 'You can only view your own profile' });
      }
      if (!['Admin', 'HR', 'Employee'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'You may only view employees assigned to your team.' });
      }
      return res.json({ success: true, data: employeeRecordFromAccount(account) });
    }

    // Enforce data isolation for employees
    if (req.user.role === 'Employee') {
      const isOwner = (employee.userId && employee.userId.toString() === req.user.id) || employee.email === req.user.email;
      if (!isOwner) {
        return res.status(403).json({ success: false, message: 'You can only view your own profile' });
      }
    }
    if (req.user.role === 'Manager') {
      const team = await managerAssignedEmployees(req.user);
      if (!team.some(member => String(member._id) === String(employee._id))) {
        return res.status(403).json({ success: false, message: 'You may only view employees assigned to your team.' });
      }
    }

    res.json({ success: true, data: employee });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/employees/me  — current user's linked employee record
// ─────────────────────────────────────────────────────────────────────────────
const getMyEmployeeRecord = async (req, res) => {
  try {
    const { employee, error } = await resolveEmployeeForUser(req.user);
    if (!employee) return res.status(404).json({ success: false, message: error });
    res.json({ success: true, data: employee });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getEmployeeAccounts = async (req, res) => {
  try {
    const accounts = await User.find({ role: 'Employee' })
      .select('name email employeeId employeeRef isActive')
      .sort({ name: 1 });
    const linkedEmployees = accounts.length ? await Employee.find({
      userId: { $in: accounts.map(account => account._id) },
      isDraft: { $ne: true },
    }).select('_id userId').lean() : [];
    const linkedByUser = new Map(linkedEmployees.map(employee => [employee.userId.toString(), employee._id.toString()]));
    res.json({
      success: true,
      count: accounts.length,
      data: accounts.map(account => ({
        _id: account._id,
        name: account.name,
        email: account.email,
        employeeId: account.employeeId || '',
        employeeRef: account.employeeRef,
        linkedEmployeeRecordId: linkedByUser.get(account._id.toString()) || '',
        isActive: account.isActive,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getEmployeeOptions = async (req, res) => {
  try {
    const includeUnassigned = String(req.query.includeUnassigned || '').toLowerCase() === 'true';
    if (includeUnassigned && req.user.role !== 'Admin') {
      const { actions } = await resolvePermissionsForRole(req.user.role);
      if (!actions?.employees?.manage) {
        return res.status(403).json({ success: false, message: 'You do not have permission to assign employees to a team.' });
      }
    }
    const roles = req.query.roles
      ? String(req.query.roles).split(',').map(role => role.trim()).filter(Boolean)
      : undefined;
    const result = await listEmployeeOptions(req.user, roles, { includeUnassigned });
    if (result.error) return res.status(403).json({ success: false, message: result.error });
    res.json({ success: true, count: result.data.length, data: result.data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getTeam = async (req, res) => {
  try {
    let managerId = req.user._id;
    if (req.user.role === 'Admin' || req.user.role === 'HR') {
      if (req.query.managerId) {
        const manager = await User.findOne({ _id: req.query.managerId, role: 'Manager', isActive: true })
          .select('_id').lean();
        if (!manager) return res.status(404).json({ success: false, message: 'Active Manager account not found.' });
        managerId = manager._id;
      } else if (req.user.role === 'Admin' || req.user.role === 'HR') {
        const allManagers = await User.find({
          role: 'Manager',
          ...(req.user.role === 'Admin' ? {} : { isActive: true }),
        }).select('_id name').lean();
        const teams = await Promise.all(allManagers.map(async manager => ({
          manager,
          employees: await managerAssignedEmployees(manager, { includeInactive: req.user.role === 'Admin' }),
        })));
        const data = teams.map(team => ({
          manager: { userId: String(team.manager._id), name: team.manager.name },
          employees: team.employees.map(employee => ({
            ...employee.toObject(),
            reportingManagerId: String(team.manager._id),
          })),
        }));
        return res.json({ success: true, count: data.reduce((sum, team) => sum + team.employees.length, 0), data });
      }
    } else if (req.user.role !== 'Manager') {
      return res.status(403).json({ success: false, message: 'Only Admin, HR, or Managers can view teams.' });
    }
    const manager = await User.findById(managerId).select('name').lean();
    const employees = await managerAssignedEmployees({ _id: managerId, name: manager?.name });
    res.json({
      success: true,
      count: employees.length,
      data: [{
        manager: { userId: String(managerId), name: manager?.name || req.user.name },
        employees,
      }],
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const setReportingManager = async (req, res) => {
  try {
    if (!['Admin', 'HR', 'Manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only Admin, HR, or Managers can change team membership.' });
    }
    let employee = await Employee.findOne({ _id: req.params.id, isDraft: { $ne: true } });
    if (!employee) {
      const account = await User.findById(req.params.id).select('employeeRef employeeId email');
      if (account) {
        employee = await Employee.findOne({
          isDraft: { $ne: true },
          $or: [
            { userId: account._id },
            ...(account.employeeRef ? [{ _id: account.employeeRef }] : []),
            ...(account.employeeId ? [{ employeeId: account.employeeId }] : []),
            ...(account.email ? [{ email: account.email }] : []),
          ],
        });
      }
    }
    if (!employee) return res.status(404).json({ success: false, message: 'Employee record not found.' });
    if (employee.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Only active Employees can be assigned to a Manager team.' });
    }
    const requestedManagerId = req.body.managerUserId ? String(req.body.managerUserId) : '';
    const targetManager = requestedManagerId
      ? await User.findOne({ _id: requestedManagerId, role: 'Manager', isActive: true }).select('_id name email employeeId')
      : null;
    if (requestedManagerId && !targetManager) {
      return res.status(400).json({ success: false, message: 'Select an active Manager account.' });
    }

    const linkedAccount = employee.userId
      ? await User.findById(employee.userId).select('_id role')
      : await User.findOne({ $or: [{ employeeRef: employee._id }, { email: employee.email }], isActive: true }).select('_id role');
    if (linkedAccount && linkedAccount.role !== 'Employee') {
      return res.status(400).json({ success: false, message: 'Only Employee accounts can be assigned to a Manager team.' });
    }

    let currentManagerId = employee.reportingManagerId ? String(employee.reportingManagerId) : '';
    if (!currentManagerId && employee.manager) {
      const legacyManager = await User.findOne({
        role: 'Manager',
        $or: ['name', 'email', 'employeeId'].map(field => ({ [field]: exactMatch(employee.manager) })),
      }).select('_id').lean();
      currentManagerId = legacyManager ? String(legacyManager._id) : '';
    }
    if (requestedManagerId && requestedManagerId === currentManagerId) {
      return res.status(409).json({ success: false, message: 'This employee is already assigned to that Manager team.' });
    }
    const actorId = String(req.user._id);
    if (req.user.role === 'Manager') {
      if (requestedManagerId && requestedManagerId !== actorId) {
        return res.status(403).json({ success: false, message: 'Managers may only add employees to their own team.' });
      }
      if (currentManagerId && currentManagerId !== actorId) {
        return res.status(403).json({ success: false, message: 'This employee belongs to another Manager. Ask Admin or HR to transfer the employee.' });
      }
      if (!requestedManagerId && currentManagerId !== actorId) {
        return res.status(403).json({ success: false, message: 'You may only remove employees from your own team.' });
      }
    }

    const previousValue = { reportingManagerId: currentManagerId || null, manager: employee.manager || '' };
    employee.reportingManagerId = targetManager?._id || null;
    employee.manager = targetManager?.name || '';
    await employee.save();

    const updatedValue = {
      reportingManagerId: targetManager?._id || null,
      manager: targetManager?.name || '',
    };
    const logData = {
      userId: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      employeeId: employee.employeeId || '',
      module: 'Employees',
      action: targetManager ? 'Employee assigned to Manager team' : 'Employee removed from Manager team',
      recordId: String(employee._id),
      previousValue,
      updatedValue,
    };
    await ActivityLog.create(logData);
    await notifyReportingChange({
      employee,
      account: linkedAccount,
      manager: targetManager,
      previousManagerId: currentManagerId,
    });
    res.json({ success: true, data: employee });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const linkEmployeeAccountRecord = async (req, res) => {
  try {
    const employee = await Employee.findOne({
      _id: req.params.id,
      isDraft: { $ne: true },
    });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee record not found.' });
    const account = await User.findById(req.body.userId);
    if (!account) return res.status(404).json({ success: false, message: 'Employee login account not found.' });
    const previous = {
      employeeUserId: employee.userId || null,
      accountEmployeeRef: account.employeeRef || null,
      accountEmployeeId: account.employeeId || '',
    };
    const linked = await linkEmployeeAccount(employee, account, req.body.replaceExisting === true);
    let warning;
    try {
      await ActivityLog.create({
        userId: req.user._id,
        userName: req.user.name,
        userRole: req.user.role,
        employeeId: linked.employee.employeeId,
        module: 'Employees',
        action: 'Employee login account linked',
        recordId: linked.employee._id.toString(),
        previousValue: previous,
        updatedValue: {
          employeeUserId: linked.employee.userId,
          accountEmployeeRef: linked.account.employeeRef,
          accountEmployeeId: linked.account.employeeId,
        },
      });
    } catch (error) {
      console.error(`[Employee ${linked.employee.employeeId}] Account-link activity log failed:`, error.message);
      warning = 'The account was linked, but its activity log could not be recorded.';
    }
    res.json({ success: true, data: linked.employee, ...(warning ? { warning } : {}) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Draft helpers
// A draft is a partially-filled, not-yet-finalized employee record. It is owned
// by the user who created it (createdBy) so it survives refresh/logout/login and
// can be resumed from the step the user left off on. No User login account is
// created for a draft — that only happens when the draft is finalized.
// ─────────────────────────────────────────────────────────────────────────────

// Fields that are safe to persist on a draft (everything the form collects).
const sanitizeDraftData = (body) => {
  const data = normalizeEmployeeData(body); // strips role/userId, merges name/designation
  // Never store login credentials on the draft document.
  delete data.password;
  delete data.confirmPassword;
  delete data.loginRole;
  // Keep loginRole as plain metadata so the form can restore the selection.
  if (['Employee', 'Manager', 'HR'].includes(body.loginRole)) {
    data.loginRole = body.loginRole;
  }
  return data;
};

// GET /api/employees/drafts — list the current user's drafts (newest first)
const getDrafts = async (req, res) => {
  try {
    const drafts = await Employee.find({ isDraft: true, createdBy: req.user.id })
      .sort({ updatedAt: -1 });
    res.json({ success: true, count: drafts.length, data: drafts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/employees/drafts/:id — fetch a single draft the user owns
const getDraftById = async (req, res) => {
  try {
    const draft = await Employee.findOne({ _id: req.params.id, isDraft: true, createdBy: req.user.id });
    if (!draft) return res.status(404).json({ success: false, message: 'Draft not found' });
    res.json({ success: true, data: draft });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/employees/drafts        — create a new draft
// PUT  /api/employees/drafts/:id    — update an existing draft
// Relaxed validation: a draft can be saved with any subset of fields filled.
const saveDraft = async (req, res) => {
  try {
    const data = sanitizeDraftData(req.body);
    data.isDraft = true;
    data.createdBy = req.user.id;
    data.draftStep = Number(req.body.draftStep) || 1;
    // Drafts must never carry an employeeId (that is assigned only on finalize).
    delete data.employeeId;
    // Blank email → store undefined so it won't collide on the partial unique index.
    if (!data.email) delete data.email;

    const draftId = req.params.id;
    let draft;
    if (draftId) {
      draft = await Employee.findOne({ _id: draftId, isDraft: true, createdBy: req.user.id });
      if (!draft) return res.status(404).json({ success: false, message: 'Draft not found' });
      // If email was cleared, unset it on the stored document.
      if (!data.email) draft.email = undefined;
      Object.assign(draft, data);
      await draft.save();
    } else {
      draft = await Employee.create(data);
    }

    res.status(draftId ? 200 : 201).json({ success: true, data: draft });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'A record with this email already exists' });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

// DELETE /api/employees/drafts/:id — discard a draft the user owns
const deleteDraft = async (req, res) => {
  try {
    const draft = await Employee.findOneAndDelete({ _id: req.params.id, isDraft: true, createdBy: req.user.id });
    if (!draft) return res.status(404).json({ success: false, message: 'Draft not found' });
    res.json({ success: true, message: 'Draft discarded' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/employees  (admin/HR creates an employee record)
//  - auto-generates a unique employee ID
//  - validates duplicate email and employee ID
//  - when `draftId` is supplied, promotes that draft into a finalized employee
// ─────────────────────────────────────────────────────────────────────────────
const createEmployee = async (req, res) => {
  try {
    if (!['Admin', 'HR'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only Admin or HR can create employee accounts. Use Team Management to add an existing Employee.' });
    }
    // Pull out login-account fields BEFORE normalizing (which strips them).
    const initialPassword = req.body.password;
    const loginRole = ['Employee', 'Manager', 'HR'].includes(req.body.loginRole)
      ? req.body.loginRole
      : 'Employee';
    const draftId = req.body.draftId;
    const accountId = req.body.accountId;

    const data = normalizeEmployeeData(req.body);
    // Never persist password/loginRole/draft metadata onto the Employee document.
    delete data.password;
    delete data.loginRole;
    delete data.draftId;
    delete data.isDraft;
    delete data.draftStep;
    delete data.createdBy;
    delete data.accountId;

    if (!data.email) return res.status(400).json({ success: false, message: 'Email is required' });
    if (!data.name) return res.status(400).json({ success: false, message: 'Employee name is required' });
    if (!data.department) return res.status(400).json({ success: false, message: 'Department is required' });
    const managerResult = await resolveManagerReference(req.body.managerUserId, req.body.manager);
    if (managerResult.error) return res.status(400).json({ success: false, message: managerResult.error });
    if (managerResult.manager && loginRole !== 'Employee') {
      return res.status(400).json({ success: false, message: 'Only Employee accounts can be assigned to a Manager team.' });
    }
    if (managerResult.manager && data.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Only active Employees can be assigned to a Manager team.' });
    }
    data.reportingManagerId = managerResult.manager?._id || null;
    data.manager = managerResult.manager?.name || '';
    delete data.managerUserId;

    // Validate the initial login password when supplied
    if (initialPassword !== undefined && initialPassword !== '' && String(initialPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'Initial password must be at least 6 characters' });
    }

    const emailLower = data.email.toLowerCase();
    const existingLoginAccount = accountId
      ? await User.findOne({ _id: accountId, role: 'Employee' })
      : await User.findOne({ email: emailLower });
    if (accountId && !existingLoginAccount) {
      return res.status(404).json({ success: false, message: 'Employee login account not found or no longer available for profile completion' });
    }
    if (existingLoginAccount?.email && existingLoginAccount.email.toLowerCase() !== emailLower) {
      return res.status(400).json({ success: false, message: 'The email must match the existing Employee login account' });
    }
    if (existingLoginAccount && existingLoginAccount.role !== 'Employee') {
      return res.status(400).json({ success: false, message: 'This email belongs to a non-Employee account' });
    }
    // Validate duplicate email on the Employee collection. When finalizing a
    // draft, exclude that draft from the check — its stored email is the one we
    // are promoting, not a genuine duplicate.
    const dupFilter = { email: emailLower };
    if (draftId) dupFilter._id = { $ne: draftId };
    const existing = await Employee.findOne(dupFilter);
    if (existing) {
      return res.status(400).json({ success: false, message: 'An employee with this email already exists' });
    }

    // Validate duplicate employee ID if supplied, otherwise auto-generate a unique one
    if (data.employeeId) {
      const idExists = await Employee.findOne({ employeeId: data.employeeId });
      if (idExists) {
        return res.status(400).json({ success: false, message: 'An employee with this employee ID already exists' });
      }
    } else {
      data.employeeId = await generateUniqueEmployeeId();
    }

    if (!data.joiningDate) data.joiningDate = new Date().toISOString().split('T')[0];

    // Finalize: if a draftId is supplied, convert that existing draft document
    // in place (so its email never collides with a freshly-created record on
    // the partial unique index). Otherwise create a brand-new employee.
    let employee;
    if (draftId) {
      employee = await Employee.findOne({ _id: draftId, isDraft: true, createdBy: req.user.id });
      if (!employee) {
        return res.status(404).json({ success: false, message: 'Draft not found or already finalized' });
      }
      Object.assign(employee, data);
      employee.isDraft = false;
      employee.draftStep = undefined;
      await employee.save();
    } else {
      employee = await Employee.create(data);
    }

    // ── Create or link the login (User) account ───────────────────────────────
    // An employee logs in with their Employee ID + the password set here.
    let loginAccount = existingLoginAccount;

    if (loginAccount) {
      // An account already exists for this email — link it and stamp the Employee ID.
      loginAccount.employeeRef  = employee._id;
      loginAccount.employeeId   = loginAccount.employeeId || employee.employeeId;
      loginAccount.name         = data.name;
      loginAccount.email        = emailLower;
      loginAccount.department   = data.department;
      loginAccount.designation  = data.designation || data.position || '';
      if (initialPassword) {
        loginAccount.password = initialPassword;         // hashed by pre-save hook
        loginAccount.mustChangePassword = true;
      }
      await loginAccount.save();
    } else {
      // Create a brand-new Employee login account keyed by Employee ID.
      // If no password was provided, generate a strong random one (HR can reset later).
      const pwd = initialPassword && String(initialPassword).length >= 6
        ? initialPassword
        : require('crypto').randomBytes(24).toString('hex');

      loginAccount = await User.create({
        name:        data.name,
        email:       emailLower,
        employeeId:  employee.employeeId,
        password:    pwd,                 // hashed by pre-save hook
        role:        loginRole,
        department:  data.department,
        designation: data.designation || data.position || '',
        phone:       data.phone || '',
        employeeRef: employee._id,
        mustChangePassword: Boolean(initialPassword), // only prompt if HR set a known password
        ...(loginRole === 'Employee' ? {
          registrationStatus: req.user.role === 'Admin' ? 'approved' : 'pending',
          accountStatus: req.user.role === 'Admin' ? 'active' : 'pending',
          onboardingStatus: 'not_started',
          personalInfoApprovalStatus: 'not_submitted',
          documentVerificationStatus: 'not_submitted',
          registrationEmployeeId: employee.employeeId,
          registrationEmployeeRef: employee._id,
          registrationIdentityStatus: 'matched',
          registrationSubmittedAt: new Date(),
          ...(req.user.role === 'Admin' ? {
            registrationReviewedAt: new Date(),
            registrationReviewedBy: req.user._id,
          } : {}),
        } : {}),
        isActive:    loginRole !== 'Employee' || req.user.role === 'Admin',
      });
    }

    await linkEmployeeAccount(employee, loginAccount, false, ['Employee', 'Manager', 'HR']);
    if (loginRole === 'Employee' && !existingLoginAccount) {
      const needsRegistrationApproval = req.user.role !== 'Admin';
      const notifications = [
        {
          userId: loginAccount._id,
          employeeId: employee.employeeId,
          title: needsRegistrationApproval ? 'Registration successfully submitted' : 'Personal information pending',
          message: needsRegistrationApproval
            ? `Your Employee account was created by HR on ${new Date().toLocaleString('en-IN')} and is awaiting Admin registration approval.`
            : 'Your Employee account is ready. Sign in to complete required personal information and upload documents for Admin approval.',
          type: needsRegistrationApproval ? 'registration' : 'onboarding',
          requestStatus: needsRegistrationApproval ? 'Pending' : 'Not Started',
          actionUrl: needsRegistrationApproval ? '/login' : '/employee/onboarding',
        },
      ];
      if (needsRegistrationApproval) {
        const admins = await User.find({ role: 'Admin', isActive: true }).select('_id').lean();
        notifications.push(...admins.map(admin => ({
          userId: admin._id,
          employeeId: employee.employeeId,
          title: 'Employee registration approval pending',
          message: `${employee.name} (${emailLower}) was registered by HR and is awaiting Stage 1 approval.`,
          type: 'registration',
          requestStatus: 'Pending',
          actionUrl: '/registrations',
        })));
      }
      const createdNotifications = await Notification.insertMany(notifications);
      createdNotifications.forEach(notification => publishNotification(notification.userId, notification.toObject()));
    }
    await notifyDirectoryChange(loginAccount);
    if (managerResult.manager) {
      await notifyReportingChange({
        employee,
        account: loginAccount,
        manager: managerResult.manager,
        previousManagerId: null,
      });
    }

    res.status(201).json({
      success: true,
      data: employee,
      account: {
        employeeId: employee.employeeId,
        email: emailLower,
        role: loginAccount.role,
        hasPassword: Boolean(initialPassword),
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'An employee with this email or employee ID already exists' });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/employees/:id  (admin/HR)
//  Employees update only their own permitted fields via a separate endpoint.
// ─────────────────────────────────────────────────────────────────────────────
const updateEmployee = async (req, res) => {
  try {
    const data = normalizeEmployeeData(req.body);
    const employee = await Employee.findOne({ _id: req.params.id, isDraft: { $ne: true } });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    if (req.user.role === 'Manager') {
      const team = await managerAssignedEmployees(req.user);
      if (!team.some(member => String(member._id) === String(employee._id))) {
        return res.status(403).json({ success: false, message: 'You may only update employees assigned to your team.' });
      }
    }

    const managerFieldChanged = req.body.managerUserId !== undefined
      || (req.body.manager !== undefined && String(req.body.manager || '').trim() !== String(employee.manager || '').trim());
    if (managerFieldChanged) {
      if (!['Admin', 'HR'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: req.user.role === 'Manager'
            ? 'Use Team Management to update reporting relationships.'
            : 'Only Admin or HR can update reporting relationships.',
        });
      }
      const managerResult = await resolveManagerReference(req.body.managerUserId, req.body.manager);
      if (managerResult.error) return res.status(400).json({ success: false, message: managerResult.error });
      if (managerResult.manager) {
        const account = employee.userId
          ? await User.findById(employee.userId).select('role')
          : await User.findOne({ $or: [{ employeeRef: employee._id }, { email: employee.email }] }).select('role');
        if (account && account.role !== 'Employee') {
          return res.status(400).json({ success: false, message: 'Only Employee accounts can be assigned to a Manager team.' });
        }
      }
      data.reportingManagerId = managerResult.manager?._id || null;
      data.manager = managerResult.manager?.name || '';
    }
    const previousManager = {
      reportingManagerId: employee.reportingManagerId || null,
      manager: employee.manager || '',
    };
    const previousDepartment = employee.department || '';
    const previousEmail = employee.email;
    const linkedAccount = employee.userId
      ? await User.findById(employee.userId)
      : await User.findOne({ email: previousEmail?.toLowerCase() });

    // Validate duplicate email if it's being changed
    if (data.email) {
      const existing = await Employee.findOne({ email: data.email.toLowerCase(), _id: { $ne: req.params.id } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'An employee with this email already exists' });
      }
      const accountDuplicate = await User.findOne({
        email: data.email.toLowerCase(),
        ...(employee.userId ? { _id: { $ne: employee.userId } } : {}),
      }).select('_id');
      if (accountDuplicate) {
        return res.status(400).json({ success: false, message: 'A login account already uses this email address.' });
      }
    }

    // Validate duplicate employeeId if it's being changed
    if (data.employeeId) {
      const idExists = await Employee.findOne({ employeeId: data.employeeId, _id: { $ne: req.params.id } });
      if (idExists) {
        return res.status(400).json({ success: false, message: 'An employee with this employee ID already exists' });
      }
    }

    Object.assign(employee, data);
    await employee.save();

    // Keep the linked User in sync
    if (linkedAccount) {
      linkedAccount.name = employee.name;
      linkedAccount.email = employee.email;
      linkedAccount.employeeId = employee.employeeId;
      linkedAccount.department = employee.department;
      linkedAccount.designation = employee.designation || employee.position || '';
      await linkedAccount.save();
    }
    if (previousDepartment !== (employee.department || '')) {
      await ActivityLog.create({
        userId: req.user._id,
        userName: req.user.name,
        userRole: req.user.role,
        employeeId: employee.employeeId || '',
        module: 'Employees',
        action: 'Employee department updated',
        recordId: String(employee._id),
        previousValue: { department: previousDepartment },
        updatedValue: { department: employee.department || '' },
      });
      await notifyDirectoryChange(
        linkedAccount || { employeeId: employee.employeeId, name: employee.name, role: 'Employee' },
        `${employee.name}'s department was updated to ${employee.department || 'Unassigned'}.`
      );
    }
    if (data.reportingManagerId !== undefined
      && String(previousManager.reportingManagerId || '') !== String(employee.reportingManagerId || '')) {
      const newManager = employee.reportingManagerId
        ? await User.findById(employee.reportingManagerId).select('name').lean()
        : null;
      await ActivityLog.create({
        userId: req.user._id,
        userName: req.user.name,
        userRole: req.user.role,
        employeeId: employee.employeeId || '',
        module: 'Employees',
        action: 'Employee reporting relationship updated',
        recordId: String(employee._id),
        previousValue: previousManager,
        updatedValue: {
          reportingManagerId: employee.reportingManagerId || null,
          manager: employee.manager || '',
        },
      });
      await notifyReportingChange({
        employee,
        account: linkedAccount,
        manager: newManager,
        previousManagerId: previousManager.reportingManagerId,
      });
    }

    res.json({ success: true, data: employee });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'An employee with this email or employee ID already exists' });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/employees/:id/status  (admin/HR) — activate/deactivate
// ─────────────────────────────────────────────────────────────────────────────
const setEmployeeStatus = async (req, res) => {
  try {
    if (!['Admin', 'HR'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only Admin or HR can change employment status.' });
    }
    const { status } = req.body;
    if (!['active', 'inactive', 'on-leave'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be active, inactive, or on-leave' });
    }

    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!employee) {
      const account = await User.findOne({ _id: req.params.id, role: 'Employee' });
      if (!account) return res.status(404).json({ success: false, message: 'Employee not found' });
      if (status === 'on-leave') {
        return res.status(400).json({ success: false, message: 'Create and link an employee profile before setting an account-only record to on leave.' });
      }
      account.isActive = status === 'active';
      account.accountStatus = status === 'active' ? 'active' : 'suspended';
      await account.save();
      return res.json({ success: true, data: employeeRecordFromAccount(account.toObject()) });
    }

    // Also deactivate the linked User account when employee is set inactive
    if (employee.userId) {
      if (status === 'inactive') {
        await User.findByIdAndUpdate(employee.userId, { isActive: false });
      } else {
        await User.findByIdAndUpdate(employee.userId, { isActive: true });
      }
    }

    res.json({ success: true, data: employee });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/employees/:id  (admin/HR)
// ─────────────────────────────────────────────────────────────────────────────
const deleteEmployee = async (req, res) => {
  try {
    if (!['Admin', 'HR'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only Admin or HR can delete employee records.' });
    }
    const employee = await Employee.findByIdAndDelete(req.params.id);
    if (!employee) {
      const account = await User.findOne({ _id: req.params.id, role: 'Employee' });
      if (!account) return res.status(404).json({ success: false, message: 'Employee not found' });
      account.isActive = false;
      account.accountStatus = 'suspended';
      await account.save();
      return res.json({ success: true, message: 'Employee login account deactivated successfully' });
    }
    // Deactivate and unlink the associated login account so a deleted employee
    // can no longer sign in, without hard-deleting their audit trail.
    if (employee.userId) {
      await User.findByIdAndUpdate(employee.userId, { employeeRef: null, isActive: false });
    } else {
      // Fall back to matching by email if the link was never set
      await User.findOneAndUpdate({ email: employee.email?.toLowerCase() }, { employeeRef: null, isActive: false });
    }
    res.json({ success: true, message: 'Employee deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getEmployees,
  getEmployeeById,
  getMyEmployeeRecord,
  getEmployeeOptions,
  getTeam,
  setReportingManager,
  getEmployeeAccounts,
  linkEmployeeAccountRecord,
  createEmployee,
  updateEmployee,
  setEmployeeStatus,
  deleteEmployee,
  getDrafts,
  getDraftById,
  saveDraft,
  deleteDraft,
};
