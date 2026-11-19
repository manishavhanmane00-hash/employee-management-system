const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema({
  employeeId:   { type: String, required: true, index: true },
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  email:        { type: String },
  employeeName: { type: String },
  department:   { type: String },
  currency:     { type: String, enum: ['INR', 'USD', 'UNVERIFIED'], default: 'INR' },
  month:        { type: String, required: true },
  year:         { type: Number, required: true },
  basic:        { type: Number, default: 0 },
  hra:          { type: Number, default: 0 },
  allowances:   { type: Number, default: 0 },
  bonus:        { type: Number, default: 0 },
  tax:          { type: Number, default: 0 },
  insurance:    { type: Number, default: 0 },
  otherDeductions: { type: Number, default: 0 },
  overtimeEarnings:  { type: Number, default: 0 },  // additive to gross pay (Req 9.3)
  overtimeIds:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'Overtime' }],
  leaveDeduction: { type: Number, default: 0, min: 0 },
  paidLeaveDays: { type: Number, default: 0, min: 0 },
  unpaidLeaveDays: { type: Number, default: 0, min: 0 },
  leaveIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Leave' }],
  advanceDeductions: { type: Number, default: 0 },  // additive to deductions (Req 11.5)
  advanceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Advance' }],
  advanceRepayments: [{
    advanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Advance', required: true },
    amount: { type: Number, required: true, min: 0 },
    remainingBalance: { type: Number, required: true, min: 0 },
  }],
  employeePF:       { type: Number, default: 0 },
  employerPF:       { type: Number, default: 0 },
  pfBreakdown:      { type: mongoose.Schema.Types.Mixed, default: null },
  insuranceEmployerContribution: { type: Number, default: 0 },
  insuranceBreakdown: { type: [mongoose.Schema.Types.Mixed], default: [] },
  allowanceBreakdown: { type: [mongoose.Schema.Types.Mixed], default: [] },
  gross:            { type: Number, default: undefined },
  net:              { type: Number, default: undefined },
  paymentDate:  { type: String, default: null },
  status:       { type: String, enum: ['pending', 'approved', 'paid'], default: 'pending', index: true },
}, { timestamps: true });

payrollSchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('Payroll', payrollSchema);
