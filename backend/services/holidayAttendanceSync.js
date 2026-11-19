const Employee = require('../models/Employee');
const User = require('../models/User');
const Holiday = require('../models/Holiday');
const HolidayAttendance = require('../models/HolidayAttendance');
const { expandHolidayRule } = require('./holidaySync');

const getApplicableUsers = async holiday => {
  const filter = {
    isActive: true,
    role: { $in: ['Employee', 'HR', 'Manager'] },
  };
  if (!holiday.applicableAll) {
    const userIds = (holiday.applicableUserIds || []).map(String);
    const employeeIds = holiday.applicableEmployees || [];
    const profiles = employeeIds.length
      ? await Employee.find({
        isDraft: { $ne: true },
        status: 'active',
        employeeId: { $in: employeeIds },
        userId: { $ne: null },
      }).select('userId').lean()
      : [];
    filter._id = { $in: [...new Set([...userIds, ...profiles.map(item => String(item.userId))])] };
  }
  const users = await User.find(filter)
    .select('_id employeeId name role email department designation employeeRef')
    .sort({ name: 1, _id: 1 }).lean();
  const userIds = users.map(user => user._id);
  const profileFilters = [{ userId: { $in: userIds } }];
  const employeeRefs = users.map(user => user.employeeRef).filter(Boolean);
  if (employeeRefs.length) profileFilters.push({ _id: { $in: employeeRefs } });
  const emails = users.map(user => user.email).filter(Boolean);
  if (emails.length) profileFilters.push({ email: { $in: emails } });
  const profiles = await Employee.find({
    isDraft: { $ne: true },
    status: 'active',
    $or: profileFilters,
  }).select('_id userId employeeId name email department designation position').lean();
  const profileByUser = new Map();
  const profileById = new Map(profiles.map(profile => [String(profile._id), profile]));
  const profileByEmail = new Map(profiles.filter(profile => profile.email).map(profile => [profile.email.toLowerCase(), profile]));
  for (const profile of profiles) if (profile.userId) profileByUser.set(String(profile.userId), profile);

  return users.map(user => ({
    user,
    employee: profileByUser.get(String(user._id))
      || profileById.get(String(user.employeeRef))
      || (user.email ? profileByEmail.get(user.email.toLowerCase()) : null),
  }));
};

const getHolidayDates = holiday => {
  if (holiday.type === 'Festival' || holiday.type === 'Custom') {
    const startDate = holiday.startDate || holiday.date;
    return expandHolidayRule(holiday, startDate, holiday.endDate || startDate);
  }
  const year = new Date().getUTCFullYear();
  return expandHolidayRule(holiday, `${year}-01-01`, `${year}-12-31`);
};

const syncHolidayAttendance = async holiday => {
  const holidayId = holiday._id;
  const applicableUsers = holiday.status === 'active'
    ? await getApplicableUsers(holiday)
    : [];
  const dates = holiday.status === 'active' ? getHolidayDates(holiday) : [];
  const holidayStatus = holiday.applicableAll ? 'Company Holiday' : 'Assigned Holiday';
  const operations = [];

  for (const { user, employee } of applicableUsers) {
    const employeeRef = employee?._id || user._id;
    const employeeId = employee?.employeeId || user.employeeId || `USER-${user._id}`;
    for (const date of dates) {
      const occurrence = {
        holidayId,
        employeeRef,
        employeeModel: employee ? 'Employee' : 'User',
        employeeId,
        userId: user._id,
        employeeName: employee?.name || user.name || '',
        email: employee?.email || user.email || '',
        department: employee?.department || user.department || '',
        date,
        holidayName: holiday.holidayName,
        holidayStatus,
      };
      operations.push({
        updateOne: {
          filter: { holidayId, userId: user._id, date },
          update: { $set: occurrence },
          upsert: true,
        },
      });
    }
  }

  if (operations.length) await HolidayAttendance.bulkWrite(operations, { ordered: true });

  if (applicableUsers.length && dates.length) {
    await HolidayAttendance.deleteMany({
      holidayId,
      $or: [
        { userId: { $nin: applicableUsers.map(item => item.user._id) } },
        { date: { $nin: dates } },
      ],
    });
  } else {
    await HolidayAttendance.deleteMany({ holidayId });
  }
};

const syncActiveHolidayAttendance = async () => {
  const holidays = await Holiday.find({ status: 'active' }).sort({ _id: 1 });
  for (const holiday of holidays) {
    await syncHolidayAttendance(holiday);
  }
};

module.exports = { syncHolidayAttendance, syncActiveHolidayAttendance };
