const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const User = require('../models/User');

const generateUniqueEmployeeId = async (session = null) => {
  const [employees, users] = await Promise.all([
    Employee.find({ employeeId: /^EMP-\d+$/ }).select('employeeId').session(session).lean(),
    User.find({ employeeId: /^EMP-\d+$/ }).select('employeeId').session(session).lean(),
  ]);
  const maxId = [...employees, ...users].reduce((max, record) => {
    const match = /^EMP-(\d+)$/.exec(record.employeeId || '');
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  for (let offset = 1; offset <= 10; offset += 1) {
    const candidate = `EMP-${String(maxId + offset).padStart(4, '0')}`;
    const [employeeExists, userExists] = await Promise.all([
      Employee.exists({ employeeId: candidate }).session(session),
      User.exists({ employeeId: candidate }).session(session),
    ]);
    if (!employeeExists && !userExists) return candidate;
  }
  throw new Error('Could not generate a unique Employee ID. Please retry the approval.');
};

const escapedRegex = value => new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const normalizeComparableString = value => String(value ?? '').trim().toLowerCase();

const pickStrongestEmployeeMatch = (account, candidates) => {
  const list = [...candidates.values()];
  const active = list.filter(employee => !employee.isDraft && employee.status === 'active');

  const strongMatches = [];
  if (account.registrationEmployeeRef) {
    strongMatches.push(...active.filter(employee => String(employee._id) === String(account.registrationEmployeeRef)));
  }
  if (account.employeeRef) {
    strongMatches.push(...active.filter(employee => String(employee._id) === String(account.employeeRef)));
  }
  if (account.registrationEmployeeId) {
    strongMatches.push(...active.filter(employee => normalizeComparableString(employee.employeeId) === normalizeComparableString(account.registrationEmployeeId)));
  }
  if (account.employeeId) {
    strongMatches.push(...active.filter(employee => normalizeComparableString(employee.employeeId) === normalizeComparableString(account.employeeId)));
  }
  if (account.email) {
    strongMatches.push(...active.filter(employee => employee.email && normalizeComparableString(employee.email) === normalizeComparableString(account.email)));
  }
  if (account._id) {
    strongMatches.push(...active.filter(employee => employee.userId && String(employee.userId) === String(account._id)));
  }

  const uniqueStrongMatches = [];
  for (const employee of strongMatches) {
    if (!uniqueStrongMatches.some(item => String(item._id) === String(employee._id))) uniqueStrongMatches.push(employee);
  }
  if (uniqueStrongMatches.length === 1) return uniqueStrongMatches[0];
  if (uniqueStrongMatches.length > 1) {
    return uniqueStrongMatches.find(employee =>
      (account.registrationEmployeeRef && String(employee._id) === String(account.registrationEmployeeRef))
      || (account.employeeRef && String(employee._id) === String(account.employeeRef))
      || (account.registrationEmployeeId && normalizeComparableString(employee.employeeId) === normalizeComparableString(account.registrationEmployeeId))
      || (account.employeeId && normalizeComparableString(employee.employeeId) === normalizeComparableString(account.employeeId))
      || (account.email && employee.email && normalizeComparableString(employee.email) === normalizeComparableString(account.email))
    ) || uniqueStrongMatches[0];
  }
  if (active.length === 1) return active[0];
  return null;
};

const managerAssignedEmployees = async (user, { includeInactive = false } = {}) => {
  const accountId = user._id || user.id;
  const account = await User.findById(accountId).select('name email employeeId').lean();
  if (!account) return [];
  const legacyIdentity = [account.name, account.email, account.employeeId]
    .filter(Boolean)
    .map(escapedRegex);
  const assigned = await Employee.find({
    isDraft: { $ne: true },
    ...(!includeInactive ? { status: 'active' } : {}),
    $or: [
      { reportingManagerId: account._id },
      ...(legacyIdentity.length ? [{ reportingManagerId: null, manager: { $in: legacyIdentity } }] : []),
    ],
  }).sort({ name: 1 });
  const linkedUserIds = assigned.map(employee => employee.userId).filter(Boolean);
  const linkedEmails = assigned.map(employee => employee.email).filter(Boolean);
  const linkedEmployeeIds = assigned.map(employee => employee.employeeId).filter(Boolean);
  const linkedAccounts = assigned.length ? await User.find({
    $or: [
      ...(linkedUserIds.length ? [{ _id: { $in: linkedUserIds } }] : []),
      ...(linkedEmails.length ? [{ email: { $in: linkedEmails } }] : []),
      ...(linkedEmployeeIds.length ? [{ employeeId: { $in: linkedEmployeeIds } }] : []),
    ],
  }).select('role employeeRef email employeeId').lean() : [];
  return assigned.filter(employee => {
    const linked = linkedAccounts.find(account =>
      (account.employeeRef && String(account.employeeRef) === String(employee._id))
      || (employee.userId && String(account._id) === String(employee.userId))
      || (employee.email && account.email?.toLowerCase() === employee.email.toLowerCase())
      || (employee.employeeId && account.employeeId === employee.employeeId)
    );
    return !linked || linked.role === 'Employee';
  });
};

const managerTeamConditions = async user => {
  const accountId = user._id || user.id;
  const account = await User.findById(accountId).select('email employeeId').lean();
  const employees = await managerAssignedEmployees(user);
  return [
    { userId: accountId },
    ...(account?.employeeId ? [{ employeeId: String(account.employeeId) }] : []),
    ...(account?.email ? [{ email: account.email }] : []),
    ...employees.flatMap(employee => [
      ...(employee.userId ? [{ userId: employee.userId }] : []),
      ...(employee.employeeId ? [{ employeeId: String(employee.employeeId) }] : []),
      ...(employee.email ? [{ email: employee.email }] : []),
      { employeeRef: employee._id },
    ]),
  ];
};

const managerTeamUserIds = async user => {
  const employees = await managerAssignedEmployees(user);
  const accountIds = employees.map(employee => employee.userId).filter(Boolean);
  const profileIds = employees.map(employee => employee._id);
  const employeeIds = employees.map(employee => employee.employeeId).filter(Boolean);
  const emails = employees.map(employee => employee.email).filter(Boolean);
  const accounts = employees.length ? await User.find({
    isActive: true,
    role: 'Employee',
    $or: [
      ...(accountIds.length ? [{ _id: { $in: accountIds } }] : []),
      ...(profileIds.length ? [{ employeeRef: { $in: profileIds } }] : []),
      ...(employeeIds.length ? [{ employeeId: { $in: employeeIds } }] : []),
      ...(emails.length ? [{ email: { $in: emails } }] : []),
    ],
  }).select('_id').lean() : [];
  return Array.from(new Set([String(user._id || user.id), ...accounts.map(account => String(account._id))]));
};

const resolveEmployeeForUser = async user => {
  const userId = user?._id || user?.id;
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    return { employee: null, error: 'Your authenticated account could not be resolved. Sign out and sign in again.' };
  }
  const account = await User.findById(userId);
  if (!account) return { employee: null, error: 'Your account could not be found. Contact an administrator.' };
  if (account.role !== 'Employee') {
    return { employee: null, error: 'This action is only available to employee accounts.' };
  }

  const candidates = new Map();
  const addCandidate = employee => {
    if (employee && !employee.isDraft) candidates.set(employee._id.toString(), employee);
  };
  if (account.registrationEmployeeRef) addCandidate(await Employee.findById(account.registrationEmployeeRef));
  if (account.employeeRef) addCandidate(await Employee.findById(account.employeeRef));

  const byUserId = await Employee.find({ userId: account._id, isDraft: { $ne: true } }).limit(2);
  if (byUserId.length > 1) {
    return { employee: null, error: 'Your account is linked to multiple employee records. Ask Admin/HR to correct the account mapping.' };
  }
  addCandidate(byUserId[0]);

  if (account.registrationEmployeeId) {
    const byRegistrationEmployeeId = await Employee.findOne({ employeeId: account.registrationEmployeeId, isDraft: { $ne: true } });
    addCandidate(byRegistrationEmployeeId);
  }
  if (account.employeeId) {
    const byEmployeeId = await Employee.findOne({ employeeId: account.employeeId, isDraft: { $ne: true } });
    addCandidate(byEmployeeId);
  }
  if (account.email) {
    const byEmail = await Employee.find({
      email: escapedRegex(account.email.trim()),
      isDraft: { $ne: true },
    }).limit(2);
    if (byEmail.length > 1) {
      return { employee: null, error: 'Multiple employee records match your account email. Ask Admin/HR to correct the account mapping.' };
    }
    addCandidate(byEmail[0]);
  }

  const employee = pickStrongestEmployeeMatch(account, candidates);
  if (!employee && candidates.size > 1) {
    return { employee: null, error: 'Your account points to more than one employee record. Ask Admin/HR to correct the account mapping.' };
  }
  if (!employee) {
    return {
      employee: null,
      error: 'No employee record matches your account. Ask Admin/HR to create or link your employee record; no duplicate record or Employee ID was created.',
    };
  }
  if (employee.status !== 'active') {
    return { employee: null, error: 'Your employee record is inactive. Contact Admin/HR to reactivate it.' };
  }
  if (employee.userId && employee.userId.toString() !== account._id.toString()) {
    return { employee: null, error: 'Your matching employee record is linked to another account. Ask Admin/HR to correct the account mapping.' };
  }

  const otherRecord = await Employee.findOne({
    userId: account._id,
    _id: { $ne: employee._id },
    isDraft: { $ne: true },
  });
  if (otherRecord) {
    return { employee: null, error: 'Your account is linked to multiple employee records. Ask Admin/HR to correct the account mapping.' };
  }

  let changed = false;
  if (!employee.userId) {
    employee.userId = account._id;
    changed = true;
  }
  if (!account.employeeRef || account.employeeRef.toString() !== employee._id.toString()) {
    account.employeeRef = employee._id;
    changed = true;
  }
  if (!account.registrationEmployeeRef && account.employeeRef) {
    account.registrationEmployeeRef = account.employeeRef;
    changed = true;
  }
  if (account.employeeId !== employee.employeeId) {
    account.employeeId = employee.employeeId;
    changed = true;
  }
  if (account.registrationEmployeeId && !account.employeeId) {
    account.employeeId = account.registrationEmployeeId;
    changed = true;
  }
  if (changed) {
    await employee.save();
    await account.save();
  }
  return { employee, account };
};

const findActiveEmployee = async identifier => {
  const value = String(identifier || '').trim();
  if (!value) return null;
  const conditions = [{ employeeId: value }];
  if (mongoose.Types.ObjectId.isValid(value)) conditions.push({ _id: value });
  const employee = await Employee.findOne({
    isDraft: { $ne: true },
    status: 'active',
    $or: conditions,
  });
  if (!employee) return null;
  if (!employee.employeeId) return null;
  let account = employee.userId ? await User.findById(employee.userId) : null;
  if (!account) account = await User.findOne({ employeeRef: employee._id });
  if (!account && employee.email) account = await User.findOne({ email: escapedRegex(employee.email.trim()), role: 'Employee' });
  return {
    employee,
    account,
    employeeId: employee.employeeId,
    employeeName: employee.name,
    userId: account?._id || employee.userId || null,
    email: employee.email || account?.email || '',
  };
};

const resolveRequestIdentity = async user => {
  const accountId = user?._id || user?.id;
  if (!accountId || !mongoose.Types.ObjectId.isValid(String(accountId))) {
    return { error: 'Your authenticated account could not be resolved. Sign out and sign in again.' };
  }
  const account = await User.findById(accountId);
  if (!account || !account.isActive) {
    return { error: 'Your account could not be found or is inactive. Contact an administrator.' };
  }
  if (!['Admin', 'HR', 'Manager', 'Employee'].includes(account.role)) {
    return { error: 'Your account role is not authorized to submit requests.' };
  }

  if (account.role === 'Employee') {
    const resolved = await resolveEmployeeForUser(account);
    if (resolved.employee) return { account: resolved.account, employee: resolved.employee };
    if (resolved.error?.startsWith('No employee record matches your account.')) {
      return { account: resolved.account || account, employee: null };
    }
    return { error: resolved.error };
  }

  const candidates = new Map();
  const add = employee => {
    if (employee && !employee.isDraft) candidates.set(employee._id.toString(), employee);
  };
  if (account.registrationEmployeeRef) add(await Employee.findById(account.registrationEmployeeRef));
  if (account.employeeRef) add(await Employee.findById(account.employeeRef));
  const byUserId = await Employee.find({
    userId: account._id,
    isDraft: { $ne: true },
  }).limit(2);
  if (byUserId.length > 1) {
    return { error: 'Your account is linked to multiple employee records. Ask Admin/HR to correct the account mapping.' };
  }
  add(byUserId[0]);
  if (account.registrationEmployeeId) {
    add(await Employee.findOne({
      employeeId: account.registrationEmployeeId,
      isDraft: { $ne: true },
    }));
  }
  if (account.employeeId) {
    add(await Employee.findOne({
      employeeId: account.employeeId,
      isDraft: { $ne: true },
    }));
  }
  const employee = pickStrongestEmployeeMatch(account, candidates) || null;
  if (!employee && candidates.size > 0) {
    return { error: 'Your account points to more than one employee record. Ask Admin/HR to correct the account mapping.' };
  }
  if (employee && employee.userId && employee.userId.toString() !== account._id.toString()) {
    return { error: 'Your linked employee record belongs to another account. Ask Admin/HR to correct the account mapping.' };
  }
  if (!employee) {
    return { error: 'Your account is not linked to an active employee record. Ask Admin/HR to create or link your employee profile.' };
  }
  return { account, employee };
};

const linkEmployeeAccount = async (employee, account, replaceExisting = false, allowedRoles = ['Employee'], options = {}) => {
  const { session } = options;
  if (!employee || employee.isDraft || employee.status !== 'active') {
    throw new Error('Select an active finalized employee record.');
  }
  if (!account || !allowedRoles.includes(account.role)) {
    throw new Error('Select a valid Employee login account.');
  }
  if (!employee.employeeId) throw new Error('This employee record has no Employee ID. Ask Admin/HR to correct the employee record first.');
  let previousAccount = null;
  if (employee.userId && employee.userId.toString() !== account._id.toString()) {
    if (!replaceExisting) {
      throw new Error('This employee record is already linked to another login account.');
    }
    previousAccount = await User.findById(employee.userId).session(session || null);
    if (previousAccount?.employeeRef && previousAccount.employeeRef.toString() !== employee._id.toString()) {
      throw new Error('The current login account points to another employee record. Ask Admin/HR to correct that mapping first.');
    }
  }
  const accountEmployee = account.employeeRef ? await Employee.findById(account.employeeRef).session(session || null) : null;
  if (accountEmployee && accountEmployee._id.toString() !== employee._id.toString()) {
    throw new Error('This login account is already linked to another employee record.');
  }
  const linkedRecord = await Employee.findOne({
    userId: account._id,
    _id: { $ne: employee._id },
    isDraft: { $ne: true },
  }).session(session || null);
  if (linkedRecord) throw new Error('This login account is linked to another employee record.');
  const idOwner = await Employee.findOne({
    employeeId: account.employeeId,
    _id: { $ne: employee._id },
    isDraft: { $ne: true },
  }).session(session || null);
  if (account.employeeId && idOwner) {
    throw new Error('The Employee ID on this login account belongs to a different employee record.');
  }

  const originalEmployeeUserId = employee.userId;
  const originalAccount = {
    employeeRef: account.employeeRef,
    employeeId: account.employeeId,
    department: account.department,
    designation: account.designation,
  };
  const originalPreviousAccount = previousAccount && {
    employeeRef: previousAccount.employeeRef,
    employeeId: previousAccount.employeeId,
  };
  const persistMapping = async () => {
    if (previousAccount) {
      previousAccount.employeeRef = null;
      previousAccount.employeeId = undefined;
      await previousAccount.save(session ? { session } : undefined);
    }
    account.employeeRef = employee._id;
    account.employeeId = employee.employeeId;
    account.department = employee.department || account.department;
    account.designation = employee.designation || employee.position || account.designation;
    await account.save(session ? { session } : undefined);
    employee.userId = account._id;
    await employee.save(session ? { session } : undefined);
  };
  if (session) {
    await persistMapping();
  } else {
    try {
      await persistMapping();
    } catch (error) {
      try {
        account.employeeRef = originalAccount.employeeRef;
        account.employeeId = originalAccount.employeeId;
        account.department = originalAccount.department;
        account.designation = originalAccount.designation;
        await account.save();
        employee.userId = originalEmployeeUserId;
        await employee.save();
        if (previousAccount) {
          previousAccount.employeeRef = originalPreviousAccount.employeeRef;
          previousAccount.employeeId = originalPreviousAccount.employeeId;
          await previousAccount.save();
        }
      } catch (rollbackError) {
        throw new Error(`Account mapping failed: ${error.message}. Mapping rollback also failed: ${rollbackError.message}`);
      }
      throw error;
    }
  }
  return { employee, account, previousAccount };
};

module.exports = {
  generateUniqueEmployeeId,
  managerAssignedEmployees,
  managerTeamConditions,
  managerTeamUserIds,
  resolveEmployeeForUser,
  findActiveEmployee,
  resolveRequestIdentity,
  linkEmployeeAccount,
};
