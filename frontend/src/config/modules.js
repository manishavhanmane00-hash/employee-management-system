/**
 * Frontend mirror of backend/config/modules.js.
 *
 * Single source of truth for the permission toggle UI (Settings → Roles &
 * Permissions) and for mapping routes/sidebar items to permission keys.
 * Keep in sync with the backend registry.
 */

export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', submodules: [] },
  {
    key: 'employees', label: 'Employees', submodules: [
      { key: 'employees.list', label: 'Employee List' },
      { key: 'employees.add', label: 'Add Employee' },
      { key: 'employees.documents', label: 'Employee Documents' },
    ],
  },
  {
    key: 'departments', label: 'Departments', submodules: [
      { key: 'departments.departments', label: 'Departments' },
      { key: 'departments.roles', label: 'Roles & Designations' },
    ],
  },
  {
    key: 'attendance', label: 'Attendance', submodules: [
      { key: 'attendance.daily', label: 'Daily Attendance' },
      { key: 'attendance.history', label: 'Attendance History' },
      { key: 'attendance.reports', label: 'Attendance Reports' },
    ],
  },
  {
    key: 'leave', label: 'Leave Management', submodules: [
      { key: 'leave.requests', label: 'Leave Requests' },
      { key: 'leave.apply', label: 'Apply Leave' },
      { key: 'leave.approval', label: 'Leave Approval' },
      { key: 'leave.balance', label: 'Leave Balance' },
    ],
  },
  {
    key: 'holidays', label: 'Holidays', submodules: [
      { key: 'holidays.records', label: 'Holiday Records' },
      { key: 'holidays.calendar', label: 'Holiday Calendar' },
    ],
  },
  {
    key: 'overtime', label: 'Overtime', submodules: [
      { key: 'overtime.records', label: 'Overtime Records' },
    ],
  },
  {
    key: 'advances', label: 'Advances', submodules: [
      { key: 'advances.records', label: 'Advance Records' },
    ],
  },
  {
    key: 'resignation', label: 'Resignation Letter', submodules: [
      { key: 'resignation.records', label: 'Resignation Records' },
      { key: 'resignation.apply', label: 'Submit Resignation' },
      { key: 'resignation.approval', label: 'Resignation Approval' },
    ],
  },
  {
    key: 'payroll', label: 'Salary Management', submodules: [
      { key: 'payroll.salary', label: 'Salary Structure' },
      { key: 'payroll.generate', label: 'Generate Salaries' },
      { key: 'payroll.history', label: 'Salary History' },
      { key: 'payroll.payslips', label: 'Payslips' },
      { key: 'payroll.allRecords', label: 'View All Salary Records' },
    ],
  },
  { key: 'allowances', label: 'Allowance Management', submodules: [
    { key: 'allowances.records', label: 'Allowances' },
  ] },
  { key: 'pf', label: 'Provident Fund', submodules: [
    { key: 'pf.records', label: 'PF Management' },
    { key: 'pf.settings', label: 'PF Configuration' },
    { key: 'pf.sensitive', label: 'Sensitive PF Information' },
  ] },
  { key: 'insurance', label: 'Insurance Management', submodules: [
    { key: 'insurance.records', label: 'Insurance Policies' },
    { key: 'insurance.sensitive', label: 'Sensitive Policy Information' },
  ] },
  {
    key: 'performance', label: 'Performance', submodules: [
      { key: 'performance.reviews', label: 'Performance Reviews' },
      { key: 'performance.goals', label: 'Goals & KPIs' },
    ],
  },
  { key: 'reports', label: 'Reports', submodules: [] },
  { key: 'chatbot', label: 'EMS Assistant', submodules: [
    { key: 'chatbot.tickets', label: 'Manage Support Tickets' },
  ] },
  { key: 'settings', label: 'Settings', submodules: [] },
];

export const MANAGED_ROLES = ['HR', 'Manager', 'Employee'];

// CRUD + manage actions configurable per top-level module (mirrors backend).
export const ACTIONS = ['view', 'add', 'edit', 'delete', 'manage'];
export const ACTION_LABELS = {
  view: 'View', add: 'Add', edit: 'Edit', delete: 'Delete', manage: 'Manage',
};

// Flattened list of every permission key (modules + submodules).
export const ALL_PERMISSION_KEYS = MODULES.reduce((acc, m) => {
  acc.push(m.key);
  for (const s of m.submodules) acc.push(s.key);
  return acc;
}, []);

/**
 * Map an app route path to the permission key that gates it. Used by the route
 * guard. The most specific match wins.
 */
export const ROUTE_PERMISSION_MAP = {
  '/dashboard': 'dashboard',
  '/employees/list': 'employees.list',
  '/employees/team': 'employees.list',
  '/employees/add': 'employees.add',
  '/employees': 'employees',
  '/departments': 'departments.departments',
  '/roles': 'departments.roles',
  '/attendance/daily': 'attendance.daily',
  '/attendance/history': 'attendance.history',
  '/attendance/reports': 'attendance.reports',
  '/leave/requests': 'leave.requests',
  '/leave/apply': 'leave.apply',
  '/leave/approval': 'leave.approval',
  '/leave/balance': 'leave.balance',
  '/holidays/records': 'holidays.records',
  '/holidays/calendar': 'holidays.calendar',
  '/overtime/records': 'overtime.records',
  '/advances/records': 'advances.records',
  '/resignation': 'resignation.records',
  '/employee/resignation': 'resignation.records',
  '/payroll/salary': 'payroll.allRecords',
  '/payroll/generate': 'payroll.allRecords',
  '/payroll/history': 'payroll.allRecords',
  '/payroll/payslips': 'payroll.allRecords',
  '/allowances': 'allowances.records',
  '/pf': 'pf.records',
  '/insurance': 'insurance.records',
  '/performance/reviews': 'performance.reviews',
  '/performance/goals': 'performance.goals',
  '/reports': 'reports',
  '/chatbot': 'chatbot.tickets',
  '/settings': 'settings',
  '/activity-logs': 'settings',
};
