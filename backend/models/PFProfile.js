const mongoose = require('mongoose');

const pfProfileSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, refPath: 'employeeModel', required: true, unique: true },
  employeeModel: { type: String, enum: ['Employee', 'User'], default: 'Employee' },
  employeeId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  employeeName: { type: String, required: true },
  employeeRole: { type: String, default: 'Employee' },
  department: { type: String, default: '' },
  designation: { type: String, default: '' },
  pfAccountNumber: { type: String, default: '' },
  uanNumber: { type: String, default: '' },
  enrollmentDate: { type: String, default: '' },
  basicSalary: { type: Number, default: 0, min: 0 },
  currency: { type: String, enum: ['INR', 'USD', 'UNVERIFIED'], default: 'INR' },
  isEligible: { type: Boolean, default: true },
  isApplicable: { type: Boolean, default: true },
  exemptionReason: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('PFProfile', pfProfileSchema);
