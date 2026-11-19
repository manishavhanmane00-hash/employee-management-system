const crypto = require('crypto');
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const User = require('../models/User');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const { linkEmployeeAccount } = require('../services/employeeIdentity');
const { managerAssignedEmployees } = require('../services/employeeIdentity');
const { resolvePermissionsForRole } = require('./permissionController');
const { publishNotification } = require('../services/notificationEvents');

const REQUIRED_ONBOARDING_FIELDS = [
  'dateOfBirth',
  'gender',
  'phone',
  'address',
  'city',
  'state',
  'country',
  'emergencyContactName',
  'emergencyContactPhone',
];
const ALLOWED_DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_DOCUMENT_SIZE = 3 * 1024 * 1024;
const MAX_TOTAL_DOCUMENT_SIZE = 5 * 1024 * 1024;
const MAX_DOCUMENTS = 5;
const documentMatchesMimeType = (buffer, mimeType) => {
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
  if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF'
    && buffer.subarray(8, 12).toString() === 'WEBP';
  return false;
};
const validateOnboardingFields = fields => {
  const missing = REQUIRED_ONBOARDING_FIELDS.filter(field => !String(fields[field] || '').trim());
  const errors = [];
  const dateOfBirth = String(fields.dateOfBirth || '');
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ? new Date(`${dateOfBirth}T00:00:00Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateOfBirth || parsedDate > new Date()) {
    errors.push('Date of Birth must be a valid date that is not in the future.');
  }
  if (!['Female', 'Male', 'Non-binary', 'Prefer not to say'].includes(String(fields.gender || ''))) {
    errors.push('Select a valid gender option.');
  }
  for (const field of ['phone', 'emergencyContactPhone']) {
    const value = String(fields[field] || '').trim();
    if (value && !/^[+()\d\s-]{7,24}$/.test(value)) errors.push(`${field} must be a valid phone number.`);
  }
  return { missing, errors };
};

const onboardingResponse = user => ({
  fields: user.onboardingDraft?.fields || {},
  documents: (user.onboardingDraft?.documents || []).map(document => ({
    id: document.id,
    name: document.name,
    mimeType: document.mimeType,
    size: document.size,
    uploadedAt: document.uploadedAt,
    archivedAt: document.archivedAt || null,
    verificationStatus: document.verificationStatus || 'pending',
    reviewNote: document.reviewNote || '',
  })),
  statuses: {
    registrationStatus: user.registrationStatus,
    accountStatus: user.accountStatus,
    onboardingStatus: user.onboardingStatus,
    personalInfoApprovalStatus: user.personalInfoApprovalStatus,
    documentVerificationStatus: user.documentVerificationStatus,
    welcomeSeenAt: user.onboardingWelcomeSeenAt || null,
    reviewNote: user.onboardingReviewNote,
  },
});

const notifyOnboarding = async (user, { title, message, actionUrl }) => {
  const admins = await User.find({ role: 'Admin', isActive: true }).select('_id').lean();
  if (!admins.length) throw new Error('No active Admin is available to review onboarding.');
  const notifications = await Notification.insertMany(admins.map(admin => ({
    userId: admin._id,
    employeeId: user.employeeId || user.registrationEmployeeId,
    title,
    message,
    type: 'onboarding',
    requestStatus: 'Pending',
    actionUrl,
  })));
  notifications.forEach(notification => publishNotification(notification.userId, notification.toObject()));
};

const isTransactionUnavailableError = error => !!error && (
  error.code === 20
  || /transaction numbers are only allowed|replica set member|mongos/i.test(error.message || '')
);

const withTransactionFallback = async (transactionalOperation, fallbackOperation) => {
  let session;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await transactionalOperation(session);
    });
    return true;
  } catch (error) {
    if (!isTransactionUnavailableError(error)) throw error;
    await fallbackOperation();
    return false;
  } finally {
    if (session) await session.endSession();
  }
};

const getMyOnboarding = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('+onboardingDraft');
    if (!user || user.role !== 'Employee') {
      return res.status(403).json({ success: false, message: 'Employee onboarding is not available for this account.' });
    }
    res.json({ success: true, data: onboardingResponse(user) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const markOnboardingWelcomeSeen = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'Employee') {
      return res.status(403).json({ success: false, message: 'Employee onboarding is not available for this account.' });
    }
    if (user.registrationStatus !== 'approved' || user.accountStatus !== 'active') {
      return res.status(403).json({ success: false, message: 'Registration approval is required before onboarding.' });
    }
    if (!user.onboardingWelcomeSeenAt) {
      user.onboardingWelcomeSeenAt = new Date();
      await user.save();
    }
    res.json({ success: true, data: { welcomeSeenAt: user.onboardingWelcomeSeenAt } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not save your onboarding welcome status.' });
  }
};

const saveMyOnboarding = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('+onboardingDraft');
    if (!user || user.role !== 'Employee') {
      return res.status(403).json({ success: false, message: 'Employee onboarding is not available for this account.' });
    }
    if (user.registrationStatus !== 'approved' || user.accountStatus !== 'active') {
      return res.status(403).json({ success: false, message: 'Registration approval is required before onboarding.' });
    }
    if (['submitted', 'completed'].includes(user.onboardingStatus)) {
      return res.status(409).json({ success: false, message: user.onboardingStatus === 'submitted'
        ? 'Your onboarding is awaiting Admin review and cannot be changed until corrections are requested.'
        : 'Your profile is approved. Use Request a Profile Correction to ask Admin to update it.' });
    }
    const incomingFields = req.body.fields;
    if (!incomingFields || typeof incomingFields !== 'object' || Array.isArray(incomingFields)) {
      return res.status(400).json({ success: false, message: 'Onboarding fields must be an object.' });
    }
    const fields = {};
    for (const field of REQUIRED_ONBOARDING_FIELDS) {
      const value = String(incomingFields[field] || '').trim();
      if (value.length > 500) return res.status(400).json({ success: false, message: `${field} cannot exceed 500 characters.` });
      fields[field] = value;
    }
    const oldDraft = user.onboardingDraft || {};
    const previousOnboardingStatus = user.onboardingStatus;
    const oldDocuments = oldDraft.documents || [];
    let documents = oldDocuments;
    const removeDocumentIds = req.body.removeDocumentIds === undefined ? [] : req.body.removeDocumentIds;
    if (!Array.isArray(removeDocumentIds) || removeDocumentIds.some(id => typeof id !== 'string')) {
      return res.status(400).json({ success: false, message: 'Document removal list is invalid.' });
    }
    if (removeDocumentIds.length) {
      documents = oldDocuments.map(document => {
        const saved = document.toObject ? document.toObject() : { ...document };
        if (removeDocumentIds.includes(saved.id) && !saved.archivedAt) saved.archivedAt = new Date();
        return saved;
      });
    }
    if (req.body.documents !== undefined) {
      if (!Array.isArray(req.body.documents) || req.body.documents.length > MAX_DOCUMENTS) {
        return res.status(400).json({ success: false, message: `Upload no more than ${MAX_DOCUMENTS} documents.` });
      }
      let totalSize = 0;
      documents = oldDocuments.map(document => {
        const saved = document.toObject ? document.toObject() : { ...document };
        if (removeDocumentIds.includes(saved.id) && !saved.archivedAt) saved.archivedAt = new Date();
        return saved;
      });
      for (const item of req.body.documents) {
        const content = String(item.content || '');
        const mimeType = String(item.mimeType || '').toLowerCase();
        const name = String(item.name || '').replace(/[\\/\r\n]/g, '_').trim().slice(0, 120);
        if (!name || !ALLOWED_DOCUMENT_TYPES.has(mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
          return res.status(400).json({ success: false, message: 'Documents must be PDF, JPEG, PNG, or WebP files.' });
        }
        const fileBuffer = Buffer.from(content, 'base64');
        const size = fileBuffer.length;
        if (!size || size > MAX_DOCUMENT_SIZE) {
          return res.status(400).json({ success: false, message: `${name} must be no larger than 3 MB.` });
        }
        if (!documentMatchesMimeType(fileBuffer, mimeType)) {
          return res.status(400).json({ success: false, message: `${name} does not match its declared file type.` });
        }
        const existingDocument = oldDocuments.find(document => document.id === String(item.id || ''));
        if (existingDocument && existingDocument.content === content) continue;
        totalSize += size;
        if (totalSize > MAX_TOTAL_DOCUMENT_SIZE) {
          return res.status(400).json({ success: false, message: 'The total document upload size cannot exceed 5 MB.' });
        }
        documents.push({
          id: existingDocument ? crypto.randomUUID() : String(item.id || crypto.randomUUID()),
          name,
          mimeType,
          size,
          content,
          uploadedAt: new Date(),
          verificationStatus: 'pending',
          reviewNote: '',
        });
      }
      if (documents.filter(document => !document.archivedAt).length > MAX_DOCUMENTS) {
        return res.status(400).json({ success: false, message: `Keep no more than ${MAX_DOCUMENTS} uploaded documents on file.` });
      }
    }

    const newDocuments = documents.filter(document => !oldDocuments.some(previous => previous.id === document.id));
    user.onboardingDraft = { fields, documents, savedAt: new Date() };
    if (user.onboardingStatus === 'not_started') user.onboardingStatus = 'in_progress';
    await user.save();
    if (newDocuments.length) {
      try {
        await notifyOnboarding(user, {
          title: 'New document uploaded',
          message: `${user.name} uploaded ${newDocuments.map(document => document.name).join(', ')} on ${new Date().toLocaleString('en-IN')}.`,
          actionUrl: '/registrations?tab=onboarding',
        });
      } catch (notificationError) {
        user.onboardingDraft = oldDraft;
        user.onboardingStatus = previousOnboardingStatus;
        await user.save();
        throw notificationError;
      }
    }
    res.json({ success: true, data: onboardingResponse(user), message: 'Onboarding draft saved.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitMyOnboarding = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('+onboardingDraft');
    if (!user || user.role !== 'Employee') {
      return res.status(403).json({ success: false, message: 'Employee onboarding is not available for this account.' });
    }
    if (user.registrationStatus !== 'approved' || user.accountStatus !== 'active') {
      return res.status(403).json({ success: false, message: 'Registration approval is required before onboarding.' });
    }
    if (['submitted', 'completed'].includes(user.onboardingStatus)) {
      return res.status(409).json({ success: false, message: user.onboardingStatus === 'submitted'
        ? 'Your onboarding is already awaiting Admin review.'
        : 'Your profile has already been approved.' });
    }
    const fields = user.onboardingDraft?.fields || {};
    const validation = validateOnboardingFields(fields);
    if (validation.missing.length || validation.errors.length) {
      return res.status(400).json({
        success: false,
        message: validation.errors[0] || 'Complete all required personal and contact fields before submitting.',
        fields: validation.missing,
      });
    }
    if (!(user.onboardingDraft?.documents || []).some(document => !document.archivedAt)) {
      return res.status(400).json({ success: false, message: 'Upload at least one required document before submitting.' });
    }
    const wasCorrection = user.onboardingStatus === 'correction_required'
      || user.personalInfoApprovalStatus === 'correction_required'
      || user.documentVerificationStatus === 'correction_required';
    const previous = {
      onboardingStatus: user.onboardingStatus,
      personalInfoApprovalStatus: user.personalInfoApprovalStatus,
      documentVerificationStatus: user.documentVerificationStatus,
      onboardingSubmittedAt: user.onboardingSubmittedAt,
      onboardingReviewNote: user.onboardingReviewNote,
      onboardingDraft: {
        ...user.onboardingDraft,
        documents: (user.onboardingDraft?.documents || []).map(document => ({ ...document })),
      },
    };
    user.onboardingStatus = 'submitted';
    user.personalInfoApprovalStatus = 'pending';
    user.documentVerificationStatus = 'pending';
    user.onboardingSubmittedAt = new Date();
    user.onboardingReviewNote = '';
    user.onboardingDraft.documents = user.onboardingDraft.documents.map(document => document.archivedAt
      ? document
      : { ...document, verificationStatus: 'pending', reviewNote: '' });
    user.markModified('onboardingDraft');
    await user.save();
    try {
      await notifyOnboarding(user, {
        title: wasCorrection ? 'Personal information resubmitted' : 'Final profile approval pending',
        message: `${user.name} (${user.employeeId || user.registrationEmployeeId || 'Employee ID pending'}) ${wasCorrection ? 'resubmitted' : 'submitted'} personal information and documents for verification on ${user.onboardingSubmittedAt.toLocaleString('en-IN')}.`,
        actionUrl: '/registrations?tab=onboarding',
      });
      const employeeNotification = await Notification.create({
        userId: user._id,
        employeeId: user.employeeId || user.registrationEmployeeId,
        title: wasCorrection ? 'Personal information resubmitted' : 'Personal information submitted',
        message: `Your personal information and documents were ${wasCorrection ? 'resubmitted' : 'submitted'} on ${user.onboardingSubmittedAt.toLocaleString('en-IN')} and are awaiting Admin review.`,
        type: 'onboarding',
        requestStatus: 'Pending',
        actionUrl: '/employee/onboarding',
      });
      publishNotification(user._id, employeeNotification.toObject());
    } catch (notificationError) {
      Object.assign(user, previous);
      user.markModified('onboardingDraft');
      await user.save();
      throw notificationError;
    }
    res.json({ success: true, data: onboardingResponse(user), message: 'Personal information and documents submitted for Admin approval.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const requestProfileCorrection = async (req, res) => {
  try {
    const details = String(req.body.details || '').trim();
    if (req.user.role !== 'Employee') {
      return res.status(403).json({ success: false, message: 'Only Employees can request a profile correction.' });
    }
    if (req.user.onboardingStatus !== 'completed'
      || req.user.personalInfoApprovalStatus !== 'approved'
      || req.user.documentVerificationStatus !== 'verified') {
      return res.status(403).json({ success: false, message: 'Complete the two approval stages before requesting a post-approval profile correction.' });
    }
    if (details.length < 10 || details.length > 2000) {
      return res.status(400).json({ success: false, message: 'Describe the requested profile correction in 10 to 2000 characters.' });
    }
    const admins = await User.find({ role: 'Admin', isActive: true }).select('_id').lean();
    if (!admins.length) {
      return res.status(503).json({ success: false, message: 'No active Admin is available to receive the correction request.' });
    }
    const createdAt = new Date();
    const notifications = await Notification.insertMany([
      ...admins.map(admin => ({
        userId: admin._id,
        employeeId: req.user.employeeId || '',
        title: 'Employee requested profile correction',
        message: `${req.user.name} (${req.user.employeeId || 'Employee ID unavailable'}) requested a profile correction on ${createdAt.toLocaleString('en-IN')}: ${details}`,
        type: 'profile_correction',
        requestStatus: 'Pending',
        actionUrl: '/notifications',
      })),
      {
        userId: req.user._id,
        employeeId: req.user.employeeId || '',
        title: 'Profile correction request submitted',
        message: `Your request was submitted on ${createdAt.toLocaleString('en-IN')} and sent to Admin for review.`,
        type: 'profile_correction',
        requestStatus: 'Pending',
        actionUrl: '/employee/profile',
      },
    ]);
    notifications.forEach(notification => publishNotification(notification.userId, notification.toObject()));
    res.status(201).json({ success: true, message: 'Profile correction request sent to Admin.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const listRegistrationReviews = async (req, res) => {
  try {
    const registrations = await User.find({ role: 'Employee', registrationStatus: 'pending' })
      .select('name email registrationEmployeeId registrationIdentityStatus registrationSubmittedAt registrationEmployeeRef')
      .sort({ registrationSubmittedAt: 1 }).limit(200).lean();
    const employees = await Employee.find({ isDraft: { $ne: true }, status: 'active' })
      .select('_id name employeeId email department designation userId').sort({ name: 1 }).lean();
    const onboardings = await User.find({
      role: 'Employee',
      registrationStatus: 'approved',
      onboardingStatus: 'submitted',
    }).select('+onboardingDraft name email employeeId registrationEmployeeId onboardingStatus personalInfoApprovalStatus documentVerificationStatus onboardingSubmittedAt onboardingReviewNote')
      .sort({ onboardingSubmittedAt: 1 }).limit(200).lean();
    res.json({
      success: true,
      registrations: registrations.map(user => ({
        ...user,
        candidateEmployees: employees.filter(employee =>
          (user.registrationEmployeeId && employee.employeeId?.toLowerCase() === user.registrationEmployeeId.toLowerCase())
          || employee.email?.toLowerCase() === user.email.toLowerCase()
        ),
      })),
      employees,
      onboardings: onboardings.map(user => ({
        ...user,
        onboardingDraft: {
          fields: user.onboardingDraft?.fields || {},
          documents: (user.onboardingDraft?.documents || []).map(({ id, name, mimeType, size, uploadedAt, archivedAt, verificationStatus, reviewNote }) => ({
            id, name, mimeType, size, uploadedAt, archivedAt, verificationStatus, reviewNote,
          })),
        },
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findEmployeeForRegistrationApproval = async (submittedEmployeeId, session = null) => {
  const selectedEmployeeId = String(submittedEmployeeId || '').trim();
  if (!selectedEmployeeId || selectedEmployeeId === 'undefined') return null;

  const directMatch = await Employee.findOne({
    isDraft: { $ne: true },
    status: 'active',
    employeeId: { $regex: `^${escapeRegExp(selectedEmployeeId)}$`, $options: 'i' },
  }).session(session);
  if (directMatch) return directMatch;

  const emailMatch = await Employee.findOne({
    isDraft: { $ne: true },
    status: 'active',
    email: { $regex: `^${escapeRegExp(selectedEmployeeId)}$`, $options: 'i' },
  }).session(session);
  if (emailMatch) return emailMatch;

  if (mongoose.Types.ObjectId.isValid(selectedEmployeeId)) {
    const byId = await Employee.findOne({
      _id: selectedEmployeeId,
      isDraft: { $ne: true },
      status: 'active',
    }).session(session);
    if (byId) return byId;
  }

  return null;
};

const reviewRegistration = async (req, res) => {
  const notifications = [];
  let responseUser;
  let alreadyReviewed = false;
  try {
    const { decision, employeeId, note = '' } = req.body || {};
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be approve or reject.' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid registration request.' });
    }
    if (typeof note !== 'string' || note.length > 1000 || (decision === 'reject' && !note.trim())) {
      return res.status(400).json({ success: false, message: decision === 'reject'
        ? 'A rejection reason is required and must be no more than 1000 characters.'
        : 'The review note must be no more than 1000 characters.' });
    }
    if (employeeId !== undefined && (typeof employeeId !== 'string' || employeeId.length > 64)) {
      return res.status(400).json({ success: false, message: 'Employee ID is invalid.' });
    }

    const normalizedNote = note.trim();
    const applyReview = async (session) => {
      notifications.length = 0;
      responseUser = null;
      alreadyReviewed = false;
      const user = await User.findOne({
        _id: req.params.id, role: 'Employee', registrationStatus: 'pending',
      }).session(session);
      if (!user) {
        const existing = await User.findOne({ _id: req.params.id, role: 'Employee' }).session(session);
        const matchingStatus = decision === 'approve' ? 'approved' : 'rejected';
        if (existing?.registrationStatus === matchingStatus) {
          responseUser = existing;
          alreadyReviewed = true;
          return;
        }
        const error = new Error(existing ? 'This registration has already been reviewed.' : 'Pending registration not found.');
        error.statusCode = existing ? 409 : 404;
        throw error;
      }

      let employee = null;
      if (decision === 'approve') {
        const selectedEmployeeId = String(employeeId || user.registrationEmployeeId || '').trim();
        if (!selectedEmployeeId || selectedEmployeeId === 'undefined') {
          const error = new Error('Select and verify the existing Employee record before approving this registration.');
          error.statusCode = 400;
          throw error;
        }
        employee = await findEmployeeForRegistrationApproval(selectedEmployeeId, session);
        if (!employee) {
          const error = new Error('The selected active Employee record could not be found.');
          error.statusCode = 404;
          throw error;
        }
        const existingAccount = await User.findOne({
          _id: { $ne: user._id },
          $or: [{ employeeRef: employee._id }, { employeeId: employee.employeeId }],
        }).select('_id').session(session).lean();
        if ((employee.userId && String(employee.userId) !== String(user._id)) || existingAccount) {
          const error = new Error('The selected Employee record is already linked to another account.');
          error.statusCode = 409;
          throw error;
        }
        await linkEmployeeAccount(employee, user, false, ['Employee'], { session });
        user.registrationStatus = 'approved';
        user.registrationIdentityStatus = 'matched';
        user.registrationEmployeeRef = employee._id;
        user.registrationEmployeeId = employee.employeeId;
        user.isActive = true;
        user.accountStatus = 'active';
        user.onboardingStatus = 'not_started';
        user.personalInfoApprovalStatus = 'not_submitted';
        user.documentVerificationStatus = 'not_submitted';
      } else {
        user.registrationStatus = 'rejected';
        user.accountStatus = 'suspended';
        user.isActive = false;
        const linkedEmployee = await Employee.findOne({ userId: user._id, isDraft: { $ne: true } }).session(session);
        if (linkedEmployee) {
          linkedEmployee.userId = null;
          await linkedEmployee.save({ session });
        }
        user.employeeRef = null;
        user.employeeId = undefined;
      }

      const reviewedAt = new Date();
      user.registrationReviewedAt = reviewedAt;
      user.registrationReviewedBy = req.user._id;
      user.registrationReviewNote = normalizedNote;
      user.registrationReviewHistory.push({
        decision, reviewedAt, reviewedBy: req.user._id,
        reviewedByName: req.user.name || '', note: normalizedNote,
        employeeRef: employee?._id || null, employeeId: employee?.employeeId || '',
      });
      await user.save({ session });

      notifications.push(...await Notification.insertMany([
        {
          userId: user._id,
          employeeId: user.employeeId || user.registrationEmployeeId,
          title: decision === 'approve' ? 'Registration approved' : 'Registration rejected',
          message: decision === 'approve'
            ? 'Your registration was approved. Sign in to complete your personal information and document onboarding.'
            : `Your registration was rejected. Admin reason: ${normalizedNote}`,
          type: 'registration',
          requestStatus: decision === 'approve' ? 'Approved' : 'Rejected',
          actionUrl: '/login',
        },
        ...(decision === 'approve' ? [{
          userId: user._id,
          employeeId: user.employeeId,
          title: 'Personal information pending',
          message: 'Complete your personal information and upload the required documents for the separate Stage 2 Admin approval.',
          type: 'onboarding',
          requestStatus: 'Not Started',
          actionUrl: '/employee/onboarding',
        }] : []),
      ], { session }));

      if (decision === 'approve') {
        const directoryUsers = await User.find({
          role: { $in: ['Admin', 'HR', 'Manager'] }, isActive: true,
        }).select('_id').session(session).lean();
        notifications.push(...await Notification.insertMany(directoryUsers.map(recipient => ({
          userId: recipient._id,
          employeeId: user.employeeId,
          title: 'Employee directory updated',
          message: `${user.name} (${user.employeeId}) was approved and is now available in role-appropriate employee selectors.`,
          type: 'directory',
          requestStatus: 'Active',
          actionUrl: '/employees/list',
        })), { session }));
      }

      await ActivityLog.create([{
        userId: req.user._id,
        userName: req.user.name || 'Admin',
        userRole: req.user.role,
        employeeId: employee?.employeeId || '',
        module: 'registration',
        action: `registration_${decision}`,
        recordId: String(user._id),
        previousValue: { registrationStatus: 'pending' },
        updatedValue: {
          registrationStatus: user.registrationStatus,
          employeeId: employee?.employeeId || '',
          note: normalizedNote,
        },
      }], { session });
      responseUser = user;
    };

    await withTransactionFallback(
      async (session) => { await applyReview(session); },
      async () => { await applyReview(); },
    );

    notifications.forEach(notification => publishNotification(notification.userId, notification.toObject()));
    res.json({
      success: true,
      alreadyReviewed,
      user: { id: responseUser._id, registrationStatus: responseUser.registrationStatus },
      message: decision === 'approve' ? 'Registration approved.' : 'Registration rejected.',
    });
  } catch (error) {
    console.error('[Registration review]', error.message);
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'This account or Employee record is already linked.' });
    if (isTransactionUnavailableError(error)) {
      return res.status(503).json({
        success: false,
        code: 'TRANSACTIONS_UNAVAILABLE',
        message: 'Registration review requires MongoDB running as a replica set or mongos. No changes were committed.',
      });
    }
    res.status(500).json({ success: false, message: 'Registration review failed. No partial approval was committed.' });
  }
};

const reviewOnboarding = async (req, res) => {
  const notifications = [];
  let responseUser;
  let alreadyReviewed = false;
  try {
    const { decision, note = '' } = req.body || {};
    if (!['approve', 'correction'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be approve or correction.' });
    }
    if (typeof note !== 'string' || note.length > 1000 || (decision === 'correction' && !note.trim())) {
      return res.status(400).json({ success: false, message: decision === 'correction'
        ? 'Provide a correction reason of no more than 1000 characters.'
        : 'The review note must be no more than 1000 characters.' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid Employee account ID.' });
    }

    const normalizedNote = note.trim();
    const applyReview = async (session) => {
      notifications.length = 0;
      responseUser = null;
      alreadyReviewed = false;
      const user = await User.findOne({
        _id: req.params.id,
        role: 'Employee',
        registrationStatus: 'approved',
        onboardingStatus: 'submitted',
      }).select('+onboardingDraft').session(session);
      if (!user) {
        const existing = await User.findOne({ _id: req.params.id, role: 'Employee' }).session(session);
        const lastReview = existing?.onboardingReviewHistory?.[existing.onboardingReviewHistory.length - 1];
        const alreadyApproved = decision === 'approve'
          && existing?.onboardingStatus === 'completed'
          && existing?.personalInfoApprovalStatus === 'approved'
          && existing?.documentVerificationStatus === 'verified';
        const alreadyCorrected = decision === 'correction'
          && existing?.onboardingStatus === 'correction_required'
          && lastReview?.decision === 'correction';
        if (alreadyApproved || alreadyCorrected) {
          responseUser = existing;
          alreadyReviewed = true;
          return;
        }
        const error = new Error(existing ? 'This onboarding submission has already been reviewed.' : 'Onboarding submission not found.');
        error.statusCode = existing ? 409 : 404;
        throw error;
      }

      const fields = user.onboardingDraft?.fields || {};
      const documents = user.onboardingDraft?.documents || [];
      const activeDocuments = documents.filter(document => !document.archivedAt);
      let employee = null;
      if (decision === 'approve') {
        const validation = validateOnboardingFields(fields);
        if (validation.missing.length || validation.errors.length || !activeDocuments.length) {
          const error = new Error(validation.errors[0]
            || (!activeDocuments.length ? 'At least one active document is required for approval.' : 'The submission is incomplete and cannot be approved.'));
          error.statusCode = 400;
          error.fields = validation.missing;
          throw error;
        }
        employee = await Employee.findOne({ userId: user._id, isDraft: { $ne: true } }).session(session);
        if (!employee) {
          const error = new Error('The Employee account is not linked to an Employee profile.');
          error.statusCode = 409;
          throw error;
        }
        employee.dob = fields.dateOfBirth;
        employee.gender = fields.gender;
        employee.phone = fields.phone;
        employee.address = fields.address;
        employee.city = fields.city;
        employee.state = fields.state;
        employee.country = fields.country;
        employee.emergencyContactName = fields.emergencyContactName;
        employee.emergencyContactPhone = fields.emergencyContactPhone;
        await employee.save({ session });
        user.phone = fields.phone;
        user.address = fields.address;
        user.city = fields.city;
        user.state = fields.state;
        user.country = fields.country;
        user.onboardingStatus = 'completed';
        user.personalInfoApprovalStatus = 'approved';
        user.documentVerificationStatus = 'verified';
        user.onboardingDraft.documents = documents.map(document => document.archivedAt
          ? document
          : { ...document, verificationStatus: 'verified', reviewNote: '' });
        user.onboardingReviewNote = '';
        user.accountStatus = 'active';
        user.isActive = true;
      } else {
        user.onboardingStatus = 'correction_required';
        user.personalInfoApprovalStatus = 'correction_required';
        user.documentVerificationStatus = 'correction_required';
        user.onboardingReviewNote = normalizedNote;
        user.onboardingDraft.documents = documents.map(document => document.archivedAt
          ? document
          : { ...document, verificationStatus: 'correction_required', reviewNote: user.onboardingReviewNote });
      }

      const reviewedAt = new Date();
      user.markModified('onboardingDraft');
      user.onboardingReviewedAt = reviewedAt;
      user.onboardingReviewedBy = req.user._id;
      user.onboardingReviewHistory.push({
        decision,
        reviewedAt,
        reviewedBy: req.user._id,
        reviewedByName: req.user.name || '',
        note: normalizedNote,
        onboardingStatus: user.onboardingStatus,
        personalInfoApprovalStatus: user.personalInfoApprovalStatus,
        documentVerificationStatus: user.documentVerificationStatus,
      });
      await user.save({ session });

      const notificationRows = decision === 'approve'
        ? [
          { title: 'Profile successfully approved', message: 'Your personal information and documents were approved.', type: 'onboarding', requestStatus: 'Approved', actionUrl: '/employee/dashboard' },
          { title: 'Employee account fully activated', message: 'Your Employee Portal account is fully activated with access to your authorized modules.', type: 'account', requestStatus: 'Active', actionUrl: '/employee/dashboard' },
          { title: 'Document verification status', message: 'Your uploaded documents have been verified by Admin.', type: 'onboarding', requestStatus: 'Verified', actionUrl: '/employee/onboarding' },
        ]
        : [
          { title: 'Correction requested by Admin', message: `Please correct and resubmit your profile. Admin note: ${normalizedNote}`, type: 'onboarding', requestStatus: 'Correction Required', actionUrl: '/employee/onboarding' },
          { title: 'Document verification status', message: 'Admin requested corrections to your uploaded documents or personal information.', type: 'onboarding', requestStatus: 'Correction Required', actionUrl: '/employee/onboarding' },
        ];
      notifications.push(...await Notification.insertMany(notificationRows.map(notification => ({
        ...notification,
        userId: user._id,
        employeeId: user.employeeId,
      })), { session }));

      await ActivityLog.create([{
        userId: req.user._id,
        userName: req.user.name || 'Admin',
        userRole: req.user.role,
        employeeId: employee?.employeeId || user.employeeId || '',
        module: 'onboarding',
        action: decision === 'approve' ? 'personal_information_approved' : 'personal_information_correction_requested',
        recordId: String(user._id),
        previousValue: { onboardingStatus: 'submitted', personalInfoApprovalStatus: 'pending', documentVerificationStatus: 'pending' },
        updatedValue: {
          onboardingStatus: user.onboardingStatus,
          personalInfoApprovalStatus: user.personalInfoApprovalStatus,
          documentVerificationStatus: user.documentVerificationStatus,
          note: normalizedNote,
        },
      }], { session });
      responseUser = user;
    };

    await withTransactionFallback(
      async (session) => { await applyReview(session); },
      async () => { await applyReview(); },
    );

    notifications.forEach(notification => publishNotification(notification.userId, notification.toObject()));
    res.json({
      success: true,
      alreadyReviewed,
      user: {
        id: responseUser._id,
        onboardingStatus: responseUser.onboardingStatus,
        personalInfoApprovalStatus: responseUser.personalInfoApprovalStatus,
        documentVerificationStatus: responseUser.documentVerificationStatus,
      },
      message: decision === 'approve' ? 'Onboarding approved.' : 'Correction requested.',
    });
  } catch (error) {
    console.error('[Onboarding review]', error.message);
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message, ...(error.fields ? { fields: error.fields } : {}) });
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'The Employee profile is already linked to another account.' });
    if (isTransactionUnavailableError(error)) {
      return res.status(503).json({ success: false, code: 'TRANSACTIONS_UNAVAILABLE', message: 'Onboarding review requires MongoDB running as a replica set or mongos. No changes were committed.' });
    }
    res.status(500).json({ success: false, message: 'Onboarding review failed. No partial approval was committed.' });
  }
};

const onboardingDocumentAccessError = async (req, user) => {
  const isOwner = String(user._id) === String(req.user._id);
  if (isOwner || req.user.role === 'Admin') return null;
  if (!['HR', 'Manager'].includes(req.user.role)) return 'You do not have permission to access this document.';

  const { permissions } = await resolvePermissionsForRole(req.user.role);
  if (permissions['employees.documents'] !== true) return 'Employee document access is not enabled for your role.';
  if (req.user.role === 'Manager') {
    const team = await managerAssignedEmployees(req.user);
    const targetEmployeeId = String(user.employeeId || '').trim();
    const isAssigned = team.some(employee => {
      const assignedUserId = String(employee.userId || '').trim();
      const assignedEmployeeId = String(employee.employeeId || '').trim();
      return (assignedUserId && assignedUserId === String(user._id))
        || (targetEmployeeId && assignedEmployeeId && assignedEmployeeId === targetEmployeeId);
    });
    if (!isAssigned) return 'You may only access documents for assigned team members.';
  }
  return null;
};

const listEmployeeOnboardingDocuments = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ success: false, message: 'Invalid Employee account ID.' });
    }
    const user = await User.findOne({ _id: req.params.userId, role: 'Employee' }).select('+onboardingDraft');
    if (!user) return res.status(404).json({ success: false, message: 'Employee account not found.' });
    const accessError = await onboardingDocumentAccessError(req, user);
    if (accessError) return res.status(403).json({ success: false, message: accessError });
    const documents = (user.onboardingDraft?.documents || []).map(document => ({
      id: document.id,
      name: document.name,
      mimeType: document.mimeType,
      size: document.size,
      uploadedAt: document.uploadedAt,
      archivedAt: document.archivedAt || null,
      verificationStatus: document.verificationStatus || 'pending',
      reviewNote: document.reviewNote || '',
    }));
    res.json({ success: true, count: documents.length, data: documents });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getOnboardingDocument = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ success: false, message: 'Invalid Employee account ID.' });
    }
    const user = await User.findOne({ _id: req.params.userId, role: 'Employee' }).select('+onboardingDraft');
    const document = user?.onboardingDraft?.documents?.find(item => item.id === req.params.documentId);
    if (!document) return res.status(404).json({ success: false, message: 'Document not found.' });
    if (document.archivedAt && req.user.role !== 'Admin') {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    const accessError = await onboardingDocumentAccessError(req, user);
    if (accessError) return res.status(403).json({ success: false, message: accessError });
    const content = Buffer.from(document.content || '', 'base64');
    if (!documentMatchesMimeType(content, document.mimeType)) {
      return res.status(500).json({ success: false, message: 'The stored document is invalid or damaged.' });
    }
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Type', document.mimeType);
    res.set('Content-Disposition', `attachment; filename="${document.name.replace(/["\r\n]/g, '_')}"`);
    res.set('Content-Length', content.length);
    res.send(content);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMyOnboarding,
  markOnboardingWelcomeSeen,
  saveMyOnboarding,
  submitMyOnboarding,
  requestProfileCorrection,
  listRegistrationReviews,
  reviewRegistration,
  reviewOnboarding,
  listEmployeeOnboardingDocuments,
  getOnboardingDocument,
};
