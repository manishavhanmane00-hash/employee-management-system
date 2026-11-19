const mongoose = require('mongoose');

const allocationHistorySchema = new mongoose.Schema({
  previousDays: { type: Number, min: 0, default: 0 },
  allocatedDays: { type: Number, required: true, min: 0 },
  action: { type: String, enum: ['Created', 'Updated'], required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  performedByName: { type: String, default: '' },
  performedAt: { type: Date, default: Date.now },
  comment: { type: String, default: '' },
}, { _id: false });

const leaveAllocationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  employeeId: { type: String, default: null, index: true },
  employeeName: { type: String, required: true },
  role: { type: String, enum: ['Employee', 'HR', 'Manager'], required: true },
  department: { type: String, default: '' },
  leaveType: { type: String, required: true, enum: ['Annual Leave', 'Sick Leave', 'Casual Leave', 'Maternity Leave', 'Paternity Leave', 'Compensatory Leave'] },
  allocatedDays: { type: Number, required: true, min: 0 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  history: { type: [allocationHistorySchema], default: [] },
}, { timestamps: true });

leaveAllocationSchema.index({ userId: 1, leaveType: 1 }, { unique: true });

module.exports = mongoose.model('LeaveAllocation', leaveAllocationSchema);
