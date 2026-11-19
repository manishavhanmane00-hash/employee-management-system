const mongoose = require('mongoose');

const beneficiarySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  relationship: { type: String, default: '' },
  sharePercent: { type: Number, min: 0, max: 100, default: 0 },
}, { _id: false });

const documentSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false });

const insurancePolicySchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, refPath: 'employeeModel', required: true, index: true },
  employeeModel: { type: String, enum: ['Employee', 'User'], default: 'Employee' },
  employeeId: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  employeeName: { type: String, required: true },
  employeeRole: { type: String, default: 'Employee' },
  department: { type: String, default: '' },
  type: { type: String, required: true, trim: true, index: true },
  provider: { type: String, required: true, trim: true },
  policyNumber: { type: String, required: true, trim: true },
  startDate: { type: String, required: true },
  expiryDate: { type: String, required: true, index: true },
  sumInsured: { type: Number, required: true, min: 0 },
  premiumAmount: { type: Number, required: true, min: 0 },
  currency: { type: String, enum: ['INR', 'USD', 'UNVERIFIED'], default: 'INR' },
  premiumFrequency: { type: String, enum: ['Monthly', 'Yearly'], default: 'Yearly' },
  employerContribution: { type: Number, default: 0, min: 0 },
  employeeContribution: { type: Number, default: 0, min: 0 },
  coverageDetails: { type: String, default: '' },
  beneficiaries: { type: [beneficiarySchema], default: [] },
  documents: { type: [documentSchema], default: [] },
  status: { type: String, enum: ['Active', 'Inactive', 'Terminated', 'Expired'], default: 'Active', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

insurancePolicySchema.index({ employeeId: 1, policyNumber: 1 }, { unique: true });

module.exports = mongoose.model('InsurancePolicy', insurancePolicySchema);
