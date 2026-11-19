const mongoose = require('mongoose');

const chatFeedbackSchema = new mongoose.Schema({
  responseId: { type: String, required: true, trim: true, maxlength: 80, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userRole: { type: String, enum: ['Admin', 'HR', 'Manager', 'Employee'], required: true, index: true },
  module: { type: String, default: 'general', trim: true, maxlength: 80, index: true },
  helpful: { type: Boolean, required: true, index: true },
  question: { type: String, required: true, trim: true, maxlength: 2000 },
  issueKey: { type: String, required: true, trim: true, maxlength: 500, index: true },
  answer: { type: String, required: true, trim: true, maxlength: 8000 },
  comment: { type: String, default: '', trim: true, maxlength: 1000 },
}, { timestamps: true });

chatFeedbackSchema.index({ userId: 1, responseId: 1 }, { unique: true });

module.exports = mongoose.model('ChatFeedback', chatFeedbackSchema);
