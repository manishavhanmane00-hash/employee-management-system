const mongoose = require('mongoose');

const pfContributionSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, refPath: 'employeeModel', required: true },
  employeeModel: { type: String, enum: ['Employee', 'User'], default: 'Employee' },
  employeeId: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  employeeName: { type: String, required: true },
  employeeRole: { type: String, default: 'Employee' },
  department: { type: String, default: '' },
  month: { type: String, required: true },
  year: { type: Number, required: true },
  basicSalary: { type: Number, required: true },
  wageBasis: { type: Number, required: true },
  currency: { type: String, enum: ['INR', 'USD', 'UNVERIFIED'], default: 'INR' },
  employeeRate: { type: Number, required: true },
  employerRate: { type: Number, required: true },
  employeeContribution: { type: Number, required: true },
  employerContribution: { type: Number, required: true },
  epsContribution: { type: Number, required: true },
  edliContribution: { type: Number, required: true },
  employerEpfContribution: { type: Number, required: true },
  configuration: { type: mongoose.Schema.Types.ObjectId, ref: 'PFConfiguration', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

pfContributionSchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('PFContribution', pfContributionSchema);
