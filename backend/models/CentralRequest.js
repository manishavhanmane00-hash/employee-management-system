const mongoose = require('mongoose');

const requestHistorySchema = new mongoose.Schema({
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Review', 'Cancelled'], required: true },
  action: { type: String, required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  performedByName: { type: String, default: '' },
  performedAt: { type: Date, default: Date.now },
  comment: { type: String, default: '' },
}, { _id: false });

const centralRequestSchema = new mongoose.Schema({
  requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requesterName: { type: String, required: true },
  employeeId: { type: String, default: null, index: true },
  email: { type: String, default: '' },
  role: { type: String, enum: ['Employee', 'HR', 'Manager'], required: true, index: true },
  requestType: { type: String, required: true, trim: true, maxlength: 100 },
  details: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Review', 'Cancelled'], default: 'Pending', index: true },
  submittedAt: { type: Date, default: Date.now, index: true },
  sourceModel: { type: String, default: null },
  sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  submissionKey: { type: String, default: null },
  history: { type: [requestHistorySchema], default: [] },
}, { timestamps: true });

centralRequestSchema.index(
  { sourceModel: 1, sourceId: 1 },
  { unique: true, partialFilterExpression: { sourceModel: { $type: 'string' }, sourceId: { $type: 'objectId' } } }
);
centralRequestSchema.index(
  { requesterId: 1, submissionKey: 1 },
  { unique: true, partialFilterExpression: { submissionKey: { $type: 'string' } } }
);

module.exports = mongoose.model('CentralRequest', centralRequestSchema);
