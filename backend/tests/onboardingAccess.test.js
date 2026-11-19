const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { after, afterEach, before, test } = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const ActivityLog = require('../models/ActivityLog');
const Employee = require('../models/Employee');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { getNotifications } = require('../controllers/notificationController');
const {
  markOnboardingWelcomeSeen, reviewOnboarding, saveMyOnboarding, submitMyOnboarding,
} = require('../controllers/onboardingController');
const { addListener, publishNotification } = require('../services/notificationEvents');

let mongo;
const previousJwtSecret = process.env.JWT_SECRET;

before(async () => {
  process.env.JWT_SECRET = 'onboarding-access-test-secret';
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})));
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
});

const fields = {
  dateOfBirth: '1990-01-02',
  gender: 'Prefer not to say',
  phone: '+1 555 123 4567',
  address: '100 Main Street',
  city: 'Springfield',
  state: 'Illinois',
  country: 'United States',
  emergencyContactName: 'Emergency Contact',
  emergencyContactPhone: '+1 555 987 6543',
};
const documentRecord = () => ({
  id: 'identity-document',
  name: 'identity.pdf',
  mimeType: 'application/pdf',
  size: 12,
  content: Buffer.from('%PDF-1.4 test').toString('base64'),
  uploadedAt: new Date(),
  verificationStatus: 'pending',
  reviewNote: '',
});

const createAdmin = () => User.create({
  name: 'Onboarding Admin', email: 'onboarding-admin@example.test', password: 'test-password', role: 'Admin',
});

const createEmployee = async ({ status = 'submitted', email = 'onboarding-employee@example.test' } = {}) => {
  const user = await User.create({
    name: 'Onboarding Employee', email, password: 'test-password', role: 'Employee',
    registrationStatus: 'approved', accountStatus: 'active', isActive: true,
    registrationEmployeeId: 'EMP-ONBOARD-01', employeeId: 'EMP-ONBOARD-01',
    onboardingStatus: status,
    personalInfoApprovalStatus: status === 'submitted' ? 'pending' : 'correction_required',
    documentVerificationStatus: status === 'submitted' ? 'pending' : 'correction_required',
    onboardingDraft: { fields: { ...fields }, documents: [documentRecord()] },
    onboardingSubmittedAt: new Date(),
  });
  const employee = await Employee.create({
    employeeId: user.employeeId,
    name: user.name,
    email: user.email,
    department: 'Engineering',
    designation: 'Engineer',
    userId: user._id,
    status: 'active',
  });
  user.employeeRef = employee._id;
  await user.save();
  return { user, employee };
};

const callHandler = async (handler, req) => {
  let statusCode = 200;
  let body;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  await handler(req, res);
  return { statusCode, body };
};

const callProtect = async (user, method, path) => {
  let statusCode = 200;
  let body;
  let passed = false;
  const req = {
    headers: { authorization: `Bearer ${jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET)}` },
    method,
    originalUrl: path,
  };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  await protect(req, res, () => { passed = true; });
  return { statusCode, body, passed, user: req.user };
};

const review = (admin, user, decision, note = '') => callHandler(reviewOnboarding, {
  params: { id: String(user._id) },
  user: { id: String(admin._id), _id: admin._id, name: admin.name, role: 'Admin' },
  body: { decision, note },
});

test('pending/rejected registrations are denied and onboarding-only employees cannot call restricted APIs', async () => {
  const pending = await User.create({
    name: 'Pending', email: 'pending@example.test', password: 'test-password', role: 'Employee',
    registrationStatus: 'pending', accountStatus: 'pending', isActive: false,
  });
  const rejected = await User.create({
    name: 'Rejected', email: 'rejected@example.test', password: 'test-password', role: 'Employee',
    registrationStatus: 'rejected', accountStatus: 'suspended', isActive: false,
  });
  const onboarding = await createEmployee({ status: 'in_progress', email: 'in-progress@example.test' });

  const pendingAccess = await callProtect(pending, 'GET', '/api/auth/onboarding');
  assert.equal(pendingAccess.statusCode, 403);
  assert.equal(pendingAccess.body.code, 'REGISTRATION_PENDING');
  const rejectedAccess = await callProtect(rejected, 'GET', '/api/auth/me');
  assert.equal(rejectedAccess.statusCode, 403);
  assert.equal(rejectedAccess.body.code, 'REGISTRATION_REJECTED');

  assert.equal((await callProtect(onboarding.user, 'GET', '/api/auth/onboarding')).passed, true);
  assert.equal((await callProtect(onboarding.user, 'GET', '/api/auth/me')).passed, true);
  assert.equal((await callProtect(onboarding.user, 'PUT', '/api/auth/onboarding')).passed, true);
  assert.equal((await callProtect(onboarding.user, 'POST', '/api/auth/onboarding/submit')).passed, true);
  assert.equal((await callProtect(onboarding.user, 'GET', '/api/notifications')).passed, true);
  assert.equal((await callProtect(onboarding.user, 'GET', '/api/chat/suggestions')).statusCode, 403);
  assert.equal((await callProtect(onboarding.user, 'POST', '/api/chat/tickets')).statusCode, 403);
  assert.equal((await callProtect(onboarding.user, 'GET', '/api/leave')).statusCode, 403);
  assert.equal((await callProtect(onboarding.user, 'PUT', '/api/auth/change-password')).statusCode, 403);
});

test('onboarding draft cannot change its own status and incomplete employees see only onboarding notifications', async () => {
  const user = await User.create({
    name: 'Draft Owner', email: 'draft-owner@example.test', password: 'test-password', role: 'Employee',
    registrationStatus: 'approved', accountStatus: 'active', isActive: true,
    onboardingStatus: 'not_started', personalInfoApprovalStatus: 'not_submitted', documentVerificationStatus: 'not_submitted',
  });
  await Notification.create([
    { userId: user._id, title: 'Registration approved', message: 'Stage 1 complete', type: 'registration' },
    { userId: user._id, title: 'Onboarding pending', message: 'Complete your profile', type: 'onboarding' },
    { userId: user._id, title: 'Private leave update', message: 'Leave request update', type: 'leave' },
  ]);
  const reqUser = { id: String(user._id), _id: user._id, role: 'Employee', name: user.name };

  const draft = await callHandler(saveMyOnboarding, {
    user: reqUser,
    body: { fields: { ...fields }, onboardingStatus: 'completed', personalInfoApprovalStatus: 'approved' },
  });
  assert.equal(draft.statusCode, 200);
  const savedUser = await User.findById(user._id);
  assert.equal(savedUser.onboardingStatus, 'in_progress');
  assert.equal(savedUser.personalInfoApprovalStatus, 'not_submitted');

  const notificationResult = await callHandler(getNotifications, { user: reqUser });
  assert.equal(notificationResult.statusCode, 200);
  assert.deepEqual(notificationResult.body.data.map(item => item.type).sort(), ['onboarding', 'registration']);
});

test('welcome modal acknowledgement persists once on the Employee account', async () => {
  const user = await User.create({
    name: 'Welcome Employee', email: 'welcome@example.test', password: 'test-password', role: 'Employee',
    registrationStatus: 'approved', accountStatus: 'active', isActive: true,
    onboardingStatus: 'not_started', personalInfoApprovalStatus: 'not_submitted', documentVerificationStatus: 'not_submitted',
  });
  const req = { user: { id: String(user._id), role: 'Employee' } };

  const first = await callHandler(markOnboardingWelcomeSeen, req);
  const firstSeenAt = first.body.data.welcomeSeenAt;
  const second = await callHandler(markOnboardingWelcomeSeen, req);
  const savedUser = await User.findById(user._id);

  assert.equal(first.statusCode, 200);
  assert.ok(firstSeenAt);
  assert.equal(second.statusCode, 200);
  assert.equal(new Date(savedUser.onboardingWelcomeSeenAt).toISOString(), new Date(firstSeenAt).toISOString());
});

test('incomplete Employee SSE receives only registration and onboarding events', async () => {
  const user = await User.create({
    name: 'Stream Employee', email: 'stream@example.test', password: 'test-password', role: 'Employee',
    registrationStatus: 'approved', accountStatus: 'active', isActive: true,
    onboardingStatus: 'submitted', personalInfoApprovalStatus: 'pending', documentVerificationStatus: 'pending',
  });
  const written = [];
  let onClose;
  const response = {
    destroyed: false,
    on(event, callback) { if (event === 'close') onClose = callback; },
    write(event) { written.push(event); },
  };
  addListener(user._id, response, {
    filter: notification => ['registration', 'onboarding', 'account'].includes(notification.type),
  });

  publishNotification(user._id, { type: 'leave', message: 'Sensitive leave status' });
  publishNotification(user._id, { type: 'onboarding', message: 'Approval status' });
  response.destroyed = true;
  onClose();

  assert.equal(written.length, 1);
  assert.match(written[0], /Approval status/);
  assert.doesNotMatch(written[0], /Sensitive leave status/);
});

test('Stage 2 approval atomically persists profile, status, audit, history and notifications; repeat is idempotent', async () => {
  const admin = await createAdmin();
  const { user, employee } = await createEmployee();

  const approved = await review(admin, user, 'approve');
  const repeated = await review(admin, user, 'approve');
  const savedUser = await User.findById(user._id).select('+onboardingDraft');
  const savedEmployee = await Employee.findById(employee._id);

  assert.equal(approved.statusCode, 200);
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.body.alreadyReviewed, true);
  assert.equal(savedUser.onboardingStatus, 'completed');
  assert.equal(savedUser.personalInfoApprovalStatus, 'approved');
  assert.equal(savedUser.documentVerificationStatus, 'verified');
  assert.equal(savedUser.isActive, true);
  assert.equal(savedUser.onboardingReviewHistory.length, 1);
  assert.equal(savedUser.onboardingReviewHistory[0].reviewedByName, admin.name);
  assert.equal(savedEmployee.dob, fields.dateOfBirth);
  assert.equal(savedEmployee.emergencyContactName, fields.emergencyContactName);
  assert.equal(await ActivityLog.countDocuments({ action: 'personal_information_approved' }), 1);
  assert.equal(await Notification.countDocuments({ userId: user._id, type: 'account' }), 1);
  assert.equal((await callProtect(savedUser, 'GET', '/api/leave')).passed, true);
});

test('Stage 2 correction requires reason, preserves correction workflow and permits resubmission', async () => {
  const admin = await createAdmin();
  const { user } = await createEmployee();

  const missingReason = await review(admin, user, 'correction');
  assert.equal(missingReason.statusCode, 400);
  assert.equal((await User.findById(user._id)).onboardingStatus, 'submitted');

  const correction = await review(admin, user, 'correction', 'Correct emergency contact phone');
  assert.equal(correction.statusCode, 200);
  let saved = await User.findById(user._id).select('+onboardingDraft');
  assert.equal(saved.onboardingStatus, 'correction_required');
  assert.equal(saved.onboardingReviewHistory.length, 1);
  assert.equal((await callProtect(saved, 'GET', '/api/payroll')).statusCode, 403);

  const employeeRequest = { id: String(user._id), _id: user._id, role: 'Employee', name: user.name };
  const resaved = await callHandler(saveMyOnboarding, {
    user: employeeRequest,
    body: { fields: { ...fields, address: '200 Updated Address' } },
  });
  assert.equal(resaved.statusCode, 200);
  const resubmitted = await callHandler(submitMyOnboarding, { user: employeeRequest, body: {} });
  assert.equal(resubmitted.statusCode, 200);
  saved = await User.findById(user._id);
  assert.equal(saved.onboardingStatus, 'submitted');
  assert.equal(saved.personalInfoApprovalStatus, 'pending');

  const approved = await review(admin, saved, 'approve');
  saved = await User.findById(user._id);
  assert.equal(approved.statusCode, 200);
  assert.equal(saved.onboardingStatus, 'completed');
  assert.equal(saved.personalInfoApprovalStatus, 'approved');
  assert.equal(saved.documentVerificationStatus, 'verified');
  assert.equal(saved.onboardingReviewHistory.length, 2);
});
