const Advance = require('../models/Advance');
const ActivityLog = require('../models/ActivityLog');
const { resolveRequestIdentity } = require('../services/employeeIdentity');
const { isValidAdvanceAmount } = require('../services/advancePayroll');
const { recordRequest, syncRequestDecision, updateRequestDetails, createUserNotification } = require('../services/centralRequestService');

const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank'];
const UPDATABLE_STATUSES = ['Paid', 'Settled/Returned', 'Salary Adjustment'];
const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const parseSupportingDocument = document => {
  if (!document) return null;
  if (typeof document.name !== 'string' || typeof document.mimeType !== 'string' || typeof document.data !== 'string') {
    throw new Error('Supporting document data is invalid.');
  }
  const match = document.data.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || match[1] !== document.mimeType || !DOCUMENT_MIME_TYPES.includes(document.mimeType)) {
    throw new Error('Supporting document must be a PDF, PNG, or JPEG file.');
  }
  const size = Buffer.byteLength(match[2], 'base64');
  if (!size || size > DOCUMENT_MAX_BYTES) throw new Error('Supporting document must be smaller than 5 MB.');
  return {
    name: document.name.replace(/[\r\n"]/g, '_').slice(0, 255),
    mimeType: document.mimeType,
    size,
    data: document.data,
  };
};

const recordHistory = (record, req, status, action, comment = '') => {
  record.history.push({
    status,
    action,
    performedBy: req.user._id,
    performedByName: req.user.name,
    comment,
  });
};

const advanceResponse = record => {
  const data = record.toObject ? record.toObject() : { ...record };
  delete data.submissionKey;
  if (data.supportingDocument) delete data.supportingDocument.data;
  return data;
};

const logActivity = async (req, record, action, previousValue = null) => {
  try {
    const data = record.toObject ? record.toObject() : record;
    await ActivityLog.create({
      userId: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      employeeId: data.employeeId,
      module: 'Advances',
      action,
      recordId: data._id.toString(),
      previousValue,
      updatedValue: data,
    });
    return null;
  } catch (error) {
    console.error(`[Advance ${record._id || 'deleted'}] Activity log failed:`, error.message);
    return 'Advance was saved, but its activity log could not be recorded.';
  }
};

const getAdvances = async (req, res) => {
  try {
    if (!['Admin', 'HR', 'Manager', 'Employee'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to view advance records.' });
    }
    const { status, employeeId, paymentMethod, submittedByRole, date } = req.query;
    const filter = req.user.role === 'Admin' ? {} : { userId: req.user._id };
    if (status) filter.approvalStatus = status;
    if (req.user.role === 'Admin') {
      if (employeeId) filter.employeeId = employeeId;
      if (submittedByRole) filter.submittedByRole = submittedByRole;
      if (date) filter.date = date;
    }
    if (paymentMethod) filter.paymentMethod = paymentMethod;

    const records = await Advance.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAdvance = async (req, res) => {
  try {
    if (!['Admin', 'HR', 'Manager', 'Employee'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to view advance records.' });
    }
    const record = await Advance.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Advance record not found' });
    if (req.user.role !== 'Admin' && record.userId?.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only view your own advance requests.' });
    }
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createAdvance = async (req, res) => {
  try {
    if (!['Employee', 'HR', 'Manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Advance applications are available to Employee, HR, and Manager accounts only.' });
    }
    const { date, amount, paymentMethod, reason, submissionKey } = req.body;
    if (!validDate(date)) return res.status(400).json({ success: false, message: 'Enter a valid advance date.' });
    if (!isValidAdvanceAmount(amount)) return res.status(400).json({ success: false, message: 'Amount must be greater than zero.' });
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: `Payment method must be one of: ${PAYMENT_METHODS.join(', ')}.` });
    }
    if (typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ success: false, message: 'Provide a reason for the advance.' });
    if (reason.length > 1000) return res.status(400).json({ success: false, message: 'Reason must be no more than 1000 characters.' });
    if (submissionKey !== undefined && (typeof submissionKey !== 'string' || !submissionKey.trim() || submissionKey.length > 100)) {
      return res.status(400).json({ success: false, message: 'Application submission key is invalid.' });
    }
    let supportingDocument;
    try {
      supportingDocument = parseSupportingDocument(req.body.supportingDocument);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    const target = await resolveRequestIdentity(req.user);
    if (target.error) return res.status(409).json({ success: false, message: target.error });

    const record = await Advance.create({
      employeeId: target.employee?.employeeId || null,
      userId: target.account._id,
      submissionKey: submissionKey?.trim(),
      submittedByRole: target.account.role,
      email: target.account.email || target.employee?.email || '',
      employeeName: target.account.name,
      date,
      amount: Number(amount),
      paymentMethod,
      reason: reason.trim(),
      status: 'Pending',
      approvalStatus: 'Pending Approval',
      outstandingBalance: 0,
      supportingDocument,
      history: [{
        status: 'Pending Approval',
        action: 'Applied',
        performedBy: target.account._id,
        performedByName: target.account.name,
      }],
    });
    try {
      await recordRequest({
        user: target.account,
        employeeId: target.employee?.employeeId,
        requestType: 'Advance',
        details: { date, amount: Number(amount), paymentMethod, reason: reason.trim() },
        sourceModel: 'Advance',
        sourceId: record._id,
      });
    } catch (error) {
      await record.deleteOne();
      throw error;
    }
    const warning = await logActivity(req, record, 'Advance created');
    res.status(201).json({ success: true, data: advanceResponse(record), ...(warning ? { warning } : {}) });
  } catch (err) {
    if (err.code === 11000 && req.body.submissionKey) {
      try {
        const existing = await Advance.findOne({ userId: req.user._id, submissionKey: req.body.submissionKey.trim() });
        if (existing) return res.status(200).json({ success: true, data: advanceResponse(existing) });
      } catch (lookupError) {
        console.error('[Advance] Duplicate application lookup failed:', lookupError.message);
        return res.status(500).json({ success: false, message: 'Unable to verify the existing advance application.' });
      }
      return res.status(409).json({ success: false, message: 'This application key was already used.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateAdvance = async (req, res) => {
  try {
    const record = await Advance.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Advance record not found' });
    const role = req.user.role;
    if (!['Admin', 'HR', 'Manager', 'Employee'].includes(role)) return res.status(403).json({ success: false, message: 'You cannot edit advance records.' });
    if (role !== 'Admin' && record.userId?.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only edit your own advance requests.' });
    }
    if (role !== 'Admin' && record.approvalStatus !== 'Pending Approval') {
      return res.status(409).json({ success: false, message: 'Only advance requests awaiting approval can be edited.' });
    }
    const previous = record.toObject();
    const { date, amount, paymentMethod, reason, status, repaymentAmount } = req.body;
    if (amount !== undefined && !isValidAdvanceAmount(amount)) return res.status(400).json({ success: false, message: 'Amount must be greater than zero.' });
    if (date !== undefined && !validDate(date)) return res.status(400).json({ success: false, message: 'Enter a valid advance date.' });
    if (paymentMethod !== undefined && !PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: `Payment method must be one of: ${PAYMENT_METHODS.join(', ')}.` });
    }
    if (reason !== undefined && (typeof reason !== 'string' || !reason.trim() || reason.length > 1000)) {
      return res.status(400).json({ success: false, message: 'Provide a reason with no more than 1000 characters.' });
    }
    let supportingDocument;
    if (req.body.supportingDocument !== undefined) {
      try {
        supportingDocument = parseSupportingDocument(req.body.supportingDocument);
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
      }
    }
    if (status !== undefined && !UPDATABLE_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${UPDATABLE_STATUSES.join(', ')}.` });
    }
    if (status !== undefined && role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Only Admin can change advance processing status.' });
    }
    if (status !== undefined && record.approvalStatus !== 'Approved') {
      return res.status(409).json({ success: false, message: 'Approve the advance request before disbursing or scheduling repayment.' });
    }
    if (repaymentAmount !== undefined && status !== 'Salary Adjustment') {
      return res.status(400).json({ success: false, message: 'A monthly repayment amount is only valid for Salary Adjustment.' });
    }
    if (repaymentAmount !== undefined && !isValidAdvanceAmount(repaymentAmount)) {
      return res.status(400).json({ success: false, message: 'Monthly repayment amount must be greater than zero.' });
    }
    if (date !== undefined) record.date = date;
    if (amount !== undefined) record.amount = Number(amount);
    if (paymentMethod !== undefined) record.paymentMethod = paymentMethod;
    if (reason !== undefined) record.reason = reason.trim();
    if (supportingDocument) record.supportingDocument = supportingDocument;
    if (status !== undefined) {
      const previousStatus = record.status;
      const outstanding = record.outstandingBalance == null
        ? (previousStatus === 'Salary Adjustment' ? record.amount : 0)
        : record.outstandingBalance;
      if (status === 'Paid' || status === 'Salary Adjustment') {
        record.disbursedAt = record.disbursedAt || new Date();
        record.disbursedBy = record.disbursedBy || req.user._id;
        if (outstanding <= 0) record.outstandingBalance = record.amount;
        if (status === 'Salary Adjustment') {
          const balance = Number(record.outstandingBalance || record.amount);
          const scheduled = repaymentAmount === undefined
            ? Number(record.repaymentAmount || balance)
            : Number(repaymentAmount);
          if (scheduled > balance) {
            return res.status(400).json({ success: false, message: 'Monthly repayment cannot exceed the outstanding advance balance.' });
          }
          record.repaymentAmount = scheduled;
        }
      } else if (status === 'Settled/Returned') {
        record.outstandingBalance = 0;
        record.repaymentAmount = null;
      }
      record.status = status;
      recordHistory(record, req, status, `Status changed to ${status}`);
    } else if (repaymentAmount !== undefined) {
      return res.status(400).json({ success: false, message: 'Select Salary Adjustment to configure a repayment amount.' });
    }
    if (status === undefined && (date !== undefined || amount !== undefined || paymentMethod !== undefined || reason !== undefined || supportingDocument)) {
      recordHistory(record, req, record.approvalStatus, 'Request updated');
    }
    await record.save();
    await updateRequestDetails({
      sourceModel: 'Advance',
      sourceId: record._id,
      details: { date: record.date, amount: record.amount, paymentMethod: record.paymentMethod, reason: record.reason },
    });
    if (status !== undefined) {
      await createUserNotification(record.userId, {
        employeeId: record.employeeId || '',
        title: status === 'Paid' ? 'Advance disbursed' : 'Advance updated',
        message: status === 'Salary Adjustment'
          ? `A monthly repayment of ${record.repaymentAmount} has been scheduled for your advance.`
          : `Your advance status is now ${status}.`,
        type: 'advance',
      });
    }
    const warning = await logActivity(req, record, 'Advance updated', previous);
    res.json({ success: true, data: advanceResponse(record), ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const setAdvanceApproval = async (req, res) => {
  try {
    if (req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Only Admin can review advance requests.' });
    }
    const { approvalStatus, approvalComment = '' } = req.body;
    if (!['Approved', 'Rejected'].includes(approvalStatus)) {
      return res.status(400).json({ success: false, message: 'Approval status must be Approved or Rejected.' });
    }
    const record = await Advance.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Advance request not found.' });
    if (record.approvalStatus !== 'Pending Approval') {
      return res.status(409).json({ success: false, message: 'Only advance requests awaiting approval can be reviewed.' });
    }
    if (String(record.userId) === String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You cannot review your own advance request.' });
    }
    const previous = record.toObject();
    record.approvalStatus = approvalStatus;
    record.approvalComment = String(approvalComment).trim().slice(0, 1000);
    record.approvedBy = req.user._id;
    record.approvedAt = new Date();
    recordHistory(record, req, approvalStatus, approvalStatus, record.approvalComment);
    await record.save();
    await syncRequestDecision({
      sourceModel: 'Advance',
      sourceId: record._id,
      status: approvalStatus,
      actor: req.user,
      comment: record.approvalComment,
    });
    const warning = await logActivity(req, record, `Advance request ${approvalStatus.toLowerCase()}`, previous);
    res.json({ success: true, data: advanceResponse(record), ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const downloadAdvanceDocument = async (req, res) => {
  try {
    const record = await Advance.findById(req.params.id).select('+supportingDocument.data');
    if (!record?.supportingDocument?.data) {
      return res.status(404).json({ success: false, message: 'Supporting document not found.' });
    }
    if (req.user.role !== 'Admin' && String(record.userId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'You can only access documents for your own advance requests.' });
    }
    const match = record.supportingDocument.data.match(/^data:[^;]+;base64,(.+)$/);
    if (!match) return res.status(500).json({ success: false, message: 'The stored supporting document is invalid.' });
    res.setHeader('Content-Type', record.supportingDocument.mimeType);
    res.setHeader('Content-Length', Buffer.byteLength(match[1], 'base64'));
    res.setHeader('Content-Disposition', `attachment; filename="${record.supportingDocument.name}"`);
    res.send(Buffer.from(match[1], 'base64'));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteAdvance = async (req, res) => {
  try {
    const record = await Advance.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Advance record not found' });
    if (req.user.role !== 'Admin') return res.status(403).json({ success: false, message: 'Only Admin can delete advance requests.' });
    const previous = record.toObject();
    await record.deleteOne();
    const warning = await logActivity(req, previous, 'Advance deleted', previous);
    res.json({ success: true, data: {}, ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getAdvances,
  getAdvance,
  createAdvance,
  updateAdvance,
  setAdvanceApproval,
  downloadAdvanceDocument,
  deleteAdvance,
};
