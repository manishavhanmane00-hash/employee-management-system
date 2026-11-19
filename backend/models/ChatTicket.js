const mongoose = require('mongoose');

const ticketHistorySchema = new mongoose.Schema({
  type: { type: String, enum: ['created', 'status', 'assignment', 'comment'], required: true },
  status: { type: String, enum: ['Open', 'Pending', 'Assigned', 'In Progress', 'Resolved', 'Closed'], default: null },
  message: { type: String, default: '', trim: true, maxlength: 2000 },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  performedByName: { type: String, required: true, maxlength: 120 },
  performedByRole: { type: String, enum: ['Admin', 'HR', 'Manager', 'Employee'], required: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const chatTicketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true, index: true },
  requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requesterName: { type: String, required: true, maxlength: 120 },
  requesterRole: { type: String, enum: ['Admin', 'HR', 'Manager', 'Employee'], required: true, index: true },
  employeeId: { type: String, default: '', maxlength: 64, index: true },
  issueKey: { type: String, default: '', maxlength: 500, index: true },
  module: { type: String, default: 'general', maxlength: 80, index: true },
  category: { type: String, default: 'General', trim: true, maxlength: 80 },
  subject: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, required: true, trim: true, maxlength: 4000 },
  status: { type: String, enum: ['Open', 'Pending', 'Assigned', 'In Progress', 'Resolved', 'Closed'], default: 'Open', index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  assignedName: { type: String, default: '', maxlength: 120 },
  history: { type: [ticketHistorySchema], default: [] },
}, { timestamps: true });

chatTicketSchema.index({ requesterId: 1, createdAt: -1 });
chatTicketSchema.index({ status: 1, updatedAt: -1 });
chatTicketSchema.index({ requesterId: 1, issueKey: 1, status: 1 });

module.exports = mongoose.model('ChatTicket', chatTicketSchema);
