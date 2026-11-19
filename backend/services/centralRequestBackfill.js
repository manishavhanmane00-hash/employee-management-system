const mongoose = require('mongoose');
const CentralRequest = require('../models/CentralRequest');
const User = require('../models/User');
const Leave = require('../models/Leave');
const Overtime = require('../models/Overtime');
const Advance = require('../models/Advance');
const { createAdminRequestNotice } = require('./centralRequestService');

const REQUESTER_ROLES = ['Employee', 'HR', 'Manager'];

const resolveRequester = async record => {
  let user = null;
  if (record.userId && mongoose.Types.ObjectId.isValid(String(record.userId))) {
    user = await User.findById(record.userId).select('name email employeeId role');
  }
  if (!user && record.email) {
    user = await User.findOne({ email: record.email }).select('name email employeeId role');
  }
  return user;
};

const addRequest = async ({ sourceModel, record, user, requestType, details, status, submittedAt, decisionAt, decisionBy, decisionAction }) => {
  const existing = await CentralRequest.exists({ sourceModel, sourceId: record._id });
  if (existing) return false;
  const history = [{
    status: 'Pending',
    action: 'Submitted',
    performedBy: user._id,
    performedByName: user.name,
    performedAt: submittedAt || record.createdAt || new Date(),
  }];
  if (status !== 'Pending') {
    history.push({
      status,
      action: decisionAction || status,
      performedBy: mongoose.Types.ObjectId.isValid(String(decisionBy || '')) ? decisionBy : null,
      performedByName: typeof decisionBy === 'string' && !mongoose.Types.ObjectId.isValid(decisionBy) ? decisionBy : '',
      performedAt: decisionAt || record.updatedAt || new Date(),
    });
  }
  let request;
  try {
    request = await CentralRequest.create({
      requesterId: user._id,
      requesterName: user.name,
      employeeId: user.employeeId || (record.employeeId && !mongoose.Types.ObjectId.isValid(String(record.employeeId)) ? String(record.employeeId) : null),
      email: user.email || record.email || '',
      role: user.role,
      requestType,
      details,
      status,
      submittedAt: submittedAt || record.createdAt || new Date(),
      sourceModel,
      sourceId: record._id,
      history,
    });
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
  if (status === 'Pending') await createAdminRequestNotice(request);
  return true;
};

const syncExistingCentralRequests = async () => {
  let created = 0;
  const leaveRecords = await Leave.find({}).sort({ createdAt: 1 }).lean();
  for (const record of leaveRecords) {
    const user = await resolveRequester(record);
    if (!user || !REQUESTER_ROLES.includes(user.role)) continue;
    const status = record.status === 'approved' ? 'Approved'
      : record.status === 'rejected' || record.status === 'cancelled' ? 'Rejected' : 'Pending';
    const added = await addRequest({
      sourceModel: 'Leave',
      record,
      user,
      requestType: 'Leave',
      details: { leaveType: record.leaveType, startDate: record.startDate, endDate: record.endDate, days: record.days, reason: record.reason || '' },
      status,
      submittedAt: record.createdAt,
      decisionAt: record.approvedAt,
      decisionBy: record.approvedBy,
      decisionAction: record.status === 'cancelled' ? 'Cancelled' : status,
    });
    if (added) created += 1;
  }

  for (const [sourceModel, Model, requestType, toDetails] of [
    ['Overtime', Overtime, 'Overtime', record => ({
      date: record.date,
      durationHours: record.durationHours,
      durationMinutes: record.durationMinutes,
      ratePerHour: record.ratePerHour,
      estimatedAmount: record.totalAmount,
      reason: record.reason || '',
    })],
    ['Advance', Advance, 'Advance', record => ({
      date: record.date,
      amount: record.amount,
      paymentMethod: record.paymentMethod,
      reason: record.reason || '',
    })],
  ]) {
    const records = await Model.find({}).sort({ createdAt: 1 }).lean();
    for (const record of records) {
      const user = await resolveRequester(record);
      if (!user || !REQUESTER_ROLES.includes(user.role)) continue;
      const status = record.approvalStatus === 'Approved' ? 'Approved'
        : record.approvalStatus === 'Rejected' ? 'Rejected' : 'Pending';
      const added = await addRequest({
        sourceModel,
        record,
        user,
        requestType,
        details: toDetails(record),
        status,
        submittedAt: record.createdAt,
        decisionAt: record.approvedAt,
        decisionBy: record.approvedBy,
      });
      if (added) created += 1;
    }
  }
  return created;
};

module.exports = { syncExistingCentralRequests };
