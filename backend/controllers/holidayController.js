const Holiday = require('../models/Holiday');
const Employee = require('../models/Employee');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const HolidayAttendance = require('../models/HolidayAttendance');
const mongoose = require('mongoose');
const { resolveEmployeeForUser } = require('../services/employeeIdentity');
const { listEmployeeOptions } = require('../services/employeeDirectory');
const { expandHolidayRule, isValidHolidayForm } = require('../services/holidaySync');
const { syncHolidayAttendance } = require('../services/holidayAttendanceSync');

// Human-readable validation message when a submission fails the holidaySync predicate.
const INVALID_HOLIDAY_MESSAGE =
  'Invalid holiday: holidayName and type are required, and a valid rule for the type must be provided ' +
  '(a date for Festival/Custom, a day-of-week for Weekly, or a day-of-month for Monthly).';

/**
 * Normalize an incoming request body into the Holiday_Record shape the model and
 * the holidaySync validation predicate expect. Recurrence day values are coerced
 * to integers (or null) so the pure predicate can validate them.
 */
const buildHolidayPayload = (body = {}) => {
  const {
    holidayName,
    type,
    date,
    startDate,
    endDate,
    recurrence,
    status,
    description,
    paidStatus,
    applicableAll,
    applicableEmployees,
    applicableUserIds,
    employeeId,
    userId,
  } = body;

  const toIntOrNull = (v) =>
    v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v));

  const payload = {
    holidayName: typeof holidayName === 'string' ? holidayName.trim() : holidayName,
    type,
    date: startDate || date || null,
    startDate: startDate || date || null,
    endDate: endDate || null,
    status: status || 'active',
    recurrence: {
      dayOfWeek: toIntOrNull(recurrence ? recurrence.dayOfWeek : null),
      dayOfMonth: toIntOrNull(recurrence ? recurrence.dayOfMonth : null),
    },
  };

  if (status !== undefined) payload.status = status;
  if (description !== undefined) payload.description = (description || '').trim();
  if (paidStatus !== undefined) payload.paidStatus = paidStatus;

  // Applicable_Employees: when not applicable-to-all, store the selected subset by employeeId.
  const isAll = applicableAll === undefined ? true : applicableAll === true;
  payload.applicableAll = isAll;
  if (isAll) {
    payload.applicableEmployees = [];
    payload.applicableUserIds = [];
  } else {
    payload.applicableEmployees = Array.isArray(applicableEmployees)
      ? applicableEmployees.filter((id) => id != null && id !== '').map((id) => String(id))
      : [];
    payload.applicableUserIds = Array.isArray(applicableUserIds)
      ? Array.from(new Set(applicableUserIds.filter(id => id != null && id !== '').map(String)))
      : [];
  }

  if (employeeId !== undefined) payload.employeeId = employeeId;
  if (userId !== undefined) payload.userId = userId;

  return payload;
};

const normalizeEmployeeSelection = async (values = [], allowedRoles = ['Employee', 'HR', 'Manager']) => {
  if (!Array.isArray(values)) {
    return { error: 'Select users from the active employee list.' };
  }
  const requested = Array.from(new Set(values.filter(value => value != null && value !== '').map(String)));
  if (requested.length === 0) return { userIds: [], employeeIds: [] };
  const objectIds = requested.filter(value => mongoose.Types.ObjectId.isValid(value));
  const users = await User.find({
    isActive: true,
    role: { $in: allowedRoles },
    $or: [
      ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
      { employeeId: { $in: requested } },
    ],
  }).select('_id employeeId').lean();
  const mapped = new Map();
  users.forEach(user => {
    mapped.set(String(user._id), user);
    if (user.employeeId) mapped.set(String(user.employeeId), user);
  });
  const missingValues = requested.filter(value => !mapped.has(value));
  const employeeObjectIds = missingValues.filter(value => mongoose.Types.ObjectId.isValid(value));
  if (missingValues.length) {
    const profiles = await Employee.find({
      isDraft: { $ne: true },
      status: 'active',
      $or: [
        { employeeId: { $in: missingValues } },
        ...(employeeObjectIds.length ? [{ _id: { $in: employeeObjectIds } }] : []),
      ],
    }).select('_id employeeId userId email').lean();
    const profileUserIds = profiles.map(profile => profile.userId).filter(Boolean);
    const profileEmails = profiles.map(profile => profile.email).filter(Boolean);
    const linkedUsers = await User.find({
      isActive: true,
      role: { $in: allowedRoles },
      $or: [
        ...(profileUserIds.length ? [{ _id: { $in: profileUserIds } }] : []),
        ...(profileEmails.length ? [{ email: { $in: profileEmails } }] : []),
      ],
    }).select('_id employeeId email').lean();
    const userById = new Map(linkedUsers.map(user => [String(user._id), user]));
    const userByEmail = new Map(linkedUsers.filter(user => user.email).map(user => [user.email.toLowerCase(), user]));
    for (const profile of profiles) {
      const user = (profile.userId && userById.get(String(profile.userId)))
        || (profile.email && userByEmail.get(profile.email.toLowerCase()));
      if (!user) continue;
      mapped.set(String(profile._id), user);
      if (profile.employeeId) mapped.set(String(profile.employeeId), user);
    }
  }
  const selectedUsers = requested.map(value => mapped.get(value)).filter(Boolean);
  if (selectedUsers.length !== requested.length) {
    return { error: 'One or more selected users are missing, inactive, or no longer available. Refresh the list and try again.' };
  }
  const userIds = Array.from(new Set(selectedUsers.map(user => String(user._id))));
  const employees = await Employee.find({
    isDraft: { $ne: true },
    status: 'active',
    userId: { $in: userIds },
  }).select('employeeId userId').lean();
  return {
    userIds,
    employeeIds: Array.from(new Set([
      ...selectedUsers.map(user => user.employeeId).filter(Boolean),
      ...employees.map(employee => employee.employeeId).filter(Boolean),
    ])),
  };
};

const holidayDates = holiday => {
  if (holiday.type === 'Festival' || holiday.type === 'Custom') {
    return expandHolidayRule(holiday, holiday.startDate || holiday.date, holiday.endDate || holiday.startDate || holiday.date);
  }
  return [];
};

const findHolidayAssignmentConflict = async (holiday, excludedId = null) => {
  if (holiday.status !== 'active') return null;
  const dates = holidayDates(holiday);
  if (!dates.length) return null;
  let assignedUserIds = holiday.applicableUserIds || [];
  let assignedEmployeeIds = holiday.applicableEmployees || [];
  if (holiday.applicableAll) {
    const users = await User.find({ isActive: true, role: { $in: ['Employee', 'HR', 'Manager'] } }).select('_id employeeId').lean();
    assignedUserIds = users.map(user => user._id);
    assignedEmployeeIds = users.map(user => user.employeeId).filter(Boolean);
  }
  const identityFilters = [];
  if (assignedUserIds.length) identityFilters.push({ userId: { $in: assignedUserIds } });
  if (assignedEmployeeIds.length) identityFilters.push({ employeeId: { $in: assignedEmployeeIds } });
  if (!identityFilters.length) return null;
  const occurrences = await HolidayAttendance.find({
    date: { $in: dates },
    ...(excludedId ? { holidayId: { $ne: excludedId } } : {}),
    $or: identityFilters,
  }).select('holidayId date employeeId userId holidayName').lean();
  if (!occurrences.length) return null;
  const activeIds = await Holiday.distinct('_id', {
    _id: { $in: occurrences.map(item => item.holidayId) },
    status: 'active',
  });
  const activeSet = new Set(activeIds.map(String));
  return occurrences.find(item => activeSet.has(String(item.holidayId))) || null;
};

const logHolidayActivity = async (req, action, holiday, previousValue, updatedValue) => {
  await ActivityLog.create({
    userId: req.user._id,
    userName: req.user.name,
    userRole: req.user.role,
    employeeId: req.user.employeeId || '',
    module: 'Holidays',
    action,
    recordId: holiday._id.toString(),
    previousValue: previousValue || null,
    updatedValue: updatedValue || null,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/holidays  — list all holidays
// ─────────────────────────────────────────────────────────────────────────────
const getHolidays = async (req, res) => {
  try {
    const { status, type } = req.query;
    const filter = {};
    if (req.user.role !== 'Admin') {
      filter.status = 'active';
      const { employee } = req.user.role === 'Employee'
        ? await resolveEmployeeForUser(req.user)
        : { employee: await Employee.findOne({ userId: req.user.id, isDraft: { $ne: true } }).select('employeeId').lean() };
      filter.$or = [
        { applicableAll: true },
        { applicableUserIds: String(req.user.id) },
        ...(employee?.employeeId ? [{ applicableEmployees: employee.employeeId }] : []),
        ...(req.user.employeeId ? [{ applicableEmployees: req.user.employeeId }] : []),
      ];
    } else if (status) filter.status = status;
    if (type) filter.type = type;

    const holidays = await Holiday.find(filter).populate('applicableUserIds', 'name employeeId role department designation').sort({ createdAt: -1 });
    res.json({ success: true, count: holidays.length, data: holidays });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/holidays/:id
// ─────────────────────────────────────────────────────────────────────────────
const getHolidayById = async (req, res) => {
  try {
    const holiday = await Holiday.findById(req.params.id).populate('applicableUserIds', 'name employeeId role department designation');
    if (!holiday) return res.status(404).json({ success: false, message: 'Holiday not found' });
    if (req.user.role !== 'Admin') {
      const { employee } = req.user.role === 'Employee'
        ? await resolveEmployeeForUser(req.user)
        : { employee: await Employee.findOne({ userId: req.user.id, isDraft: { $ne: true } }).select('employeeId').lean() };
      const assigned = holiday.applicableAll
        || (holiday.applicableUserIds || []).some(id => String(id) === String(req.user.id))
        || (holiday.applicableEmployees || []).some(id => [employee?.employeeId, req.user.employeeId].filter(Boolean).includes(String(id)));
      if (holiday.status !== 'active' || !assigned) {
        return res.status(404).json({ success: false, message: 'Holiday not found' });
      }
    }
    res.json({ success: true, data: holiday });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getEligibleHolidayEmployees = async (req, res) => {
  try {
    const roles = req.user.role === 'Admin' ? ['Employee', 'HR', 'Manager'] : ['Employee', 'Manager'];
    const result = await listEmployeeOptions(req.user, roles);
    if (result.error) return res.status(403).json({ success: false, message: result.error });
    res.json({
      success: true,
      count: result.data.length,
      data: result.data.map(option => ({ ...option, _id: option.userId })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/holidays  (admin/HR) — create a holiday
//  - validates via the pure holidaySync predicate
//  - stores the Applicable_Employees subset by employeeId
// ─────────────────────────────────────────────────────────────────────────────
const createHoliday = async (req, res) => {
  try {
    if (req.body.applicableAll !== undefined && typeof req.body.applicableAll !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Applies to all employees must be a boolean value.' });
    }
    const payload = buildHolidayPayload(req.body);
    if (!payload.applicableAll) {
      const allowedRoles = req.user.role === 'HR' ? ['Employee', 'Manager'] : ['Employee', 'HR', 'Manager'];
      if (payload.applicableAll && req.user.role === 'HR') {
        payload.applicableAll = false;
        payload.applicableUserIds = (await User.find({ isActive: true, role: { $in: allowedRoles } }).select('_id').lean())
          .map(account => String(account._id));
      }
      if (payload.applicableAll && req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Select All Employees is available to Admin only.' });
      }
      const selection = await normalizeEmployeeSelection(payload.applicableUserIds.length ? payload.applicableUserIds : payload.applicableEmployees, allowedRoles);
      if (selection.error) return res.status(400).json({ success: false, message: selection.error });
      payload.applicableEmployees = selection.employeeIds;
      payload.applicableUserIds = selection.userIds;
      if (!payload.applicableEmployees.length) {
        if (!payload.applicableUserIds.length) return res.status(400).json({ success: false, message: 'Select at least one active Employee, HR, or Manager or choose all.' });
      }
    }

    if (!isValidHolidayForm(payload)) {
      return res.status(400).json({
        success: false,
        message: payload.type === 'Festival' || payload.type === 'Custom'
          ? 'Enter a valid Holiday From Date and an optional Holiday To Date on or after it.'
          : INVALID_HOLIDAY_MESSAGE,
      });
    }

    const conflict = await findHolidayAssignmentConflict(payload);
    if (conflict) return res.status(409).json({ success: false, message: `${conflict.holidayName} is already assigned to a selected user on ${conflict.date}.` });
    const holiday = await Holiday.create(payload);

    try {
      await syncHolidayAttendance(holiday);
      await logHolidayActivity(req, 'Holiday created and assigned', holiday, null, holiday.toObject());
      await holiday.populate('applicableUserIds', 'name employeeId role department designation');
    } catch (syncError) {
      console.error(`Holiday ${holiday._id} attendance synchronization failed:`, syncError.message);
      return res.status(500).json({
        success: false,
        message: 'Holiday was saved, but its attendance calendar could not be synchronized. Retry by editing the holiday.',
      });
    }

    res.status(201).json({ success: true, data: holiday });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/holidays/:id  (admin/HR) — update a holiday
// ─────────────────────────────────────────────────────────────────────────────
const updateHoliday = async (req, res) => {
  try {
    if (req.body.applicableAll !== undefined && typeof req.body.applicableAll !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Applies to all employees must be a boolean value.' });
    }
    const existing = await Holiday.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Holiday not found' });

    // Merge incoming fields over the existing record so partial edits still
    // produce a complete, valid Holiday_Rule for the predicate check.
    const merged = buildHolidayPayload({
      holidayName: req.body.holidayName !== undefined ? req.body.holidayName : existing.holidayName,
      type: req.body.type !== undefined ? req.body.type : existing.type,
      date: req.body.date !== undefined ? req.body.date : existing.date,
      startDate: req.body.startDate !== undefined ? req.body.startDate : existing.startDate,
      endDate: req.body.endDate !== undefined ? req.body.endDate : existing.endDate,
      recurrence: {
        dayOfWeek:
          req.body.recurrence && req.body.recurrence.dayOfWeek !== undefined
            ? req.body.recurrence.dayOfWeek
            : existing.recurrence
            ? existing.recurrence.dayOfWeek
            : null,
        dayOfMonth:
          req.body.recurrence && req.body.recurrence.dayOfMonth !== undefined
            ? req.body.recurrence.dayOfMonth
            : existing.recurrence
            ? existing.recurrence.dayOfMonth
            : null,
      },
      status: req.body.status !== undefined ? req.body.status : existing.status,
      description: req.body.description !== undefined ? req.body.description : existing.description,
      paidStatus: req.body.paidStatus !== undefined ? req.body.paidStatus : existing.paidStatus,
      applicableAll: req.body.applicableAll !== undefined ? req.body.applicableAll : existing.applicableAll,
      applicableUserIds: req.body.applicableUserIds !== undefined ? req.body.applicableUserIds : existing.applicableUserIds,
      applicableEmployees:
        req.body.applicableEmployees !== undefined ? req.body.applicableEmployees : existing.applicableEmployees,
      employeeId: req.body.employeeId !== undefined ? req.body.employeeId : existing.employeeId,
      userId: req.body.userId !== undefined ? req.body.userId : existing.userId,
    });

    if (!merged.applicableAll) {
      const allowedRoles = req.user.role === 'HR' ? ['Employee', 'Manager'] : ['Employee', 'HR', 'Manager'];
      if (merged.applicableAll && req.user.role === 'HR') {
        merged.applicableAll = false;
        merged.applicableUserIds = (await User.find({ isActive: true, role: { $in: allowedRoles } }).select('_id').lean())
          .map(account => String(account._id));
      }
      if (merged.applicableAll && req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Select All Employees is available to Admin only.' });
      }
      const selection = await normalizeEmployeeSelection(merged.applicableUserIds.length ? merged.applicableUserIds : merged.applicableEmployees, allowedRoles);
      if (selection.error) return res.status(400).json({ success: false, message: selection.error });
      merged.applicableEmployees = selection.employeeIds;
      merged.applicableUserIds = selection.userIds;
      if (!merged.applicableEmployees.length && !merged.applicableUserIds.length) {
        return res.status(400).json({ success: false, message: 'Select at least one active Employee, HR, or Manager or choose all.' });
      }
    }

    if (!isValidHolidayForm(merged)) {
      return res.status(400).json({
        success: false,
        message: merged.type === 'Festival' || merged.type === 'Custom'
          ? 'Enter a valid Holiday From Date and an optional Holiday To Date on or after it.'
          : INVALID_HOLIDAY_MESSAGE,
      });
    }

    const conflict = await findHolidayAssignmentConflict(merged, existing._id);
    if (conflict) return res.status(409).json({ success: false, message: `${conflict.holidayName} is already assigned to a selected user on ${conflict.date}.` });
    const previous = existing.toObject();
    Object.assign(existing, merged);
    const holiday = await existing.save();

    try {
      await syncHolidayAttendance(holiday);
      await logHolidayActivity(req, 'Holiday and assignments updated', holiday, previous, holiday.toObject());
      await holiday.populate('applicableUserIds', 'name employeeId role department designation');
    } catch (syncError) {
      console.error(`Holiday ${holiday._id} attendance synchronization failed:`, syncError.message);
      return res.status(500).json({
        success: false,
        message: 'Holiday was updated, but its attendance calendar could not be synchronized. Retry by editing the holiday.',
      });
    }

    res.json({ success: true, data: holiday });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/holidays/:id  (admin/HR)
// ─────────────────────────────────────────────────────────────────────────────
const deleteHoliday = async (req, res) => {
  try {
    const holiday = await Holiday.findById(req.params.id);
    if (!holiday) return res.status(404).json({ success: false, message: 'Holiday not found' });

    const previous = holiday.toObject();
    holiday.status = 'inactive';
    await holiday.save();
    await syncHolidayAttendance(holiday);
    await logHolidayActivity(req, 'Holiday cancelled', holiday, previous, holiday.toObject());
    res.json({ success: true, message: 'Holiday cancelled successfully', data: holiday });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getHolidays,
  getHolidayById,
  getEligibleHolidayEmployees,
  createHoliday,
  updateHoliday,
  deleteHoliday,
};
