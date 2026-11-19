const Employee    = require('../models/Employee');
const { resolvePermissionsForRole } = require('./permissionController');
const Attendance   = require('../models/Attendance');
const Leave        = require('../models/Leave');
const Department   = require('../models/Department');
const User         = require('../models/User');
const { managerAssignedEmployees, managerTeamConditions } = require('../services/employeeIdentity');
const Payroll = require('../models/Payroll');
const { payrollNetExpression } = require('../services/payrollCalculation');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/dashboard  — aggregated metrics for the admin dashboard
// ─────────────────────────────────────────────────────────────────────────────
const dashboardMetrics = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const monthName = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][now.getMonth()];
    const managerTeam = req.user.role === 'Manager' ? await managerAssignedEmployees(req.user) : null;
    const managerConditions = managerTeam ? await managerTeamConditions(req.user) : [];
    const employeeFilter = managerTeam ? { _id: { $in: managerTeam.map(employee => employee._id) } } : {};
    const identityFilter = managerTeam ? { $or: managerConditions } : {};
    const attendanceFilter = { ...identityFilter, date: today };
    const leaveFilter = { ...identityFilter, status: 'pending' };
    const [totalEmployees, activeEmployees, todayRecords, pendingLeave, totalUsers, departments] = await Promise.all([
      Employee.countDocuments(employeeFilter),
      Employee.countDocuments({ ...employeeFilter, status: 'active' }),
      Attendance.find(attendanceFilter).lean(),
      Leave.countDocuments(leaveFilter),
      managerTeam ? Promise.resolve(managerTeam.length + 1) : User.countDocuments({ isActive: true }),
      Department.find().sort({ name: 1 }).lean(),
    ]);
    const payrollScope = {};
    const payrollPermission = ['HR', 'Manager'].includes(req.user.role)
      ? (await resolvePermissionsForRole(req.user.role)).permissions['payroll.allRecords'] === true
      : req.user.role === 'Admin';
    if (!payrollPermission) {
      payrollScope.$or = [
        { userId: req.user._id },
        ...(req.user.email ? [{ email: req.user.email }] : []),
        ...(req.user.employeeId ? [{ employeeId: String(req.user.employeeId) }] : []),
      ];
    }
    const monthlyPayroll = await Payroll.aggregate([
      { $match: { ...payrollScope, month: monthName, year: now.getFullYear() } },
      { $group: { _id: { $ifNull: ['$currency', 'UNVERIFIED'] }, total: { $sum: payrollNetExpression() }, count: { $sum: 1 } } },
    ]);
    const monthlyPayrollTotals = Object.fromEntries(monthlyPayroll.map(item => [item._id, { amount: item.total, count: item.count }]));
    const recentPeriods = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
      return {
        month: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][date.getMonth()],
        year: date.getFullYear(),
      };
    });
    const payrollTrendRecords = await Payroll.aggregate([
      { $match: { ...payrollScope, $or: recentPeriods } },
      { $group: {
        _id: { year: '$year', month: '$month', currency: { $ifNull: ['$currency', 'UNVERIFIED'] } },
        total: { $sum: payrollNetExpression() },
      } },
    ]);
    const payrollByPeriod = new Map();
    recentPeriods.forEach(period => payrollByPeriod.set(
      `${period.year}-${period.month}`,
      { period: `${period.month.slice(0, 3)} ${period.year}` }
    ));
    payrollTrendRecords.forEach(record => {
      const row = payrollByPeriod.get(`${record._id.year}-${record._id.month}`);
      if (row) row[record._id.currency] = record.total;
    });
    const payrollTrend = [...payrollByPeriod.values()];

    const presentCount = todayRecords.filter(r => r.status === 'present' || r.status === 'late').length;
    const absentCount = todayRecords.filter(r => r.status === 'absent').length;

    // Department-wise employee distribution
    const deptCounts = await Employee.aggregate([
      ...(managerTeam ? [{ $match: employeeFilter }] : []),
      { $group: { _id: '$department', count: { $sum: 1 } } },
    ]);
    const deptMap = deptCounts.reduce((m, d) => { m[d._id] = d.count; return m; }, {});
    const departmentStats = departments.map(d => ({
      name: d.name,
      employeeCount: deptMap[d.name] || 0,
      status: d.status,
    }));

    // Attendance trend (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const weekRecords = await Attendance.find({
      ...identityFilter,
      date: { $gte: sevenDaysAgo, $lte: today },
    }).lean();
    const attendanceTrend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const dayRecords = weekRecords.filter(r => r.date === d);
      attendanceTrend.push({
        date: d,
        present: dayRecords.filter(r => r.status === 'present').length,
        late: dayRecords.filter(r => r.status === 'late').length,
        absent: dayRecords.filter(r => r.status === 'absent').length,
        onLeave: dayRecords.filter(r => r.status === 'leave').length,
      });
    }

    res.json({
      success: true,
      data: {
        totalEmployees,
        activeEmployees,
        presentToday: presentCount,
        absentToday: absentCount,
        pendingLeave,
        activeUsers: totalUsers,
        departmentStats,
        attendanceTrend,
        monthlyPayrollTotals,
        payrollTrend,
        payrollPeriod: { month: monthName, year: now.getFullYear() },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/attendance?from=&to=&department=&format=csv
// ─────────────────────────────────────────────────────────────────────────────
const attendanceReport = async (req, res) => {
  try {
    const { from, to, department, employeeId } = req.query;

    const filter = {};
    if (from && to) filter.date = { $gte: from, $lte: to };
    else if (from) filter.date = { $gte: from };
    else if (to) filter.date = { $lte: to };
    if (department) filter.department = department;
    if (employeeId) filter.employeeId = employeeId;

    if (req.user.role === 'Manager') {
      filter.$or = await managerTeamConditions(req.user);
    } else if (req.user.role === 'Employee') {
      filter.$or = [
        { userId: req.user.id },
        ...(req.user.email ? [{ email: req.user.email }] : []),
        ...(req.user.employeeId ? [{ employeeId: String(req.user.employeeId) }] : []),
      ];
    }

    const records = await Attendance.find(filter).sort({ date: -1 }).lean();

    if (req.query.format === 'csv') {
      const header = 'Date,Employee,Email,Department,CheckIn,CheckOut,Hours,Status,LeaveCategory,Late\n';
      const rows = records.map(r => [
        r.date,
        `"${r.name || ''}"`,
        r.email || '',
        `"${r.department || ''}"`,
        r.checkIn || '',
        r.checkOut || '',
        r.hours || 0,
        r.status || '',
        r.leavePayStatus || '',
        r.late ? 'Yes' : 'No',
      ].join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="attendance_report.csv"');
      return res.send(header + rows);
    }

    res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/leave?from=&to=&status=&format=csv
// ─────────────────────────────────────────────────────────────────────────────
const leaveReport = async (req, res) => {
  try {
    const { from, to, status } = req.query;
    const filter = {};

    if (req.user.role === 'Manager') {
      filter.$or = await managerTeamConditions(req.user);
    } else if (req.user.role === 'Employee') {
      filter.$or = [
        { userId: req.user.id },
        ...(req.user.email ? [{ email: req.user.email }] : []),
        ...(req.user.employeeId ? [{ employeeId: String(req.user.employeeId) }] : []),
      ];
    }
    if (status) filter.status = status;
    if (from && to) {
      filter.startDate = { $lte: to };
      filter.endDate = { $gte: from };
    } else if (from) {
      filter.endDate = { $gte: from };
    } else if (to) {
      filter.startDate = { $lte: to };
    }

    const records = await Leave.find(filter).sort({ createdAt: -1 }).lean();

    if (req.query.format === 'csv') {
      const header = 'Employee,Email,Department,LeaveType,Category,StartDate,EndDate,Days,Status,AppliedDate,ApprovedAt,ApprovedBy,RejectionReason,History\n';
      const rows = records.map(r => [
        `"${r.employeeName || ''}"`,
        r.email || '',
        `"${r.department || ''}"`,
        r.leaveType || '',
        r.paidStatus || (r.leaveType === 'Unpaid Leave' ? 'Unpaid' : 'Paid'),
        r.startDate || '',
        r.endDate || '',
        r.days || 0,
        r.status || '',
        r.appliedDate || '',
        r.approvedAt?.toISOString?.() || '',
        r.approvedBy || '',
        `"${(r.rejectionReason || '').replace(/"/g, '""')}"`,
        `"${JSON.stringify(r.history || []).replace(/"/g, '""')}"`,
      ].join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="leave_report.csv"');
      return res.send(header + rows);
    }

    res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/employees?department=&status=&format=csv
// ─────────────────────────────────────────────────────────────────────────────
const employeeReport = async (req, res) => {
  try {
    const { department, status } = req.query;
    const filter = {};
    if (department) filter.department = department;
    if (status) filter.status = status;
    if (req.user.role === 'Manager') {
      const team = await managerAssignedEmployees(req.user);
      filter._id = { $in: team.map(employee => employee._id) };
    } else if (req.user.role === 'Employee') {
      const profile = req.user.employeeRef
        ? await Employee.findById(req.user.employeeRef).select('_id').lean()
        : await Employee.findOne({ $or: [{ userId: req.user.id }, { email: req.user.email }] }).select('_id').lean();
      filter._id = profile ? profile._id : null;
    }

    const canViewSalary = req.user.role === 'Admin'
      || (['HR', 'Manager'].includes(req.user.role)
        && (await resolvePermissionsForRole(req.user.role)).permissions['payroll.allRecords'] === true);
    const employees = await Employee.find(filter)
      .select(canViewSalary ? '' : '-salary -hra -allowances -bonus -deductions')
      .sort({ createdAt: -1 })
      .lean();

    if (req.query.format === 'csv') {
      const header = `Name,Email,Phone,Department,Designation,JoiningDate,Status${canViewSalary ? ',Salary ($ USD)' : ''}\n`;
      const rows = employees.map(e => [
        `"${e.name || ''}"`,
        e.email || '',
        e.phone || '',
        `"${e.department || ''}"`,
        `"${e.designation || ''}"`,
        e.joiningDate || '',
        e.status || '',
        ...(canViewSalary ? [`$${Number(e.salary || 0).toLocaleString('en-US')}`] : []),
      ].join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="employee_report.csv"');
      return res.send(header + rows);
    }

    res.json({ success: true, count: employees.length, data: employees });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/departments  — department-wise summary
// ─────────────────────────────────────────────────────────────────────────────
const departmentReport = async (req, res) => {
  try {
    const managerTeam = req.user.role === 'Manager' ? await managerAssignedEmployees(req.user) : null;
    const teamDepartments = managerTeam
      ? Array.from(new Set(managerTeam.map(employee => employee.department).filter(Boolean)))
      : null;
    const departments = await Department.find(managerTeam ? { name: { $in: teamDepartments } } : {})
      .sort({ name: 1 }).lean();
    const empAgg = await Employee.aggregate([
      ...(managerTeam ? [{ $match: { _id: { $in: managerTeam.map(employee => employee._id) } } }] : []),
      { $group: { _id: { dept: '$department', status: '$status' }, count: { $sum: 1 } } },
    ]);

    const summary = {};
    empAgg.forEach(g => {
      const dept = g._id.dept || 'Unassigned';
      if (!summary[dept]) summary[dept] = { name: dept, total: 0, active: 0, inactive: 0, onLeave: 0 };
      summary[dept].total += g.count;
      if (g._id.status === 'active') summary[dept].active += g.count;
      else if (g._id.status === 'inactive') summary[dept].inactive += g.count;
      else if (g._id.status === 'on-leave') summary[dept].onLeave += g.count;
    });

    // Merge in any departments with zero employees
    departments.forEach(d => {
      if (!summary[d.name]) summary[d.name] = { name: d.name, total: 0, active: 0, inactive: 0, onLeave: 0 };
    });

    res.json({ success: true, data: Object.values(summary) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { dashboardMetrics, attendanceReport, leaveReport, employeeReport, departmentReport };
