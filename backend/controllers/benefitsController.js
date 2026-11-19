const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Allowance = require('../models/Allowance');
const AllowanceType = require('../models/AllowanceType');
const PFProfile = require('../models/PFProfile');
const PFConfiguration = require('../models/PFConfiguration');
const PFContribution = require('../models/PFContribution');
const InsurancePolicy = require('../models/InsurancePolicy');
const ActivityLog = require('../models/ActivityLog');
const Employee = require('../models/Employee');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { resolvePermissionsForRole } = require('./permissionController');
const { calculatePFAmounts, getPFConfigurationForDate } = require('../services/pfCalculation');
const { managerAssignedEmployees } = require('../services/employeeIdentity');
const { listEmployeeOptions } = require('../services/employeeDirectory');

const DEFAULT_ALLOWANCE_TYPES = [
  'House Rent Allowance (HRA)', 'Dearness Allowance (DA)', 'Travel Allowance',
  'Conveyance Allowance', 'Medical Allowance', 'Special Allowance',
  'Food Allowance', 'Internet Allowance',
];
const INSURANCE_TYPES = [
  'Group Health Insurance', 'Medical Insurance', 'Group Term Life Insurance',
  'Personal Accident Insurance', 'Family Health Insurance',
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'insurance');
const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const MIME_EXTENSIONS = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const validatePFConfiguration = body => {
  const errors = {};
  const values = {};
  for (const [key, label] of Object.entries({
    employeeRate: 'Employee PF rate',
    employerRate: 'Employer total rate',
    epsRate: 'EPS rate',
    edliRate: 'EDLI rate',
  })) {
    const raw = body[key];
    const hasValue = raw !== undefined && raw !== null
      && !(typeof raw === 'string' && !raw.trim())
      && (typeof raw === 'string' || typeof raw === 'number');
    const value = hasValue ? Number(raw) : NaN;
    if (!Number.isFinite(value)) errors[key] = `${label} is required and must be a valid number.`;
    else if (value < 0 || value > 100) errors[key] = `${label} must be between 0 and 100%.`;
    else values[key] = value;
  }

  const isBlankCeiling = body.wageCeiling === '' || body.wageCeiling == null;
  const wageCeiling = isBlankCeiling
    ? null
    : (typeof body.wageCeiling === 'string' || typeof body.wageCeiling === 'number'
      ? Number(body.wageCeiling)
      : NaN);
  if (wageCeiling !== null && (!Number.isFinite(wageCeiling) || wageCeiling <= 0)) {
    errors.wageCeiling = 'Wage ceiling must be a positive amount or left blank.';
  }

  const effectiveFrom = body.effectiveFrom;
  const effectiveTo = body.effectiveTo || null;
  if (!validDate(effectiveFrom)) errors.effectiveFrom = 'Enter a valid Effective From date.';
  if (effectiveTo && !validDate(effectiveTo)) errors.effectiveTo = 'Enter a valid Effective To date or leave it blank.';
  else if (effectiveTo && validDate(effectiveFrom) && effectiveTo < effectiveFrom) {
    errors.effectiveTo = 'Effective To must be on or after Effective From.';
  }

  const salaryBasis = body.salaryBasis || 'basicSalary';
  if (!['basicSalary', 'grossSalary'].includes(salaryBasis)) {
    errors.salaryBasis = 'Select Basic salary or Gross salary.';
  }
  if (String(body.notes || '').length > 2000) errors.notes = 'Rule notes must be 2000 characters or fewer.';
  const currency = body.currency || 'INR';
  if (!['INR', 'USD'].includes(currency)) errors.currency = 'Select the verified currency for the PF rule.';

  if (['employerRate', 'epsRate', 'edliRate'].every(key => Number.isFinite(values[key]))
    && values.epsRate + values.edliRate > values.employerRate + 1e-9) {
    const message = `EPS (${values.epsRate}%) plus EDLI (${values.edliRate}%) exceeds Employer Total (${values.employerRate}%).`;
    errors.epsRate = message;
    errors.edliRate = message;
    errors.employerRate = message;
  }

  return {
    errors,
    values: {
      ...values,
      effectiveFrom,
      effectiveTo,
      wageCeiling,
      currency,
      salaryBasis,
      notes: String(body.notes || '').trim(),
    },
  };
};

const findPFConfigurationOverlap = async (effectiveFrom, effectiveTo, excludeId) => {
  const filter = excludeId ? { _id: { $ne: excludeId } } : {};
  const configs = await PFConfiguration.find(filter).select('_id effectiveFrom effectiveTo').lean();
  const requestedEnd = effectiveTo || '9999-12-31';
  return configs.find(config => {
    const existingEnd = config.effectiveTo || '9999-12-31';
    return effectiveFrom <= existingEnd && config.effectiveFrom <= requestedEnd;
  }) || null;
};

const employeeForId = async value => {
  if (!value) return null;
  const filters = [{ employeeId: String(value) }];
  if (mongoose.Types.ObjectId.isValid(String(value))) filters.push({ _id: value });
  return Employee.findOne({ isDraft: { $ne: true }, $or: filters });
};

const resolveBenefitTarget = async ({ userId, employeeId }) => {
  let employee = null;
  let account = null;

  if (userId) {
    if (!mongoose.Types.ObjectId.isValid(String(userId))) return null;
    account = await User.findById(userId);
  } else if (employeeId) {
    employee = await employeeForId(employeeId);
    if (employee?.userId) account = await User.findById(employee.userId);
    if (!account && employee?.email) {
      account = await User.findOne({
        email: employee.email.toLowerCase(),
        role: { $in: ['Employee', 'HR', 'Manager'] },
      });
    }
    if (!employee) {
      const value = String(employeeId);
      if (/^USER-[a-f\d]{24}$/i.test(value)) account = await User.findById(value.slice(5));
      else if (mongoose.Types.ObjectId.isValid(value)) account = await User.findById(value);
      if (!account) account = await User.findOne({ employeeId: value });
    }
  }

  if (account && (!account.isActive || !['Employee', 'HR', 'Manager'].includes(account.role))) return null;
  if (account) {
    const linked = [];
    if (account.employeeRef) {
      const profile = await Employee.findById(account.employeeRef);
      if (profile && !profile.isDraft && profile.status === 'active') linked.push(profile);
    }
    const byAccount = await Employee.findOne({
      userId: account._id,
      isDraft: { $ne: true },
      status: 'active',
    });
    if (byAccount && !linked.some(item => item._id.equals(byAccount._id))) linked.push(byAccount);
    if (account.email) {
      const byEmail = await Employee.findOne({
        email: account.email.toLowerCase(),
        isDraft: { $ne: true },
        status: 'active',
      });
      if (byEmail && !linked.some(item => item._id.equals(byEmail._id))) linked.push(byEmail);
    }
    if (linked.length > 1) throw new Error('This account is linked to multiple employee records. Correct the account mapping before assigning benefits.');
    employee = linked[0] || null;
  }

  if (!account && !employee) return null;
  if (employee?.userId && account && !employee.userId.equals(account._id)) {
    throw new Error('The selected employee record is linked to another account.');
  }
  const referenceId = employee?._id || account?._id;
  const employeeCode = employee?.employeeId || account?.employeeId || (account ? `USER-${account._id}` : '');
  if (!employeeCode) return null;
  return {
    account,
    employee,
    referenceId,
    referenceModel: employee ? 'Employee' : 'User',
    employeeId: employeeCode,
    userId: account?._id || employee?.userId || null,
    employeeName: employee?.name || account?.name || '',
    employeeRole: account?.role || 'Employee',
    department: employee?.department || account?.department || '',
    designation: employee?.designation || employee?.position || account?.designation || account?.role || '',
    salary: employee?.salary || 0,
    currency: employee?.currency || 'UNVERIFIED',
  };
};

const getEligibleBenefitUsers = async (req, res) => {
  try {
    const module = String(req.query.module || 'allowances');
    if (!['allowances', 'pf', 'insurance'].includes(module)) {
      return res.status(400).json({ success: false, message: 'Select a valid benefits module.' });
    }
    const action = String(req.query.action || 'add');
    if (!['add', 'edit'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Select a valid benefits action.' });
    }
    const { actions } = await resolvePermissionsForRole(req.user.role);
    if (!actions?.[module]?.[action]) {
      return res.status(403).json({ success: false, message: `You do not have permission to ${action} ${module} records.` });
    }
    const roles = req.user.role === 'Admin' ? ['Employee', 'HR', 'Manager'] : ['Employee', 'Manager'];
    const result = await listEmployeeOptions(req.user, roles);
    if (result.error) return res.status(403).json({ success: false, message: result.error });
    res.json({
      success: true,
      count: result.data.length,
      data: result.data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const relatedEmployees = async user => {
  const employees = await managerAssignedEmployees(user);
  return employees.map(employee => ({ employeeId: employee.employeeId, userId: employee.userId }));
};

const authorizedBenefitScope = async req => {
  if (req.user.role === 'Employee') {
    const employee = req.user.employeeRef
      ? await Employee.findById(req.user.employeeRef)
      : await Employee.findOne({ $or: [{ userId: req.user.id }, { email: req.user.email }] });
    return {
      employeeIds: [...new Set([employee?.employeeId, req.user.employeeId].filter(Boolean))],
      userIds: [req.user.id],
    };
  }
  if (req.user.role === 'Manager') {
    const employees = await relatedEmployees(req.user);
    const own = req.user.employeeRef
      ? await Employee.findById(req.user.employeeRef).select('employeeId').lean()
      : await Employee.findOne({ userId: req.user.id }).select('employeeId').lean();
    return {
      employeeIds: [...new Set([...employees.map(employee => employee.employeeId), own?.employeeId].filter(Boolean))],
      userIds: [req.user.id],
    };
  }
  return null;
};

const applyBenefitScope = async (req, filter) => {
  const scope = await authorizedBenefitScope(req);
  if (scope) {
    const conditions = [];
    if (scope.employeeIds.length) conditions.push({ employeeId: { $in: scope.employeeIds } });
    if (scope.userIds.length) conditions.push({ userId: { $in: scope.userIds } });
    const scopeClause = conditions.length ? { $or: conditions } : { _id: null };
    if (filter.$or) {
      const searchClause = { $or: filter.$or };
      delete filter.$or;
      filter.$and = [...(filter.$and || []), searchClause, scopeClause];
    } else {
      filter.$and = [...(filter.$and || []), scopeClause];
    }
  }
  return filter;
};

const logActivity = async (req, module, action, record, previousValue, updatedValue) => {
  await ActivityLog.create({
    userId: req.user._id,
    userName: req.user.name,
    userRole: req.user.role,
    employeeId: record?.employeeId || req.user.employeeId || '',
    module,
    action,
    recordId: record?._id?.toString() || '',
    previousValue: previousValue || null,
    updatedValue: updatedValue || null,
  });
};

const notifyEmployee = async (record, title, message, type = 'benefit') => {
  if (!record?.userId) return;
  await Notification.create({ userId: record.userId, employeeId: record.employeeId, title, message, type });
};

const publicPolicy = (policy, hideSensitive = false) => {
  const result = policy.toObject ? policy.toObject() : { ...policy };
  if (hideSensitive) {
    result.policyNumber = '';
    result.documents = [];
    result.beneficiaries = [];
    result.premiumAmount = undefined;
    result.employeeContribution = undefined;
    result.employerContribution = undefined;
  }
  return result;
};

const canViewSensitive = async (role, permission) => {
  const { permissions } = await resolvePermissionsForRole(role);
  return permissions[permission] === true;
};

const getAllowanceTypes = async (req, res) => {
  try {
    await Promise.all(DEFAULT_ALLOWANCE_TYPES.map(name => AllowanceType.updateOne(
      { name }, { $setOnInsert: { name, isActive: true } }, { upsert: true }
    )));
    const types = await AllowanceType.find({ isActive: true }).sort({ name: 1 });
    res.json({ success: true, count: types.length, data: types });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createAllowanceType = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'Allowance type name is required.' });
    const type = await AllowanceType.create({ name });
    await logActivity(req, 'Allowances', 'Allowance type created', null, null, { name });
    res.status(201).json({ success: true, data: type });
  } catch (err) {
    res.status(err.code === 11000 ? 409 : 500).json({ success: false, message: err.code === 11000 ? 'Allowance type already exists.' : err.message });
  }
};

const getAllowances = async (req, res) => {
  try {
    const filter = {};
    if (req.query.employeeId) filter.employeeId = req.query.employeeId;
    if (req.query.department) filter.department = req.query.department;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
    await applyBenefitScope(req, filter);
    if (req.query.search) {
      const rx = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$and = [...(filter.$and || []), { $or: [{ employeeName: rx }, { employeeId: rx }, { department: rx }, { type: rx }] }];
    }
    const records = await Allowance.find(filter).sort({ effectiveFrom: -1, createdAt: -1 });
    res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const saveAllowance = async (req, res) => {
  try {
    const target = await resolveBenefitTarget({ userId: req.body.userId, employeeId: req.body.employeeId });
    const amount = Number(req.body.amount);
    const effectiveFrom = req.body.effectiveFrom;
    const effectiveTo = req.body.effectiveTo || '';
    const type = String(req.body.type || '').trim();
    if (!target) return res.status(400).json({ success: false, message: 'Select an active Employee, HR, or Manager account.' });
    if (!type || !(await AllowanceType.exists({ name: type, isActive: true }))) {
      return res.status(400).json({ success: false, message: 'Select or create a valid active allowance type.' });
    }
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'Allowance amount must be greater than zero.' });
    if (!['Monthly', 'Yearly'].includes(req.body.frequency)) return res.status(400).json({ success: false, message: 'Frequency must be Monthly or Yearly.' });
    if (!validDate(effectiveFrom) || (effectiveTo && !validDate(effectiveTo)) || (effectiveTo && effectiveTo < effectiveFrom)) {
      return res.status(400).json({ success: false, message: 'Enter a valid effective date range.' });
    }
    const duplicate = await Allowance.findOne({
      employeeId: target.employeeId, type, isActive: true,
      effectiveFrom: { $lte: effectiveTo || '9999-12-31' },
      $or: [{ effectiveTo: '' }, { effectiveTo: { $gte: effectiveFrom } }],
      ...(req.params.id ? { _id: { $ne: req.params.id } } : {}),
    });
    if (duplicate) return res.status(409).json({ success: false, message: 'An active allowance of this type already overlaps this effective period.' });

    const before = req.params.id ? await Allowance.findById(req.params.id) : null;
    if (req.params.id && !before) return res.status(404).json({ success: false, message: 'Allowance not found.' });
    const currency = req.body.currency || before?.currency || 'INR';
    if (!['INR', 'USD'].includes(currency)) return res.status(400).json({ success: false, message: 'Select the verified currency for this allowance.' });
    const fields = {
      employee: target.referenceId,
      employeeModel: target.referenceModel,
      employeeId: target.employeeId,
      userId: target.userId,
      employeeName: target.employeeName,
      employeeRole: target.employeeRole,
      department: target.department,
      type,
      amount,
      currency,
      frequency: req.body.frequency,
      effectiveFrom,
      effectiveTo,
      description: String(req.body.description || '').trim(),
      isActive: req.body.isActive !== false,
      updatedBy: req.user._id,
    };
    const record = before
      ? await Allowance.findByIdAndUpdate(req.params.id, fields, { new: true, runValidators: true })
      : await Allowance.create({ ...fields, createdBy: req.user._id });
    await logActivity(req, 'Allowances', before ? 'Allowance updated' : 'Allowance assigned', record, before?.toObject(), record.toObject());
    await notifyEmployee(record, before ? 'Allowance updated' : 'New allowance assigned', `${record.type} allowance has been ${before ? 'updated' : 'assigned'}.`);
    res.status(before ? 200 : 201).json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deactivateAllowance = async (req, res) => {
  try {
    const record = await Allowance.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Allowance not found.' });
    const previous = record.toObject();
    record.isActive = false;
    record.updatedBy = req.user._id;
    await record.save();
    await logActivity(req, 'Allowances', 'Allowance deactivated', record, previous, record.toObject());
    await notifyEmployee(record, 'Allowance updated', `${record.type} allowance was deactivated.`);
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getPFConfiguration = async (req, res) => {
  try {
    const records = await PFConfiguration.find().populate('createdBy', 'name role').populate('updatedBy', 'name role').sort({ effectiveFrom: -1 });
    res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createPFConfiguration = async (req, res) => {
  try {
    const { errors, values } = validatePFConfiguration(req.body);
    if (Object.keys(errors).length) {
      return res.status(400).json({ success: false, message: 'Please correct the highlighted PF rule fields.', errors });
    }
    const conflictingRule = await findPFConfigurationOverlap(values.effectiveFrom, values.effectiveTo);
    if (conflictingRule) {
      return res.status(409).json({
        success: false,
        message: `This effective date range overlaps the rule starting ${conflictingRule.effectiveFrom}. Set non-overlapping effective dates.`,
        errors: { effectiveFrom: 'This date range conflicts with an existing PF rule.', effectiveTo: 'This date range conflicts with an existing PF rule.' },
      });
    }
    const config = await PFConfiguration.create({
      ...values, createdBy: req.user._id,
    });
    await logActivity(req, 'PF', 'PF rules configured', null, null, config.toObject());
    res.status(201).json({ success: true, data: config });
  } catch (err) {
    res.status(err.code === 11000 ? 409 : 500).json({
      success: false,
      message: err.code === 11000 ? 'A PF rule already exists for this Effective From date.' : err.message,
      errors: err.code === 11000 ? { effectiveFrom: 'A rule already exists for this date.' } : undefined,
    });
  }
};

const updatePFConfiguration = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid PF rule identifier.' });
    }
    const record = await PFConfiguration.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'PF rule not found.' });

    const { errors, values } = validatePFConfiguration(req.body);
    if (Object.keys(errors).length) {
      return res.status(400).json({ success: false, message: 'Please correct the highlighted PF rule fields.', errors });
    }
    const conflictingRule = await findPFConfigurationOverlap(values.effectiveFrom, values.effectiveTo, record._id);
    if (conflictingRule) {
      return res.status(409).json({
        success: false,
        message: `This effective date range overlaps the rule starting ${conflictingRule.effectiveFrom}. Set non-overlapping effective dates.`,
        errors: { effectiveFrom: 'This date range conflicts with an existing PF rule.', effectiveTo: 'This date range conflicts with an existing PF rule.' },
      });
    }

    const hasContributions = await PFContribution.exists({ configuration: record._id });
    if (hasContributions) {
      const historicalFields = ['effectiveFrom', 'employeeRate', 'employerRate', 'epsRate', 'edliRate', 'wageCeiling', 'salaryBasis', 'notes'];
      const changedHistoricalField = historicalFields.find(key => String(record[key] ?? '') !== String(values[key] ?? ''));
      if (changedHistoricalField) {
        return res.status(409).json({
          success: false,
          message: 'This rule has historical contributions and its rates and salary basis are locked. Only its Effective To date may be changed.',
          errors: { [changedHistoricalField]: 'This value is locked because contributions already reference this rule.' },
        });
      }
    }

    const previous = record.toObject();
    Object.assign(record, values, { updatedBy: req.user._id });
    await record.save();
    await logActivity(req, 'PF', 'PF rules updated', record, previous, record.toObject());
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(err.code === 11000 ? 409 : 500).json({ success: false, message: err.message });
  }
};

const getPFRecords = async (req, res) => {
  try {
    const scope = await authorizedBenefitScope(req);
    const filter = {};
    if (req.query.employeeId) filter.employeeId = req.query.employeeId;
    if (scope) {
      filter.$or = [
        ...(scope.employeeIds.length ? [{ employeeId: { $in: scope.employeeIds } }] : []),
        ...(scope.userIds.length ? [{ userId: { $in: scope.userIds } }] : []),
      ];
      if (!filter.$or.length) filter._id = null;
    }
    const todayDate = new Date().toISOString().slice(0, 10);
    const [profiles, contributions, currentConfiguration] = await Promise.all([
      PFProfile.find(filter).sort({ employeeName: 1 }),
      PFContribution.find({
        ...filter,
        ...(req.query.month ? { month: req.query.month } : {}),
        ...(req.query.year ? { year: Number(req.query.year) } : {}),
      }).populate('configuration', 'effectiveFrom effectiveTo employeeRate employerRate epsRate edliRate')
        .sort({ year: -1, month: -1 }),
      PFConfiguration.findOne({
        effectiveFrom: { $lte: todayDate },
        $or: [{ effectiveTo: null }, { effectiveTo: { $gte: todayDate } }],
      }).select('effectiveFrom effectiveTo employeeRate employerRate epsRate edliRate wageCeiling salaryBasis')
        .sort({ effectiveFrom: -1 }).lean(),
    ]);
    const redact = req.user.role === 'Manager' && !(await canViewSensitive(req.user.role, 'pf.sensitive'));
    const safeProfiles = profiles.map(profile => {
      const data = profile.toObject();
      if (redact) {
        data.pfAccountNumber = '';
        data.uanNumber = '';
        data.basicSalary = undefined;
      }
      return data;
    });
    const safeContributions = contributions.map(record => {
      const data = record.toObject();
      if (redact) {
        data.basicSalary = undefined;
        data.wageBasis = undefined;
        data.employeeRate = undefined;
        data.employerRate = undefined;
        data.employeeContribution = undefined;
        data.employerContribution = undefined;
        data.epsContribution = undefined;
        data.edliContribution = undefined;
        data.employerEpfContribution = undefined;
      }
      return data;
    });
    res.json({
      success: true,
      count: safeProfiles.length,
      data: {
        profiles: safeProfiles,
        contributions: safeContributions,
        currentConfiguration,
        hasEffectiveConfiguration: Boolean(currentConfiguration),
      },
    });
  } catch (err) {
    console.error(`[PF records] Failed for ${req.user?.role || 'unknown role'}:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

const savePFProfile = async (req, res) => {
  try {
    const target = await resolveBenefitTarget({
      userId: req.body.userId,
      employeeId: req.body.employeeId || req.params.employeeId,
    });
    if (!target) return res.status(400).json({ success: false, message: 'Select an active Employee, HR, or Manager account.' });
    const basicSalary = req.body.basicSalary === '' || req.body.basicSalary == null
      ? Number(target.salary || 0) / 12
      : Number(req.body.basicSalary);
    if (!Number.isFinite(basicSalary) || basicSalary < 0) return res.status(400).json({ success: false, message: 'Basic salary must be a non-negative number.' });
    const targetConditions = [{ employeeId: target.employeeId }];
    if (target.userId) targetConditions.push({ userId: target.userId });
    const existing = await PFProfile.findOne({ $or: targetConditions });
    const currency = req.body.currency || existing?.currency || target.currency;
    if (!['INR', 'USD'].includes(currency)) return res.status(400).json({ success: false, message: 'Select the verified currency for this PF profile.' });
    const previous = existing?.toObject();
    const fields = {
      employee: target.referenceId,
      employeeModel: target.referenceModel,
      employeeId: target.employeeId,
      userId: target.userId,
      employeeName: target.employeeName,
      employeeRole: target.employeeRole,
      department: target.department,
      designation: target.designation,
      pfAccountNumber: String(req.body.pfAccountNumber || '').trim(),
      uanNumber: String(req.body.uanNumber || '').trim(),
      enrollmentDate: req.body.enrollmentDate || '',
      basicSalary,
      currency,
      isEligible: req.body.isEligible !== false,
      isApplicable: req.body.isApplicable !== false,
      exemptionReason: String(req.body.exemptionReason || '').trim(),
      updatedBy: req.user._id,
    };
    const record = existing
      ? await PFProfile.findByIdAndUpdate(existing._id, fields, { new: true, runValidators: true })
      : await PFProfile.create({ ...fields, createdBy: req.user._id });
    await logActivity(req, 'PF', previous ? 'PF profile updated' : 'PF enrollment completed', record, previous, record.toObject());
    await notifyEmployee(record, previous ? 'PF details updated' : 'PF enrollment completed', 'Your Provident Fund details have been updated.');
    res.status(previous ? 200 : 201).json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const computePFContribution = async (employeeId, month, year, actorId, userId = null) => {
  const monthIndex = MONTHS.indexOf(month);
  const numericYear = Number(year);
  if (monthIndex < 0 || !Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 9999) {
    throw new Error('Valid month and year are required for PF calculation.');
  }
  const periodStart = `${numericYear}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const periodEnd = `${numericYear}-${String(monthIndex + 1).padStart(2, '0')}-${String(new Date(numericYear, monthIndex + 1, 0).getDate()).padStart(2, '0')}`;
  const target = await resolveBenefitTarget({ userId, employeeId });
  if (!target) throw new Error('Select an active Employee, HR, or Manager account.');
  if (!['INR', 'USD'].includes(target.currency)) {
    throw new Error(`The salary currency for ${target.employeeName} is unverified. Verify it before calculating PF.`);
  }
  const prior = await PFContribution.findOne({ employeeId: target.employeeId, month, year: numericYear });
  if (prior) return prior;
  const profileConditions = [{ employeeId: target.employeeId }];
  if (target.userId) profileConditions.push({ userId: target.userId });
  const profile = await PFProfile.findOne({ $or: profileConditions });
  const configuration = await getPFConfigurationForDate(periodEnd);
  if (!profile || !configuration || !profile.isEligible || !profile.isApplicable) return null;
  if (profile.currency !== target.currency || configuration.currency !== target.currency) {
    throw new Error('The PF profile and configuration currencies must match the verified employee salary currency.');
  }

  const basicSalary = Number(profile.basicSalary || Number(target.salary || 0) / 12);
  const recurringAllowances = await Allowance.find({
    isActive: true,
    effectiveFrom: { $lte: periodEnd },
    $and: [
      { $or: [{ employeeId: target.employeeId }, ...(target.userId ? [{ userId: target.userId }] : [])] },
      { $or: [{ effectiveTo: '' }, { effectiveTo: { $gte: periodStart } }] },
    ],
  }).select('amount frequency type');
  const extraAllowances = recurringAllowances.reduce((total, allowance) => (
    total + (allowance.frequency === 'Yearly' ? Number(allowance.amount) / 12 : Number(allowance.amount))
  ), 0);
  const grossSalary = basicSalary
    + Number(target.employee?.hra || 0) / 12
    + Number(target.employee?.allowances || 0) / 12
    + extraAllowances;
  const amounts = calculatePFAmounts({ basicSalary, grossSalary, configuration });
  const data = {
    employee: target.referenceId, employeeModel: target.referenceModel,
    employeeId: target.employeeId, userId: target.userId,
    employeeName: target.employeeName, employeeRole: target.employeeRole,
    department: target.department, month, year: numericYear,
    basicSalary, currency: target.currency, ...amounts, createdBy: actorId,
  };
  try {
    return await PFContribution.create(data);
  } catch (err) {
    if (err.code === 11000) {
      const concurrentPrior = await PFContribution.findOne({ employeeId: target.employeeId, month, year: numericYear });
      if (concurrentPrior) return concurrentPrior;
    }
    throw err;
  }
};

const calculatePF = async (req, res) => {
  try {
    const record = await computePFContribution(req.body.employeeId, req.body.month, req.body.year, req.user._id, req.body.userId);
    if (!record) return res.status(200).json({ success: true, data: null, message: 'PF profile is not eligible or no effective PF configuration exists.' });
    await logActivity(req, 'PF', 'PF contribution calculated', record, null, record.toObject());
    await notifyEmployee(record, 'PF contribution updated', `Your PF contribution for ${record.month} ${record.year} has been calculated.`);
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getInsurance = async (req, res) => {
  try {
    const filter = {};
    if (req.query.employeeId) filter.employeeId = req.query.employeeId;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.department) filter.department = req.query.department;
    if (req.query.search) {
      const rx = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ employeeName: rx }, { employeeId: rx }, { provider: rx }, { policyNumber: rx }];
    }
    await applyBenefitScope(req, filter);
    const records = await InsurancePolicy.find(filter).sort({ expiryDate: 1 });
    const redact = req.user.role === 'Manager' && !(await canViewSensitive(req.user.role, 'insurance.sensitive'));
    res.json({ success: true, count: records.length, data: records.map(item => publicPolicy(item, redact)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const saveInsurance = async (req, res) => {
  try {
    const target = await resolveBenefitTarget({ userId: req.body.userId, employeeId: req.body.employeeId });
    if (!target) return res.status(400).json({ success: false, message: 'Select an active Employee, HR, or Manager account.' });
    const type = String(req.body.type || '').trim();
    const provider = String(req.body.provider || '').trim();
    const policyNumber = String(req.body.policyNumber || '').trim();
    const startDate = req.body.startDate;
    const expiryDate = req.body.expiryDate;
    const sumInsured = Number(req.body.sumInsured);
    const premiumAmount = Number(req.body.premiumAmount);
    const employerContribution = Number(req.body.employerContribution || 0);
    const employeeContribution = Number(req.body.employeeContribution || 0);
    if (!type || !provider || !policyNumber || !validDate(startDate) || !validDate(expiryDate) || expiryDate < startDate
      || !Number.isFinite(sumInsured) || sumInsured < 0 || !Number.isFinite(premiumAmount) || premiumAmount < 0
      || !Number.isFinite(employerContribution) || employerContribution < 0
      || !Number.isFinite(employeeContribution) || employeeContribution < 0
      || !['Monthly', 'Yearly'].includes(req.body.premiumFrequency || 'Yearly')) {
      return res.status(400).json({ success: false, message: 'Insurance policy details are invalid.' });
    }
    const beneficiaries = Array.isArray(req.body.beneficiaries) ? req.body.beneficiaries : [];
    if (beneficiaries.reduce((sum, item) => sum + Number(item.sharePercent || 0), 0) > 100) {
      return res.status(400).json({ success: false, message: 'Beneficiary shares cannot exceed 100%.' });
    }
    const before = req.params.id ? await InsurancePolicy.findById(req.params.id) : null;
    if (req.params.id && !before) return res.status(404).json({ success: false, message: 'Insurance policy not found.' });
    const currency = req.body.currency || before?.currency || 'INR';
    if (!['INR', 'USD'].includes(currency)) return res.status(400).json({ success: false, message: 'Select the verified currency for this insurance policy.' });
    const fields = {
      employee: target.referenceId, employeeModel: target.referenceModel,
      employeeId: target.employeeId, userId: target.userId,
      employeeName: target.employeeName, employeeRole: target.employeeRole,
      department: target.department,
      type, provider, policyNumber, startDate, expiryDate, sumInsured, premiumAmount,
      currency,
      premiumFrequency: req.body.premiumFrequency || 'Yearly',
      employerContribution, employeeContribution,
      coverageDetails: String(req.body.coverageDetails || '').trim(),
      beneficiaries,
      status: req.body.status || (expiryDate < new Date().toISOString().slice(0, 10) ? 'Expired' : 'Active'),
      updatedBy: req.user._id,
    };
    const record = before
      ? await InsurancePolicy.findByIdAndUpdate(req.params.id, fields, { new: true, runValidators: true })
      : await InsurancePolicy.create({ ...fields, createdBy: req.user._id });
    await logActivity(req, 'Insurance', before ? 'Insurance policy updated or renewed' : 'Insurance policy assigned', record, before?.toObject(), record.toObject());
    await notifyEmployee(record, before ? 'Insurance policy updated' : 'Insurance policy assigned', `${record.type} policy has been ${before ? 'updated' : 'assigned'}.`);
    res.status(before ? 200 : 201).json({ success: true, data: publicPolicy(record) });
  } catch (err) {
    res.status(err.code === 11000 ? 409 : 500).json({ success: false, message: err.code === 11000 ? 'This policy number is already assigned to the employee.' : err.message });
  }
};

const updateInsuranceStatus = async (req, res) => {
  try {
    if (!['Active', 'Inactive', 'Terminated'].includes(req.body.status)) {
      return res.status(400).json({ success: false, message: 'Invalid insurance policy status.' });
    }
    const record = await InsurancePolicy.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Insurance policy not found.' });
    const previous = record.toObject();
    record.status = req.body.status;
    record.updatedBy = req.user._id;
    await record.save();
    await logActivity(req, 'Insurance', `Insurance policy ${req.body.status.toLowerCase()}`, record, previous, record.toObject());
    res.json({ success: true, data: publicPolicy(record) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const uploadInsuranceDocument = async (req, res) => {
  let savedPath;
  try {
    const record = await InsurancePolicy.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Insurance policy not found.' });
    const { name, mimeType, data } = req.body;
    const extension = MIME_EXTENSIONS[mimeType];
    if (!extension || typeof data !== 'string') {
      return res.status(400).json({ success: false, message: 'Only PDF, JPEG, or PNG policy documents are accepted.' });
    }
    const buffer = Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buffer.length || buffer.length > DOCUMENT_MAX_BYTES) {
      return res.status(400).json({ success: false, message: 'Document must be smaller than 5 MB.' });
    }
    const filename = `${crypto.randomUUID()}${extension}`;
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    savedPath = path.join(UPLOAD_DIR, filename);
    await fs.writeFile(savedPath, buffer, { flag: 'wx' });
    record.documents.push({
      filename,
      originalName: path.basename(String(name || `policy${extension}`)).slice(0, 160),
      mimeType,
      size: buffer.length,
    });
    record.updatedBy = req.user._id;
    await record.save();
    await logActivity(req, 'Insurance', 'Insurance document uploaded', record, null, { filename });
    res.status(201).json({ success: true, data: publicPolicy(record) });
  } catch (err) {
    if (savedPath) await fs.unlink(savedPath).catch(() => {});
    res.status(500).json({ success: false, message: err.message });
  }
};

const downloadInsuranceDocument = async (req, res) => {
  try {
    const record = await InsurancePolicy.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Insurance policy not found.' });
    const allowed = await authorizedBenefitScope(req);
    if (allowed && !(
      allowed.employeeIds.includes(record.employeeId)
      || (record.userId && allowed.userIds.some(id => String(id) === String(record.userId)))
    )) {
      return res.status(403).json({ success: false, message: 'You cannot access this policy document.' });
    }
    if (req.user.role === 'Manager' && !(await canViewSensitive(req.user.role, 'insurance.sensitive'))) {
      return res.status(403).json({ success: false, message: 'Managers do not have permission to access insurance documents.' });
    }
    const document = record.documents.find(item => item.filename === req.params.filename);
    if (!document || !MIME_EXTENSIONS[document.mimeType]) return res.status(404).json({ success: false, message: 'Document not found.' });
    const file = path.join(UPLOAD_DIR, path.basename(document.filename));
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${document.originalName.replace(/["\\\r\n]/g, '_')}"`);
    res.sendFile(file, err => {
      if (err && !res.headersSent) res.status(err.statusCode || 500).json({ success: false, message: 'Unable to read policy document.' });
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getActivityLogs = async (req, res) => {
  try {
    const filter = {};
    if (req.query.module) filter.module = req.query.module;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const records = await ActivityLog.find(filter).sort({ createdAt: -1 }).limit(limit);
    res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const notifyInsuranceExpirations = async () => {
  const today = new Date();
  const end = new Date(today.getTime());
  end.setDate(end.getDate() + 30);
  const todayStr = today.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const policies = await InsurancePolicy.find({
    status: 'Active',
    expiryDate: { $lte: endStr },
    userId: { $ne: null },
  });
  for (const policy of policies) {
    const expired = policy.expiryDate < todayStr;
    const title = expired ? 'Insurance policy expired' : 'Insurance policy expiring soon';
    const message = expired
      ? `${policy.type} policy expired on ${policy.expiryDate}.`
      : `${policy.type} policy expires on ${policy.expiryDate}.`;
    const existing = await Notification.exists({ userId: policy.userId, title, message });
    if (!existing) await Notification.create({ userId: policy.userId, employeeId: policy.employeeId, title, message, type: 'insurance' });
    if (expired) await InsurancePolicy.updateOne({ _id: policy._id, status: 'Active' }, { status: 'Expired' });
  }
};

module.exports = {
  getEligibleBenefitUsers, getAllowanceTypes, createAllowanceType, getAllowances, saveAllowance, deactivateAllowance,
  getPFConfiguration, createPFConfiguration, updatePFConfiguration, getPFRecords, savePFProfile, calculatePF, computePFContribution,
  validatePFConfiguration, findPFConfigurationOverlap,
  getInsurance, saveInsurance, updateInsuranceStatus, uploadInsuranceDocument, downloadInsuranceDocument,
  getActivityLogs, notifyInsuranceExpirations, INSURANCE_TYPES,
};
