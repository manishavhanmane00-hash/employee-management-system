const mongoose = require('mongoose');

/**
 * Resignation Letter model.
 *
 * Tracks an employee's resignation submission through a multi-stage approval
 * workflow: Employee submits → Manager review → HR review → Final Admin/HR
 * sign-off → exit formalities completion.
 *
 * Statuses (workflow):
 *   Draft             — saved by the employee, not yet submitted
 *   Submitted         — submitted for manager review
 *   Manager Approved  — manager approved, awaiting HR review
 *   Manager Rejected   — manager rejected the resignation
 *   HR Approved        — HR approved after manager approval
 *   HR Rejected        — HR rejected the resignation
 *   Final Approved     — final administrative sign-off (Admin/HR)
 *   Withdrawn         — employee withdrew the resignation
 *   Completed         — exit formalities completed, employment ended
 *
 * Every approval / rejection / state change is recorded in `history` with the
 * acting user id, role, name, timestamp and comments (audit trail).
 */

const STATUS_ENUM = [
  'Draft',
  'Submitted',
  'Manager Approved',
  'Manager Rejected',
  'HR Approved',
  'HR Rejected',
  'Final Approved',
  'Withdrawn',
  'Completed',
];

const historySchema = new mongoose.Schema({
  status: { type: String, enum: STATUS_ENUM, required: true },
  action: { type: String, required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  performedByName: { type: String, default: '' },
  performedByRole: { type: String, default: '' },
  performedAt: { type: Date, default: Date.now },
  comment: { type: String, default: '' },
}, { _id: false });

const resignationSchema = new mongoose.Schema({
  // ── Submitter identity (auto-fetched from the linked employee record) ──────
  employeeId:          { type: String, default: null, index: true },
  userId:              { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  email:               { type: String, default: '', index: true },
  employeeName:        { type: String, default: '' },
  department:          { type: String, default: '' },
  designation:         { type: String, default: '' },
  reportingManager:    { type: String, default: '' },
  reportingManagerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  submittedByRole:     { type: String, default: '' },
  employeeRef:         { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },

  // ── Resignation details (form fields) ──────────────────────────────────────
  submissionDate:      { type: String, default: '' },            // resignation submission date (YYYY-MM-DD)
  resignationReason:   { type: String, default: '' },            // short reason (select / category)
  detailedExplanation: { type: String, default: '' },           // detailed explanation
  noticePeriod:        { type: String, default: '' },            // e.g. "30 days"
  proposedLastWorkingDay: { type: String, default: '' },        // employee-proposed last working day

  // Optional attachment (PDF / PNG / JPEG), stored as base64 data URL.
  attachment: {
    name: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    data: { type: String, default: undefined, select: false },
  },

  status: { type: String, enum: STATUS_ENUM, default: 'Draft', index: true },

  // ── Manager review ─────────────────────────────────────────────────────────
  managerComment:    { type: String, default: '' },
  managerReviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  managerReviewedAt:  { type: Date, default: null },
  managerReviewerName: { type: String, default: '' },

  // ── HR review ───────────────────────────────────────────────────────────────
  hrComment:    { type: String, default: '' },
  hrReviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  hrReviewedAt:  { type: Date, default: null },
  hrReviewerName: { type: String, default: '' },

  // ── Final sign-off ──────────────────────────────────────────────────────────
  finalizedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  finalizedAt:  { type: Date, default: null },
  finalizerName: { type: String, default: '' },

  // ── Exit formalities (managed by HR / Admin) ────────────────────────────────
  lastWorkingDay: { type: String, default: '' },            // HR/Admin-confirmed last working day
  exitStatus: {
    type: String,
    enum: ['Pending', 'In Progress', 'Cleared', 'Completed', 'On Hold'],
    default: 'Pending',
    index: true,
  },
  clearance: {
    assets: { type: String, enum: ['Pending', 'Cleared', 'Not Applicable'], default: 'Pending' },
    accounts: { type: String, enum: ['Pending', 'Cleared', 'Not Applicable'], default: 'Pending' },
    documents: { type: String, enum: ['Pending', 'Cleared', 'Not Applicable'], default: 'Pending' },
    knowledgeTransfer: { type: String, enum: ['Pending', 'Cleared', 'Not Applicable'], default: 'Pending' },
  },
  exitRemarks: { type: String, default: '' },
  completedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  completedAt:  { type: Date, default: null },

  // ── Withdraw ───────────────────────────────────────────────────────────────
  withdrawnBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  withdrawnAt: { type: Date, default: null },
  withdrawReason: { type: String, default: '' },

  // Prevents accidental duplicate submissions (same as the Advance pattern).
  submissionKey: { type: String, default: null },

  // Full audit / approval trail.
  history: { type: [historySchema], default: [] },
}, { timestamps: true });

// One active (non-withdrawn / non-completed) resignation per employee.
resignationSchema.index({ employeeId: 1, status: 1 });

module.exports = mongoose.model('Resignation', resignationSchema);
module.exports.STATUS_ENUM = STATUS_ENUM;
