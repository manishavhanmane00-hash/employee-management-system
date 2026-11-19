const assert = require('node:assert/strict');
const { after, afterEach, before, test } = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Department = require('../models/Department');
const Designation = require('../models/Designation');
const Employee = require('../models/Employee');
const {
  createDesignation, deleteDesignation, getDesignations, updateDesignation, updateDepartment, deleteDepartment,
} = require('../controllers/departmentController');

let mongo;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Department.init(), Designation.init(), Employee.init()]);
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})));
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const createDepartment = name => Department.create({ name, status: 'active' });
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

const addDesignation = (name, department, extra = {}) => callHandler(createDesignation, {
  body: { name, department, ...extra },
});

test('designation create persists, is unique per department, and permits same name in another department', async () => {
  await Promise.all([createDepartment('Engineering'), createDepartment('Design')]);

  const created = await addDesignation('Senior Engineer', 'Engineering', { description: 'Engineering leadership', status: 'active' });
  const duplicate = await addDesignation(' senior engineer ', 'Engineering');
  const otherDepartment = await addDesignation('Senior Engineer', 'Design');
  const persisted = await Designation.findById(created.body.data._id);

  assert.equal(created.statusCode, 201);
  assert.equal(persisted.description, 'Engineering leadership');
  assert.equal(duplicate.statusCode, 409);
  assert.equal(otherDepartment.statusCode, 201);
  assert.equal(await Designation.countDocuments(), 2);
});

test('designation update persists fields and list returns live employee counts', async () => {
  await createDepartment('Engineering');
  const created = await addDesignation('Engineer', 'Engineering');
  await Employee.create({
    employeeId: 'EMP-DESIG-01', name: 'Test Engineer', email: 'engineer@example.test',
    department: 'Engineering', designation: 'Engineer', status: 'active',
  });

  const updated = await callHandler(updateDesignation, {
    params: { id: String(created.body.data._id) },
    body: { description: 'Builds EMS software', status: 'inactive' },
  });
  const listed = await callHandler(getDesignations, { query: { includeInactive: 'true' } });

  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.data.description, 'Builds EMS software');
  assert.equal(updated.body.data.status, 'inactive');
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.data[0].employeeCount, 1);
});

test('assigned designations cannot be renamed, moved, or deleted', async () => {
  await Promise.all([createDepartment('Engineering'), createDepartment('Research')]);
  const created = await addDesignation('Engineer', 'Engineering');
  const employee = await Employee.create({
    employeeId: 'EMP-DESIG-02', name: 'Assigned Engineer', email: 'assigned@example.test',
    department: 'Engineering', designation: 'Engineer', status: 'active',
  });

  const rename = await callHandler(updateDesignation, {
    params: { id: String(created.body.data._id) }, body: { name: 'Staff Engineer' },
  });
  const move = await callHandler(updateDesignation, {
    params: { id: String(created.body.data._id) }, body: { department: 'Research' },
  });
  const remove = await callHandler(deleteDesignation, { params: { id: String(created.body.data._id) } });

  assert.equal(rename.statusCode, 409);
  assert.equal(move.statusCode, 409);
  assert.equal(remove.statusCode, 409);
  assert.ok(await Designation.exists({ _id: created.body.data._id }));
  const savedEmployee = await Employee.findById(employee._id);
  assert.equal(savedEmployee.designation, 'Engineer');
  assert.equal(savedEmployee.department, 'Engineering');
});

test('unassigned designation can be updated and deleted without affecting employee records', async () => {
  await Promise.all([createDepartment('Engineering'), createDepartment('Research')]);
  const created = await addDesignation('Junior Engineer', 'Engineering');

  const updated = await callHandler(updateDesignation, {
    params: { id: String(created.body.data._id) },
    body: { name: 'Associate Engineer', department: 'Research', description: 'Entry-level role', status: 'inactive' },
  });
  assert.equal(updated.statusCode, 200);
  const persisted = await Designation.findById(created.body.data._id);
  assert.equal(persisted.name, 'Associate Engineer');
  assert.equal(persisted.department, 'Research');
  assert.equal(persisted.status, 'inactive');

  const deleted = await callHandler(deleteDesignation, { params: { id: String(created.body.data._id) } });
  assert.equal(deleted.statusCode, 200);
  assert.equal(await Designation.exists({ _id: created.body.data._id }), null);
});

test('department rename carries catalog designations and department deletion preserves references', async () => {
  const department = await createDepartment('Engineering');
  const role = await addDesignation('Platform Engineer', 'Engineering');

  const renamed = await callHandler(updateDepartment, {
    params: { id: String(department._id) },
    body: { name: 'Platform Engineering' },
    user: { id: new mongoose.Types.ObjectId().toString(), _id: new mongoose.Types.ObjectId(), name: 'Admin', role: 'Admin' },
  });
  const savedRole = await Designation.findById(role.body.data._id).select('+normalizedDepartment');
  const deletion = await callHandler(deleteDepartment, {
    params: { id: String(department._id) },
  });

  assert.equal(renamed.statusCode, 200);
  assert.equal(savedRole.department, 'Platform Engineering');
  assert.equal(savedRole.normalizedDepartment, 'platform engineering');
  assert.equal(deletion.statusCode, 400);
  assert.ok(await Department.exists({ _id: department._id }));
});

test('department rename is rejected if its designation would collide with the target department', async () => {
  const source = await createDepartment('Source');
  await createDepartment('Target');
  await addDesignation('Analyst', 'Source');
  await addDesignation('Analyst', 'Target');

  const result = await callHandler(updateDepartment, {
    params: { id: String(source._id) },
    body: { name: 'Target' },
    user: { id: new mongoose.Types.ObjectId().toString(), _id: new mongoose.Types.ObjectId(), name: 'Admin', role: 'Admin' },
  });

  assert.equal(result.statusCode, 400);
  assert.equal((await Department.findById(source._id)).name, 'Source');
});
