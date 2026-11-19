const Allowance = require('../models/Allowance');
const InsurancePolicy = require('../models/InsurancePolicy');
const PFProfile = require('../models/PFProfile');
const PFContribution = require('../models/PFContribution');
const Overtime = require('../models/Overtime');
const Advance = require('../models/Advance');
const Leave = require('../models/Leave');
const Holiday = require('../models/Holiday');
const HolidayAttendance = require('../models/HolidayAttendance');
const { overtimeEarningsFor } = require('./overtimePayroll');
const { advanceDeductionsFor } = require('./advancePayroll');
const { calculatePFAmounts, getPFConfigurationForDate } = require('./pfCalculation');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const roundMoney = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const amountField = field => ({ $ifNull: [`$${field}`, 0] });
const payrollNetExpression = () => ({
  $ifNull: ['$net', {
    $subtract: [
      { $add: ['basic', 'hra', 'allowances', 'bonus', 'overtimeEarnings'].map(amountField) },
      { $add: ['tax', 'insurance', 'otherDeductions', 'advanceDeductions', 'employeePF', 'leaveDeduction'].map(amountField) },
    ],
  }],
});
const requireCurrency = (record, expected, label) => {
  const currency = record?.currency || 'UNVERIFIED';
  if (currency !== expected) {
    throw new Error(`${label} uses ${currency} currency, but the employee salary is ${expected}. Verify or correct currencies before payroll generation; no conversion was applied.`);
  }
};

const buildPayrollBreakdown = async (employee, month, year) => {
  const monthIndex = MONTHS.indexOf(month);
  const numericYear = Number(year);
  if (monthIndex < 0 || !Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 9999) {
    throw new Error('A valid payroll month and year are required.');
  }
  const periodStart = `${numericYear}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const periodEnd = `${numericYear}-${String(monthIndex + 1).padStart(2, '0')}-${String(new Date(numericYear, monthIndex + 1, 0).getDate()).padStart(2, '0')}`;
  const employeeId = employee.employeeId;
  const currency = employee.currency || 'UNVERIFIED';
  if (!['INR', 'USD'].includes(currency)) {
    throw new Error(`The salary currency for ${employee.name} is unverified. An authorized Admin or HR user must verify it before payroll generation.`);
  }
  const [allowancesForPeriod, insuranceForPeriod, overtimeEntries, advanceRecords, leaveRecords, holidayOccurrences] = await Promise.all([
    Allowance.find({
      isActive: true, effectiveFrom: { $lte: periodEnd },
      $and: [
        { $or: [{ employeeId }, ...(employee.userId ? [{ userId: employee.userId }] : [])] },
        { $or: [{ effectiveTo: '' }, { effectiveTo: { $gte: periodStart } }] },
      ],
    }),
    InsurancePolicy.find({
      status: 'Active', startDate: { $lte: periodEnd }, expiryDate: { $gte: periodStart },
      $or: [{ employeeId }, ...(employee.userId ? [{ userId: employee.userId }] : [])],
    }),
    Overtime.find({
      employeeId, status: 'Pending', counted: false,
      $or: [{ approvalStatus: 'Approved' }, { approvalStatus: { $exists: false } }],
    }),
    Advance.find({
      status: 'Salary Adjustment', deducted: false,
      $and: [
        { $or: [{ employeeId }, ...(employee.userId ? [{ userId: employee.userId }] : [])] },
        { $or: [{ approvalStatus: 'Approved' }, { approvalStatus: { $exists: false } }] },
      ],
    }).select('+repaymentHistory'),
    Leave.find({
      status: 'approved',
      startDate: { $lte: periodEnd },
      endDate: { $gte: periodStart },
      $or: [
        { employeeId: String(employeeId) },
        ...(employee.userId ? [{ userId: employee.userId }] : []),
        ...(employee.email ? [{ email: employee.email }] : []),
      ],
    }).sort({ startDate: 1, _id: 1 }),
    HolidayAttendance.find({
      date: { $gte: periodStart, $lte: periodEnd },
      $or: [
        { employeeId: String(employeeId) },
        ...(employee.userId ? [{ userId: employee.userId }] : []),
      ],
    }).select('holidayId date').lean(),
  ]);
  allowancesForPeriod.forEach(record => requireCurrency(record, currency, `Allowance ${record.type}`));
  insuranceForPeriod.forEach(record => requireCurrency(record, currency, `Insurance policy ${record.policyNumber}`));
  overtimeEntries.forEach(record => requireCurrency(record, currency, `Overtime record ${record._id}`));
  advanceRecords.forEach(record => requireCurrency(record, currency, `Advance ${record._id}`));
  const overtime = overtimeEarningsFor(overtimeEntries.map(item => item.toObject()), month, numericYear);
  const advance = advanceDeductionsFor(advanceRecords.map(item => item.toObject()), month, numericYear);
  const basic = roundMoney(Number(employee.salary || 0) / 12);
  const baseHra = roundMoney(Number(employee.hra || 0) / 12);
  const baseAllowance = roundMoney(Number(employee.allowances || 0) / 12);
  const bonus = roundMoney(Number(employee.bonus || 0) / 12);
  const allowanceBreakdown = allowancesForPeriod.map(allowance => ({
    allowanceId: allowance._id.toString(),
    type: allowance.type,
    amount: roundMoney(allowance.frequency === 'Yearly' ? allowance.amount / 12 : allowance.amount),
    frequency: allowance.frequency,
    effectiveFrom: allowance.effectiveFrom,
    effectiveTo: allowance.effectiveTo,
  }));
  const allowanceHra = allowanceBreakdown
    .filter(allowance => /HRA|house rent/i.test(allowance.type))
    .reduce((sum, allowance) => sum + allowance.amount, 0);
  const otherAllowances = allowanceBreakdown
    .filter(allowance => !/HRA|house rent/i.test(allowance.type))
    .reduce((sum, allowance) => sum + allowance.amount, 0);
  const hra = roundMoney(baseHra + allowanceHra);
  const allowancesTotal = roundMoney(baseAllowance + otherAllowances);
  const paidLeaveDates = new Set();
  const unpaidLeaveDates = new Set();
  const activeHolidayIds = holidayOccurrences.length
    ? await Holiday.distinct('_id', {
      _id: { $in: holidayOccurrences.map(item => item.holidayId) },
      status: 'active',
    })
    : [];
  const activeHolidayIdSet = new Set(activeHolidayIds.map(String));
  const holidayDates = new Set(holidayOccurrences
    .filter(item => activeHolidayIdSet.has(String(item.holidayId)))
    .map(item => item.date));
  const leaveIds = [];
  for (const leave of leaveRecords) {
    let hasLeaveDaysInPeriod = false;
    const leaveStart = leave.startDate > periodStart ? leave.startDate : periodStart;
    const leaveEnd = leave.endDate < periodEnd ? leave.endDate : periodEnd;
    const target = (leave.paidStatus || (leave.leaveType === 'Unpaid Leave' ? 'Unpaid' : 'Paid')) === 'Unpaid'
      ? unpaidLeaveDates
      : paidLeaveDates;
    for (let timestamp = Date.parse(`${leaveStart}T00:00:00Z`), end = Date.parse(`${leaveEnd}T00:00:00Z`);
      timestamp <= end;
      timestamp += 86400000) {
      const date = new Date(timestamp).toISOString().slice(0, 10);
      if (holidayDates.has(date)) continue;
      if (paidLeaveDates.has(date) || unpaidLeaveDates.has(date)) {
        throw new Error(`Overlapping approved leave records exist for ${employee.name} on ${date}. Resolve the overlap before generating payroll.`);
      }
      target.add(date);
      hasLeaveDaysInPeriod = true;
    }
    if (hasLeaveDaysInPeriod) leaveIds.push(leave._id);
  }
  const paidLeaveDays = paidLeaveDates.size;
  const unpaidLeaveDays = unpaidLeaveDates.size;
  const monthlyFixedEarnings = basic + hra + allowancesTotal + bonus;
  const payrollDays = new Date(numericYear, monthIndex + 1, 0).getDate();
  const leaveDeduction = roundMoney((monthlyFixedEarnings / payrollDays) * unpaidLeaveDays);
  const insuranceBreakdown = insuranceForPeriod.map(policy => {
    const divisor = policy.premiumFrequency === 'Yearly' ? 12 : 1;
    return {
      policyId: policy._id.toString(),
      type: policy.type,
      employeeContribution: roundMoney(policy.employeeContribution / divisor),
      employerContribution: roundMoney(policy.employerContribution / divisor),
    };
  });
  const insurance = roundMoney(insuranceBreakdown.reduce((sum, record) => sum + record.employeeContribution, 0));
  const insuranceEmployerContribution = roundMoney(insuranceBreakdown.reduce((sum, record) => sum + record.employerContribution, 0));

  const [pfProfile, existingPF, pfConfiguration] = await Promise.all([
    PFProfile.findOne({ $or: [{ employeeId }, ...(employee.userId ? [{ userId: employee.userId }] : [])] }),
    PFContribution.findOne({
      month, year: numericYear,
      $or: [{ employeeId }, ...(employee.userId ? [{ userId: employee.userId }] : [])],
    }),
    getPFConfigurationForDate(periodEnd),
  ]);
  if (pfProfile) requireCurrency(pfProfile, currency, `PF profile for ${employee.name}`);
  if (existingPF) requireCurrency(existingPF, currency, `PF contribution for ${employee.name}`);
  if (pfConfiguration) requireCurrency(pfConfiguration, currency, 'PF configuration');
  let pfRecord = existingPF;
  if (!pfRecord && pfProfile?.isEligible && pfProfile?.isApplicable && pfConfiguration) {
    const pfBasicSalary = Number(pfProfile.basicSalary || basic);
    pfRecord = {
      ...calculatePFAmounts({
        basicSalary: pfBasicSalary,
        grossSalary: pfBasicSalary + hra + allowancesTotal,
        configuration: pfConfiguration,
      }),
    };
  }

  const tax = 0;
  const otherDeductions = roundMoney(Number(employee.deductions || 0) / 12);
  const gross = roundMoney(basic + hra + allowancesTotal + bonus + overtime.amount);
  const employeePF = roundMoney(pfRecord?.employeeContribution || 0);
  const employerPF = roundMoney(pfRecord?.employerContribution || 0);
  const net = roundMoney(gross - tax - insurance - otherDeductions - advance.amount - employeePF - leaveDeduction);
  return {
    currency,
    basic, hra, allowances: allowancesTotal, bonus, tax, insurance, otherDeductions,
    overtimeEarnings: overtime.amount, overtimeIds: overtime.entryIds,
    leaveDeduction, paidLeaveDays, unpaidLeaveDays, leaveIds,
    advanceDeductions: advance.amount, advanceIds: advance.recordIds, advanceRepayments: advance.repayments,
    employeePF, employerPF, pfRecord, insuranceEmployerContribution, insuranceBreakdown,
    allowanceBreakdown, gross, net,
  };
};

module.exports = { buildPayrollBreakdown, payrollNetExpression };
