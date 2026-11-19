const mongoose = require('mongoose');
const Resignation = require('../models/Resignation');
const User = require('../models/User');
const Employee = require('../models/Employee');
const ActivityLog = require('../models/ActivityLog');
const { resolveRequestIdentity, managerTeamConditions, managerAssignedEmployees } = require('../services/employeeIdentity');
const { createUserNotification } = require('../services/centralRequestService');

const STATUS_ENUM = Resignation.STATUS_ENUM;

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const parseAttachment = document => {
  if (!document) return null;
  if (typeof document.name !== 'string' || typeof document.mimeType !== 'string' || typeof document.data !== 'string') {
    throw new Error('Attachment data is invalid.');
  }
  const match = document.data.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || match[1] !== document.mimeType || !DOCUMENT_MIME_TYPES.includes(document.mimeType)) {
    throw new Error('Attachment must be a PDF, PNG, or JPEG file.');
  }
  const size = Buffer.byteLength(match[2], 'base64');
  if (!size || size > DOCUMENT_MAX_BYTES) throw new Error('Attachment must be smaller than 5 MB.');
  return {
    name: document.name.replace(/[\r\n"]/g, '_').slice(0, 255),
    mimeType: document.mimeType,
    size,
    data: document.data,
  };
};

const resignationResponse = record => {
  const data = record.toObject ? record.toObject() : { ...record };
  delete data.submissionKey;
  if (data.attachment) delete data.attachment.data;
  return data;
};

const logActivity = async (req, record, action, previousValue = null) => {
  try {
    const data = record.toObject ? record.toObject() : record;
    await ActivityLog.create({
      userId: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      employeeId: data.employeeId || '',
      module: 'Resignation',
      action,
      recordId: data._id.toString(),
      previousValue,
      updatedValue: data,
    });
    return null;
  } catch (error) {
    console.error(`[Resignation ${record._id || 'deleted'}] Activity log failed:`, error.message);
    return 'Resignation was saved, but its activity log could not be recorded.';
  }
};

const pushHistory = (record, req, status, action, comment = '') => {
  record.history.push({
    status,
    action,
    performedBy: req.user._id,
    performedByName: req.user.name,
    performedByRole: req.user.role,
    comment: String(comment || '').slice(0, 2000),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Build the query filter for listing resignations, scoped by role.
//   Admin  — every record (no restriction)
//   HR     — every record
//   Manager — own + team members
//   Employee — own only
// ─────────────────────────────────────────────────────────────────────────────
const buildListFilter = async (req, query = {}) => {
  const role = req.user.role;
  const filter = {};

  if (role === 'Admin' || role === 'HR') {
    // Full visibility across all employees / departments.
  } else if (role === 'Manager') {
    filter.$or = await managerTeamConditions(req.user);
  } else {
    // Employee — own records only.
    const owner = [];
    if (req.user.id) owner.push({ userId: req.user._id });
    if (req.user.employeeId) owner.push({ employeeId: String(req.user.employeeId) });
    if (req.user.email) owner.push({ email: req.user.email });
    filter.$or = owner.length ? owner : [{ userId: null }];
  }

  const { status, employeeId, department, search, exitStatus, submittedByRole } = query;
  if (status) filter.status = status;
  if (exitStatus) filter.exitStatus = exitStatus;
  if (employeeId) filter.employeeId = employeeId;
  if (department) filter.department = department;
  if (submittedByRole && (role === 'Admin' || role === 'HR')) filter.submittedByRole = submittedByRole;

  // Free-text search across name / employeeId / department / designation / reason.
  if (search && typeof search === 'string' && search.trim()) {
    const term = search.trim();
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$and = [
      ...(filter.$and || []),
      { $or: [
        { employeeName: rx },
        { employeeId: rx },
        { department: rx },
        { designation: rx },
        { resignationReason: rx },
        { email: rx },
      ] },
    ];
  }
  return filter;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resignations — list (role-scoped)
// ─────────────────────────────────────────────────────────────────────────────
const getResignations = async (req, res) => {
  try {
    const filter = await buildListFilter(req, req.query);
    const records = await Resignation.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: records.length, data: records.map(resignationResponse) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resignations/stats — dashboard counts (Admin/HR full, others scoped)
// ─────────────────────────────────────────────────────────────────────────────
const getResignationStats = async (req, res) => {
  try {
    const filter = await buildListFilter(req, req.query);
    const records = await Resignation.find(filter).lean();
    const stats = {
      total: records.length,
      pending: 0,
      managerApproved: 0,
      hrApproved: 0,
      rejected: 0,
      completed: 0,
      withdrawn: 0,
      finalApproved: 0,
    };
    for (const r of records) {
      switch (r.status) {
        case 'Submitted': case 'Draft': stats.pending += 1; break;
        case 'Manager Approved': stats.managerApproved += 1; break;
        case 'HR Approved': stats.hrApproved += 1; break;
        case 'Manager Rejected': case 'HR Rejected': stats.rejected += 1; break;
        case 'Final Approved': stats.finalApproved += 1; break;
        case 'Completed': stats.completed += 1; break;
        case 'Withdrawn': stats.withdrawn += 1; break;
        default: break;
      }
    }
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Verify the requesting user can access a single record (role scoping).
const canAccessRecord = async (req, record) => {
  const role = req.user.role;
  if (role === 'Admin' || role === 'HR') return true;
  if (role === 'Manager') {
    const team = await managerAssignedEmployees(req.user);
    const teamIds = new Set([
      String(req.user.id),
      ...team.map(e => [e.userId && String(e.userId), e.employeeId, e.email].filter(Boolean)).flat(),
    ]);
    return teamIds.has(String(record.userId)) || teamIds.has(record.employeeId) || teamIds.has(record.email);
  }
  // Employee
  return String(record.userId) === String(req.user.id)
    || record.employeeId === req.user.employeeId
    || record.email === req.user.email;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resignations/:id
// ─────────────────────────────────────────────────────────────────────────────
const getResignation = async (req, res) => {
  try {
    const record = await Resignation.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Resignation record not found.' });
    if (!(await canAccessRecord(req, record))) {
      return res.status(403).json({ success: false, message: 'You do not have access to this resignation record.' });
    }
    res.json({ success: true, data: resignationResponse(record) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resignations/:id/attachment — download the optional attachment
// ─────────────────────────────────────────────────────────────────────────────
const downloadAttachment = async (req, res) => {
  try {
    const record = await Resignation.findById(req.params.id).select('+attachment.data');
    if (!record?.attachment?.data) {
      return res.status(404).json({ success: false, message: 'Attachment not found.' });
    }
    if (!(await canAccessRecord(req, record))) {
      return res.status(403).json({ success: false, message: 'You do not have access to this attachment.' });
    }
    const match = record.attachment.data.match(/^data:[^;]+;base64,(.+)$/);
    if (!match) return res.status(500).json({ success: false, message: 'The stored attachment is invalid.' });
    res.setHeader('Content-Type', record.attachment.mimeType);
    res.setHeader('Content-Length', Buffer.byteLength(match[1], 'base64'));
    res.setHeader('Content-Disposition', `attachment; filename="${record.attachment.name}"`);
    res.send(Buffer.from(match[1], 'base64'));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Validate the resignation form fields shared by create + update.
const validateResignationFields = (body, { requireReason = true } = {}) => {
  const errors = [];
  if (body.submissionDate !== undefined && body.submissionDate !== '' && !validDate(body.submissionDate)) {
    errors.push('Enter a valid submission date.');
  }
  if (requireReason && (typeof body.resignationReason !== 'string' || !body.resignationReason.trim())) {
    errors.push('Provide a resignation reason.');
  }
  if (body.resignationReason !== undefined && typeof body.resignationReason === 'string' && body.resignationReason.length > 200) {
    errors.push('Resignation reason must be no more than 200 characters.');
  }
  if (body.detailedExplanation !== undefined && typeof body.detailedExplanation === 'string' && body.detailedExplanation.length > 5000) {
    errors.push('Detailed explanation must be no more than 5000 characters.');
  }
  if (body.noticePeriod !== undefined && typeof body.noticePeriod === 'string' && body.noticePeriod.length > 100) {
    errors.push('Notice period must be no more than 100 characters.');
  }
  if (body.proposedLastWorkingDay !== undefined && body.proposedLastWorkingDay !== '' && !validDate(body.proposedLastWorkingDay)) {
    errors.push('Enter a valid proposed last working day.');
  }
  if (body.lastWorkingDay !== undefined && body.lastWorkingDay !== '' && !validDate(body.lastWorkingDay)) {
    errors.push('Enter a valid last working day.');
  }
  return errors;
};

// Resolve the reporting manager for an employee profile (by id ref or legacy name match).
const resolveReportingManager = async (employee) => {
  if (employee?.reportingManagerId) {
    const mgr = await User.findById(employee.reportingManagerId).select('name email role').lean();
    if (mgr) return { name: mgr.name, id: mgr._id };
  }
  if (employee?.manager) {
    const mgr = await User.findOne({
      $or: [{ name: employee.manager }, { email: employee.manager }],
    }).select('name email role').lean();
    if (mgr) return { name: mgr.name, id: mgr._id };
  }
  return { name: employee?.manager || '', id: null };
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/resignations — create (submitter auto-fetches their employee details)
// ─────────────────────────────────────────────────────────────────────────────
const createResignation = async (req, res) => {
  let created = null;
  try {
    if (!['Employee', 'HR', 'Manager'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Resignation submission is available to Employee, HR, and Manager accounts only.' });
    }
    const {
      submissionDate, resignationReason, detailedExplanation = '',
      noticePeriod = '', proposedLastWorkingDay = '', attachment,
      submissionKey, saveAsDraft = false,
    } = req.body;

    if (saveAsDraft !== true) {
      const errs = validateResignationFields(req.body, { requireReason: true });
      if (errs.length) return res.status(400).json({ success: false, message: errs.join(' ') });
    }
    if (submissionKey !== undefined && submissionKey !== null && (typeof submissionKey !== 'string' || !submissionKey.trim() || submissionKey.length > 100)) {
      return res.status(400).json({ success: false, message: 'Submission key is invalid.' });
    }

    let attachmentDoc;
    try {
      attachmentDoc = parseAttachment(attachment);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    const identity = await resolveRequestIdentity(req.user.dbUser || req.user);
    if (identity.error) return res.status(409).json({ success: false, message: identity.error });
    const account = identity.account;
    const employee = identity.employee;

    // Prevent duplicate active resignations (one non-withdrawn/non-completed per employee).
    const identityConditions = [
      { userId: account._id },
      ...(employee?.employeeId ? [{ employeeId: employee.employeeId }] : []),
      ...(account.email ? [{ email: account.email }] : []),
    ];
    const existing = await Resignation.findOne({
      $or: identityConditions,
      status: { $nin: ['Withdrawn', 'Completed'] },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `An active resignation already exists for ${employee?.employeeId || account.name} (status: ${existing.status}). Withdraw or complete it before submitting a new one.`,
      });
    }

    const reportingManager = employee ? await resolveReportingManager(employee) : { name: '', id: null };
    const today = new Date().toISOString().slice(0, 10);
    const status = saveAsDraft === true ? 'Draft' : 'Submitted';

    created = await Resignation.create({
      employeeId: employee?.employeeId || account.employeeId || null,
      userId: account._id,
      email: account.email || employee?.email || '',
      employeeName: account.name,
      department: employee?.department || account.department || '',
      designation: employee?.designation || employee?.position || account.designation || '',
      reportingManager: reportingManager.name || account.designation || '',
      reportingManagerId: reportingManager.id || employee?.reportingManagerId || null,
      submittedByRole: account.role,
      employeeRef: employee?._id || account.employeeRef || null,
      submissionDate: submissionDate || today,
      resignationReason: String(resignationReason || '').trim(),
      detailedExplanation: String(detailedExplanation || '').trim(),
      noticePeriod: String(noticePeriod || '').trim(),
      proposedLastWorkingDay: proposedLastWorkingDay || '',
      attachment: attachmentDoc,
      status,
      submissionKey: submissionKey ? submissionKey.trim() : null,
      history: [{
        status,
        action: saveAsDraft === true ? 'Saved as draft' : 'Submitted',
        performedBy: account._id,
        performedByName: account.name,
        performedByRole: account.role,
        performedAt: new Date(),
      }],
    });

    // Notify reporting manager + Admins when actually submitted.
    if (status === 'Submitted') {
      const recipients = new Set();
      if (reportingManager.id) recipients.add(String(reportingManager.id));
      const admins = await User.find({ role: 'Admin', isActive: true }).select('_id').lean();
      admins.forEach(a => recipients.add(String(a._id)));
      const message = `${account.name} submitted a resignation request.`;
      await Promise.all([...recipients].map(uid => createUserNotification(uid, {
        employeeId: created.employeeId || '',
        title: 'New Resignation Submission',
        message,
        type: 'resignation',
        actionUrl: '/resignation',
      })));
    }

    const warning = await logActivity(req, created, saveAsDraft === true ? 'Resignation draft created' : 'Resignation submitted');
    res.status(201).json({ success: true, data: resignationResponse(created), ...(warning ? { warning } : {}) });
  } catch (err) {
    if (err.code === 11000 && req.body.submissionKey) {
      try {
        const existing = await Resignation.findOne({ userId: req.user._id, submissionKey: String(req.body.submissionKey).trim() });
        if (existing) return res.status(200).json({ success: true, data: resignationResponse(existing) });
      } catch (lookupError) {
        console.error('[Resignation] Duplicate submission lookup failed:', lookupError.message);
        return res.status(500).json({ success: false, message: 'Unable to verify the existing resignation submission.' });
      }
      return res.status(409).json({ success: false, message: 'This submission key was already used.' });
    }
    if (created) { try { await created.deleteOne(); } catch { /* best effort */ } }
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/resignations/:id — owner edits (pre-review) OR HR/Admin updates exit fields
// ─────────────────────────────────────────────────────────────────────────────
const updateResignation = async (req, res) => {
  try {
    const record = await Resignation.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Resignation record not found.' });
    const role = req.user.role;

    const isOwner = String(record.userId) === String(req.user.id)
      || record.employeeId === req.user.employeeId
      || record.email === req.user.email;

    const errs = validateResignationFields(req.body, { requireReason: false });
    if (errs.length) return res.status(400).json({ success: false, message: errs.join(' ') });

    let attachmentDoc;
    if (req.body.attachment !== undefined) {
      try {
        attachmentDoc = parseAttachment(req.body.attachment);
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
      }
    }

    const previous = record.toObject();
    const editableStatuses = ['Draft', 'Submitted'];

    // Owner may edit core resignation fields only while not yet reviewed.
    if (isOwner && role !== 'Admin') {
      if (!editableStatuses.includes(record.status)) {
        return res.status(409).json({ success: false, message: 'This resignation is under review and can no longer be edited. Withdraw it if needed.' });
      }
      const { submissionDate, resignationReason, detailedExplanation, noticePeriod, proposedLastWorkingDay } = req.body;
      if (submissionDate !== undefined) record.submissionDate = submissionDate || '';
      if (resignationReason !== undefined) record.resignationReason = String(resignationReason).trim();
      if (detailedExplanation !== undefined) record.detailedExplanation = String(detailedExplanation).trim();
      if (noticePeriod !== undefined) record.noticePeriod = String(noticePeriod).trim();
      if (proposedLastWorkingDay !== undefined) record.proposedLastWorkingDay = proposedLastWorkingDay || '';
      if (attachmentDoc) record.attachment = attachmentDoc;
      pushHistory(record, req, record.status, 'Request updated');
    } else if (role === 'Admin' || role === 'HR') {
      // HR / Admin can update exit-formality fields at any stage.
      const { noticePeriod, lastWorkingDay, exitRemarks } = req.body;
      if (noticePeriod !== undefined) record.noticePeriod = String(noticePeriod).trim();
      if (lastWorkingDay !== undefined) record.lastWorkingDay = lastWorkingDay || '';
      if (exitRemarks !== undefined) record.exitRemarks = String(exitRemarks).trim().slice(0, 2000);
      if (req.body.clearance && typeof req.body.clearance === 'object') {
        const allowed = ['Pending', 'Cleared', 'Not Applicable'];
        for (const key of ['assets', 'accounts', 'documents', 'knowledgeTransfer']) {
          const v = req.body.clearance[key];
          if (v !== undefined && allowed.includes(v)) record.clearance[key] = v;
        }
      }
      if (req.body.exitStatus !== undefined) {
        const allowed = ['Pending', 'In Progress', 'Cleared', 'Completed', 'On Hold'];
        if (allowed.includes(req.body.exitStatus)) record.exitStatus = req.body.exitStatus;
      }
      if (attachmentDoc) record.attachment = attachmentDoc;
      // HR/Admin may also correct core fields before final approval.
      if (editableStatuses.includes(record.status)) {
        const { submissionDate, resignationReason, detailedExplanation, proposedLastWorkingDay } = req.body;
        if (submissionDate !== undefined) record.submissionDate = submissionDate || '';
        if (resignationReason !== undefined) record.resignationReason = String(resignationReason).trim();
        if (detailedExplanation !== undefined) record.detailedExplanation = String(detailedExplanation).trim();
        if (proposedLastWorkingDay !== undefined) record.proposedLastWorkingDay = proposedLastWorkingDay || '';
      }
      pushHistory(record, req, record.status, 'Record updated by ' + role);
    } else {
      return res.status(403).json({ success: false, message: 'You can only edit your own resignation requests.' });
    }

    await record.save();
    const warning = await logActivity(req, record, 'Resignation updated', previous);
    res.json({ success: true, data: resignationResponse(record), ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/resignations/:id/submit — submit a saved draft (owner)
// ─────────────────────────────────────────────────────────────────────────────
const submitResignation = async (req, res) => {
  try {
    const record = await Resignation.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Resignation record not found.' });
    const isOwner = String(record.userId) === String(req.user.id)
      || record.employeeId === req.user.employeeId
      || record.email === req.user.email;
    if (!isOwner && req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'You can only submit your own resignation.' });
    }
    if (record.status !== 'Draft') {
      return res.status(409).json({ success: false, message: 'Only draft resignations can be submitted.' });
    }
    if (!record.resignationReason?.trim()) {
      return res.status(400).json({ success: false, message: 'Provide a resignation reason before submitting.' });
    }
    const previous = record.toObject();
    record.status = 'Submitted';
    pushHistory(record, req, 'Submitted', 'Submitted');
    await record.save();

    // Notify reporting manager + Admins.
    const recipients = new Set();
    if (record.reportingManagerId) recipients.add(String(record.reportingManagerId));
    const admins = await User.find({ role: 'Admin', isActive: true }).select('_id').lean();
    admins.forEach(a => recipients.add(String(a._id)));
    const message = `${record.employeeName} submitted a resignation request.`;
    await Promise.all([...recipients].map(uid => createUserNotification(uid, {
      employeeId: record.employeeId || '',
      title: 'New Resignation Submission',
      message,
      type: 'resignation',
      actionUrl: '/resignation',
    })));

    await createUserNotification(record.userId, {
      employeeId: record.employeeId || '',
      title: 'Resignation submitted',
      message: 'Your resignation has been submitted and is awaiting manager review.',
      type: 'resignation',
      actionUrl: '/employee/resignation',
    });

    const warning = await logActivity(req, record, 'Resignation submitted', previous);
    res.json({ success: true, data: resignationResponse(record), ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/resignations/:id/withdraw — owner withdraws (Draft / Submitted only)
// ─────────────────────────────────────────────────────────────────────────────
const withdrawResignation = async (req, res) => {
  try {
    const record = await Resignation.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Resignation record not found.' });
    const isOwner = String(record.userId) === String(req.user.id)
      || record.employeeId === req.user.employeeId
      || record.email === req.user.email;
    if (!isOwner && req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'You can only withdraw your own resignation.' });
    }
    if (!['Draft', 'Submitted'].includes(record.status)) {
      return res.status(409).json({ success: false, message: 'This resignation is already under review and cannot be withdrawn. Contact HR.' });
    }
    const { reason = '' } = req.body;
    if (typeof reason !== 'string' || reason.length > 1000) {
      return res.status(400).json({ success: false, message: 'Withdraw reason must be text of no more than 1000 characters.' });
    }
    const previous = record.toObject();
    record.status = 'Withdrawn';
    record.withdrawnBy = req.user._id;
    record.withdrawnAt = new Date();
    record.withdrawReason = String(reason).trim();
    pushHistory(record, req, 'Withdrawn', 'Withdrawn', record.withdrawReason);
    await record.save();
    await createUserNotification(record.userId, {
      employeeId: record.employeeId || '',
      title: 'Resignation withdrawn',
      message: 'Your resignation request has been withdrawn.',
      type: 'resignation',
      actionUrl: '/employee/resignation',
    });
    const warning = await logActivity(req, record, 'Resignation withdrawn', previous);
    res.json({ success: true, data: resignationResponse(record), ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/resignations/:id/manager-review — Manager (or Admin) approve/reject
// ─────────────────────────────────────────────────────────────────────────────
const managerReview = async (req, res) => {
  try {
    const role = req.user.role;
    if (!['Manager', 'Admin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Only a Manager or Admin can perform manager review.' });
    }
    const { decision, comment = '' } = req.body;
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be approve or reject.' });
    }
    if (typeof comment !== 'string' || comment.length > 2000) {
      return res.status(400).json({ success: false, message: 'Comments must be text of no more than 2000 characters.' });
    }
    const record = await Resignation.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Resignation record not found.' });

    // Managers can only review their own team members' resignations (Admin: any).
    if (role === 'Manager' && !(await canAccessRecord(req, record))) {
      return res.status(403).json({ success: false, message: 'You can only review resignations submitted by your team members.' });
    }
    if (record.status !== 'Submitted') {
      return res.status(409).json({ success: false, message: `This resignation is ${record.status} and cannot be reviewed by a manager.` });
    }
    if (String(record.userId) === String(req.user.id) && role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'You cannot review your own resignation.' });
    }

    const previous = record.toObject();
    const approved = decision === 'approve';
    record.status = approved ? 'Manager Approved' : 'Manager Rejected';
    record.managerComment = String(comment).trim();
    record.managerReviewedBy = req.user._id;
    record.managerReviewedAt = new Date();
    record.managerReviewerName = req.user.name;
    pushHistory(record, req, record.status, approved ? 'Manager approved' : 'Manager rejected', record.managerComment);
    await record.save();

    await createUserNotification(record.userId, {
      employeeId: record.employeeId || '',
      title: `Resignation ${approved ? 'approved by manager' : 'rejected by manager'}`,
      message: approved
        ? 'Your resignation was approved by your manager and forwarded to HR.'
        : `Your resignation was rejected by your manager.${comment ? ` Comment: ${comment}` : ''}`,
      type: 'resignation',
      actionUrl: '/employee/resignation',
    });

    // Notify HR on approval.
    if (approved) {
      const hrs = await User.find({ role: 'HR', isActive: true }).select('_id').lean();
      await Promise.all(hrs.map(h => createUserNotification(h._id, {
        employeeId: record.employeeId || '',
        title: 'Resignation awaiting HR review',
        message: `${record.employeeName}'s resignation was approved by the manager.`,
        type: 'resignation',
        actionUrl: '/resignation',
      })));
    }
    const warning = await logActivity(req, record, `Resignation ${approved ? 'manager-approved' : 'manager-rejected'}`, previous);
    res.json({ success: true, data: resignationResponse(record), ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/resignations/:id/hr-review — HR (or Admin) approve/reject
// ─────────────────────────────────────────────────────────────────────────────
const hrReview = async (req, res) => {
  try {
    const role = req.user.role;
    if (!['HR', 'Admin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Only HR or Admin can perform HR review.' });
    }
    const { decision, comment = '', lastWorkingDay, noticePeriod } = req.body;
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be approve or reject.' });
    }
    if (typeof comment !== 'string' || comment.length > 2000) {
      return res.status(400).json({ success: false, message: 'Comments must be text of no more than 2000 characters.' });
    }
    if (lastWorkingDay !== undefined && lastWorkingDay !== '' && !validDate(lastWorkingDay)) {
      return res.status(400).json({ success: false, message: 'Enter a valid last working day.' });
    }
    const record = await Resignation.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Resignation record not found.' });
    if (record.status !== 'Manager Approved') {
      return res.status(409).json({ success: false, message: `This resignation is ${record.status} and cannot be reviewed by HR.` });
    }
    if (String(record.userId) === String(req.user.id) && role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'You cannot review your own resignation.' });
    }

    const previous = record.toObject();
    const approved = decision === 'approve';
    record.status = approved ? 'HR Approved' : 'HR Rejected';
    record.hrComment = String(comment).trim();
    record.hrReviewedBy = req.user._id;
    record.hrReviewedAt = new Date();
    record.hrReviewerName = req.user.name;
    if (noticePeriod !== undefined) record.noticePeriod = String(noticePeriod).trim();
    if (lastWorkingDay !== undefined && lastWorkingDay !== '') record.lastWorkingDay = lastWorkingDay;
    pushHistory(record, req, record.status, approved ? 'HR approved' : 'HR rejected', record.hrComment);
    await record.save();

    await createUserNotification(record.userId, {
      employeeId: record.employeeId || '',
      title: `Resignation ${approved ? 'approved by HR' : 'rejected by HR'}`,
      message: approved
        ? 'Your resignation was approved by HR and is awaiting final sign-off.'
        : `Your resignation was rejected by HR.${comment ? ` Comment: ${comment}` : ''}`,
      type: 'resignation',
      actionUrl: '/employee/resignation',
    });
    const warning = await logActivity(req, record, `Resignation ${approved ? 'hr-approved' : 'hr-rejected'}`, previous);
    res.json({ success: true, data: resignationResponse(record), ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/resignations/:id/finalize — Admin/HR final sign-off (HR Approved → Final Approved)
// ─────────────────────────────────────────────────────────────────────────────
const finalizeResignation = async (req, res) => {
  try {
    if (!['Admin', 'HR'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only Admin or HR can finalize a resignation.' });
    }
    const { comment = '' } = req.body;
    if (typeof comment !== 'string' || comment.length > 2000) {
      return res.status(400).json({ success: false, message: 'Comments must be text of no more than 2000 characters.' });
    }
    const record = await Resignation.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Resignation record not found.' });
    if (record.status !== 'HR Approved') {
      return res.status(409).json({ success: false, message: `Only HR-approved resignations can be finalized (current: ${record.status}).` });
    }
    const previous = record.toObject();
    record.status = 'Final Approved';
    record.finalizedBy = req.user._id;
    record.finalizedAt = new Date();
    record.finalizerName = req.user.name;
    pushHistory(record, req, 'Final Approved', 'Final approval', String(comment).trim());
    await record.save();
    await createUserNotification(record.userId, {
      employeeId: record.employeeId || '',
      title: 'Resignation finally approved',
      message: 'Your resignation has received final approval. Exit formalities are in progress.',
      type: 'resignation',
      actionUrl: '/employee/resignation',
    });
    const warning = await logActivity(req, record, 'Resignation finalized', previous);
    res.json({ success: true, data: resignationResponse(record), ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/resignations/:id/complete — Admin/HR mark exit completed
// ─────────────────────────────────────────────────────────────────────────────
const completeResignation = async (req, res) => {
  try {
    if (!['Admin', 'HR'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only Admin or HR can complete a resignation.' });
    }
    const { comment = '' } = req.body;
    if (typeof comment !== 'string' || comment.length > 2000) {
      return res.status(400).json({ success: false, message: 'Comments must be text of no more than 2000 characters.' });
    }
    const record = await Resignation.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Resignation record not found.' });
    if (record.status !== 'Final Approved') {
      return res.status(409).json({ success: false, message: `Only final-approved resignations can be completed (current: ${record.status}).` });
    }
    const previous = record.toObject();
    record.status = 'Completed';
    record.exitStatus = 'Completed';
    record.completedBy = req.user._id;
    record.completedAt = new Date();
    pushHistory(record, req, 'Completed', 'Exit completed', String(comment).trim());
    await record.save();
    await createUserNotification(record.userId, {
      employeeId: record.employeeId || '',
      title: 'Resignation completed',
      message: 'Your exit formalities are complete. We wish you the best.',
      type: 'resignation',
      actionUrl: '/employee/resignation',
    });
    const warning = await logActivity(req, record, 'Resignation completed', previous);
    res.json({ success: true, data: resignationResponse(record), ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/resignations/:id — Admin only
// ─────────────────────────────────────────────────────────────────────────────
const deleteResignation = async (req, res) => {
  try {
    if (req.user.role !== 'Admin') return res.status(403).json({ success: false, message: 'Only Admin can delete resignation records.' });
    const record = await Resignation.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Resignation record not found.' });
    const previous = record.toObject();
    await record.deleteOne();
    const warning = await logActivity(req, previous, 'Resignation deleted', previous);
    res.json({ success: true, data: {}, ...(warning ? { warning } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getResignations,
  getResignationStats,
  getResignation,
  createResignation,
  updateResignation,
  submitResignation,
  withdrawResignation,
  managerReview,
  hrReview,
  finalizeResignation,
  completeResignation,
  deleteResignation,
  downloadAttachment,
};
