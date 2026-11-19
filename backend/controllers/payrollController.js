const Payroll = require('../models/Payroll');
const Overtime = require('../models/Overtime');
const Advance = require('../models/Advance');
const Employee = require('../models/Employee');
const PFContribution = require('../models/PFContribution');
const ActivityLog = require('../models/ActivityLog');
const { createUserNotification } = require('../services/centralRequestService');
const { computePFContribution } = require('./benefitsController');
const { buildPayrollBreakdown } = require('../services/payrollCalculation');
const { resolvePermissionsForRole } = require('./permissionController');
const mongoose = require('mongoose');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const roundMoney = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

// GET /api/payroll (Admin: all; other roles: own unless Admin grants all-record access)
const getPayroll = async (req, res) => {
  try {
    const { employeeId, month, year } = req.query;
    const filter = {};
    if (!['Admin', 'HR', 'Manager', 'Employee'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to view salary records.' });
    }

    const { permissions } = ['HR', 'Manager'].includes(req.user.role)
      ? await resolvePermissionsForRole(req.user.role)
      : { permissions: {} };
    const canViewAll = req.user.role === 'Admin'
      || (['HR', 'Manager'].includes(req.user.role) && permissions['payroll.allRecords'] === true);
    if (!canViewAll) {
      const ownRecords = [{ userId: req.user._id }];
      if (req.user.email) ownRecords.push({ email: req.user.email });
      if (req.user.employeeId) ownRecords.push({ employeeId: req.user.employeeId });
      filter.$or = ownRecords;
    } else {
      if (employeeId) filter.employeeId = employeeId;
    }
    if (month) filter.month = month;
    if (year)  filter.year  = Number(year);

    const records = await Payroll.find(filter).sort({ year: -1, createdAt: -1 });
    res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/payroll  (admin generates payroll for one or more employees)
const generatePayroll = async (req, res) => {
  const results = [];
  const warnings = [];
  try {
    const records = Array.isArray(req.body) ? req.body : [req.body];

    for (const item of records) {
      const { employeeId: submittedEmployeeId, month, year, paymentDate } = item;
      const monthIndex = MONTHS.indexOf(month);
      const numericYear = Number(year);
      if (!submittedEmployeeId || monthIndex < 0 || !Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 9999) {
        return res.status(400).json({ success: false, message: 'A valid employee, month, and year are required for payroll.' });
      }

      const employeeFilters = [{ employeeId: String(submittedEmployeeId) }];
      if (mongoose.Types.ObjectId.isValid(String(submittedEmployeeId))) {
        employeeFilters.push({ _id: submittedEmployeeId });
      }
      const employee = await Employee.findOne({ isDraft: { $ne: true }, $or: employeeFilters });
      if (!employee || employee.status !== 'active') {
        return res.status(400).json({ success: false, message: `No active employee found for ${submittedEmployeeId}.` });
      }
      const employeeId = employee.employeeId;
      const existingPayroll = await Payroll.findOne({ employeeId, month, year: numericYear });
      if (existingPayroll) {
        return res.status(409).json({
          success: false,
          message: `Payroll for ${employee.name}, ${month} ${numericYear} already exists. Approved or processed payroll is never recalculated; use an authorized adjustment workflow.`,
        });
      }
      const breakdown = await buildPayrollBreakdown(employee, month, numericYear);
      const tax = 0;
      const priorPF = await PFContribution.findOne({ employeeId, month, year: numericYear });
      const pfRecord = await computePFContribution(employeeId, month, numericYear, req.user._id);
      const employeePF = roundMoney(pfRecord?.employeeContribution || 0);
      const employerPF = roundMoney(pfRecord?.employerContribution || 0);
      const net = roundMoney(
        breakdown.gross - tax - breakdown.insurance - breakdown.otherDeductions
        - breakdown.advanceDeductions - employeePF - breakdown.leaveDeduction
      );
      const pfBreakdown = pfRecord ? {
        wageBasis: pfRecord.wageBasis,
        employeeContribution: pfRecord.employeeContribution,
        employerEpfContribution: pfRecord.employerEpfContribution,
        epsContribution: pfRecord.epsContribution,
        edliContribution: pfRecord.edliContribution,
        employerContribution: pfRecord.employerContribution,
        employeeRate: pfRecord.employeeRate,
        employerRate: pfRecord.employerRate,
      } : null;
      const markedOvertimeIds = [];
      const markedAdvanceIds = [];
      const createdPFContributionId = pfRecord && !priorPF ? pfRecord._id : null;
      let createdPayroll;

      try {
        for (const id of breakdown.overtimeIds) {
          const result = await Overtime.updateOne(
            { _id: id, counted: false, status: 'Pending' },
            { counted: true, countedMonth: month, countedYear: numericYear }
          );
          if (!result.modifiedCount) throw new Error('Overtime changed during payroll generation; retry the payroll.');
          markedOvertimeIds.push(id);
        }
        for (const id of breakdown.advanceIds) {
          const result = await Advance.updateOne(
            { _id: id, deducted: false, status: 'Salary Adjustment' },
            { deducted: true, deductedMonth: month, deductedYear: numericYear }
          );
          if (!result.modifiedCount) throw new Error('Advance changed during payroll generation; retry the payroll.');
          markedAdvanceIds.push(id);
        }

        createdPayroll = await Payroll.create({
          employeeId,
          currency: employee.currency || 'UNVERIFIED',
          userId: employee.userId || null,
          employeeName: employee.name,
          email: employee.email || '',
          department: employee.department || '',
          month,
          year: numericYear,
          basic: breakdown.basic,
          hra: breakdown.hra,
          allowances: breakdown.allowances,
          bonus: breakdown.bonus,
          tax,
          insurance: breakdown.insurance,
          otherDeductions: breakdown.otherDeductions,
          overtimeEarnings: breakdown.overtimeEarnings,
          overtimeIds: breakdown.overtimeIds,
          leaveDeduction: breakdown.leaveDeduction,
          paidLeaveDays: breakdown.paidLeaveDays,
          unpaidLeaveDays: breakdown.unpaidLeaveDays,
          leaveIds: breakdown.leaveIds,
          advanceDeductions: breakdown.advanceDeductions,
          advanceIds: breakdown.advanceIds,
          advanceRepayments: breakdown.advanceRepayments,
          employeePF, employerPF, pfBreakdown,
          insuranceEmployerContribution: breakdown.insuranceEmployerContribution,
          insuranceBreakdown: breakdown.insuranceBreakdown,
          allowanceBreakdown: breakdown.allowanceBreakdown,
          gross: breakdown.gross,
          net,
          paymentDate: paymentDate || null,
          status: 'pending',
        });
        results.push(createdPayroll);
      } catch (itemErr) {
        // Revert the marks made in this iteration back to the pre-generation state
        // so no overtime/advance is excluded from a later successful generation (Req 9.5).
        for (const id of markedOvertimeIds) {
          await Overtime.updateOne(
            { _id: id, counted: true, countedMonth: month, countedYear: numericYear },
            { counted: false, countedMonth: null, countedYear: null }
          );
        }
        for (const id of markedAdvanceIds) {
          await Advance.updateOne(
            { _id: id, deducted: true, deductedMonth: month, deductedYear: numericYear },
            { deducted: false, deductedMonth: null, deductedYear: null }
          );
        }
        if (createdPFContributionId) {
          await PFContribution.deleteOne({ _id: createdPFContributionId });
        }
        throw itemErr;
      }

      try {
        for (const repayment of breakdown.advanceRepayments || []) {
          const result = await Advance.updateOne(
            { _id: repayment.advanceId, deducted: true, deductedMonth: month, deductedYear: numericYear },
            {
              $set: {
                outstandingBalance: repayment.remainingBalance,
                deducted: repayment.remainingBalance <= 0,
              },
              $push: {
                repaymentHistory: {
                  payrollId: createdPayroll._id,
                  month,
                  year: numericYear,
                  amount: repayment.amount,
                  remainingBalance: repayment.remainingBalance,
                  paidAt: new Date(),
                },
              },
            }
          );
          if (!result.modifiedCount) {
            warnings.push(`${employee.name}: payroll was created, but advance repayment history could not be synchronized.`);
            console.error(`[Payroll ${createdPayroll._id}] Advance ${repayment.advanceId} repayment sync failed.`);
          }
        }
        if (pfRecord && !priorPF) {
          await ActivityLog.create({
            userId: req.user._id, userName: req.user.name, userRole: req.user.role,
            employeeId, module: 'PF', action: 'PF contribution generated with payroll',
            recordId: pfRecord._id.toString(), previousValue: null, updatedValue: pfRecord.toObject(),
          });
          if (employee.userId) {
            await createUserNotification(employee.userId, {
              employeeId,
              title: 'PF contribution updated',
              message: `Your PF contribution for ${month} ${numericYear} has been calculated.`,
              type: 'pf',
            });
          }
        }
        if (employee.userId) {
          await createUserNotification(employee.userId, {
            employeeId,
            title: 'Payslip Generated',
            message: `Your payslip for ${month} ${numericYear} has been generated`,
            type: 'payroll',
          });
        }
      } catch (notificationError) {
        console.error(`[Payroll ${createdPayroll._id}] Follow-up notification or activity log failed:`, notificationError.message);
        warnings.push(`${employee.name}: payroll was created, but a notification or activity log could not be saved.`);
      }
    }

    res.status(201).json({ success: true, count: results.length, data: results, warnings });
  } catch (err) {
    res.status(results.length ? 201 : err.statusCode || 500).json({
      success: results.length > 0,
      count: results.length,
      data: results,
      message: err.message,
      warnings,
    });
  }
};

const getPayrollPreview = async (req, res) => {
  try {
    const { employeeIds, month, year } = req.body;
    const monthIndex = MONTHS.indexOf(month);
    const numericYear = Number(year);
    if (!Array.isArray(employeeIds) || !employeeIds.length || employeeIds.some(id => !String(id || '').trim())
      || monthIndex < 0 || !Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 9999) {
      return res.status(400).json({ success: false, message: 'Employee IDs, a valid month, and year are required for payroll preview.' });
    }

    const uniqueIds = [...new Set(employeeIds.map(id => String(id).trim()))];
    const employees = await Employee.find({
      isDraft: { $ne: true },
      status: 'active',
      employeeId: { $in: uniqueIds },
    });
    if (employees.length !== uniqueIds.length) {
      return res.status(400).json({ success: false, message: 'One or more selected employees are missing or inactive.' });
    }
    const data = await Promise.all(employees.map(async employee => ({
      employeeId: employee.employeeId,
      ...(await buildPayrollBreakdown(employee, month, numericYear)),
    })));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/payroll/:id/approve  (admin approves payroll)
const approvePayroll = async (req, res) => {
  try {
    const record = await Payroll.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
    if (!record) return res.status(404).json({ success: false, message: 'Payroll record not found' });
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const markPayrollPaid = async (req, res) => {
  try {
    if (req.user.role !== 'Admin') return res.status(403).json({ success: false, message: 'Only Admin can mark payroll as paid.' });
    const record = await Payroll.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Payroll record not found.' });
    if (record.status !== 'approved') return res.status(409).json({ success: false, message: 'Approve payroll before marking it as paid.' });
    const paidAt = new Date();
    const updatedOvertime = [];
    try {
      for (const id of record.overtimeIds || []) {
        const overtime = await Overtime.findOneAndUpdate(
          { _id: id, counted: true, status: 'Pending', approvalStatus: 'Approved' },
          {
            $set: {
              status: 'Paid',
              paidAt,
              paidBy: req.user._id,
              paymentReference: `Payroll ${record.month} ${record.year}`,
            },
          },
          { new: true }
        );
        if (!overtime) {
          const current = await Overtime.findById(id);
          if (current?.status === 'Paid' && current.counted) continue;
          const error = new Error('An included overtime entry is no longer payable. Payroll remains approved.');
          error.statusCode = 409;
          throw error;
        }
        overtime.paymentAmount = overtime.totalAmount;
        await overtime.save();
        updatedOvertime.push(overtime);
      }
      record.status = 'paid';
      record.paymentDate = record.paymentDate || paidAt.toISOString().slice(0, 10);
      await record.save();
    } catch (error) {
      for (const overtime of updatedOvertime) {
        overtime.status = 'Pending';
        overtime.paidAt = null;
        overtime.paidBy = null;
        overtime.paymentAmount = null;
        overtime.paymentReference = '';
        await overtime.save();
      }
      throw error;
    }
    await ActivityLog.create({
      userId: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      employeeId: record.employeeId,
      module: 'Payroll',
      action: `Payroll marked paid for ${record.month} ${record.year}`,
      recordId: record._id.toString(),
      updatedValue: record.toObject(),
    });
    if (record.userId) {
      await createUserNotification(record.userId, {
        employeeId: record.employeeId,
        title: 'Payroll Paid',
        message: `Your ${record.month} ${record.year} payroll was marked Paid.`,
        type: 'payroll',
      });
    }
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

module.exports = { getPayroll, getPayrollPreview, generatePayroll, approvePayroll, markPayrollPaid };
