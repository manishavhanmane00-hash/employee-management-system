const mongoose = require('mongoose');

const isISODate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const pfConfigurationSchema = new mongoose.Schema({
  name: { type: String, required: true, default: 'PF rules' },
  effectiveFrom: { type: String, required: true, unique: true, index: true, validate: { validator: isISODate, message: 'Effective From must be a valid YYYY-MM-DD date.' } },
  effectiveTo: { type: String, default: null, index: true, validate: { validator: value => value == null || isISODate(value), message: 'Effective To must be a valid YYYY-MM-DD date.' } },
  employeeRate: { type: Number, required: true, min: 0, max: 100 },
  employerRate: { type: Number, required: true, min: 0, max: 100 },
  epsRate: { type: Number, required: true, min: 0, max: 100 },
  edliRate: { type: Number, required: true, min: 0, max: 100 },
  wageCeiling: { type: Number, default: null, min: [0.01, 'Wage ceiling must be positive.'] },
  currency: { type: String, enum: ['INR', 'USD', 'UNVERIFIED'], default: 'INR' },
  salaryBasis: { type: String, enum: ['basicSalary', 'grossSalary'], default: 'basicSalary' },
  notes: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

pfConfigurationSchema.pre('validate', function validatePFRule(next) {
  if (this.effectiveTo && this.effectiveFrom && this.effectiveTo < this.effectiveFrom) {
    this.invalidate('effectiveTo', 'Effective To must be on or after Effective From.');
  }
  if ([this.employerRate, this.epsRate, this.edliRate].every(Number.isFinite)
    && this.epsRate + this.edliRate > this.employerRate + 1e-9) {
    const message = 'EPS plus EDLI cannot exceed Employer Total Rate.';
    this.invalidate('employerRate', message);
    this.invalidate('epsRate', message);
    this.invalidate('edliRate', message);
  }
  if (this.notes && this.notes.length > 2000) this.invalidate('notes', 'Rule notes must be 2000 characters or fewer.');
  next();
});

module.exports = mongoose.model('PFConfiguration', pfConfigurationSchema);
