import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import Avatar from '../../components/shared/Avatar';
import Badge from '../../components/shared/Badge';
import { formatINR } from '../../utils/currency';
import { payrollAPI } from '../../services/api';
import toast from 'react-hot-toast';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const GeneratePayroll = () => {
  const { employees, payrollData, generatePayroll, departments } = useApp();
  const { can } = useAuth();
  const canGenerate = can('payroll', 'add');
  const [month,      setMonth]      = useState(MONTHS[new Date().getMonth()]);
  const [year,       setYear]       = useState(String(new Date().getFullYear()));
  const [deptFilter, setDeptFilter] = useState('');
  const [selected,   setSelected]   = useState([]);
  const [processing, setProcessing] = useState(false);
  const [calculations, setCalculations] = useState({});
  const [previewLoading, setPreviewLoading] = useState(false);

  const filteredEmps   = employees.filter(e => e.status === 'active' && (!deptFilter || e.department === deptFilter));
  const employeeIdsKey = filteredEmps.map(e => e.employeeId).filter(Boolean).join('|');
  const allSelected    = filteredEmps.length > 0 && selected.length === filteredEmps.length;

  const toggleSelect = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const toggleAll    = () => setSelected(allSelected ? [] : filteredEmps.map(e => e._id));

  useEffect(() => {
    let active = true;
    if (!employeeIdsKey) {
      setCalculations({});
      return () => { active = false; };
    }
    setPreviewLoading(true);
    payrollAPI.preview({ employeeIds: employeeIdsKey.split('|'), month, year: Number(year) })
      .then(({ data }) => {
        if (active && data.success) {
          setCalculations(Object.fromEntries(data.data.map(item => [item.employeeId, item])));
        }
      })
      .catch(err => {
        if (active) {
          setCalculations({});
          toast.error(err.response?.data?.message || 'Unable to calculate salary preview.');
        }
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => { active = false; };
  }, [employeeIdsKey, month, year]);

  const totalGross = Object.entries(filteredEmps
    .filter(employee => selected.includes(employee._id))
    .reduce((totals, employee) => {
      const calculation = calculations[employee.employeeId];
      if (!calculation) return totals;
      const currency = calculation.currency || employee.currency || 'UNVERIFIED';
      totals[currency] = (totals[currency] || 0) + calculation.gross;
      return totals;
    }, {}))
    .map(([currency, amount]) => formatINR(amount, { currency }))
    .join(' · ');
  const previewReady = selected.length > 0 && selected.every(id => {
    const employee = employees.find(item => item._id === id);
    return employee?.employeeId && calculations[employee.employeeId];
  });

  const handleGenerate = async () => {
    if (selected.length === 0) { toast.error('Select at least one employee'); return; }
    setProcessing(true);
    try {
      const emps = employees.filter(e => selected.includes(e._id));
      const payrollItems = emps.map(emp => {
        const paymentMonth = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
        return {
          employeeId: emp.employeeId,
          month,
          year: Number(year),
          paymentDate: `${year}-${paymentMonth}-28`,
        };
      });
      const result = await generatePayroll(payrollItems);
      toast.success(`Salary records generated for ${result.count} employee${result.count === 1 ? '' : 's'}`);
      if (result.warnings?.length) toast.error(result.warnings.join(' '));
      if (result.message) toast.error(result.message);
      setSelected([]);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to generate salaries. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb"><span>Salary Management</span><span className="breadcrumb-sep">/</span><span>Generate Salaries</span></div>
        <h1 className="page-title">Generate Salaries</h1>
        <p className="page-subtitle">Generate monthly salaries in each employee's verified currency</p>
      </div>

      {/* Controls */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ padding: 20 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
              <label className="form-label">Month</label>
              <select className="form-control form-select" value={month} onChange={e => setMonth(e.target.value)}>
                {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0, minWidth: 100 }}>
              <label className="form-label">Year</label>
              <select className="form-control form-select" value={year} onChange={e => setYear(e.target.value)}>
                {['2024','2025','2026','2027'].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0, minWidth: 180 }}>
              <label className="form-label">Department</label>
              <select className="form-control form-select" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                <option value="">All Departments</option>
                {departments.map(d => <option key={d._id || d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="badge badge-info">{selected.length} / {filteredEmps.length} selected</span>
              {selected.length > 0 && !previewLoading && (
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--success)' }}>
                  Total: {totalGross}
                </span>
              )}
              {previewLoading && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Calculating payroll…</span>}
            </div>
            {canGenerate && (
              <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}
                onClick={handleGenerate} disabled={processing || previewLoading || !previewReady}>
                {processing ? 'Generating…' : `Generate Salaries (${selected.length})`}
              </button>
            )}
          </div>
        </div>
      </div>

      {employees.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No employees found</div>
          <div className="empty-state-desc">Add employees before generating salaries.</div>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allSelected}
                    onChange={toggleAll} style={{ accentColor: 'var(--primary)' }} />
                </th>
                <th>Employee</th><th>Basic (Monthly)</th><th>HRA</th><th>Allowances</th>
                <th>Bonus</th><th>Deductions</th><th>Gross</th><th>Net Salary</th><th>Employer Contributions</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmps.map(emp => {
                const calc = calculations[emp.employeeId] || {};
                const existing = payrollData.find(
                  p => p.employeeId === emp.employeeId && p.month === month && p.year === Number(year)
                );
                return (
                  <tr key={emp._id} style={{ background: selected.includes(emp._id) ? 'var(--primary-light)' : '' }}>
                    <td>
                      <input type="checkbox" checked={selected.includes(emp._id)}
                        onChange={() => toggleSelect(emp._id)} style={{ accentColor: 'var(--primary)' }} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={emp.name} size="sm" />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{emp.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{emp.department}</div>
                        </div>
                      </div>
                    </td>
                    <td>{calc.basic == null ? '—' : formatINR(calc.basic, { currency: calc.currency })}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{calc.hra == null ? '—' : formatINR(calc.hra, { currency: calc.currency })}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{calc.allowances == null ? '—' : formatINR(calc.allowances, { currency: calc.currency })}</td>
                    <td style={{ color: 'var(--success)' }}>{calc.bonus == null ? '—' : formatINR(calc.bonus, { currency: calc.currency })}</td>
                    <td style={{ color: 'var(--danger)' }}>
                      {calc.gross == null ? '—' : (
                        <>
                          −{formatINR(calc.tax + calc.insurance + calc.otherDeductions + calc.advanceDeductions + calc.employeePF + calc.leaveDeduction, { currency: calc.currency })}
                          {(calc.paidLeaveDays > 0 || calc.unpaidLeaveDays > 0) && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              {calc.paidLeaveDays || 0} paid · {calc.unpaidLeaveDays || 0} unpaid leave day(s)
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td style={{ fontWeight: 600 }}>{calc.gross == null ? '—' : formatINR(calc.gross, { currency: calc.currency })}</td>
                    <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{calc.net == null ? '—' : formatINR(calc.net, { currency: calc.currency })}</td>
                    <td>{calc.gross == null ? '—' : formatINR(calc.employerPF + calc.insuranceEmployerContribution, { currency: calc.currency })}</td>
                    <td>
                      {existing
                        ? <Badge status={existing.status} />
                        : <span className="badge badge-gray">Not Generated</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default GeneratePayroll;
