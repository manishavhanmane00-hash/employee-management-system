const User = require('../models/User');
const Employee = require('../models/Employee');

const isDesiredUniqueLinkIndex = (index, field) => (
  Object.keys(index.key || {}).length === 1
  && index.key[field] === 1
  && index.unique === true
  && index.partialFilterExpression?.[field]?.$type === 'objectId'
);

const ensureUniqueLinkIndex = async (collection, field, name) => {
  const indexes = await collection.indexes();
  if (indexes.some(index => isDesiredUniqueLinkIndex(index, field))) return;
  for (const index of indexes) {
    if (Object.keys(index.key || {}).length === 1 && index.key[field] === 1) {
      await collection.dropIndex(index.name);
    }
  }
  await collection.createIndex(
    { [field]: 1 },
    { name, unique: true, partialFilterExpression: { [field]: { $type: 'objectId' } } },
  );
};

const assertUniqueReferences = async (collection, field, label) => {
  const duplicate = await collection.aggregate([
    { $match: { [field]: { $type: 'objectId' } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).next();
  if (duplicate) {
    throw new Error(`Cannot enforce unique ${label} mapping: duplicate ${field} references exist. Resolve those account links before starting the API.`);
  }
};

const ensureUniqueEmployeeAccountMappings = async () => {
  await assertUniqueReferences(Employee.collection, 'userId', 'Employee-to-User');
  await assertUniqueReferences(User.collection, 'employeeRef', 'User-to-Employee');
  await ensureUniqueLinkIndex(Employee.collection, 'userId', 'employee_user_unique');
  await ensureUniqueLinkIndex(User.collection, 'employeeRef', 'user_employee_unique');
};

module.exports = { ensureUniqueEmployeeAccountMappings };
