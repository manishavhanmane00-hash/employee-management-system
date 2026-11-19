const mongoose = require('mongoose');

const allowanceTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

module.exports = mongoose.model('AllowanceType', allowanceTypeSchema);
