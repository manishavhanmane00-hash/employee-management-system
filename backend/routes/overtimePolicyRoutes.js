const express = require('express');
const { protect, superAdminOnly } = require('../middleware/auth');
const { getPolicyData, assignPolicies } = require('../controllers/overtimePolicyController');

const router = express.Router();
router.use(protect);
router.get('/', getPolicyData);
router.put('/', superAdminOnly, assignPolicies);

module.exports = router;
