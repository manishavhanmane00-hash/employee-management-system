const express = require('express');
const router = express.Router();
const {
  register, login, googleLogin,
  getInitialSetupStatus, createInitialAdmin,
  getMe, updateMe, changePassword,
  forgotPassword, setUserStatus,
  adminCreateUser, resetUserPassword,
} = require('../controllers/authController');
const { protect, adminOnly, superAdminOnly } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const User = require('../models/User');
const onboardingController = require('../controllers/onboardingController');

// Public routes (rate-limited)
router.get('/setup/status', getInitialSetupStatus);
router.post('/setup/admin', authLimiter, createInitialAdmin);
router.post('/register',        authLimiter, register);
router.post('/login',           authLimiter, login);
router.post('/google',          authLimiter, googleLogin);
router.post('/forgot-password', authLimiter, forgotPassword);

// Protected routes
router.get('/me',                protect, getMe);
router.put('/me',                protect, updateMe);
router.put('/change-password',   protect, changePassword);
router.get('/onboarding', protect, onboardingController.getMyOnboarding);
router.post('/onboarding/welcome', protect, onboardingController.markOnboardingWelcomeSeen);
router.get('/onboarding/documents/:userId', protect, onboardingController.listEmployeeOnboardingDocuments);
router.put('/onboarding', protect, onboardingController.saveMyOnboarding);
router.post('/onboarding/submit', protect, onboardingController.submitMyOnboarding);
router.post('/profile-correction', protect, onboardingController.requestProfileCorrection);

// Admin-only, independent registration and personal-information approval stages.
router.get('/registrations', protect, superAdminOnly, onboardingController.listRegistrationReviews);
router.patch('/registrations/:id/review', protect, superAdminOnly, onboardingController.reviewRegistration);
router.patch('/onboarding/reviews/:id', protect, superAdminOnly, onboardingController.reviewOnboarding);
router.get('/onboarding/documents/:userId/:documentId', protect, onboardingController.getOnboardingDocument);

// Admin: manage user accounts
router.get('/users', protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, count: users.length, data: users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/users/:id/status', protect, adminOnly, setUserStatus);

// Admin/HR: reset a user's password (e.g. for an employee who forgot theirs)
router.put('/users/:id/reset-password', protect, adminOnly, resetUserPassword);

// Admin: create an account with an explicit role (Admin/HR/Manager)
router.post('/users', protect, adminOnly, adminCreateUser);

module.exports = router;
