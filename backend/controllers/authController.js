const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const User   = require('../models/User');
const Employee = require('../models/Employee');
const Notification = require('../models/Notification');
const SystemSetup = require('../models/SystemSetup');
const { publishNotification } = require('../services/notificationEvents');
const { resolveEmployeeForUser } = require('../services/employeeIdentity');
const { resolvePermissionsForRole } = require('./permissionController');

/**
 * Sign a JWT for the given user document.
 * The token contains only the user ID — nothing sensitive.
 * All other user info is re-read from the DB on each request via the protect middleware.
 */
const signToken = (user) =>
  jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

/**
 * Safe public user representation — password hash is never included.
 */
const safeUser = (user) => ({
  id:          user._id.toString(),
  name:        user.name,
  email:       user.email,
  employeeId:  user.employeeId || null,
  mustChangePassword: user.mustChangePassword === true,
  role:        user.role,
  designation: user.designation,
  department:  user.department,
  phone:       user.phone,
  address:     user.address,
  city:        user.city,
  state:       user.state,
  country:     user.country,
  avatar:      user.avatar,
  isActive:    user.isActive,
  registrationStatus: user.registrationStatus,
  accountStatus: user.accountStatus,
  onboardingStatus: user.onboardingStatus,
  personalInfoApprovalStatus: user.personalInfoApprovalStatus,
  documentVerificationStatus: user.documentVerificationStatus,
  registrationIdentityStatus: user.registrationIdentityStatus,
});

const notifyRegistration = async user => {
  const admins = await User.find({ role: 'Admin', isActive: true }).select('_id').lean();
  if (!admins.length) throw new Error('No active Admin is available to review registrations.');
  const submittedAt = user.registrationSubmittedAt || new Date();
  const details = `${user.name} (${user.email})${user.registrationEmployeeId ? ` · Employee ID ${user.registrationEmployeeId}` : ''}`;
  const notifications = await Notification.insertMany([
    ...admins.map(admin => ({
      userId: admin._id,
      employeeId: user.registrationEmployeeId,
      title: 'Employee registration approval pending',
      message: `${details} submitted a registration on ${submittedAt.toLocaleString('en-IN')}. Review the identity and registration details.`,
      type: 'registration',
      requestStatus: 'Pending',
      actionUrl: '/registrations',
    })),
    {
      userId: user._id,
      employeeId: user.registrationEmployeeId,
      title: 'Registration successfully submitted',
      message: `Your registration was submitted on ${submittedAt.toLocaleString('en-IN')} and is awaiting Admin approval.`,
      type: 'registration',
      requestStatus: 'Pending',
      actionUrl: '/login',
    },
  ]);
  notifications.forEach(notification => publishNotification(notification.userId, notification.toObject()));
};

const resolveRegistrationIdentity = async (email, employeeId) => {
  const normalizedEmail = email.toLowerCase().trim();
  const emailPattern = new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const normalizedId = String(employeeId || '').trim().toUpperCase();
  const [emailMatches, idMatches] = await Promise.all([
    Employee.find({ email: emailPattern, isDraft: { $ne: true } }).limit(2).select('_id employeeId status').lean(),
    normalizedId
      ? Employee.find({ employeeId: new RegExp(`^${normalizedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), isDraft: { $ne: true } }).limit(2).select('_id employeeId status').lean()
      : Promise.resolve([]),
  ]);
  if (emailMatches.length === 1 && idMatches.length === 1 && String(emailMatches[0]._id) === String(idMatches[0]._id)) {
    return { status: 'matched', employee: emailMatches[0] };
  }
  const candidates = new Map([...emailMatches, ...idMatches].map(employee => [String(employee._id), employee]));
  return { status: 'needs_review', candidates: [...candidates.values()] };
};

const canAccessEmployeePortal = user => user.registrationStatus === 'approved'
  && user.accountStatus === 'active'
  && user.onboardingStatus === 'completed'
  && user.personalInfoApprovalStatus === 'approved'
  && user.documentVerificationStatus === 'verified';

/**
 * safeUser + the role's effective permission map. Used by login/google/getMe so
 * the frontend receives permissions immediately and can gate UI without re-login.
 */
const safeUserWithPermissions = async (user) => {
  const { permissions, actions } = await resolvePermissionsForRole(user.role);
  let employeeId = user.employeeId || null;
  if (user.role === 'Employee') {
    const linked = await resolveEmployeeForUser(user);
    employeeId = linked.employee?.employeeId || null;
  }
  return { ...safeUser(user), employeeId, permissions, actions };
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────────────────────────────────────
const register = async (req, res) => {
  try {
    const { name, email, password, employeeId } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(String(email).trim())) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }
    const normalizedEmployeeId = String(employeeId || '').trim();
    if (normalizedEmployeeId.length > 64) {
      return res.status(400).json({ success: false, message: 'Employee ID cannot exceed 64 characters.' });
    }
    const normalizedEmail = String(email).toLowerCase().trim();
    const exists = await User.findOne({ email: normalizedEmail }).select('_id').lean();
    if (exists) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists. Sign in or contact Admin.' });
    }
    const identity = await resolveRegistrationIdentity(normalizedEmail, normalizedEmployeeId);
    const duplicateEmployeeId = normalizedEmployeeId
      ? await User.findOne({
        registrationEmployeeId: new RegExp(`^${normalizedEmployeeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        registrationStatus: { $in: ['pending', 'approved'] },
      }).select('_id').lean()
      : null;
    if (duplicateEmployeeId) {
      return res.status(409).json({ success: false, message: 'A registration or account already uses this Employee ID. Contact Admin for identity verification.' });
    }
    if (identity.employee && (identity.employee.status !== 'active' || !identity.employee.employeeId)) {
      identity.status = 'needs_review';
    }
    if (identity.employee) {
      const alreadyClaimed = await User.findOne({
        registrationEmployeeRef: identity.employee._id,
        registrationStatus: { $in: ['pending', 'approved'] },
      }).select('_id').lean();
      const existingLink = await User.findOne({
        $or: [{ employeeRef: identity.employee._id }, { employeeId: identity.employee.employeeId }],
      }).select('_id').lean();
      if (identity.employee.userId || alreadyClaimed || existingLink) {
        return res.status(409).json({
          success: false,
          message: 'This employee record is already linked to or claimed by an account. Ask Admin to verify your identity.',
        });
      }
    }

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      password,
      role: 'Employee',
      isActive: false,
      accountStatus: 'pending',
      registrationStatus: 'pending',
      onboardingStatus: 'not_started',
      personalInfoApprovalStatus: 'not_submitted',
      documentVerificationStatus: 'not_submitted',
      registrationEmployeeId: normalizedEmployeeId,
      registrationEmployeeRef: identity.employee?._id || null,
      registrationIdentityStatus: identity.status,
      registrationSubmittedAt: new Date(),
    });
    try {
      await notifyRegistration(user);
    } catch (notificationError) {
      await User.deleteOne({ _id: user._id });
      console.error('[Registration] Notification could not be saved:', notificationError.message);
      return res.status(503).json({
        success: false,
        code: 'REGISTRATION_NOTIFICATION_FAILED',
        message: 'Your registration could not be sent for Admin review. Please try again later.',
      });
    }
    res.status(202).json({
      success: true,
      pendingApproval: true,
      message: 'Your registration request has been submitted successfully. Please wait for Admin approval.',
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

const getInitialSetupStatus = async (req, res) => {
  try {
    const admin = await User.findOne({ role: 'Admin' }).select('_id').lean();
    if (admin) {
      await SystemSetup.updateOne(
        { _id: 'initial-admin' },
        { $setOnInsert: { completedAt: new Date(), initialAdminId: admin._id, method: 'existing_admin' } },
        { upsert: true },
      );
    }
    const adminExists = await User.exists({ $or: [{ role: 'Admin' }, { isInitialAdmin: true }] })
      || await SystemSetup.exists({ _id: 'initial-admin' });
    const setupConfigured = typeof process.env.INITIAL_ADMIN_SETUP_KEY === 'string'
      && process.env.INITIAL_ADMIN_SETUP_KEY.length >= 32;
    res.json({
      success: true,
      available: !adminExists && setupConfigured,
      requiresSetupKey: !adminExists && setupConfigured,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createInitialAdmin = async (req, res) => {
  try {
    const { name, email, password, setupKey } = req.body;
    const configuredKey = process.env.INITIAL_ADMIN_SETUP_KEY || '';
    if (configuredKey.length < 32) {
      return res.status(503).json({ success: false, message: 'Initial Admin setup is not configured. Set a random INITIAL_ADMIN_SETUP_KEY of at least 32 characters on the server.' });
    }
    const suppliedKey = String(setupKey || '');
    const crypto = require('crypto');
    const keyMatches = Buffer.byteLength(suppliedKey) === Buffer.byteLength(configuredKey)
      && crypto.timingSafeEqual(Buffer.from(suppliedKey), Buffer.from(configuredKey));
    if (!keyMatches) return res.status(403).json({ success: false, message: 'Invalid initial setup key.' });
    if (!name || !email || !password || String(password).length < 8
      || !/^\S+@\S+\.\S+$/.test(String(email).trim())) {
      return res.status(400).json({ success: false, message: 'Enter a name, valid email address, and password of at least 8 characters.' });
    }
    if (await User.exists({ $or: [{ role: 'Admin' }, { isInitialAdmin: true }] })
      || await SystemSetup.exists({ _id: 'initial-admin' })) {
      return res.status(409).json({ success: false, message: 'Initial Admin setup is permanently closed because an Admin account already exists.' });
    }
    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      password,
      role: 'Admin',
      isInitialAdmin: true,
      registrationStatus: 'approved',
      accountStatus: 'active',
      onboardingStatus: 'completed',
      personalInfoApprovalStatus: 'approved',
      documentVerificationStatus: 'verified',
      isActive: true,
    });
    await SystemSetup.updateOne(
      { _id: 'initial-admin' },
      { $setOnInsert: { completedAt: new Date(), initialAdminId: user._id, method: 'secure_setup' } },
      { upsert: true },
    );
    const token = signToken(user);
    res.status(201).json({ success: true, token, user: await safeUserWithPermissions(user) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'An Admin was created concurrently or this email is already in use.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/users   (adminOnly)
// Admin creates an account with an explicit role. Unlike public /register,
// this endpoint honours the chosen role — but only Admin can call it.
//
// Role is restricted to Admin / HR / Manager (Employee accounts are not created
// from the admin "Create New Account" page). Department is mandatory for HR and
// Manager, and must be empty for Admin — enforced here to stay consistent with
// the frontend validation.
// ─────────────────────────────────────────────────────────────────────────────
const CREATABLE_ROLES = ['Admin', 'HR', 'Manager'];

const adminCreateUser = async (req, res) => {
  try {
    const { name, email, password, role, designation, department } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    if (!CREATABLE_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `Role must be one of: ${CREATABLE_ROLES.join(', ')}` });
    }
    if (role === 'Admin' && req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Only an existing Admin can create another Admin account.' });
    }

    // Department rules: required for HR/Manager, forced empty for Admin.
    const deptRequired = role === 'HR' || role === 'Manager';
    if (deptRequired && (!department || !String(department).trim())) {
      return res.status(400).json({ success: false, message: 'Department is required for HR and Manager roles' });
    }
    const finalDepartment = role === 'Admin' ? '' : String(department || '').trim();

    const exists = await User.findOne({ email: email.toLowerCase().trim() });
    if (exists) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists' });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,   // hashed by pre-save hook
      role,
      designation: designation || '',
      department:  finalDepartment,
    });

    const created = await User.findById(user._id).select('-password');
    res.status(201).json({ success: true, user: safeUser(created) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────
const login = async (req, res) => {
  try {
    // Accept either `identifier` (Employee ID OR email) or legacy `email`.
    const rawId = (req.body.identifier ?? req.body.email ?? req.body.employeeId ?? '').toString().trim();
    const { password } = req.body;

    if (!rawId || !password) {
      return res.status(400).json({ success: false, message: 'Employee ID / email and password are required' });
    }

    // Decide how to look the user up. An Employee ID is matched case-insensitively
    // against the employeeId field; anything containing "@" is treated as an email.
    const looksLikeEmail = rawId.includes('@');
    const query = looksLikeEmail
      ? { email: rawId.toLowerCase() }
      : {
        $or: [
          { employeeId: new RegExp(`^${rawId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          { registrationEmployeeId: new RegExp(`^${rawId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        ],
      };

    // Explicitly select password (it has select: false in schema)
    const user = await User.findOne(query).select('+password');
    if (!user) {
      // Same message for unknown id and wrong password — prevents account enumeration
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.registrationStatus === 'pending') {
      return res.status(403).json({ success: false, code: 'REGISTRATION_PENDING', message: 'Your registration is awaiting Admin approval.' });
    }
    if (user.registrationStatus === 'rejected') {
      return res.status(403).json({ success: false, code: 'REGISTRATION_REJECTED', message: 'Your registration was not approved. Contact an administrator.' });
    }
    if (user.accountStatus !== 'active') {
      return res.status(403).json({ success: false, code: 'ACCOUNT_SUSPENDED', message: 'Your account is suspended. Contact an administrator.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Please contact an administrator.' });
    }

    const token = signToken(user);
    res.json({ success: true, token, user: await safeUserWithPermissions(user) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/google   (Google OAuth authorization-code exchange)
//
// Security model:
//   The frontend sends a one-time authorization code from Google Identity
//   Services. The backend exchanges it and verifies Google's signed ID token.
//   No client-supplied identity fields or Google access tokens are trusted.
//
// Account-linking policy:
//   1. If a user already has this googleId linked → authenticate.
//   2. If an existing user has the same verified email and no googleId
//      yet → link the Google identity to that account.
//   3. If an existing user has the same email but a DIFFERENT googleId
//      → reject (do not silently merge).
//   4. No existing user → create a new Employee account (never Admin).
// ─────────────────────────────────────────────────────────────────────────────
const googleLogin = async (req, res) => {
  try {
    const { code } = req.body;
    const origin = req.get('origin');
    if (!code || typeof code !== 'string' || code.length > 4096) {
      return res.status(400).json({ success: false, message: 'A valid Google authorization code is required.' });
    }
    if (req.get('x-requested-with') !== 'XmlHttpRequest' || !origin) {
      return res.status(403).json({ success: false, message: 'Google sign-in request could not be verified. Please retry from the EMS Portal.' });
    }

    const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
    const originAllowed = allowedOrigins.some(value => {
      try {
        return new URL(value).origin === new URL(origin).origin;
      } catch {
        return false;
      }
    });
    if (!originAllowed) {
      return res.status(403).json({ success: false, message: 'Google sign-in is not allowed from this application address.' });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret || clientId === 'your_google_web_client_id_here') {
      console.error('[Google Auth] GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured on the backend.');
      return res.status(503).json({ success: false, message: 'Google sign-in is not configured on the server. Contact an administrator.' });
    }

    // Exchange the short-lived code on the server; do not persist returned tokens.
    let tokens;
    try {
      const client = new OAuth2Client(clientId, clientSecret, origin);
      ({ tokens } = await client.getToken({ code, redirect_uri: origin }));
    } catch (verifyErr) {
      console.error('[Google Auth] Authorization code exchange failed:', verifyErr.message);
      const networkFailure = verifyErr.response?.status >= 500
        || ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(verifyErr.code);
      return res.status(networkFailure ? 503 : 401).json({
        success: false,
        code: networkFailure ? 'GOOGLE_UNAVAILABLE' : 'GOOGLE_CODE_INVALID',
        message: networkFailure
          ? 'Google sign-in is temporarily unavailable. Check your connection and try again.'
          : 'Google sign-in expired or could not be verified. Please select an account and try again.',
      });
    }

    if (!tokens?.id_token) {
      return res.status(401).json({ success: false, code: 'GOOGLE_TOKEN_MISSING', message: 'Google did not return a verified identity. Please try again.' });
    }

    let payload;
    try {
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error('[Google Auth] ID token verification failed:', verifyErr.message);
      const networkFailure = verifyErr.response?.status >= 500
        || ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(verifyErr.code);
      return res.status(networkFailure ? 503 : 401).json({
        success: false,
        code: networkFailure ? 'GOOGLE_UNAVAILABLE' : 'GOOGLE_TOKEN_INVALID',
        message: networkFailure
          ? 'Google sign-in is temporarily unavailable. Check your connection and try again.'
          : 'Google sign-in could not be verified. Please select an account and try again.',
      });
    }

    if (!payload) {
      return res.status(401).json({ success: false, code: 'GOOGLE_TOKEN_INVALID', message: 'Google returned an invalid identity. Please try again.' });
    }

    const googleSub = payload.sub;
    const email = (payload.email || '').toLowerCase().trim();
    const name = payload.name || (email ? email.split('@')[0] : 'Google User');
    const avatar = payload.picture || null;
    const emailVerified = payload.email_verified === true;

    if (!googleSub || !email) {
      return res.status(400).json({ success: false, message: 'Google token is missing required identity fields.' });
    }

    // Require a verified email before allowing account creation or linking
    if (!emailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Your Google account email is not verified. Please verify your email with Google before signing in.',
      });
    }

    // ── Account lookup & linking ──────────────────────────────────────────
    let user = await User.findOne({ googleId: googleSub });
    let isNew = false;

    if (user) {
      // The provider subject is the stable link; never accept profile details from the browser.
    } else {
      const existingByEmail = await User.findOne({ email });

      if (existingByEmail) {
        if (existingByEmail.registrationStatus === 'rejected') {
          return res.status(403).json({ success: false, code: 'REGISTRATION_REJECTED', message: 'Your registration was not approved. Contact an administrator.' });
        }
        if (existingByEmail.accountStatus === 'suspended' || !existingByEmail.isActive && existingByEmail.registrationStatus !== 'pending') {
          return res.status(403).json({ success: false, code: 'ACCOUNT_SUSPENDED', message: 'Your account is suspended or deactivated. Contact an administrator.' });
        }
        if (existingByEmail.googleId && existingByEmail.googleId !== googleSub) {
          return res.status(409).json({
            success: false, code: 'GOOGLE_ACCOUNT_CONFLICT',
            message: 'An account with this email is already linked to a different Google account. Please use the original Google account or sign in with your password.',
          });
        }
        existingByEmail.googleId = googleSub;
        if (avatar && !existingByEmail.avatar) existingByEmail.avatar = avatar;
        await existingByEmail.save();
        user = existingByEmail;
      } else {
        const emailPattern = new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const matches = await Employee.find({ email: emailPattern, isDraft: { $ne: true } }).limit(2);
        const matchingEmployee = matches.length === 1 && matches[0].status === 'active' && matches[0].employeeId
          ? matches[0]
          : null;
        const existingLink = matchingEmployee ? await User.findOne({
          $or: [{ employeeRef: matchingEmployee._id }, { employeeId: matchingEmployee.employeeId }],
        }) : null;
        if (matchingEmployee && (matchingEmployee.userId || existingLink)) {
          return res.status(409).json({ success: false, message: 'This employee record is already linked to a login account. Ask Admin/HR to correct the account mapping.' });
        }
        const randomPwd = require('crypto').randomBytes(32).toString('hex');
        user = await User.create({
          name: name.trim(),
          email,
          password: randomPwd,
          role: 'Employee',
          isActive: false,
          accountStatus: 'pending',
          registrationStatus: 'pending',
          onboardingStatus: 'not_started',
          personalInfoApprovalStatus: 'not_submitted',
          documentVerificationStatus: 'not_submitted',
          registrationEmployeeId: matchingEmployee?.employeeId || '',
          registrationEmployeeRef: matchingEmployee?._id || null,
          registrationIdentityStatus: matchingEmployee ? 'matched' : 'needs_review',
          registrationSubmittedAt: new Date(),
          department: matchingEmployee?.department || '',
          designation: matchingEmployee?.designation || '',
          googleId: googleSub,
          avatar,
        });
        try {
          await notifyRegistration(user);
        } catch (notificationError) {
          await User.deleteOne({ _id: user._id });
          console.error('[Google Auth] Registration notification could not be saved:', notificationError.message);
          return res.status(503).json({
            success: false,
            code: 'REGISTRATION_NOTIFICATION_FAILED',
            message: 'Your registration could not be sent for Admin review. Please try again later.',
          });
        }
        isNew = true;
      }
    }

    if (user.registrationStatus === 'rejected') {
      return res.status(403).json({
        success: false,
        code: 'REGISTRATION_REJECTED',
        message: 'Your registration was not approved. Contact an administrator.',
      });
    }
    if (user.accountStatus === 'suspended') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account is suspended or deactivated. Contact an administrator.',
      });
    }
    if (user.registrationStatus === 'pending' || user.accountStatus === 'pending') {
      return res.status(202).json({
        success: true,
        pendingApproval: true,
        message: 'Your Google identity was verified and your account is awaiting Admin approval. No portal access is available until approval.',
      });
    }
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account is suspended or deactivated. Contact an administrator.',
      });
    }
    if (user.registrationStatus !== 'approved' || user.accountStatus !== 'active') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_NOT_APPROVED',
        message: 'Your account is not approved for sign-in. Contact an administrator.',
      });
    }

    const token = signToken(user);
    res.json({ success: true, token, user: await safeUserWithPermissions(user), isNew });
  } catch (err) {
    console.error('[Google Auth] Error:', err.message);
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        code: 'GOOGLE_ACCOUNT_EXISTS',
        message: 'An account already exists for this Google email. Retry Google sign-in or contact an administrator.',
      });
    }
    res.status(500).json({ success: false, message: 'Google sign-in failed. Please try again.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me   (requires protect middleware)
// ─────────────────────────────────────────────────────────────────────────────
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user: await safeUserWithPermissions(user) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/auth/me   (requires protect middleware)
// Only allows updating safe profile fields — role, isActive, password
// are NOT in the allow-list and cannot be changed through this endpoint.
// ─────────────────────────────────────────────────────────────────────────────
const updateMe = async (req, res) => {
  try {
    const ALLOWED = ['name', 'phone', 'address', 'city', 'state', 'country', 'avatar', 'designation', 'department'];
    const updates = {};
    ALLOWED.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const user = await User.findByIdAndUpdate(req.user.id, updates, {
      new: true, runValidators: true,
    }).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const token = signToken(user);
    res.json({ success: true, message: 'Profile updated successfully', user: safeUser(user), token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/auth/change-password  (requires protect middleware)
// ─────────────────────────────────────────────────────────────────────────────
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    // Explicitly select password
    const user = await User.findById(req.user.id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    user.password = newPassword; // will be hashed by pre-save hook
    user.mustChangePassword = false; // cleared once the employee sets their own password
    await user.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/forgot-password
// Returns a generic success response regardless of whether email exists
// to prevent email enumeration.
// ─────────────────────────────────────────────────────────────────────────────
const forgotPassword = async (req, res) => {
  // In a production deployment this would send an email with a time-limited token.
  // For this self-hosted version we return a safe acknowledgement.
  res.json({
    success: true,
    message: 'If an account with that email exists, a password reset link will be sent shortly.',
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Admin: toggle user active/inactive
// PUT /api/auth/users/:id/status  (adminOnly)
// ─────────────────────────────────────────────────────────────────────────────
const setUserStatus = async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive (boolean) is required' });
    }

    // Prevent an admin from deactivating their own account
    if (req.params.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive, accountStatus: isActive ? 'active' : 'suspended' },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/auth/users/:id/reset-password   (adminOnly: Admin/HR)
// HR/Admin sets a new password for a user (e.g. an employee who forgot theirs).
// The user is flagged to change it on next login.
// ─────────────────────────────────────────────────────────────────────────────
const resetUserPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.params.id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.password = newPassword;          // hashed by pre-save hook
    user.mustChangePassword = true;        // force change on next login
    await user.save();

    res.json({ success: true, message: 'Password reset successfully. The user must change it on next login.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  register, login, googleLogin,
  getInitialSetupStatus, createInitialAdmin,
  getMe, updateMe, changePassword,
  forgotPassword, setUserStatus,
  adminCreateUser, resetUserPassword,
};
