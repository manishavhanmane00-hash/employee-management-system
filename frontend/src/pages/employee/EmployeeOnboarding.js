import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, FileText, Info, Save, Send, Sparkles, Trash2 } from 'lucide-react';
import { authAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/shared/Modal';
import toast from 'react-hot-toast';
import './EmployeeOnboarding.css';

const EMPTY_FIELDS = {
  name: '',
  dateOfBirth: '',
  gender: '',
  phone: '',
  personalEmail: '',
  address: '',
  city: '',
  state: '',
  country: 'India',
  emergencyContactName: '',
  emergencyContactRelationship: '',
  emergencyContactPhone: '',
  emergencyContactAddress: '',
  highestQualification: '',
  workExperience: '',
  skills: '',
};
const REQUIRED_FIELDS = [
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
const MAX_FILE_SIZE = 3 * 1024 * 1024;
const MAX_PROFILE_PHOTO_SIZE = 2 * 1024 * 1024;
const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const allowedPhotoTypes = ['image/jpeg', 'image/png', 'image/webp'];

const SectionStatus = ({ complete, submitted, correction, rejected }) => {
  const label = rejected ? 'Rejected' : correction ? 'Correction Required' : complete && submitted ? 'Submitted' : complete ? 'Completed' : 'Pending';
  const color = rejected ? 'var(--danger)' : correction ? 'var(--secondary)' : complete ? 'var(--success)' : 'var(--warning)';
  return <span style={{ fontSize: '0.78rem', fontWeight: 600, color }}>{label}</span>;
};

const EmployeeOnboarding = () => {
  const { user, refreshMe } = useAuth();
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [documents, setDocuments] = useState([]);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [employment, setEmployment] = useState({});
  const [removedDocumentIds, setRemovedDocumentIds] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [welcomeSaving, setWelcomeSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [correctionRequest, setCorrectionRequest] = useState('');
  const [requestingCorrection, setRequestingCorrection] = useState(false);
  const [error, setError] = useState('');
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const loaded = useRef(false);
  const saveTimer = useRef(null);
  const saveQueue = useRef(Promise.resolve());

  const load = useCallback(async () => {
    try {
      const { data } = await authAPI.getOnboarding();
      setFields({ ...EMPTY_FIELDS, name: user?.name || '', ...(data.data.fields || {}) });
      setDocuments(data.data.documents || []);
      setProfilePhoto(data.data.profilePhoto || null);
      setEmployment(data.data.employment || {});
      setStatuses(data.data.statuses || {});
      setWelcomeOpen(data.data.statuses?.registrationStatus === 'approved'
        && data.data.statuses?.onboardingStatus === 'not_started'
        && !data.data.statuses?.welcomeSeenAt);
      setError('');
      loaded.current = true;
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load saved onboarding progress.');
    } finally {
      setLoading(false);
    }
  }, [user?.name]);

  useEffect(() => { load(); }, [load]);

  const saveDraft = useCallback(async (nextFields = fields, nextDocuments = documents, nextProfilePhoto = profilePhoto) => {
    const request = saveQueue.current.catch(() => {}).then(async () => {
      setSaving(true);
      try {
        const { data } = await authAPI.saveOnboarding({
          fields: nextFields,
          documents: nextDocuments.filter(document => document.content),
          removeDocumentIds: removedDocumentIds,
          profilePhoto: nextProfilePhoto,
        });
        setStatuses(data.data.statuses || {});
        setEmployment(data.data.employment || {});
        setError('');
      } catch (requestError) {
        const message = requestError.response?.data?.message || 'Could not save your onboarding draft.';
        setError(message);
        toast.error(message);
        throw requestError;
      } finally {
        setSaving(false);
      }
    });
    saveQueue.current = request;
    return request;
  }, [fields, documents, profilePhoto, removedDocumentIds]);

  useEffect(() => {
    if (!loaded.current || submitting) return undefined;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDraft(fields, documents).catch(() => {});
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [fields, documents, saveDraft, submitting]);

  const setField = (field, value) => {
    setFields(current => ({ ...current, [field]: value }));
    setError('');
  };

  const changeProfilePhoto = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!allowedPhotoTypes.includes(file.type)) {
      toast.error('Upload a JPEG, PNG, or WebP profile photo.');
      return;
    }
    if (file.size > MAX_PROFILE_PHOTO_SIZE) {
      toast.error('Profile photos must be no larger than 2 MB.');
      return;
    }
    try {
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
        reader.readAsDataURL(file);
      });
      setProfilePhoto({ name: file.name, mimeType: file.type, size: file.size, content });
      setError('');
    } catch (readError) {
      toast.error(readError.message);
    }
  };

  const addDocuments = async event => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (documents.filter(document => !document.archivedAt && !removedDocumentIds.includes(document.id)).length + files.length > 5) {
      toast.error('Upload no more than 5 documents.');
      return;
    }
    const converted = [];
    for (const file of files) {
      if (!allowedTypes.includes(file.type)) {
        toast.error(`${file.name}: upload a PDF, JPEG, PNG, or WebP file.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: maximum file size is 3 MB.`);
        continue;
      }
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
        reader.readAsDataURL(file);
      }).catch(readError => {
        toast.error(readError.message);
        return null;
      });
      if (content) converted.push({
        id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        content,
        uploadedAt: new Date().toISOString(),
      });
    }
    if (converted.length) setDocuments(current => [...current, ...converted]);
  };

  const removeDocument = id => {
    const document = documents.find(item => item.id === id);
    if (document && !document.content) setRemovedDocumentIds(current => [...new Set([...current, id])]);
    setDocuments(current => current.filter(item => item.id !== id));
  };
  const personalComplete = ['name', 'dateOfBirth', 'gender', 'personalEmail'].every(field => String(fields[field] || '').trim());
  const contactComplete = ['phone', 'address', 'city', 'state', 'country', 'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactPhone', 'emergencyContactAddress']
    .every(field => String(fields[field] || '').trim());
  const documentsComplete = documents.some(document => !document.archivedAt)
    && !documents.every(document => removedDocumentIds.includes(document.id));
  const submitted = ['submitted', 'correction_required', 'rejected', 'completed'].includes(statuses.onboardingStatus);
  const rejected = statuses.onboardingStatus === 'rejected';
  const correction = statuses.onboardingStatus === 'correction_required' || rejected;
  const approved = statuses.onboardingStatus === 'completed'
    && statuses.personalInfoApprovalStatus === 'approved'
    && statuses.documentVerificationStatus === 'verified';
  const personalEmailValid = /^\S+@\S+\.\S+$/.test(fields.personalEmail);
  const workExperienceValid = fields.workExperience === ''
    || (Number.isFinite(Number(fields.workExperience)) && Number(fields.workExperience) >= 0 && Number(fields.workExperience) <= 80);
  const submit = async () => {
    const missingLabels = REQUIRED_FIELDS
      .filter(field => !String(fields[field] || '').trim())
      .map(field => ({
        name: 'Full Name',
        dateOfBirth: 'Date of Birth',
        gender: 'Gender',
        phone: 'Mobile Number',
        personalEmail: 'Personal Email',
        address: 'Address',
        city: 'City',
        state: 'State / Province',
        country: 'Country',
        emergencyContactName: 'Emergency Contact Name',
        emergencyContactRelationship: 'Emergency Contact Relationship',
        emergencyContactPhone: 'Emergency Contact Phone',
        emergencyContactAddress: 'Emergency Contact Address',
      }[field]));
    if (missingLabels.length) {
      setError(`Complete the required fields: ${missingLabels.join(', ')}.`);
      return;
    }
    if (!personalEmailValid) {
      setError('Enter a valid personal email address.');
      return;
    }
    if (!workExperienceValid) {
      setError('Work experience must be between 0 and 80 years.');
      return;
    }
    if (!documentsComplete) {
      setError('Upload at least one required document before submitting.');
      return;
    }
    setSubmitting(true);
    clearTimeout(saveTimer.current);
    try {
      await saveDraft(fields, documents);
      const { data } = await authAPI.submitOnboarding();
      setStatuses(data.data.statuses || {});
      toast.success(data.message || 'Submitted for Admin approval.');
      await refreshMe();
    } catch (requestError) {
      const message = requestError.response?.data?.message || 'Could not submit onboarding.';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const requestCorrection = async event => {
    event.preventDefault();
    setRequestingCorrection(true);
    try {
      const { data } = await authAPI.requestProfileCorrection({ details: correctionRequest });
      setCorrectionRequest('');
      toast.success(data.message || 'Correction request sent to Admin.');
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'Could not send profile correction request.');
    } finally {
      setRequestingCorrection(false);
    }
  };

  const continueFromWelcome = async () => {
    if (welcomeSaving) return;
    setWelcomeSaving(true);
    try {
      const { data } = await authAPI.markOnboardingWelcomeSeen();
      setStatuses(current => ({ ...current, welcomeSeenAt: data.data.welcomeSeenAt }));
      setWelcomeOpen(false);
      document.getElementById('employee-personal-info')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (requestError) {
      const message = requestError.response?.data?.message || 'Could not save your onboarding progress.';
      setError(message);
      toast.error(message);
    } finally {
      setWelcomeSaving(false);
    }
  };

  const fieldInput = (label, key, type = 'text', required = true) => (
    <div className="form-group" key={key}>
      <label className="form-label">{label}{required && <span className="required"> *</span>}</label>
      <input
        className="form-control"
        type={type}
        required={required}
        value={fields[key] || ''}
        onChange={event => setField(key, event.target.value)}
        disabled={!loaded.current || (submitted && !correction)}
        maxLength={key === 'name' ? 150 : 500}
      />
    </div>
  );

  if (loading) return <div className="card"><div className="card-body">Loading saved onboarding progress…</div></div>;

  return (
    <div>
      <Modal
        open={welcomeOpen}
        onClose={continueFromWelcome}
        title={(
          <span className="employee-welcome-heading">
            <span className="employee-welcome-icon" aria-hidden="true"><Sparkles size={23} /></span>
            <span className="employee-welcome-heading-copy">
              <span className="employee-welcome-eyebrow">EMPLOYEE ONBOARDING</span>
              <span className="employee-welcome-title-text">Welcome to the Employee Management System!</span>
            </span>
          </span>
        )}
        size="md"
        className="employee-welcome-modal"
        overlayClassName="employee-welcome-overlay"
        footer={(
          <button type="button" className="btn employee-welcome-continue" onClick={continueFromWelcome} disabled={welcomeSaving}>
            {welcomeSaving ? 'Opening…' : <>Continue <ArrowRight size={17} /></>}
          </button>
        )}
      >
        <div className="employee-welcome-content">
          <div className="employee-welcome-approved" role="status">
            <span className="employee-welcome-approved-icon"><CheckCircle2 size={21} /></span>
            <strong>Your account has been approved successfully!</strong>
          </div>
          <div className="employee-welcome-message">
            <span className="employee-welcome-info-icon" aria-hidden="true"><Info size={19} /></span>
            <p>
              Before accessing your <strong>dashboard</strong>, please <strong>complete your employee profile information</strong>.
              {' '}This helps the Admin maintain <strong>accurate employee records</strong>.
            </p>
          </div>
          <div className="employee-welcome-next-step">
            <span className="employee-welcome-step-number">01</span>
            <span><strong>Next step</strong><small>Continue to your profile and add your information.</small></span>
          </div>
        </div>
      </Modal>
      <div className="page-header">
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Personal Information & Onboarding</h1>
            <p className="page-subtitle">Complete the required sections and submit your details and documents for Admin verification.</p>
          </div>
          <span className={`badge ${approved ? 'badge-success' : correction ? 'badge-danger' : 'badge-warning'}`}>
            {statuses.onboardingStatus?.replaceAll('_', ' ') || 'Not Started'}
          </span>
        </div>
      </div>

      {error && <div className="alert alert-danger" role="alert"><AlertCircle size={16} /> {error}</div>}
      {statuses.onboardingReviewNote && (
        <div className={`alert ${statuses.onboardingStatus === 'rejected' ? 'alert-danger' : 'alert-info'}`} role="status">
          <strong>{statuses.onboardingStatus === 'rejected' ? 'Profile rejected — corrections required:' : 'Correction requested by Admin:'}</strong> {statuses.onboardingReviewNote}
        </div>
      )}
      {approved && (
        <div className="alert alert-success" role="status">
          <CheckCircle2 size={16} /> Your profile and documents are approved. Full Employee Portal access is enabled.
        </div>
      )}
      {approved && (
        <form className="card" style={{ marginBottom: 16 }} onSubmit={requestCorrection}>
          <div className="card-header"><h3 className="card-title">Request a Profile Correction</h3></div>
          <div className="card-body">
            <label className="form-label" htmlFor="profile-correction-details">Describe the information that needs correction</label>
            <textarea id="profile-correction-details" className="form-control" rows={3} minLength={10} maxLength={2000}
              value={correctionRequest} onChange={event => setCorrectionRequest(event.target.value)}
              placeholder="Explain the information to correct and the accurate value." required />
            <button type="submit" className="btn btn-outline" style={{ marginTop: 10 }}
              disabled={requestingCorrection || correctionRequest.trim().length < 10}>
              {requestingCorrection ? 'Sending…' : 'Send to Admin'}
            </button>
          </div>
        </form>
      )}
      {!approved && statuses.onboardingStatus === 'submitted' && (
        <div className="alert alert-info" role="status">Your information is saved and waiting for Admin approval. You can safely sign out; progress and uploads remain saved.</div>
      )}

      <div id="employee-personal-info" className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 className="card-title">Onboarding progress</h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{saving ? 'Saving draft…' : 'Changes save automatically'}</span>
        </div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <div>Personal Information <SectionStatus complete={personalComplete} submitted={submitted} correction={correction && !rejected} rejected={rejected} /></div>
          <div>Contact & Emergency <SectionStatus complete={contactComplete} submitted={submitted} correction={correction && !rejected} rejected={rejected} /></div>
          <div>Documents <SectionStatus complete={documentsComplete} submitted={submitted} correction={correction && !rejected} rejected={rejected} /></div>
          <div>Admin Approval <SectionStatus complete={approved} submitted={submitted} correction={correction && !rejected} rejected={rejected} /></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h3 className="card-title">Personal Information</h3></div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
          {fieldInput('Full Name', 'name')}
          {fieldInput('Date of Birth', 'dateOfBirth', 'date')}
          <div className="form-group">
            <label className="form-label">Gender <span className="required">*</span></label>
            <select className="form-control" value={fields.gender} onChange={event => setField('gender', event.target.value)} disabled={!loaded.current || (submitted && !correction)} required>
              <option value="">Select</option>
              {['Female', 'Male', 'Non-binary', 'Prefer not to say'].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          {fieldInput('Mobile Number', 'phone', 'tel')}
          {fieldInput('Personal Email', 'personalEmail', 'email')}
          {fields.personalEmail && !personalEmailValid && <div className="form-error">Enter a valid personal email address.</div>}
          <div className="form-group">
            <label className="form-label">Profile Photo</label>
            {profilePhoto?.content && (
              <img
                src={`data:${profilePhoto.mimeType};base64,${profilePhoto.content}`}
                alt="Profile preview"
                style={{ display: 'block', width: 76, height: 76, borderRadius: '50%', objectFit: 'cover', marginBottom: 8 }}
              />
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={changeProfilePhoto} disabled={!loaded.current || (submitted && !correction)} />
            <small style={{ color: 'var(--text-muted)' }}>JPEG, PNG or WebP · max 2 MB</small>
            {profilePhoto && !(submitted && !correction) && (
              <button type="button" className="btn btn-outline btn-sm" style={{ display: 'block', marginTop: 8 }} onClick={() => setProfilePhoto(null)}>
                Remove photo
              </button>
            )}
          </div>
          {fieldInput('Address', 'address')}
          {fieldInput('City', 'city')}
          {fieldInput('State / Province', 'state')}
          {fieldInput('Country', 'country')}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h3 className="card-title">Employment Information</h3></div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
          {[
            ['Employee ID', employment.employeeId || user?.employeeId],
            ['Department', employment.department],
            ['Designation', employment.designation],
            ['Joining Date', employment.joiningDate],
            ['Employment Type', employment.employmentType],
            ['Reporting Manager', employment.reportingManager],
          ].map(([label, value]) => (
            <div className="form-group" key={label}>
              <label className="form-label">{label}</label>
              <input className="form-control" value={value || 'Assigned by Admin'} disabled />
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h3 className="card-title">Emergency Contact Information</h3></div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
          {fieldInput('Emergency Contact Name', 'emergencyContactName')}
          <div className="form-group">
            <label className="form-label">Relationship <span className="required">*</span></label>
            <select className="form-control" value={fields.emergencyContactRelationship} onChange={event => setField('emergencyContactRelationship', event.target.value)} disabled={!loaded.current || (submitted && !correction)} required>
              <option value="">Select relationship</option>
              {['Parent', 'Spouse', 'Child', 'Sibling', 'Relative', 'Friend', 'Other'].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          {fieldInput('Emergency Contact Phone', 'emergencyContactPhone', 'tel')}
          {fieldInput('Emergency Contact Address', 'emergencyContactAddress')}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h3 className="card-title">Additional Information</h3></div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
          {fieldInput('Highest Qualification', 'highestQualification', 'text', false)}
          <div className="form-group">
            <label className="form-label">Work Experience (years)</label>
            <input className="form-control" type="number" min="0" max="80" step="0.5" value={fields.workExperience} onChange={event => setField('workExperience', event.target.value)} disabled={!loaded.current || (submitted && !correction)} />
            {!workExperienceValid && <div className="form-error">Enter a value between 0 and 80 years.</div>}
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Skills</label>
            <textarea className="form-control" rows={3} maxLength={1000} value={fields.skills} onChange={event => setField('skills', event.target.value)} disabled={!loaded.current || (submitted && !correction)} placeholder="List relevant skills, separated by commas" />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3 className="card-title">Required Documents</h3>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>PDF/JPEG/PNG/WebP · max 3 MB each · 5 files total</span>
        </div>
        <div className="card-body">
          <input type="file" accept=".pdf,image/jpeg,image/png,image/webp" multiple onChange={addDocuments} disabled={!loaded.current || (submitted && !correction)} />
          {!documents.length && <p style={{ color: 'var(--text-muted)', marginTop: 12 }}>At least one document is required to submit onboarding.</p>}
          {documents.map(document => (
            <div key={document.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FileText size={16} /><span>{document.name}</span><small>{Math.ceil(document.size / 1024)} KB · {document.archivedAt ? 'Archived' : document.verificationStatus || 'pending'}</small></div>
              {!(submitted && !correction) && !document.archivedAt && <button className="btn btn-outline btn-sm" type="button" onClick={() => removeDocument(document.id)} aria-label={`Remove ${document.name}`}><Trash2 size={14} /></button>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginBottom: 24 }}>
        {(!submitted || correction) && (
          <>
            <button type="button" className="btn btn-outline" disabled={!loaded.current || saving || submitting} onClick={() => saveDraft().then(() => toast.success('Draft saved.')).catch(() => {})}>
              <Save size={15} /> Save Draft
            </button>
            <button type="button" className="btn btn-primary" disabled={!loaded.current || saving || submitting} onClick={submit}>
              <Send size={15} /> {submitting ? 'Submitting…' : 'Submit for Approval'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default EmployeeOnboarding;
