const express = require('express');
const router = express.Router();
const { protect, superAdminOnly } = require('../middleware/auth');
const { checkPermission, checkAction, checkPermissionOrAction } = require('../middleware/checkPermission');
const {
  getEligibleBenefitUsers, getAllowanceTypes, createAllowanceType, getAllowances, saveAllowance, deactivateAllowance,
  getPFConfiguration, createPFConfiguration, updatePFConfiguration, getPFRecords, savePFProfile, calculatePF,
  getInsurance, saveInsurance, updateInsuranceStatus, uploadInsuranceDocument, downloadInsuranceDocument,
  getActivityLogs,
} = require('../controllers/benefitsController');

router.use(protect);

router.get('/eligible-users', getEligibleBenefitUsers);
router.get('/allowances/types', checkPermission('allowances.records'), getAllowanceTypes);
router.post('/allowances/types', checkAction('allowances', 'manage'), createAllowanceType);
router.get('/allowances', checkPermission('allowances.records'), getAllowances);
router.post('/allowances', checkAction('allowances', 'add'), saveAllowance);
router.put('/allowances/:id', checkAction('allowances', 'edit'), saveAllowance);
router.delete('/allowances/:id', checkAction('allowances', 'delete'), deactivateAllowance);

router.get('/pf/configuration', checkPermissionOrAction('pf.settings', 'pf', 'manage'), getPFConfiguration);
router.post('/pf/configuration', checkAction('pf', 'manage'), createPFConfiguration);
router.put('/pf/configuration/:id', checkAction('pf', 'manage'), updatePFConfiguration);
router.get('/pf', checkPermission('pf.records'), getPFRecords);
router.post('/pf/profiles', checkAction('pf', 'add'), savePFProfile);
router.put('/pf/profiles/:employeeId', checkAction('pf', 'edit'), savePFProfile);
router.post('/pf/contributions/calculate', checkAction('pf', 'manage'), calculatePF);

router.get('/insurance', checkPermission('insurance.records'), getInsurance);
router.post('/insurance', checkAction('insurance', 'add'), saveInsurance);
router.put('/insurance/:id', checkAction('insurance', 'edit'), saveInsurance);
router.patch('/insurance/:id/status', checkAction('insurance', 'manage'), updateInsuranceStatus);
router.post('/insurance/:id/documents', checkAction('insurance', 'edit'), uploadInsuranceDocument);
router.get('/insurance/:id/documents/:filename', checkPermission('insurance.records'), downloadInsuranceDocument);

router.get('/activity-logs', superAdminOnly, getActivityLogs);

module.exports = router;
