const mongoose = require('mongoose');
const { parseISODate } = require('../services/holidaySync');

const holidaySchema = new mongoose.Schema({
  holidayName: { type: String, required: true },
  type:        { type: String, required: true, enum: ['Weekly', 'Monthly', 'Festival', 'Custom'] },
  // Holiday_Rule: fixed date for Festival/Custom; recurrence spec for Weekly/Monthly
  date:        { type: String, default: null },            // 'YYYY-MM-DD' for Festival/Custom
  startDate:   { type: String, default: null, index: true },
  endDate:     { type: String, default: null, index: true },
  recurrence:  {                                           // for Weekly/Monthly
    dayOfWeek:  { type: Number, default: null },           // 0-6 for Weekly
    dayOfMonth: { type: Number, default: null },           // 1-31 for Monthly
  },
  status:      { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  description: { type: String, default: '' },
  paidStatus:  { type: String, enum: ['Paid', 'Unpaid'], default: 'Paid' },
  applicableAll:       { type: Boolean, default: true },
  applicableEmployees: [{ type: String }],                 // employeeId subset when applicableAll=false
  applicableUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  employeeId:  { type: String, index: true },              // convention: creator/owner, optional
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
}, { timestamps: true });

holidaySchema.index({ status:  1, startDate: 1, endDate: 1 });

holidaySchema.pre('validate', function validateDateRange(next) {
  if (this.type === 'Festival' || this.type === 'Custom') {
    const start = this.startDate || this.date;
    const end = this.endDate || start;
    if (!parseISODate(start)) this.invalidate('startDate', 'Holiday From Date must be a valid YYYY-MM-DD date.');
    if (this.endDate && !parseISODate(this.endDate)) this.invalidate('endDate', 'Holiday To Date must be a valid YYYY-MM-DD date.');
    if (parseISODate(start) && parseISODate(end) && end < start) {
      this.invalidate('endDate', 'Holiday To Date must be on or after Holiday From Date.');
    }
  }
  next();
});

module.exports = mongoose.model('Holiday', holidaySchema);
