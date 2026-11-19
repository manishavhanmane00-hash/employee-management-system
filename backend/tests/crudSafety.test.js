const assert = require('node:assert/strict');
const { after, afterEach, before, test } = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Notification = require('../models/Notification');
const Task = require('../models/Task');
const User = require('../models/User');
const { deleteNotification } = require('../controllers/notificationController');
const { updateTask } = require('../controllers/taskController');

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

const createUser = (role, email) => User.create({
  name: `${role} Test`, email, password: 'test-password', role,
});

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

test('notification deletion reports failure for missing and non-owned records', async () => {
  const owner = await createUser('Employee', 'notification-owner@example.test');
  const other = await createUser('Employee', 'notification-other@example.test');
  const notification = await Notification.create({ userId: owner._id, message: 'Test notification' });

  const unauthorizedDelete = await callHandler(deleteNotification, {
    params: { id: String(notification._id) }, user: { id: String(other._id) },
  });
  assert.equal(unauthorizedDelete.statusCode, 404);
  assert.notEqual(await Notification.exists({ _id: notification._id }), null);

  const missingDelete = await callHandler(deleteNotification, {
    params: { id: new mongoose.Types.ObjectId().toString() }, user: { id: String(owner._id) },
  });
  assert.equal(missingDelete.statusCode, 404);

  const ownerDelete = await callHandler(deleteNotification, {
    params: { id: String(notification._id) }, user: { id: String(owner._id) },
  });
  assert.equal(ownerDelete.statusCode, 200);
  assert.equal(await Notification.exists({ _id: notification._id }), null);
});

test('Manager cannot edit task details outside scoped task fields', async () => {
  const manager = await createUser('Manager', 'task-manager@example.test');
  const task = await Task.create({
    title: 'Review onboarding',
    description: 'Existing task description',
    assignedTo: { userId: manager._id, name: manager.name, email: manager.email },
    assignedBy: { userId: manager._id, name: manager.name },
    priority: 'medium',
    status: 'todo',
  });
  const managerRequest = {
    id: String(manager._id),
    _id: manager._id,
    role: 'Manager',
    name: manager.name,
  };

  const fullEdit = await callHandler(updateTask, {
    params: { id: String(task._id) },
    user: managerRequest,
    body: { title: 'Changed by manager', priority: 'urgent' },
  });
  assert.equal(fullEdit.statusCode, 403);
  const unchanged = await Task.findById(task._id);
  assert.equal(unchanged.title, 'Review onboarding');
  assert.equal(unchanged.priority, 'medium');

  const scopedEdit = await callHandler(updateTask, {
    params: { id: String(task._id) },
    user: managerRequest,
    body: { status: 'in-progress', notes: 'Started review' },
  });
  assert.equal(scopedEdit.statusCode, 200);
  const saved = await Task.findById(task._id);
  assert.equal(saved.status, 'in-progress');
  assert.equal(saved.notes, 'Started review');
});

test('Manager cannot update tasks outside their assigned team', async () => {
  const manager = await createUser('Manager', 'task-manager2@example.test');
  const employee = await createUser('Employee', 'task-employee@example.test');
  const task = await Task.create({
    title: 'Private task',
    assignedTo: { userId: employee._id, name: employee.name, email: employee.email },
    status: 'todo',
  });

  const result = await callHandler(updateTask, {
    params: { id: String(task._id) },
    user: { id: String(manager._id), _id: manager._id, role: 'Manager', name: manager.name },
    body: { status: 'completed' },
  });

  assert.equal(result.statusCode, 403);
  assert.equal((await Task.findById(task._id)).status, 'todo');
});

test('Admin can edit task details and invalid task status is not persisted', async () => {
  const admin = await createUser('Admin', 'task-admin@example.test');
  const employee = await createUser('Employee', 'task-admin-assignee@example.test');
  const task = await Task.create({
    title: 'Initial title',
    assignedTo: { userId: employee._id, name: employee.name, email: employee.email },
    status: 'todo',
  });
  const request = body => callHandler(updateTask, {
    params: { id: String(task._id) },
    user: { id: String(admin._id), _id: admin._id, role: 'Admin', name: admin.name },
    body,
  });

  const invalid = await request({ status: 'not-a-task-status' });
  assert.equal(invalid.statusCode, 400);
  assert.equal((await Task.findById(task._id)).status, 'todo');

  const updated = await request({ title: 'Updated title', priority: 'high' });
  assert.equal(updated.statusCode, 200);
  const persisted = await Task.findById(task._id);
  assert.equal(persisted.title, 'Updated title');
  assert.equal(persisted.priority, 'high');
});

test('Employee cannot edit task content even when assigned the task', async () => {
  const employee = await createUser('Employee', 'task-owner@example.test');
  const task = await Task.create({
    title: 'Assigned task',
    assignedTo: { userId: employee._id, name: employee.name, email: employee.email },
    status: 'todo',
  });

  const result = await callHandler(updateTask, {
    params: { id: String(task._id) },
    user: { id: String(employee._id), _id: employee._id, role: 'Employee', name: employee.name },
    body: { title: 'Unauthorized title change' },
  });

  assert.equal(result.statusCode, 403);
  assert.equal((await Task.findById(task._id)).title, 'Assigned task');
});
