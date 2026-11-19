import React, { useEffect, useMemo, useState } from 'react';
import { employeeAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const EmployeeSelect = ({
  roles,
  value,
  onChange,
  includeBlank = true,
  blankLabel = 'Select employee',
  className = 'form-control form-select',
  disabled = false,
  includeUnassigned = false,
  providedOptions,
  searchable = true,
  selectAll = false,
}) => {
  const { user } = useAuth();
  const [loadedOptions, setLoadedOptions] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const roleKey = (roles || []).join(',');
  const options = providedOptions || loadedOptions;
  const visibleOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter(option => [
      option.name, option.employeeId, option.email, option.role, option.department, option.designation,
    ].some(value => String(value || '').toLowerCase().includes(term)));
  }, [options, search]);

  useEffect(() => {
    if (providedOptions) {
      setLoading(false);
      setError('');
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError('');
    employeeAPI.getOptions({
      ...(roleKey ? { roles: roleKey } : {}),
      ...(includeUnassigned ? { includeUnassigned: true } : {}),
    })
      .then(({ data }) => {
        if (active && data.success) setLoadedOptions(data.data);
        else if (active) setError(data.message || 'Unable to load employee options.');
      })
      .catch(requestError => {
        if (active) setError(requestError.response?.data?.message || 'Unable to load employee options.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [includeUnassigned, providedOptions, roleKey, user?._id, user?.id]);

  return (
      <>
        {searchable && (
          <input
            type="search"
            className="form-control"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search by name, Employee ID, role, or department"
            aria-label="Search employees"
            disabled={disabled || loading || Boolean(error)}
            style={{ marginBottom: 8 }}
          />
        )}
        {Array.isArray(value) && selectAll && options.length > 0 && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ marginBottom: 8 }}
            disabled={disabled || loading || Boolean(error)}
            onClick={() => {
              const allSelected = options.every(option => value.map(String).includes(String(option.userId)));
              const selectedIds = allSelected ? [] : options.map(option => String(option.userId));
              onChange(selectedIds, allSelected ? [] : options);
            }}
          >
            {options.every(option => value.map(String).includes(String(option.userId))) ? 'Clear all' : 'Select all'}
          </button>
        )}
        <select
          className={className}
          value={Array.isArray(value) ? value.map(String) : String(value || '')}
          multiple={Array.isArray(value)}
          size={Array.isArray(value) ? 5 : undefined}
          onChange={event => {
            if (Array.isArray(value)) {
              const visibleIds = new Set(visibleOptions.map(option => String(option.userId)));
              const retainedIds = value.map(String).filter(id => !visibleIds.has(id));
              const selectedIds = Array.from(event.target.selectedOptions, option => option.value);
              const mergedIds = Array.from(new Set([...retainedIds, ...selectedIds]));
              onChange(mergedIds, options.filter(option => mergedIds.includes(String(option.userId))));
            } else {
              const option = options.find(item => String(item.userId) === event.target.value);
              onChange(event.target.value, option || null);
            }
          }}
          disabled={disabled || loading || Boolean(error)}
          aria-label="Select employee"
        >
          {!Array.isArray(value) && includeBlank && <option value="">{loading ? 'Loading employees…' : blankLabel}</option>}
          {visibleOptions.map(option => (
            <option key={option.userId} value={option.userId}>
              {option.name}{option.employeeId ? ` · ${option.employeeId}` : ''} · {option.role}{option.department ? ` · ${option.department}` : ''}
            </option>
          ))}
        </select>
        {!loading && !error && visibleOptions.length === 0 && (
          <div className="form-hint">{search ? 'No employees match your search.' : 'No eligible employees are available.'}</div>
        )}
        {Array.isArray(value) && visibleOptions.length > 0 && (
          <div className="form-hint">Use Ctrl or Command to select multiple employees.</div>
        )}
        {error && <div className="form-error">{error}</div>}
      </>
  );
};

export default EmployeeSelect;
