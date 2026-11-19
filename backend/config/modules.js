/**
 * Canonical registry of EMS modules/tabs that can be permission-gated.
 *
 * This is the single source of truth shared by:
 *  - the RolePermission model (default map + validation),
 *  - the permission controller (seeding + sanitisation),
 *  - the checkPermission middleware (backend API enforcement).
 *
 * The frontend mirrors this list in src/config/modules.js for the toggle UI.
 * Keys are stable identifiers; labels are for display only.
 *
 * NOTE: Admin is intentionally NOT configurable — Admin always has full access.
 * Only HR, Manager, and Employee roles are permission-managed.
 */

// Each module may declare submodules. A submodule is gated independently but a
// parent being OFF hides the whole group on the frontend.
const MODULES = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    submodules: [],
  },
  {
    key: 'employees',
    label: 'Employees',
    submodules: [
      { key: 'employees.list', label: 'Employee List' },
      { key: 'employees.add', label: 'Add Employee' },
      { key: 'employees.documents', label: 'Employee Documents' },
    ],
  },
  {
    key: 'departments',
    label: 'Departments',
    submodules: [
      { key: 'departments.departments', label: 'Departments' },
      { key: 'departments.roles', label: 'Roles & Designations' },
    ],
  },
  {
    key: 'attendance',
    label: 'Attendance',
    submodules: [
      { key: 'attendance.daily', label: 'Daily Attendance' },
      { key: 'attendance.history', label: 'Attendance History' },
      { key: 'attendance.reports', label: 'Attendance Reports' },
    ],
  },
  {
    key: 'leave',
    label: 'Leave Management',
    submodules: [
      { key: 'leave.requests', label: 'Leave Requests' },
      { key: 'leave.apply', label: 'Apply Leave' },
      { key: 'leave.approval', label: 'Leave Approval' },
      { key: 'leave.balance', label: 'Leave Balance' },
    ],
  },
  {
    key: 'holidays',
    label: 'Holidays',
    submodules: [
      { key: 'holidays.records', label: 'Holiday Records' },
      { key: 'holidays.calendar', label: 'Holiday Calendar' },
    ],
  },
  {
    key: 'overtime',
    label: 'Overtime',
    submodules: [
      { key: 'overtime.records', label: 'Overtime Records' },
    ],
  },
  {
    key: 'advances',
    label: 'Advances',
    submodules: [
      { key: 'advances.records', label: 'Advance Records' },
    ],
  },
  {
    key: 'resignation',
    label: 'Resignation Letter',
    submodules: [
      { key: 'resignation.records', label: 'Resignation Records' },
      { key: 'resignation.apply', label: 'Submit Resignation' },
      { key: 'resignation.approval', label: 'Resignation Approval' },
    ],
  },
  {
    key: 'payroll',
    label: 'Salary Management',
    submodules: [
      { key: 'payroll.salary', label: 'Salary Structure' },
      { key: 'payroll.generate', label: 'Generate Salaries' },
      { key: 'payroll.history', label: 'Salary History' },
      { key: 'payroll.payslips', label: 'Payslips' },
      { key: 'payroll.allRecords', label: 'View All Salary Records' },
    ],
  },
  {
    key: 'allowances',
    label: 'Allowance Management',
    submodules: [{ key: 'allowances.records', label: 'Allowances' }],
  },
  {
    key: 'pf',
    label: 'Provident Fund',
    submodules: [
      { key: 'pf.records', label: 'PF Management' },
      { key: 'pf.settings', label: 'PF Configuration' },
      { key: 'pf.sensitive', label: 'Sensitive PF Information' },
    ],
  },
  {
    key: 'insurance',
    label: 'Insurance Management',
    submodules: [
      { key: 'insurance.records', label: 'Insurance Policies' },
      { key: 'insurance.sensitive', label: 'Sensitive Policy Information' },
    ],
  },
  {
    key: 'performance',
    label: 'Performance',
    submodules: [
      { key: 'performance.reviews', label: 'Performance Reviews' },
      { key: 'performance.goals', label: 'Goals & KPIs' },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    submodules: [],
  },
  {
    key: 'chatbot',
    label: 'EMS Assistant',
    submodules: [
      { key: 'chatbot.tickets', label: 'Manage Support Tickets' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    submodules: [],
  },
];

// Roles whose permissions are configurable by the Admin.
const MANAGED_ROLES = ['HR', 'Manager', 'Employee'];

// CRUD + manage actions configurable per top-level module.
//  - view:   can open/read the module
//  - add:    can create records
//  - edit:   can update records
//  - delete: can remove records
//  - manage: elevated actions (approve/settle/generate/status changes, etc.)
const ACTIONS = ['view', 'add', 'edit', 'delete', 'manage'];

// Top-level module keys (actions are tracked at the module level, not submodule).
const MODULE_KEYS = MODULES.map(m => m.key);

// Flattened list of every permission key (modules + submodules).
const ALL_PERMISSION_KEYS = MODULES.reduce((acc, m) => {
  acc.push(m.key);
  for (const s of m.submodules) acc.push(s.key);
  return acc;
}, []);

/**
 * Sensible defaults per managed role. Anything not listed defaults to the
 * role's fallback (true for HR, selective for Manager/Employee). These mirror
 * the previous hard-coded behaviour so existing access is preserved on first run.
 */
const DEFAULT_PERMISSIONS = {
  HR: {
    all: true, // HR starts with broad access; Admin can trim
    overrides: {
      settings: false, 'settings': false, 'pf.settings': false, 'payroll.allRecords': false,
    },
  },
  Manager: {
    all: false,
    enabled: [
      'dashboard',
      'chatbot',
      'employees', 'employees.list',
      'attendance', 'attendance.daily', 'attendance.history', 'attendance.reports',
      'leave', 'leave.requests', 'leave.approval', 'leave.balance',
      'holidays', 'holidays.records', 'holidays.calendar',
      'overtime', 'overtime.records',
      'advances', 'advances.records',
      'performance', 'performance.reviews', 'performance.goals',
      'reports',
      'resignation', 'resignation.records', 'resignation.approval',
    ],
  },
  Employee: {
    all: false,
    enabled: [
      'dashboard',
      'chatbot',
      'leave', 'leave.apply', 'leave.balance',
      'holidays', 'holidays.calendar',
      'overtime', 'overtime.records',
      'advances', 'advances.records',
      'allowances', 'allowances.records',
      'pf', 'pf.records',
      'insurance', 'insurance.records',
      'resignation', 'resignation.records', 'resignation.apply',
    ],
  },
};

/**
 * Build the full default permission map ({ key: boolean }) for a managed role.
 */
function defaultMapForRole(role) {
  const cfg = DEFAULT_PERMISSIONS[role] || { all: false, enabled: [] };
  const map = {};
  for (const key of ALL_PERMISSION_KEYS) {
    if (cfg.all) {
      map[key] = cfg.overrides && key in cfg.overrides ? cfg.overrides[key] : true;
    } else {
      map[key] = Array.isArray(cfg.enabled) && cfg.enabled.includes(key);
    }
  }
  return map;
}

/**
 * Build the default ACTION map for a managed role:
 *   { moduleKey: { view, add, edit, delete, manage } }
 *
 * Defaults are derived from the module-level default map:
 *  - If a role can see a module (view=true), it gets `view`.
 *  - HR (broad access) additionally gets add/edit/delete/manage on viewable modules.
 *  - Manager gets add/edit/manage (no delete) on viewable operational modules.
 *  - Employee gets only `view` plus `add` on self-service modules (leave/overtime/advances),
 *    reflecting the existing "apply/log/request" behaviour; no edit/delete/manage.
 * Admin is never stored — Admin always has every action.
 */
function actionsDefaultForRole(role) {
  const moduleMap = defaultMapForRole(role);
  const out = {};
  for (const key of MODULE_KEYS) {
    const canView = moduleMap[key] === true;
    let a = { view: canView, add: false, edit: false, delete: false, manage: false };
    if (canView) {
      if (role === 'HR') {
        a = { view: true, add: true, edit: true, delete: true, manage: true };
        if (key === 'pf') a.manage = false;
      } else if (role === 'Manager') {
        a = { view: true, add: true, edit: true, delete: false, manage: true };
      } else if (role === 'Employee') {
        const selfService = ['leave', 'overtime', 'advances'].includes(key);
        // Employees may submit AND edit/withdraw their own resignation letters.
        const resignationSelf = key === 'resignation';
        a = { view: true, add: selfService || resignationSelf, edit: resignationSelf, delete: false, manage: false };
      }
    }
    out[key] = a;
  }
  return out;
}

module.exports = {
  MODULES,
  MANAGED_ROLES,
  ACTIONS,
  MODULE_KEYS,
  ALL_PERMISSION_KEYS,
  DEFAULT_PERMISSIONS,
  defaultMapForRole,
  actionsDefaultForRole,
};
