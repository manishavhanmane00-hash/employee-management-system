const CentralRequest = require('../models/CentralRequest');
const Leave = require('../models/Leave');
const Overtime = require('../models/Overtime');
const Advance = require('../models/Advance');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { addListener } = require('../services/notificationEvents');
const { createAdminRequestNotice, createUserNotification, syncRequestDecision } = require('../services/centralRequestService');

const isAdmin = user => user?.role === 'Admin';

const getRequests = async (req, res) => {
  try {
    const filter = isAdmin(req.user) ? {} : { requesterId: req.user.id };
    const { status, type } = req.query;
    if (status && ['Pending', 'Approved', 'Rejected', 'Review'].includes(status)) filter.status = status;
    if (type && typeof type === 'string') filter.requestType = type;
    const data = await CentralRequest.find(filter).sort({ submittedAt: -1 }).lean();
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitRequest = async (req, res) => {
  try {
    if (!['Employee', 'HR', 'Manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only Employee, HR, or Manager accounts can submit requests.' });
    }
    const { requestType, details, submissionKey } = req.body;
    if (typeof requestType !== 'string' || !requestType.trim() || requestType.trim().length > 100) {
      return res.status(400).json({ success: false, message: 'Provide a request type of at most 100 characters.' });
    }
    if (
      details === undefined
      || details === null
      || (typeof details === 'string' && !details.trim())
      || (typeof details !== 'string' && (typeof details !== 'object' || Array.isArray(details) || !Object.keys(details).length))
    ) {
      return res.status(400).json({ success: false, message: 'Request details are required.' });
    }
    const serialized = typeof details === 'string' ? details.trim() : JSON.stringify(details);
    if (serialized.length > 10000) return res.status(400).json({ success: false, message: 'Request details must be no more than 10,000 characters.' });

    const requester = await User.findById(req.user.id).select('name email employeeId role');
    if (!requester) return res.status(401).json({ success: false, message: 'Your account could not be resolved.' });
    if (submissionKey !== undefined && (typeof submissionKey !== 'string' || !/^[\w-]{1,100}$/.test(submissionKey))) {
      return res.status(400).json({ success: false, message: 'Invalid request submission key.' });
    }
    if (submissionKey) {
      const previousSubmission = await CentralRequest.findOne({ requesterId: requester._id, submissionKey });
      if (previousSubmission) return res.status(200).json({ success: true, data: previousSubmission });
    }
    let request;
    try {
      request = await CentralRequest.create({
      requesterId: requester._id,
      requesterName: requester.name,
      employeeId: requester.employeeId || null,
      email: requester.email || '',
      role: requester.role,
      requestType: requestType.trim(),
      details,
      status: 'Pending',
      submissionKey: submissionKey || null,
      history: [{
        status: 'Pending',
        action: 'Submitted',
        performedBy: requester._id,
        performedByName: requester.name,
      }],
      });
    } catch (error) {
      if (error.code === 11000 && submissionKey) {
        const duplicate = await CentralRequest.findOne({ requesterId: requester._id, submissionKey });
        if (duplicate) return res.status(200).json({ success: true, data: duplicate });
      }
      throw error;
    }
    await createAdminRequestNotice(request);
    res.status(201).json({ success: true, data: request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const reviewRequest = async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ success: false, message: 'Only Admin can review centralized requests.' });
    const { status, comment = '' } = req.body;
    if (!['Approved', 'Rejected', 'Review'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be Approved, Rejected, or Review.' });
    }
    if (typeof comment !== 'string' || comment.length > 1000) {
      return res.status(400).json({ success: false, message: 'Comment must be text with no more than 1,000 characters.' });
    }
    const request = await CentralRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });
    if (!['Pending', 'Review'].includes(request.status)) {
      return res.status(409).json({ success: false, message: `This request is already ${request.status.toLowerCase()}.` });
    }

    if (request.sourceModel && status !== 'Review') {
      let source;
      if (request.sourceModel === 'Leave') source = await Leave.findById(request.sourceId);
      if (request.sourceModel === 'Overtime') source = await Overtime.findById(request.sourceId);
      if (request.sourceModel === 'Advance') source = await Advance.findById(request.sourceId);
      if (!source) return res.status(409).json({ success: false, message: 'The linked request record no longer exists.' });
      if (request.sourceModel === 'Leave') {
        if (source.status !== 'pending') return res.status(409).json({ success: false, message: 'The linked leave request has already been processed.' });
        source.status = status.toLowerCase();
        source.approvedBy = req.user.name;
        source.approvedAt = new Date();
        source.rejectionReason = status === 'Rejected' ? comment.trim() : '';
        await source.save();
        if (status === 'Approved') {
          const start = new Date(source.startDate);
          const end = new Date(source.endDate);
          for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
            const date = day.toISOString().slice(0, 10);
            await Attendance.findOneAndUpdate(
              { employeeId: source.employeeId, date },
              { $set: {
                userId: source.userId,
                employeeId: source.employeeId,
                name: source.employeeName,
                email: source.email,
                department: source.department || '',
                date,
                status: 'leave',
                checkIn: null,
                checkOut: null,
                hours: 0,
                overtime: 0,
                late: false,
              } },
              { upsert: true, new: true }
            );
          }
        }
      } else {
        if (source.approvalStatus !== 'Pending Approval') return res.status(409).json({ success: false, message: 'The linked request has already been processed.' });
        source.approvalStatus = status;
        source.approvalComment = comment.trim();
        source.approvedBy = req.user._id;
        source.approvedAt = new Date();
        await source.save();
      }
    }

    request.status = status;
    request.history.push({
      status,
      action: status,
      performedBy: req.user._id,
      performedByName: req.user.name,
      comment: comment.trim(),
    });
    await request.save();
    await createUserNotification(request.requesterId, {
      employeeId: request.employeeId || '',
      title: `Request ${status}`,
      message: `Your ${request.requestType} request has been ${status.toLowerCase()}${comment.trim() ? `: ${comment.trim()}` : '.'}`,
      type: 'request',
      requestId: request._id,
      requesterName: request.requesterName,
      requesterRole: request.role,
      requestType: request.requestType,
      requestDetails: request.details,
      requestStatus: status,
    });
    res.json({ success: true, data: request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const streamNotifications = (req, res) => {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const onboardingComplete = req.user.role !== 'Employee'
    || (req.user.registrationStatus === 'approved'
      && req.user.accountStatus === 'active'
      && req.user.onboardingStatus === 'completed'
      && req.user.personalInfoApprovalStatus === 'approved'
      && req.user.documentVerificationStatus === 'verified');
  const allowedOnboardingNotifications = new Set(['registration', 'onboarding', 'account']);
  addListener(req.user.id, res, {
    filter: notification => onboardingComplete || allowedOnboardingNotifications.has(notification.type),
  });
  const heartbeat = setInterval(() => {
    if (!res.destroyed) res.write(': keep-alive\n\n');
  }, 25000);
  res.on('close', () => clearInterval(heartbeat));
};

module.exports = { getRequests, submitRequest, reviewRequest, streamNotifications };
