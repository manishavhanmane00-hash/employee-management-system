const mongoose = require('mongoose');

const systemSetupSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  completedAt: { type: Date, required: true },
  initialAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  method: { type: String, enum: ['secure_setup', 'cli_seed', 'existing_admin'], required: true },
}, { versionKey: false });

module.exports = mongoose.model('SystemSetup', systemSetupSchema);
