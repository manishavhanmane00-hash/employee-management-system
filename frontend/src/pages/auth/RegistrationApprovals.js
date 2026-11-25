import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Image, RefreshCw, Search, ShieldCheck, UserCheck, UserX } from 'lucide-react';
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
  const [data, setData] = useState({
    registrations: [],
    approvedRegistrations: [],
    rejectedRegistrations: [],
    onboardings: [],
    approvedProfiles: [],
    correctionRequests: [],
  });
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [profileTab, setProfileTab] = useState('pending');
  const [registrationTab, setRegistrationTab] = useState('pending');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: response } = await authAPI.getRegistrationReviews();
      setData(response);
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
    if (decision === 'reject' && !String(notes[item._id] || '').trim()) {
      toast.error('Enter a reason before rejecting this registration.');
      return;
    }
    setWorkingId(item._id);
    try {
      await authAPI.reviewRegistration(item._id, {
        decision,
        note: notes[item._id] || '',
      });
      toast.success(decision === 'approve'
        ? 'Registration approved; the employee can now sign in and complete their profile.'
        : 'Registration rejected.');
      await load();
      if (decision === 'approve') await Promise.allSettled([fetchEmployees(), fetchDashboardStats()]);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'Could not review registration.');
    } finally {
      setWorkingId('');
    }
  };

  const reviewOnboarding = async (item, decision) => {
    if (decision !== 'approve' && !String(notes[item._id] || '').trim()) {
      toast.error(decision === 'reject' ? 'Enter a rejection reason.' : 'Enter the correction required from the Employee.');
      return;
    }
    setWorkingId(item._id);
    try {
      await authAPI.reviewOnboarding(item._id, { decision, note: notes[item._id] || '' });
      toast.success(decision === 'approve'
        ? 'Profile and documents approved; full portal access is active.'
        : decision === 'reject' ? 'Profile rejected; the Employee may correct and resubmit it.' : 'Correction request sent to the Employee.');
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

  const viewProfilePhoto = async employee => {
    const photoWindow = window.open('about:blank', '_blank');
    if (!photoWindow) {
      toast.error('Allow pop-ups to view the profile photo.');
      return;
    }
    try {
      const response = await authAPI.downloadOnboardingDocument(employee._id, 'profile-photo');
      const url = URL.createObjectURL(new Blob([response.data], { type: employee.onboardingDraft.profilePhoto.mimeType }));
      photoWindow.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (requestError) {
      photoWindow.close();
      toast.error(requestError.response?.data?.message || 'Could not load the profile photo.');
    }
  };

  const roleDenied = user?.role !== 'Admin';
  const registrationSource = registrationTab === 'approved'
    ? data.approvedRegistrations
    : registrationTab === 'rejected' ? data.rejectedRegistrations : data.registrations;
  const profileSource = profileTab === 'approved'
    ? data.approvedProfiles
    : profileTab === 'corrections' ? data.correctionRequests : data.onboardings;
  const matchesSearch = useCallback(item => {
    const query = search.trim().toLowerCase();
    return !query || [
      item.name,
      item.email,
      item.employeeId,
      item.registrationEmployeeId,
      item.employment?.department,
      item.onboardingDraft?.fields?.name,
    ].some(value => String(value || '').toLowerCase().includes(query));
  }, [search]);
  const registrationItems = useMemo(() => registrationSource.filter(matchesSearch), [registrationSource, matchesSearch]);
  const profileItems = useMemo(() => profileSource.filter(matchesSearch), [profileSource, matchesSearch]);

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
          Registration Requests ({data.registrations.length + data.approvedRegistrations.length + data.rejectedRegistrations.length})
        </button>
        <button type="button" className={`tab ${tab === 'onboarding' ? 'active' : ''}`} onClick={() => chooseTab('onboarding')}>
          Employee Profiles ({data.onboardings.length + data.approvedProfiles.length + data.correctionRequests.length})
        </button>
      </div>

      <div className="form-group" style={{ maxWidth: 440 }}>
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-control" style={{ paddingLeft: 38 }} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by employee name, email or department" />
        </div>
      </div>

      {tab === 'registrations' ? (
        <>
          <div className="tabs" style={{ marginBottom: 16, overflowX: 'auto' }}>
            <button type="button" className={`tab ${registrationTab === 'pending' ? 'active' : ''}`} onClick={() => setRegistrationTab('pending')}>
              Pending Registration Requests ({data.registrations.length})
            </button>
            <button type="button" className={`tab ${registrationTab === 'approved' ? 'active' : ''}`} onClick={() => setRegistrationTab('approved')}>
              Approved Registrations ({data.approvedRegistrations.length})
            </button>
            <button type="button" className={`tab ${registrationTab === 'rejected' ? 'active' : ''}`} onClick={() => setRegistrationTab('rejected')}>
              Rejected Registrations ({data.rejectedRegistrations.length})
            </button>
          </div>
          {loading ? <div className="card"><div className="card-body">Loading registration requests…</div></div> : registrationTab === 'pending' ? (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-header"><h3 className="card-title">Pending Registration Requests</h3></div>
              {!registrationItems.length ? <div className="empty-state">No registrations are awaiting approval.</div> : (
                <div className="table-responsive" style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ minWidth: 900 }}>
                    <thead><tr>
                      <th style={{ minWidth: 200 }}>Employee</th>
                      <th style={{ minWidth: 180 }}>Registration Date</th>
                      <th style={{ minWidth: 145 }}>Account Status</th>
                      <th style={{ minWidth: 230 }}>Admin Note / Rejection Reason</th>
                      <th style={{ minWidth: 180 }}>Action</th>
                    </tr></thead>
                    <tbody>
                      {registrationItems.map(item => (
                        <tr key={item._id}>
                          <td style={{ verticalAlign: 'top' }}><strong>{item.name}</strong><div>{item.email}</div></td>
                          <td style={{ verticalAlign: 'top' }}>{item.registrationSubmittedAt ? new Date(item.registrationSubmittedAt).toLocaleString() : '—'}</td>
                          <td style={{ verticalAlign: 'top' }}><span className="badge badge-warning">Pending Registration</span></td>
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
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-header"><h3 className="card-title">{registrationTab === 'approved' ? 'Approved Registrations' : 'Rejected Registrations'}</h3></div>
              {!registrationItems.length ? <div className="empty-state">No matching registrations.</div> : (
                <div className="table-responsive" style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ minWidth: 760 }}>
                    <thead><tr><th>Employee</th><th>Status</th><th>Submitted</th><th>Reviewed</th><th>Admin Note</th></tr></thead>
                    <tbody>{registrationItems.map(item => (
                      <tr key={item._id}>
                        <td><strong>{item.name}</strong><div>{item.email}</div><small>{item.employeeId || item.registrationEmployeeId || 'Employee ID pending'}</small></td>
                        <td><span className={`badge ${registrationTab === 'approved' ? 'badge-success' : 'badge-danger'}`}>{registrationTab === 'approved' ? 'Approved' : 'Rejected'}</span></td>
                        <td>{item.registrationSubmittedAt ? new Date(item.registrationSubmittedAt).toLocaleString() : '—'}</td>
                        <td>{item.registrationReviewedAt ? new Date(item.registrationReviewedAt).toLocaleString() : '—'}</td>
                        <td>{item.registrationReviewNote || '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="tabs" style={{ marginBottom: 16, overflowX: 'auto' }}>
            <button type="button" className={`tab ${profileTab === 'pending' ? 'active' : ''}`} onClick={() => setProfileTab('pending')}>
              Pending Employee Profile Approvals ({data.onboardings.length})
            </button>
            <button type="button" className={`tab ${profileTab === 'approved' ? 'active' : ''}`} onClick={() => setProfileTab('approved')}>
              Approved Employee Profiles ({data.approvedProfiles.length})
            </button>
            <button type="button" className={`tab ${profileTab === 'corrections' ? 'active' : ''}`} onClick={() => setProfileTab('corrections')}>
              Profile Correction Requests ({data.correctionRequests.length})
            </button>
          </div>
          {loading ? <div className="card"><div className="card-body">Loading employee profiles…</div></div> : (
            <div style={{ display: 'grid', gap: 16 }}>
              {!profileItems.length ? <div className="card"><div className="empty-state">No matching employee profiles.</div></div> : profileItems.map(item => {
                const rejected = item.onboardingStatus === 'rejected';
                const corrected = item.onboardingStatus === 'correction_required';
                const approved = item.onboardingStatus === 'completed';
                const statusClass = approved ? 'badge-success' : rejected ? 'badge-danger' : corrected ? 'badge-info' : 'badge-warning';
                const fields = item.onboardingDraft?.fields || {};
                const employmentFields = item.employment || {};
                return (
                  <section className="card" key={item._id}>
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div><h3 className="card-title">{fields.name || item.name} · {employmentFields.employeeId || item.employeeId || 'Employee ID pending'}</h3><div>{item.email} · Submitted {item.onboardingSubmittedAt ? new Date(item.onboardingSubmittedAt).toLocaleString() : '—'}</div></div>
                      <span className={`badge ${statusClass}`}>{item.onboardingStatus.replaceAll('_', ' ')}</span>
                    </div>
                    <div className="card-body">
                      <h4>Personal & Emergency Information</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                        {Object.entries(fields).map(([key, value]) => (
                          <div key={key}><strong>{key.replaceAll(/([A-Z])/g, ' $1').replace(/^./, letter => letter.toUpperCase())}:</strong> {value || '—'}</div>
                        ))}
                      </div>
                      <h4 style={{ marginTop: 16 }}>Employment Information</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                        {Object.entries(employmentFields).map(([key, value]) => (
                          <div key={key}><strong>{key.replaceAll(/([A-Z])/g, ' $1').replace(/^./, letter => letter.toUpperCase())}:</strong> {value || '—'}</div>
                        ))}
                      </div>
                      {item.onboardingDraft?.profilePhoto && (
                        <div style={{ marginTop: 12 }}>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => viewProfilePhoto(item)}><Image size={14} /> View profile photo</button>
                        </div>
                      )}
                      <div style={{ marginTop: 16 }}>
                        <strong>Documents</strong>
                        {(item.onboardingDraft?.documents || []).map(document => (
                          <div key={document.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                            <span style={{ flex: 1 }}>{document.name} · {Math.ceil(document.size / 1024)} KB · {document.archivedAt ? 'Archived' : document.verificationStatus || 'pending'}</span>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => downloadDocument(item, document)}><Download size={14} /> Download</button>
                          </div>
                        ))}
                      </div>
                      {(rejected || corrected) && item.onboardingReviewNote && (
                        <div className={`alert ${rejected ? 'alert-danger' : 'alert-info'}`} style={{ marginTop: 12 }}>
                          <strong>{rejected ? 'Rejection reason:' : 'Correction instructions:'}</strong> {item.onboardingReviewNote}
                        </div>
                      )}
                      {profileTab === 'pending' && (
                        <>
                          <label className="form-label" style={{ marginTop: 12 }}>Admin review note / correction instructions</label>
                          <textarea className="form-control" rows={2} maxLength={1000} value={notes[item._id] || ''} onChange={event => setNotes(current => ({ ...current, [item._id]: event.target.value }))} placeholder="Required when rejecting or requesting corrections" />
                          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-primary" disabled={workingId === item._id} onClick={() => reviewOnboarding(item, 'approve')}><ShieldCheck size={14} /> Approve Profile</button>
                            <button type="button" className="btn btn-danger" disabled={workingId === item._id} onClick={() => reviewOnboarding(item, 'reject')}><UserX size={14} /> Reject Profile</button>
                            <button type="button" className="btn btn-outline" disabled={workingId === item._id} onClick={() => reviewOnboarding(item, 'correction')}>Request Corrections</button>
                          </div>
                        </>
                      )}
                      {profileTab === 'corrections' && <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>Waiting for the Employee to correct and resubmit this profile.</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RegistrationApprovals;
