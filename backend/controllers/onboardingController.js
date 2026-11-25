const crypto = require('crypto');
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const User = require('../models/User');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const { generateUniqueEmployeeId, linkEmployeeAccount } = require('../services/employeeIdentity');
const { managerAssignedEmployees } = require('../services/employeeIdentity');
const { resolvePermissionsForRole } = require('./permissionController');
const { publishNotification } = require('../services/notificationEvents');

const REQUIRED_ONBOARDING_FIELDS = [
  'name',
  'dateOfBirth',
  'gender',
  'phone',
  'personalEmail',
  'address',
  'city',
  'state',
  'country',
  'emergencyContactName',
  'emergencyContactRelationship',
  'emergencyContactPhone',
  'emergencyContactAddress',
];
const ONBOARDING_FIELDS = [
  ...REQUIRED_ONBOARDING_FIELDS,
  'highestQualification',
  'workExperience',
  'skills',
];
const ALLOWED_DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_PROFILE_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DOCUMENT_SIZE = 3 * 1024 * 1024;
const MAX_TOTAL_DOCUMENT_SIZE = 5 * 1024 * 1024;
const MAX_DOCUMENTS = 5;
const MAX_PROFILE_PHOTO_SIZE = 2 * 1024 * 1024;
const ALLOWED_EMERGENCY_RELATIONSHIPS = new Set(['Parent', 'Spouse', 'Child', 'Sibling', 'Relative', 'Friend', 'Other']);
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
  if (String(fields.name || '').trim().length > 150) errors.push('Full Name cannot exceed 150 characters.');
  if (fields.personalEmail && !/^\S+@\S+\.\S+$/.test(String(fields.personalEmail).trim())) {
    errors.push('Enter a valid personal email address.');
  }
  const dateOfBirth = String(fields.dateOfBirth || '');
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ? new Date(`${dateOfBirth}T00:00:00Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateOfBirth || parsedDate > new Date()) {
    errors.push('Date of Birth must be a valid date that is not in the future.');
  }
  if (!['Female', 'Male', 'Non-binary', 'Prefer not to say'].includes(String(fields.gender || ''))) {
    errors.push('Select a valid gender option.');
  }
  if (!ALLOWED_EMERGENCY_RELATIONSHIPS.has(String(fields.emergencyContactRelationship || ''))) {
    errors.push('Select a valid emergency contact relationship.');
  }
  for (const field of ['phone', 'emergencyContactPhone']) {
    const value = String(fields[field] || '').trim();
    if (value && !/^[+()\d\s-]{7,24}$/.test(value)) errors.push(`${field} must be a valid phone number.`);
  }
  if (fields.workExperience !== '' && fields.workExperience !== undefined) {
    const experience = Number(fields.workExperience);
    if (!Number.isFinite(experience) || experience < 0 || experience > 80) {
      errors.push('Work experience must be between 0 and 80 years.');
    }
  }
  if (String(fields.skills || '').length > 1000) errors.push('Skills cannot exceed 1000 characters.');
  return { missing, errors };
};

const employmentInformation = (user, employee) => ({
  employeeId: employee?.employeeId || user.employeeId || '',
  department: employee?.department || user.department || '',
  designation: employee?.designation || user.designation || '',
  joiningDate: employee?.joiningDate || employee?.dateOfJoining || '',
  employmentType: employee?.employmentType || '',
  reportingManager: employee?.manager || '',
});

const onboardingResponse = (user, employee) => ({
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
  employment: employmentInformation(user, employee),
  profilePhoto: user.onboardingDraft?.profilePhoto || null,
});

const findLinkedEmployee = async user => {
  const linkedByReference = user.employeeRef
    ? await Employee.findOne({ _id: user.employeeRef, isDraft: { $ne: true } })
    : null;
  return linkedByReference || Employee.findOne({ userId: user._id, isDraft: { $ne: true } });
};

const findEmployeeForAccount = async (user, session) => {
  const linkedByReference = user.employeeRef
    ? await Employee.findOne({ _id: user.employeeRef, isDraft: { $ne: true } }).session(session)
    : null;
  if (linkedByReference) return linkedByReference;

  const linkedByUser = await Employee.findOne({ userId: user._id, isDraft: { $ne: true } }).session(session);
  if (linkedByUser) return linkedByUser;

  const employeeId = user.employeeId || user.registrationEmployeeId;
  if (employeeId) {
    const linkedById = await Employee.findOne({ employeeId, isDraft: { $ne: true } }).session(session);
    if (linkedById) return linkedById;
  }

  const email = String(user.email || '').trim();
  if (!email) return null;
  const byEmail = await Employee.findOne({
    email: { $regex: `^${escapeRegExp(email)}$`, $options: 'i' },
    isDraft: { $ne: true },
  }).session(session);
  return byEmail;
};

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
    const employee = await findLinkedEmployee(user);
    res.json({ success: true, data: onboardingResponse(user, employee) });
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
    for (const field of ONBOARDING_FIELDS) {
      const value = String(incomingFields[field] || '').trim();
      const maxLength = field === 'name' ? 150 : field === 'skills' ? 1000 : 500;
      if (value.length > maxLength) return res.status(400).json({ success: false, message: `${field} cannot exceed ${maxLength} characters.` });
      fields[field] = value;
    }
    const oldDraft = user.onboardingDraft || {};
    const previousOnboardingStatus = user.onboardingStatus;
    const oldDocuments = oldDraft.documents || [];
    let documents = oldDocuments;
    let profilePhoto = oldDraft.profilePhoto || null;
    if (req.body.profilePhoto !== undefined) {
      const item = req.body.profilePhoto;
      if (item === null) {
        profilePhoto = null;
      } else {
        const content = String(item?.content || '');
        const mimeType = String(item?.mimeType || '').toLowerCase();
        const name = String(item?.name || '').replace(/[\\/\r\n]/g, '_').trim().slice(0, 120);
        if (!name || !ALLOWED_PROFILE_PHOTO_TYPES.has(mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
          return res.status(400).json({ success: false, message: 'Profile photos must be JPEG, PNG, or WebP images.' });
        }
        const fileBuffer = Buffer.from(content, 'base64');
        if (!fileBuffer.length || fileBuffer.length > MAX_PROFILE_PHOTO_SIZE) {
          return res.status(400).json({ success: false, message: 'Profile photos must be no larger than 2 MB.' });
        }
        if (!documentMatchesMimeType(fileBuffer, mimeType)) {
          return res.status(400).json({ success: false, message: 'The profile photo does not match its declared file type.' });
        }
        profilePhoto = { name, mimeType, size: fileBuffer.length, content, uploadedAt: new Date() };
      }
    }
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
    user.onboardingDraft = { fields, documents, profilePhoto, savedAt: new Date() };
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
    const employee = await findLinkedEmployee(user);
    res.json({ success: true, data: onboardingResponse(user, employee), message: 'Onboarding draft saved.' });
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
      || user.onboardingStatus === 'rejected'
      || user.personalInfoApprovalStatus === 'correction_required'
      || user.personalInfoApprovalStatus === 'rejected'
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
    const employee = await findLinkedEmployee(user);
    res.json({ success: true, data: onboardingResponse(user, employee), message: 'Your employee information has been submitted successfully. Your profile is now waiting for Admin verification.' });
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
      .select('name email registrationStatus registrationEmployeeId registrationIdentityStatus registrationSubmittedAt registrationEmployeeRef')
      .sort({ registrationSubmittedAt: 1 }).limit(200).lean();
    const approvedRegistrations = await User.find({ role: 'Employee', registrationStatus: 'approved' })
      .select('name email employeeId registrationStatus registrationSubmittedAt registrationReviewedAt registrationReviewedBy registrationReviewNote')
      .sort({ registrationReviewedAt: -1 }).limit(200).lean();
    const rejectedRegistrations = await User.find({ role: 'Employee', registrationStatus: 'rejected' })
      .select('name email registrationStatus registrationSubmittedAt registrationReviewedAt registrationReviewNote')
      .sort({ registrationReviewedAt: -1 }).limit(200).lean();
    const profileReviews = await User.find({
      role: 'Employee',
      registrationStatus: 'approved',
      onboardingStatus: { $in: ['submitted', 'completed', 'correction_required', 'rejected'] },
    }).select('+onboardingDraft name email employeeId employeeRef registrationEmployeeId registrationEmployeeRef onboardingStatus personalInfoApprovalStatus documentVerificationStatus onboardingSubmittedAt onboardingReviewedAt onboardingReviewNote')
      .sort({ onboardingSubmittedAt: -1 }).limit(600).lean();
    const linkedEmployees = await Employee.find({
      $or: [
        { userId: { $in: profileReviews.map(user => user._id) } },
        { employeeId: { $in: profileReviews.map(user => user.employeeId).filter(Boolean) } },
      ],
      isDraft: { $ne: true },
    }).select('_id userId employeeId department designation joiningDate dateOfJoining employmentType manager').lean();
    const formatProfileReview = user => {
      const employeeRef = user.employeeRef || user.registrationEmployeeRef;
      const employee = linkedEmployees.find(candidate =>
        (employeeRef && String(candidate._id) === String(employeeRef))
        || String(candidate.userId || '') === String(user._id)
        || (user.employeeId && candidate.employeeId === user.employeeId)
      );
      const profilePhoto = user.onboardingDraft?.profilePhoto;
      return {
        ...user,
        employment: employmentInformation(user, employee),
        onboardingDraft: {
          fields: user.onboardingDraft?.fields || {},
          profilePhoto: profilePhoto ? {
            name: profilePhoto.name,
            mimeType: profilePhoto.mimeType,
            size: profilePhoto.size,
            uploadedAt: profilePhoto.uploadedAt,
          } : null,
          documents: (user.onboardingDraft?.documents || []).map(({ id, name, mimeType, size, uploadedAt, archivedAt, verificationStatus, reviewNote }) => ({
            id, name, mimeType, size, uploadedAt, archivedAt, verificationStatus, reviewNote,
          })),
        },
      };
    };
    const formattedProfiles = profileReviews.map(formatProfileReview);
    res.json({
      success: true,
      registrations,
      approvedRegistrations,
      rejectedRegistrations,
      onboardings: formattedProfiles.filter(user => user.onboardingStatus === 'submitted'),
      approvedProfiles: formattedProfiles.filter(user => user.onboardingStatus === 'completed'),
      correctionRequests: formattedProfiles.filter(user => ['correction_required', 'rejected'].includes(user.onboardingStatus)),
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
        const selectedEmployeeId = String(employeeId || (
          user.registrationIdentityStatus === 'matched' ? user.registrationEmployeeId : ''
        ) || '').trim();
        if (selectedEmployeeId && selectedEmployeeId !== 'undefined') {
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
        }
        user.registrationStatus = 'approved';
        user.registrationIdentityStatus = employee ? 'matched' : 'needs_review';
        user.registrationEmployeeRef = employee?._id || null;
        user.registrationEmployeeId = employee?.employeeId || user.registrationEmployeeId || '';
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

      if (decision === 'approve' && employee) {
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
    if (!['approve', 'reject', 'correction'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be approve, reject or correction.' });
    }
    if (typeof note !== 'string' || note.length > 1000 || (decision !== 'approve' && !note.trim())) {
      return res.status(400).json({ success: false, message: decision !== 'approve'
        ? 'Provide a reason of no more than 1000 characters.'
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
        const alreadyRejected = decision === 'reject'
          && existing?.onboardingStatus === 'rejected'
          && lastReview?.decision === 'reject';
        const alreadyCorrected = decision === 'correction'
          && existing?.onboardingStatus === 'correction_required'
          && lastReview?.decision === 'correction';
        if (alreadyApproved || alreadyRejected || alreadyCorrected) {
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
      let linkedDuringReview = false;
      if (decision === 'approve') {
        const validation = validateOnboardingFields(fields);
        if (validation.missing.length || validation.errors.length || !activeDocuments.length) {
          const error = new Error(validation.errors[0]
            || (!activeDocuments.length ? 'At least one active document is required for approval.' : 'The submission is incomplete and cannot be approved.'));
          error.statusCode = 400;
          error.fields = validation.missing;
          throw error;
        }
        employee = await findEmployeeForAccount(user, session);
        if (employee?.userId && String(employee.userId) !== String(user._id)) {
          const error = new Error('The matching Employee record is already linked to another account.');
          error.statusCode = 409;
          throw error;
        }
        const accountEmployee = user.employeeRef && employee
          && String(user.employeeRef) !== String(employee._id)
          ? await Employee.findOne({ _id: user.employeeRef, isDraft: { $ne: true } }).session(session)
          : null;
        if (accountEmployee) {
          const error = new Error('This account is already linked to a different Employee record.');
          error.statusCode = 409;
          throw error;
        }
        if (!employee) {
          const employeeId = user.employeeId || user.registrationEmployeeId || await generateUniqueEmployeeId(session);
          const idOwner = await Employee.findOne({ employeeId, isDraft: { $ne: true } }).session(session);
          if (idOwner) {
            const error = new Error('The Employee ID on this account belongs to a different Employee record.');
            error.statusCode = 409;
            throw error;
          }
          employee = new Employee({
            employeeId,
            name: String(fields.name).trim(),
            email: user.email,
            department: user.department || 'Unassigned',
            designation: user.designation || '',
            joiningDate: new Date().toISOString().slice(0, 10),
            status: 'active',
          });
          await employee.save({ session });
          linkedDuringReview = true;
        }
        if (!employee.employeeId) employee.employeeId = await generateUniqueEmployeeId(session);
        await linkEmployeeAccount(employee, user, false, ['Employee'], { session });
        user.registrationEmployeeRef = employee._id;
        user.registrationEmployeeId = employee.employeeId;
        const [firstName, ...lastName] = String(fields.name).trim().split(/\s+/);
        employee.name = String(fields.name).trim();
        employee.firstName = firstName;
        employee.lastName = lastName.join(' ');
        employee.dob = fields.dateOfBirth;
        employee.gender = fields.gender;
        employee.phone = fields.phone;
        employee.personalEmail = fields.personalEmail;
        employee.address = fields.address;
        employee.city = fields.city;
        employee.state = fields.state;
        employee.country = fields.country;
        employee.emergencyContactName = fields.emergencyContactName;
        employee.emergencyContactRelationship = fields.emergencyContactRelationship;
        employee.emergencyContactPhone = fields.emergencyContactPhone;
        employee.emergencyContactAddress = fields.emergencyContactAddress;
        employee.highestQualification = fields.highestQualification || '';
        employee.workExperienceYears = fields.workExperience === '' ? 0 : Number(fields.workExperience);
        employee.skills = fields.skills || '';
        if (user.onboardingDraft?.profilePhoto?.content) {
          const profilePhoto = user.onboardingDraft.profilePhoto;
          const photoDataUrl = `data:${profilePhoto.mimeType};base64,${profilePhoto.content}`;
          employee.avatar = photoDataUrl;
          user.avatar = photoDataUrl;
        }
        await employee.save({ session });
        user.name = employee.name;
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
        user.onboardingStatus = decision === 'reject' ? 'rejected' : 'correction_required';
        user.personalInfoApprovalStatus = decision === 'reject' ? 'rejected' : 'correction_required';
        user.documentVerificationStatus = decision === 'reject' ? 'rejected' : 'correction_required';
        user.onboardingReviewNote = normalizedNote;
        user.onboardingDraft.documents = documents.map(document => document.archivedAt
          ? document
          : { ...document, verificationStatus: user.documentVerificationStatus, reviewNote: user.onboardingReviewNote });
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
        : decision === 'reject'
          ? [
            { title: 'Profile rejected — corrections required', message: `Your profile was rejected. Please correct and resubmit it. Admin reason: ${normalizedNote}`, type: 'onboarding', requestStatus: 'Rejected', actionUrl: '/employee/onboarding' },
            { title: 'Document verification status', message: `Your profile and documents were rejected. Admin reason: ${normalizedNote}`, type: 'onboarding', requestStatus: 'Rejected', actionUrl: '/employee/onboarding' },
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
      if (decision === 'approve' && linkedDuringReview) {
        const directoryUsers = await User.find({
          role: { $in: ['Admin', 'HR', 'Manager'] }, isActive: true,
        }).select('_id').session(session).lean();
        notifications.push(...await Notification.insertMany(directoryUsers.map(recipient => ({
          userId: recipient._id,
          employeeId: employee.employeeId,
          title: 'Employee directory updated',
          message: `${user.name} (${employee.employeeId}) completed profile verification and is available in role-appropriate employee selectors.`,
          type: 'directory',
          requestStatus: 'Active',
          actionUrl: '/employees/list',
        })), { session }));
      }

      await ActivityLog.create([{
        userId: req.user._id,
        userName: req.user.name || 'Admin',
        userRole: req.user.role,
        employeeId: employee?.employeeId || user.employeeId || '',
        module: 'onboarding',
        action: decision === 'approve'
          ? 'personal_information_approved'
          : decision === 'reject' ? 'personal_information_rejected' : 'personal_information_correction_requested',
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
      message: decision === 'approve'
        ? 'Onboarding approved.'
        : decision === 'reject' ? 'Profile rejected; the Employee may correct and resubmit it.' : 'Correction requested.',
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
    if (!user) return res.status(404).json({ success: false, message: 'Employee account not found.' });
    const isProfilePhoto = req.params.documentId === 'profile-photo';
    const document = isProfilePhoto
      ? user.onboardingDraft?.profilePhoto
      : user.onboardingDraft?.documents?.find(item => item.id === req.params.documentId);
    if (!document) return res.status(404).json({ success: false, message: 'Document not found.' });
    if (!isProfilePhoto && document.archivedAt && req.user.role !== 'Admin') {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    const accessError = await onboardingDocumentAccessError(req, user);
    if (accessError) return res.status(403).json({ success: false, message: accessError });
    const content = Buffer.from(document.content || '', 'base64');
    const allowedMimeTypes = isProfilePhoto ? ALLOWED_PROFILE_PHOTO_TYPES : ALLOWED_DOCUMENT_TYPES;
    if (!allowedMimeTypes.has(document.mimeType) || !documentMatchesMimeType(content, document.mimeType)) {
      return res.status(500).json({ success: false, message: 'The stored file is invalid or damaged.' });
    }
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Type', document.mimeType);
    res.set('Content-Disposition', `${isProfilePhoto ? 'inline' : 'attachment'}; filename="${document.name.replace(/["\r\n]/g, '_')}"`);
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
