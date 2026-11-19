const express = require('express');
const router = express.Router();
const {
  getEmployees,
  getEmployeeById,
  getMyEmployeeRecord,
  getEmployeeOptions,
  getTeam,
  setReportingManager,
  getEmployeeAccounts,
  linkEmployeeAccountRecord,
  createEmployee,
  updateEmployee,
  setEmployeeStatus,
  deleteEmployee,
  getDrafts,
  getDraftById,
  saveDraft,
  deleteDraft,
} = require('../controllers/employeeController');
const { protect } = require('../middleware/auth');
const { checkPermission, checkAction } = require('../middleware/checkPermission');

// All employee routes require authentication
router.use(protect);

const employeeListAccess = (req, res, next) => {
  if (req.user.role === 'Employee') return next();
  return checkPermission('employees')(req, res, next);
};

// Current user's own employee record (employee self-service — no module permission needed)
router.get('/me', getMyEmployeeRecord);
router.get('/options', checkPermission('employees'), getEmployeeOptions);
router.get('/team', checkAction('employees', 'view'), getTeam);
router.get('/accounts', checkAction('employees', 'edit'), getEmployeeAccounts);

// ── Draft routes (must be declared before '/:id' to avoid route conflicts) ────
// Drafts are created/edited by anyone allowed to add employees.
router.route('/drafts')
  .get(checkAction('employees', 'add'), getDrafts)
  .post(checkAction('employees', 'add'), saveDraft);

router.route('/drafts/:id')
  .get(checkAction('employees', 'add'), getDraftById)
  .put(checkAction('employees', 'add'), saveDraft)
  .delete(checkAction('employees', 'add'), deleteDraft);

router.route('/')
  .get(employeeListAccess, getEmployees)
  .post(checkAction('employees', 'add'), createEmployee);

// Status toggle must come before /:id to avoid route conflict
router.patch('/:id/status', checkAction('employees', 'manage'), setEmployeeStatus);
router.patch('/:id/account', checkAction('employees', 'edit'), linkEmployeeAccountRecord);
router.patch('/:id/manager', checkAction('employees', 'manage'), setReportingManager);

router.route('/:id')
  .get(getEmployeeById)
  .put(checkAction('employees', 'edit'), updateEmployee)
  .delete(checkAction('employees', 'delete'), deleteEmployee);

module.exports = router;
