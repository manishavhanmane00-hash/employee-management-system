import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit2, Plus, Search, Trash2, Users } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { designationAPI } from '../../services/api';
import Modal, { ConfirmModal } from '../../components/shared/Modal';
import Badge from '../../components/shared/Badge';
import toast from 'react-hot-toast';

const EMPTY_ROLE = { name: '', department: '', description: '', status: 'active' };

const RoleForm = ({ initial, departments, saving, onSave, onClose }) => {
  const [form, setForm] = useState(() => initial ? {
    name: initial.name,
    department: initial.department,
    description: initial.description || '',
    status: initial.status,
  } : EMPTY_ROLE);
  const assigned = Boolean(initial?.employeeCount);
  const change = (field, value) => setForm(current => ({ ...current, [field]: value }));

  return (
    <form onSubmit={event => { event.preventDefault(); onSave(form); }}>
      {assigned && <div className="alert alert-info" role="status">This designation is assigned to employees. Its name and department are locked to preserve those assignments.</div>}
      <div className="form-group">
        <label className="form-label" htmlFor="role-name">Role / Designation Name <span className="required">*</span></label>
        <input id="role-name" className="form-control" required maxLength={120} value={form.name}
          onChange={event => change('name', event.target.value)} placeholder="e.g. Senior Software Engineer" disabled={assigned || saving} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="role-department">Department <span className="required">*</span></label>
        <select id="role-department" className="form-control form-select" required value={form.department}
          onChange={event => change('department', event.target.value)} disabled={assigned || saving}>
          <option value="">Select department</option>
          {departments.filter(department => department.status === 'active' || department.name === initial?.department)
            .map(department => <option key={department._id} value={department.name}>{department.name}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="role-description">Description</label>
        <textarea id="role-description" className="form-control" rows={3} maxLength={1000} value={form.description}
          onChange={event => change('description', event.target.value)} placeholder="Describe the role responsibilities." disabled={saving} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="role-status">Status</label>
        <select id="role-status" className="form-control form-select" value={form.status}
          onChange={event => change('status', event.target.value)} disabled={saving}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div className="modal-footer" style={{ margin: '0 -24px -24px', borderTop: '1px solid var(--border)' }}>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim() || !form.department}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add role'}
        </button>
      </div>
    </form>
  );
};

const Roles = () => {
  const { employees, departments } = useApp();
  const { can } = useAuth();
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canAdd = can('departments', 'add');
  const canEdit = can('departments', 'edit');
  const canDelete = can('departments', 'delete');

  const loadRoles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await designationAPI.getAll({ includeInactive: true });
      setRoles(data.data || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load roles and designations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const rows = useMemo(() => {
    const catalogKeys = new Set(roles.map(role => `${role.name.trim().toLocaleLowerCase()}\u0000${role.department.trim().toLocaleLowerCase()}`));
    const legacy = new Map();
    employees.forEach(employee => {
      const name = String(employee.designation || employee.position || '').trim();
      const department = String(employee.department || '').trim();
      if (!name) return;
      const key = `${name.toLocaleLowerCase()}\u0000${department.toLocaleLowerCase()}`;
      if (!catalogKeys.has(key) && !legacy.has(key)) {
        legacy.set(key, { _id: `legacy-${key}`, name, department, description: 'Existing employee assignment', status: 'legacy', employeeCount: 0, legacy: true });
      }
    });
    return [...roles, ...legacy.values()].map(role => ({
      ...role,
      employeeCount: role.legacy ? employees.filter(employee => (
        String(employee.designation || employee.position || '').trim().toLocaleLowerCase() === role.name.toLocaleLowerCase()
        && String(employee.department || '').trim().toLocaleLowerCase() === role.department.toLocaleLowerCase()
      )).length : role.employeeCount || 0,
    })).sort((first, second) => first.department.localeCompare(second.department) || first.name.localeCompare(second.name));
  }, [employees, roles]);

  const filtered = rows.filter(role => {
    const query = search.trim().toLowerCase();
    return (!query || `${role.name} ${role.department} ${role.description || ''}`.toLowerCase().includes(query))
      && (!deptFilter || role.department === deptFilter);
  });
  const availableDepartments = [...new Set([
    ...departments.map(department => department.name),
    ...rows.map(role => role.department),
  ].filter(Boolean))].sort();

  const closeModal = () => { setModalOpen(false); setEditItem(null); };
  const saveRole = async form => {
    setSaving(true);
    try {
      const response = editItem
        ? await designationAPI.update(editItem._id, form)
        : await designationAPI.create(form);
      if (!response.data.success) throw new Error(response.data.message || 'Unable to save designation.');
      await loadRoles();
      toast.success(editItem ? 'Role / designation updated.' : 'Role / designation added.');
      closeModal();
    } catch (requestError) {
      const message = requestError.response?.data?.message || requestError.message || 'Unable to save role / designation.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRole = async () => {
    if (!deleteItem) return;
    setSaving(true);
    try {
      const { data } = await designationAPI.delete(deleteItem._id);
      if (!data.success) throw new Error(data.message || 'Unable to delete designation.');
      await loadRoles();
      toast.success('Role / designation deleted.');
      setDeleteItem(null);
    } catch (requestError) {
      const message = requestError.response?.data?.message || requestError.message || 'Unable to delete role / designation.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb"><span>Employees</span><span className="breadcrumb-sep">/</span><span>Roles & Designations</span></div>
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Roles & Designations</h1>
            <p className="page-subtitle">{rows.length} designations across employee departments</p>
          </div>
          {canAdd && <button type="button" className="btn btn-primary" onClick={() => { setEditItem(null); setModalOpen(true); }}>
            <Plus size={14} /> Add Role
          </button>}
        </div>
      </div>

      {error && <div className="alert alert-danger" role="alert">{error}<button type="button" className="btn btn-ghost" onClick={() => setError('')}>Dismiss</button></div>}

      <div className="card" style={{ marginBottom: 20, padding: '14px 20px' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="search-input-wrapper" style={{ flex: 1 }}>
            <Search size={14} className="search-icon" />
            <input className="form-control" placeholder="Search roles..." value={search} onChange={event => setSearch(event.target.value)} />
          </div>
          <select className="form-control form-select" style={{ width: 220 }} value={deptFilter} onChange={event => setDeptFilter(event.target.value)} aria-label="Filter by department">
            <option value="">All Departments</option>
            {availableDepartments.map(department => <option key={department} value={department}>{department}</option>)}
          </select>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead><tr><th>#</th><th>Role / Designation</th><th>Department</th><th>Description</th><th>Employees</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}>Loading roles…</td></tr>
              : filtered.map((role, index) => <tr key={role._id}>
                <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{index + 1}</td>
                <td><span style={{ fontWeight: 600 }}>{role.name}</span>{role.legacy && <div className="form-hint">Legacy employee assignment</div>}</td>
                <td><span className="badge badge-primary" style={{ fontSize: '0.75rem' }}>{role.department || 'Unassigned'}</span></td>
                <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', maxWidth: 300 }}>{role.description || '—'}</td>
                <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}><Users size={14} /> {role.employeeCount}</span></td>
                <td>{role.legacy ? <span className="badge badge-gray">Legacy</span> : <Badge status={role.status} />}</td>
                <td><div className="table-actions">
                  {!role.legacy && canEdit && <button type="button" className="btn-icon" title="Edit role" onClick={() => { setEditItem(role); setModalOpen(true); }}><Edit2 size={13} /></button>}
                  {!role.legacy && canDelete && <button type="button" className="btn-icon danger" title={role.employeeCount ? 'Reassign employees before deleting' : 'Delete role'} onClick={() => setDeleteItem(role)}><Trash2 size={13} /></button>}
                  {role.legacy && <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Manage on employee profile</span>}
                </div></td>
              </tr>)}
            {!loading && filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              {search || deptFilter ? 'No matching roles found.' : 'No roles have been added yet.'}
            </td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={closeModal} title={editItem ? 'Edit Role / Designation' : 'Add Role / Designation'} size="md">
        <RoleForm key={editItem?._id || 'new-role'} initial={editItem} departments={departments} saving={saving} onSave={saveRole} onClose={closeModal} />
      </Modal>
      <ConfirmModal
        open={Boolean(deleteItem)}
        onClose={() => setDeleteItem(null)}
        onConfirm={deleteRole}
        loading={saving}
        title="Delete Role / Designation"
        message={`Delete "${deleteItem?.name}" from ${deleteItem?.department}? Existing employee assignments cannot be deleted.`}
        confirmLabel="Delete"
      />
    </div>
  );
};

export default Roles;
