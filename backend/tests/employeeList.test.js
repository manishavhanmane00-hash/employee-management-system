const assert = require('node:assert/strict');
const { after, afterEach, before, test } = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Employee = require('../models/Employee');
const User = require('../models/User');
const {
  createEmployee,
  deleteEmployee,
  getEmployeeById,
  getEmployees,
} = require('../controllers/employeeController');

let mongo;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})));
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const listPage = async (role, query = {}) => {
  let statusCode = 200;
  let body;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  await getEmployees({ user: { id: new mongoose.Types.ObjectId().toString(), role }, query }, res);
  assert.equal(statusCode, 200);
  return body;
};

const invokeController = async (controller, request) => {
  let statusCode = 200;
  let body;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  await controller(request, res);
  return { statusCode, body };
};

test('Admin pagination includes every finalized record across departments and statuses', async () => {
  const records = Array.from({ length: 25 }, (_, index) => ({
    employeeId: `EMP-${String(index + 1).padStart(4, '0')}`,
    name: `Employee ${String(index + 1).padStart(2, '0')}`,
    email: `employee${index + 1}@example.test`,
    phone: `555000${String(index + 1).padStart(4, '0')}`,
    department: index % 2 ? 'Engineering' : 'Finance',
    designation: index % 2 ? 'Engineer' : 'Analyst',
    joiningDate: '2024-01-01',
    status: index % 3 ? 'active' : 'inactive',
    isDraft: false,
  }));
  records.push({
    name: 'Unfinished Draft',
    email: 'draft@example.test',
    department: 'Engineering',
    isDraft: true,
  });
  await Employee.insertMany(records);

  const first = await listPage('Admin', { page: 1, limit: 10 });
  assert.equal(first.total, 25);
  assert.equal(first.totalPages, 3);
  assert.equal(first.data.length, 10);
  const second = await listPage('Admin', { page: 2, limit: 10 });
  const third = await listPage('Admin', { page: 3, limit: 10 });
  const all = [...first.data, ...second.data, ...third.data];

  assert.equal(all.length, 25);
  assert.equal(new Set(all.map(item => String(item._id))).size, 25);
  assert.ok(all.some(item => item.department === 'Engineering'));
  assert.ok(all.some(item => item.department === 'Finance'));
  assert.ok(all.some(item => item.status === 'inactive'));
  assert.equal(all.filter(item => item.status === 'inactive').length, 9);
  assert.ok(all.every(item => item.role === 'Employee'));
});

test('employee listing remains restricted to the authenticated employee record', async () => {
  const user = await User.create({
    name: 'Employee One',
    email: 'one@example.test',
    password: 'test-password',
    role: 'Employee',
    employeeId: 'EMP-SELF-01',
  });
  await Employee.create({
    employeeId: user.employeeId,
    name: user.name,
    email: user.email,
    department: 'Engineering',
    userId: user._id,
    status: 'active',
  });
  await Employee.create({
    employeeId: 'EMP-OTHER-01',
    name: 'Employee Two',
    email: 'two@example.test',
    department: 'Finance',
    status: 'active',
  });

  let statusCode = 200;
  let body;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  await getEmployees({
    user: { id: String(user._id), email: user.email, role: 'Employee' },
    query: {},
  }, res);

  assert.equal(statusCode, 200);
  assert.equal(body.total, undefined);
  assert.equal(body.count, 1);
  assert.equal(body.data[0].employeeId, user.employeeId);
});

test('linked Employee role is included from the associated login account', async () => {
  const user = await User.create({
    name: 'Linked HR',
    email: 'linked-hr@example.test',
    password: 'test-password',
    role: 'HR',
    employeeId: 'HR-EMP-01',
  });
  await Employee.create({
    employeeId: user.employeeId,
    name: user.name,
    email: user.email,
    department: 'People',
    userId: user._id,
    status: 'inactive',
  });

  const response = await listPage('Admin', { page: 1, limit: 100 });
  assert.equal(response.total, 1);
  assert.equal(response.data[0].role, 'HR');
  assert.equal(response.data[0].status, 'inactive');
});

test('Admin listing includes unlinked Employee accounts once with account-derived status', async () => {
  const linkedUser = await User.create({
    name: 'Linked Employee',
    email: 'linked@example.test',
    password: 'test-password',
    role: 'Employee',
    employeeId: 'EMP-LINKED-01',
  });
  await Employee.create({
    employeeId: linkedUser.employeeId,
    name: linkedUser.name,
    email: linkedUser.email,
    department: 'Engineering',
    userId: linkedUser._id,
    status: 'active',
  });
  const accounts = await User.create([
    {
      name: 'Account Only Active',
      email: 'active-account@example.test',
      password: 'test-password',
      role: 'Employee',
      employeeId: 'EMP-ACCOUNT-01',
      department: 'Finance',
    },
    {
      name: 'Account Only Inactive',
      email: 'inactive-account@example.test',
      password: 'test-password',
      role: 'Employee',
      employeeId: 'EMP-ACCOUNT-02',
      isActive: false,
    },
    {
      name: 'Account Only Pending',
      email: 'pending-account@example.test',
      password: 'test-password',
      role: 'Employee',
      employeeId: 'EMP-ACCOUNT-03',
      registrationStatus: 'pending',
      accountStatus: 'pending',
    },
  ]);

  const first = await listPage('Admin', { page: 1, limit: 2 });
  const second = await listPage('Admin', { page: 2, limit: 2 });
  const all = [...first.data, ...second.data];
  assert.equal(first.total, 4);
  assert.equal(first.totalPages, 2);
  assert.equal(all.length, 4);
  assert.equal(new Set(all.map(item => String(item._id))).size, 4);
  assert.equal(all.filter(item => item.email === linkedUser.email).length, 1);
  assert.equal(all.filter(item => item.accountOnly).length, 3);
  assert.equal(all.find(item => item.email === accounts[1].email).status, 'inactive');
  assert.equal(all.find(item => item.email === accounts[2].email).status, 'pending');
});

test('Admin can view and deactivate an account-only employee without inventing profile fields', async () => {
  const account = await User.create({
    name: 'Unlinked Employee',
    email: 'unlinked@example.test',
    password: 'test-password',
    role: 'Employee',
    isActive: true,
  });
  const admin = { id: new mongoose.Types.ObjectId().toString(), role: 'Admin' };
  const viewed = await invokeController(getEmployeeById, {
    user: admin,
    params: { id: String(account._id) },
  });

  assert.equal(viewed.statusCode, 200);
  assert.equal(viewed.body.data.accountOnly, true);
  assert.equal(viewed.body.data.name, account.name);
  assert.equal(viewed.body.data.phone, '');
  assert.equal(viewed.body.data.department, '');

  const deleted = await invokeController(deleteEmployee, {
    user: admin,
    params: { id: String(account._id) },
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal((await User.findById(account._id)).isActive, false);
});

test('completing an account-only Employee profile links the existing login account', async () => {
  const admin = await User.create({
    name: 'Admin User',
    email: 'admin@example.test',
    password: 'test-password',
    role: 'Admin',
    isInitialAdmin: true,
  });
  const account = await User.create({
    name: 'Existing Employee',
    email: 'existing@example.test',
    password: 'test-password',
    role: 'Employee',
    isActive: true,
  });
  const result = await invokeController(createEmployee, {
    user: { id: String(admin._id), _id: admin._id, role: 'Admin' },
    body: {
      accountId: String(account._id),
      firstName: 'Existing',
      lastName: 'Employee',
      name: 'Existing Employee',
      email: account.email,
      department: 'Engineering',
      designation: 'Engineer',
      joiningDate: '2025-01-15',
      salary: 0,
      currency: 'INR',
      status: 'active',
    },
  });

  assert.equal(result.statusCode, 201);
  const linkedAccount = await User.findById(account._id);
  assert.equal(String(linkedAccount.employeeRef), String(result.body.data._id));
  assert.equal(linkedAccount.employeeId, result.body.data.employeeId);
  assert.equal(await User.countDocuments({ role: 'Employee' }), 1);
  assert.equal(await Employee.countDocuments({ isDraft: { $ne: true } }), 1);
});
