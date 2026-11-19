import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, Plus, Search, Settings, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { benefitsAPI } from '../../services/api';
import Avatar from '../../components/shared/Avatar';
import Badge from '../../components/shared/Badge';
import Modal, { ConfirmModal } from '../../components/shared/Modal';
import Pagination from '../../components/shared/Pagination';
import SkeletonLoader from '../../components/shared/SkeletonLoader';
import EmployeeSelect from '../../components/shared/EmployeeSelect';
import { formatINR } from '../../utils/currency';
import toast from 'react-hot-toast';

const PAGE_SIZE = 10;
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const today = () => new Date().toISOString().slice(0, 10);
const displayEmployeeId = value => String(value || '').startsWith('USER-') ? '—' : value || '—';
const emptyAllowance = () => ({ userId: '', employeeId: '', type: '', amount: '', currency: 'INR', frequency: 'Monthly', effectiveFrom: today(), effectiveTo: '', description: '' });
const emptyPFProfile = () => ({ userId: '', employeeId: '', pfAccountNumber: '', uanNumber: '', enrollmentDate: today(), basicSalary: '', currency: 'INR', isEligible: true, isApplicable: true, exemptionReason: '' });
const emptyPFConfig = () => ({ effectiveFrom: today(), effectiveTo: '', employeeRate: '', employerRate: '', epsRate: '', edliRate: '', currency: 'INR', salaryBasis: 'basicSalary', wageCeiling: '', notes: '' });
const emptyInsurance = () => ({ userId: '', employeeId: '', type: '', provider: '', policyNumber: '', startDate: today(), expiryDate: '', sumInsured: '', premiumAmount: '', currency: 'INR', premiumFrequency: 'Yearly', employerContribution: '', employeeContribution: '', coverageDetails: '', beneficiariesText: '[]' });

const StatCard = ({ label, value, color = 'var(--primary)' }) => (
  <div className="stat-card">
    <div style={{ fontSize: '1.45rem', fontWeight: 700, color }}>{value}</div>
    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{label}</div>
  </div>
);

const Field = ({ label, value, onChange, type = 'text', options, required, min, step, placeholder, disabled, error }) => (
  <div className="form-group">
    <label className="form-label">{label}{required && <span className="required"> *</span>}</label>
    {options ? (
      <select className={`form-control form-select${error ? ' error' : ''}`} value={value} onChange={onChange} required={required} disabled={disabled}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    ) : type === 'textarea' ? (
      <textarea className={`form-control${error ? ' error' : ''}`} rows={3} value={value} onChange={onChange} required={required} placeholder={placeholder} disabled={disabled} />
    ) : (
      <input className={`form-control${error ? ' error' : ''}`} type={type} value={value} onChange={onChange} required={required} min={min} step={step} placeholder={placeholder} disabled={disabled} aria-invalid={Boolean(error)} />
    )}
    {error && <div className="form-error" role="alert">{error}</div>}
  </div>
);

const BenefitsPage = ({ module }) => {
  const { user, can, canAccess } = useAuth();
  const isEmployee = user?.role === 'Employee';
  const isManager = user?.role === 'Manager';
  const prefix = module === 'allowances' ? 'allowances' : module;
  const canAdd = !isEmployee && !isManager && can(prefix, 'add');
  const canEdit = !isEmployee && !isManager && can(prefix, 'edit');
  const canDelete = !isEmployee && !isManager && can(prefix, 'delete');
  const canConfigurePF = module === 'pf' && can('pf', 'manage');
  const canCalculatePF = module === 'pf' && !isEmployee && !isManager && can('pf', 'manage');
  const canViewPFConfig = canAccess('pf.settings') || can('pf', 'manage');
  const hideManagerPFAmounts = isManager && !canAccess('pf.sensitive');
  const hideManagerInsuranceAmounts = isManager && !canAccess('insurance.sensitive');

  const [records, setRecords] = useState([]);
  const [eligibleUsers, setEligibleUsers] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [currentPFConfiguration, setCurrentPFConfiguration] = useState(null);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyAllowance());
  const [configOpen, setConfigOpen] = useState(false);
  const [configForm, setConfigForm] = useState(emptyPFConfig());
  const [configErrors, setConfigErrors] = useState({});
  const [editingConfig, setEditingConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [documentFiles, setDocumentFiles] = useState({});

  const loadEligibleUsers = useCallback(async () => {
    if (!canAdd && !canEdit) return;
    try {
      const { data } = await benefitsAPI.getEligibleUsers(module, canAdd ? 'add' : 'edit');
      if (!data.success) throw new Error('Unable to load active user accounts.');
      setEligibleUsers(data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Unable to load active user accounts.');
    }
  }, [canAdd, canEdit, module]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (module === 'allowances') {
        const [result, typeResult] = await Promise.all([
          benefitsAPI.getAllowances(),
          benefitsAPI.getAllowanceTypes(),
        ]);
        if (!result.data.success || !typeResult.data.success) throw new Error('Unable to load allowance data.');
        setRecords(result.data.data);
        setTypes(typeResult.data.data);
      } else if (module === 'pf') {
        const [result, configResult] = await Promise.all([
          benefitsAPI.getPFRecords(),
          canViewPFConfig ? benefitsAPI.getPFConfiguration() : Promise.resolve({ data: { data: [] } }),
        ]);
        if (!result.data.success) throw new Error('Unable to load PF records.');
        setRecords(result.data.data.profiles || []);
        setContributions(result.data.data.contributions || []);
        setConfigs(configResult.data.data || []);
        setCurrentPFConfiguration(result.data.data.currentConfiguration || null);
      } else {
        const result = await benefitsAPI.getInsurance();
        if (!result.data.success) throw new Error('Unable to load insurance records.');
        setRecords(result.data.data);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Unable to load benefits data.');
    } finally {
      setLoading(false);
    }
  }, [module, canViewPFConfig]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { loadEligibleUsers(); }, [loadEligibleUsers]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter(record => {
      const matchesSearch = !term || [
        record.employeeName, record.employeeId, record.department,
        record.type, record.provider, record.policyNumber,
      ].some(value => String(value || '').toLowerCase().includes(term));
      const matchesFilter = !filter
        || (module === 'allowances' ? record.type === filter
          : module === 'insurance' ? record.status === filter
            : record.department === filter);
      const matchesRole = !roleFilter || record.employeeRole === roleFilter;
      const matchesDate = module !== 'pf' || (
        (!fromDate || (record.enrollmentDate && record.enrollmentDate >= fromDate))
        && (!toDate || (record.enrollmentDate && record.enrollmentDate <= toDate))
      );
      return matchesSearch && matchesFilter && matchesRole && matchesDate;
    });
  }, [records, search, filter, roleFilter, fromDate, toDate, module]);
  const visibleContributions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contributions.filter(record => {
      const period = `${record.year}-${String(monthNames.indexOf(record.month) + 1).padStart(2, '0')}`;
      const matchesSearch = !term || [record.employeeName, record.employeeId, record.department, record.employeeRole]
        .some(value => String(value || '').toLowerCase().includes(term));
      const matchesRole = !roleFilter || record.employeeRole === roleFilter;
      const matchesDepartment = !filter || record.department === filter;
      const matchesDate = (!fromDate || period >= fromDate.slice(0, 7))
        && (!toDate || period <= toDate.slice(0, 7));
      return matchesSearch && matchesRole && matchesDepartment && matchesDate;
    });
  }, [contributions, search, roleFilter, filter, fromDate, toDate]);
  const sortedContributions = [...visibleContributions].sort((a, b) =>
    Number(b.year) - Number(a.year) || monthNames.indexOf(b.month) - monthNames.indexOf(a.month)
  );
  const latestContribution = sortedContributions[0];
  const totalPages = Math.ceil(visible.length / PAGE_SIZE);
  const rows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const money = (value, currency) => formatINR(Number(value || 0), { currency });
  const moneyTotal = (items, selectValue) => {
    const totals = items.reduce((grouped, record) => {
      const currency = record.currency || 'UNVERIFIED';
      grouped[currency] = (grouped[currency] || 0) + Number(selectValue(record) || 0);
      return grouped;
    }, {});
    return Object.entries(totals).map(([currency, value]) => money(value, currency)).join(' · ') || money(0, 'INR');
  };

  const openNew = () => {
    setEditing(null);
    setForm(module === 'allowances' ? emptyAllowance() : module === 'pf' ? emptyPFProfile() : emptyInsurance());
    loadEligibleUsers();
    setModalOpen(true);
  };
  const openEdit = record => {
    setEditing(record);
    const selectedUserId = record.userId
      ? String(record.userId)
      : eligibleUsers.find(item => item.employeeId && item.employeeId === record.employeeId)?.userId || '';
    setForm(module === 'allowances'
      ? { ...record, userId: selectedUserId, employeeId: record.employeeId || '', amount: String(record.amount) }
      : module === 'pf'
        ? { ...record, userId: selectedUserId, employeeId: record.employeeId || '', basicSalary: String(record.basicSalary || '') }
        : { ...record, userId: selectedUserId, employeeId: record.employeeId || '', beneficiariesText: JSON.stringify(record.beneficiaries || [], null, 2) });
    setModalOpen(true);
  };
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));

  const save = async event => {
    event.preventDefault();
    setSaving(true);
    try {
      if (module === 'allowances') {
        const data = { ...form, amount: Number(form.amount) };
        if (editing) await benefitsAPI.updateAllowance(editing._id, data);
        else await benefitsAPI.createAllowance(data);
      } else if (module === 'pf') {
        const data = { ...form, basicSalary: form.basicSalary === '' ? undefined : Number(form.basicSalary) };
        if (editing) await benefitsAPI.updatePFProfile(editing.employeeId, data);
        else await benefitsAPI.savePFProfile(data);
      } else {
        const data = {
          ...form,
          sumInsured: Number(form.sumInsured),
          premiumAmount: Number(form.premiumAmount),
          employerContribution: Number(form.employerContribution || 0),
          employeeContribution: Number(form.employeeContribution || 0),
          beneficiaries: JSON.parse(form.beneficiariesText || '[]'),
        };
        delete data.beneficiariesText;
        if (editing) await benefitsAPI.updateInsurance(editing._id, data);
        else await benefitsAPI.createInsurance(data);
      }
      toast.success(`${module === 'allowances' ? 'Allowance' : module === 'pf' ? 'PF profile' : 'Insurance policy'} saved`);
      setModalOpen(false);
      await reload();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Unable to save record.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    setSaving(true);
    try {
      if (module === 'allowances') await benefitsAPI.deactivateAllowance(confirmTarget._id);
      else await benefitsAPI.setInsuranceStatus(confirmTarget._id, { status: 'Inactive' });
      toast.success(module === 'allowances' ? 'Allowance deactivated' : 'Policy deactivated');
      setConfirmTarget(null);
      await reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Unable to update record.');
    } finally {
      setSaving(false);
    }
  };

  const openPFConfig = config => {
    setEditingConfig(config || null);
    setConfigErrors({});
    setConfigForm(config ? {
      effectiveFrom: config.effectiveFrom || '',
      effectiveTo: config.effectiveTo || '',
      currency: config.currency || 'UNVERIFIED',
      employeeRate: String(config.employeeRate ?? ''),
      employerRate: String(config.employerRate ?? ''),
      epsRate: String(config.epsRate ?? ''),
      edliRate: String(config.edliRate ?? ''),
      salaryBasis: config.salaryBasis || 'basicSalary',
      wageCeiling: config.wageCeiling == null ? '' : String(config.wageCeiling),
      notes: config.notes || '',
    } : emptyPFConfig());
    setConfigOpen(true);
  };

  const savePFConfig = async event => {
    if (event?.preventDefault) event.preventDefault();
    const errors = {};
    const numericValues = {};
    for (const [key, label] of Object.entries({
      employeeRate: 'Employee PF rate',
      employerRate: 'Employer total rate',
      epsRate: 'EPS rate',
      edliRate: 'EDLI rate',
    })) {
      const value = configForm[key] === '' ? NaN : Number(configForm[key]);
      if (!Number.isFinite(value)) errors[key] = `${label} is required and must be a valid number.`;
      else if (value < 0 || value > 100) errors[key] = `${label} must be between 0 and 100%.`;
      else numericValues[key] = value;
    }
    if (configForm.wageCeiling !== '' && (!Number.isFinite(Number(configForm.wageCeiling)) || Number(configForm.wageCeiling) <= 0)) {
      errors.wageCeiling = 'Wage ceiling must be a positive amount or left blank.';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(configForm.effectiveFrom)
      || Number.isNaN(Date.parse(`${configForm.effectiveFrom}T00:00:00Z`))
      || new Date(`${configForm.effectiveFrom}T00:00:00Z`).toISOString().slice(0, 10) !== configForm.effectiveFrom) {
      errors.effectiveFrom = 'Enter a valid Effective From date.';
    }
    if (configForm.effectiveTo && (
      !/^\d{4}-\d{2}-\d{2}$/.test(configForm.effectiveTo)
      || Number.isNaN(Date.parse(`${configForm.effectiveTo}T00:00:00Z`))
      || new Date(`${configForm.effectiveTo}T00:00:00Z`).toISOString().slice(0, 10) !== configForm.effectiveTo
    )) {
      errors.effectiveTo = 'Enter a valid Effective To date or leave it blank.';
    } else if (configForm.effectiveTo && configForm.effectiveTo < configForm.effectiveFrom) {
      errors.effectiveTo = 'Effective To must be on or after Effective From.';
    }
    if (!['basicSalary', 'grossSalary'].includes(configForm.salaryBasis)) {
      errors.salaryBasis = 'Select Basic salary or Gross salary.';
    }
    if (configForm.notes.length > 2000) errors.notes = 'Rule notes must be 2000 characters or fewer.';
    if (['employerRate', 'epsRate', 'edliRate'].every(key => Number.isFinite(numericValues[key]))
      && numericValues.epsRate + numericValues.edliRate > numericValues.employerRate + 1e-9) {
      const message = `EPS (${numericValues.epsRate}%) plus EDLI (${numericValues.edliRate}%) exceeds Employer Total (${numericValues.employerRate}%).`;
      errors.employerRate = message;
      errors.epsRate = message;
      errors.edliRate = message;
    }
    if (!['INR', 'USD'].includes(configForm.currency)) errors.currency = 'Select the verified currency for the PF rule.';
    setConfigErrors(errors);
    if (Object.keys(errors).length) {
      toast.error('Please correct the highlighted PF rule fields.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...configForm,
        ...numericValues,
        effectiveTo: configForm.effectiveTo || null,
        wageCeiling: configForm.wageCeiling === '' ? null : Number(configForm.wageCeiling),
      };
      if (editingConfig) await benefitsAPI.updatePFConfiguration(editingConfig._id, payload);
      else await benefitsAPI.createPFConfiguration(payload);
      toast.success(editingConfig ? 'PF configuration updated' : 'PF configuration added');
      setConfigOpen(false);
      setEditingConfig(null);
      setConfigForm(emptyPFConfig());
      setConfigErrors({});
      await reload();
    } catch (err) {
      setConfigErrors(err.response?.data?.errors || {});
      toast.error(err.response?.data?.message || 'Unable to save PF configuration.');
    } finally {
      setSaving(false);
    }
  };

  const calculatePF = async profile => {
    try {
      const month = monthNames[new Date().getMonth()];
      await benefitsAPI.calculatePF({ employeeId: profile.employeeId, userId: profile.userId, month, year: new Date().getFullYear() });
      toast.success(`PF contribution recorded for ${profile.employeeName}`);
      await reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Unable to calculate PF contribution.');
    }
  };

  const uploadDocument = async policy => {
    const file = documentFiles[policy._id];
    if (!file) return toast.error('Choose a PDF, PNG, or JPEG file first.');
    if (file.size > 5 * 1024 * 1024) return toast.error('Document must be smaller than 5 MB.');
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Unable to read the selected document.'));
        reader.readAsDataURL(file);
      });
      await benefitsAPI.uploadInsuranceDocument(policy._id, { name: file.name, mimeType: file.type, data });
      toast.success('Policy document uploaded');
      setDocumentFiles(current => ({ ...current, [policy._id]: null }));
      await reload();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Unable to upload document.');
    }
  };

  const downloadDocument = async (policy, document) => {
    try {
      const response = await benefitsAPI.downloadInsuranceDocument(policy._id, document.filename);
      const url = URL.createObjectURL(response.data);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.originalName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Unable to download policy document.');
    }
  };

  if (loading) return <SkeletonLoader />;

  const title = module === 'allowances' ? 'Allowance Management' : module === 'pf' ? 'Provident Fund Management' : 'Insurance Management';
  const pageTitle = module === 'pf' && isEmployee ? 'My PF' : title;
  const activeAllowances = records.filter(record => record.isActive);
  const activePolicies = records.filter(record => record.status === 'Active');
  const expiredPolicies = records.filter(record => record.status === 'Expired' || record.expiryDate < today());
  const expirySoon = activePolicies.filter(record => {
    const days = (new Date(`${record.expiryDate}T00:00:00Z`) - new Date(`${today()}T00:00:00Z`)) / 86400000;
    return days >= 0 && days <= 30;
  });

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb"><span>Employee Benefits</span><span className="breadcrumb-sep">/</span><span>{pageTitle}</span></div>
        <div className="page-header-top">
          <div><h1 className="page-title">{pageTitle}</h1><p className="page-subtitle">{module === 'pf' && isEmployee ? 'Your PF account and contribution history' : 'Employee benefit records and contribution history'}</p></div>
          <div style={{ display: 'flex', gap: 8 }}>
            {canConfigurePF && <button className="btn btn-outline" onClick={() => openPFConfig()}><Settings size={14} /> PF Rules</button>}
            {canAdd && <button className="btn btn-primary" onClick={openNew}><Plus size={14} /> {module === 'allowances' ? 'Add Allowance' : module === 'pf' ? 'Enroll Employee' : 'Add Policy'}</button>}
          </div>
        </div>
      </div>

      {error && <div className="card" style={{ padding: 14, marginBottom: 16, color: 'var(--danger)' }}><AlertCircle size={16} /> {error} <button className="btn btn-outline btn-sm" onClick={reload}>Retry</button></div>}

      {module === 'allowances' && (
        <div className="grid grid-4 grid-gap-sm mb-5">
          <StatCard label="Total Allowances" value={records.length} />
          <StatCard label="Monthly Equivalent" value={moneyTotal(activeAllowances, record => record.frequency === 'Yearly' ? record.amount / 12 : record.amount)} />
          <StatCard label="Yearly Equivalent" value={moneyTotal(activeAllowances, record => (record.frequency === 'Yearly' ? record.amount : record.amount * 12))} color="var(--success)" />
          <StatCard label="Employees Receiving" value={new Set(activeAllowances.map(record => record.employeeId)).size} color="var(--warning)" />
        </div>
      )}
      {module === 'pf' && (
        <div className="grid grid-4 grid-gap-sm mb-5">
          <StatCard label="Enrolled Employees" value={records.filter(record => record.isApplicable && record.isEligible).length} />
          <StatCard label="PF Records" value={contributions.length} />
          <StatCard label="Employee Contributions" value={hideManagerPFAmounts ? 'Restricted' : moneyTotal(contributions, record => record.employeeContribution)} color="var(--warning)" />
          <StatCard label="Employer Contributions" value={hideManagerPFAmounts ? 'Restricted' : moneyTotal(contributions, record => record.employerContribution)} color="var(--success)" />
        </div>
      )}
      {module === 'insurance' && (
        <div className="grid grid-4 grid-gap-sm mb-5">
          <StatCard label="Insured Employees" value={new Set(activePolicies.map(record => record.employeeId)).size} />
          <StatCard label="Active Policies" value={activePolicies.length} color="var(--success)" />
          <StatCard label="Expired Policies" value={expiredPolicies.length} color="var(--danger)" />
          <StatCard label="Expiring in 30 Days" value={expirySoon.length} color="var(--warning)" />
          <StatCard label="Total Premium" value={hideManagerInsuranceAmounts ? 'Restricted' : moneyTotal(records, record => record.premiumAmount)} />
          <StatCard label="Employer Share" value={hideManagerInsuranceAmounts ? 'Restricted' : moneyTotal(records, record => record.employerContribution)} color="var(--success)" />
          <StatCard label="Employee Share" value={hideManagerInsuranceAmounts ? 'Restricted' : moneyTotal(records, record => record.employeeContribution)} color="var(--warning)" />
        </div>
      )}

      {module === 'pf' && !error && !currentPFConfiguration && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <ShieldCheck size={18} /> No PF rule is currently effective. Contributions will not be calculated until an authorized Admin adds an effective-dated rule.
        </div>
      )}
      {module === 'pf' && currentPFConfiguration && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            {!hideManagerPFAmounts && <div><strong>Applicable PF rates</strong><div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>Employee {currentPFConfiguration.employeeRate}% · Employer {currentPFConfiguration.employerRate}%</div></div>}
            <div><strong>Effective date</strong><div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{currentPFConfiguration.effectiveFrom}{currentPFConfiguration.effectiveTo ? ` – ${currentPFConfiguration.effectiveTo}` : ' onward'}</div></div>
          </div>
        </div>
      )}
      {module === 'pf' && !hideManagerPFAmounts && contributions.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div><strong>Total PF Contribution</strong><div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{moneyTotal(contributions, record => Number(record.employeeContribution || 0) + Number(record.employerContribution || 0))}</div></div>
          {latestContribution && <div><strong>Latest monthly contribution</strong><div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{latestContribution.month} {latestContribution.year} · Employee {money(latestContribution.employeeContribution, latestContribution.currency)} · Employer {money(latestContribution.employerContribution, latestContribution.currency)}</div></div>}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, padding: '14px 18px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="search-input-wrapper" style={{ flex: 1, minWidth: 220 }}>
            <Search size={14} className="search-icon" />
            <input className="form-control" placeholder="Search employee, ID, department..." value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
          </div>
          {module === 'allowances' && <select className="form-control form-select" style={{ maxWidth: 260 }} value={filter} onChange={event => setFilter(event.target.value)}><option value="">All allowance types</option>{types.map(type => <option key={type._id} value={type.name}>{type.name}</option>)}</select>}
          {module === 'insurance' && <select className="form-control form-select" style={{ maxWidth: 180 }} value={filter} onChange={event => setFilter(event.target.value)}><option value="">All statuses</option>{['Active', 'Inactive', 'Terminated', 'Expired'].map(status => <option key={status}>{status}</option>)}</select>}
          {module === 'pf' && <select className="form-control form-select" style={{ maxWidth: 220 }} value={filter} onChange={event => setFilter(event.target.value)}><option value="">All departments</option>{[...new Set(records.map(record => record.department).filter(Boolean))].map(department => <option key={department}>{department}</option>)}</select>}
          {module === 'pf' && <select className="form-control form-select" style={{ maxWidth: 180 }} value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="">All roles</option>{['Employee', 'HR', 'Manager'].map(role => <option key={role}>{role}</option>)}</select>}
          {module === 'pf' && <input className="form-control" style={{ maxWidth: 170 }} aria-label="PF enrollment from date" type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} />}
          {module === 'pf' && <input className="form-control" style={{ maxWidth: 170 }} aria-label="PF enrollment to date" type="date" min={fromDate || undefined} value={toDate} onChange={event => setToDate(event.target.value)} />}
        </div>
      </div>

      {records.length === 0 ? (
        <div className="empty-state"><div className="empty-state-title">No {module === 'pf' ? 'PF profiles' : module === 'insurance' ? 'insurance policies' : 'allowances'} found</div><div className="empty-state-desc">Records created by authorized staff will appear here.</div></div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              {module === 'allowances' ? <tr><th>Employee</th><th>Employee ID</th><th>Department</th><th>Type</th><th>Amount</th><th>Frequency</th><th>Effective Period</th><th>Status</th><th>Actions</th></tr>
                : module === 'pf' ? <tr><th>Employee</th><th>Employee ID</th><th>Department</th><th>PF Account</th><th>UAN</th><th>Enrollment</th><th>Eligibility</th><th>Actions</th></tr>
                  : <tr><th>Employee</th><th>Employee ID</th><th>Policy</th><th>Provider</th><th>Policy Number</th><th>Coverage</th><th>Expiry</th><th>Status</th><th>Documents</th><th>Actions</th></tr>}
            </thead>
            <tbody>
              {rows.map(record => (
                module === 'allowances' ? (
                  <tr key={record._id}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={record.employeeName} size="sm" />{record.employeeName}</div></td>
                    <td>{displayEmployeeId(record.employeeId)}</td><td>{record.department || '—'}</td><td>{record.type}</td>
                    <td>{money(record.amount, record.currency)}</td><td>{record.frequency}</td><td>{record.effectiveFrom}{record.effectiveTo ? ` – ${record.effectiveTo}` : ' onward'}</td>
                    <td><Badge status={record.isActive ? 'active' : 'inactive'} /></td>
                    <td><div className="table-actions">{canEdit && <button className="btn btn-outline btn-sm" onClick={() => openEdit(record)}>Edit</button>}{canDelete && record.isActive && <button className="btn-icon danger" title="Deactivate" onClick={() => setConfirmTarget(record)}><Trash2 size={14} /></button>}</div></td>
                  </tr>
                ) : module === 'pf' ? (
                  <tr key={record._id}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={record.employeeName} size="sm" />{record.employeeName}</div></td>
                    <td>{displayEmployeeId(record.employeeId)}</td><td>{record.department || '—'}</td>
                    <td>{record.pfAccountNumber || '—'}</td><td>{record.uanNumber || '—'}</td><td>{record.enrollmentDate || '—'}</td>
                    <td><Badge status={record.isApplicable && record.isEligible ? 'active' : 'inactive'} /></td>
                    <td><div className="table-actions">{canEdit && <button className="btn btn-outline btn-sm" onClick={() => openEdit(record)}>Edit</button>}{canCalculatePF && <button className="btn btn-outline btn-sm" onClick={() => calculatePF(record)}>Calculate {monthNames[new Date().getMonth()]}</button>}</div></td>
                  </tr>
                ) : (
                  <tr key={record._id}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={record.employeeName} size="sm" />{record.employeeName}</div></td>
                    <td>{displayEmployeeId(record.employeeId)}</td><td>{record.type}</td><td>{record.provider}</td><td>{record.policyNumber || '—'}</td>
                    <td>{money(record.sumInsured, record.currency)}</td><td>{record.expiryDate}</td><td><Badge status={record.status} /></td>
                    <td><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{record.documents?.map(doc => <button key={doc.filename} className="btn btn-outline btn-sm" onClick={() => downloadDocument(record, doc)}><Download size={12} /> {doc.originalName}</button>)}{canEdit && <><input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={event => setDocumentFiles(current => ({ ...current, [record._id]: event.target.files?.[0] || null }))} /><button className="btn btn-outline btn-sm" onClick={() => uploadDocument(record)}><Upload size={12} /> Upload</button></>}</div></td>
                    <td><div className="table-actions">{canEdit && <button className="btn btn-outline btn-sm" onClick={() => openEdit(record)}>Edit / Renew</button>}{canDelete && record.status === 'Active' && <button className="btn-icon danger" title="Deactivate" onClick={() => setConfirmTarget(record)}><Trash2 size={14} /></button>}</div></td>
                  </tr>
                )
              ))}
              {visible.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No records match your search.</td></tr>}
            </tbody>
          </table>
          <Pagination currentPage={page} totalPages={totalPages} totalItems={visible.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
      )}

      {module === 'pf' && hideManagerPFAmounts && contributions.length > 0 && (
        <div className="card" style={{ marginTop: 24, padding: 16, color: 'var(--text-muted)' }}>
          Contribution amounts are restricted by your sensitive-information permissions.
        </div>
      )}
      {module === 'pf' && !hideManagerPFAmounts && sortedContributions.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header"><h3 className="card-title">Contribution History</h3></div>
          <div className="table-container"><table className="table"><thead><tr><th>Employee</th><th>Period</th><th>Rule Effective From</th><th>Rates (Employee / Employer)</th><th>Wage Basis</th><th>Employee</th><th>Employer EPF</th><th>EPS</th><th>EDLI</th><th>Total Employer</th></tr></thead><tbody>
            {sortedContributions.map(record => <tr key={record._id}><td>{record.employeeName} · {displayEmployeeId(record.employeeId)}</td><td>{record.month} {record.year}</td><td>{record.configuration?.effectiveFrom || '—'}</td><td>{record.employeeRate}% / {record.employerRate}%</td><td>{money(record.wageBasis, record.currency)}</td><td>{money(record.employeeContribution, record.currency)}</td><td>{money(record.employerEpfContribution, record.currency)}</td><td>{money(record.epsContribution, record.currency)}</td><td>{money(record.edliContribution, record.currency)}</td><td>{money(record.employerContribution, record.currency)}</td></tr>)}
          </tbody></table></div>
        </div>
      )}

      {module === 'pf' && configs.length > 0 && canConfigurePF && (
        <div className="card" style={{ marginTop: 24, padding: 16 }}>
          <h3 className="card-title">Effective-dated PF rules</h3>
          {configs.map(config => <div key={config._id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>{config.effectiveFrom}{config.effectiveTo ? ` – ${config.effectiveTo}` : ' onward'}: Employee {config.employeeRate}%, Employer {config.employerRate}% (EPF/EPS/EDLI {config.employerRate - config.epsRate - config.edliRate}% / {config.epsRate}% / {config.edliRate}%), ceiling {config.wageCeiling == null ? 'none' : money(config.wageCeiling, config.currency)}
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: 3 }}>Created by {config.createdBy?.name || 'Admin'} · {new Date(config.createdAt).toLocaleString()}{config.updatedBy ? ` · Updated by ${config.updatedBy.name || 'Admin'} ${new Date(config.updatedAt).toLocaleString()}` : ''}</div>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => openPFConfig(config)}>Edit</button>
          </div>)}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={`${editing ? 'Edit' : 'Add'} ${module === 'allowances' ? 'Allowance' : module === 'pf' ? 'PF Employee Details' : 'Insurance Policy'}`} size="lg"
        footer={<><button className="btn btn-outline" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></>}>
        <form onSubmit={save}>
          <div className="form-group">
            <label className="form-label">Employee<span className="required"> *</span></label>
            <EmployeeSelect
              value={form.userId || ''}
              providedOptions={eligibleUsers}
              blankLabel="Select active user"
              disabled={Boolean(editing)}
              onChange={(userId, selected) => {
                change('userId', userId);
                change('employeeId', selected?.employeeId || '');
              }}
            />
          </div>
          <Field label="Currency" value={form.currency || 'INR'} onChange={event => change('currency', event.target.value)} options={[
            ...(form.currency === 'UNVERIFIED' ? [{ value: 'UNVERIFIED', label: 'Unverified — select currency' }] : []),
            { value: 'INR', label: 'Indian Rupee (INR)' },
            { value: 'USD', label: 'US Dollar (USD)' },
          ]} required />
          {module === 'allowances' && <>
            <Field label="Allowance Type" value={form.type || ''} onChange={event => change('type', event.target.value)} required options={[{ value: '', label: 'Select type' }, ...types.map(type => ({ value: type.name, label: type.name }))]} />
            <button type="button" className="btn btn-outline btn-sm" onClick={async () => {
              const name = window.prompt('New allowance type name');
              if (!name?.trim()) return;
              try { await benefitsAPI.createAllowanceType({ name: name.trim() }); toast.success('Allowance type added'); await reload(); }
              catch (err) { toast.error(err.response?.data?.message || 'Unable to add type'); }
            }}>Add custom allowance type</button>
            <Field label="Allowance Amount" type="number" min="0.01" step="0.01" value={form.amount || ''} onChange={event => change('amount', event.target.value)} required />
            <Field label="Frequency" value={form.frequency || 'Monthly'} onChange={event => change('frequency', event.target.value)} options={['Monthly', 'Yearly'].map(value => ({ value, label: value }))} required />
            <Field label="Effective From" type="date" value={form.effectiveFrom || ''} onChange={event => change('effectiveFrom', event.target.value)} required />
            <Field label="Effective To (optional)" type="date" value={form.effectiveTo || ''} onChange={event => change('effectiveTo', event.target.value)} />
            <Field label="Description / Remarks" type="textarea" value={form.description || ''} onChange={event => change('description', event.target.value)} />
          </>}
          {module === 'pf' && <>
            <Field label="PF Account Number" value={form.pfAccountNumber || ''} onChange={event => change('pfAccountNumber', event.target.value)} />
            <Field label="UAN Number" value={form.uanNumber || ''} onChange={event => change('uanNumber', event.target.value)} />
            <Field label="PF Enrollment Date" type="date" value={form.enrollmentDate || ''} onChange={event => change('enrollmentDate', event.target.value)} />
            <Field label="Monthly Basic Salary (optional; defaults from employee salary)" type="number" min="0" step="0.01" value={form.basicSalary || ''} onChange={event => change('basicSalary', event.target.value)} />
            <Field label="Eligibility" value={form.isEligible === false ? 'false' : 'true'} onChange={event => change('isEligible', event.target.value === 'true')} options={[{ value: 'true', label: 'Eligible' }, { value: 'false', label: 'Not eligible' }]} />
            <Field label="PF Applicability" value={form.isApplicable === false ? 'false' : 'true'} onChange={event => change('isApplicable', event.target.value === 'true')} options={[{ value: 'true', label: 'Applicable' }, { value: 'false', label: 'Exempt / disabled' }]} />
            {form.isApplicable === false && <Field label="Exemption Reason" type="textarea" value={form.exemptionReason || ''} onChange={event => change('exemptionReason', event.target.value)} />}
          </>}
          {module === 'insurance' && <>
            <Field label="Insurance Type" value={form.type || ''} onChange={event => change('type', event.target.value)} required placeholder="Enter policy type" />
            <Field label="Provider" value={form.provider || ''} onChange={event => change('provider', event.target.value)} required />
            <Field label="Policy Number" value={form.policyNumber || ''} onChange={event => change('policyNumber', event.target.value)} required />
            <Field label="Policy Start Date" type="date" value={form.startDate || ''} onChange={event => change('startDate', event.target.value)} required />
            <Field label="Policy Expiry Date" type="date" value={form.expiryDate || ''} onChange={event => change('expiryDate', event.target.value)} required />
            <Field label="Sum Insured" type="number" min="0" step="0.01" value={form.sumInsured || ''} onChange={event => change('sumInsured', event.target.value)} required />
            <Field label="Premium Amount" type="number" min="0" step="0.01" value={form.premiumAmount || ''} onChange={event => change('premiumAmount', event.target.value)} required />
            <Field label="Premium Frequency" value={form.premiumFrequency || 'Yearly'} onChange={event => change('premiumFrequency', event.target.value)} options={['Monthly', 'Yearly'].map(value => ({ value, label: value }))} />
            <Field label="Employer Contribution" type="number" min="0" step="0.01" value={form.employerContribution || ''} onChange={event => change('employerContribution', event.target.value)} />
            <Field label="Employee Contribution" type="number" min="0" step="0.01" value={form.employeeContribution || ''} onChange={event => change('employeeContribution', event.target.value)} />
            <Field label="Coverage Details" type="textarea" value={form.coverageDetails || ''} onChange={event => change('coverageDetails', event.target.value)} />
            <Field label="Beneficiaries (JSON array: name, relationship, sharePercent)" type="textarea" value={form.beneficiariesText || '[]'} onChange={event => change('beneficiariesText', event.target.value)} />
            {editing && <Field label="Policy Status" value={form.status || 'Active'} onChange={event => change('status', event.target.value)} options={['Active', 'Inactive', 'Terminated', 'Expired'].map(value => ({ value, label: value }))} />}
          </>}
        </form>
      </Modal>

      {configOpen && (
        <Modal open onClose={() => setConfigOpen(false)} title={`${editingConfig ? 'Edit' : 'Configure'} Effective-Dated PF Rules`} size="lg"
          footer={<><button className="btn btn-outline" onClick={() => setConfigOpen(false)} disabled={saving}>Cancel</button><button className="btn btn-primary" onClick={savePFConfig} disabled={saving}>{saving ? 'Saving…' : editingConfig ? 'Save Changes' : 'Save Rules'}</button></>}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>Enter values confirmed by your authorized payroll/legal administrator. EPS and EDLI together cannot exceed the Employer Total Rate; the remaining employer share is calculated as employer EPF.</p>
          <form onSubmit={savePFConfig}>
            <Field label="PF Rule Currency" value={configForm.currency || 'INR'} onChange={event => { setConfigForm(current => ({ ...current, currency: event.target.value })); setConfigErrors({}); }} options={[
              ...(configForm.currency === 'UNVERIFIED' ? [{ value: 'UNVERIFIED', label: 'Unverified — select currency' }] : []),
              { value: 'INR', label: 'Indian Rupee (INR)' },
              { value: 'USD', label: 'US Dollar (USD)' },
            ]} required error={configErrors.currency} />
            <Field label="Effective From" type="date" value={configForm.effectiveFrom} onChange={event => { setConfigForm(current => ({ ...current, effectiveFrom: event.target.value })); setConfigErrors({}); }} required disabled={Boolean(editingConfig && contributions.some(item => String(item.configuration?._id || item.configuration) === String(editingConfig._id)))} error={configErrors.effectiveFrom} />
            <Field label="Effective To (optional)" type="date" min={configForm.effectiveFrom} value={configForm.effectiveTo} onChange={event => { setConfigForm(current => ({ ...current, effectiveTo: event.target.value })); setConfigErrors({}); }} error={configErrors.effectiveTo} />
            <Field label="Employee PF Rate (%)" type="number" min="0" step="any" value={configForm.employeeRate} onChange={event => { setConfigForm(current => ({ ...current, employeeRate: event.target.value })); setConfigErrors({}); }} required disabled={Boolean(editingConfig && contributions.some(item => String(item.configuration?._id || item.configuration) === String(editingConfig._id)))} error={configErrors.employeeRate} />
            <Field label="Employer Total Rate (%)" type="number" min="0" step="any" value={configForm.employerRate} onChange={event => { setConfigForm(current => ({ ...current, employerRate: event.target.value })); setConfigErrors({}); }} required disabled={Boolean(editingConfig && contributions.some(item => String(item.configuration?._id || item.configuration) === String(editingConfig._id)))} error={configErrors.employerRate} />
            <Field label="EPS Rate (%)" type="number" min="0" step="any" value={configForm.epsRate} onChange={event => { setConfigForm(current => ({ ...current, epsRate: event.target.value })); setConfigErrors({}); }} required disabled={Boolean(editingConfig && contributions.some(item => String(item.configuration?._id || item.configuration) === String(editingConfig._id)))} error={configErrors.epsRate} />
            <Field label="EDLI Rate (%)" type="number" min="0" step="any" value={configForm.edliRate} onChange={event => { setConfigForm(current => ({ ...current, edliRate: event.target.value })); setConfigErrors({}); }} required disabled={Boolean(editingConfig && contributions.some(item => String(item.configuration?._id || item.configuration) === String(editingConfig._id)))} error={configErrors.edliRate} />
            <Field label="Applicable Salary Basis" value={configForm.salaryBasis || 'basicSalary'} onChange={event => { setConfigForm(current => ({ ...current, salaryBasis: event.target.value })); setConfigErrors({}); }} options={[{ value: 'basicSalary', label: 'Basic salary' }, { value: 'grossSalary', label: 'Gross salary' }]} disabled={Boolean(editingConfig && contributions.some(item => String(item.configuration?._id || item.configuration) === String(editingConfig._id)))} error={configErrors.salaryBasis} />
            <Field label="Applicable Wage Ceiling (leave blank for none)" type="number" min="0" step="any" value={configForm.wageCeiling} onChange={event => { setConfigForm(current => ({ ...current, wageCeiling: event.target.value })); setConfigErrors({}); }} disabled={Boolean(editingConfig && contributions.some(item => String(item.configuration?._id || item.configuration) === String(editingConfig._id)))} error={configErrors.wageCeiling} />
            <Field label="Rule Notes" type="textarea" value={configForm.notes} onChange={event => { setConfigForm(current => ({ ...current, notes: event.target.value })); setConfigErrors({}); }} disabled={Boolean(editingConfig && contributions.some(item => String(item.configuration?._id || item.configuration) === String(editingConfig._id)))} error={configErrors.notes} />
          </form>
        </Modal>
      )}

      <ConfirmModal open={!!confirmTarget} onClose={() => setConfirmTarget(null)} onConfirm={deactivate} title="Deactivate Record" message={`Deactivate this ${module === 'allowances' ? 'allowance' : 'insurance policy'}? Existing historical records will be retained.`} confirmLabel="Deactivate" loading={saving} />
    </div>
  );
};

export default BenefitsPage;
