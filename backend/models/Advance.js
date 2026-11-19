const mongoose = require('mongoose');

const advanceSchema = new mongoose.Schema({
  employeeId:    { type: String, default: null, index: true },
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  submissionKey: { type: String, default: undefined, select: false },
  submittedByRole: { type: String, enum: ['Admin', 'HR', 'Manager', 'Employee'], index: true },
  approvalStatus: { type: String, enum: ['Pending Approval', 'Approved', 'Rejected'], default: 'Pending Approval', index: true },
  approvalComment: { type: String, default: '' },
  approvedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt:     { type: Date, default: null },
  email:         { type: String, index: true },
  employeeName:  { type: String },
  currency:      { type: String, enum: ['INR', 'USD', 'UNVERIFIED'], default: 'INR' },
  date:          { type: String, required: true },         // 'YYYY-MM-DD'
  amount:        { type: Number, required: true, min: 0.01 },
  paymentMethod: { type: String, enum: ['Cash', 'UPI', 'Bank'], default: 'Cash' },
  reason:        { type: String, default: '' },
  status:        { type: String, enum: ['Pending', 'Paid', 'Settled/Returned', 'Salary Adjustment'], default: 'Pending', index: true },
  disbursedAt:   { type: Date, default: null },
  disbursedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  repaymentAmount: { type: Number, default: null, min: 0 },
  outstandingBalance: { type: Number, default: undefined, min: 0 },
  repaymentHistory: [{
    payrollId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payroll' },
    month: { type: String, required: true },
    year: { type: Number, required: true },
    amount: { type: Number, required: true, min: 0 },
    remainingBalance: { type: Number, required: true, min: 0 },
    paidAt: { type: Date, default: Date.now },
  }],
  history: [{
    status: { type: String, required: true },
    action: { type: String, required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    performedByName: { type: String, default: '' },
    performedAt: { type: Date, default: Date.now },
    comment: { type: String, default: '' },
  }],
  supportingDocument: {
    name: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    data: { type: String, default: undefined, select: false },
  },
  // payroll-sync bookkeeping
  deducted:      { type: Boolean, default: false, index: true },
  deductedMonth: { type: String, default: null },
  deductedYear:  { type: Number, default: null },
}, { timestamps: true });

advanceSchema.index(
  { userId: 1, submissionKey: 1 },
  { unique: true, partialFilterExpression: { submissionKey: { $type: 'string' } } }
);

module.exports = mongoose.model('Advance', advanceSchema);
