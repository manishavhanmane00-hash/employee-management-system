const mongoose = require('mongoose');

const designationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  normalizedName: { type: String, required: true, select: false },
  department: { type: String, required: true, trim: true, maxlength: 120 },
  normalizedDepartment: { type: String, required: true, select: false },
  description: { type: String, default: '', trim: true, maxlength: 1000 },
  status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
}, { timestamps: true });

designationSchema.pre('validate', function normalizeDesignation(next) {
  if (this.name) this.normalizedName = this.name.trim().toLocaleLowerCase();
  if (this.department) this.normalizedDepartment = this.department.trim().toLocaleLowerCase();
  next();
});

designationSchema.index(
  { normalizedName: 1, normalizedDepartment: 1 },
  { unique: true, name: 'designation_department_name_unique' },
);

module.exports = mongoose.model('Designation', designationSchema);
