const Attendance = require('../models/Attendance');
const Overtime = require('../models/Overtime');
const Payroll = require('../models/Payroll');
const Employee = require('../models/Employee');
const { calculateAttendanceOvertime } = require('./overtimeCalculation');

const syncCompletedAttendanceOvertime = async () => {
  const records = await Attendance.find({
    checkIn: { $nin: [null, ''] },
    checkOut: { $nin: [null, ''] },
    status: { $nin: ['absent', 'leave'] },
  }).sort({ date: 1 });
  let calculated = 0;
  for (const attendance of records) {
    const employee = await Employee.findOne({
      isDraft: { $ne: true },
      $or: [
        ...(attendance.employeeId ? [{ employeeId: attendance.employeeId }] : []),
        ...(attendance.userId ? [{ userId: attendance.userId }] : []),
      ],
    }).select('employeeId');
    const payrollExists = employee?.employeeId
      ? await Payroll.exists({
        employeeId: employee.employeeId,
        year: Number(attendance.date.slice(0, 4)),
        month: new Date(`${attendance.date}T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }),
      })
      : null;
    if (payrollExists) continue;
    const existing = attendance.userId
      ? await Overtime.exists({ userId: attendance.userId, date: attendance.date })
      : null;
    if (existing) continue;
    const result = await calculateAttendanceOvertime(attendance);
    if (result.calculated && result.data) calculated += 1;
  }
  return calculated;
};

module.exports = { syncCompletedAttendanceOvertime };
