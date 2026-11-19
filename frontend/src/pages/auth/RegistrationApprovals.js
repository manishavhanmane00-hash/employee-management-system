import React, { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { authAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import toast from 'react-hot-toast';

const RegistrationApprovals = () => {
  const { user } = useAuth();
  const { fetchEmployees, fetchDashboardStats } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') === 'onboarding' ? 'onboarding' : 'registrations');
  const [data, setData] = useState({ registrations: [], employees: [], onboardings: [] });
  const [selection, setSelection] = useState({});
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: response } = await authAPI.getRegistrationReviews();
      setData(response);
      setSelection(current => {
        const next = { ...current };
        (response.registrations || []).forEach(registration => {
          if (!next[registration._id]) {
          next[registration._id] = '';
          }
        });
        return next;
      });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load approval queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (requestedTab === 'onboarding' || requestedTab === 'registrations') setTab(requestedTab);
  }, [searchParams]);

  const chooseTab = value => {
    setTab(value);
    setSearchParams(value === 'registrations' ? {} : { tab: value }, { replace: true });
  };

  const reviewRegistration = async (item, decision) => {
    if (decision === 'approve' && !selection[item._id]) {
      toast.error('Select the verified Employee record before approval.');
      return;
    }
    if (decision === 'reject' && !String(notes[item._id] || '').trim()) {
      toast.error('Enter a reason before rejecting this registration.');
      return;
    }
    setWorkingId(item._id);
    try {
      await authAPI.reviewRegistration(item._id, {
        decision,
        employeeId: selection[item._id],
        note: notes[item._id] || '',
      });
      toast.success(decision === 'approve' ? 'Registration approved; onboarding is now required.' : 'Registration rejected.');
      await load();
      if (decision === 'approve') await Promise.allSettled([fetchEmployees(), fetchDashboardStats()]);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'Could not review registration.');
    } finally {
      setWorkingId('');
    }
  };

  const reviewOnboarding = async (item, decision) => {
    if (decision === 'correction' && !String(notes[item._id] || '').trim()) {
      toast.error('Enter the correction required from the Employee.');
      return;
    }
    setWorkingId(item._id);
    try {
      await authAPI.reviewOnboarding(item._id, { decision, note: notes[item._id] || '' });
      toast.success(decision === 'approve' ? 'Profile and documents approved; full portal access is active.' : 'Correction request sent to the Employee.');
      await load();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'Could not review onboarding.');
    } finally {
      setWorkingId('');
    }
  };

  const downloadDocument = async (employee, document) => {
    try {
      const response = await authAPI.downloadOnboardingDocument(employee._id, document.id);
      const url = URL.createObjectURL(response.data);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = document.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'Could not download the document.');
    }
  };

  const roleDenied = user?.role !== 'Admin';
  const pendingRegistrations = useMemo(() => data.registrations || [], [data.registrations]);
  const pendingOnboardings = useMemo(() => data.onboardings || [], [data.onboardings]);

  if (roleDenied) return <div className="card"><div className="card-body">Admin access is required to review registrations.</div></div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Registration & Onboarding Approvals</h1>
            <p className="page-subtitle">Review registration identity first, then independently verify personal information and documents.</p>
          </div>
          <button type="button" className="btn btn-outline" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button type="button" className={`tab ${tab === 'registrations' ? 'active' : ''}`} onClick={() => chooseTab('registrations')}>
          Registration Approval ({pendingRegistrations.length})
        </button>
        <button type="button" className={`tab ${tab === 'onboarding' ? 'active' : ''}`} onClick={() => chooseTab('onboarding')}>
          Personal Information Approval ({pendingOnboardings.length})
        </button>
      </div>

      {loading ? <div className="card"><div className="card-body">Loading approvals…</div></div> : tab === 'registrations' ? (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-header"><h3 className="card-title">Stage 1 · Registration approval</h3></div>
          {!pendingRegistrations.length ? <div className="empty-state">No registrations are awaiting approval.</div> : (
            <div className="table-responsive" style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ minWidth: 1100 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 200 }}>Applicant</th>
                    <th style={{ minWidth: 180 }}>Submitted</th>
                    <th style={{ minWidth: 145 }}>Identity Match</th>
                    <th style={{ minWidth: 260 }}>Verify Employee Record</th>
                    <th style={{ minWidth: 230 }}>Admin Note / Rejection Reason</th>
                    <th style={{ minWidth: 180 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRegistrations.map(item => (
                    <tr key={item._id}>
                      <td style={{ verticalAlign: 'top' }}><strong>{item.name}</strong><div>{item.email}</div><small>Provided ID: {item.registrationEmployeeId || 'Not provided'}</small></td>
                      <td style={{ verticalAlign: 'top' }}>{item.registrationSubmittedAt ? new Date(item.registrationSubmittedAt).toLocaleString() : '—'}</td>
                      <td style={{ verticalAlign: 'top' }}>{item.registrationIdentityStatus === 'matched' ? 'Matched' : 'Requires Admin verification'}</td>
                      <td style={{ verticalAlign: 'top' }}>
                        <select className="form-control" style={{ minWidth: 220 }} value={selection[item._id] || ''} onChange={event => setSelection(current => ({ ...current, [item._id]: event.target.value }))}>
                          <option value="">Select verified employee</option>
                          {(data.employees || [])
                            .filter(employee => Boolean(employee.employeeId))
                            .sort((a, b) => (a.name || '').localeCompare(b.name || '') || (a.employeeId || '').localeCompare(b.employeeId || ''))
                            .map(employee => (
                              <option key={employee._id} value={String(employee.employeeId).trim()}>
                                {employee.name || 'Unnamed employee'} · {employee.employeeId} · {employee.department || 'No department'}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td style={{ verticalAlign: 'top' }}><input className="form-control" style={{ minWidth: 210 }} value={notes[item._id] || ''} onChange={event => setNotes(current => ({ ...current, [item._id]: event.target.value }))} maxLength={1000} placeholder="Required when rejecting" /></td>
                      <td style={{ verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-primary btn-sm" disabled={workingId === item._id} onClick={() => reviewRegistration(item, 'approve')}><UserCheck size={14} /> Approve</button>
                          <button type="button" className="btn btn-danger btn-sm" disabled={workingId === item._id} onClick={() => reviewRegistration(item, 'reject')}><UserX size={14} /> Reject</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {!pendingOnboardings.length ? <div className="card"><div className="empty-state">No personal information submissions are awaiting approval.</div></div> : pendingOnboardings.map(item => (
            <section className="card" key={item._id}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div><h3 className="card-title">{item.name} · {item.employeeId || item.registrationEmployeeId || 'Employee ID pending'}</h3><div>{item.email} · Submitted {item.onboardingSubmittedAt ? new Date(item.onboardingSubmittedAt).toLocaleString() : '—'}</div></div>
                <span className="badge badge-warning">{item.onboardingStatus.replaceAll('_', ' ')}</span>
              </div>
              <div className="card-body">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  {Object.entries(item.onboardingDraft?.fields || {}).map(([key, value]) => (
                    <div key={key}><strong>{key.replaceAll(/([A-Z])/g, ' $1')}:</strong> {value || '—'}</div>
                  ))}
                </div>
                <div style={{ marginTop: 16 }}>
                  <strong>Documents</strong>
                  {(item.onboardingDraft?.documents || []).map(document => (
                    <div key={document.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                      <span style={{ flex: 1 }}>{document.name} · {Math.ceil(document.size / 1024)} KB · {document.archivedAt ? 'Archived' : document.verificationStatus || 'pending'}</span>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => downloadDocument(item, document)}><Download size={14} /> Download</button>
                    </div>
                  ))}
                </div>
                <label className="form-label" style={{ marginTop: 12 }}>Admin review note</label>
                <textarea className="form-control" rows={2} maxLength={1000} value={notes[item._id] || ''} onChange={event => setNotes(current => ({ ...current, [item._id]: event.target.value }))} placeholder="Required when requesting corrections" />
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button type="button" className="btn btn-primary" disabled={workingId === item._id} onClick={() => reviewOnboarding(item, 'approve')}><ShieldCheck size={14} /> Approve Profile</button>
                  <button type="button" className="btn btn-outline" disabled={workingId === item._id} onClick={() => reviewOnboarding(item, 'correction')}>Request Corrections</button>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default RegistrationApprovals;
