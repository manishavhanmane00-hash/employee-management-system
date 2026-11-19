const mongoose = require('mongoose');
const User = require('../models/User');
const Employee = require('../models/Employee');
const HolidayAttendance = require('../models/HolidayAttendance');
const OvertimePolicy = require('../models/OvertimePolicy');
const Overtime = require('../models/Overtime');
const ActivityLog = require('../models/ActivityLog');
const { overtimeAmount } = require('./overtimePayroll');
const { recordRequest, syncRequestDecision } = require('./centralRequestService');

const timeMinutes = value => {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > (match[3] ? 12 : 23)) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  }
  return hour * 60 + minute;
};

const resolveAttendanceUser = async attendance => {
  if (attendance.userId) {
    const user = await User.findById(attendance.userId);
    if (user) return user;
  }
  if (attendance.email) {
    const user = await User.findOne({ email: attendance.email });
    if (user) return user;
  }
  const employeeFilters = [];
  if (attendance.employeeId) {
    employeeFilters.push({ employeeId: String(attendance.employeeId) });
    if (mongoose.Types.ObjectId.isValid(String(attendance.employeeId))) employeeFilters.push({ _id: attendance.employeeId });
  }
  if (!employeeFilters.length) return null;
  const employee = await Employee.findOne({ isDraft: { $ne: true }, $or: employeeFilters });
  if (!employee) return null;
  if (employee.userId) {
    const user = await User.findById(employee.userId);
    if (user) return user;
  }
  return User.findOne({ employeeRef: employee._id });
};

const getPolicyForDate = async (userId, date) => OvertimePolicy.findOne({ userId, effectiveFrom: { $lte: date } })
  .sort({ effectiveFrom: -1 });

const calculateAttendanceOvertime = async (attendance, actor = null) => {
  if (!attendance) return { calculated: false, reason: 'Attendance record is unavailable.' };
  const account = await resolveAttendanceUser(attendance);
  if (!account || !['Employee', 'HR', 'Manager'].includes(account.role)) {
    return { calculated: false, reason: 'Attendance is not linked to an eligible user account.' };
  }
  const [employee, policy, holiday, existing] = await Promise.all([
    account.employeeRef ? Employee.findById(account.employeeRef) : Employee.findOne({ userId: account._id, isDraft: { $ne: true } }),
    getPolicyForDate(account._id, attendance.date),
    HolidayAttendance.exists({
      date: attendance.date,
      $or: [
        { userId: account._id },
        { employeeId: account.employeeId || attendance.employeeId },
        ...(account.email ? [{ email: account.email }] : []),
      ],
    }),
    Overtime.findOne({
      userId: account._id,
      date: attendance.date,
      sourceType: 'Attendance',
    }),
  ]);
  const standardHours = policy?.standardDailyHours ?? 9;
  const rate = policy?.hourlyRate ?? 0;
  const weeklyOffDays = policy?.weeklyOffDays ?? [0];
  const dayOfWeek = new Date(`${attendance.date}T00:00:00Z`).getUTCDay();
  const weeklyOff = weeklyOffDays.includes(dayOfWeek);
  const holidayEligible = !holiday || (policy?.holidayOvertimeEligible ?? true);
  const nonWorkingDay = weeklyOff || (holiday && holidayEligible);
  const breakMinutes = Number.isInteger(attendance.breakMinutes)
    ? attendance.breakMinutes
    : policy?.unpaidBreakMinutes || 0;
  const invalidReason = !attendance.checkIn || !attendance.checkOut
    ? 'Missing punches or non-working attendance status.'
    : ['absent', 'leave'].includes(attendance.status)
      ? 'Attendance is marked absent or leave.'
      : null;
  const checkIn = timeMinutes(attendance.checkIn);
  const checkOut = timeMinutes(attendance.checkOut);
  let elapsedMinutes = checkIn === null || checkOut === null ? 0 : checkOut - checkIn;
  if (checkIn !== null && checkOut !== null && elapsedMinutes <= 0) elapsedMinutes += 24 * 60;
  const invalidPunchReason = checkIn === null || checkOut === null
    ? 'Attendance punches have an invalid time format.'
    : elapsedMinutes > 24 * 60
      ? 'Attendance duration exceeds 24 hours.'
      : null;
  const reasonNoCalculation = invalidReason || invalidPunchReason;
  if (reasonNoCalculation) {
    if (attendance.hours !== 0 || attendance.overtime !== 0) {
      attendance.hours = 0;
      attendance.overtime = 0;
      await attendance.save();
    }
    if (existing) {
      const retained = existing.status === 'Paid' || existing.counted;
      const needsDecisionSync = existing.approvalStatus !== 'Rejected';
      existing.calculationHistory.push({
        calculatedAt: new Date(),
        attendanceId: attendance._id,
        checkIn: attendance.checkIn,
        checkOut: attendance.checkOut,
        elapsedMinutes,
        breakMinutes,
        actualWorkingMinutes: 0,
        standardWorkingMinutes: Math.round(standardHours * 60),
        overtimeMinutes: 0,
        ratePerHour: rate,
        currency: policy?.currency || employee?.currency || 'INR',
        policyId: policy?._id || null,
        policyEffectiveFrom: policy?.effectiveFrom || null,
        holiday: Boolean(holiday),
        weeklyOff,
        retainedAsHistorical: retained,
      });
      if (!retained) {
        Object.assign(existing, {
          actualWorkingMinutes: 0,
          standardWorkingMinutes: Math.round(standardHours * 60),
          breakMinutes,
          durationHours: 0,
          durationMinutes: 0,
          ratePerHour: rate,
          rateEffectiveFrom: policy?.effectiveFrom || null,
          totalAmount: 0,
          approvalStatus: 'Rejected',
          approvalComment: `No overtime after configured attendance rules: ${reasonNoCalculation}`,
          reason: `No payable overtime: ${reasonNoCalculation}`,
        });
      }
      await existing.save();
      if (!retained && needsDecisionSync) {
        await syncRequestDecision({
          sourceModel: 'Overtime',
          sourceId: existing._id,
          status: 'Rejected',
          actor,
          comment: reasonNoCalculation,
        });
      }
    }
    return { calculated: false, reason: reasonNoCalculation };
  }
  const actualWorkingMinutes = Math.max(0, elapsedMinutes - breakMinutes);
  const standardWorkingMinutes = nonWorkingDay ? 0 : Math.round(standardHours * 60);
  const overtimeMinutes = holiday && !holidayEligible
    ? 0
    : Math.max(0, actualWorkingMinutes - standardWorkingMinutes);
  const durationHours = Math.floor(overtimeMinutes / 60);
  const durationMinutes = overtimeMinutes % 60;
  const calculation = {
    calculatedAt: new Date(),
    attendanceId: attendance._id,
    checkIn: attendance.checkIn,
    checkOut: attendance.checkOut,
    elapsedMinutes,
    breakMinutes,
    actualWorkingMinutes,
    standardWorkingMinutes,
    overtimeMinutes,
    ratePerHour: rate,
    policyId: policy?._id || null,
    policyEffectiveFrom: policy?.effectiveFrom || null,
    holiday: Boolean(holiday),
    weeklyOff,
  };
  const updatedHours = actualWorkingMinutes / 60;
  const updatedOvertime = overtimeMinutes / 60;
  if (attendance.hours !== updatedHours || attendance.overtime !== updatedOvertime) {
    attendance.hours = updatedHours;
    attendance.overtime = updatedOvertime;
    await attendance.save();
  }

  if (existing?.status === 'Paid' || existing?.counted) {
    existing.calculationHistory.push({ ...calculation, retainedAsHistorical: true });
    await existing.save();
    return { calculated: false, reason: 'Previously paid or payroll-counted overtime was retained as historical.' };
  }
  if (!existing && overtimeMinutes === 0) {
    return { calculated: true, data: null, reason: 'No payable overtime was calculated.' };
  }
  if (existing) existing.calculationHistory.push({ ...calculation, retainedAsHistorical: false });
  const previousApprovalStatus = existing?.approvalStatus;
  const entry = existing || new Overtime({
    userId: account._id,
    date: attendance.date,
    sourceType: 'Attendance',
    calculationHistory: [],
  });
  Object.assign(entry, {
    employeeId: account.employeeId || employee?.employeeId || null,
    submittedByRole: account.role,
    email: account.email || employee?.email || '',
    employeeName: account.name,
    department: employee?.department || account.department || attendance.department || '',
    designation: employee?.designation || employee?.position || account.designation || '',
    date: attendance.date,
    checkIn: attendance.checkIn,
    checkOut: attendance.checkOut,
    actualWorkingMinutes,
    standardWorkingMinutes,
    breakMinutes,
    durationHours,
    durationMinutes,
    ratePerHour: rate,
    rateEffectiveFrom: policy?.effectiveFrom || null,
    totalAmount: overtimeAmount(durationHours, durationMinutes, rate),
    reason: holiday ? 'Attendance-based overtime on assigned holiday' : `Attendance-based overtime from ${attendance.checkIn} to ${attendance.checkOut}`,
    approvalStatus: overtimeMinutes > 0
      ? (existing?.approvalComment?.startsWith('No overtime after configured') ? 'Pending Approval' : existing?.approvalStatus || 'Pending Approval')
      : 'Rejected',
    approvalComment: overtimeMinutes > 0
      ? (existing?.approvalComment?.startsWith('No overtime after configured') ? '' : existing?.approvalComment || '')
      : 'No overtime after configured hours and break deductions.',
    status: 'Pending',
    calculationHistory: existing ? entry.calculationHistory : [calculation],
  });
  await entry.save();
  if (overtimeMinutes > 0) {
    await recordRequest({
      user: account,
      employeeId: entry.employeeId,
      requestType: 'Overtime',
      details: {
        date: entry.date,
        actualWorkingMinutes,
        standardWorkingMinutes,
        durationHours,
        durationMinutes,
        ratePerHour: rate,
        estimatedAmount: entry.totalAmount,
        reason: entry.reason,
      },
      status: entry.approvalStatus === 'Approved'
        ? 'Approved'
        : entry.approvalStatus === 'Rejected' ? 'Rejected' : 'Pending',
      sourceModel: 'Overtime',
      sourceId: entry._id,
    });
  } else if (previousApprovalStatus !== 'Rejected') {
    await syncRequestDecision({
      sourceModel: 'Overtime',
      sourceId: entry._id,
      status: 'Rejected',
      actor,
      comment: 'No overtime after configured hours, break deductions, and holiday rules.',
    });
  }
  if (actor) {
    await ActivityLog.create({
      userId: actor._id,
      userName: actor.name,
      userRole: actor.role,
      employeeId: entry.employeeId || '',
      module: 'Overtime',
      action: existing ? 'Attendance overtime recalculated' : 'Attendance overtime calculated',
      recordId: entry._id.toString(),
      previousValue: existing ? existing.toObject() : null,
      updatedValue: entry.toObject(),
    });
  }
  return { calculated: true, data: entry };
};

module.exports = { calculateAttendanceOvertime, getPolicyForDate, resolveAttendanceUser, timeMinutes };
