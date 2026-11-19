const mongoose = require('mongoose');

const chatKnowledgeSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: String, required: true, trim: true, maxlength: 80 },
  module: { type: String, default: 'general', trim: true, maxlength: 80 },
  content: { type: String, required: true, trim: true, maxlength: 8000 },
  audience: {
    type: [{ type: String, enum: ['Admin', 'HR', 'Manager', 'Employee'] }],
    default: ['Admin', 'HR', 'Manager', 'Employee'],
  },
  verified: { type: Boolean, default: false, index: true },
  active: { type: Boolean, default: true, index: true },
  source: { type: String, default: 'Admin-maintained EMS knowledge base', maxlength: 200 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

chatKnowledgeSchema.index({ verified: 1, active: 1, module: 1 });
chatKnowledgeSchema.index({ title: 'text', category: 'text', content: 'text' });

module.exports = mongoose.model('ChatKnowledge', chatKnowledgeSchema);
