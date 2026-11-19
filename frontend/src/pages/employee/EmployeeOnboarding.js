import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, Save, Send, Trash2 } from 'lucide-react';
import { authAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/shared/Modal';
import toast from 'react-hot-toast';

const EMPTY_FIELDS = {
  dateOfBirth: '',
  gender: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  country: 'India',
  emergencyContactName: '',
  emergencyContactPhone: '',
};
const REQUIRED_FIELDS = Object.keys(EMPTY_FIELDS);
const MAX_FILE_SIZE = 3 * 1024 * 1024;
const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const SectionStatus = ({ complete, submitted, correction }) => {
  const label = correction ? 'Correction Required' : complete && submitted ? 'Submitted' : complete ? 'Completed' : 'Pending';
  const color = correction ? 'var(--danger)' : complete ? 'var(--success)' : 'var(--warning)';
  return <span style={{ fontSize: '0.78rem', fontWeight: 600, color }}>{label}</span>;
};

const EmployeeOnboarding = () => {
  const { user, refreshMe } = useAuth();
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [documents, setDocuments] = useState([]);
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
  const [personalInfoPromptOpen, setPersonalInfoPromptOpen] = useState(false);
  const loaded = useRef(false);
  const saveTimer = useRef(null);
  const saveQueue = useRef(Promise.resolve());

  const load = useCallback(async () => {
    try {
      const { data } = await authAPI.getOnboarding();
      setFields({ ...EMPTY_FIELDS, ...(data.data.fields || {}) });
      setDocuments(data.data.documents || []);
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
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveDraft = useCallback(async (nextFields = fields, nextDocuments = documents) => {
    const request = saveQueue.current.catch(() => {}).then(async () => {
      setSaving(true);
      try {
        const { data } = await authAPI.saveOnboarding({
          fields: nextFields,
          documents: nextDocuments.filter(document => document.content),
          removeDocumentIds: removedDocumentIds,
        });
        setStatuses(data.data.statuses || {});
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
  }, [fields, documents, removedDocumentIds]);

  useEffect(() => {
    if (!loaded.current || submitting) return undefined;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDraft(fields, documents).catch(() => {});
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [fields, documents, saveDraft, submitting]);

  const setField = (field, value) => setFields(current => ({ ...current, [field]: value }));

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
  const personalComplete = ['dateOfBirth', 'gender'].every(field => String(fields[field] || '').trim());
  const contactComplete = ['phone', 'address', 'city', 'state', 'country', 'emergencyContactName', 'emergencyContactPhone']
    .every(field => String(fields[field] || '').trim());
  const documentsComplete = documents.some(document => !document.archivedAt)
    && !documents.every(document => removedDocumentIds.includes(document.id));
  const submitted = ['submitted', 'correction_required', 'completed'].includes(statuses.onboardingStatus);
  const correction = statuses.onboardingStatus === 'correction_required';
  const approved = statuses.onboardingStatus === 'completed'
    && statuses.personalInfoApprovalStatus === 'approved'
    && statuses.documentVerificationStatus === 'verified';
  const canSubmit = REQUIRED_FIELDS.every(field => String(fields[field] || '').trim()) && documentsComplete;

  const submit = async () => {
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
      setPersonalInfoPromptOpen(true);
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
        maxLength={500}
      />
    </div>
  );

  if (loading) return <div className="card"><div className="card-body">Loading saved onboarding progress…</div></div>;

  return (
    <div>
      <Modal
        open={welcomeOpen}
        onClose={continueFromWelcome}
        title={`Welcome${user?.name ? `, ${user.name.split(' ')[0]}` : ''}!`}
        size="sm"
        footer={<button type="button" className="btn btn-primary" onClick={continueFromWelcome} disabled={welcomeSaving}>{welcomeSaving ? 'Opening…' : 'Continue'}</button>}
      >
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Your Employee registration has been approved. Complete your personal information and upload the required documents for a separate Admin profile review. Other Employee Portal modules remain unavailable until that review is approved.
        </p>
      </Modal>
      <Modal
        open={personalInfoPromptOpen}
        onClose={() => setPersonalInfoPromptOpen(false)}
        title="Complete your personal information"
        size="sm"
        footer={<button type="button" className="btn btn-primary" onClick={() => {
          setPersonalInfoPromptOpen(false);
          document.getElementById('employee-personal-info')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}>Start onboarding</button>}
      >
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Your progress and uploaded documents are saved automatically. You can sign out and return later to finish or resume onboarding.
        </p>
      </Modal>
      <div className="page-header">
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Personal Information & Onboarding</h1>
            <p className="page-subtitle">Complete the required sections and submit your details and documents for Admin verification.</p>
          </div>
          <span className="badge badge-warning">{statuses.onboardingStatus?.replaceAll('_', ' ') || 'Not Started'}</span>
        </div>
      </div>

      {error && <div className="alert alert-danger" role="alert"><AlertCircle size={16} /> {error}</div>}
      {statuses.onboardingReviewNote && (
        <div className="alert alert-warning" role="status">
          <strong>Correction requested by Admin:</strong> {statuses.onboardingReviewNote}
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
          <div>Personal Information <SectionStatus complete={personalComplete} submitted={submitted} correction={correction} /></div>
          <div>Contact & Emergency <SectionStatus complete={contactComplete} submitted={submitted} correction={correction} /></div>
          <div>Documents <SectionStatus complete={documentsComplete} submitted={submitted} correction={correction} /></div>
          <div>Admin Approval <SectionStatus complete={approved} submitted={submitted} correction={correction} /></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h3 className="card-title">Personal Information</h3></div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input className="form-control" value={user?.name || ''} disabled />
          </div>
          <div className="form-group">
            <label className="form-label">Employee ID</label>
            <input className="form-control" value={user?.employeeId || ''} disabled />
          </div>
          {fieldInput('Date of Birth', 'dateOfBirth', 'date')}
          <div className="form-group">
            <label className="form-label">Gender <span className="required">*</span></label>
            <select className="form-control" value={fields.gender} onChange={event => setField('gender', event.target.value)} disabled={!loaded.current || (submitted && !correction)} required>
              <option value="">Select</option>
              {['Female', 'Male', 'Non-binary', 'Prefer not to say'].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h3 className="card-title">Contact & Emergency Information</h3></div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
          {fieldInput('Phone', 'phone', 'tel')}
          {fieldInput('Address', 'address')}
          {fieldInput('City', 'city')}
          {fieldInput('State', 'state')}
          {fieldInput('Country', 'country')}
          {fieldInput('Emergency Contact Name', 'emergencyContactName')}
          {fieldInput('Emergency Contact Phone', 'emergencyContactPhone', 'tel')}
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
            <button type="button" className="btn btn-primary" disabled={!loaded.current || !canSubmit || saving || submitting} onClick={submit}>
              <Send size={15} /> {submitting ? 'Submitting…' : 'Submit for Approval'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default EmployeeOnboarding;
