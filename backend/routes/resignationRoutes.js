const express = require('express');
const router = express.Router();
const {
  getResignations,
  getResignationStats,
  getResignation,
  createResignation,
  updateResignation,
  submitResignation,
  withdrawResignation,
  managerReview,
  hrReview,
  finalizeResignation,
  completeResignation,
  deleteResignation,
  downloadAttachment,
} = require('../controllers/resignationController');
const { protect, superAdminOnly } = require('../middleware/auth');
const { checkPermission, checkAction } = require('../middleware/checkPermission');

router.use(protect);

// ── Reads (role-scoped by the controller) ────────────────────────────────────
router.get('/',                     checkPermission('resignation.records'), getResignations);
router.get('/stats',                 checkPermission('resignation.records'), getResignationStats);
router.get('/:id',                   checkPermission('resignation.records'), getResignation);
router.get('/:id/attachment',        checkPermission('resignation.records'), downloadAttachment);

// ── Submitter actions ────────────────────────────────────────────────────────
router.post('/',                     checkAction('resignation', 'add'),     createResignation);
router.put('/:id',                   checkAction('resignation', 'edit'),    updateResignation);
router.put('/:id/submit',            checkAction('resignation', 'add'),     submitResignation);
router.put('/:id/withdraw',          checkAction('resignation', 'edit'),    withdrawResignation);

// ── Review / approval workflow (manage action) ───────────────────────────────
router.put('/:id/manager-review',    checkAction('resignation', 'manage'),  managerReview);
router.put('/:id/hr-review',         checkAction('resignation', 'manage'),  hrReview);
router.put('/:id/finalize',          checkAction('resignation', 'manage'),  finalizeResignation);
router.put('/:id/complete',          checkAction('resignation', 'manage'),  completeResignation);

// ── Admin-only destructive action ────────────────────────────────────────────
router.delete('/:id',                checkAction('resignation', 'delete'),   superAdminOnly, deleteResignation);

module.exports = router;
