const mongoose = require('mongoose');

const overtimeSchema = new mongoose.Schema({
  employeeId:      { type: String, default: null, index: true },
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  submittedByRole: { type: String, enum: ['Admin', 'HR', 'Manager', 'Employee'], index: true },
  approvalStatus:  { type: String, enum: ['Pending Approval', 'Approved', 'Rejected'], default: 'Pending Approval', index: true },
  approvalComment: { type: String, default: '' },
  approvedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt:      { type: Date, default: null },
  email:           { type: String, index: true },
  employeeName:    { type: String },
  department:      { type: String, default: '' },
  designation:     { type: String, default: '' },
  date:            { type: String, required: true },       // 'YYYY-MM-DD'
  sourceType:      { type: String, enum: ['Manual', 'Attendance'], default: 'Manual', index: true },
  checkIn:         { type: String, default: null },
  checkOut:        { type: String, default: null },
  actualWorkingMinutes: { type: Number, default: null, min: 0 },
  standardWorkingMinutes: { type: Number, default: null, min: 0 },
  breakMinutes:    { type: Number, default: 0, min: 0 },
  durationHours:   { type: Number, default: 0, min: 0 },
  durationMinutes: { type: Number, default: 0, min: 0 },
  ratePerHour:     { type: Number, required: true, min: 0 },
  currency:        { type: String, enum: ['INR', 'USD', 'UNVERIFIED'], default: 'INR' },
  rateEffectiveFrom: { type: String, default: null },
  totalAmount:     { type: Number, default: 0 },           // (hours + minutes/60) * ratePerHour
  reason:          { type: String, default: '' },
  status:          { type: String, enum: ['Pending', 'Paid'], default: 'Pending', index: true },
  // payroll-sync bookkeeping
  counted:         { type: Boolean, default: false, index: true },
  countedMonth:    { type: String, default: null },
  countedYear:     { type: Number, default: null },
  paidAt:          { type: Date, default: null },
  paidBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  paymentReference:{ type: String, default: '' },
  paymentAmount:   { type: Number, default: null, min: 0 },
  calculationHistory: [{
    calculatedAt: { type: Date, required: true },
    attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance', default: null },
    checkIn: { type: String, default: null },
    checkOut: { type: String, default: null },
    elapsedMinutes: { type: Number, default: 0 },
    breakMinutes: { type: Number, default: 0 },
    actualWorkingMinutes: { type: Number, default: 0 },
    standardWorkingMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    ratePerHour: { type: Number, default: 0 },
    policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'OvertimePolicy', default: null },
    policyEffectiveFrom: { type: String, default: null },
    holiday: { type: Boolean, default: false },
    weeklyOff: { type: Boolean, default: false },
    retainedAsHistorical: { type: Boolean, default: false },
  }],
}, { timestamps: true });

overtimeSchema.index({ userId: 1, date: 1 }, { unique: true, partialFilterExpression: { sourceType: 'Attendance' } });

module.exports = mongoose.model('Overtime', overtimeSchema);
