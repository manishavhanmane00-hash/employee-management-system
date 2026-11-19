const express = require('express');
const router = express.Router();
const { getPayroll, getPayrollPreview, generatePayroll, approvePayroll, markPayrollPaid } = require('../controllers/payrollController');
const { protect } = require('../middleware/auth');
const { checkPermission, checkAction } = require('../middleware/checkPermission');

router.use(protect);

router.get('/', getPayroll);
router.post('/preview',     checkPermission('payroll.allRecords'),                              getPayrollPreview);
router.post('/',            checkPermission('payroll.allRecords'), checkAction('payroll', 'add'),    generatePayroll);
router.put('/:id/approve',  checkPermission('payroll.allRecords'), checkAction('payroll', 'manage'), approvePayroll);
router.put('/:id/pay',      checkPermission('payroll.allRecords'), checkAction('payroll', 'manage'), markPayrollPaid);

module.exports = router;
