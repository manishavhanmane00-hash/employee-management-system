const OvertimePolicy = require('../models/OvertimePolicy');
const User = require('../models/User');
const Employee = require('../models/Employee');
const ActivityLog = require('../models/ActivityLog');
const { createUserNotification } = require('../services/centralRequestService');

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const getPolicyData = async (req, res) => {
  try {
    const filter = req.user.role === 'Admin' ? {} : { userId: req.user._id };
    const policies = await OvertimePolicy.find(filter).sort({ userId: 1, effectiveFrom: -1 }).lean();
    const response = { policies };
    if (req.user.role === 'Admin') {
      const users = await User.find({ role: { $in: ['Employee', 'HR', 'Manager', 'Admin'] }, isActive: true })
        .select('name email employeeId role department designation employeeRef')
        .sort({ role: 1, name: 1 })
        .lean();
      const employeeIds = users.map(user => user.employeeRef).filter(Boolean);
      const employees = await Employee.find({ _id: { $in: employeeIds } }).select('_id department designation employeeId').lean();
      const employeesById = new Map(employees.map(employee => [String(employee._id), employee]));
      response.users = users.map(user => {
        const employee = employeesById.get(String(user.employeeRef));
        return {
          ...user,
          employeeId: user.employeeId || employee?.employeeId || '',
          department: user.department || employee?.department || '',
          designation: user.designation || employee?.designation || '',
        };
      });
    }
    res.json({ success: true, data: response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const assignPolicies = async (req, res) => {
  try {
    if (req.user.role !== 'Admin') return res.status(403).json({ success: false, message: 'Only Admin can configure overtime policies.' });
    const {
      userIds,
      roles,
      allUsers,
      standardDailyHours,
      hourlyRate,
      currency = 'INR',
      unpaidBreakMinutes = 0,
      weeklyOffDays = [0],
      holidayOvertimeEligible = true,
      effectiveFrom,
    } = req.body;
    if (!Number.isFinite(Number(standardDailyHours)) || Number(standardDailyHours) < 0 || Number(standardDailyHours) > 24) {
      return res.status(400).json({ success: false, message: 'Standard daily hours must be between 0 and 24.' });
    }
    if (!Number.isFinite(Number(hourlyRate)) || Number(hourlyRate) < 0) {
      return res.status(400).json({ success: false, message: 'Overtime rate must be a non-negative number.' });
    }
    if (!['INR', 'USD'].includes(currency)) {
      return res.status(400).json({ success: false, message: 'Select a verified currency for the overtime rate.' });
    }
    if (!Number.isInteger(Number(unpaidBreakMinutes)) || Number(unpaidBreakMinutes) < 0 || Number(unpaidBreakMinutes) > 720) {
      return res.status(400).json({ success: false, message: 'Unpaid break duration must be from 0 to 720 minutes.' });
    }
    if (!validDate(effectiveFrom)) return res.status(400).json({ success: false, message: 'Provide a valid effective date (YYYY-MM-DD).' });
    if (!Array.isArray(weeklyOffDays) || weeklyOffDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
      return res.status(400).json({ success: false, message: 'Weekly off days must be weekday numbers from 0 (Sunday) to 6 (Saturday).' });
    }
    const validRoles = ['Employee', 'HR', 'Manager', 'Admin'];
    if (roles !== undefined && (!Array.isArray(roles) || roles.some(role => !validRoles.includes(role)))) {
      return res.status(400).json({ success: false, message: 'Target roles must be Employee, HR, and/or Manager.' });
    }
    let targetFilter;
    if (allUsers === true) {
      targetFilter = { role: { $in: validRoles }, isActive: true };
    } else if (Array.isArray(userIds) && userIds.length) {
      targetFilter = { _id: { $in: userIds }, role: { $in: validRoles }, isActive: true };
    } else if (Array.isArray(roles) && roles.length) {
      targetFilter = { role: { $in: roles }, isActive: true };
    } else {
      return res.status(400).json({ success: false, message: 'Select one or more users, roles, or all users.' });
    }
    const users = await User.find(targetFilter).select('_id name employeeId role').lean();
    if (!users.length) return res.status(404).json({ success: false, message: 'No active users match the selected targets.' });
    const operations = users.map(user => ({
      updateOne: {
        filter: { userId: user._id, effectiveFrom },
        update: {
          $set: {
            standardDailyHours: Number(standardDailyHours),
            hourlyRate: Number(hourlyRate),
            currency,
            unpaidBreakMinutes: Number(unpaidBreakMinutes),
            weeklyOffDays: [...new Set(weeklyOffDays)],
            holidayOvertimeEligible: Boolean(holidayOvertimeEligible),
            assignedBy: req.user._id,
          },
          $setOnInsert: { userId: user._id, effectiveFrom },
        },
        upsert: true,
      },
    }));
    await OvertimePolicy.bulkWrite(operations, { ordered: true });
    const policies = await OvertimePolicy.find({ userId: { $in: users.map(user => user._id) }, effectiveFrom })
      .sort({ userId: 1 }).lean();
    await Promise.all(users.map(user => createUserNotification(user._id, {
      employeeId: user.employeeId || '',
      title: 'Overtime Policy Updated',
      message: `Your standard day is ${Number(standardDailyHours)} hours; overtime rate ${Number(hourlyRate)} effective ${effectiveFrom}.`,
      type: 'overtime',
    })));
    await ActivityLog.create({
      userId: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      module: 'Overtime',
      action: `Overtime policy assigned to ${users.length} user(s), effective ${effectiveFrom}`,
      updatedValue: {
        standardDailyHours: Number(standardDailyHours),
        hourlyRate: Number(hourlyRate),
        currency,
        unpaidBreakMinutes: Number(unpaidBreakMinutes),
        weeklyOffDays: [...new Set(weeklyOffDays)],
        holidayOvertimeEligible: Boolean(holidayOvertimeEligible),
        userIds: users.map(user => String(user._id)),
      },
    });
    res.json({ success: true, count: policies.length, data: policies });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getPolicyData, assignPolicies };
