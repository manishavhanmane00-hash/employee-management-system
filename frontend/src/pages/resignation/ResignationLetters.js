import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Search, Eye, Plus, Pencil, Trash2, CheckCircle, XCircle,
  Download, AlertCircle, FileText, FileDown, Flag,
  ArrowRightCircle, ShieldCheck, CheckSquare, RotateCcw, Send,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { resignationAPI, employeeAPI } from '../../services/api';
import { toCsv } from '../../utils/recordFilters';
import { downloadElementPdf } from '../../utils/documentExport';
import Avatar from '../../components/shared/Avatar';
import Modal, { ConfirmModal } from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import SkeletonLoader from '../../components/shared/SkeletonLoader';
import toast from 'react-hot-toast';

const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  'Draft', 'Submitted', 'Manager Approved', 'Manager Rejected',
  'HR Approved', 'HR Rejected', 'Final Approved', 'Withdrawn', 'Completed',
];

const REASON_OPTIONS = [
  'Better Opportunity', 'Career Change', 'Relocation', 'Personal Reasons',
  'Health Reasons', 'Family Commitments', 'Higher Education', 'Retirement',
  'Dissatisfaction', 'End of Contract', 'Other',
];

const EXIT_STATUS_OPTIONS = ['Pending', 'In Progress', 'Cleared', 'Completed', 'On Hold'];
const CLEARANCE_OPTIONS = ['Pending', 'Cleared', 'Not Applicable'];
const CLEARANCE_KEYS = ['assets', 'accounts', 'documents', 'knowledgeTransfer'];
const CLEARANCE_LABELS = {
  assets: 'Asset Return', accounts: 'Account Handover', documents: 'Document Handover', knowledgeTransfer: 'Knowledge Transfer',
};

const recordId = (r) => (r?._id || r?.id || '').toString();
const today = () => new Date().toISOString().slice(0, 10);
const newSubmissionKey = () => (window.crypto && typeof window.crypto.randomUUID === 'function'
  ? window.crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const STATUS_BADGE = {
  'Draft': { cls: 'badge-gray', label: 'Draft' },
  'Submitted': { cls: 'badge-warning', label: 'Submitted' },
  'Manager Approved': { cls: 'badge-info', label: 'Manager Approved' },
  'Manager Rejected': { cls: 'badge-danger', label: 'Manager Rejected' },
  'HR Approved': { cls: 'badge-primary', label: 'HR Approved' },
  'HR Rejected': { cls: 'badge-danger', label: 'HR Rejected' },
  'Final Approved': { cls: 'badge-success', label: 'Final Approved' },
  'Withdrawn': { cls: 'badge-gray', label: 'Withdrawn' },
  'Completed': { cls: 'badge-success', label: 'Completed' },
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_BADGE[status] || { cls: 'badge-gray', label: status || '—' };
  return <span className={`badge ${cfg.cls}`}><span className="badge-dot" />{cfg.label}</span>;
};

const emptyForm = {
  submissionDate: today(),
  resignationReason: '',
  detailedExplanation: '',
  noticePeriod: '',
  proposedLastWorkingDay: '',
};

const ResignationLetters = () => {
  const { user, can } = useAuth();
  const role = user?.role;
  const isAdmin = role === 'Admin';
  const isHR = role === 'HR';
  const isManager = role === 'Manager';
  const canAdd = can('resignation', 'add');
  const canManage = can('resignation', 'manage');
  const canDelete = isAdmin && can('resignation', 'delete');
  const canEdit = can('resignation', 'edit');

  // ── Data ──
  const [records, setRecords] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Profile (auto-fetch employee details for the form) ──
  const [profile, setProfile] = useState(null);

  // ── Filters / pagination ──
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [exitFilter, setExitFilter] = useState('');
  const [page, setPage] = useState(1);

  // ── Modals ──
  const [viewRec, setViewRec] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editRec, setEditRec] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [submissionKey, setSubmissionKey] = useState(newSubmissionKey());
  const [attachment, setAttachment] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Review modal (shared: manager / hr / finalize / complete / withdraw)
  const [reviewModal, setReviewModal] = useState(null); // { record, kind }
  const [reviewDecision, setReviewDecision] = useState('approve');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewExtra, setReviewExtra] = useState({}); // lastWorkingDay / noticePeriod for hr
  const [reviewSaving, setReviewSaving] = useState(false);

  // Exit management modal (HR/Admin)
  const [exitModal, setExitModal] = useState(null);
  const [exitForm, setExitForm] = useState({ noticePeriod: '', lastWorkingDay: '', exitStatus: 'Pending', clearance: {}, exitRemarks: '' });
  const [exitSaving, setExitSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const tableRef = useRef(null);

  // ── Load records + stats ──
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [{ data: listRes }, { data: statsRes }] = await Promise.all([
        resignationAPI.getAll(),
        resignationAPI.getStats().catch(() => ({ data: { success: false } })),
      ]);
      if (listRes.success) {
        setRecords(listRes.data);
      } else {
        throw new Error(listRes.message || 'Failed to load resignation records');
      }
      if (statsRes.success) setStats(statsRes.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load resignation records');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const { data } = await employeeAPI.getMe();
      if (data.success && data.data) setProfile(data.data);
    } catch { /* non-employees may have no profile; ignore */ }
  }, []);

  useEffect(() => { load(); loadProfile(); }, [load, loadProfile]);

  // ── Filtering ──
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...records].filter(record => {
      const matchesQuery = !query || [
        record.employeeName, record.employeeId, record.department, record.designation,
        record.reportingManager, record.resignationReason, record.email,
      ].some(value => String(value || '').toLowerCase().includes(query));
      const matchesStatus = !statusFilter || record.status === statusFilter;
      const matchesDept = !departmentFilter || String(record.department || '').toLowerCase().includes(departmentFilter.toLowerCase());
      const matchesExit = !exitFilter || record.exitStatus === exitFilter;
      return matchesQuery && matchesStatus && matchesDept && matchesExit;
    }).sort((a, b) => (b.submissionDate || '').localeCompare(a.submissionDate || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [records, search, statusFilter, departmentFilter, exitFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Departments available for the department filter (admin/HR only).
  const departments = useMemo(() => {
    const set = new Set(records.map(r => r.department).filter(Boolean));
    return Array.from(set).sort();
  }, [records]);

  // ── Form handlers ──
  const openAdd = () => {
    setEditRec(null);
    setForm({ ...emptyForm, submissionDate: today() });
    setSubmissionKey(newSubmissionKey());
    setAttachment(null);
    setFormErrors({});
    setFormOpen(true);
  };

  const openEdit = (rec) => {
    setEditRec(rec);
    setForm({
      submissionDate: rec.submissionDate || today(),
      resignationReason: rec.resignationReason || '',
      detailedExplanation: rec.detailedExplanation || '',
      noticePeriod: rec.noticePeriod || '',
      proposedLastWorkingDay: rec.proposedLastWorkingDay || '',
    });
    setAttachment(null);
    setFormErrors({});
    setFormOpen(true);
  };

  const setField = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setFormErrors(e => ({ ...e, [k]: '' }));
  };

  const onAttachmentChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) { setAttachment(null); return; }
    if (file.size > 5 * 1024 * 1024) {
      setFormErrors(er => ({ ...er, attachment: 'Attachment must be smaller than 5 MB' }));
      e.target.value = '';
      return;
    }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
      setFormErrors(er => ({ ...er, attachment: 'Choose a PDF, PNG, or JPEG file' }));
      e.target.value = '';
      return;
    }
    setFormErrors(er => ({ ...er, attachment: '' }));
    setAttachment(file);
  };

  const validateForm = (draft) => {
    const errs = {};
    if (!form.submissionDate) errs.submissionDate = 'Select a submission date';
    if (!draft) {
      if (!form.resignationReason) errs.resignationReason = 'Select a resignation reason';
      if (form.resignationReason.length > 200) errs.resignationReason = 'Reason must be no more than 200 characters';
      if (form.detailedExplanation.length > 5000) errs.detailedExplanation = 'Detailed explanation must be no more than 5000 characters';
      if (form.proposedLastWorkingDay && !/^\d{4}-\d{2}-\d{2}$/.test(form.proposedLastWorkingDay)) errs.proposedLastWorkingDay = 'Enter a valid date';
    }
    if (form.noticePeriod.length > 100) errs.noticePeriod = 'Notice period must be no more than 100 characters';
    return errs;
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });

  const handleSubmit = async (e, draft = false) => {
    if (e) e.preventDefault();
    const errs = validateForm(draft);
    if (Object.keys(errs).length > 0) { setFormErrors(errs); return; }
    setSubmitting(true);
    try {
      const payload = {
        submissionDate: form.submissionDate,
        resignationReason: form.resignationReason,
        detailedExplanation: form.detailedExplanation,
        noticePeriod: form.noticePeriod,
        proposedLastWorkingDay: form.proposedLastWorkingDay,
        saveAsDraft: draft,
        ...(!editRec ? { submissionKey } : {}),
        ...(attachment ? {
          attachment: {
            name: attachment.name,
            mimeType: attachment.type,
            data: await readFileAsDataUrl(attachment),
          },
        } : {}),
      };
      if (editRec) {
        const { data } = await resignationAPI.update(recordId(editRec), payload);
        if (!data.success) throw new Error(data.message);
        toast.success('Resignation updated');
      } else {
        const { data } = await resignationAPI.create(payload);
        if (!data.success) throw new Error(data.message);
        toast.success(draft ? 'Resignation saved as draft' : 'Resignation submitted');
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to save resignation');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Workflow actions ──
  const openReview = (record, kind, decision = 'approve') => {
    setReviewModal({ record, kind });
    setReviewDecision(decision);
    setReviewComment('');
    setReviewExtra({ lastWorkingDay: record.lastWorkingDay || record.proposedLastWorkingDay || '', noticePeriod: record.noticePeriod || '' });
  };

  const handleReview = async () => {
    const { record, kind } = reviewModal;
    setReviewSaving(true);
    try {
      const comment = reviewComment.trim();
      let res;
      if (kind === 'manager') {
        res = await resignationAPI.managerReview(recordId(record), { decision: reviewDecision, comment });
      } else if (kind === 'hr') {
        res = await resignationAPI.hrReview(recordId(record), {
          decision: reviewDecision, comment,
          lastWorkingDay: reviewExtra.lastWorkingDay || undefined,
          noticePeriod: reviewExtra.noticePeriod || undefined,
        });
      } else if (kind === 'finalize') {
        res = await resignationAPI.finalize(recordId(record), { comment });
      } else if (kind === 'complete') {
        res = await resignationAPI.complete(recordId(record), { comment });
      } else if (kind === 'withdraw') {
        res = await resignationAPI.withdraw(recordId(record), { reason: comment });
      } else if (kind === 'submit') {
        res = await resignationAPI.submit(recordId(record));
      }
      const data = res.data;
      if (!data.success) throw new Error(data.message);
      toast.success(kind === 'submit' ? 'Resignation submitted' : kind === 'withdraw' ? 'Resignation withdrawn' : 'Action completed');
      setReviewModal(null);
      if (viewRec && recordId(viewRec) === recordId(record)) setViewRec(data.data);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Action failed');
    } finally {
      setReviewSaving(false);
    }
  };

  // ── Exit management ──
  const openExit = (record) => {
    setExitModal(record);
    setExitForm({
      noticePeriod: record.noticePeriod || '',
      lastWorkingDay: record.lastWorkingDay || record.proposedLastWorkingDay || '',
      exitStatus: record.exitStatus || 'Pending',
      clearance: { ...record.clearance } || {},
      exitRemarks: record.exitRemarks || '',
    });
  };

  const handleExitSave = async () => {
    setExitSaving(true);
    try {
      const { data } = await resignationAPI.update(recordId(exitModal), {
        noticePeriod: exitForm.noticePeriod,
        lastWorkingDay: exitForm.lastWorkingDay,
        exitStatus: exitForm.exitStatus,
        clearance: exitForm.clearance,
        exitRemarks: exitForm.exitRemarks,
      });
      if (!data.success) throw new Error(data.message);
      toast.success('Exit formalities updated');
      setExitModal(null);
      if (viewRec && recordId(viewRec) === recordId(exitModal)) setViewRec(data.data);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to update exit formalities');
    } finally {
      setExitSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { data } = await resignationAPI.delete(recordId(deleteTarget));
      if (!data.success) throw new Error(data.message);
      toast.success('Resignation record deleted');
      setDeleteTarget(null);
      setViewRec(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete record');
    } finally {
      setDeleting(false);
    }
  };

  const downloadAttachment = async (record) => {
    try {
      const { data } = await resignationAPI.downloadAttachment(recordId(record));
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = record.attachment?.name || 'resignation-attachment';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Unable to download attachment.');
    }
  };

  // ── Export (CSV + PDF) — reflects the currently filtered records ──
  const handleExportCsv = () => {
    const csv = toCsv(filtered, [
      { key: 'employeeId', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee Name' },
      { key: 'department', label: 'Department' },
      { key: 'designation', label: 'Designation' },
      { key: 'reportingManager', label: 'Reporting Manager' },
      { key: 'submissionDate', label: 'Submission Date' },
      { key: 'noticePeriod', label: 'Notice Period' },
      { key: 'proposedLastWorkingDay', label: 'Proposed Last Working Day' },
      { key: 'lastWorkingDay', label: 'Last Working Day' },
      { key: 'status', label: 'Status' },
      { key: 'managerComment', label: 'Manager Remarks' },
      { key: 'hrComment', label: 'HR Remarks' },
      { key: 'exitStatus', label: 'Exit Status' },
      { key: 'resignationReason', label: 'Resignation Reason' },
    ]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resignation-records-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} record${filtered.length === 1 ? '' : 's'}`);
  };

  const handleExportPdf = async () => {
    if (!tableRef.current) { toast.error('Nothing to export'); return; }
    try {
      await downloadElementPdf(tableRef.current, `resignation-records-${new Date().toISOString().slice(0, 10)}.pdf`, {
        jsPDF: { orientation: 'landscape' },
      });
      toast.success('PDF exported');
    } catch (err) {
      toast.error(err.message || 'PDF export failed');
    }
  };

  // ── Capability flags for a given record ──
  const isOwner = (record) => !!record && (
    String(record.userId || '') === String(user?._id || user?.id || '')
    || record.employeeId === user?.employeeId
    || (record.email && record.email === user?.email)
  );

  const canEditRecord = (record) => {
    if (!record) return false;
    if (isAdmin || isHR) return true; // HR/Admin can update (exit fields / pre-review core)
    if (isOwner(record) && canEdit && ['Draft', 'Submitted'].includes(record.status)) return true;
    return false;
  };

  const canWithdraw = (record) => isOwner(record) && ['Draft', 'Submitted'].includes(record.status);
  const canSubmitDraft = (record) => isOwner(record) && record.status === 'Draft';
  const canManagerReview = (record) => canManage && (isManager || isAdmin) && record.status === 'Submitted' && !isOwner(record);
  const canHrReview = (record) => canManage && (isHR || isAdmin) && record.status === 'Manager Approved';
  const canFinalize = (record) => canManage && (isHR || isAdmin) && record.status === 'HR Approved';
  const canComplete = (record) => canManage && (isHR || isAdmin) && record.status === 'Final Approved';
  const canManageExit = (record) => (isHR || isAdmin) && ['Manager Approved', 'HR Approved', 'Final Approved', 'Completed'].includes(record.status);

  const showDashboard = isAdmin || isHR;
  const showExportButtons = isAdmin || isHR || isManager;

  if (loading) return <SkeletonLoader />;

  const reviewModalTitle = () => {
    if (!reviewModal) return '';
    const { kind, record } = reviewModal;
    const name = record.employeeName || record.employeeId;
    if (kind === 'manager') return `Manager Review — ${name}`;
    if (kind === 'hr') return `HR Review — ${name}`;
    if (kind === 'finalize') return `Final Approval — ${name}`;
    if (kind === 'complete') return `Complete Exit — ${name}`;
    if (kind === 'withdraw') return `Withdraw Resignation — ${name}`;
    if (kind === 'submit') return `Submit Resignation — ${name}`;
    return '';
  };

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb"><span>Employee Management</span><span className="breadcrumb-sep">/</span><span>Resignation Letter</span></div>
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Resignation Letter</h1>
            <p className="page-subtitle">
              {showDashboard ? 'Manage all employee resignations' : isManager ? 'Review resignations submitted by your team' : 'Submit and track your resignation'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {showExportButtons && <button className="btn btn-outline" onClick={handleExportPdf} title="Export filtered records to PDF"><FileDown size={14} /> PDF</button>}
            {showExportButtons && <button className="btn btn-outline" onClick={handleExportCsv} title="Export filtered records to Excel/CSV"><Download size={14} /> Export</button>}
            {canAdd && <button className="btn btn-primary" onClick={openAdd}><Plus size={14} /> New Resignation</button>}
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderLeft: '3px solid var(--danger)' }}>
          <AlertCircle size={16} color="var(--danger)" />
          <span style={{ fontSize: '0.85rem', color: 'var(--danger)', flex: 1 }}>{error}</span>
          <button className="btn btn-outline btn-sm" onClick={load}>Retry</button>
        </div>
      )}

      {/* Admin / HR dashboard stats */}
      {showDashboard && stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 20 }}>
          {[
            { label: 'Total Requests', value: stats.total, color: 'var(--primary)', icon: FileText },
            { label: 'Pending', value: stats.pending, color: 'var(--warning)', icon: AlertCircle },
            { label: 'Manager Approved', value: stats.managerApproved, color: 'var(--info, #2563eb)', icon: CheckCircle },
            { label: 'HR Approved', value: stats.hrApproved, color: 'var(--primary)', icon: ShieldCheck },
            { label: 'Final Approved', value: stats.finalApproved, color: 'var(--success)', icon: Flag },
            { label: 'Rejected', value: stats.rejected, color: 'var(--danger)', icon: XCircle },
            { label: 'Completed', value: stats.completed, color: 'var(--success)', icon: CheckSquare },
            { label: 'Withdrawn', value: stats.withdrawn, color: 'var(--text-muted)', icon: RotateCcw },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{s.label}</div>
                </div>
                <s.icon size={20} color={s.color} style={{ opacity: 0.5 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20, padding: '14px 20px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="search-input-wrapper" style={{ flex: 1, minWidth: 200 }}>
            <Search size={14} className="search-icon" />
            <input className="form-control" placeholder="Search by employee, department, manager..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <select className="form-control form-select" style={{ width: 180 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All Status</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {showDashboard && (
            <select className="form-control form-select" style={{ width: 170 }} value={departmentFilter} onChange={e => { setDepartmentFilter(e.target.value); setPage(1); }}>
              <option value="">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {showDashboard && (
            <select className="form-control form-select" style={{ width: 160 }} value={exitFilter} onChange={e => { setExitFilter(e.target.value); setPage(1); }}>
              <option value="">All Exit Status</option>
              {EXIT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="table" ref={tableRef}>
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Employee Name</th>
              <th>Department</th>
              <th>Designation</th>
              <th>Reporting Manager</th>
              <th>Submission Date</th>
              <th>Last Working Day</th>
              <th>Status</th>
              <th>Manager Remarks</th>
              <th>HR Remarks</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(rec => (
              <tr key={recordId(rec)}>
                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{rec.employeeId || '—'}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={rec.employeeName} size="sm" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{rec.employeeName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{rec.submittedByRole || rec.email || '—'}</div>
                    </div>
                  </div>
                </td>
                <td style={{ fontSize: '0.85rem' }}>{rec.department || '—'}</td>
                <td style={{ fontSize: '0.85rem' }}>{rec.designation || '—'}</td>
                <td style={{ fontSize: '0.85rem' }}>{rec.reportingManager || '—'}</td>
                <td style={{ fontSize: '0.85rem' }}>{rec.submissionDate || '—'}</td>
                <td style={{ fontSize: '0.85rem' }}>{rec.lastWorkingDay || rec.proposedLastWorkingDay || '—'}</td>
                <td><StatusBadge status={rec.status} /></td>
                <td title={rec.managerComment || ''} style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{rec.managerComment || '—'}</td>
                <td title={rec.hrComment || ''} style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{rec.hrComment || '—'}</td>
                <td>
                  <div className="table-actions">
                    <button className="btn-icon primary" onClick={() => setViewRec(rec)} title="View Details"><Eye size={13} /></button>
                    {canSubmitDraft(rec) && <button className="btn-icon" style={{ color: 'var(--primary)', borderColor: 'var(--border)' }} onClick={() => openReview(rec, 'submit')} title="Submit"><Send size={13} /></button>}
                    {canEditRecord(rec) && <button className="btn-icon" onClick={() => openEdit(rec)} title="Edit"><Pencil size={13} /></button>}
                    {canManagerReview(rec) && (
                      <>
                        <button className="btn-icon" style={{ color: 'var(--success)', borderColor: 'var(--success-light)' }} onClick={() => openReview(rec, 'manager', 'approve')} title="Manager Approve"><CheckCircle size={13} /></button>
                        <button className="btn-icon danger" onClick={() => openReview(rec, 'manager', 'reject')} title="Manager Reject"><XCircle size={13} /></button>
                      </>
                    )}
                    {canHrReview(rec) && (
                      <>
                        <button className="btn-icon" style={{ color: 'var(--success)', borderColor: 'var(--success-light)' }} onClick={() => openReview(rec, 'hr', 'approve')} title="HR Approve"><ShieldCheck size={13} /></button>
                        <button className="btn-icon danger" onClick={() => openReview(rec, 'hr', 'reject')} title="HR Reject"><XCircle size={13} /></button>
                      </>
                    )}
                    {canFinalize(rec) && <button className="btn-icon" style={{ color: 'var(--success)', borderColor: 'var(--success-light)' }} onClick={() => openReview(rec, 'finalize')} title="Final Approval"><Flag size={13} /></button>}
                    {canComplete(rec) && <button className="btn-icon" style={{ color: 'var(--success)', borderColor: 'var(--success-light)' }} onClick={() => openReview(rec, 'complete')} title="Complete Exit"><CheckSquare size={13} /></button>}
                    {canManageExit(rec) && <button className="btn-icon" onClick={() => openExit(rec)} title="Manage Exit Formalities"><ArrowRightCircle size={13} /></button>}
                    {canWithdraw(rec) && <button className="btn-icon" style={{ color: 'var(--warning)' }} onClick={() => openReview(rec, 'withdraw')} title="Withdraw"><RotateCcw size={13} /></button>}
                    {canDelete && <button className="btn-icon danger" onClick={() => setDeleteTarget(rec)} title="Delete"><Trash2 size={13} /></button>}
                  </div>
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                {records.length === 0 ? 'No resignation records yet' : 'No records match your filters'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={page} totalPages={totalPages} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {/* ── View Modal ── */}
      {viewRec && (
        <Modal open={true} onClose={() => setViewRec(null)} title="Resignation Details" size="lg"
          footer={<button className="btn btn-outline" onClick={() => setViewRec(null)}>Close</button>}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: 16, background: 'var(--bg)', borderRadius: 10 }}>
            <Avatar name={viewRec.employeeName} size="lg" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>{viewRec.employeeName}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                {viewRec.employeeId || 'No Employee ID'} · {viewRec.designation || '—'} · {viewRec.department || '—'}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{viewRec.email || '—'} · Reporting Manager: {viewRec.reportingManager || '—'}</div>
            </div>
            <StatusBadge status={viewRec.status} />
          </div>

          <div className="grid grid-2" style={{ gap: 12 }}>
            {[
              ['Submission Date', viewRec.submissionDate || '—'],
              ['Resignation Reason', viewRec.resignationReason || '—'],
              ['Notice Period', viewRec.noticePeriod || '—'],
              ['Proposed Last Working Day', viewRec.proposedLastWorkingDay || '—'],
              ['Confirmed Last Working Day', viewRec.lastWorkingDay || '—'],
              ['Exit Status', viewRec.exitStatus || 'Pending'],
              ['Submitted By Role', viewRec.submittedByRole || '—'],
              ['Manager Reviewer', viewRec.managerReviewerName || '—'],
              ['Manager Reviewed At', viewRec.managerReviewedAt ? new Date(viewRec.managerReviewedAt).toLocaleString() : '—'],
              ['HR Reviewer', viewRec.hrReviewerName || '—'],
              ['HR Reviewed At', viewRec.hrReviewedAt ? new Date(viewRec.hrReviewedAt).toLocaleString() : '—'],
              ['Finalized At', viewRec.finalizedAt ? new Date(viewRec.finalizedAt).toLocaleString() : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>{k}</div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{v}</div>
              </div>
            ))}
          </div>

          {viewResignationReasonBlock(viewRec)}

          {viewRec.managerComment && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Manager Remarks</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, background: 'var(--bg)', borderRadius: 8, padding: 12 }}>{viewRec.managerComment}</p>
            </div>
          )}
          {viewRec.hrComment && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>HR Remarks</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, background: 'var(--bg)', borderRadius: 8, padding: 12 }}>{viewRec.hrComment}</p>
            </div>
          )}
          {viewRec.exitRemarks && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Exit Remarks</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, background: 'var(--bg)', borderRadius: 8, padding: 12 }}>{viewRec.exitRemarks}</p>
            </div>
          )}

          {/* Clearance checklist */}
          {(isHR || isAdmin) && viewRec.clearance && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Clearance Status</div>
              <div className="grid grid-2" style={{ gap: 8 }}>
                {CLEARANCE_KEYS.map(k => (
                  <div key={k} style={{ background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem' }}>
                    {CLEARANCE_LABELS[k]}: <strong>{viewRec.clearance[k] || 'Pending'}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {viewRec.attachment?.name && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Attachment</div>
              <button className="btn btn-outline btn-sm" onClick={() => downloadAttachment(viewRec)}>
                <Download size={13} /> {viewRec.attachment.name}
              </button>
            </div>
          )}

          {/* Approval / audit history timeline */}
          {viewRec.history?.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 10 }}>Approval History</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[...viewRec.history].reverse().map((h, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--primary)', marginTop: 4, flexShrink: 0 }} />
                    <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 14px', flex: 1 }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{h.action} · <StatusBadge status={h.status} /></div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        {h.performedByName || 'System'} {h.performedByRole ? `(${h.performedByRole})` : ''} · {h.performedAt ? new Date(h.performedAt).toLocaleString() : '—'}
                      </div>
                      {h.comment && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>{h.comment}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inline action buttons in view modal */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20, justifyContent: 'flex-end' }}>
            {canSubmitDraft(viewRec) && <button className="btn btn-primary" onClick={() => openReview(viewRec, 'submit')}><Send size={14} /> Submit</button>}
            {canEditRecord(viewRec) && <button className="btn btn-outline" onClick={() => { setViewRec(null); openEdit(viewRec); }}><Pencil size={14} /> Edit</button>}
            {canWithdraw(viewRec) && <button className="btn btn-outline" style={{ color: 'var(--warning)' }} onClick={() => openReview(viewRec, 'withdraw')}><RotateCcw size={14} /> Withdraw</button>}
            {canManagerReview(viewRec) && <>
              <button className="btn btn-success" onClick={() => openReview(viewRec, 'manager', 'approve')}><CheckCircle size={14} /> Approve</button>
              <button className="btn btn-danger" onClick={() => openReview(viewRec, 'manager', 'reject')}><XCircle size={14} /> Reject</button>
            </>}
            {canHrReview(viewRec) && <>
              <button className="btn btn-success" onClick={() => openReview(viewRec, 'hr', 'approve')}><ShieldCheck size={14} /> Approve</button>
              <button className="btn btn-danger" onClick={() => openReview(viewRec, 'hr', 'reject')}><XCircle size={14} /> Reject</button>
            </>}
            {canFinalize(viewRec) && <button className="btn btn-success" onClick={() => openReview(viewRec, 'finalize')}><Flag size={14} /> Final Approval</button>}
            {canComplete(viewRec) && <button className="btn btn-success" onClick={() => openReview(viewRec, 'complete')}><CheckSquare size={14} /> Complete Exit</button>}
            {canManageExit(viewRec) && <button className="btn btn-primary" onClick={() => { setViewRec(null); openExit(viewRec); }}><ArrowRightCircle size={14} /> Manage Exit</button>}
          </div>
        </Modal>
      )}

      {/* ── Create / Edit Form Modal ── */}
      {formOpen && (
        <Modal open={true} onClose={() => setFormOpen(false)} title={editRec ? 'Edit Resignation' : 'New Resignation Letter'} size="md"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setFormOpen(false)} disabled={submitting}>Cancel</button>
              {!editRec && <button className="btn btn-outline" onClick={(e) => handleSubmit(e, true)} disabled={submitting} title="Save without submitting">Save Draft</button>}
              <button className="btn btn-primary" onClick={(e) => handleSubmit(e, false)} disabled={submitting}>
                {submitting ? 'Saving...' : editRec ? 'Save Changes' : 'Submit'}
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmit}>
            {/* Auto-fetched employee details (read-only) */}
            <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 8, color: 'var(--text-secondary)' }}>Employee Details (auto-fetched)</div>
              <div className="grid grid-2" style={{ gap: 10 }}>
                <ReadOnlyField label="Employee ID" value={profile?.employeeId || user?.employeeId || '—'} />
                <ReadOnlyField label="Employee Name" value={profile?.name || user?.name || '—'} />
                <ReadOnlyField label="Department" value={profile?.department || user?.department || '—'} />
                <ReadOnlyField label="Designation" value={profile?.designation || profile?.position || user?.designation || '—'} />
                <ReadOnlyField label="Reporting Manager" value={profile?.manager || '—'} />
                <ReadOnlyField label="Status" value={editRec ? editRec.status : 'Submitted'} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Resignation Submission Date *</label>
              <input type="date" className="form-control" value={form.submissionDate} onChange={e => setField('submissionDate', e.target.value)} />
              {formErrors.submissionDate && <div className="form-error">{formErrors.submissionDate}</div>}
            </div>

            <div className="form-group">
              <label className="form-label">Resignation Reason *</label>
              <select className="form-control form-select" value={form.resignationReason} onChange={e => setField('resignationReason', e.target.value)}>
                <option value="">Select a reason</option>
                {REASON_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              {formErrors.resignationReason && <div className="form-error">{formErrors.resignationReason}</div>}
            </div>

            <div className="form-group">
              <label className="form-label">Detailed Explanation</label>
              <textarea className="form-control" rows={4} placeholder="Provide more details about your resignation..." value={form.detailedExplanation} onChange={e => setField('detailedExplanation', e.target.value)} maxLength={5000} />
              {formErrors.detailedExplanation && <div className="form-error">{formErrors.detailedExplanation}</div>}
            </div>

            <div className="grid grid-2" style={{ gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Notice Period</label>
                <input className="form-control" placeholder="e.g. 30 days" value={form.noticePeriod} onChange={e => setField('noticePeriod', e.target.value)} />
                {formErrors.noticePeriod && <div className="form-error">{formErrors.noticePeriod}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Proposed Last Working Day</label>
                <input type="date" className="form-control" value={form.proposedLastWorkingDay} onChange={e => setField('proposedLastWorkingDay', e.target.value)} />
                {formErrors.proposedLastWorkingDay && <div className="form-error">{formErrors.proposedLastWorkingDay}</div>}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Attachment (optional)</label>
              <input type="file" className="form-control" accept="application/pdf,image/jpeg,image/png" onChange={onAttachmentChange} />
              {formErrors.attachment && <div className="form-error">{formErrors.attachment}</div>}
              {editRec?.attachment?.name && !attachment && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>Current: {editRec.attachment.name}</div>
              )}
            </div>
          </form>
        </Modal>
      )}

      {/* ── Review / action Modal ── */}
      {reviewModal && (
        <Modal open={true} onClose={() => setReviewModal(null)} title={reviewModalTitle()} size="sm"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setReviewModal(null)} disabled={reviewSaving}>Cancel</button>
              <button className={`btn ${reviewDecision === 'reject' || reviewModal.kind === 'withdraw' ? 'btn-danger' : 'btn-success'}`} onClick={handleReview} disabled={reviewSaving}>
                {reviewSaving ? 'Processing...' : confirmLabel(reviewModal, reviewDecision)}
              </button>
            </>
          }
        >
          {reviewModal.kind === 'manager' || reviewModal.kind === 'hr' ? (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button className={`btn ${reviewDecision === 'approve' ? 'btn-success' : 'btn-outline'}`} onClick={() => setReviewDecision('approve')} style={{ flex: 1 }}>Approve</button>
              <button className={`btn ${reviewDecision === 'reject' ? 'btn-danger' : 'btn-outline'}`} onClick={() => setReviewDecision('reject')} style={{ flex: 1 }}>Reject</button>
            </div>
          ) : null}
          {reviewModal.kind === 'hr' && reviewDecision === 'approve' && (
            <div className="grid grid-2 grid-gap-sm" style={{ marginBottom: 14 }}>
              <div className="form-group">
                <label className="form-label">Notice Period</label>
                <input className="form-control" value={reviewExtra.noticePeriod} onChange={e => setReviewExtra(s => ({ ...s, noticePeriod: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Last Working Day</label>
                <input type="date" className="form-control" value={reviewExtra.lastWorkingDay} onChange={e => setReviewExtra(s => ({ ...s, lastWorkingDay: e.target.value }))} />
              </div>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">{reviewModal.kind === 'withdraw' ? 'Withdraw Reason' : 'Comments / Remarks'}</label>
            <textarea className="form-control" rows={3} value={reviewComment} onChange={e => setReviewComment(e.target.value)} maxLength={2000} />
          </div>
        </Modal>
      )}

      {/* ── Exit Management Modal ── */}
      {exitModal && (
        <Modal open={true} onClose={() => setExitModal(null)} title={`Manage Exit Formalities — ${exitModal.employeeName || exitModal.employeeId}`} size="md"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setExitModal(null)} disabled={exitSaving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleExitSave} disabled={exitSaving}>{exitSaving ? 'Saving...' : 'Save'}</button>
            </>
          }
        >
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Notice Period</label>
              <input className="form-control" value={exitForm.noticePeriod} onChange={e => setExitForm(f => ({ ...f, noticePeriod: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Last Working Day</label>
              <input type="date" className="form-control" value={exitForm.lastWorkingDay} onChange={e => setExitForm(f => ({ ...f, lastWorkingDay: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Exit Status</label>
            <select className="form-control form-select" value={exitForm.exitStatus} onChange={e => setExitForm(f => ({ ...f, exitStatus: e.target.value }))}>
              {EXIT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 8, marginTop: 8 }}>Clearance Checklist</div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            {CLEARANCE_KEYS.map(k => (
              <div className="form-group" key={k}>
                <label className="form-label">{CLEARANCE_LABELS[k]}</label>
                <select className="form-control form-select" value={exitForm.clearance[k] || 'Pending'} onChange={e => setExitForm(f => ({ ...f, clearance: { ...f.clearance, [k]: e.target.value } }))}>
                  {CLEARANCE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="form-group">
            <label className="form-label">Exit Remarks</label>
            <textarea className="form-control" rows={3} value={exitForm.exitRemarks} onChange={e => setExitForm(f => ({ ...f, exitRemarks: e.target.value }))} maxLength={2000} />
          </div>
        </Modal>
      )}

      {/* ── Delete confirmation ── */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Resignation Record"
        message={`Delete ${deleteTarget?.employeeName || 'this'}'s resignation record? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
};

const confirmLabel = (reviewModal, decision) => {
  const { kind } = reviewModal;
  if (kind === 'submit') return 'Submit';
  if (kind === 'withdraw') return 'Withdraw';
  if (kind === 'finalize') return 'Final Approval';
  if (kind === 'complete') return 'Complete Exit';
  return decision === 'approve' ? 'Approve' : 'Reject';
};

const viewResignationReasonBlock = (rec) => {
  if (!rec.resignationReason && !rec.detailedExplanation) return null;
  return (
    <div style={{ marginTop: 16 }}>
      {rec.resignationReason && (
        <>
          <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Resignation Reason</div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, background: 'var(--bg)', borderRadius: 8, padding: 12 }}>{rec.resignationReason}</p>
        </>
      )}
      {rec.detailedExplanation && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Detailed Explanation</div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, background: 'var(--bg)', borderRadius: 8, padding: 12, whiteSpace: 'pre-wrap' }}>{rec.detailedExplanation}</p>
        </div>
      )}
    </div>
  );
};

const ReadOnlyField = ({ label, value }) => (
  <div>
    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{value}</div>
  </div>
);

export default ResignationLetters;
