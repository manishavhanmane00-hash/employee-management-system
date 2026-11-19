const Leave = require('../models/Leave');
const Notification = require('../models/Notification');
const Attendance = require('../models/Attendance');
const Payroll = require('../models/Payroll');
const ActivityLog = require('../models/ActivityLog');
const CentralRequest = require('../models/CentralRequest');
const LeaveAllocation = require('../models/LeaveAllocation');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Holiday = require('../models/Holiday');
const HolidayAttendance = require('../models/HolidayAttendance');
const mongoose = require('mongoose');
const { resolveRequestIdentity, managerTeamConditions } = require('../services/employeeIdentity');
const { findAssignedHolidayForDate, findAttendanceDateLock } = require('../services/attendanceLocks');
const { recordRequest, syncRequestDecision, createUserNotification } = require('../services/centralRequestService');

const LEAVE_ENTITLEMENT = {
  'Annual Leave': 18,
  'Sick Leave': 10,
  'Casual Leave': 6,
  'Maternity Leave': 90,
  'Paternity Leave': 10,
  'Compensatory Leave': 5,
  'Unpaid Leave': 0,
};

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const dateRange = (startDate, endDate) => {
  const dates = [];
  for (let timestamp = Date.parse(`${startDate}T00:00:00Z`), end = Date.parse(`${endDate}T00:00:00Z`);
    timestamp <= end;
    timestamp += 86400000) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
  }
  return dates;
};

const ownerConditions = identity => [
  ...(identity.userId ? [{ userId: identity.userId }] : []),
  ...(identity.employeeId ? [{ employeeId: String(identity.employeeId) }] : []),
  ...(identity.email ? [{ email: identity.email }] : []),
];

const leavePayStatus = leave => leave.paidStatus || (leave.leaveType === 'Unpaid Leave' ? 'Unpaid' : 'Paid');
const PAID_LEAVE_TYPES = Object.keys(LEAVE_ENTITLEMENT).filter(type => LEAVE_ENTITLEMENT[type] > 0);

const leaveDaysWithinRange = (leave, startDate, endDate, holidayDates = null) => {
  const start = startDate && leave.startDate < startDate ? startDate : leave.startDate;
  const end = endDate && leave.endDate > endDate ? endDate : leave.endDate;
  if (end < start) return 0;
  return dateRange(start, end).filter(date => !holidayDates?.has(date)).length;
};

const findPayrollForLeave = async (leave) => {
  const dates = dateRange(leave.startDate, leave.endDate);
  const periods = [...new Set(dates.map(date => `${date.slice(0, 4)}-${date.slice(5, 7)}`))];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const periodConditions = periods.map(period => {
    const [year, month] = period.split('-').map(Number);
    return { month: monthNames[month - 1], year };
  });
  const identityConditions = [
    ...(leave.employeeId ? [{ employeeId: leave.employeeId }] : []),
    ...(leave.userId ? [{ userId: leave.userId }] : []),
    ...(leave.email ? [{ email: leave.email }] : []),
  ];
  if (!periodConditions.length || !identityConditions.length) return [];
  return Payroll.find({
    $and: [
      { $or: periodConditions },
      { $or: identityConditions },
    ],
  }).select('month year').lean();
};

const leaveResponse = leave => {
  const data = leave.toObject ? leave.toObject() : { ...leave };
  data.paidStatus = leavePayStatus(data);
  if (data.supportingDocument) delete data.supportingDocument.data;
  return data;
};

const getLeaveBalance = async (userId, leaveType, excludeLeaveId = null) => {
  const entitlement = LEAVE_ENTITLEMENT[leaveType];
  if (entitlement === undefined || !userId) return null;
  const conditions = [{ userId: new mongoose.Types.ObjectId(userId) }];
  const account = await User.findById(userId).select('email employeeId employeeRef').lean();
  if (account?.employeeId) conditions.push({ employeeId: account.employeeId });
  if (account?.email) conditions.push({ email: account.email });
  const allocation = leaveType === 'Unpaid Leave'
    ? null
    : await LeaveAllocation.findOne({ userId, leaveType }).lean();
  const totalAllocated = leaveType === 'Unpaid Leave' ? 0 : (allocation?.allocatedDays ?? entitlement);
  const records = await Leave.find({
    $or: conditions,
    leaveType,
    status: { $in: ['approved', 'pending'] },
    ...(excludeLeaveId ? { _id: { $ne: excludeLeaveId } } : {}),
  }).select('days status paidStatus leaveType').lean();
  const approvedPaid = records
    .filter(record => record.status === 'approved' && leavePayStatus(record) === 'Paid')
    .reduce((sum, record) => sum + Number(record.days || 0), 0);
  const approvedUnpaid = records
    .filter(record => record.status === 'approved' && leavePayStatus(record) === 'Unpaid')
    .reduce((sum, record) => sum + Number(record.days || 0), 0);
  const pendingPaid = records
    .filter(record => record.status === 'pending' && leavePayStatus(record) === 'Paid')
    .reduce((sum, record) => sum + Number(record.days || 0), 0);
  const pendingUnpaid = records
    .filter(record => record.status === 'pending' && leavePayStatus(record) === 'Unpaid')
    .reduce((sum, record) => sum + Number(record.days || 0), 0);
  return {
    entitlement,
    totalAllocated,
    used: approvedPaid,
    approved: approvedPaid + approvedUnpaid,
    approvedPaid,
    approvedUnpaid,
    pending: pendingPaid + pendingUnpaid,
    pendingPaid,
    pendingUnpaid,
    unpaidDays: approvedUnpaid,
    remaining: Math.max(0, totalAllocated - approvedPaid),
  };
};

const getLeave = async (req, res) => {
  try {
    const { status, employeeId, leaveType } = req.query;
    const filter = {};
    if (['Admin', 'HR'].includes(req.user.role)) {
      if (employeeId) filter.employeeId = employeeId;
    } else if (req.user.role === 'Manager') {
      filter.$or = await managerTeamConditions(req.user);
      if (employeeId) filter.employeeId = employeeId;
    } else {
      const owner = ownerConditions({
        userId: req.user.id,
        employeeId: req.user.employeeId,
        email: req.user.email,
      });
      filter.$or = owner;
    }
    if (status) filter.status = status;
    if (leaveType) filter.leaveType = leaveType;

    const records = await Leave.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: records.length, data: records.map(leaveResponse) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBalances = async (req, res) => {
  try {
    const { leaveType, role, department, employeeId, userId, search, fromDate, toDate } = req.query;
    if ((fromDate && !validDate(fromDate)) || (toDate && !validDate(toDate)) || (fromDate && toDate && fromDate > toDate)) {
      return res.status(400).json({ success: false, message: 'Enter a valid leave balance date range.' });
    }

    if (req.user.role === 'Admin') {
      if (role && !['Employee', 'HR', 'Manager'].includes(role)) {
        return res.status(400).json({ success: false, message: 'Filter role must be Employee, HR, or Manager.' });
      }
      if (leaveType && !Object.prototype.hasOwnProperty.call(LEAVE_ENTITLEMENT, leaveType)) {
        return res.status(400).json({ success: false, message: 'Select a valid leave type.' });
      }
      const users = await User.find({
        isActive: true,
        role: role ? { $in: [role] } : { $in: ['Employee', 'HR', 'Manager'] },
      }).select('name email employeeId role designation department employeeRef').sort({ name: 1 }).lean();
      const profiles = await Employee.find({
        isDraft: { $ne: true },
        status: 'active',
        $or: [
          { userId: { $in: users.map(account => account._id) } },
          { _id: { $in: users.map(account => account.employeeRef).filter(Boolean) } },
          { email: { $in: users.map(account => account.email).filter(Boolean) } },
        ],
      }).select('userId email employeeId name department designation position').lean();
      const profileByUser = new Map(profiles.filter(profile => profile.userId).map(profile => [String(profile.userId), profile]));
      const profileById = new Map(profiles.map(profile => [String(profile._id), profile]));
      const profileByEmail = new Map(profiles.filter(profile => profile.email).map(profile => [profile.email.toLowerCase(), profile]));
      const candidates = users.map(account => {
        const linkedProfile = profileByUser.get(String(account._id));
        const referencedProfile = profileById.get(String(account.employeeRef));
        const emailProfile = account.email ? profileByEmail.get(account.email.toLowerCase()) : null;
        const linked = [linkedProfile, referencedProfile, emailProfile].filter(Boolean);
        if (linked.some(profile => String(profile._id) !== String(linked[0]._id))) {
          throw new Error(`Account ${account._id} has conflicting employee mappings; correct the mapping before viewing leave balances.`);
        }
        const profile = linked[0] || null;
        if (profile?.userId && String(profile.userId) !== String(account._id)) {
          throw new Error(`Employee record ${profile.employeeId} is linked to another account.`);
        }
        return {
          account,
          profile,
          userId: account._id,
          employeeId: profile?.employeeId || account.employeeId || '',
          name: profile?.name || account.name,
          role: account.role,
          department: profile?.department || account.department || '',
          designation: profile?.designation || profile?.position || account.designation || account.role,
        };
      }).filter(record =>
        (!userId || String(record.userId) === String(userId))
        && (!employeeId || record.employeeId === employeeId)
        && (!department || record.department === department)
        && (!search || [record.name, record.employeeId, record.department, record.designation, record.role]
          .some(value => String(value || '').toLowerCase().includes(String(search).toLowerCase())))
      );
      const userIds = candidates.map(record => record.userId);
      const legacyConditions = candidates.flatMap(record => [
        { userId: record.userId },
        ...(record.employeeId ? [{ employeeId: record.employeeId }] : []),
        ...(record.account.email ? [{ email: record.account.email }] : []),
      ]);
      const [allocations, requests] = await Promise.all([
        LeaveAllocation.find({ userId: { $in: userIds } }).lean(),
        legacyConditions.length ? Leave.find({
          $or: legacyConditions,
          status: { $in: ['approved', 'pending'] },
          ...(leaveType ? { leaveType } : {}),
          ...(fromDate || toDate ? {
            startDate: { $lte: toDate || '9999-12-31' },
            endDate: { $gte: fromDate || '0000-01-01' },
          } : {}),
        }).select('userId employeeId email leaveType paidStatus status days startDate endDate').lean() : [],
      ]);
      const occurrenceIdentities = [
        { userId: { $in: userIds } },
        ...(candidates.some(record => record.employeeId)
          ? [{ employeeId: { $in: candidates.map(record => record.employeeId).filter(Boolean) } }]
          : []),
      ];
      const holidayOccurrences = await HolidayAttendance.find({
        date: { $gte: fromDate || '0000-01-01', $lte: toDate || '9999-12-31' },
        $or: occurrenceIdentities,
      }).select('holidayId userId employeeId date').lean();
      const activeHolidayIds = holidayOccurrences.length
        ? await Holiday.distinct('_id', {
          _id: { $in: holidayOccurrences.map(item => item.holidayId) },
          status: 'active',
        })
        : [];
      const activeHolidayIdSet = new Set(activeHolidayIds.map(String));
      const holidayDatesByIdentity = new Map();
      for (const occurrence of holidayOccurrences) {
        if (!activeHolidayIdSet.has(String(occurrence.holidayId))) continue;
        for (const identity of [
          occurrence.userId ? String(occurrence.userId) : '',
          occurrence.employeeId || '',
        ].filter(Boolean)) {
          if (!holidayDatesByIdentity.has(identity)) holidayDatesByIdentity.set(identity, new Set());
          holidayDatesByIdentity.get(identity).add(occurrence.date);
        }
      }
      const allocationByUserAndType = new Map(allocations.map(item => [`${item.userId}:${item.leaveType}`, item.allocatedDays]));
      const rows = candidates.map(record => {
        const userHolidayDates = new Set([
          ...(holidayDatesByIdentity.get(String(record.userId)) || []),
          ...(holidayDatesByIdentity.get(record.employeeId) || []),
        ]);
        const userRequests = requests.filter(request =>
          (request.userId && String(request.userId) === String(record.userId))
          || (request.employeeId && request.employeeId === record.employeeId)
          || (request.email && request.email === record.account.email)
        );
        const types = leaveType ? [leaveType] : Object.keys(LEAVE_ENTITLEMENT);
        const balances = types.map(type => {
          const typeRequests = userRequests.filter(item => item.leaveType === type);
          const approvedPaid = typeRequests
            .filter(item => item.status === 'approved' && leavePayStatus(item) === 'Paid')
            .reduce((sum, item) => sum + leaveDaysWithinRange(item, fromDate, toDate, userHolidayDates), 0);
          const approvedUnpaid = typeRequests
            .filter(item => item.status === 'approved' && leavePayStatus(item) === 'Unpaid')
            .reduce((sum, item) => sum + leaveDaysWithinRange(item, fromDate, toDate, userHolidayDates), 0);
          const pendingPaid = typeRequests
            .filter(item => item.status === 'pending' && leavePayStatus(item) === 'Paid')
            .reduce((sum, item) => sum + leaveDaysWithinRange(item, fromDate, toDate, userHolidayDates), 0);
          const pendingUnpaid = typeRequests
            .filter(item => item.status === 'pending' && leavePayStatus(item) === 'Unpaid')
            .reduce((sum, item) => sum + leaveDaysWithinRange(item, fromDate, toDate, userHolidayDates), 0);
          const allocated = type === 'Unpaid Leave'
            ? 0
            : (allocationByUserAndType.get(`${record.userId}:${type}`) ?? LEAVE_ENTITLEMENT[type]);
          return {
            leaveType: type,
            entitlement: LEAVE_ENTITLEMENT[type],
            totalAllocated: allocated,
            used: approvedPaid,
            approved: approvedPaid + approvedUnpaid,
            approvedPaid,
            approvedUnpaid,
            pending: pendingPaid + pendingUnpaid,
            pendingPaid,
            pendingUnpaid,
            unpaidDays: approvedUnpaid,
            remaining: type === 'Unpaid Leave' ? 'Unlimited' : Math.max(0, allocated - approvedPaid),
          };
        });
        const paidBalances = balances.filter(item => item.leaveType !== 'Unpaid Leave');
        return {
          userId: record.userId,
          employeeId: record.employeeId,
          name: record.name,
          department: record.department,
          designation: record.designation,
          role: record.role,
          leaves: balances,
          totalAllocated: paidBalances.reduce((sum, item) => sum + item.totalAllocated, 0),
          used: paidBalances.reduce((sum, item) => sum + item.approvedPaid, 0),
          approved: balances.reduce((sum, item) => sum + item.approved, 0),
          pending: balances.reduce((sum, item) => sum + item.pending, 0),
          remaining: paidBalances.reduce((sum, item) => sum + Number(item.remaining || 0), 0),
          paidLeaveBalance: paidBalances.reduce((sum, item) => sum + Number(item.remaining || 0), 0),
          approvedUnpaid: balances.reduce((sum, item) => sum + item.approvedUnpaid, 0),
          pendingUnpaid: balances.reduce((sum, item) => sum + item.pendingUnpaid, 0),
        };
      });
      return res.json({ success: true, count: rows.length, data: rows });
    }

    if (role || department || employeeId || userId || search) {
      return res.status(403).json({ success: false, message: 'You may only view your own leave balance.' });
    }
    const identity = await resolveRequestIdentity(req.user.dbUser || req.user);
    if (identity.error) return res.status(409).json({ success: false, message: identity.error });
    const balances = [];
    for (const [type, entitlement] of Object.entries(LEAVE_ENTITLEMENT)) {
      const balance = await getLeaveBalance(identity.account._id, type);
      balances.push({
        leaveType: type,
        entitlement,
        totalAllocated: balance?.totalAllocated ?? entitlement,
        used: balance?.used || 0,
        approved: balance?.approved || 0,
        approvedPaid: balance?.approvedPaid || 0,
        approvedUnpaid: balance?.approvedUnpaid || 0,
        pending: balance?.pending || 0,
        pendingPaid: balance?.pendingPaid || 0,
        pendingUnpaid: balance?.pendingUnpaid || 0,
        unpaidDays: balance?.unpaidDays || 0,
        remaining: type === 'Unpaid Leave' ? 'Unlimited' : (balance?.remaining ?? entitlement),
      });
    }
    res.json({ success: true, data: balances });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateLeaveAllocations = async (req, res) => {
  try {
    if (req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Only Admin can configure leave allocations.' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ success: false, message: 'A valid user account is required.' });
    }
    if (!Array.isArray(req.body.allocations)) {
      return res.status(400).json({ success: false, message: 'Leave allocations must be provided as a list.' });
    }
    const account = await User.findOne({
      _id: req.params.userId,
      isActive: true,
      role: { $in: ['Employee', 'HR', 'Manager'] },
    });
    if (!account) return res.status(404).json({ success: false, message: 'Active Employee, HR, or Manager account not found.' });
    const balanceRecord = await getAdminBalanceIdentity(account);
    if (!balanceRecord) return res.status(409).json({ success: false, message: 'Unable to resolve this account identity.' });

    const seenTypes = new Set();
    const updates = [];
    for (const allocation of req.body.allocations) {
      if (!PAID_LEAVE_TYPES.includes(allocation.leaveType) || seenTypes.has(allocation.leaveType)) {
        return res.status(400).json({ success: false, message: 'Each paid leave type must be valid and appear only once.' });
      }
      const allocatedDays = Number(allocation.allocatedDays);
      if (!Number.isFinite(allocatedDays) || allocatedDays < 0 || allocatedDays > 366) {
        return res.status(400).json({ success: false, message: 'Allocated leave days must be between 0 and 366.' });
      }
      seenTypes.add(allocation.leaveType);
      updates.push({ leaveType: allocation.leaveType, allocatedDays });
    }
    if (!updates.length) return res.status(400).json({ success: false, message: 'Provide at least one paid leave allocation.' });

    const saved = [];
    for (const update of updates) {
      const existing = await LeaveAllocation.findOne({ userId: account._id, leaveType: update.leaveType });
      const previousDays = existing?.allocatedDays ?? LEAVE_ENTITLEMENT[update.leaveType];
      const history = {
        previousDays,
        allocatedDays: update.allocatedDays,
        action: existing ? 'Updated' : 'Created',
        performedBy: req.user._id,
        performedByName: req.user.name,
        comment: String(req.body.comment || '').trim().slice(0, 500),
      };
      const fields = {
        userId: account._id,
        employeeId: balanceRecord.employeeId || null,
        employeeName: balanceRecord.name,
        role: account.role,
        department: balanceRecord.department || '',
        leaveType: update.leaveType,
        allocatedDays: update.allocatedDays,
        updatedBy: req.user._id,
      };
      const record = existing
        ? await LeaveAllocation.findOneAndUpdate(
          { _id: existing._id },
          { $set: fields, $push: { history } },
          { new: true, runValidators: true }
        )
        : await LeaveAllocation.create({ ...fields, history: [history] });
      saved.push(record);
    }
    try {
      await ActivityLog.create({
        userId: req.user._id,
        userName: req.user.name,
        userRole: req.user.role,
        employeeId: balanceRecord.employeeId || '',
        module: 'Leave',
        action: 'Leave allocation updated',
        recordId: account._id.toString(),
        previousValue: null,
        updatedValue: saved.map(record => record.toObject()),
      });
    } catch (error) {
      console.error(`[Leave allocation ${account._id}] Activity log failed:`, error.message);
    }
    await createUserNotification(account._id, {
      employeeId: balanceRecord.employeeId || '',
      title: 'Leave allocation updated',
      message: 'Your paid leave allocations have been updated by Admin.',
      type: 'leave',
    });
    res.json({ success: true, data: saved });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAdminBalanceIdentity = async account => {
  const profiles = await Employee.find({
    isDraft: { $ne: true },
    status: 'active',
    $or: [
      { userId: account._id },
      ...(account.employeeRef ? [{ _id: account.employeeRef }] : []),
      ...(account.email ? [{ email: account.email.toLowerCase() }] : []),
    ],
  }).select('userId employeeId name department designation position').lean();
  const matchedByUser = profiles.find(profile => String(profile.userId) === String(account._id));
  const matchedByRef = profiles.find(profile => account.employeeRef && String(profile._id) === String(account.employeeRef));
  if (matchedByUser && matchedByRef && String(matchedByUser._id) !== String(matchedByRef._id)) {
    throw new Error(`Account ${account._id} has conflicting employee mappings.`);
  }
  const profile = matchedByUser || matchedByRef || profiles[0] || null;
  if (profiles.some(item => String(item._id) !== String(profile?._id))) {
    throw new Error(`Account ${account._id} matches multiple employee records.`);
  }
  if (profile?.userId && String(profile.userId) !== String(account._id)) {
    throw new Error(`Employee record ${profile.employeeId} is linked to another account.`);
  }
  return {
    employeeId: profile?.employeeId || account.employeeId || '',
    name: profile?.name || account.name,
    department: profile?.department || account.department || '',
  };
};

const applyLeave = async (req, res) => {
  let createdLeave = null;
  try {
    if (!['Employee', 'HR', 'Manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only Employee, HR, and Manager accounts can submit leave requests.' });
    }
    const { leaveType, startDate, endDate, reason = '', paidStatus, supportingDocument } = req.body;
    if (!Object.prototype.hasOwnProperty.call(LEAVE_ENTITLEMENT, leaveType)) {
      return res.status(400).json({ success: false, message: 'Select a valid leave type.' });
    }
    if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) {
      return res.status(400).json({ success: false, message: 'Enter a valid leave date range.' });
    }
    if (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`) > 365 * 86400000) {
      return res.status(400).json({ success: false, message: 'A leave request cannot exceed 366 calendar days.' });
    }
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) {
      return res.status(400).json({ success: false, message: 'Provide a reason of no more than 1000 characters.' });
    }
    const category = paidStatus || (leaveType === 'Unpaid Leave' ? 'Unpaid' : 'Paid');
    if (!['Paid', 'Unpaid'].includes(category) || (leaveType === 'Unpaid Leave' && category !== 'Unpaid')) {
      return res.status(400).json({ success: false, message: 'Choose a valid Paid or Unpaid category.' });
    }

    let documentData;
    if (supportingDocument != null) {
      const { name, mimeType, data } = supportingDocument;
      const match = typeof data === 'string'
        ? data.match(/^data:(application\/pdf|image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/)
        : null;
      if (typeof name !== 'string' || !name.trim() || name.length > 200 || !match) {
        return res.status(400).json({ success: false, message: 'Supporting documents must be a PDF, PNG, or JPEG file.' });
      }
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 4 * 1024 * 1024 || buffer.toString('base64') !== match[2]) {
        return res.status(400).json({ success: false, message: 'Supporting document must not exceed 4 MB and must be valid base64 data.' });
      }
      if (mimeType !== match[1]) {
        return res.status(400).json({ success: false, message: 'Supporting document type does not match its file contents.' });
      }
      const signatureMatches = mimeType === 'application/pdf'
        ? buffer.subarray(0, 5).toString('ascii') === '%PDF-'
        : mimeType === 'image/png'
          ? buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
          : buffer.subarray(0, 3).toString('hex') === 'ffd8ff';
      if (!signatureMatches) {
        return res.status(400).json({ success: false, message: 'Supporting document contents do not match the selected file type.' });
      }
      documentData = { name: name.trim(), mimeType, size: buffer.length, data };
    }

    const identity = await resolveRequestIdentity(req.user.dbUser || req.user);
    if (identity.error) return res.status(409).json({ success: false, message: identity.error });
    const account = identity.account;
    const dates = dateRange(startDate, endDate);
    if (dates.length > 366) return res.status(400).json({ success: false, message: 'A leave request cannot exceed 366 calendar days.' });
    const identityForChecks = {
      userId: account._id,
      employeeId: identity.employee?.employeeId || null,
      email: account.email,
    };
    const overlapping = await Leave.findOne({
      $or: ownerConditions(identityForChecks),
      status: { $in: ['pending', 'approved'] },
      startDate: { $lte: endDate },
      endDate: { $gte: startDate },
    });
    if (overlapping) {
      return res.status(409).json({
        success: false,
        message: `You already have a ${overlapping.status} leave request (${overlapping.startDate} to ${overlapping.endDate}) that overlaps these dates.`,
      });
    }

    for (const date of dates) {
      const holiday = await findAssignedHolidayForDate({ ...identityForChecks, date });
      if (holiday) {
        return res.status(409).json({ success: false, message: `${date} is an assigned holiday and cannot be included in a leave request.` });
      }
    }

    if (category === 'Paid' && LEAVE_ENTITLEMENT[leaveType] > 0) {
      const balance = await getLeaveBalance(account._id, leaveType);
      if (balance && balance.remaining < dates.length) {
        return res.status(400).json({
          success: false,
          message: `Insufficient ${leaveType} balance. Available: ${balance.remaining} day(s), requested: ${dates.length}.`,
        });
      }
    }

    createdLeave = await Leave.create({
      employeeId: identity.employee?.employeeId || null,
      userId: account._id,
      email: account.email || '',
      employeeName: account.name,
      department: identity.employee?.department || account.department || '',
      leaveType,
      paidStatus: category,
      startDate,
      endDate,
      days: dates.length,
      reason: reason.trim(),
      supportingDocument: documentData,
      status: 'pending',
      appliedDate: new Date().toISOString().slice(0, 10),
      history: [{
        status: 'pending',
        action: 'Submitted',
        performedBy: account._id,
        performedByName: account.name,
      }],
    });

    try {
      await recordRequest({
        user: account,
        employeeId: createdLeave.employeeId,
        requestType: 'Leave',
        details: {
          leaveType,
          paidStatus: category,
          startDate,
          endDate,
          days: dates.length,
          reason: reason.trim(),
          supportingDocument: documentData ? { name: documentData.name, mimeType: documentData.mimeType, size: documentData.size } : null,
        },
        sourceModel: 'Leave',
        sourceId: createdLeave._id,
      });
    } catch (error) {
      const requestExists = await CentralRequest.exists({
        sourceModel: 'Leave',
        sourceId: createdLeave._id,
      });
      if (!requestExists) {
        await createdLeave.deleteOne();
        createdLeave = null;
      }
      throw error;
    }
    res.status(201).json({ success: true, data: leaveResponse(createdLeave) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateLeaveStatus = async (req, res) => {
  try {
    if (!['Admin', 'HR'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only Admin or HR can review leave requests.' });
    }
    const { status, rejectionReason = '' } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be approved or rejected.' });
    }
    if (typeof rejectionReason !== 'string' || rejectionReason.length > 1000) {
      return res.status(400).json({ success: false, message: 'Rejection reason must be text of no more than 1000 characters.' });
    }
    const leave = await Leave.findById(req.params.id);
    if (!leave) return res.status(404).json({ success: false, message: 'Leave request not found.' });
    if (leave.status !== 'pending') {
      return res.status(409).json({ success: false, message: `This request is already ${leave.status}.` });
    }
    if (leave.userId && String(leave.userId) === String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'You cannot review your own leave request.' });
    }

    const identity = { userId: leave.userId, employeeId: leave.employeeId, email: leave.email };
    const dates = dateRange(leave.startDate, leave.endDate);
    if (status === 'approved') {
      if (leavePayStatus(leave) === 'Paid' && LEAVE_ENTITLEMENT[leave.leaveType] > 0 && leave.userId) {
        const balance = await getLeaveBalance(leave.userId, leave.leaveType, leave._id);
        if (balance && balance.remaining < leave.days) {
          return res.status(409).json({ success: false, message: `Cannot approve: only ${balance.remaining} day(s) of ${leave.leaveType} remain.` });
        }
        leave.balanceBefore = balance?.remaining ?? null;
      }

      const payrolls = await findPayrollForLeave(leave);
      if (payrolls.length) {
        return res.status(409).json({ success: false, message: 'Payroll already exists for one or more requested leave dates. Use the approved payroll adjustment workflow before approving retrospective leave.' });
      }

      const snapshots = [];
      for (const date of dates) {
        const lock = await findAttendanceDateLock({ ...identity, date });
        if (lock?.type === 'holiday') {
          return res.status(409).json({ success: false, message: `${date} is an assigned holiday; leave cannot be approved for that date.` });
        }
        if (lock?.type === 'leave') {
          return res.status(409).json({ success: false, message: `${date} is already covered by approved leave.` });
        }
        const conditions = ownerConditions(identity);
        const attendance = conditions.length
          ? await Attendance.findOne({ date, $or: conditions })
          : null;
        if (attendance && (
          attendance.checkIn || attendance.checkOut
          || !['absent', 'leave'].includes(attendance.status)
        )) {
          return res.status(409).json({ success: false, message: `${date} already has attendance recorded and cannot be overwritten by leave.` });
        }
        snapshots.push({
          date,
          existed: Boolean(attendance),
          before: attendance ? {
            _id: attendance._id,
            employeeId: attendance.employeeId,
            userId: attendance.userId,
            name: attendance.name,
            email: attendance.email,
            department: attendance.department,
            status: attendance.status,
            checkIn: attendance.checkIn,
            checkOut: attendance.checkOut,
            breakMinutes: attendance.breakMinutes,
            hours: attendance.hours,
            overtime: attendance.overtime,
            late: attendance.late,
            leaveId: attendance.leaveId,
            leaveType: attendance.leaveType,
            leavePayStatus: attendance.leavePayStatus,
            correctedAt: attendance.correctedAt,
            correctedBy: attendance.correctedBy,
            correctionReason: attendance.correctionReason,
            correctionBefore: attendance.correctionBefore,
          } : null,
        });
      }
      leave.attendanceSnapshot = snapshots;
    }

    const previous = leave.toObject();
    leave.status = status;
    leave.rejectionReason = status === 'rejected' ? rejectionReason.trim() : '';
    leave.approvedBy = req.user.name;
    leave.approvedAt = new Date();
    leave.history.push({
      status,
      action: status === 'approved' ? 'Approved' : 'Rejected',
      performedBy: req.user._id,
      performedByName: req.user.name,
      comment: leave.rejectionReason,
    });

    try {
      if (status === 'approved' && leave.employeeId) {
        for (const date of dates) {
          const snapshot = leave.attendanceSnapshot.find(item => item.date === date);
          const query = snapshot?.before?._id
            ? { _id: snapshot.before._id }
            : { employeeId: leave.employeeId, date };
          await Attendance.findOneAndUpdate(query, {
            $set: {
              userId: leave.userId,
              employeeId: leave.employeeId,
              name: leave.employeeName,
              email: leave.email || '',
              department: leave.department || '',
              date,
              status: 'leave',
              leaveId: leave._id,
              leaveType: leave.leaveType,
              leavePayStatus: leavePayStatus(leave),
              checkIn: null,
              checkOut: null,
              hours: 0,
              overtime: 0,
              late: false,
            },
          }, { upsert: true, new: true, runValidators: true });
        }
      }
      await leave.save();
    } catch (error) {
      if (status === 'approved' && leave.employeeId) {
        for (const snapshot of leave.attendanceSnapshot || []) {
          if (snapshot.existed && snapshot.before?._id) {
            const { _id, __v, createdAt, updatedAt, ...before } = snapshot.before;
            await Attendance.updateOne({ _id }, { $set: before });
          } else {
            await Attendance.deleteOne({
              employeeId: leave.employeeId,
              date: snapshot.date,
              leaveId: leave._id,
            });
          }
        }
      }
      throw error;
    }

    const centralRequest = await syncRequestDecision({
      sourceModel: 'Leave',
      sourceId: leave._id,
      status: status === 'approved' ? 'Approved' : 'Rejected',
      actor: req.user,
      comment: leave.rejectionReason,
    });
    if (!centralRequest && leave.userId) {
      await Notification.create({
        userId: leave.userId,
        employeeId: leave.employeeId || '',
        title: `Leave ${status === 'approved' ? 'Approved' : 'Rejected'}`,
        message: `Your ${leave.leaveType} (${leavePayStatus(leave)} Leave) request (${leave.startDate} – ${leave.endDate}) has been ${status}${leave.rejectionReason ? `: ${leave.rejectionReason}` : ''}`,
        type: 'leave',
      });
    }
    try {
      await ActivityLog.create({
        userId: req.user._id,
        userName: req.user.name,
        userRole: req.user.role,
        employeeId: leave.employeeId || '',
        module: 'Leave',
        action: `Leave request ${status}`,
        recordId: leave._id.toString(),
        previousValue: previous,
        updatedValue: leave.toObject(),
      });
    } catch (error) {
      console.error(`[Leave ${leave._id}] Activity log failed:`, error.message);
    }
    res.json({ success: true, data: leaveResponse(leave) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const cancelLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);
    if (!leave) return res.status(404).json({ success: false, message: 'Leave request not found.' });
    const isOwner = (leave.userId && String(leave.userId) === String(req.user.id))
      || (leave.email && leave.email === req.user.email);
    if (!isOwner && req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'You can only cancel your own leave request.' });
    }
    if (leave.status === 'approved' && req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Only Admin can revoke approved leave.' });
    }
    if (!['pending', 'approved'].includes(leave.status)) {
      return res.status(409).json({ success: false, message: `This request is already ${leave.status}.` });
    }

    const previous = leave.toObject();
    const wasApproved = leave.status === 'approved';
    if (wasApproved && (await findPayrollForLeave(leave)).length) {
      return res.status(409).json({ success: false, message: 'Payroll already exists for one or more approved leave dates. Use the approved payroll adjustment workflow before revoking this leave.' });
    }
    if (wasApproved && leave.employeeId) {
      for (const snapshot of leave.attendanceSnapshot || []) {
        const current = await Attendance.findOne({
          leaveId: leave._id,
          date: snapshot.date,
        });
        if (!current) continue;
        if (snapshot.existed && snapshot.before) {
          const { _id, __v, createdAt, updatedAt, ...before } = snapshot.before;
          current.set(before);
        } else {
          current.status = 'absent';
          current.checkIn = null;
          current.checkOut = null;
          current.hours = 0;
          current.overtime = 0;
          current.late = false;
          current.leaveId = null;
          current.leaveType = '';
          current.leavePayStatus = null;
        }
        current.correctedAt = new Date();
        current.correctedBy = req.user.name;
        current.correctionReason = 'Approved leave revoked by Admin';
        current.correctionBefore = {
          status: 'leave',
          leaveId: leave._id,
          leaveType: leave.leaveType,
          leavePayStatus: leavePayStatus(leave),
        };
        await current.save();
      }
    }

    leave.status = 'cancelled';
    leave.cancelledAt = new Date();
    leave.history.push({
      status: 'cancelled',
      action: wasApproved ? 'Revoked' : 'Cancelled',
      performedBy: req.user._id,
      performedByName: req.user.name,
    });
    await leave.save();
    const centralRequest = await syncRequestDecision({
      sourceModel: 'Leave',
      sourceId: leave._id,
      status: 'Cancelled',
      actor: req.user,
      comment: wasApproved ? 'Approved leave revoked by Admin.' : 'Leave request cancelled.',
    });
    if (!centralRequest && leave.userId) {
      await Notification.create({
        userId: leave.userId,
        employeeId: leave.employeeId || '',
        title: wasApproved ? 'Approved Leave Revoked' : 'Leave Request Cancelled',
        message: `Your ${leave.leaveType} request (${leave.startDate} – ${leave.endDate}) was ${wasApproved ? 'revoked' : 'cancelled'}.`,
        type: 'leave',
      });
    }
    try {
      await ActivityLog.create({
        userId: req.user._id,
        userName: req.user.name,
        userRole: req.user.role,
        employeeId: leave.employeeId || '',
        module: 'Leave',
        action: wasApproved ? 'Approved leave revoked' : 'Leave request cancelled',
        recordId: leave._id.toString(),
        previousValue: previous,
        updatedValue: leave.toObject(),
      });
    } catch (error) {
      console.error(`[Leave ${leave._id}] Activity log failed:`, error.message);
    }
    res.json({ success: true, data: leaveResponse(leave), message: 'Leave request cancelled.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const downloadLeaveDocument = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id).select('+supportingDocument.data');
    if (!leave?.supportingDocument?.data) {
      return res.status(404).json({ success: false, message: 'Supporting document not found.' });
    }
    const isOwner = String(leave.userId) === String(req.user.id);
    if (!isOwner && !['Admin', 'HR'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to access this document.' });
    }
    const match = leave.supportingDocument.data.match(/^data:[^;]+;base64,(.+)$/);
    if (!match) return res.status(500).json({ success: false, message: 'The stored supporting document is invalid.' });
    const filename = leave.supportingDocument.name.replace(/[\r\n"]/g, '_');
    res.setHeader('Content-Type', leave.supportingDocument.mimeType);
    res.setHeader('Content-Length', Buffer.byteLength(match[1], 'base64'));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(match[1], 'base64'));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getLeave,
  getBalances,
  applyLeave,
  updateLeaveStatus,
  cancelLeave,
  downloadLeaveDocument,
  getLeaveBalance,
  updateLeaveAllocations,
  LEAVE_ENTITLEMENT,
};
