const Attendance = require('../models/Attendance');
const HolidayAttendance = require('../models/HolidayAttendance');
const Holiday = require('../models/Holiday');
const Leave = require('../models/Leave');
const mongoose = require('mongoose');
const {
  resolveEmployeeForUser,
  resolveRequestIdentity,
  managerTeamConditions,
  managerAssignedEmployees,
} = require('../services/employeeIdentity');
const { findAttendanceDateLock } = require('../services/attendanceLocks');
const { calculateAttendanceOvertime, timeMinutes } = require('../services/overtimeCalculation');

const toMinutes = timeMinutes;

// Duration is recalculated from punches; the policy service applies standard hours.
const calcHours = (checkIn, checkOut, breakMinutes = 0) => {
  const inMin  = toMinutes(checkIn);
  const outMin = toMinutes(checkOut);
  if (inMin === null || outMin === null) return { hours: 0, overtime: 0 };
  let elapsed = outMin - inMin;
  if (elapsed <= 0) elapsed += 24 * 60;
  const hours = Math.max(0, elapsed - Number(breakMinutes || 0)) / 60;
  return { hours, overtime: 0 };
};

const resolveAttendanceUser = async user => {
  const identity = await resolveRequestIdentity(user.dbUser || user);
  if (identity.error) return { error: identity.error };
  if (!identity.employee?.employeeId) {
    return { error: 'Your account must be linked to an employee record before attendance can be recorded.' };
  }
  return {
    userId: identity.account._id,
    employeeId: identity.employee.employeeId,
    employee: identity.employee,
    account: identity.account,
    email: identity.employee.email || identity.account.email || '',
    name: identity.employee.name || identity.account.name || '',
    department: identity.employee.department || identity.account.department || '',
  };
};

// GET /api/attendance  (admin: all records; employee: own records only)
const getAttendance = async (req, res) => {
  try {
    const { date, month, employeeId, department } = req.query;
    const filter = {};
    const holidayFilter = {};
    const leaveFilter = { status: 'approved' };

    if (req.user.role === 'Employee') {
      const ownerConditions = [{ userId: req.user.id }];
      if (req.user.email) ownerConditions.push({ email: req.user.email });
      const { employee } = await resolveEmployeeForUser(req.user);
      if (employee) {
        ownerConditions.push(
          { employeeRef: employee._id },
          { employeeId: String(employee._id) },
          { employeeId: employee.employeeId }
        );
      }
      filter.$or = ownerConditions;
      holidayFilter.$or = ownerConditions;
      leaveFilter.$or = ownerConditions;
    } else {
      if (employeeId) filter.employeeId = employeeId;
      if (employeeId) leaveFilter.employeeId = employeeId;
      if (employeeId) holidayFilter.$or = [
        ...(mongoose.Types.ObjectId.isValid(String(employeeId)) ? [{ employeeRef: employeeId }] : []),
        { employeeId: String(employeeId) },
      ];
      if (department) filter.department = department;
      if (department) holidayFilter.department = department;
      if (department) leaveFilter.department = department;
    }
    if (req.user.role === 'Manager') {
      const teamConditions = await managerTeamConditions(req.user);
      filter.$or = teamConditions;
      holidayFilter.$or = teamConditions;
      leaveFilter.$or = teamConditions;
    }

    if (date) {
      filter.date = date;
      holidayFilter.date = date;
      leaveFilter.startDate = { $lte: date };
      leaveFilter.endDate = { $gte: date };
    } else if (month) {
      const monthPattern = `^${String(month).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
      filter.date = { $regex: monthPattern };
      holidayFilter.date = { $regex: monthPattern };
      const monthStart = `${month}-01`;
      const [yearText, monthText] = String(month).split('-');
      const monthEnd = `${month}-${String(new Date(Number(yearText), Number(monthText), 0).getDate()).padStart(2, '0')}`;
      leaveFilter.startDate = { $lte: monthEnd };
      leaveFilter.endDate = { $gte: monthStart };
    }

    const [attendanceRecords, holidayOccurrences, approvedLeaves] = await Promise.all([
      Attendance.find(filter).sort({ date: -1 }).lean(),
      HolidayAttendance.find(holidayFilter).sort({ date: -1 }).lean(),
      Leave.find(leaveFilter).sort({ startDate: 1 }).lean(),
    ]);
    const activeHolidayIds = holidayOccurrences.length
      ? await Holiday.distinct('_id', {
        _id: { $in: holidayOccurrences.map(occurrence => occurrence.holidayId) },
        status: 'active',
      })
      : [];
    const activeHolidayIdSet = new Set(activeHolidayIds.map(String));

    const records = attendanceRecords;
    for (const occurrence of holidayOccurrences.filter(item => activeHolidayIdSet.has(String(item.holidayId)))) {
      const holiday = {
        holidayId: occurrence.holidayId,
        holidayName: occurrence.holidayName,
        holidayStatus: occurrence.holidayStatus,
      };
      const matchingRecord = records.find(record =>
        record.date === occurrence.date
        && (
          String(record.employeeId) === String(occurrence.employeeRef)
          || String(record.employeeId) === String(occurrence.employeeId)
          || (record.userId && occurrence.userId && String(record.userId) === String(occurrence.userId))
          || (record.email && occurrence.email && record.email === occurrence.email)
        )
      );
      if (matchingRecord) {
        if (!matchingRecord.holidays?.length) matchingRecord.attendanceStatus = matchingRecord.status;
        matchingRecord.status = 'holiday';
        matchingRecord.holidays = [...(matchingRecord.holidays || []), holiday];
        continue;
      }

      records.push({
        _id: `holiday-${occurrence.holidayId}-${occurrence.employeeRef}-${occurrence.date}`,
        employeeId: String(occurrence.employeeRef),
        employeeCode: occurrence.employeeId,
        userId: occurrence.userId,
        name: occurrence.employeeName,
        email: occurrence.email,
        department: occurrence.department,
        date: occurrence.date,
        checkIn: null,
        checkOut: null,
        hours: 0,
        overtime: 0,
        status: 'holiday',
        late: false,
        holidays: [holiday],
        isHolidayOnly: true,
      });
    }

    for (const leave of approvedLeaves) {
      const start = date && date > leave.startDate ? date : (month ? `${month}-01` : leave.startDate);
      const [yearText, monthText] = String(month || start).split('-');
      const endOfMonth = month
        ? `${month}-${String(new Date(Number(yearText), Number(monthText), 0).getDate()).padStart(2, '0')}`
        : leave.endDate;
      const end = date
        ? date
        : (month && endOfMonth < leave.endDate ? endOfMonth : leave.endDate);
      for (let timestamp = Date.parse(`${start}T00:00:00Z`), finalTimestamp = Date.parse(`${end}T00:00:00Z`);
        timestamp <= finalTimestamp;
        timestamp += 86400000) {
        const leaveDate = new Date(timestamp).toISOString().slice(0, 10);
        const matchingRecord = records.find(record =>
          record.date === leaveDate
          && (
            (leave.employeeId && String(record.employeeId) === String(leave.employeeId))
            || (leave.userId && record.userId && String(record.userId) === String(leave.userId))
            || (leave.email && record.email === leave.email)
          )
        );
        if (matchingRecord?.status === 'holiday') continue;
        if (matchingRecord) {
          if (matchingRecord.status !== 'leave') matchingRecord.attendanceStatus = matchingRecord.status;
          matchingRecord.status = 'leave';
          matchingRecord.leaveId = leave._id;
          matchingRecord.leaveType = leave.leaveType;
          matchingRecord.leavePayStatus = leave.paidStatus || (leave.leaveType === 'Unpaid Leave' ? 'Unpaid' : 'Paid');
          continue;
        }
        records.push({
          _id: `leave-${leave._id}-${leaveDate}`,
          employeeId: leave.employeeId || null,
          userId: leave.userId,
          name: leave.employeeName,
          email: leave.email,
          department: leave.department,
          date: leaveDate,
          checkIn: null,
          checkOut: null,
          hours: 0,
          overtime: 0,
          status: 'leave',
          leaveId: leave._id,
          leaveType: leave.leaveType,
          leavePayStatus: leave.paidStatus || (leave.leaveType === 'Unpaid Leave' ? 'Unpaid' : 'Paid'),
          late: false,
          isLeaveOnly: true,
        });
      }
    }

    records.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/attendance  (admin marks attendance for any employee)
const markAttendance = async (req, res) => {
  try {
    let { employeeId, name, email, department, date, checkIn, checkOut, breakMinutes, status, late } = req.body;
    if (!employeeId || !date)
      return res.status(400).json({ success: false, message: 'employeeId and date are required' });
    let userId;
    if (req.user.role === 'Manager') {
      const team = await managerAssignedEmployees(req.user);
      const target = team.find(employee =>
        String(employee.employeeId) === String(employeeId)
        || String(employee._id) === String(employeeId)
      );
      if (!target) {
        return res.status(403).json({ success: false, message: 'You may only mark attendance for employees on your team.' });
      }
      employeeId = target.employeeId;
      userId = target.userId;
      name = target.name;
      email = target.email;
      department = target.department;
    }
    const dateLock = await findAttendanceDateLock({ employeeId, date });
    if (dateLock) {
      return res.status(409).json({
        success: false,
        message: dateLock.type === 'holiday'
          ? 'This date is an assigned holiday and attendance cannot be changed.'
          : 'This date is covered by approved leave and attendance cannot be changed.',
      });
    }
    if (status && !['present', 'absent', 'late', 'half-day', 'leave'].includes(status))
      return res.status(400).json({ success: false, message: 'Invalid attendance status.' });

    if (breakMinutes !== undefined && (!Number.isInteger(Number(breakMinutes)) || Number(breakMinutes) < 0 || Number(breakMinutes) > 720)) {
      return res.status(400).json({ success: false, message: 'Break duration must be from 0 to 720 minutes.' });
    }

    const { hours, overtime } = calcHours(checkIn, checkOut, Number(breakMinutes || 0));

    const record = await Attendance.findOneAndUpdate(
      { employeeId, date },
      { employeeId, userId, name, email, department, date, checkIn: checkIn || null, checkOut: checkOut || null,
        breakMinutes: breakMinutes === undefined ? null : Number(breakMinutes),
        hours, overtime, status: status || 'present', late: late || false },
      { upsert: true, new: true, runValidators: true }
    );
    await calculateAttendanceOvertime(record, req.user.dbUser || req.user);
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/attendance/self  (employee manages their own attendance for any date)
const selfMarkAttendance = async (req, res) => {
  try {
    const { date, status, checkIn, checkOut, breakMinutes } = req.body;
    if (!date)   return res.status(400).json({ success: false, message: 'date is required' });
    if (!status) return res.status(400).json({ success: false, message: 'status is required' });

    const allowed = ['present', 'absent', 'half-day', 'leave', 'late'];
    if (!allowed.includes(status))
      return res.status(400).json({ success: false, message: 'Invalid status' });
    const identity = await resolveAttendanceUser(req.user);
    if (identity.error) return res.status(400).json({ success: false, message: identity.error });
    const dateLock = await findAttendanceDateLock({ ...identity, date });
    if (dateLock) {
      return res.status(409).json({
        success: false,
        message: dateLock.type === 'holiday'
          ? 'This date is an assigned holiday and attendance cannot be changed.'
          : 'This date is covered by approved leave and attendance cannot be changed.',
      });
    }

    if (breakMinutes !== undefined && (!Number.isInteger(Number(breakMinutes)) || Number(breakMinutes) < 0 || Number(breakMinutes) > 720)) {
      return res.status(400).json({ success: false, message: 'Break duration must be from 0 to 720 minutes.' });
    }

    const { hours, overtime } = calcHours(checkIn, checkOut, Number(breakMinutes || 0));

    // Scope strictly to the authenticated user — cannot forge another employee's ID
    // Use employeeId + date to match the unique index and avoid duplicate key errors
    const record = await Attendance.findOneAndUpdate(
      { employeeId: identity.employeeId, date },
      {
        $set: {
          userId:     identity.userId,
          employeeId: identity.employeeId,
          name:       identity.name,
          email:      identity.email,
          department: identity.department,
          date,
          checkIn:   checkIn  || null,
          checkOut:  checkOut || null,
          breakMinutes: breakMinutes === undefined ? null : Number(breakMinutes),
          hours,
          overtime,
          status,
          late: status === 'late',
        }
      },
      { upsert: true, new: true, runValidators: true }
    );
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/attendance/check-in  (employee checks in)
const checkIn = async (req, res) => {
  try {
    const identity = await resolveAttendanceUser(req.user);
    if (identity.error) return res.status(400).json({ success: false, message: identity.error });
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const dateLock = await findAttendanceDateLock({ ...identity, date: today });
    if (dateLock) {
      return res.status(409).json({
        success: false,
        message: dateLock.type === 'holiday'
          ? 'This date is an assigned holiday; check-in is not allowed.'
          : 'This date is covered by approved leave; check-in is not allowed.',
      });
    }

    const existing = await Attendance.findOne({
      $or: [{ userId: identity.userId }, { employeeId: identity.employeeId }],
      date: today,
    });
    if (existing?.checkIn) return res.status(400).json({ success: false, message: 'Already checked in today' });

    const record = await Attendance.findOneAndUpdate(
      { employeeId: identity.employeeId, date: today },
      {
        employeeId: identity.employeeId,
        userId: identity.userId,
        email: identity.email,
        name: identity.name,
        department: identity.department,
        date: today,
        checkIn: now,
        status: 'present',
      },
      { upsert: true, new: true }
    );
    if (record.checkIn && record.checkOut) await calculateAttendanceOvertime(record, req.user.dbUser || req.user);
    res.json({ success: true, data: record, message: `Checked in at ${now}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/attendance/check-out  (employee checks out)
const checkOut = async (req, res) => {
  try {
    const identity = await resolveAttendanceUser(req.user);
    if (identity.error) return res.status(400).json({ success: false, message: identity.error });
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const dateLock = await findAttendanceDateLock({ ...identity, date: today });
    if (dateLock) {
      return res.status(409).json({
        success: false,
        message: dateLock.type === 'holiday'
          ? 'This date is an assigned holiday; check-out is not allowed.'
          : 'This date is covered by approved leave; check-out is not allowed.',
      });
    }

    const record = await Attendance.findOne({
      $or: [{ employeeId: identity.employeeId }, { userId: identity.userId }],
      date: today,
    });
    if (!record?.checkIn) return res.status(400).json({ success: false, message: 'You have not checked in today' });
    if (record.checkOut) return res.status(400).json({ success: false, message: 'Already checked out today' });

    record.checkOut = now;
    const { hours } = calcHours(record.checkIn, now, record.breakMinutes || 0);
    record.hours = hours;
    await record.save();
    const overtimeResult = await calculateAttendanceOvertime(record, req.user.dbUser || req.user);

    res.json({ success: true, data: record, message: `Checked out at ${now}. Hours worked: ${hours.toFixed(2)}h`, overtime: overtimeResult.data || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Admin: correct an attendance record — stores an audit trail of the change
// PUT /api/attendance/:id/correct  (admin/HR)
const correctAttendance = async (req, res) => {
  try {
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Attendance record not found' });
    if (req.user.role === 'Manager') {
      const teamConditions = await managerTeamConditions(req.user);
      const isTeamRecord = await Attendance.exists({ _id: record._id, $or: teamConditions });
      if (!isTeamRecord) {
        return res.status(403).json({ success: false, message: 'You may only correct attendance for employees on your team.' });
      }
    }

    const { checkIn, checkOut, breakMinutes, status, late, reason } = req.body;
    const dateLock = await findAttendanceDateLock({
      employeeId: record.employeeId,
      userId: record.userId,
      email: record.email,
      date: record.date,
    });
    if (dateLock) {
      return res.status(409).json({
        success: false,
        message: dateLock.type === 'holiday'
          ? 'This date is an assigned holiday and attendance cannot be corrected.'
          : 'This date is covered by approved leave and attendance cannot be corrected.',
      });
    }
    const before = {
      checkIn: record.checkIn,
      checkOut: record.checkOut,
      breakMinutes: record.breakMinutes,
      hours: record.hours,
      overtime: record.overtime,
      status: record.status,
      late: record.late,
    };

    if (checkIn !== undefined) record.checkIn = checkIn || null;
    if (checkOut !== undefined) record.checkOut = checkOut || null;
    if (breakMinutes !== undefined) {
      if (!Number.isInteger(Number(breakMinutes)) || Number(breakMinutes) < 0 || Number(breakMinutes) > 720) {
        return res.status(400).json({ success: false, message: 'Break duration must be from 0 to 720 minutes.' });
      }
      record.breakMinutes = Number(breakMinutes);
    }
    if (status !== undefined) record.status = status;
    if (late !== undefined) record.late = late;

    if (record.checkIn && record.checkOut) {
      const { hours, overtime } = calcHours(record.checkIn, record.checkOut, record.breakMinutes || 0);
      record.hours = hours;
      record.overtime = overtime;
    }

    // Audit trail
    record.correctedAt = new Date();
    record.correctedBy = req.user.name;
    record.correctionReason = (reason || '').trim();
    record.correctionBefore = before;

    await record.save();
    await calculateAttendanceOvertime(record, req.user.dbUser || req.user);
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Employee: fetch their own attendance summary for a month
// GET /api/attendance/my-summary?month=YYYY-MM
const mySummary = async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ success: false, message: 'month (YYYY-MM) is required' });

    const records = await Attendance.find({
      $or: [{ userId: req.user.id }, { email: req.user.email }],
      date: { $regex: `^${month}` },
    }).sort({ date: 1 });

    const summary = {
      total: records.length,
      present: records.filter(r => r.status === 'present').length,
      late: records.filter(r => r.status === 'late').length,
      absent: records.filter(r => r.status === 'absent').length,
      halfDay: records.filter(r => r.status === 'half-day').length,
      leave: records.filter(r => r.status === 'leave').length,
      totalHours: records.reduce((s, r) => s + (r.hours || 0), 0),
      totalOvertime: records.reduce((s, r) => s + (r.overtime || 0), 0),
    };

    res.json({ success: true, data: { records, summary } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getAttendance, markAttendance, selfMarkAttendance, checkIn, checkOut, correctAttendance, mySummary };
