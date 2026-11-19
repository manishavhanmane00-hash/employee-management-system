const express = require('express');
const router = express.Router();
const {
  getAdvances,
  getAdvance,
  createAdvance,
  updateAdvance,
  setAdvanceApproval,
  deleteAdvance,
  downloadAdvanceDocument,
} = require('../controllers/advanceController');
const { protect, superAdminOnly } = require('../middleware/auth');
const { checkPermission, checkAction } = require('../middleware/checkPermission');

router.use(protect);

router.get('/',        checkPermission('advances.records'), getAdvances);
router.get('/:id/document', checkPermission('advances.records'), downloadAdvanceDocument);
router.get('/:id',     checkPermission('advances.records'), getAdvance);
router.post('/',       checkAction('advances', 'add'),    createAdvance);
router.put('/:id',     checkAction('advances', 'edit'),   updateAdvance);
router.put('/:id/approval', checkAction('advances', 'manage'), superAdminOnly, setAdvanceApproval);
router.delete('/:id',  checkAction('advances', 'delete'), superAdminOnly, deleteAdvance);

module.exports = router;
