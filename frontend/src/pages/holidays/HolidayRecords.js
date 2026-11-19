import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Search, Eye, Plus, Pencil, Trash2,
  Printer, Download, AlertCircle, CalendarDays,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { employeeAPI, holidayAPI } from '../../services/api';
import { filterRecords, toCsv } from '../../utils/recordFilters';
import Badge from '../../components/shared/Badge';
import Modal, { ConfirmModal } from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import SkeletonLoader from '../../components/shared/SkeletonLoader';
import toast from 'react-hot-toast';

const PAGE_SIZE = 10;

// Holiday_Type options (Req 5.4).
const HOLIDAY_TYPES = ['Weekly', 'Monthly', 'Festival', 'Custom'];
const PAID_OPTIONS = ['Paid', 'Unpaid'];

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const recordId = (r) => (r?._id || r?.id || '').toString();
const shortId = (r) => recordId(r).slice(-8).toUpperCase();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

// Needs a fixed date (Festival/Custom) vs recurrence (Weekly/Monthly).
const needsDate = (type) => type === 'Festival' || type === 'Custom';

// Human-readable Holiday_Rule summary for list/detail/print/export.
const ruleSummary = (h) => {
  if (!h) return '';
  if (h.type === 'Weekly') {
    const d = DAYS_OF_WEEK.find(x => x.value === Number(h.recurrence?.dayOfWeek));
    return d ? `Every ${d.label}` : 'Weekly';
  }
  if (h.type === 'Monthly') {
    const dom = h.recurrence?.dayOfMonth;
    return (dom !== null && dom !== undefined && dom !== '') ? `Day ${dom} of every month` : 'Monthly';
  }
  return h.date || '';
};

const emptyForm = {
  holidayName: '',
  type: '',
  date: '',
  startDate: '',
  endDate: '',
  dayOfWeek: '',
  dayOfMonth: '',
  description: '',
  paidStatus: 'Paid',
  status: 'active',
  applicableAll: false,
  applicableEmployees: [],
  applicableUserIds: [],
};

const holidayStart = holiday => holiday.startDate || holiday.date || '';
const holidayEnd = holiday => holiday.endDate || holidayStart(holiday);
const selectedUserId = value => String(value?.userId || value?._id || value);
const durationDays = holiday => {
  const start = holidayStart(holiday);
  const end = holidayEnd(holiday);
  if (!start || !end || Number.isNaN(Date.parse(`${start}T00:00:00Z`)) || Number.isNaN(Date.parse(`${end}T00:00:00Z`))) return 0;
  return Math.max(0, Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1);
};
const holidayDateLabel = holiday => {
  const start = holidayStart(holiday);
  const end = holidayEnd(holiday);
  if (!start) return ruleSummary(holiday);
  return end && end !== start ? `${start} – ${end} (${durationDays(holiday)} days)` : `${start} (1 day)`;
};

const HolidayRecords = () => {
  const { holidays, addHoliday, updateHoliday, deleteHoliday, employees } = useApp();
  const { can, user } = useAuth();
  const canAdd    = can('holidays', 'add');
  const canEdit   = can('holidays', 'edit');
  const canDelete = can('holidays', 'delete');

  // ── Local list state (skeleton + retain last data on error) ───────────────
  const [records, setRecords] = useState(holidays);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Filters / pagination ──
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  // ── Modals ──
  const [viewHoliday, setViewHoliday] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editHoliday, setEditHoliday] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [activeEmployees, setActiveEmployees] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeeLoadError, setEmployeeLoadError] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ── Load holidays with loading + error handling (Req 5.1, 17.1, 17.3) ─────
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await holidayAPI.getAll();
      if (data.success) {
        setRecords(data.data);
      } else {
        throw new Error(data.message || 'Failed to load holidays');
      }
    } catch (err) {
      // Retain the last successfully loaded records.
      setError(err.response?.data?.message || err.message || 'Failed to load holidays');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep local list in sync with context mutations (add/edit/delete).
  useEffect(() => { setRecords(holidays); }, [holidays]);

  // ── Filtering (Req 5.1 / 12.1) via shared selector; type field = 'type' ───
  const filtered = useMemo(() => {
    const list = filterRecords(
      records,
      { search: '', status: statusFilter, type: typeFilter },
      { nameField: 'holidayName', statusField: 'status', typeField: 'type' },
    );
    const term = search.trim().toLowerCase();
    return [...list].filter(holiday => !term || [
      holiday.holidayName,
      holiday.date,
      holiday.startDate,
      holiday.endDate,
      ruleSummary(holiday),
      ...(holiday.applicableUserIds || []).flatMap(user => [
        user?.name, user?.employeeId, user?.role, user?.department, user?.designation,
      ]),
    ].some(value => String(value || '').toLowerCase().includes(term)))
      .sort((a, b) => (a.holidayName || '').localeCompare(b.holidayName || ''));
  }, [records, search, statusFilter, typeFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const employeeName = useCallback(
    (userId) => {
      const emp = activeEmployees.find(e => String(e.userId) === String(userId) || String(e.employeeId) === String(userId));
      const fallback = employees.find(e => e.id === userId || e._id === userId);
      return emp?.name || fallback?.name || userId;
    },
    [activeEmployees, employees],
  );

  const applicableSummary = (h) => {
    if (h.applicableAll) return 'All Employees, HR, and Managers';
    const list = h.applicableUserIds?.length ? h.applicableUserIds : h.applicableEmployees || [];
    if (list.length === 0) return 'None';
    return `${list.length} user${list.length === 1 ? '' : 's'}`;
  };
  const selectedUsers = h => (h.applicableUserIds?.length ? h.applicableUserIds : h.applicableEmployees || []);

  // ── Add / Edit ─────────────────────────────────────────────────────────────
  const loadActiveEmployees = async (allSelected, currentSelection = []) => {
    setEmployeesLoading(true);
    setEmployeeLoadError('');
    setEmployeeSearch('');
    try {
      const roles = user?.role === 'Admin' ? 'Employee,HR,Manager' : 'Employee,Manager';
      const { data } = await employeeAPI.getOptions({ roles });
      if (!data.success) throw new Error(data.message || 'Unable to load active employees.');
      const list = data.data || [];
      setActiveEmployees(list);
      const selection = new Set(currentSelection.map(String));
      const canonicalSelected = list
        .filter(employee => allSelected || selection.has(String(employee.userId)) || selection.has(String(employee.employeeId)) || selection.has(String(employee._id)))
        .map(employee => String(employee.userId));
      setForm(current => ({
        ...current,
        applicableUserIds: canonicalSelected,
      }));
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Unable to load active employees.';
      setEmployeeLoadError(message);
      toast.error(message);
    } finally {
      setEmployeesLoading(false);
    }
  };

  const openAdd = async () => {
    setEditHoliday(null);
    setForm(emptyForm);
    setFormErrors({});
    setFormOpen(true);
    await loadActiveEmployees(false);
  };

  const openEdit = async (h) => {
    setEditHoliday(h);
    const applicableAll = (h.applicableAll ?? true) && user?.role === 'Admin';
    setForm({
      holidayName: h.holidayName || '',
      type: h.type || '',
      date: h.date || '',
      startDate: h.startDate || h.date || '',
      endDate: h.endDate || '',
      dayOfWeek: h.recurrence?.dayOfWeek ?? '',
      dayOfMonth: h.recurrence?.dayOfMonth ?? '',
      description: h.description || '',
      paidStatus: h.paidStatus || 'Paid',
      status: h.status || 'active',
      applicableAll,
      applicableEmployees: h.applicableEmployees || [],
      applicableUserIds: (h.applicableUserIds || h.applicableEmployees || []).map(selectedUserId),
    });
    setFormErrors({});
    setFormOpen(true);
    await loadActiveEmployees(h.applicableAll ?? true, (h.applicableUserIds || h.applicableEmployees || []).map(selectedUserId));
  };

  const setField = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setFormErrors(e => ({ ...e, [k]: '' }));
  };

  const toggleEmployee = (userId) => {
    setForm(f => {
      const exists = f.applicableUserIds.includes(userId);
      const applicableUserIds = exists
        ? f.applicableUserIds.filter(id => id !== userId)
        : [...f.applicableUserIds, userId];
      const selected = new Set(applicableUserIds);
      const applicableAll = user?.role === 'Admin' && activeEmployees.length > 0
        && activeEmployees.every(employee => selected.has(String(employee.userId)));
      return {
        ...f,
        applicableAll,
        applicableUserIds,
      };
    });
  };

  const filteredEmployees = activeEmployees.filter(employee => {
    const query = employeeSearch.trim().toLowerCase();
    return !query || [
      employee.name,
      employee.employeeId,
      employee.department,
      employee.designation,
      employee.role,
    ].some(value => String(value || '').toLowerCase().includes(query));
  });
  const selectedEmployeeCount = activeEmployees.filter(employee =>
    form.applicableUserIds.includes(String(employee.userId))
  ).length;
  const allVisibleEmployeesSelected = filteredEmployees.length > 0
    && filteredEmployees.every(employee => form.applicableUserIds.includes(String(employee.userId)));

  const toggleVisibleEmployees = (checked) => {
    setForm(current => {
      const selected = new Set(current.applicableUserIds);
      filteredEmployees.forEach(employee => {
        const userId = String(employee.userId);
        if (checked) selected.add(userId);
        else selected.delete(userId);
      });
      const applicableUserIds = Array.from(selected);
      const selectedIds = new Set(applicableUserIds);
      const applicableAll = user?.role === 'Admin' && activeEmployees.length > 0
        && activeEmployees.every(employee => selectedIds.has(String(employee.userId)));
      return { ...current, applicableAll, applicableUserIds };
    });
  };

  const toggleAllEmployees = (checked) => {
    setForm(current => ({
      ...current,
      applicableAll: checked && user?.role === 'Admin',
      applicableUserIds: checked ? activeEmployees.map(employee => String(employee.userId)) : [],
    }));
  };

  // Mirror Property 12: name + type present and a valid rule for the type.
  const validateForm = () => {
    const errs = {};
    if (!form.holidayName.trim()) errs.holidayName = 'Enter a holiday name';
    if (!form.type) errs.type = 'Select a holiday type';

    if (needsDate(form.type)) {
      const startDate = form.startDate || form.date;
      if (!startDate) errs.startDate = 'Select a holiday from date';
      if (form.endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)
        || Number.isNaN(Date.parse(`${form.endDate}T00:00:00Z`))
        || new Date(`${form.endDate}T00:00:00Z`).toISOString().slice(0, 10) !== form.endDate)) {
        errs.endDate = 'Enter a valid holiday to date.';
      } else if (form.endDate && form.endDate < startDate) {
        errs.endDate = 'Holiday to date must be on or after from date';
      }
      if (startDate && (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)
        || Number.isNaN(Date.parse(`${startDate}T00:00:00Z`))
        || new Date(`${startDate}T00:00:00Z`).toISOString().slice(0, 10) !== startDate)) {
        errs.startDate = 'Enter a valid holiday from date.';
      }
    } else if (form.type === 'Weekly') {
      if (form.dayOfWeek === '' || form.dayOfWeek === null) errs.dayOfWeek = 'Select a day of week';
    } else if (form.type === 'Monthly') {
      const dom = Number(form.dayOfMonth);
      if (form.dayOfMonth === '' || Number.isNaN(dom) || dom < 1 || dom > 31) {
        errs.dayOfMonth = 'Enter a day of month (1-31)';
      }
    }

    if (!form.applicableAll && selectedEmployeeCount === 0) {
      errs.applicableUserIds = 'Select at least one user or choose all';
    }
    return errs;
  };

  const buildPayload = () => {
    const payload = {
      holidayName: form.holidayName.trim(),
      type: form.type,
      description: form.description,
      paidStatus: form.paidStatus,
      status: form.status,
      applicableAll: form.applicableAll,
      applicableEmployees: [],
      applicableUserIds: form.applicableAll ? [] : form.applicableUserIds,
      startDate: needsDate(form.type) ? (form.startDate || form.date) : null,
      endDate: needsDate(form.type) ? (form.endDate || null) : null,
      date: needsDate(form.type) ? (form.startDate || form.date) : null,
      recurrence: {
        dayOfWeek: form.type === 'Weekly' ? Number(form.dayOfWeek) : null,
        dayOfMonth: form.type === 'Monthly' ? Number(form.dayOfMonth) : null,
      },
    };
    return payload;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validateForm();
    if (Object.keys(errs).length > 0) { setFormErrors(errs); return; }

    setSubmitting(true);
    try {
      const payload = buildPayload();
      if (editHoliday) {
        await updateHoliday(recordId(editHoliday), payload);
        toast.success('Holiday updated successfully');
      } else {
        await addHoliday(payload);
        toast.success('Holiday added successfully');
      }
      setFormOpen(false);
      setForm(emptyForm);
    } catch (err) {
      // Retain the user's entered values on backend error (Req 17.2).
      if (err.response?.data?.errors) setFormErrors(err.response.data.errors);
      toast.error(err.response?.data?.message || err.message || 'Failed to save holiday');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteHoliday(recordId(deleteTarget));
      toast.success('Holiday cancelled');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete holiday');
    } finally {
      setDeleting(false);
    }
  };

  // ── Export (Req 12.2) — exports the currently filtered records ─────────────
  const handleExport = () => {
    const csv = toCsv(filtered, [
      { key: '_id', label: 'ID', accessor: shortId },
      { key: 'holidayName', label: 'Holiday Name' },
      { key: 'type', label: 'Type' },
      { key: 'rule', label: 'Rule', accessor: ruleSummary },
      { key: 'dateRange', label: 'Date Range', accessor: holidayDateLabel },
      { key: 'paidStatus', label: 'Paid Status' },
      { key: 'status', label: 'Status' },
      { key: 'applicable', label: 'Applicable', accessor: applicableSummary },
      { key: 'description', label: 'Description' },
    ]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `holidays-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} record${filtered.length === 1 ? '' : 's'}`);
  };

  // ── Print (Req 12.3) — printable rendering of the currently filtered records ─
  const handlePrint = () => {
    const rows = filtered.map(h => `
      <tr>
        <td>${escapeHtml(shortId(h))}</td>
        <td>${escapeHtml(h.holidayName)}</td>
        <td>${escapeHtml(h.type)}</td>
        <td>${escapeHtml(needsDate(h.type) ? holidayDateLabel(h) : ruleSummary(h))}</td>
        <td>${escapeHtml(h.paidStatus)}</td>
        <td>${escapeHtml(applicableSummary(h))}</td>
        <td>${escapeHtml(h.status)}</td>
      </tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) { toast.error('Unable to open print window'); return; }
    win.document.write(`
      <html>
        <head>
          <title>Holidays</title>
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
          <h1>Holidays</h1>
          <p>${filtered.length} record(s) · Generated ${new Date().toLocaleString()}</p>
          <table>
            <thead>
              <tr><th>ID</th><th>Name</th><th>Type</th><th>Date Range / Rule</th><th>Paid</th><th>Applicable</th><th>Status</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <script>window.onload = function () { window.print(); }</script>
        </body>
      </html>`);
    win.document.close();
  };

  const activeCount = records.filter(h => h.status === 'active').length;

  if (loading) return <SkeletonLoader />;

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb"><span>Holidays</span><span className="breadcrumb-sep">/</span><span>Holiday Records</span></div>
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Holiday Records</h1>
            <p className="page-subtitle">{activeCount} active holiday{activeCount === 1 ? '' : 's'}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={handlePrint} title="Print filtered records"><Printer size={14} /> Print</button>
            <button className="btn btn-outline" onClick={handleExport} title="Export filtered records"><Download size={14} /> Export</button>
            {canAdd && <button className="btn btn-primary" onClick={openAdd}><Plus size={14} /> Add Holiday</button>}
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
          { label: 'Total Holidays', value: records.length, color: 'var(--primary)' },
          { label: 'Active', value: activeCount, color: 'var(--success)' },
          { label: 'Recurring', value: records.filter(h => h.type === 'Weekly' || h.type === 'Monthly').length, color: 'var(--warning)' },
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
            <input className="form-control" placeholder="Search by name or ID..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <select className="form-control form-select" style={{ width: 140 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select className="form-control form-select" style={{ width: 160 }} value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">All Types</option>
            {HOLIDAY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th><th>Holiday Name</th><th>Type</th><th>Date Range / Rule</th>
              <th>Paid</th><th>Applicable</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(h => (
              <tr key={recordId(h)}>
                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{shortId(h)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CalendarDays size={16} color="var(--primary)" />
                    <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{h.holidayName}</span>
                  </div>
                </td>
                <td><span className="badge badge-info" style={{ fontSize: '0.75rem' }}>{h.type}</span></td>
                <td style={{ fontSize: '0.85rem' }}>{needsDate(h.type) ? holidayDateLabel(h) : ruleSummary(h)}</td>
                <td><span className={`badge ${h.paidStatus === 'Paid' ? 'badge-success' : 'badge-gray'}`} style={{ fontSize: '0.75rem' }}>{h.paidStatus}</span></td>
                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{applicableSummary(h)}</td>
                <td><Badge status={h.status} /></td>
                <td>
                  <div className="table-actions">
                    <button className="btn-icon primary" onClick={() => setViewHoliday(h)} title="View Details"><Eye size={13} /></button>
                    {canEdit && (
                      <button className="btn-icon" onClick={() => openEdit(h)} title="Edit"><Pencil size={13} /></button>
                    )}
                    {canDelete && (
                      <button className="btn-icon danger" onClick={() => setDeleteTarget(h)} title="Delete"><Trash2 size={13} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No holidays found</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={page} totalPages={totalPages} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {/* View Modal */}
      {viewHoliday && (
        <Modal open={true} onClose={() => setViewHoliday(null)} title="Holiday Details" size="md"
          footer={<button className="btn btn-outline" onClick={() => setViewHoliday(null)}>Close</button>}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '16px', background: 'var(--bg)', borderRadius: 10 }}>
            <CalendarDays size={28} color="var(--primary)" />
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>{viewHoliday.holidayName}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{viewHoliday.type} · {ruleSummary(viewHoliday)}</div>
              <Badge status={viewHoliday.status} style={{ marginTop: 4 }} />
            </div>
          </div>
          <div className="grid grid-2 grid-gap-sm">
            {[
              ['Holiday ID', shortId(viewHoliday)], ['Type', viewHoliday.type],
              ['Date Range / Rule', needsDate(viewHoliday.type) ? holidayDateLabel(viewHoliday) : ruleSummary(viewHoliday)], ['Paid Status', viewHoliday.paidStatus],
              ['Status', viewHoliday.status], ['Applicable To', applicableSummary(viewHoliday)],
            ].map(([k, v]) => (
              <div key={k} style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>{k}</div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{v}</div>
              </div>
            ))}
          </div>
          {!viewHoliday.applicableAll && selectedUsers(viewHoliday).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Selected Users</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selectedUsers(viewHoliday).map((selected, index) => (
                  <span key={selectedUserId(selected) || index} className="badge badge-gray" style={{ fontSize: '0.75rem' }}>
                    {selected?.name ? `${selected.name} · ${selected.employeeId || 'No Employee ID'} · ${selected.designation || selected.role || ''} · ${selected.department || 'No Department'}` : employeeName(selectedUserId(selected))}
                  </span>
                ))}
              </div>
            </div>
          )}
          {viewHoliday.description && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6 }}>Description</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, background: 'var(--bg)', borderRadius: 8, padding: 12 }}>{viewHoliday.description}</p>
            </div>
          )}
        </Modal>
      )}

      {/* Add / Edit Modal */}
      {formOpen && (
        <Modal open={true} onClose={() => setFormOpen(false)} title={editHoliday ? 'Edit Holiday' : 'Add Holiday'} size="md"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setFormOpen(false)} disabled={submitting}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || employeesLoading || Boolean(employeeLoadError)}>
                {submitting ? 'Saving...' : editHoliday ? 'Save Changes' : 'Add Holiday'}
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Holiday Name <span className="required">*</span></label>
              <input className={`form-control ${formErrors.holidayName ? 'error' : ''}`} value={form.holidayName} onChange={e => setField('holidayName', e.target.value)} placeholder="e.g. Diwali, Weekly Off" />
              {formErrors.holidayName && <div className="form-error">{formErrors.holidayName}</div>}
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Holiday Type <span className="required">*</span></label>
                <select className={`form-control form-select ${formErrors.type ? 'error' : ''}`} value={form.type} onChange={e => setField('type', e.target.value)}>
                  <option value="">Select type</option>
                  {HOLIDAY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {formErrors.type && <div className="form-error">{formErrors.type}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Paid Status</label>
                <select className="form-control form-select" value={form.paidStatus} onChange={e => setField('paidStatus', e.target.value)}>
                  {PAID_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            {/* Holiday_Rule inputs depend on type */}
            {needsDate(form.type) && (
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Holiday From Date <span className="required">*</span></label>
                  <input type="date" className={`form-control ${formErrors.startDate ? 'error' : ''}`} value={form.startDate || form.date} onChange={e => { setField('startDate', e.target.value); setField('date', e.target.value); }} />
                  {formErrors.startDate && <div className="form-error">{formErrors.startDate}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label">Holiday To Date (optional)</label>
                  <input type="date" min={form.startDate || form.date || undefined} className={`form-control ${formErrors.endDate ? 'error' : ''}`} value={form.endDate} onChange={e => setField('endDate', e.target.value)} />
                  {formErrors.endDate && <div className="form-error">{formErrors.endDate}</div>}
                </div>
                <div className="form-hint" style={{ gridColumn: '1 / -1' }}>
                  Total duration: {durationDays({ startDate: form.startDate || form.date, endDate: form.endDate || form.startDate || form.date })} day(s)
                </div>
              </div>
            )}
            {form.type === 'Weekly' && (
              <div className="form-group">
                <label className="form-label">Day of Week <span className="required">*</span></label>
                <select className={`form-control form-select ${formErrors.dayOfWeek ? 'error' : ''}`} value={form.dayOfWeek} onChange={e => setField('dayOfWeek', e.target.value)}>
                  <option value="">Select day</option>
                  {DAYS_OF_WEEK.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
                {formErrors.dayOfWeek && <div className="form-error">{formErrors.dayOfWeek}</div>}
              </div>
            )}
            {form.type === 'Monthly' && (
              <div className="form-group">
                <label className="form-label">Day of Month <span className="required">*</span></label>
                <input type="number" min={1} max={31} className={`form-control ${formErrors.dayOfMonth ? 'error' : ''}`} value={form.dayOfMonth} onChange={e => setField('dayOfMonth', e.target.value)} placeholder="1-31" />
                {formErrors.dayOfMonth && <div className="form-error">{formErrors.dayOfMonth}</div>}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-control form-select" value={form.status} onChange={e => setField('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            {/* User assignment */}
            <div className="form-group">
              <label className="form-label">Select Employee</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={user?.role === 'Admin'
                    ? form.applicableAll
                    : activeEmployees.length > 0 && activeEmployees.every(employee => form.applicableUserIds.includes(String(employee.userId)))}
                  onChange={e => toggleAllEmployees(e.target.checked)}
                />
                {user?.role === 'Admin' ? 'Select All Employees, HR, and Managers' : 'Select All Employees and Managers'}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                <div className="search-input-wrapper" style={{ flex: '1 1 200px' }}>
                  <Search size={14} className="search-icon" />
                  <input
                    className="form-control"
                    placeholder="Search name, ID, role, or department..."
                    value={employeeSearch}
                    onChange={event => setEmployeeSearch(event.target.value)}
                    disabled={employeesLoading || Boolean(employeeLoadError)}
                  />
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {selectedEmployeeCount} of {activeEmployees.length} selected
                </span>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => toggleAllEmployees(false)} disabled={!form.applicableUserIds.length}>Clear selection</button>
              </div>
              {employeeLoadError ? (
                <div className="form-error" role="alert">{employeeLoadError}</div>
              ) : (
                <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '8px 10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={allVisibleEmployeesSelected}
                        onChange={event => toggleVisibleEmployees(event.target.checked)}
                        disabled={employeesLoading || filteredEmployees.length === 0}
                      />
                      Select all shown ({filteredEmployees.length})
                    </label>
                  </div>
                  {employeesLoading ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: 10 }}>Loading active users...</div>
                  ) : filteredEmployees.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: 10 }}>
                      {activeEmployees.length ? 'No users match your search.' : 'No active users available.'}
                    </div>
                  ) : filteredEmployees.map(employee => {
                    const userId = String(employee.userId);
                    return (
                      <label key={userId} style={{ display: 'grid', gridTemplateColumns: '20px minmax(140px, 1.4fr) repeat(3, minmax(80px, 1fr))', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: '0.8rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={form.applicableUserIds.includes(userId)}
                          onChange={() => toggleEmployee(userId)}
                        />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontWeight: 600, color: 'var(--text-primary)' }}>{employee.name}</span>
                          <span style={{ display: 'block', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.72rem' }}>{employee.employeeId}</span>
                        </span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }} title={employee.role}>{employee.designation || employee.role}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }} title={employee.department}>
                          {employee.department || '—'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {formErrors.applicableUserIds && <div className="form-error">{formErrors.applicableUserIds}</div>}
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-control" rows={3} value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Optional notes about this holiday..." />
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Holiday"
        message={`Cancel "${deleteTarget?.holidayName || 'this holiday'}"? The holiday will be removed from assigned users' calendars, and its history will be retained.`}
        confirmLabel="Cancel Holiday"
        loading={deleting}
      />
    </div>
  );
};

export default HolidayRecords;
