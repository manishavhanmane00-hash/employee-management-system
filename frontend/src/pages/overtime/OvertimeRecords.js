import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Search, Eye, Plus, Pencil, Trash2, XCircle, Settings, Save,
  Printer, Download, AlertCircle, Clock, CheckCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { overtimeAPI } from '../../services/api';
import { filterRecords, toCsv } from '../../utils/recordFilters';
import Avatar from '../../components/shared/Avatar';
import Badge from '../../components/shared/Badge';
import Modal, { ConfirmModal } from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import SkeletonLoader from '../../components/shared/SkeletonLoader';
import { formatINR } from '../../utils/currency';
import toast from 'react-hot-toast';

const PAGE_SIZE = 10;

const recordId = (r) => (r?._id || r?.id || '').toString();
const shortId = (r) => recordId(r).slice(-8).toUpperCase();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const emptyForm = {
  date: new Date().toISOString().slice(0, 10),
  durationHours: '',
  durationMinutes: '',
  ratePerHour: '',
  reason: '',
};
const emptyPolicyForm = () => ({
  target: 'all',
  userId: '',
  standardDailyHours: 8,
  hourlyRate: '',
  currency: 'INR',
  unpaidBreakMinutes: 0,
  weeklyOffDays: [0],
  holidayOvertimeEligible: true,
  effectiveFrom: new Date().toISOString().slice(0, 10),
});

// Live preview of the server-computed amount: (hours + minutes/60) * ratePerHour.
const computeAmount = (hours, minutes, rate) => {
  const h = Number(hours) || 0;
  const m = Number(minutes) || 0;
  const r = Number(rate) || 0;
  return (h + m / 60) * r;
};

const OvertimeRecords = () => {
  const {
    overtimeEntries, addOvertime, updateOvertime, settleOvertime, setOvertimeApproval, deleteOvertime,
  } = useApp();
  const { user, can } = useAuth();
  const isAdminUser = user?.role === 'Admin';
  const canAdd    = false;
  const canEdit   = isAdminUser && can('overtime', 'edit');
  const canDelete = isAdminUser && can('overtime', 'delete');
  const canSettle = isAdminUser && can('overtime', 'manage');

  const fmtMoney = (n, code = 'INR') => formatINR(n, { currency: code, decimals: 2 });
  const sumByCurrency = records => {
    const totals = records.reduce((result, record) => {
      const code = record.currency || 'UNVERIFIED';
      const amount = record.amount ?? record.paymentAmount ?? record.totalAmount ?? 0;
      result[code] = (result[code] || 0) + Number(amount);
      return result;
    }, {});
    return Object.entries(totals).map(([code, amount]) => fmtMoney(amount, code)).join(' · ') || fmtMoney(0);
  };

  // ── Local list state (skeleton + retain last data on error) ─────────────────
  const [records, setRecords] = useState(overtimeEntries);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Filters / pagination ──
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [employeeIdFilter, setEmployeeIdFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [reportPeriod, setReportPeriod] = useState('daily');
  const [page, setPage] = useState(1);

  // ── Modals ──
  const [viewEntry, setViewEntry] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [settleTarget, setSettleTarget] = useState(null);
  const [settling, setSettling] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [approvalSaving, setApprovalSaving] = useState('');
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [policyForm, setPolicyForm] = useState(emptyPolicyForm);
  const [policyUsers, setPolicyUsers] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState('');
  const [paymentReference, setPaymentReference] = useState('');

  const canViewAll = isAdminUser;

  // ── Load overtime records with loading + error handling (Req 8.1, 17.1, 17.3)
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await overtimeAPI.getAll();
      if (data.success) {
        setRecords(data.data);
      } else {
        throw new Error(data.message || 'Failed to load overtime records');
      }
    } catch (err) {
      // Retain the last successfully loaded records.
      setError(err.response?.data?.message || err.message || 'Failed to load overtime records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadPolicies = useCallback(async () => {
    try {
      const { data } = await overtimeAPI.getPolicies();
      if (data.success) {
        setPolicies(data.data.policies || []);
        setPolicyUsers(data.data.users || []);
      }
    } catch (err) {
      setPolicyError(err.response?.data?.message || err.message || 'Failed to load overtime policies.');
    }
  }, []);

  useEffect(() => { loadPolicies(); }, [loadPolicies]);
  useEffect(() => {
    const refreshOvertimeData = () => {
      load();
      loadPolicies();
    };
    window.addEventListener('ems:overtime-updated', refreshOvertimeData);
    return () => window.removeEventListener('ems:overtime-updated', refreshOvertimeData);
  }, [load, loadPolicies]);

  // Keep local list in sync with context mutations (add/update/settle/delete).
  useEffect(() => { setRecords(overtimeEntries); }, [overtimeEntries]);

  // ── Employee scoping (Req 8.2): employees only see their own entries ────────
  const scoped = useMemo(() => {
    if (canViewAll) return records;
    const userId = String(user?._id || user?.id || '');
    return records.filter(record => userId && String(record.userId || '') === userId);
  }, [records, canViewAll, user]);

  // ── Filtering (Req 12.1) via shared selector; status field = status ─────────
  const filtered = useMemo(() => {
    const list = filterRecords(
      scoped,
      { status: statusFilter },
      { nameField: 'employeeName', statusField: 'approvalStatus', typeField: 'approvalStatus' },
    );
    const query = search.trim().toLowerCase();
    return [...list].filter(entry => (!query || [
      entry.employeeName, entry.employeeId, entry.email, entry.submittedByRole, entry.reason, recordId(entry),
    ].some(value => String(value || '').toLowerCase().includes(query)))
      && (!roleFilter || (entry.submittedByRole || '') === roleFilter)
      && (!paymentStatusFilter || (entry.status || 'Pending') === paymentStatusFilter)
      && (!employeeIdFilter || String(entry.employeeId || '').toLowerCase().includes(employeeIdFilter.toLowerCase()))
      && (!departmentFilter || String(entry.department || '').toLowerCase().includes(departmentFilter.toLowerCase()))
      && (!dateFilter || entry.date === dateFilter)
      && (!startDateFilter || entry.date >= startDateFilter)
      && (!endDateFilter || entry.date <= endDateFilter))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [scoped, search, statusFilter, paymentStatusFilter, roleFilter, employeeIdFilter, dateFilter, startDateFilter, endDateFilter, departmentFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Add / Edit ──────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditEntry(null);
    setForm(emptyForm);
    setFormErrors({});
    setFormOpen(true);
  };

  const openEdit = (entry) => {
    setEditEntry(entry);
    setForm({
      date: entry.date || '',
      durationHours: entry.durationHours ?? '',
      durationMinutes: entry.durationMinutes ?? '',
      ratePerHour: entry.ratePerHour ?? '',
      reason: entry.reason || '',
    });
    setFormErrors({});
    setFormOpen(true);
  };

  const setField = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setFormErrors(e => ({ ...e, [k]: '' }));
  };

  const previewAmount = useMemo(
    () => computeAmount(form.durationHours, form.durationMinutes, form.ratePerHour),
    [form.durationHours, form.durationMinutes, form.ratePerHour],
  );

  // Client-side guard mirroring the backend predicate (Req 8.5): at least one of
  // hours/minutes > 0 and a non-negative ratePerHour.
  const validateForm = () => {
    const errs = {};
    if (!form.date) errs.date = 'Select a date';

    const hours = Number(form.durationHours) || 0;
    const minutes = Number(form.durationMinutes) || 0;
    const rate = form.ratePerHour === '' ? NaN : Number(form.ratePerHour);

    if (hours < 0) errs.durationHours = 'Hours cannot be negative';
    if (minutes < 0) errs.durationMinutes = 'Minutes cannot be negative';
    if (hours <= 0 && minutes <= 0) {
      errs.durationHours = 'Enter a duration greater than zero';
    }
    if (Number.isNaN(rate)) {
      errs.ratePerHour = 'Enter a rate per hour';
    } else if (rate < 0) {
      errs.ratePerHour = 'Rate cannot be negative';
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
        durationHours: Number(form.durationHours) || 0,
        durationMinutes: Number(form.durationMinutes) || 0,
        ratePerHour: Number(form.ratePerHour) || 0,
        reason: form.reason,
      };

      if (editEntry) {
        const result = await updateOvertime(recordId(editEntry), payload);
        if (result?.warning) toast.error(result.warning);
        toast.success('Overtime entry updated');
      } else {
        const result = await addOvertime(payload);
        if (result?.warning) toast.error(result.warning);
        toast.success('Overtime request submitted for approval');
      }
      setFormOpen(false);
      setForm(emptyForm);
    } catch (err) {
      // Retain the user's entered values on failure (Req 17.2).
      toast.error(err.response?.data?.message || err.message || 'Failed to save overtime entry');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Settle (Req 8.7) — set status to "Paid" ─────────────────────────────────
  const handleSettle = async () => {
    setSettling(true);
    try {
      const result = await settleOvertime(recordId(settleTarget), paymentReference.trim());
      if (result?.warning) toast.error(result.warning);
      toast.success(`Overtime marked as Paid for ${settleTarget.employeeName || 'employee'}`);
      setSettleTarget(null);
      setPaymentReference('');
      setViewEntry(null);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to settle overtime');
    } finally {
      setSettling(false);
    }
  };

  const setPolicyField = (field, value) => setPolicyForm(current => ({ ...current, [field]: value }));

  const handlePolicySubmit = async event => {
    event.preventDefault();
    const payload = {
      standardDailyHours: Number(policyForm.standardDailyHours),
      hourlyRate: Number(policyForm.hourlyRate),
      currency: policyForm.currency,
      unpaidBreakMinutes: Number(policyForm.unpaidBreakMinutes),
      weeklyOffDays: policyForm.weeklyOffDays,
      holidayOvertimeEligible: policyForm.holidayOvertimeEligible,
      effectiveFrom: policyForm.effectiveFrom,
    };
    if (policyForm.target === 'all') payload.allUsers = true;
    else if (policyForm.target === 'individual') payload.userIds = [policyForm.userId];
    else payload.roles = [policyForm.target];
    setPolicySaving(true);
    setPolicyError('');
    try {
      const { data } = await overtimeAPI.setPolicies(payload);
      if (!data.success) throw new Error(data.message || 'Failed to save overtime policy.');
      toast.success(`Overtime policy assigned to ${data.count} account${data.count === 1 ? '' : 's'}.`);
      setPolicyModalOpen(false);
      setPolicyForm(emptyPolicyForm());
      await Promise.all([loadPolicies(), load()]);
    } catch (err) {
      setPolicyError(err.response?.data?.message || err.message || 'Failed to save overtime policy.');
    } finally {
      setPolicySaving(false);
    }
  };

  const policyUserById = useMemo(() => new Map(policyUsers.map(policyUser => [String(policyUser._id), policyUser])), [policyUsers]);
  const currentUserPolicy = useMemo(() => {
    const userId = String(user?._id || user?.id || '');
    const today = new Date().toISOString().slice(0, 10);
    return policies
      .filter(policy => String(policy.userId) === userId && policy.effectiveFrom <= today)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] || null;
  }, [policies, user]);

  const periodSummary = useMemo(() => {
    const buckets = new Map();
    filtered.forEach(entry => {
      const day = new Date(`${entry.date}T00:00:00Z`);
      let key = entry.date;
      if (reportPeriod === 'weekly') {
        const weekStart = new Date(day);
        weekStart.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
        key = weekStart.toISOString().slice(0, 10);
      } else if (reportPeriod === 'monthly') key = entry.date.slice(0, 7);
      const currencyCode = entry.currency || 'UNVERIFIED';
      const bucketKey = `${key}|${currencyCode}`;
      const bucket = buckets.get(bucketKey) || { period: key, currency: currencyCode, entries: 0, minutes: 0, amount: 0 };
      bucket.entries += 1;
      bucket.minutes += (Number(entry.durationHours) || 0) * 60 + (Number(entry.durationMinutes) || 0);
      bucket.amount += Number(entry.totalAmount) || 0;
      buckets.set(bucketKey, bucket);
    });
    return [...buckets.values()].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 12);
  }, [filtered, reportPeriod]);

  const handleApproval = async (entry, approvalStatus) => {
    setApprovalSaving(recordId(entry));
    try {
      const result = await setOvertimeApproval(recordId(entry), approvalStatus);
      if (result?.warning) toast.error(result.warning);
      toast.success(`Overtime request ${approvalStatus.toLowerCase()}`);
      if (viewEntry && recordId(viewEntry) === recordId(entry)) setViewEntry(result.data);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Unable to update overtime approval.');
    } finally {
      setApprovalSaving('');
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    setDeleting(true);
    try {
      const result = await deleteOvertime(recordId(deleteTarget));
      if (result?.warning) toast.error(result.warning);
      toast.success('Overtime entry deleted');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete overtime entry');
    } finally {
      setDeleting(false);
    }
  };

  // ── Export (Req 12.2) — exports the currently filtered records ──────────────
  const handleExport = () => {
    const csv = toCsv(filtered, [
      { key: '_id', label: 'ID', accessor: shortId },
      { key: 'employeeName', label: 'Submitted By' },
      { key: 'date', label: 'Date' },
      { key: 'employeeId', label: 'Employee ID' },
      { key: 'email', label: 'Email' },
      { key: 'submittedByRole', label: 'Role' },
      { key: 'durationHours', label: 'Hours' },
      { key: 'durationMinutes', label: 'Minutes' },
      { key: 'ratePerHour', label: 'Rate/Hour' },
      { key: 'currency', label: 'Currency' },
      { key: 'totalAmount', label: 'Total Amount' },
      { key: 'approvalStatus', label: 'Approval Status' },
      { key: 'createdAt', label: 'Request Date' },
      { key: 'reason', label: 'Reason' },
    ]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `overtime-records-${new Date().toISOString().slice(0, 10)}.csv`;
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
        <td>${escapeHtml(`${r.durationHours ?? 0}h ${r.durationMinutes ?? 0}m`)}</td>
        <td>${escapeHtml(r.ratePerHour)}</td>
        <td>${escapeHtml(r.currency || 'UNVERIFIED')}</td>
        <td>${escapeHtml(formatINR(r.totalAmount, { currency: r.currency || 'UNVERIFIED' }))}</td>
        <td>${escapeHtml(r.reason)}</td>
        <td>${escapeHtml(r.approvalStatus || 'Pending Approval')}</td>
        <td>${r.createdAt ? escapeHtml(new Date(r.createdAt).toLocaleDateString()) : ''}</td>
      </tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) { toast.error('Unable to open print window'); return; }
    win.document.write(`
      <html>
        <head>
          <title>Overtime Records</title>
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
          <h1>Overtime Records</h1>
          <p>${filtered.length} record(s) · Generated ${new Date().toLocaleString()}</p>
          <table>
            <thead>
              <tr><th>ID</th><th>Submitted By</th><th>Employee ID</th><th>Email</th><th>Role</th><th>Date</th><th>Duration</th><th>Rate/Hour</th><th>Currency</th><th>Total Amount</th><th>Reason</th><th>Approval</th><th>Request Date</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <script>window.onload = function () { window.print(); }</script>
        </body>
      </html>`);
    win.document.close();
  };

  const pendingCount = scoped.filter(r => (r.approvalStatus || 'Pending Approval') === 'Pending Approval').length;
  const paidCount = scoped.filter(r => r.status === 'Paid').length;
  const pendingRecords = scoped.filter(r => r.status === 'Pending' && r.approvalStatus === 'Approved');
  const pendingAmount = sumByCurrency(pendingRecords);
  const totalOvertimeMinutes = scoped.reduce((sum, record) => sum + (Number(record.durationHours) || 0) * 60 + (Number(record.durationMinutes) || 0), 0);
  const totalActualWorkingMinutes = scoped.reduce((sum, record) => sum + (Number(record.actualWorkingMinutes) || 0), 0);
  const paidRecords = scoped.filter(record => record.status === 'Paid');
  const paidAmount = sumByCurrency(paidRecords.map(record => ({ ...record, amount: record.paymentAmount ?? record.totalAmount })));

  if (loading) return <SkeletonLoader />;

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb"><span>Overtime</span><span className="breadcrumb-sep">/</span><span>Overtime Records</span></div>
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Overtime Records</h1>
            <p className="page-subtitle">{pendingCount} pending entr{pendingCount === 1 ? 'y' : 'ies'}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={handlePrint} title="Print filtered records"><Printer size={14} /> Print</button>
            <button className="btn btn-outline" onClick={handleExport} title="Export filtered records"><Download size={14} /> Export</button>
            {isAdminUser && <button className="btn btn-outline" onClick={() => { setPolicyError(''); setPolicyModalOpen(true); }}><Settings size={14} /> Working Hours & Rates</button>}
            {canAdd && <button className="btn btn-primary" onClick={openAdd}><Plus size={14} /> Log Overtime</button>}
          </div>
        </div>
      </div>

      {/* Error banner — shown alongside the retained last-loaded data (Req 17.3) */}
      {error && (
        <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderLeft: '3px solid var(--danger)' }}>
          <AlertCircle size={16} color="var(--danger)" />
          <span style={{ fontSize: '0.85rem', color: 'var(--danger)', flex: 1 }}>{error}</span>
          <button className="btn btn-outline btn-sm" onClick={load}>Retry</button>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'Total Entries', value: scoped.length, color: 'var(--primary)' },
          { label: 'Pending', value: pendingCount, color: 'var(--warning)' },
          { label: 'Paid', value: paidCount, color: 'var(--success)' },
          { label: 'Pending Amount', value: pendingAmount, color: 'var(--primary)' },
          { label: 'Overtime Hours', value: `${Math.floor(totalOvertimeMinutes / 60)}h ${totalOvertimeMinutes % 60}m`, color: 'var(--info)' },
          { label: 'Paid Amount', value: paidAmount, color: 'var(--success)' },
          ...(!isAdminUser ? [
            { label: 'Standard Working Hours', value: currentUserPolicy ? `${currentUserPolicy.standardDailyHours}h/day` : 'Not configured', color: 'var(--primary)' },
            { label: 'Assigned Rate / Hour', value: currentUserPolicy ? fmtMoney(currentUserPolicy.hourlyRate, currentUserPolicy.currency) : 'Not configured', color: 'var(--info)' },
            { label: 'Actual Working Hours', value: `${Math.floor(totalActualWorkingMinutes / 60)}h ${totalActualWorkingMinutes % 60}m`, color: 'var(--primary)' },
            { label: 'Total Overtime Balance', value: sumByCurrency([
              ...pendingRecords,
              ...paidRecords.map(record => ({ ...record, amount: record.paymentAmount ?? record.totalAmount })),
            ]), color: 'var(--success)' },
          ] : []),
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
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
            <option value="Pending Approval">Pending Approval</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>
          {isAdminUser && (
            <>
              <select className="form-control form-select" style={{ width: 140 }} value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(1); }}>
                <option value="">All Roles</option>
                {['Employee', 'HR', 'Manager', 'Admin'].map(role => <option key={role} value={role}>{role}</option>)}
              </select>
              <select className="form-control form-select" style={{ width: 145 }} value={paymentStatusFilter} onChange={e => { setPaymentStatusFilter(e.target.value); setPage(1); }}>
                <option value="">All Payment Status</option><option value="Pending">Pending Payment</option><option value="Paid">Paid</option>
              </select>
              <input className="form-control" style={{ width: 150 }} placeholder="Employee ID" value={employeeIdFilter} onChange={e => { setEmployeeIdFilter(e.target.value); setPage(1); }} />
              <input type="date" className="form-control" style={{ width: 160 }} aria-label="Filter by overtime date" value={dateFilter} onChange={e => { setDateFilter(e.target.value); setPage(1); }} />
              <input type="date" className="form-control" style={{ width: 160 }} aria-label="Start date" value={startDateFilter} onChange={e => { setStartDateFilter(e.target.value); setPage(1); }} />
              <input type="date" className="form-control" style={{ width: 160 }} aria-label="End date" value={endDateFilter} onChange={e => { setEndDateFilter(e.target.value); setPage(1); }} />
              <input className="form-control" style={{ width: 170 }} placeholder="Department" value={departmentFilter} onChange={e => { setDepartmentFilter(e.target.value); setPage(1); }} />
            </>
          )}
        </div>
      </div>

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="card-title">Overtime Report</h3>
          <select className="form-control" style={{ width: 150 }} value={reportPeriod} onChange={event => setReportPeriod(event.target.value)}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </select>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Period{reportPeriod === 'weekly' ? ' (Week Starting)' : ''}</th><th>Entries</th><th>Overtime</th><th>Amount</th></tr></thead>
            <tbody>
              {periodSummary.map(period => (
                <tr key={period.period}>
                  <td>{period.period}</td><td>{period.entries}</td>
                  <td>{Math.floor(period.minutes / 60)}h {period.minutes % 60}m</td>
                  <td>{fmtMoney(period.amount, period.currency)}</td>
                </tr>
              ))}
              {!periodSummary.length && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No overtime to report for this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th><th>Submitted By</th><th>Email / Role</th><th>Department</th><th>Date</th><th>Standard / Actual</th><th>Overtime</th>
              <th>Rate/Hour</th><th>Total Amount</th><th>Payment</th><th>Approval</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(entry => (
              <tr key={recordId(entry)}>
                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{shortId(entry)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={entry.employeeName} size="sm" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{entry.employeeName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{entry.employeeId || 'No linked Employee ID'}</div>
                    </div>
                  </div>
                </td>
                <td style={{ fontSize: '0.8rem' }}>
                  <div>{entry.email || '—'}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{entry.submittedByRole || '—'}</div>
                </td>
                <td style={{ fontSize: '0.8rem' }}>{entry.department || '—'}{entry.designation ? <div style={{ color: 'var(--text-muted)' }}>{entry.designation}</div> : null}</td>
                <td style={{ fontSize: '0.875rem' }}>{entry.date}</td>
                <td style={{ fontSize: '0.8rem' }}>
                  <div>{entry.standardWorkingMinutes == null ? '—' : `${(entry.standardWorkingMinutes / 60).toFixed(1)}h`} / {entry.actualWorkingMinutes == null ? '—' : `${(entry.actualWorkingMinutes / 60).toFixed(2)}h`}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{entry.checkIn || '—'} – {entry.checkOut || '—'}</div>
                </td>
                <td style={{ fontSize: '0.875rem' }}>{entry.durationHours ?? 0}h {entry.durationMinutes ?? 0}m</td>
                <td style={{ fontSize: '0.875rem' }}>{fmtMoney(entry.ratePerHour, entry.currency)}</td>
                <td><span style={{ fontWeight: 600 }}>{fmtMoney(entry.totalAmount, entry.currency)}</span></td>
                <td><Badge status={entry.status === 'Paid' ? 'paid' : 'pending'} label={entry.status || 'Pending'} /></td>
                <td><Badge status={entry.approvalStatus || 'Pending Approval'} /></td>
                <td>
                  <div className="table-actions">
                    <button className="btn-icon primary" onClick={() => setViewEntry(entry)} title="View Details"><Eye size={13} /></button>
                    {entry.approvalStatus === 'Pending Approval' && isAdminUser && (
                      <>
                        <button className="btn-icon" style={{ color: 'var(--success)', borderColor: 'var(--success-light)' }} onClick={() => handleApproval(entry, 'Approved')} title="Approve" disabled={approvalSaving === recordId(entry)}><CheckCircle size={13} /></button>
                        <button className="btn-icon danger" onClick={() => handleApproval(entry, 'Rejected')} title="Reject" disabled={approvalSaving === recordId(entry)}><XCircle size={13} /></button>
                      </>
                    )}
                    {entry.approvalStatus === 'Pending Approval' && canEdit && (
                      <button className="btn-icon" onClick={() => openEdit(entry)} title="Edit"><Pencil size={13} /></button>
                    )}
                    {entry.approvalStatus === 'Approved' && entry.status === 'Pending' && canSettle && (
                      <button className="btn-icon" style={{ color: 'var(--success)', borderColor: 'var(--success-light)' }} onClick={() => setSettleTarget(entry)} title="Settle (mark Paid)">
                        <CheckCircle size={13} />
                      </button>
                    )}
                    {canDelete && (
                      <button className="btn-icon danger" onClick={() => setDeleteTarget(entry)} title="Delete"><Trash2 size={13} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr><td colSpan={12} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No overtime records found</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={page} totalPages={totalPages} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {/* View Modal */}
      {viewEntry && (
        <Modal open={true} onClose={() => setViewEntry(null)} title="Overtime Entry Details" size="md"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setViewEntry(null)}>Close</button>
              {viewEntry.approvalStatus === 'Pending Approval' && isAdminUser && (
                <>
                  <button className="btn btn-success" onClick={() => handleApproval(viewEntry, 'Approved')} disabled={approvalSaving === recordId(viewEntry)}>Approve Request</button>
                  <button className="btn btn-danger" onClick={() => handleApproval(viewEntry, 'Rejected')} disabled={approvalSaving === recordId(viewEntry)}>Reject</button>
                </>
              )}
              {viewEntry.approvalStatus === 'Approved' && viewEntry.status === 'Pending' && canSettle && (
                <button className="btn btn-success" onClick={() => { setSettleTarget(viewEntry); }}>Mark as Paid</button>
              )}
            </>
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '16px', background: 'var(--bg)', borderRadius: 10 }}>
            <Avatar name={viewEntry.employeeName} size="lg" />
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>{viewEntry.employeeName}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{viewEntry.employeeId || 'No linked Employee ID'} · {viewEntry.submittedByRole || '—'}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{viewEntry.email || '—'}</div>
              <Badge status={viewEntry.status} style={{ marginTop: 4 }} />
            </div>
          </div>
          <div className="grid grid-2 grid-gap-sm">
            {[
              ['Entry ID', shortId(viewEntry)], ['User ID', viewEntry.userId || '—'],
              ['Date', viewEntry.date],
              ['Approval', viewEntry.approvalStatus || 'Pending Approval'],
              ['Standard Working Hours', viewEntry.standardWorkingMinutes == null ? '—' : `${(viewEntry.standardWorkingMinutes / 60).toFixed(2)}h`],
              ['Actual Working Hours', viewEntry.actualWorkingMinutes == null ? '—' : `${(viewEntry.actualWorkingMinutes / 60).toFixed(2)}h`],
              ['Actual IN / OUT', `${viewEntry.checkIn || '—'} / ${viewEntry.checkOut || '—'}`],
              ['Unpaid Break', `${viewEntry.breakMinutes || 0} minutes`],
              ['Duration', `${viewEntry.durationHours ?? 0}h ${viewEntry.durationMinutes ?? 0}m`],
              ['Rate / Hour', fmtMoney(viewEntry.ratePerHour, viewEntry.currency)],
              ['Rate Effective From', viewEntry.rateEffectiveFrom || '—'],
              ['Total Amount', fmtMoney(viewEntry.totalAmount, viewEntry.currency)], ['Request Date', viewEntry.createdAt ? new Date(viewEntry.createdAt).toLocaleString() : '—'],
              ['Payment Date', viewEntry.paidAt ? new Date(viewEntry.paidAt).toLocaleString() : '—'],
              ['Payment Reference', viewEntry.paymentReference || '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>{k}</div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{v}</div>
              </div>
            ))}
          </div>
          {viewEntry.reason && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Reason</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, background: 'var(--bg)', borderRadius: 8, padding: 12 }}>{viewEntry.reason}</p>
            </div>
          )}
          {viewEntry.calculationHistory?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Calculation History</div>
              {viewEntry.calculationHistory.slice().reverse().map((item, index) => (
                <div key={`${item.calculatedAt}-${index}`} style={{ fontSize: '0.75rem', padding: '7px 0', borderTop: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  {item.calculatedAt ? new Date(item.calculatedAt).toLocaleString() : '—'} · {item.actualWorkingMinutes / 60}h worked · {item.overtimeMinutes}m overtime · {fmtMoney(item.ratePerHour, viewEntry.currency)}/h
                  {item.retainedAsHistorical ? ' · Historical payment retained' : ''}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Add / Edit Modal */}
      {formOpen && (
        <Modal open={true} onClose={() => setFormOpen(false)} title={editEntry ? 'Edit Overtime Entry' : 'Log Overtime'} size="md"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setFormOpen(false)} disabled={submitting}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Saving...' : editEntry ? 'Save Changes' : 'Log Overtime'}
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
            <div className="form-group">
              <label className="form-label">Date <span className="required">*</span></label>
              <input type="date" className={`form-control ${formErrors.date ? 'error' : ''}`} value={form.date} onChange={e => setField('date', e.target.value)} />
              {formErrors.date && <div className="form-error">{formErrors.date}</div>}
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Duration (Hours) <span className="required">*</span></label>
                <input type="number" min="0" className={`form-control ${formErrors.durationHours ? 'error' : ''}`} value={form.durationHours} onChange={e => setField('durationHours', e.target.value)} placeholder="0" />
                {formErrors.durationHours && <div className="form-error">{formErrors.durationHours}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Duration (Minutes)</label>
                <input type="number" min="0" max="59" className={`form-control ${formErrors.durationMinutes ? 'error' : ''}`} value={form.durationMinutes} onChange={e => setField('durationMinutes', e.target.value)} placeholder="0" />
                {formErrors.durationMinutes && <div className="form-error">{formErrors.durationMinutes}</div>}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Rate per Hour <span className="required">*</span></label>
              <input type="number" min="0" step="0.01" className={`form-control ${formErrors.ratePerHour ? 'error' : ''}`} value={form.ratePerHour} onChange={e => setField('ratePerHour', e.target.value)} placeholder="0.00" />
              {formErrors.ratePerHour && <div className="form-error">{formErrors.ratePerHour}</div>}
            </div>
            {previewAmount > 0 && (
              <div style={{ background: 'var(--primary-light)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Clock size={15} color="var(--primary)" />
                <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 500 }}>Estimated Amount: <strong>{fmtMoney(previewAmount, editEntry?.currency || 'INR')}</strong></span>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Reason</label>
              <textarea className={`form-control ${formErrors.reason ? 'error' : ''}`} rows={3} value={form.reason} onChange={e => setField('reason', e.target.value)} placeholder="Describe the reason for the overtime..." />
              {formErrors.reason && <div className="form-error">{formErrors.reason}</div>}
            </div>
          </form>
        </Modal>
      )}

      {settleTarget && (
        <Modal open onClose={() => { setSettleTarget(null); setPaymentReference(''); }} title="Settle Overtime" size="sm"
          footer={(
            <>
              <button className="btn btn-outline" onClick={() => { setSettleTarget(null); setPaymentReference(''); }} disabled={settling}>Cancel</button>
              <button className="btn btn-success" onClick={handleSettle} disabled={settling}>{settling ? 'Saving…' : 'Mark as Paid'}</button>
            </>
          )}>
          <p>Mark {settleTarget.employeeName || 'this user'}’s {settleTarget.durationHours}h {settleTarget.durationMinutes}m overtime ({fmtMoney(settleTarget.totalAmount, settleTarget.currency)}) as paid?</p>
          <div className="form-group">
            <label className="form-label">Payment / Transaction Reference</label>
            <input className="form-control" maxLength={200} value={paymentReference} onChange={event => setPaymentReference(event.target.value)} placeholder="Optional reference number" />
          </div>
        </Modal>
      )}

      {policyModalOpen && isAdminUser && (
        <Modal open onClose={() => !policySaving && setPolicyModalOpen(false)} title="Working Hours & Overtime Rates" size="lg"
          footer={(
            <>
              <button className="btn btn-outline" onClick={() => setPolicyModalOpen(false)} disabled={policySaving}>Cancel</button>
              <button className="btn btn-primary" onClick={handlePolicySubmit} disabled={policySaving || (policyForm.target === 'individual' && !policyForm.userId)}>
                <Save size={14} /> {policySaving ? 'Saving…' : 'Assign Policy'}
              </button>
            </>
          )}>
          <form onSubmit={handlePolicySubmit}>
            {policyError && <div className="form-error" style={{ marginBottom: 12 }}>{policyError}</div>}
            <div className="form-group">
              <label className="form-label">Apply Policy To</label>
              <select className="form-control" value={policyForm.target} onChange={event => setPolicyField('target', event.target.value)}>
                <option value="all">All Users</option>
                <option value="Employee">All Employees</option>
                <option value="HR">All HR</option>
                <option value="Manager">All Managers</option>
                <option value="individual">Individual User</option>
              </select>
            </div>
            {policyForm.target === 'individual' && (
              <div className="form-group">
                <label className="form-label">User</label>
                <select className="form-control" value={policyForm.userId} onChange={event => setPolicyField('userId', event.target.value)}>
                  <option value="">Select Employee, HR, or Manager</option>
                  {policyUsers.filter(item => item.role !== 'Admin').map(item => (
                    <option key={item._id} value={item._id}>{item.name} · {item.role} · {item.employeeId || 'No Employee ID'}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-2 grid-gap-sm">
              <div className="form-group">
                <label className="form-label">Standard Daily Working Hours</label>
                <input type="number" min="0" max="24" step="0.25" className="form-control" value={policyForm.standardDailyHours} onChange={event => setPolicyField('standardDailyHours', event.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Overtime Rate per Hour ({policyForm.currency})</label>
                <input type="number" min="0" step="0.01" className="form-control" value={policyForm.hourlyRate} onChange={event => setPolicyField('hourlyRate', event.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Rate Currency</label>
                <select className="form-control form-select" value={policyForm.currency} onChange={event => setPolicyField('currency', event.target.value)} required>
                  {policyForm.currency === 'UNVERIFIED' && <option value="UNVERIFIED">Unverified — select currency</option>}
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Unpaid Break (Minutes)</label>
                <input type="number" min="0" max="720" step="1" className="form-control" value={policyForm.unpaidBreakMinutes} onChange={event => setPolicyField('unpaidBreakMinutes', event.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Effective From</label>
                <input type="date" className="form-control" value={policyForm.effectiveFrom} onChange={event => setPolicyField('effectiveFrom', event.target.value)} required />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Weekly Off Days (worked time on these days counts as overtime)</label>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => (
                  <label key={day} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem' }}>
                    <input type="checkbox" checked={policyForm.weeklyOffDays.includes(index)}
                      onChange={event => setPolicyField('weeklyOffDays', event.target.checked
                        ? [...policyForm.weeklyOffDays, index]
                        : policyForm.weeklyOffDays.filter(value => value !== index))} />
                    {day}
                  </label>
                ))}
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: '0.85rem' }}>
              <input type="checkbox" checked={policyForm.holidayOvertimeEligible} onChange={event => setPolicyField('holidayOvertimeEligible', event.target.checked)} />
              Count assigned holiday shifts as overtime from the first minute
            </label>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Rate and working-hour updates apply only to attendance dated on or after the effective date. Existing paid and payroll-counted entries remain unchanged.
            </div>
          </form>
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>Configured Policy History</div>
            <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              {policies.slice(0, 30).map(policy => {
                const policyUser = policyUserById.get(String(policy.userId));
                return (
                  <div key={policy._id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: '0.75rem' }}>
                    <span>{policyUser ? `${policyUser.name} · ${policyUser.role}` : String(policy.userId).slice(-8)}</span>
                    <span>{policy.standardDailyHours}h/day</span><span>{fmtMoney(policy.hourlyRate, policy.currency)}/h</span><span>From {policy.effectiveFrom}</span>
                  </div>
                );
              })}
              {!policies.length && <div style={{ padding: 12, fontSize: '0.8rem', color: 'var(--text-muted)' }}>No overtime policy is configured yet.</div>}
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Overtime Entry"
        message={`Are you sure you want to delete the overtime entry for ${deleteTarget?.employeeName || 'this employee'}? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
};

export default OvertimeRecords;
