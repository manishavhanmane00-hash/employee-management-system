const mongoose = require('mongoose');

const allowanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, refPath: 'employeeModel', required: true, index: true },
  employeeModel: { type: String, enum: ['Employee', 'User'], default: 'Employee' },
  employeeId: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  employeeName: { type: String, required: true },
  employeeRole: { type: String, default: 'Employee' },
  department: { type: String, default: '' },
  type: { type: String, required: true, trim: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, enum: ['INR', 'USD', 'UNVERIFIED'], default: 'INR' },
  frequency: { type: String, enum: ['Monthly', 'Yearly'], required: true },
  effectiveFrom: { type: String, required: true },
  effectiveTo: { type: String, default: '' },
  description: { type: String, default: '' },
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

allowanceSchema.index({ employeeId: 1, type: 1, effectiveFrom: 1, effectiveTo: 1 });

module.exports = mongoose.model('Allowance', allowanceSchema);
