import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Search, Eye, Plus, Pencil, Trash2, CheckCircle, XCircle,
  Printer, Download, AlertCircle, Wallet,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { advanceAPI } from '../../services/api';
import { filterRecords, toCsv } from '../../utils/recordFilters';
import Avatar from '../../components/shared/Avatar';
import Badge from '../../components/shared/Badge';
import Modal, { ConfirmModal } from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import SkeletonLoader from '../../components/shared/SkeletonLoader';
import { formatINR } from '../../utils/currency';
import toast from 'react-hot-toast';

const PAGE_SIZE = 10;

// Payment_Method options (Req 10.4).
const PAYMENT_METHOD_OPTIONS = ['Cash', 'UPI', 'Bank'];

// Advance_Status values (Req 10.6, 10.7). "Pending" is set on create; a status
// update control can move a record to "Settled/Returned" or "Salary Adjustment".
const STATUS_OPTIONS = ['Paid', 'Salary Adjustment', 'Settled/Returned'];

const recordId = (r) => (r?._id || r?.id || '').toString();
const shortId = (r) => recordId(r).slice(-8).toUpperCase();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const today = () => new Date().toISOString().slice(0, 10);
const newSubmissionKey = () => (window.crypto && typeof window.crypto.randomUUID === 'function'
  ? window.crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const emptyForm = {
  date: today(), amount: '', paymentMethod: 'Cash', reason: '',
};

const downloadSupportingDocument = async record => {
  try {
    const { data } = await advanceAPI.downloadDocument(recordId(record));
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = record.supportingDocument.name || 'advance-supporting-document';
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast.error(err.response?.data?.message || 'Unable to download supporting document.');
  }
};

const AdvanceRecords = () => {
  const {
    advanceRecords, addAdvance, updateAdvance, setAdvanceApproval, deleteAdvance,
  } = useApp();
  const { user, can } = useAuth();
  const isAdminUser = user?.role === 'Admin';
  const canAdd    = can('advances', 'add');
  const canApply = !isAdminUser && canAdd;
  const canEdit   = can('advances', 'edit');
  const canDelete = isAdminUser && can('advances', 'delete');

  // ── Local list state (skeleton + retain last data on error) ────────────────
  const [records, setRecords] = useState(advanceRecords);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Filters / pagination ──
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [employeeIdFilter, setEmployeeIdFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [page, setPage] = useState(1);

  // ── Modals ──
  const [viewRec, setViewRec] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editRec, setEditRec] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [submissionKey, setSubmissionKey] = useState(newSubmissionKey);
  const [supportingDocument, setSupportingDocument] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [statusModal, setStatusModal] = useState(null);
  const [statusValue, setStatusValue] = useState('');
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [approvalSaving, setApprovalSaving] = useState('');

  const canViewAll = isAdminUser;
  const fmtAmount = (n, code = 'INR') => formatINR(n, { currency: code });
  const sumByCurrency = list => Object.entries(list.reduce((totals, record) => {
    const code = record.currency || 'UNVERIFIED';
    totals[code] = (totals[code] || 0) + Number(record.amount || 0);
    return totals;
  }, {})).map(([code, amount]) => fmtAmount(amount, code)).join(' · ') || fmtAmount(0);

  // ── Load advance records with loading + error handling (Req 10.1, 17.1, 17.3)
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await advanceAPI.getAll();
      if (data.success) {
        setRecords(data.data);
      } else {
        throw new Error(data.message || 'Failed to load advance records');
      }
    } catch (err) {
      // Retain the last successfully loaded records.
      setError(err.response?.data?.message || err.message || 'Failed to load advance records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep local list in sync with context mutations (add/update/delete).
  useEffect(() => { setRecords(advanceRecords); }, [advanceRecords]);

  // ── Employee scoping (Req 10.2): employees only see their own records ───────
  const scoped = useMemo(() => {
    if (canViewAll) return records;
    const userId = String(user?._id || user?.id || '');
    return records.filter(record => userId && String(record.userId || '') === userId);
  }, [records, canViewAll, user]);

  // ── Filtering (Req 12.1) via shared selector; type field = paymentMethod ────
  const filtered = useMemo(() => {
    const list = filterRecords(
      scoped,
      { status: statusFilter, type: methodFilter },
      { nameField: 'employeeName', statusField: 'approvalStatus', typeField: 'paymentMethod' },
    );
    const query = search.trim().toLowerCase();
    return [...list].filter(record => (!query || [
      record.employeeName, record.employeeId, record.email, record.submittedByRole, record.reason, recordId(record),
    ].some(value => String(value || '').toLowerCase().includes(query)))
      && (!roleFilter || (record.submittedByRole || '') === roleFilter)
      && (!employeeIdFilter || String(record.employeeId || '').toLowerCase().includes(employeeIdFilter.toLowerCase()))
      && (!dateFilter || record.date === dateFilter))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [scoped, search, statusFilter, methodFilter, roleFilter, employeeIdFilter, dateFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Add / Edit ──────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditRec(null);
    setForm(emptyForm);
    setSubmissionKey(newSubmissionKey());
    setSupportingDocument(null);
    setFormErrors({});
    setFormOpen(true);
  };

  const openEdit = (rec) => {
    setEditRec(rec);
    setForm({
      date: rec.date || today(),
      amount: rec.amount != null ? String(rec.amount) : '',
      paymentMethod: rec.paymentMethod || 'Cash',
      reason: rec.reason || '',
    });
    setSupportingDocument(null);
    setFormErrors({});
    setFormOpen(true);
  };

  const setField = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setFormErrors(e => ({ ...e, [k]: '' }));
  };

  const validateForm = () => {
    const errs = {};
    if (!form.date) errs.date = 'Select a date';
    const amt = parseFloat(form.amount);
    if (form.amount === '' || Number.isNaN(amt)) {
      errs.amount = 'Enter an amount';
    } else if (amt <= 0) {
      // Amount must be greater than zero (Req 10.5).
      errs.amount = 'Amount must be greater than zero';
    }
    if (!form.paymentMethod) errs.paymentMethod = 'Select a payment method';
    if (!form.reason) errs.reason = 'Provide a reason';
    if (form.reason.length > 1000) errs.reason = 'Reason must be no more than 1000 characters';
    if (supportingDocument && supportingDocument.size > 5 * 1024 * 1024) errs.supportingDocument = 'Supporting document must be smaller than 5 MB';
    if (supportingDocument && !['application/pdf', 'image/jpeg', 'image/png'].includes(supportingDocument.type)) {
      errs.supportingDocument = 'Choose a PDF, PNG, or JPEG document';
    }
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validateForm();
    if (Object.keys(errs).length > 0) { setFormErrors(errs); return; }

    setSubmitting(true);
    try {
      const payload = {
        date: form.date,
        amount: parseFloat(form.amount),
        paymentMethod: form.paymentMethod,
        reason: form.reason,
        ...(!editRec ? { submissionKey } : {}),
        ...(supportingDocument ? {
          supportingDocument: {
            name: supportingDocument.name,
            mimeType: supportingDocument.type,
            data: await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(new Error('Unable to read the selected document.'));
              reader.readAsDataURL(supportingDocument);
            }),
          },
        } : {}),
      };
      if (editRec) {
        const result = await updateAdvance(recordId(editRec), payload);
        if (result?.warning) toast.error(result.warning);
        toast.success('Advance record updated');
      } else {
        const result = await addAdvance(payload);
        if (result?.warning) toast.error(result.warning);
        toast.success('Advance request submitted for approval');
      }
      setFormOpen(false);
      setForm(emptyForm);
      setSupportingDocument(null);
    } catch (err) {
      // Retain the user's entered values on backend error (Req 17.2).
      toast.error(err.response?.data?.message || err.message || 'Failed to save advance record');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Status update control (Req 10.7) ────────────────────────────────────────
  const openStatus = (rec) => {
    setStatusModal(rec);
    setStatusValue(STATUS_OPTIONS.includes(rec.status) ? rec.status : 'Paid');
    setRepaymentAmount(rec.repaymentAmount ? String(rec.repaymentAmount) : String(rec.outstandingBalance || rec.amount || ''));
  };

  const handleStatusSave = async () => {
    setStatusSaving(true);
    try {
      await updateAdvance(recordId(statusModal), {
        status: statusValue,
        ...(statusValue === 'Salary Adjustment' ? { repaymentAmount: Number(repaymentAmount) } : {}),
      });
      toast.success(`Status updated to ${statusValue}`);
      setStatusModal(null);
      setViewRec(null);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to update status');
    } finally {
      setStatusSaving(false);
    }
  };

  const handleApproval = async (record, approvalStatus) => {
    setApprovalSaving(recordId(record));
    try {
      const result = await setAdvanceApproval(recordId(record), approvalStatus);
      if (result?.warning) toast.error(result.warning);
      toast.success(`Advance request ${approvalStatus.toLowerCase()}`);
      if (viewRec && recordId(viewRec) === recordId(record)) setViewRec(result.data);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Unable to update advance approval.');
    } finally {
      setApprovalSaving('');
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAdvance(recordId(deleteTarget));
      toast.success('Advance record deleted');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete advance record');
    } finally {
      setDeleting(false);
    }
  };

  // ── Export (Req 12.2) — exports the currently filtered records ──────────────
  const handleExport = () => {
    const csv = toCsv(filtered, [
      { key: '_id', label: 'ID', accessor: shortId },
      { key: 'employeeName', label: 'Submitted By' },
      { key: 'employeeId', label: 'Employee ID' },
      { key: 'email', label: 'Email' },
      { key: 'submittedByRole', label: 'Role' },
      { key: 'date', label: 'Date' },
      { key: 'amount', label: 'Amount' },
      { key: 'currency', label: 'Currency' },
      { key: 'paymentMethod', label: 'Payment Method' },
      { key: 'approvalStatus', label: 'Approval Status' },
      { key: 'createdAt', label: 'Request Date' },
      { key: 'reason', label: 'Reason' },
    ]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `advance-records-${new Date().toISOString().slice(0, 10)}.csv`;
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
        <td>${shortId(r)}</td>
        <td>${escapeHtml(r.employeeName)}</td>
        <td>${escapeHtml(r.employeeId)}</td>
        <td>${escapeHtml(r.email)}</td>
        <td>${escapeHtml(r.submittedByRole)}</td>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(fmtAmount(r.amount, r.currency))}</td>
        <td>${escapeHtml(r.currency || 'UNVERIFIED')}</td>
        <td>${escapeHtml(r.paymentMethod)}</td>
        <td>${escapeHtml(r.reason)}</td>
        <td>${escapeHtml(r.approvalStatus || 'Pending Approval')}</td>
        <td>${r.createdAt ? escapeHtml(new Date(r.createdAt).toLocaleDateString()) : ''}</td>
      </tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) { toast.error('Unable to open print window'); return; }
    win.document.write(`
      <html>
        <head>
          <title>Advance Records</title>
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
          <h1>Advance Records</h1>
          <p>${filtered.length} record(s) · Generated ${new Date().toLocaleString()}</p>
          <table>
            <thead>
              <tr><th>ID</th><th>Submitted By</th><th>Employee ID</th><th>Email</th><th>Role</th><th>Date</th><th>Amount</th><th>Method</th><th>Reason</th><th>Approval</th><th>Request Date</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <script>window.onload = function () { window.print(); }</script>
        </body>
      </html>`);
    win.document.close();
  };

  const pendingCount = scoped.filter(r => (r.approvalStatus || 'Pending Approval') === 'Pending Approval').length;
  const totalAmount = sumByCurrency(scoped);

  if (loading) return <SkeletonLoader />;

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb"><span>Advances</span><span className="breadcrumb-sep">/</span><span>Advance Records</span></div>
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Advance Records</h1>
            <p className="page-subtitle">{pendingCount} pending advance{pendingCount === 1 ? '' : 's'}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={handlePrint} title="Print filtered records"><Printer size={14} /> Print</button>
            <button className="btn btn-outline" onClick={handleExport} title="Export filtered records"><Download size={14} /> Export</button>
            {canApply && <button className="btn btn-primary" onClick={openAdd}><Plus size={14} /> Apply Advance</button>}
          </div>
        </div>
      </div>

      {/* Error banner — shown alongside the retained last-loaded data */}
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
          { label: 'Total Advances', value: scoped.length, color: 'var(--primary)' },
          { label: 'Pending', value: pendingCount, color: 'var(--warning)' },
          { label: 'Total Amount', value: totalAmount, color: 'var(--success)' },
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
          <select className="form-control form-select" style={{ width: 180 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All Status</option>
            {['Pending Approval', 'Approved', 'Rejected'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="form-control form-select" style={{ width: 150 }} value={methodFilter} onChange={e => { setMethodFilter(e.target.value); setPage(1); }}>
            <option value="">All Methods</option>
            {PAYMENT_METHOD_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {isAdminUser && (
            <>
              <select className="form-control form-select" style={{ width: 140 }} value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(1); }}>
                <option value="">All Roles</option>
                {['Employee', 'HR', 'Manager', 'Admin'].map(role => <option key={role} value={role}>{role}</option>)}
              </select>
              <input className="form-control" style={{ width: 150 }} placeholder="Employee ID" value={employeeIdFilter} onChange={e => { setEmployeeIdFilter(e.target.value); setPage(1); }} />
              <input type="date" className="form-control" style={{ width: 160 }} aria-label="Filter by advance date" value={dateFilter} onChange={e => { setDateFilter(e.target.value); setPage(1); }} />
            </>
          )}
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th><th>Submitted By</th><th>Email / Role</th><th>Date</th><th>Amount</th>
              <th>Method</th><th>Reason</th><th>Request Date</th><th>Approval</th><th>Disbursement / Repayment</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(rec => (
              <tr key={recordId(rec)}>
                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{shortId(rec)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={rec.employeeName} size="sm" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{rec.employeeName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{rec.employeeId || 'No linked Employee ID'}</div>
                    </div>
                  </div>
                </td>
                <td style={{ fontSize: '0.8rem' }}>
                  <div>{rec.email || '—'}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{rec.submittedByRole || '—'}</div>
                </td>
                <td style={{ fontSize: '0.875rem' }}>{rec.date}</td>
                <td><span style={{ fontWeight: 600 }}>{fmtAmount(rec.amount, rec.currency)}</span></td>
                <td><span className="badge badge-info" style={{ fontSize: '0.75rem' }}>{rec.paymentMethod}</span></td>
                <td title={rec.reason || ''} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{rec.reason || '—'}</td>
                <td style={{ fontSize: '0.8rem' }}>{rec.createdAt ? new Date(rec.createdAt).toLocaleDateString() : '—'}</td>
                <td><Badge status={rec.approvalStatus || 'Pending Approval'} /></td>
                <td><Badge status={rec.status || 'Pending'} /></td>
                <td>
                  <div className="table-actions">
                    <button className="btn-icon primary" onClick={() => setViewRec(rec)} title="View Details"><Eye size={13} /></button>
                    {rec.approvalStatus === 'Pending Approval' && isAdminUser && (
                      <>
                        <button className="btn-icon" style={{ color: 'var(--success)', borderColor: 'var(--success-light)' }} onClick={() => handleApproval(rec, 'Approved')} title="Approve" disabled={approvalSaving === recordId(rec)}><CheckCircle size={13} /></button>
                        <button className="btn-icon danger" onClick={() => handleApproval(rec, 'Rejected')} title="Reject" disabled={approvalSaving === recordId(rec)}><XCircle size={13} /></button>
                      </>
                    )}
                    {canEdit && (isAdminUser || rec.approvalStatus === 'Pending Approval') && (
                      <>
                        <button className="btn-icon" onClick={() => openEdit(rec)} title="Edit"><Pencil size={13} /></button>
                        {isAdminUser && <button className="btn-icon" style={{ color: 'var(--success)', borderColor: 'var(--success-light)' }} onClick={() => openStatus(rec)} title="Update Status"><Wallet size={13} /></button>}
                      </>
                    )}
                    {canDelete && (
                      <button className="btn-icon danger" onClick={() => setDeleteTarget(rec)} title="Delete"><Trash2 size={13} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No advance records found</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={page} totalPages={totalPages} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {/* View Modal */}
      {viewRec && (
        <Modal open={true} onClose={() => setViewRec(null)} title="Advance Record Details" size="md"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setViewRec(null)}>Close</button>
              {viewRec.approvalStatus === 'Pending Approval' && isAdminUser && (
                <>
                  <button className="btn btn-success" onClick={() => handleApproval(viewRec, 'Approved')} disabled={approvalSaving === recordId(viewRec)}>Approve</button>
                  <button className="btn btn-danger" onClick={() => handleApproval(viewRec, 'Rejected')} disabled={approvalSaving === recordId(viewRec)}>Reject</button>
                </>
              )}
              {isAdminUser && canEdit && viewRec.approvalStatus === 'Approved' && (
                <button className="btn btn-primary" onClick={() => { openStatus(viewRec); }}>Update Status</button>
              )}
            </>
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '16px', background: 'var(--bg)', borderRadius: 10 }}>
            <Avatar name={viewRec.employeeName} size="lg" />
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>{viewRec.employeeName}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{viewRec.employeeId || 'No linked Employee ID'} · {viewRec.submittedByRole || '—'}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{viewRec.email || '—'}</div>
              <Badge status={viewRec.approvalStatus || 'Pending Approval'} style={{ marginTop: 4 }} />
            </div>
          </div>
          <div className="grid grid-2 grid-gap-sm">
            {[
              ['Record ID', shortId(viewRec)], ['User ID', viewRec.userId || '—'],
              ['Date', viewRec.date],
              ['Amount', fmtAmount(viewRec.amount, viewRec.currency)], ['Payment Method', viewRec.paymentMethod],
              ['Approval', viewRec.approvalStatus || 'Pending Approval'],
              ['Advance Status', viewRec.status || 'Pending'],
              ['Outstanding Balance', fmtAmount(viewRec.outstandingBalance == null ? viewRec.amount : viewRec.outstandingBalance, viewRec.currency)],
              ['Monthly Repayment', viewRec.repaymentAmount ? fmtAmount(viewRec.repaymentAmount, viewRec.currency) : 'Not scheduled'],
              ['Request Date', viewRec.createdAt ? new Date(viewRec.createdAt).toLocaleString() : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>{k}</div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{v}</div>
              </div>
            ))}
          </div>
          {viewRec.reason && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Reason</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, background: 'var(--bg)', borderRadius: 8, padding: 12 }}>{viewRec.reason}</p>
            </div>
          )}
          {viewRec.supportingDocument?.name && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Supporting Document</div>
              <button className="btn btn-outline btn-sm" onClick={() => downloadSupportingDocument(viewRec)}>
                <Download size={13} /> {viewRec.supportingDocument.name}
              </button>
            </div>
          )}
          {viewRec.repaymentHistory?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Repayment History</div>
              <div className="table-container"><table className="table"><thead><tr><th>Salary Period</th><th>Deducted</th><th>Remaining</th></tr></thead><tbody>
                {viewRec.repaymentHistory.map((repayment, index) => <tr key={`${repayment.payrollId || repayment.month}-${index}`}><td>{repayment.month} {repayment.year}</td><td>{fmtAmount(repayment.amount, viewRec.currency)}</td><td>{fmtAmount(repayment.remainingBalance, viewRec.currency)}</td></tr>)}
              </tbody></table></div>
            </div>
          )}
        </Modal>
      )}

      {/* Apply Advance Modal */}
      {formOpen && (
        <Modal open={true} onClose={() => setFormOpen(false)} title={editRec ? 'Edit Advance Request' : 'Apply Advance'} size="md"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setFormOpen(false)} disabled={submitting}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Saving...' : editRec ? 'Save Changes' : 'Submit Application'}
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Submitting Account</label>
              <div className="form-control" style={{ height: 'auto', minHeight: 40 }}>
                {user?.name || 'Authenticated user'} · {user?.role || 'Unknown role'}
                {user?.id ? ` · User ID: ${user.id}` : ''}
                {user?.employeeId ? ` · ${user.employeeId}` : ''}
                {user?.email ? ` · ${user.email}` : ''}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 16px' }}>
              <div className="form-group">
                <label className="form-label">Application Date <span className="required">*</span></label>
                <input type="date" className={`form-control ${formErrors.date ? 'error' : ''}`} value={form.date} onChange={e => setField('date', e.target.value)} />
                {formErrors.date && <div className="form-error">{formErrors.date}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Requested Amount <span className="required">*</span></label>
                <input type="number" min="0.01" step="0.01" className={`form-control ${formErrors.amount ? 'error' : ''}`} value={form.amount} onChange={e => setField('amount', e.target.value)} placeholder="0.00" />
                {formErrors.amount && <div className="form-error">{formErrors.amount}</div>}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Payment Method <span className="required">*</span></label>
              <select className={`form-control form-select ${formErrors.paymentMethod ? 'error' : ''}`} value={form.paymentMethod} onChange={e => setField('paymentMethod', e.target.value)}>
                {PAYMENT_METHOD_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              {formErrors.paymentMethod && <div className="form-error">{formErrors.paymentMethod}</div>}
            </div>
            <div className="form-group">
              <label className="form-label">Reason for Advance <span className="required">*</span></label>
              <textarea className={`form-control ${formErrors.reason ? 'error' : ''}`} rows={3} value={form.reason} onChange={e => setField('reason', e.target.value)} placeholder="Describe the reason for the advance..." />
              {formErrors.reason && <div className="form-error">{formErrors.reason}</div>}
            </div>
            <div className="form-group">
              <label className="form-label">Supporting Document (optional)</label>
              <input className={`form-control ${formErrors.supportingDocument ? 'error' : ''}`} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={event => {
                setSupportingDocument(event.target.files?.[0] || null);
                setFormErrors(current => ({ ...current, supportingDocument: '' }));
              }} />
              {formErrors.supportingDocument && <div className="form-error">{formErrors.supportingDocument}</div>}
            </div>
          </form>
        </Modal>
      )}

      {/* Status Update Modal (Req 10.7) */}
      {statusModal && (
        <Modal open={true} onClose={() => setStatusModal(null)} title="Update Advance Status" size="sm"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setStatusModal(null)} disabled={statusSaving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleStatusSave} disabled={statusSaving || !isAdminUser}>{statusSaving ? 'Saving...' : 'Save Status'}</button>
            </>
          }
        >
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 16 }}>Updating advance status for <strong>{statusModal?.employeeName}</strong> ({fmtAmount(statusModal?.amount, statusModal?.currency)})</p>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-control form-select" value={statusValue} onChange={e => setStatusValue(e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {statusValue === 'Salary Adjustment' && (
            <div className="form-group">
              <label className="form-label">Monthly Repayment Amount</label>
              <input className="form-control" type="number" min="0.01" max={statusModal?.outstandingBalance || statusModal?.amount} step="0.01" value={repaymentAmount} onChange={event => setRepaymentAmount(event.target.value)} required />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>Outstanding: {fmtAmount(statusModal?.outstandingBalance == null ? statusModal?.amount : statusModal?.outstandingBalance, statusModal?.currency)}</div>
            </div>
          )}
        </Modal>
      )}

      {/* Delete Confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Advance Record"
        message={`Are you sure you want to delete the advance record for ${deleteTarget?.employeeName || 'this employee'}? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
};

export default AdvanceRecords;
