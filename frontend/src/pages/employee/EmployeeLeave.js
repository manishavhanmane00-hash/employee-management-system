import React, { useState, useMemo } from 'react';
import { Plus, Calendar, Eye, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { leaveAPI } from '../../services/api';
import Badge from '../../components/shared/Badge';
import Modal from '../../components/shared/Modal';
import { LEAVE_TYPES } from '../../data/sampleData';
import { readLeaveDocument } from '../../utils/leaveDocument';
import toast from 'react-hot-toast';

const TABS = ['Leave Balance', 'Apply Leave', 'My Requests'];

const ProgressBar = ({ used, total, color = 'var(--primary)' }) => {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  return (
    <div className="progress-bar" style={{ height: 8 }}>
      <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
};

const EmployeeLeave = () => {
  const { leaveRequests, leaveBalances, addLeaveRequest, cancelLeave } = useApp();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [viewRequest, setViewRequest] = useState(null);

  const myRequests = useMemo(() =>
    leaveRequests.filter(r =>
      (user?._id && String(r.userId) === String(user._id))
      || (user?.id && String(r.userId) === String(user.id))
      || r.email === user?.email
    )
      .sort((a, b) => (b.appliedDate || '').localeCompare(a.appliedDate || '')),
    [leaveRequests, user]
  );

  const leaveBalance = useMemo(() => Object.fromEntries(
    leaveBalances.map(balance => [balance.leaveType, {
      total: balance.totalAllocated ?? balance.entitlement,
      used: balance.approvedPaid || 0,
      pending: balance.pendingPaid || 0,
      remaining: balance.remaining,
      approvedUnpaid: balance.approvedUnpaid || 0,
      pendingUnpaid: balance.pendingUnpaid || 0,
    }])
  ), [leaveBalances]);

  // Apply Leave Form
  const [form, setForm] = useState({ leaveType: '', startDate: '', endDate: '', paidStatus: 'Paid', reason: '' });
  const [supportingDocument, setSupportingDocument] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const setF = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: '' })); };

  const days = useMemo(() => {
    if (!form.startDate || !form.endDate) return 0;
    const d = Math.ceil((new Date(form.endDate) - new Date(form.startDate)) / 86400000) + 1;
    return d > 0 ? d : 0;
  }, [form.startDate, form.endDate]);

  const validate = () => {
    const errs = {};
    if (!form.leaveType)  errs.leaveType  = 'Select a leave type';
    if (!form.startDate)  errs.startDate  = 'Select start date';
    if (!form.endDate)    errs.endDate    = 'Select end date';
    if (!form.reason.trim()) errs.reason = 'Provide a reason';
    else if (form.reason.length > 1000) errs.reason = 'Reason cannot exceed 1000 characters';
    if (form.startDate && form.endDate && form.endDate < form.startDate)
      errs.endDate = 'End date cannot be before start date';
    const bal = leaveBalance[form.leaveType];
    if (form.paidStatus === 'Paid' && bal && days > Number(bal.remaining)) {
      errs.leaveType = `Insufficient balance. You have ${bal.remaining} days remaining.`;
    }
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSubmitting(true);
    try {
      await addLeaveRequest({
        leaveType: form.leaveType,
        paidStatus: form.leaveType === 'Unpaid Leave' ? 'Unpaid' : form.paidStatus,
        startDate: form.startDate,
        endDate: form.endDate,
        days,
        reason: form.reason,
        supportingDocument,
      });
      toast.success('Leave request submitted successfully');
      setForm({ leaveType: '', startDate: '', endDate: '', paidStatus: 'Paid', reason: '' });
      setSupportingDocument(null);
      setErrors({});
      setActiveTab(2);
    } catch (err) {
      toast.error(err.message || 'Failed to submit leave request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const balanceColors = {
    'Annual Leave': 'var(--primary)',
    'Sick Leave': 'var(--danger)',
    'Casual Leave': 'var(--info)',
    'Maternity Leave': 'var(--purple)',
    'Paternity Leave': 'var(--teal)',
  };

  const renderBalance = () => (
    <div>
      <div className="grid grid-3 grid-gap-sm mb-6">
        {Object.entries(leaveBalance).slice(0, 3).map(([type, bal]) => {
          const remaining = Number(bal.remaining || 0);
          const color = balanceColors[type] || 'var(--primary)';
          return (
            <div key={type} className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 4 }}>{type}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{bal.total} days allocated</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{remaining}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>remaining</div>
                </div>
              </div>
              <ProgressBar used={bal.used} total={bal.total} color={color} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span>{bal.used} approved · {bal.pending} pending</span>
                <span>{remaining} left</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-2 grid-gap-sm">
        {Object.entries(leaveBalance).slice(3).map(([type, bal]) => {
          const remaining = Number(bal.remaining || 0);
          const color = balanceColors[type] || 'var(--primary)';
          return (
            <div key={type} className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 4 }}>{type}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{bal.total} days allocated</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{remaining}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>remaining</div>
                </div>
              </div>
              <ProgressBar used={bal.used} total={bal.total} color={color} />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>{bal.used} approved · {bal.pending} pending</div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderApply = () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
      <div className="card">
        <div className="card-header"><h3 className="card-title">Leave Application</h3></div>
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Leave Type <span className="required">*</span></label>
                <select className={`form-control form-select ${errors.leaveType ? 'error' : ''}`} value={form.leaveType} onChange={e => {
                  setF('leaveType', e.target.value);
                  if (e.target.value === 'Unpaid Leave') setF('paidStatus', 'Unpaid');
                }}>
                  <option value="">Select leave type</option>
                  {LEAVE_TYPES.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
                {errors.leaveType && <div className="form-error">{errors.leaveType}</div>}
              </div>
              <div />
              <div className="form-group">
                <label className="form-label">Start Date <span className="required">*</span></label>
                <input type="date" className={`form-control ${errors.startDate ? 'error' : ''}`} value={form.startDate} min={new Date().toISOString().split('T')[0]} onChange={e => setF('startDate', e.target.value)} />
                {errors.startDate && <div className="form-error">{errors.startDate}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">End Date <span className="required">*</span></label>
                <input type="date" className={`form-control ${errors.endDate ? 'error' : ''}`} value={form.endDate} min={form.startDate || new Date().toISOString().split('T')[0]} onChange={e => setF('endDate', e.target.value)} />
                {errors.endDate && <div className="form-error">{errors.endDate}</div>}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Leave Category <span className="required">*</span></label>
              <select className="form-control form-select" value={form.leaveType === 'Unpaid Leave' ? 'Unpaid' : form.paidStatus}
                onChange={e => setF('paidStatus', e.target.value)} disabled={form.leaveType === 'Unpaid Leave'}>
                <option value="Paid">Paid Leave</option>
                <option value="Unpaid">Unpaid Leave</option>
              </select>
            </div>

            {days > 0 && (
              <div style={{ background: 'var(--primary-light)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Calendar size={16} color="var(--primary)" />
                <span style={{ fontSize: '0.875rem', color: 'var(--primary)', fontWeight: 500 }}>
                  Duration: <strong>{days} day{days > 1 ? 's' : ''}</strong>
                </span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Reason <span className="required">*</span></label>
              <textarea className={`form-control ${errors.reason ? 'error' : ''}`} rows={4} value={form.reason} onChange={e => setF('reason', e.target.value)} placeholder="Describe the reason for your leave..." />
              {errors.reason && <div className="form-error">{errors.reason}</div>}
            </div>

            <div className="form-group">
              <label className="form-label">Supporting Document (optional)</label>
              <div className="file-upload-area" style={{ padding: 20, cursor: 'pointer' }} onClick={() => document.getElementById('employee-leave-document')?.click()}>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  {supportingDocument?.name || '📎 Upload medical certificate or supporting document'}
                </div>
                <input id="employee-leave-document" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" hidden
                  onChange={async event => {
                    try {
                      setSupportingDocument(await readLeaveDocument(event.target.files?.[0]));
                    } catch (error) {
                      event.target.value = '';
                      toast.error(error.message);
                    }
                  }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn btn-outline" onClick={() => {
                setForm({ leaveType: '', startDate: '', endDate: '', paidStatus: 'Paid', reason: '' });
                setSupportingDocument(null);
              }}>Clear</button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Leave Request'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Side panel */}
      <div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><h3 className="card-title" style={{ fontSize: '0.9rem' }}>Quick Balance</h3></div>
          <div className="card-body" style={{ padding: 16 }}>
            {LEAVE_TYPES.slice(0, 3).map(t => {
              const bal = leaveBalance[t.name] || { total: t.days, used: 0 };
              const remaining = bal.total - bal.used;
              return (
                <div key={t.name} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{t.name}</span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)' }}>{remaining}/{bal.total}</span>
                  </div>
                  <ProgressBar used={bal.used} total={bal.total} color={balanceColors[t.name] || 'var(--primary)'} />
                </div>
              );
            })}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="card-title" style={{ fontSize: '0.9rem' }}>Leave Policy</h3></div>
          <div className="card-body" style={{ padding: 16 }}>
            {LEAVE_TYPES.map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.8rem' }}>{t.name}</span>
                <span className={`badge badge-${t.color}`} style={{ fontSize: '0.7rem' }}>{t.days} days</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderRequests = () => (
    <div>
      <div className="grid grid-4 grid-gap-sm mb-5">
        {[
          { label: 'Total Requests', value: myRequests.length,                                          color: 'var(--primary)' },
          { label: 'Approved',       value: myRequests.filter(r => r.status === 'approved').length,   color: 'var(--success)' },
          { label: 'Pending',        value: myRequests.filter(r => r.status === 'pending').length,    color: 'var(--warning)' },
          { label: 'Rejected',       value: myRequests.filter(r => r.status === 'rejected').length,   color: 'var(--danger)'  },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {myRequests.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🏖️</div>
          <div className="empty-state-title">No leave requests yet</div>
          <div className="empty-state-desc">Apply for leave using the "Apply Leave" tab</div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setActiveTab(1)}>
            <Plus size={14} /> Apply for Leave
          </button>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Request ID</th>
                <th>Leave Type</th>
                <th>Category</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Days</th>
                <th>Applied On</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {myRequests.map(r => (
                <tr key={r._id || r.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--primary)' }}>
                    {String(r._id || r.id || '').slice(-8).toUpperCase()}
                  </td>
                  <td style={{ fontSize: '0.875rem' }}>{r.leaveType}</td>
                  <td style={{ fontSize: '0.875rem' }}>{r.paidStatus || (r.leaveType === 'Unpaid Leave' ? 'Unpaid' : 'Paid')}</td>
                  <td style={{ fontSize: '0.875rem' }}>{r.startDate}</td>
                  <td style={{ fontSize: '0.875rem' }}>{r.endDate}</td>
                  <td style={{ fontWeight: 600 }}>{r.days}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.appliedDate || '—'}</td>
                  <td><Badge status={r.status} /></td>
                  <td>
                    <div className="table-actions">
                      <button className="btn-icon primary" onClick={() => setViewRequest(r)} title="View Details">
                        <Eye size={13} />
                      </button>
                      {r.status === 'pending' && (
                        <button className="btn-icon danger" title="Cancel Request"
                          onClick={async () => {
                            try { await cancelLeave(r._id || r.id); toast.success('Leave request cancelled'); }
                            catch (err) { toast.error(err.message || 'Failed to cancel'); }
                          }}>
                          <XCircle size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* View Request Modal */}
      {viewRequest && (
        <Modal open={true} onClose={() => setViewRequest(null)} title="Leave Request Details" size="md">
          <div style={{ display: 'grid', gap: 12 }}>
            {[
              ['Request ID',   String(viewRequest._id || viewRequest.id || '').slice(-8).toUpperCase()],
              ['Leave Type',   viewRequest.leaveType],
              ['Leave Category', viewRequest.paidStatus || (viewRequest.leaveType === 'Unpaid Leave' ? 'Unpaid' : 'Paid')],
              ['From',         viewRequest.startDate],
              ['To',           viewRequest.endDate],
              ['Days',         viewRequest.days],
              ['Applied On',   viewRequest.appliedDate || '—'],
              ['Status',       <Badge status={viewRequest.status} />],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ width: 120, flexShrink: 0, fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>{k}</span>
                <span style={{ fontSize: '0.875rem' }}>{v}</span>
              </div>
            ))}
            {viewRequest.reason && (
              <div style={{ padding: '8px 0' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: 6 }}>Reason</div>
                <div style={{ fontSize: '0.875rem', background: 'var(--bg)', padding: 12, borderRadius: 8, lineHeight: 1.6 }}>{viewRequest.reason}</div>
              </div>
            )}
            {viewRequest.rejectionReason && (
              <div style={{ background: 'var(--danger-light)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--danger)', marginBottom: 4 }}>Rejection Reason</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{viewRequest.rejectionReason}</div>
              </div>
            )}
            {viewRequest.supportingDocument?.name && (
              <button className="btn btn-outline btn-sm" onClick={async () => {
                try {
                  const { data } = await leaveAPI.downloadDocument(viewRequest._id || viewRequest.id);
                  const url = URL.createObjectURL(data);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = viewRequest.supportingDocument.name;
                  link.click();
                  URL.revokeObjectURL(url);
                } catch (err) {
                  toast.error(err.response?.data?.message || 'Unable to download supporting document.');
                }
              }}>
                Download {viewRequest.supportingDocument.name}
              </button>
            )}
            {viewRequest.history?.length > 0 && (
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>Request History</div>
                {viewRequest.history.map((item, index) => (
                  <div key={`${item.action}-${item.performedAt}-${index}`} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    {item.action} by {item.performedByName || 'System'} · {item.performedAt ? new Date(item.performedAt).toLocaleString() : '—'}
                    {item.comment ? ` · ${item.comment}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div className="page-header-top">
          <div>
            <h1 className="page-title">My Leave</h1>
            <p className="page-subtitle">Manage your leave requests and balances</p>
          </div>
          <button className="btn btn-primary" onClick={() => setActiveTab(1)}>
            <Plus size={14} /> Apply for Leave
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="tabs" style={{ padding: '0 24px' }}>
          {TABS.map((t, i) => (
            <div key={t} className={`tab ${activeTab === i ? 'active' : ''}`} onClick={() => setActiveTab(i)}>
              {t}
              {t === 'My Requests' && myRequests.filter(r => r.status === 'pending').length > 0 && (
                <span className="badge badge-warning" style={{ marginLeft: 6, fontSize: '0.65rem' }}>
                  {myRequests.filter(r => r.status === 'pending').length}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="card-body">
          {activeTab === 0 && renderBalance()}
          {activeTab === 1 && renderApply()}
          {activeTab === 2 && renderRequests()}
        </div>
      </div>

    </div>
  );
};

export default EmployeeLeave;
