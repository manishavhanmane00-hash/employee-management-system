const mongoose = require('mongoose');

const overtimePolicySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  standardDailyHours: { type: Number, required: true, min: 0, max: 24 },
  hourlyRate: { type: Number, required: true, min: 0 },
  currency: { type: String, enum: ['INR', 'USD', 'UNVERIFIED'], default: 'INR' },
  unpaidBreakMinutes: { type: Number, default: 0, min: 0, max: 720 },
  weeklyOffDays: { type: [Number], default: [0], validate: days => days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) },
  holidayOvertimeEligible: { type: Boolean, default: true },
  effectiveFrom: { type: String, required: true, index: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

overtimePolicySchema.index({ userId: 1, effectiveFrom: 1 }, { unique: true });

module.exports = mongoose.model('OvertimePolicy', overtimePolicySchema);
