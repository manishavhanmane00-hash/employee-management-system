const Notification = require('../models/Notification');
const mongoose = require('mongoose');

const ONBOARDING_NOTIFICATION_TYPES = ['registration', 'onboarding', 'account'];
const notificationFilter = req => ({
  userId: req.user.id,
  ...(req.user.role === 'Employee' && !(
    req.user.registrationStatus === 'approved'
    && req.user.accountStatus === 'active'
    && req.user.onboardingStatus === 'completed'
    && req.user.personalInfoApprovalStatus === 'approved'
    && req.user.documentVerificationStatus === 'verified'
  ) ? { type: { $in: ONBOARDING_NOTIFICATION_TYPES } } : {}),
});

// GET /api/notifications  (own notifications only)
const getNotifications = async (req, res) => {
  try {
    const records = await Notification.find(notificationFilter(req)).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/notifications/:id/read
const markRead = async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, ...notificationFilter(req) },
      { isRead: true },
      { new: true }
    );
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, data: notif });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/notifications/read-all
const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany({ ...notificationFilter(req), isRead: false }, { isRead: true });
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/notifications/:id
const deleteNotification = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid notification ID.' });
    }
    const notification = await Notification.findOneAndDelete({ _id: req.params.id, ...notificationFilter(req) });
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found.' });
    res.json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/notifications  (create a notification — admin use)
const createNotification = async (req, res) => {
  try {
    const notif = await Notification.create({ ...req.body, userId: req.body.userId || req.user.id });
    res.status(201).json({ success: true, data: notif });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getNotifications, markRead, markAllRead, deleteNotification, createNotification };
