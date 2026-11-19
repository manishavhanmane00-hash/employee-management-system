import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, CheckCheck, Clock3, Eye, Send, Trash2, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import Badge from '../../components/shared/Badge';
import toast from 'react-hot-toast';

const REQUEST_TYPES = [
  'Leave',
  'Attendance Correction',
  'Holiday',
  'Expense',
  'Reimbursement',
  'Permission',
  'Other',
];

const formatDate = value => value ? new Date(value).toLocaleString('en-IN') : '—';

const RequestCenter = () => {
  const { user } = useAuth();
  const {
    centralRequests, fetchCentralRequests, submitCentralRequest, reviewCentralRequest,
    notifications, markNotifRead, markAllNotifsRead, deleteNotif,
  } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState(searchParams.get('requestId') || '');
  const [statusFilter, setStatusFilter] = useState('All');
  const [requestType, setRequestType] = useState('Leave');
  const [customType, setCustomType] = useState('');
  const [details, setDetails] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const submissionKey = useRef('');
  const isAdmin = user?.role === 'Admin';

  useEffect(() => { fetchCentralRequests(); }, [fetchCentralRequests]);

  useEffect(() => {
    const requestId = searchParams.get('requestId');
    if (requestId) {
      setSelectedId(requestId);
      const notification = notifications.find(item => String(item.requestId) === requestId && !item.isRead);
      if (notification) markNotifRead(notification._id);
    }
  }, [searchParams, notifications, markNotifRead]);

  const requests = useMemo(() => {
    const records = (centralRequests || []).filter(request => statusFilter === 'All' || request.status === statusFilter);
    return records.slice().sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  }, [centralRequests, statusFilter]);
  const selectedRequest = requests.find(request => request._id === selectedId)
    || centralRequests.find(request => request._id === selectedId);

  const submit = async event => {
    event.preventDefault();
    const type = requestType === 'Other' ? customType.trim() : requestType;
    if (!type || !details.trim()) {
      toast.error('Enter a request type and details.');
      return;
    }
    setSubmitting(true);
    try {
      if (!submissionKey.current) {
        submissionKey.current = window.crypto && typeof window.crypto.randomUUID === 'function'
          ? window.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      await submitCentralRequest({ requestType: type, details: details.trim(), submissionKey: submissionKey.current });
      submissionKey.current = '';
      setDetails('');
      setCustomType('');
      toast.success('Your request was submitted.');
    } catch (error) {
      toast.error(error.message || 'Could not submit the request.');
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async status => {
    if (!selectedRequest) return;
    setReviewing(true);
    try {
      await reviewCentralRequest(selectedRequest._id, { status, comment: comment.trim() });
      setComment('');
      toast.success(status === 'Review' ? 'Request marked for review.' : `Request ${status.toLowerCase()}.`);
    } catch (error) {
      toast.error(error.message || 'Could not update the request.');
    } finally {
      setReviewing(false);
    }
  };

  const selectRequest = request => {
    setSelectedId(request._id);
    setSearchParams({ requestId: request._id }, { replace: true });
  };

  const openNotification = notification => {
    if (!notification.isRead) markNotifRead(notification._id);
    if (notification.actionUrl) {
      navigate(notification.actionUrl);
      return;
    }
    if (notification.requestId) {
      setSelectedId(String(notification.requestId));
      setSearchParams({ requestId: String(notification.requestId) }, { replace: true });
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-top">
          <div>
            <h1 className="page-title">{isAdmin ? 'Request Notifications' : 'Requests & Notifications'}</h1>
            <p className="page-subtitle">
              {isAdmin ? 'Review incoming requests and their complete history.' : 'Submit requests and follow their status.'}
            </p>
          </div>
        </div>
      </div>

      {!isAdmin && (
        <form className="card" onSubmit={submit} style={{ marginBottom: 16 }}>
          <div className="card-header"><h3 className="card-title">Submit a Request</h3></div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 2fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Request Type</label>
                <select className="form-control" value={requestType} onChange={event => setRequestType(event.target.value)}>
                  {REQUEST_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
                {requestType === 'Other' && (
                  <input className="form-control" style={{ marginTop: 8 }} value={customType}
                    onChange={event => setCustomType(event.target.value)} maxLength={100} placeholder="Specify request type" />
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Request Details</label>
                <textarea className="form-control" rows={3} value={details} onChange={event => setDetails(event.target.value)}
                  maxLength={10000} placeholder="Describe the request and include relevant dates or supporting details." />
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              <Send size={14} /> {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="card-title">Notifications</h3>
          {notifications.some(item => !item.isRead) && (
            <button type="button" className="btn btn-outline btn-sm" onClick={markAllNotifsRead}>
              <CheckCheck size={14} /> Mark All Read
            </button>
          )}
        </div>
        {notifications.length ? notifications.slice(0, 20).map(notification => (
          <div key={notification._id} onClick={() => openNotification(notification)}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderTop: '1px solid var(--border)', background: notification.isRead ? 'transparent' : 'var(--primary-light)', cursor: 'pointer' }}>
            <Bell size={16} color="var(--primary)" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem' }}>
                {notification.title && <strong>{notification.title}: </strong>}{notification.message}
              </div>
              {notification.requestId && (
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 3 }}>
                  {notification.requesterRole || user?.role} · {notification.employeeId ? `ID ${notification.employeeId}` : 'No Employee ID'} · {notification.requestStatus || 'Pending'}
                </div>
              )}
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 3 }}>{formatDate(notification.createdAt)}</div>
            </div>
            <button type="button" className="btn-icon danger" title="Delete notification"
              onClick={event => { event.stopPropagation(); deleteNotif(notification._id); }}>
              <Trash2 size={14} />
            </button>
          </div>
        )) : (
          <div style={{ padding: 18, color: 'var(--text-muted)', fontSize: '0.875rem' }}>No notifications yet.</div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: selectedRequest ? 'minmax(0, 1.15fr) minmax(300px, 0.85fr)' : '1fr', gap: 16, alignItems: 'start' }}>
        <section className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <h3 className="card-title">{isAdmin ? 'All Requests' : 'My Request History'}</h3>
            <select className="form-control" style={{ maxWidth: 160 }} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
              {['All', 'Pending', 'Review', 'Approved', 'Rejected'].map(status => <option key={status}>{status}</option>)}
            </select>
          </div>
          {requests.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr>
                  {isAdmin && <th>Requester</th>}
                  <th>Request</th><th>Submitted</th><th>Status</th><th />
                </tr></thead>
                <tbody>
                  {requests.map(request => (
                    <tr key={request._id} style={{ cursor: 'pointer' }} onClick={() => selectRequest(request)}>
                      {isAdmin && (
                        <td>
                          <strong>{request.requesterName}</strong>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {request.employeeId || 'No Employee ID'} · {request.role}
                          </div>
                        </td>
                      )}
                      <td><strong>{request.requestType}</strong></td>
                      <td>{formatDate(request.submittedAt)}</td>
                      <td><Badge status={request.status.toLowerCase()} label={request.status} /></td>
                      <td><button className="btn btn-outline btn-sm" type="button" onClick={event => { event.stopPropagation(); selectRequest(request); }}><Eye size={14} /> Details</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 32 }}>
              <Bell size={38} color="var(--text-muted)" />
              <div className="empty-state-title">{isAdmin ? 'No requests found' : 'No requests submitted yet'}</div>
            </div>
          )}
        </section>

        {selectedRequest && (
          <aside className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="card-title">Request Details</h3>
              <button className="btn-icon" aria-label="Close details" onClick={() => { setSelectedId(''); setSearchParams({}, { replace: true }); }}><X size={16} /></button>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gap: 10, fontSize: '0.875rem' }}>
                <div><strong>Requester:</strong> {selectedRequest.requesterName}</div>
                <div><strong>Employee ID:</strong> {selectedRequest.employeeId || 'Not linked'}</div>
                <div><strong>Email:</strong> {selectedRequest.email || '—'}</div>
                <div><strong>Role:</strong> {selectedRequest.role}</div>
                <div><strong>Type:</strong> {selectedRequest.requestType}</div>
                <div><strong>Submitted:</strong> {formatDate(selectedRequest.submittedAt)}</div>
                <div><strong>Status:</strong> <Badge status={selectedRequest.status.toLowerCase()} label={selectedRequest.status} /></div>
                <div>
                  <strong>Details:</strong>
                  <pre style={{ marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', font: 'inherit', background: 'var(--bg)', borderRadius: 6, padding: 10 }}>
                    {typeof selectedRequest.details === 'string' ? selectedRequest.details : JSON.stringify(selectedRequest.details, null, 2)}
                  </pre>
                </div>
              </div>
              <div style={{ marginTop: 18 }}>
                <strong style={{ fontSize: '0.875rem' }}>History</strong>
                <div style={{ display: 'grid', gap: 9, marginTop: 10 }}>
                  {(selectedRequest.history || []).slice().reverse().map((entry, index) => (
                    <div key={`${entry.action}-${index}`} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10, fontSize: '0.78rem' }}>
                      <div><strong>{entry.action}</strong> · {entry.performedByName || 'System'}</div>
                      <div style={{ color: 'var(--text-muted)' }}>{formatDate(entry.performedAt)}{entry.comment ? ` · ${entry.comment}` : ''}</div>
                    </div>
                  ))}
                </div>
              </div>
              {isAdmin && ['Pending', 'Review'].includes(selectedRequest.status) && (
                <div style={{ marginTop: 18 }}>
                  <label className="form-label">Admin comment (optional)</label>
                  <textarea className="form-control" rows={2} maxLength={1000} value={comment} onChange={event => setComment(event.target.value)} />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <button className="btn btn-primary" disabled={reviewing} onClick={() => decide('Approved')}><Check size={14} /> Approve</button>
                    <button className="btn btn-danger" disabled={reviewing} onClick={() => decide('Rejected')}><X size={14} /> Reject</button>
                    <button className="btn btn-outline" disabled={reviewing} onClick={() => decide('Review')}><Clock3 size={14} /> Review</button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};

export default RequestCenter;
