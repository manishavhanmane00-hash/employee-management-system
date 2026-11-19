import React, { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Download, CheckCircle, DollarSign } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import Avatar from '../../components/shared/Avatar';
import Badge from '../../components/shared/Badge';
import { formatINR } from '../../utils/currency';
import { Payslip } from './Payslips';
import { downloadElementPdf } from '../../utils/documentExport';
import toast from 'react-hot-toast';

const PayrollHistory = () => {
  const { payrollData, approvePayroll, markPayrollPaid } = useApp();
  const { can } = useAuth();
  const canApprove = can('payroll', 'manage');
  const [filter, setFilter] = useState('');

  const pending  = payrollData.filter(p => p.status === 'pending').length;
  const approved = payrollData.filter(p => p.status === 'approved').length;
  const paid = payrollData.filter(p => p.status === 'paid').length;

  const filtered = payrollData.filter(p => !filter || p.status === filter);

  const getNet = p => p.net ?? Math.round(
    (p.basic || 0) + (p.hra || 0) + (p.allowances || 0) + (p.bonus || 0) + (p.overtimeEarnings || 0)
    - (p.tax || 0) - (p.insurance || 0) - (p.otherDeductions || 0)
    - (p.advanceDeductions || 0) - (p.employeePF || 0) - (p.leaveDeduction || 0)
  );

  const totalPayroll = Object.entries(filtered.reduce((totals, record) => {
    const currency = record.currency || 'UNVERIFIED';
    totals[currency] = (totals[currency] || 0) + getNet(record);
    return totals;
  }, {})).map(([currency, total]) => formatINR(total, { currency })).join(' · ') || formatINR(0);

  const exportCsv = () => {
    if (!filtered.length) return toast.error('There are no salary records to export.');
    const records = filtered.map(record => ({
      'Employee ID': record.employeeId || '',
      Employee: record.employeeName || '',
      Department: record.department || '',
      Period: `${record.month} ${record.year}`,
      Currency: record.currency || 'UNVERIFIED',
      Basic: record.basic ?? 0,
      Allowances: (record.hra || 0) + (record.allowances || 0),
      Bonus: record.bonus || 0,
      Deductions: (record.tax || 0) + (record.insurance || 0) + (record.otherDeductions || 0)
        + (record.advanceDeductions || 0) + (record.employeePF || 0) + (record.leaveDeduction || 0),
      Net: getNet(record),
      Status: record.status || '',
    }));
    const headers = Object.keys(records[0]);
    const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.map(quote).join(','), ...records.map(record => headers.map(header => quote(record[header])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `salary-history-${filter || 'all'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadPayslip = async payroll => {
    const employee = {
      name: payroll.employeeName || 'Employee',
      id: payroll.employeeId || '',
      department: payroll.department || '',
      designation: payroll.designation || '',
      paymentMethod: payroll.paymentMethod || 'Bank Transfer',
      bankName: payroll.bankName || '',
    };
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;background:#fff';
    try {
      container.innerHTML = renderToStaticMarkup(<Payslip employee={employee} payroll={payroll} />);
      const element = container.firstElementChild;
      if (!element) throw new Error('Unable to prepare the payslip for PDF export.');
      document.body.appendChild(container);
      const filename = `salary-slip-${String(employee.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${payroll.month}-${payroll.year}.pdf`;
      await downloadElementPdf(element, filename);
      toast.success('Payslip PDF downloaded.');
    } catch (error) {
      toast.error(error.message || 'Unable to download this payslip.');
    } finally {
      container.remove();
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb"><span>Salary Management</span><span className="breadcrumb-sep">/</span><span>Salary History</span></div>
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Salary History</h1>
            <p className="page-subtitle">Review, approve, and pay salary records · {approved} approved · {paid} paid</p>
          </div>
          <button className="btn btn-outline btn-sm" onClick={exportCsv}><Download size={14} /> Export CSV</button>
        </div>
      </div>

      <div className="grid grid-3 grid-gap-sm mb-5">
        {[
          { label: 'Total Salary (Shown)', value: totalPayroll, color: 'var(--primary)' },
          { label: 'Pending Approval',      value: pending,                 color: 'var(--warning)' },
          { label: 'Approved',              value: approved,                color: 'var(--success)' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 20, padding: '14px 20px' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {['', 'pending', 'approved', 'paid'].map(s => (
            <button key={s} className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter(s)}>
              {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
            </button>
          ))}
        </div>
      </div>

      {payrollData.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No salary records yet</div>
          <div className="empty-state-desc">Generate salaries from the Salary Management page to see records here.</div>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th><th>Employee</th><th>Period</th><th>Basic</th><th>Allowances</th>
                <th>Bonus</th><th>Deductions</th><th>Net Salary</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
            {filtered.map(p => {
                const net        = getNet(p);
                const deductions = (p.tax || 0) + (p.insurance || 0) + (p.otherDeductions || 0)
                  + (p.advanceDeductions || 0) + (p.employeePF || 0) + (p.leaveDeduction || 0);
                const pid        = p._id || p.id;
                return (
                  <tr key={pid}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {String(pid).slice(-8).toUpperCase()}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={p.employeeName} size="sm" />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{p.employeeName}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.department}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: '0.875rem' }}>{p.month} {p.year}</td>
                    <td>{formatINR(p.basic, { currency: p.currency })}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{formatINR((p.hra || 0) + (p.allowances || 0), { currency: p.currency })}</td>
                    <td style={{ color: 'var(--success)' }}>{formatINR(p.bonus || 0, { currency: p.currency })}</td>
                    <td style={{ color: 'var(--danger)' }}>
                      −{formatINR(deductions, { currency: p.currency })}
                      {(p.paidLeaveDays > 0 || p.unpaidLeaveDays > 0) && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {p.paidLeaveDays || 0} paid · {p.unpaidLeaveDays || 0} unpaid leave day(s)
                        </div>
                      )}
                    </td>
                    <td><span style={{ fontWeight: 700, color: 'var(--primary)' }}>{formatINR(net, { currency: p.currency })}</span></td>
                    <td><Badge status={p.status} /></td>
                    <td>
                      <div className="table-actions">
                        {p.status === 'pending' && canApprove && (
                          <button className="btn btn-sm btn-success"
                            onClick={async () => {
                              try {
                                await approvePayroll(pid);
                                toast.success(`Salary approved for ${p.employeeName}`);
                              } catch (err) {
                                toast.error(err.message || 'Failed to approve salary');
                              }
                            }}>
                            <CheckCircle size={12} /> Approve
                          </button>
                        )}
                        {p.status === 'approved' && canApprove && (
                          <button className="btn btn-sm btn-success"
                            onClick={async () => {
                              try {
                                await markPayrollPaid(pid);
                                toast.success(`Salary marked paid for ${p.employeeName}`);
                              } catch (err) {
                                toast.error(err.message || 'Failed to mark salary paid');
                              }
                            }}>
                            <DollarSign size={12} /> Mark Paid
                          </button>
                        )}
                        <button className="btn-icon" title="Download Payslip" onClick={() => downloadPayslip(p)}><Download size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No records match the selected filter</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
};

export default PayrollHistory;
