const express = require('express');
const router = express.Router();
const {
  getOvertime,
  createOvertime,
  updateOvertime,
  settleOvertime,
  setOvertimeApproval,
  deleteOvertime,
} = require('../controllers/overtimeController');
const { protect, superAdminOnly } = require('../middleware/auth');
const { checkPermission, checkAction } = require('../middleware/checkPermission');
const { getPolicyData, assignPolicies } = require('../controllers/overtimePolicyController');

router.use(protect);

router.get('/policies', getPolicyData);
router.put('/policies', superAdminOnly, assignPolicies);
router.get('/',             checkPermission('overtime.records'),    getOvertime);
router.post('/',            checkAction('overtime', 'add'),         createOvertime);
router.put('/:id',          checkAction('overtime', 'edit'),        updateOvertime);
router.put('/:id/approval', checkAction('overtime', 'manage'), superAdminOnly, setOvertimeApproval);
router.put('/:id/settle',   checkAction('overtime', 'manage'), superAdminOnly, settleOvertime);
router.delete('/:id',       checkAction('overtime', 'delete'), superAdminOnly, deleteOvertime);

module.exports = router;
