const Employee = require('../models/Employee');
const User = require('../models/User');
const mongoose = require('mongoose');

const ROLES = ['Employee', 'HR', 'Manager'];

const exactText = value => new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

const allowedRolesFor = role => {
  if (role === 'Admin') return ROLES;
  if (role === 'HR') return ['Employee', 'Manager'];
  if (role === 'Manager') return ['Employee'];
  if (role === 'Employee') return ['Employee'];
  return [];
};

const managerIdentity = user => [user.name, user.email, user.employeeId].filter(Boolean).map(exactText);

const listEmployeeOptions = async (user, requestedRoles, { includeUnassigned = false } = {}) => {
  const allowed = allowedRolesFor(user.role);
  if (!allowed.length) return { error: 'Your role cannot access employee options.' };
  const roles = requestedRoles?.length ? Array.from(new Set(requestedRoles)) : allowed;
  if (roles.some(role => !allowed.includes(role))) {
    return { error: `Your role may only select ${allowed.join(' and ')} accounts.` };
  }

  const filters = [{ role: { $in: roles }, isActive: true }];
  if (user.role === 'Employee') {
    filters[0]._id = user._id;
  } else if (user.role === 'Manager') {
    const legacy = managerIdentity(user);
    const assigned = await Employee.find({
      isDraft: { $ne: true },
      status: 'active',
      $or: [
        { reportingManagerId: user._id },
        { reportingManagerId: null, manager: { $in: legacy } },
      ],
    }).select('_id userId employeeId email').lean();
    const selectableProfiles = [...assigned];
    if (includeUnassigned) {
      const unassigned = await Employee.find({
        isDraft: { $ne: true },
        status: 'active',
        reportingManagerId: null,
        $or: [{ manager: '' }, { manager: { $exists: false } }],
      }).select('_id userId employeeId email').lean();
      selectableProfiles.push(...unassigned);
    }
    const assignableIds = selectableProfiles.flatMap(employee => [
      employee._id, employee.userId, employee.employeeId, employee.email,
    ]).filter(Boolean);
    const accountBranches = [];
    if (assignableIds.length) {
      const objectIds = assignableIds.filter(value => mongoose.Types.ObjectId.isValid(String(value)));
      const employeeIds = assignableIds.filter(value => !mongoose.Types.ObjectId.isValid(String(value)));
      if (objectIds.length) accountBranches.push({ _id: { $in: objectIds } });
      if (employeeIds.length) accountBranches.push({ $or: [{ employeeId: { $in: employeeIds } }, { email: { $in: employeeIds } }] });
    }
    filters.push({ $or: accountBranches.length ? accountBranches : [{ _id: { $in: [] } }] });
  }

  const accounts = await User.find(filters.length === 1 ? filters[0] : { $and: filters })
    .select('name email employeeId role designation department employeeRef')
    .sort({ name: 1 })
    .lean();
  if (user.role === 'Employee') {
    const ownAccount = accounts[0];
    if (!ownAccount) return { data: [] };
  }

  const userIds = accounts.map(account => account._id);
  const profileBranches = [
    { userId: { $in: userIds } },
    { _id: { $in: accounts.map(account => account.employeeRef).filter(Boolean) } },
    { email: { $in: accounts.map(account => account.email).filter(Boolean) } },
    { employeeId: { $in: accounts.map(account => account.employeeId).filter(Boolean) } },
  ];
  const profiles = accounts.length ? await Employee.find({
    isDraft: { $ne: true },
    $or: profileBranches,
  }).select('_id userId employeeId name email department designation position reportingManagerId manager status').lean() : [];
  const profileByUser = new Map();
  const profileOwners = new Map();
  for (const account of accounts) {
    const matches = profiles.filter(profile =>
      (profile.userId && String(account._id) === String(profile.userId))
      || (account.employeeRef && String(account.employeeRef) === String(profile._id))
      || (profile.email && account.email?.toLowerCase() === profile.email.toLowerCase())
      || (profile.employeeId && account.employeeId === profile.employeeId)
    );
    const uniqueProfiles = Array.from(new Map(matches.map(profile => [String(profile._id), profile])).values());
    if (uniqueProfiles.length > 1) {
      throw new Error(`Account ${account._id} matches multiple employee records; correct its employee mapping.`);
    }
    const profile = uniqueProfiles[0];
    if (profile?.userId && String(profile.userId) !== String(account._id)) {
      throw new Error(`Employee record ${profile.employeeId || profile._id} is linked to another account.`);
    }
    if (profile) {
      const owner = profileOwners.get(String(profile._id));
      if (owner && owner !== String(account._id)) {
        throw new Error(`Employee record ${profile.employeeId || profile._id} matches multiple accounts.`);
      }
      profileOwners.set(String(profile._id), String(account._id));
      profileByUser.set(String(account._id), profile);
    }
  }

  const data = accounts.map(account => {
    const profile = profileByUser.get(String(account._id));
    return {
      userId: String(account._id),
      employeeRecordId: profile?._id ? String(profile._id) : '',
      employeeId: profile?.employeeId || account.employeeId || '',
      name: profile?.name || account.name,
      email: profile?.email || account.email || '',
      role: account.role,
      department: profile?.department || account.department || '',
      designation: profile?.designation || profile?.position || account.designation || account.role,
      reportingManagerId: profile?.reportingManagerId ? String(profile.reportingManagerId) : '',
      manager: profile?.manager || '',
      status: profile?.status || (account.isActive ? 'active' : 'inactive'),
    };
  }).filter(option => user.role === 'Employee' || !option.employeeRecordId || option.status === 'active');

  return {
    data,
  };
};

module.exports = { allowedRolesFor, listEmployeeOptions };
