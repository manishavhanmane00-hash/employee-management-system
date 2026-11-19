const mongoose = require('mongoose');

const currencyMigrationSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  executedAt: { type: Date, required: true },
  classifiedAsUnverified: { type: mongoose.Schema.Types.Mixed, required: true },
}, { versionKey: false });

module.exports = mongoose.model('CurrencyMigration', currencyMigrationSchema);
