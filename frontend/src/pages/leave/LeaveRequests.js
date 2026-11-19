import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Search, Eye, CheckCircle, XCircle, Trash2,
  Printer, Download, AlertCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { leaveAPI } from '../../services/api';
import { filterRecords, toCsv } from '../../utils/recordFilters';
import Avatar from '../../components/shared/Avatar';
import Badge from '../../components/shared/Badge';
import Modal, { ConfirmModal } from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import SkeletonLoader from '../../components/shared/SkeletonLoader';
import toast from 'react-hot-toast';

const PAGE_SIZE = 10;

const recordId = (r) => (r?._id || r?.id || '').toString();
const shortId = (r) => recordId(r).slice(-8).toUpperCase();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const LeaveRequests = () => {
  const { leaveRequests, updateLeaveStatus, cancelLeave } = useApp();
  const { user } = useAuth();

  // ── Local list state (so we can show skeleton + retain last data on error) ──
  const [records, setRecords] = useState(leaveRequests);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Filters / pagination ──
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  // ── Modals ──
  const [viewReq, setViewReq] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const canManage = ['Admin', 'HR'].includes(user?.role);
  const canManageAll = user?.role === 'Admin';

  // ── Load leave records with loading + error handling (Req 1.1, 1.7, 1.8) ────
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await leaveAPI.getAll();
      if (data.success) {
        setRecords(data.data);
      } else {
        throw new Error(data.message || 'Failed to load leave records');
      }
    } catch (err) {
      // Retain the last successfully loaded records (Req 1.8).
      setError(err.response?.data?.message || err.message || 'Failed to load leave records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep local list in sync with context mutations (add/approve/reject/cancel).
  useEffect(() => { setRecords(leaveRequests); }, [leaveRequests]);

  // ── Employee scoping (Req 1.2): employees only see their own records ────────
  const scoped = useMemo(() => {
    if (canManageAll) return records;
    return records.filter(r =>
      (user?._id && (r.userId === user._id || r.userId?.toString?.() === user._id)) ||
      (user?.id && r.userId === user.id) ||
      (user?.email && r.email === user.email)
    );
  }, [records, canManageAll, user]);

  // ── Filtering (Req 1.3, 1.4, 1.5) via shared selector; type field = leaveType
  const filtered = useMemo(() => {
    const list = filterRecords(
      scoped,
      { search, status: statusFilter, type: typeFilter },
      { nameField: 'employeeName', statusField: 'status', typeField: 'leaveType' },
    );
    return [...list].sort((a, b) => (b.appliedDate || '').localeCompare(a.appliedDate || ''));
  }, [scoped, search, statusFilter, typeFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const leaveTypes = useMemo(
    () => [...new Set(scoped.map(r => r.leaveType).filter(Boolean))],
    [scoped],
  );

  // ── Approve / reject ────────────────────────────────────────────────────────
  const handleApprove = async (id, name) => {
    try {
      await updateLeaveStatus(id, 'approved');
      toast.success(`Leave approved for ${name}`);
      setViewReq(null);
    } catch (err) {
      toast.error(err.message || 'Failed to approve leave');
    }
  };

  const handleReject = async () => {
    try {
      await updateLeaveStatus(recordId(rejectModal), 'rejected', rejectReason);
      toast.success(`Leave rejected for ${rejectModal.employeeName}`);
      setRejectModal(null);
      setRejectReason('');
      setViewReq(null);
    } catch (err) {
      toast.error(err.message || 'Failed to reject leave');
    }
  };

  // ── Delete (cancel) ─────────────────────────────────────────────────────────
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await cancelLeave(recordId(deleteTarget));
      toast.success(deleteTarget?.status === 'approved' ? 'Approved leave revoked' : 'Leave request cancelled');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err.message || 'Failed to cancel leave request');
    } finally {
      setDeleting(false);
    }
  };

  // ── Export (Req 12.2) — exports the currently filtered records ──────────────
  const handleExport = () => {
    const csv = toCsv(filtered, [
      { key: '_id', label: 'ID', accessor: shortId },
      { key: 'employeeName', label: 'Employee' },
      { key: 'department', label: 'Department' },
      { key: 'leaveType', label: 'Leave Type' },
      { key: 'paidStatus', label: 'Paid / Unpaid', accessor: r => r.paidStatus || (r.leaveType === 'Unpaid Leave' ? 'Unpaid' : 'Paid') },
      { key: 'startDate', label: 'From' },
      { key: 'endDate', label: 'To' },
      { key: 'days', label: 'Days' },
      { key: 'appliedDate', label: 'Applied' },
      { key: 'status', label: 'Status' },
      { key: 'reason', label: 'Reason' },
    ]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leave-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} record${filtered.length === 1 ? '' : 's'}`);
  };

  // ── Print (Req 12.3) — printable rendering of the currently filtered records ─
  const handlePrint = () => {
    const rows = filtered.map(r => `
      <tr>
        <td>${escapeHtml(shortId(r))}</td>
        <td>${escapeHtml(r.employeeName)}</td>
        <td>${escapeHtml(r.leaveType)}</td>
        <td>${escapeHtml(r.paidStatus || (r.leaveType === 'Unpaid Leave' ? 'Unpaid' : 'Paid'))}</td>
        <td>${escapeHtml(r.startDate)}</td>
        <td>${escapeHtml(r.endDate)}</td>
        <td>${escapeHtml(r.days)}</td>
        <td>${escapeHtml(r.appliedDate)}</td>
        <td>${escapeHtml(r.status)}</td>
      </tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) { toast.error('Unable to open print window'); return; }
    win.document.write(`
      <html>
        <head>
          <title>Leave Requests</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1 { font-size: 18px; margin-bottom: 4px; }
            p { color: #666; font-size: 12px; margin-top: 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; text-align: left; }
            th { background: #f3f4f6; }
          </style>
        </head>
        <body>
          <h1>Leave Requests</h1>
          <p>${filtered.length} record(s) · Generated ${new Date().toLocaleString()}</p>
          <table>
            <thead>
              <tr><th>ID</th><th>Employee</th><th>Leave Type</th><th>Category</th><th>From</th><th>To</th><th>Days</th><th>Applied</th><th>Status</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <script>window.onload = function () { window.print(); }</script>
        </body>
      </html>`);
    win.document.close();
  };

  const pendingCount = scoped.filter(r => r.status === 'pending').length;
  const canReviewRequest = request => canManage && !(
    (user?._id && String(request.userId) === String(user._id))
    || (user?.id && String(request.userId) === String(user.id))
  );

  if (loading) return <SkeletonLoader />;

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb"><span>Leave</span><span className="breadcrumb-sep">/</span><span>Leave Requests</span></div>
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Leave Requests</h1>
            <p className="page-subtitle">{pendingCount} pending request{pendingCount === 1 ? '' : 's'}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={handlePrint} title="Print filtered records"><Printer size={14} /> Print</button>
            <button className="btn btn-outline" onClick={handleExport} title="Export filtered records"><Download size={14} /> Export</button>
          </div>
        </div>
      </div>

      {/* Error banner — shown alongside the retained last-loaded data (Req 1.8) */}
      {error && (
        <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderLeft: '3px solid var(--danger)' }}>
          <AlertCircle size={16} color="var(--danger)" />
          <span style={{ fontSize: '0.85rem', color: 'var(--danger)', flex: 1 }}>{error}</span>
          <button className="btn btn-outline btn-sm" onClick={load}>Retry</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-3 grid-gap-sm mb-5">
        {[
          { label: 'Total Requests', value: scoped.length, color: 'var(--primary)' },
          { label: 'Pending', value: pendingCount, color: 'var(--warning)' },
          { label: 'Approved', value: scoped.filter(r => r.status === 'approved').length, color: 'var(--success)' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20, padding: '14px 20px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="search-input-wrapper" style={{ flex: 1, minWidth: 200 }}>
            <Search size={14} className="search-icon" />
            <input className="form-control" placeholder="Search by employee or ID..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <select className="form-control form-select" style={{ width: 140 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select className="form-control form-select" style={{ width: 160 }} value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">All Types</option>
            {leaveTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th><th>Employee</th><th>Leave Type</th><th>Category</th><th>From</th><th>To</th>
              <th>Days</th><th>Applied</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(req => (
              <tr key={recordId(req)}>
                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{shortId(req)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={req.employeeName} size="sm" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{req.employeeName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{req.department}</div>
                    </div>
                  </div>
                </td>
                <td><span className="badge badge-info" style={{ fontSize: '0.75rem' }}>{req.leaveType}</span></td>
                <td>{req.paidStatus || (req.leaveType === 'Unpaid Leave' ? 'Unpaid' : 'Paid')}</td>
                <td style={{ fontSize: '0.875rem' }}>{req.startDate}</td>
                <td style={{ fontSize: '0.875rem' }}>{req.endDate}</td>
                <td><span style={{ fontWeight: 600 }}>{req.days}</span></td>
                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{req.appliedDate}</td>
                <td><Badge status={req.status} /></td>
                <td>
                  <div className="table-actions">
                    <button className="btn-icon primary" onClick={() => setViewReq(req)} title="View Details"><Eye size={13} /></button>
                    {req.status === 'pending' && (
                      <>
                        {canReviewRequest(req) && (
                          <>
                            <button className="btn-icon" style={{ color: 'var(--success)', borderColor: 'var(--success-light)' }} onClick={() => handleApprove(recordId(req), req.employeeName)} title="Approve">
                              <CheckCircle size={13} />
                            </button>
                            <button className="btn-icon danger" onClick={() => setRejectModal(req)} title="Reject"><XCircle size={13} /></button>
                          </>
                        )}
                        {req.status === 'approved' && canManageAll && (
                          <button className="btn-icon danger" onClick={() => setDeleteTarget(req)} title="Revoke approved leave">
                            <Trash2 size={13} />
                          </button>
                        )}
                        {(
                          canManageAll
                          || (user?._id && String(req.userId) === String(user._id))
                          || (user?.id && String(req.userId) === String(user.id))
                          || (user?.email && req.email === user.email)
                        ) && (
                          <button className="btn-icon danger" onClick={() => setDeleteTarget(req)} title="Cancel request"><Trash2 size={13} /></button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No leave requests found</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={page} totalPages={totalPages} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {/* View Modal */}
      {viewReq && (
        <Modal open={true} onClose={() => setViewReq(null)} title="Leave Request Details" size="md"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setViewReq(null)}>Close</button>
              {viewReq.status === 'pending' && canReviewRequest(viewReq) && (
                <>
                  <button className="btn btn-danger" onClick={() => { setRejectModal(viewReq); setViewReq(null); }}>Reject</button>
                  <button className="btn btn-success" onClick={() => handleApprove(recordId(viewReq), viewReq.employeeName)}>Approve</button>
                </>
              )}
            </>
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '16px', background: 'var(--bg)', borderRadius: 10 }}>
            <Avatar name={viewReq.employeeName} size="lg" />
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>{viewReq.employeeName}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{viewReq.department}</div>
              <Badge status={viewReq.status} style={{ marginTop: 4 }} />
            </div>
          </div>
          <div className="grid grid-2 grid-gap-sm">
            {[
              ['Request ID', shortId(viewReq)], ['Leave Type', viewReq.leaveType],
              ['Leave Category', viewReq.paidStatus || (viewReq.leaveType === 'Unpaid Leave' ? 'Unpaid' : 'Paid')],
              ['Start Date', viewReq.startDate], ['End Date', viewReq.endDate],
              ['Number of Days', viewReq.days], ['Applied Date', viewReq.appliedDate],
            ].map(([k, v]) => (
              <div key={k} style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>{k}</div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{v}</div>
              </div>
            ))}
          </div>
          {viewReq.reason && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Reason</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, background: 'var(--bg)', borderRadius: 8, padding: 12 }}>{viewReq.reason}</p>
            </div>
          )}
          {viewReq.supportingDocument?.name && (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-outline btn-sm" onClick={async () => {
                try {
                  const { data } = await leaveAPI.downloadDocument(recordId(viewReq));
                  const url = URL.createObjectURL(data);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = viewReq.supportingDocument.name;
                  link.click();
                  URL.revokeObjectURL(url);
                } catch (err) {
                  toast.error(err.response?.data?.message || 'Unable to download supporting document.');
                }
              }}>
                <Download size={13} /> {viewReq.supportingDocument.name}
              </button>
            </div>
          )}
          {viewReq.history?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>Request History</div>
              {viewReq.history.map((item, index) => (
                <div key={`${item.action}-${item.performedAt}-${index}`} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  {item.action} by {item.performedByName || 'System'} · {item.performedAt ? new Date(item.performedAt).toLocaleString() : '—'}
                  {item.comment ? ` · ${item.comment}` : ''}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <Modal open={true} onClose={() => setRejectModal(null)} title="Reject Leave Request" size="sm"
          footer={<><button className="btn btn-outline" onClick={() => setRejectModal(null)}>Cancel</button><button className="btn btn-danger" onClick={handleReject}>Reject Leave</button></>}>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 16 }}>Rejecting leave request for <strong>{rejectModal?.employeeName}</strong></p>
          <div className="form-group">
            <label className="form-label">Rejection Reason</label>
            <textarea className="form-control" rows={3} placeholder="Provide a reason for rejection..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </div>
        </Modal>
      )}

      {/* Delete / Cancel Confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={deleteTarget?.status === 'approved' ? 'Revoke Approved Leave' : 'Cancel Leave Request'}
        message={deleteTarget?.status === 'approved'
          ? `Revoke the approved leave for ${deleteTarget?.employeeName || 'this employee'}? Attendance will be restored and the action recorded in history.`
          : `Cancel the pending leave request for ${deleteTarget?.employeeName || 'this employee'}? This action will be recorded in the request history.`}
        confirmLabel={deleteTarget?.status === 'approved' ? 'Revoke Leave' : 'Cancel Request'}
        loading={deleting}
      />
    </div>
  );
};

export default LeaveRequests;
