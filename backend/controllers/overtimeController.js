const Overtime = require('../models/Overtime');
const ActivityLog = require('../models/ActivityLog');
const {
  resolveRequestIdentity,
  managerTeamConditions,
} = require('../services/employeeIdentity');
const { overtimeAmount, isValidOvertimeInput } = require('../services/overtimePayroll');
const {
  recordRequest, syncRequestDecision, updateRequestDetails, createUserNotification,
} = require('../services/centralRequestService');

// ─────────────────────────────────────────────────────────────────────────────
// Validation message for rejected overtime input (Req 8.5).
// ─────────────────────────────────────────────────────────────────────────────
const INVALID_INPUT_MESSAGE =
  'Invalid overtime: at least one of durationHours or durationMinutes must be greater than 0, and ratePerHour must be non-negative.';

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const isValidOvertimeForm = input => {
  const hours = Number(input.durationHours);
  const minutes = Number(input.durationMinutes);
  const rate = Number(input.ratePerHour);
  return Number.isFinite(hours) && hours >= 0
    && Number.isFinite(minutes) && minutes >= 0 && minutes <= 59
    && isValidOvertimeInput(input)
    && Number.isFinite(rate) && rate >= 0;
};

const logOvertimeActivity = async (req, record, action, previousValue = null) => {
  try {
    const data = record.toObject ? record.toObject() : record;
    await ActivityLog.create({
      userId: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      employeeId: data.employeeId,
      module: 'Overtime',
      action,
      recordId: data._id.toString(),
      previousValue,
      updatedValue: data,
    });
    return null;
  } catch (error) {
    console.error(`[Overtime ${record._id || 'deleted'}] Activity log failed:`, error.message);
    return 'Overtime was saved, but its activity log could not be recorded.';
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/overtime  (Admin: all; other authorized roles: own requests by userId)
// ─────────────────────────────────────────────────────────────────────────────
const getOvertime = async (req, res) => {
  try {
    if (!['Admin', 'HR', 'Manager', 'Employee'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to view overtime records.' });
    }
    const { status, employeeId, submittedByRole, date, startDate, endDate, department, paymentStatus } = req.query;
    const filter = req.user.role === 'Admin'
      ? {}
      : req.user.role === 'Manager'
        ? { $or: await managerTeamConditions(req.user) }
        : { userId: req.user._id };
    if (status) filter.approvalStatus = status;
    if (['Admin', 'Manager'].includes(req.user.role)) {
      if (employeeId) filter.employeeId = employeeId;
      if (submittedByRole) filter.submittedByRole = submittedByRole;
      if (date) filter.date = date;
      if (department) filter.department = department;
    }
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = startDate;
      if (endDate) filter.date.$lte = endDate;
    }
    if (paymentStatus === 'Paid' || paymentStatus === 'Pending') filter.status = paymentStatus;

    const records = await Overtime.find(filter).sort({ createdAt: -1 });
    const summary = records.reduce((result, record) => {
      result.totalOvertimeMinutes += (Number(record.durationHours) || 0) * 60 + (Number(record.durationMinutes) || 0);
      result.totalAmount += Number(record.totalAmount) || 0;
      if (record.status === 'Paid') {
        result.paidAmount += Number(record.paymentAmount ?? record.totalAmount) || 0;
        result.paidOvertimeMinutes += (Number(record.durationHours) || 0) * 60 + (Number(record.durationMinutes) || 0);
      } else if (record.approvalStatus === 'Approved') {
        result.pendingAmount += Number(record.totalAmount) || 0;
        result.pendingOvertimeMinutes += (Number(record.durationHours) || 0) * 60 + (Number(record.durationMinutes) || 0);
      }
      return result;
    }, { totalOvertimeMinutes: 0, totalAmount: 0, paidAmount: 0, paidOvertimeMinutes: 0, pendingAmount: 0, pendingOvertimeMinutes: 0 });
    res.json({ success: true, count: records.length, data: records, summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/overtime  (authenticated account submits its own overtime request)
//  - validates via the pure overtime predicate
//  - computes totalAmount = (hours + minutes/60) * ratePerHour
//  - sets status "Pending"
// ─────────────────────────────────────────────────────────────────────────────
const createOvertime = async (req, res) => {
  try {
    if (req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Overtime is calculated from attendance. Employees, HR, and Managers cannot create or edit overtime amounts.' });
    }
    const {
      date,
      durationHours, durationMinutes, ratePerHour, reason,
    } = req.body;

    if (!validDate(date)) {
      return res.status(400).json({ success: false, message: 'Enter a valid overtime date.' });
    }

    if (!isValidOvertimeForm({ durationHours, durationMinutes, ratePerHour })) {
      return res.status(400).json({ success: false, message: INVALID_INPUT_MESSAGE });
    }
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000)) {
      return res.status(400).json({ success: false, message: 'Reason must be text with no more than 1000 characters.' });
    }

    const identity = await resolveRequestIdentity(req.user);
    if (identity.error) return res.status(409).json({ success: false, message: identity.error });
    const { account, employee } = identity;

    const hours   = Number(durationHours) || 0;
    const minutes = Number(durationMinutes) || 0;
    const rate    = Number(ratePerHour);

    const entry = await Overtime.create({
      employeeId: employee?.employeeId || null,
      userId: account._id,
      submittedByRole: account.role,
      email: account.email || employee?.email || '',
      employeeName: account.name,
      date,
      durationHours:   hours,
      durationMinutes: minutes,
      ratePerHour:     rate,
      totalAmount:     overtimeAmount(hours, minutes, rate),
      reason: (reason || '').trim(),
      status: 'Pending',
      approvalStatus: 'Pending Approval',
    });

    await recordRequest({
      user: account,
      employeeId: employee?.employeeId,
      requestType: 'Overtime',
      details: {
        date,
        durationHours: hours,
        durationMinutes: minutes,
        ratePerHour: rate,
        estimatedAmount: overtimeAmount(hours, minutes, rate),
        reason: (reason || '').trim(),
      },
      sourceModel: 'Overtime',
      sourceId: entry._id,
    });
    const warning = await logOvertimeActivity(req, entry, 'Overtime logged');
    res.status(201).json({ success: true, data: entry, ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/overtime/:id  (Admin or request owner updates; recomputes totalAmount)
// ─────────────────────────────────────────────────────────────────────────────
const updateOvertime = async (req, res) => {
  try {
    const entry = await Overtime.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Overtime entry not found' });

    const previous = entry.toObject();
    const {
      date,
      durationHours, durationMinutes, ratePerHour, reason, status,
    } = req.body;

    const role = req.user.role;
    if (role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Only Admin can update overtime records.' });
    }
    if (status !== undefined && !['Pending', 'Paid'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be Pending or Paid.' });
    }
    if (status === 'Paid' && entry.approvalStatus !== 'Approved') {
      return res.status(409).json({ success: false, message: 'Approve the overtime request before marking it as paid.' });
    }

    // Resolve the effective duration/rate (new value when provided, else existing)
    const hours = durationHours   !== undefined ? Number(durationHours) : entry.durationHours;
    const minutes = durationMinutes !== undefined ? Number(durationMinutes) : entry.durationMinutes;
    const rate  = ratePerHour     !== undefined ? Number(ratePerHour) : entry.ratePerHour;

    if (!isValidOvertimeForm({ durationHours: hours, durationMinutes: minutes, ratePerHour: rate })) {
      return res.status(400).json({ success: false, message: INVALID_INPUT_MESSAGE });
    }

    if (date !== undefined && !validDate(date)) {
      return res.status(400).json({ success: false, message: 'Enter a valid overtime date.' });
    }
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000)) {
      return res.status(400).json({ success: false, message: 'Reason must be text with no more than 1000 characters.' });
    }
    if (date !== undefined)         entry.date = date;
    if (reason !== undefined)       entry.reason = (reason || '').trim();
    if (status !== undefined && ['Pending', 'Paid'].includes(status)) entry.status = status;

    entry.durationHours   = hours;
    entry.durationMinutes = minutes;
    entry.ratePerHour     = rate;
    entry.totalAmount     = overtimeAmount(hours, minutes, rate);

    await entry.save();
    await updateRequestDetails({
      sourceModel: 'Overtime',
      sourceId: entry._id,
      details: {
        date: entry.date,
        durationHours: entry.durationHours,
        durationMinutes: entry.durationMinutes,
        ratePerHour: entry.ratePerHour,
        estimatedAmount: entry.totalAmount,
        reason: entry.reason,
      },
    });
    const warning = await logOvertimeActivity(req, entry, 'Overtime updated', previous);
    res.json({ success: true, data: entry, ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const setOvertimeApproval = async (req, res) => {
  try {
    const { approvalStatus, approvalComment = '' } = req.body;
    if (!['Approved', 'Rejected'].includes(approvalStatus)) {
      return res.status(400).json({ success: false, message: 'Approval status must be Approved or Rejected.' });
    }
    const entry = await Overtime.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Overtime request not found.' });
    if (entry.approvalStatus !== 'Pending Approval') {
      return res.status(409).json({ success: false, message: 'Only overtime requests awaiting approval can be reviewed.' });
    }
    const previous = entry.toObject();
    entry.approvalStatus = approvalStatus;
    entry.approvalComment = String(approvalComment).trim().slice(0, 1000);
    entry.approvedBy = req.user._id;
    entry.approvedAt = new Date();
    await entry.save();
    await syncRequestDecision({
      sourceModel: 'Overtime',
      sourceId: entry._id,
      status: approvalStatus,
      actor: req.user,
      comment: entry.approvalComment,
    });
    const warning = await logOvertimeActivity(req, entry, `Overtime request ${approvalStatus.toLowerCase()}`, previous);
    res.json({ success: true, data: entry, ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/overtime/:id/settle  (Admin marks an approved entry as Paid)
// ─────────────────────────────────────────────────────────────────────────────
const settleOvertime = async (req, res) => {
  try {
    if (req.user.role !== 'Admin') return res.status(403).json({ success: false, message: 'Only Admin can settle overtime requests.' });
    const entry = await Overtime.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Overtime entry not found' });
    if (entry.approvalStatus !== 'Approved') {
      return res.status(409).json({ success: false, message: 'Approve the overtime request before settling it.' });
    }
    if (entry.status === 'Paid') return res.status(409).json({ success: false, message: 'This overtime entry has already been paid.' });
    if (entry.counted) return res.status(409).json({ success: false, message: 'This overtime entry is already included in payroll and cannot be paid separately.' });

    const previous = entry.toObject();
    const { paymentReference = '' } = req.body;
    if (typeof paymentReference !== 'string' || paymentReference.length > 200) {
      return res.status(400).json({ success: false, message: 'Payment reference must be text with no more than 200 characters.' });
    }
    entry.status = 'Paid';
    entry.paidAt = new Date();
    entry.paidBy = req.user._id;
    entry.paymentReference = paymentReference.trim();
    entry.paymentAmount = entry.totalAmount;
    await entry.save();

    if (entry.userId) {
      await createUserNotification(entry.userId, {
        employeeId: entry.employeeId || '',
        title: 'Overtime Paid',
        message: `Your overtime payment of ${entry.paymentAmount} was marked Paid.${entry.paymentReference ? ` Reference: ${entry.paymentReference}` : ''}`,
        type: 'overtime',
      });
    }
    const warning = await logOvertimeActivity(req, entry, 'Overtime marked as paid', previous);
    res.json({ success: true, data: entry, ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/overtime/:id  (Admin deletes an entry)
// ─────────────────────────────────────────────────────────────────────────────
const deleteOvertime = async (req, res) => {
  try {
    if (req.user.role !== 'Admin') return res.status(403).json({ success: false, message: 'Only Admin can delete overtime requests.' });
    const entry = await Overtime.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Overtime entry not found' });

    const previous = entry.toObject();
    await entry.deleteOne();

    const warning = await logOvertimeActivity(req, previous, 'Overtime deleted', previous);
    res.json({ success: true, data: {}, ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getOvertime,
  createOvertime,
  updateOvertime,
  settleOvertime,
  setOvertimeApproval,
  deleteOvertime,
};
