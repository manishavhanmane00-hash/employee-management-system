const CentralRequest = require('../models/CentralRequest');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { publishNotification } = require('./notificationEvents');

const createUserNotification = async (userId, details) => {
  if (!userId) return null;
  const notification = await Notification.create({ userId, ...details });
  publishNotification(userId, notification);
  return notification;
};

const recordRequest = async ({ user, employeeId, requestType, details, sourceModel = null, sourceId = null, status = 'Pending' }) => {
  if (!user || !['Employee', 'HR', 'Manager'].includes(user.role)) return null;
  const initialHistory = [{
    status,
    action: 'Submitted',
    performedBy: user._id || user.id,
    performedByName: user.name,
    performedAt: new Date(),
  }];
  const filter = sourceModel && sourceId ? { sourceModel, sourceId } : null;
  let request;
  let created = false;
  if (filter) {
    request = await CentralRequest.findOne(filter);
    if (request) {
      request.requesterId = user._id || user.id;
      request.requesterName = user.name;
      request.employeeId = employeeId || null;
      request.email = user.email || '';
      request.role = user.role;
      request.requestType = requestType;
      request.details = details;
      request.status = status;
      await request.save();
    } else {
      request = await CentralRequest.create({
        requesterId: user._id || user.id,
        requesterName: user.name,
        employeeId: employeeId || null,
        email: user.email || '',
        role: user.role,
        requestType,
        details,
        status,
        sourceModel,
        sourceId,
        history: initialHistory,
      });
      created = true;
    }
  } else {
    request = await CentralRequest.create({
      requesterId: user._id || user.id,
      requesterName: user.name,
      employeeId: employeeId || null,
      email: user.email || '',
      role: user.role,
      requestType,
      details,
      status,
      history: initialHistory,
    });
    created = true;
  }

  if (created) {
    const admins = await User.find({ role: 'Admin', isActive: true }).select('_id').lean();
    const message = `${request.requesterName} submitted a ${request.requestType} request.`;
    await Promise.all(admins.map(admin => createUserNotification(admin._id, {
      employeeId: request.employeeId || '',
      title: 'New Request',
      message,
      type: 'request',
      requestId: request._id,
      requesterName: request.requesterName,
      requesterRole: request.role,
      requestType: request.requestType,
      requestDetails: request.details,
      requestStatus: request.status,
    })));
  }
  return request;
};

const syncRequestDecision = async ({ sourceModel, sourceId, status, actor, comment = '' }) => {
  const request = await CentralRequest.findOne({ sourceModel, sourceId });
  if (!request) return null;
  request.status = status;
  request.history.push({
    status,
    action: status,
    performedBy: actor?._id || actor?.id || null,
    performedByName: actor?.name || '',
    performedAt: new Date(),
    comment,
  });
  await request.save();
  if (request.requesterId.toString() !== String(actor?._id || actor?.id)) {
    await createUserNotification(request.requesterId, {
      employeeId: request.employeeId || '',
      title: `Request ${status}`,
      message: `Your ${request.requestType} request has been ${status.toLowerCase()}${comment ? `: ${comment}` : '.'}`,
      type: 'request',
      requestId: request._id,
      requesterName: request.requesterName,
      requesterRole: request.role,
      requestType: request.requestType,
      requestDetails: request.details,
      requestStatus: status,
    });
  }
  return request;
};

const updateRequestDetails = async ({ sourceModel, sourceId, details }) => {
  const request = await CentralRequest.findOne({ sourceModel, sourceId });
  if (!request) return null;
  request.details = details;
  await request.save();
  return request;
};

const createAdminRequestNotice = async request => {
  const admins = await User.find({ role: 'Admin', isActive: true }).select('_id').lean();
  const message = `${request.requesterName} submitted a ${request.requestType} request.`;
  await Promise.all(admins.map(admin => createUserNotification(admin._id, {
    employeeId: request.employeeId || '',
    title: 'New Request',
    message,
    type: 'request',
    requestId: request._id,
    requesterName: request.requesterName,
    requesterRole: request.role,
    requestType: request.requestType,
    requestDetails: request.details,
    requestStatus: request.status,
  })));
};

module.exports = {
  createAdminRequestNotice,
  createUserNotification,
  recordRequest,
  syncRequestDecision,
  updateRequestDetails,
};
