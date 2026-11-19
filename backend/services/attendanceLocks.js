const HolidayAttendance = require('../models/HolidayAttendance');
const Holiday = require('../models/Holiday');
const Leave = require('../models/Leave');
const mongoose = require('mongoose');

const identityConditions = ({ employeeId, userId, email }) => [
  ...(userId ? [{ userId }] : []),
  ...(employeeId ? [{ employeeId: String(employeeId) }] : []),
  ...(employeeId && mongoose.Types.ObjectId.isValid(String(employeeId))
    ? [{ employeeRef: employeeId }]
    : []),
  ...(email ? [{ email }] : []),
];

const findApprovedLeaveForDate = async identity => {
  const identities = identityConditions(identity);
  if (!identities.length) return null;
  return Leave.findOne({
    status: 'approved',
    startDate: { $lte: identity.date },
    endDate: { $gte: identity.date },
    $or: identities,
  }).lean();
};

const findAssignedHolidayForDate = async identity => {
  const identities = identityConditions(identity);
  if (!identities.length) return null;
  const occurrence = await HolidayAttendance.findOne({
    date: identity.date,
    $or: identities,
  }).lean();
  if (!occurrence) return null;
  const holiday = await Holiday.findOne({ _id: occurrence.holidayId, status: 'active' }).lean();
  return holiday ? { ...occurrence, holiday } : null;
};

const findAttendanceDateLock = async identity => {
  const [leave, holiday] = await Promise.all([
    findApprovedLeaveForDate(identity),
    findAssignedHolidayForDate(identity),
  ]);
  if (leave) return { type: 'leave', record: leave };
  if (holiday) return { type: 'holiday', record: holiday };
  return null;
};

module.exports = {
  findApprovedLeaveForDate,
  findAssignedHolidayForDate,
  findAttendanceDateLock,
};
