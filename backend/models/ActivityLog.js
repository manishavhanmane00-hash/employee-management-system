const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userName: { type: String, required: true },
  userRole: { type: String, required: true },
  employeeId: { type: String, default: '' },
  module: { type: String, required: true, index: true },
  action: { type: String, required: true },
  recordId: { type: String, default: '' },
  previousValue: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedValue: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
