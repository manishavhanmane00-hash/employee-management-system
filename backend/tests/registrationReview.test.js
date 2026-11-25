const assert = require('node:assert/strict');
const { after, afterEach, before, test } = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const ActivityLog = require('../models/ActivityLog');
const Employee = require('../models/Employee');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { ensureUniqueEmployeeAccountMappings } = require('../services/employeeAccountIndexes');
const { resolveRequestIdentity } = require('../services/employeeIdentity');
const { login, register } = require('../controllers/authController');
const { reviewRegistration } = require('../controllers/onboardingController');

let mongo;
const previousJwtSecret = process.env.JWT_SECRET;

before(async () => {
  process.env.JWT_SECRET = 'registration-test-secret';
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([ActivityLog.init(), Employee.init(), Notification.init(), User.init()]);
  await ensureUniqueEmployeeAccountMappings();
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

const createAdmin = () => User.create({
  name: 'Test Admin', email: 'admin@example.test', password: 'test-password', role: 'Admin',
});

const createPendingRegistration = async ({ email = 'new.employee@example.test', employeeId = 'EMP-TEST-21' } = {}) => {
  const employee = await Employee.create({
    employeeId,
    name: 'New Employee',
    email,
    department: 'Engineering',
    designation: 'Engineer',
    status: 'active',
  });
  const user = await User.create({
    name: 'New Employee', email, password: 'test-password', role: 'Employee',
    registrationStatus: 'pending', accountStatus: 'pending', isActive: false,
    registrationEmployeeId: employeeId, registrationEmployeeRef: employee._id,
    registrationIdentityStatus: 'matched', registrationSubmittedAt: new Date(),
  });
  return { employee, user };
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

const review = (admin, user, decision, overrides = {}) => callHandler(reviewRegistration, {
  params: { id: String(user._id) },
  user: { _id: admin._id, id: String(admin._id), name: admin.name, role: 'Admin' },
  body: { decision, employeeId: user.registrationEmployeeId, note: decision === 'reject' ? 'Identity could not be verified' : '', ...overrides },
});

const attemptLogin = user => callHandler(login, {
  body: { identifier: user.email, password: 'test-password' },
});

test('email registration can be submitted without an Employee ID for Admin review', async () => {
  const admin = await createAdmin();

  const result = await callHandler(register, {
    body: {
      name: 'New Applicant',
      email: 'new.applicant@example.test',
      password: 'test-password',
    },
  });
  const user = await User.findOne({ email: 'new.applicant@example.test' });

  assert.equal(result.statusCode, 202, JSON.stringify(result.body));
  assert.equal(result.body.pendingApproval, true);
  assert.ok(user);
  assert.equal(user.registrationEmployeeId, '');
  assert.equal(user.registrationEmployeeRef, null);
  assert.equal(user.registrationIdentityStatus, 'needs_review');
  assert.equal(await Notification.countDocuments({ userId: user._id, type: 'registration' }), 1);
  assert.equal(result.body.message, 'Your registration request has been submitted successfully. Please wait for Admin approval.');

  const pendingLogin = await attemptLogin(user);
  assert.equal(pendingLogin.statusCode, 403);
  assert.equal(pendingLogin.body.code, 'REGISTRATION_PENDING');

  const approval = await callHandler(reviewRegistration, {
    params: { id: String(user._id) },
    user: { _id: admin._id, id: String(admin._id), name: admin.name, role: 'Admin' },
    body: { decision: 'approve' },
  });
  const approvedUser = await User.findById(user._id);
  const approvedLogin = await attemptLogin(approvedUser);

  assert.equal(approval.statusCode, 200, JSON.stringify(approval.body));
  assert.equal(approvedUser.registrationStatus, 'approved');
  assert.equal(approvedUser.employeeRef, null);
  assert.equal(approvedUser.employeeId, undefined);
  assert.equal(approvedUser.registrationIdentityStatus, 'needs_review');
  assert.equal(approvedLogin.statusCode, 200, JSON.stringify(approvedLogin.body));
});

test('registration with an Employee ID continues to match the employee record', async () => {
  await createAdmin();
  const employee = await Employee.create({
    employeeId: 'EMP-REGISTER-01',
    name: 'Existing Employee',
    email: 'existing.employee@example.test',
    department: 'Engineering',
    designation: 'Engineer',
    status: 'active',
  });

  const result = await callHandler(register, {
    body: {
      name: employee.name,
      email: employee.email,
      employeeId: employee.employeeId,
      password: 'test-password',
    },
  });
  const user = await User.findOne({ email: employee.email });

  assert.equal(result.statusCode, 202, JSON.stringify(result.body));
  assert.equal(user.registrationIdentityStatus, 'matched');
  assert.equal(String(user.registrationEmployeeRef), String(employee._id));
});

test('repeated and concurrent approvals are idempotent and create one employee link', async () => {
  const admin = await createAdmin();
  const { employee, user } = await createPendingRegistration();

  const concurrent = await Promise.all([
    review(admin, user, 'approve'),
    review(admin, user, 'approve'),
  ]);
  const repeated = await review(admin, user, 'approve');
  const savedUser = await User.findById(user._id);
  const savedEmployee = await Employee.findById(employee._id);

  assert.ok(concurrent.every(result => result.statusCode === 200), JSON.stringify(concurrent));
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.body.alreadyReviewed, true);
  assert.equal(savedUser.registrationStatus, 'approved');
  assert.equal(String(savedUser.employeeRef), String(employee._id));
  assert.equal(String(savedEmployee.userId), String(user._id));
  assert.equal(await User.countDocuments({ employeeRef: employee._id }), 1);
  assert.equal(savedUser.registrationReviewHistory.length, 1);
  assert.equal(await ActivityLog.countDocuments({ action: 'registration_approve' }), 1);
  assert.equal(await Notification.countDocuments({ userId: user._id, type: 'registration' }), 1);
  const loginResult = await attemptLogin(savedUser);
  assert.equal(loginResult.statusCode, 200, JSON.stringify(loginResult.body));
});

test('registration approval falls back when Mongo transactions are unavailable', async () => {
  const admin = await createAdmin();
  const { employee, user } = await createPendingRegistration({ email: 'fallback.employee@example.test', employeeId: 'EMP-TEST-25' });
  const originalStartSession = mongoose.startSession;
  mongoose.startSession = async () => ({
    withTransaction: async () => {
      throw Object.assign(new Error('Transaction numbers are only allowed on a replica set member or mongos'), { code: 20 });
    },
    endSession: async () => {},
  });

  try {
    const result = await review(admin, user, 'approve');
    const savedUser = await User.findById(user._id);
    const savedEmployee = await Employee.findById(employee._id);

    assert.equal(result.statusCode, 200);
    assert.equal(savedUser.registrationStatus, 'approved');
    assert.equal(String(savedUser.employeeRef), String(employee._id));
    assert.equal(String(savedEmployee.userId), String(user._id));
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test('rejection requires a reason, is audited, and prevents password login', async () => {
  const admin = await createAdmin();
  const { user } = await createPendingRegistration({ email: 'rejected.employee@example.test', employeeId: 'EMP-TEST-22' });

  const pendingLogin = await attemptLogin(user);
  assert.equal(pendingLogin.statusCode, 403);
  assert.equal(pendingLogin.body.code, 'REGISTRATION_PENDING');

  const missingReason = await review(admin, user, 'reject', { note: '' });
  assert.equal(missingReason.statusCode, 400);
  assert.equal((await User.findById(user._id)).registrationStatus, 'pending');

  const rejected = await review(admin, user, 'reject');
  const savedUser = await User.findById(user._id);
  const rejectedLogin = await attemptLogin(savedUser);

  assert.equal(rejected.statusCode, 200);
  assert.equal(savedUser.registrationStatus, 'rejected');
  assert.equal(savedUser.accountStatus, 'suspended');
  assert.equal(savedUser.isActive, false);
  assert.equal(savedUser.registrationReviewHistory[0].note, 'Identity could not be verified');
  assert.equal(rejectedLogin.statusCode, 403);
  assert.equal(rejectedLogin.body.code, 'REGISTRATION_REJECTED');
});

test('approval failure rolls back account and employee links', async () => {
  const admin = await createAdmin();
  const { employee, user } = await createPendingRegistration({ email: 'rollback.employee@example.test', employeeId: 'EMP-TEST-23' });
  const originalSave = Employee.prototype.save;
  Employee.prototype.save = function saveWithInjectedFailure(...args) {
    if (this.employeeId === employee.employeeId && String(this.userId) === String(user._id)) {
      return Promise.reject(new Error('Injected employee write failure'));
    }
    return originalSave.apply(this, args);
  };

  let result;
  try {
    result = await review(admin, user, 'approve');
  } finally {
    Employee.prototype.save = originalSave;
  }
  const savedUser = await User.findById(user._id);
  const savedEmployee = await Employee.findById(employee._id);

  assert.equal(result.statusCode, 500);
  assert.equal(savedUser.registrationStatus, 'pending');
  assert.equal(savedUser.accountStatus, 'pending');
  assert.equal(savedUser.employeeRef, null);
  assert.equal(savedEmployee.userId, null);
  assert.equal(await ActivityLog.countDocuments({ action: 'registration_approve' }), 0);
  assert.equal(await Notification.countDocuments({ userId: user._id, type: 'registration' }), 0);
});

test('same-email registrations are rejected by the database unique constraint', async () => {
  const user = await User.create({
    name: 'Existing Applicant', email: 'duplicate@example.test', password: 'test-password',
    role: 'Employee', registrationStatus: 'pending', accountStatus: 'pending', isActive: false,
  });

  await assert.rejects(() => User.create({
    name: 'Duplicate Applicant', email: user.email, password: 'test-password',
    role: 'Employee', registrationStatus: 'pending', accountStatus: 'pending', isActive: false,
  }), error => error.code === 11000);
});

test('a second registration cannot claim an employee record already approved for another account', async () => {
  const admin = await createAdmin();
  const { employee, user: firstApplicant } = await createPendingRegistration({ email: 'first@example.test', employeeId: 'EMP-TEST-24' });
  const secondApplicant = await User.create({
    name: 'Second Applicant', email: 'second@example.test', password: 'test-password', role: 'Employee',
    registrationStatus: 'pending', accountStatus: 'pending', isActive: false,
    registrationEmployeeId: employee.employeeId, registrationEmployeeRef: employee._id,
  });

  const firstApproval = await review(admin, firstApplicant, 'approve');
  const secondApproval = await review(admin, secondApplicant, 'approve');

  assert.equal(firstApproval.statusCode, 200);
  assert.equal(secondApproval.statusCode, 409);
  assert.equal(await User.countDocuments({ employeeRef: employee._id }), 1);
  assert.equal((await User.findById(secondApplicant._id)).registrationStatus, 'pending');
});

test('employee identity resolves from registration mapping when account fields are stale', async () => {
  const employee = await Employee.create({
    employeeId: 'EMP-REG-RESOLVE',
    name: 'Mapped Employee',
    email: 'mapped.employee@example.test',
    department: 'Engineering',
    designation: 'Engineer',
    status: 'active',
  });
  const user = await User.create({
    name: 'Mapped Employee',
    email: 'mapped.employee@example.test',
    password: 'test-password',
    role: 'Employee',
    registrationStatus: 'approved',
    accountStatus: 'active',
    isActive: true,
    registrationEmployeeId: employee.employeeId,
    registrationEmployeeRef: employee._id,
    employeeRef: null,
    employeeId: undefined,
  });

  const identity = await resolveRequestIdentity(user);
  assert.equal(identity.error, undefined);
  assert.equal(String(identity.employee._id), String(employee._id));
  assert.equal(identity.employee.employeeId, employee.employeeId);

  const savedUser = await User.findById(user._id);
  assert.equal(String(savedUser.employeeRef), String(employee._id));
  assert.equal(savedUser.employeeId, employee.employeeId);
});
