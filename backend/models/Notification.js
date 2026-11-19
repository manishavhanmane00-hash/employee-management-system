const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  employeeId: { type: String },
  title:      { type: String, default: '' },
  message:    { type: String, required: true },
  type:       { type: String, default: 'info' },
  requestId:  { type: mongoose.Schema.Types.ObjectId, ref: 'CentralRequest', default: null, index: true },
  requesterName: { type: String, default: '' },
  requesterRole: { type: String, default: '' },
  requestType: { type: String, default: '' },
  requestDetails: { type: mongoose.Schema.Types.Mixed, default: null },
  requestStatus: { type: String, default: '' },
  actionUrl:  { type: String, default: '' },
  isRead:     { type: Boolean, default: false, index: true },
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
