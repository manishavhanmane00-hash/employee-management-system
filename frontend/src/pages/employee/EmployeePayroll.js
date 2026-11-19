import React, { useState, useMemo } from 'react';
import { Printer, Download, DollarSign, TrendingUp, FileText } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import Badge from '../../components/shared/Badge';
import { formatINR } from '../../utils/currency';
import { downloadElementPdf, printElement } from '../../utils/documentExport';
import toast from 'react-hot-toast';

const TABS = ['Salary Overview', 'Salary History', 'Monthly Salary Slip'];

const InfoRow = ({ label, value, highlight, negative }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{label}</span>
    <span style={{ fontSize: '0.875rem', fontWeight: highlight ? 700 : 500, color: highlight ? 'var(--success)' : negative ? 'var(--danger)' : 'var(--text-primary)' }}>
      {value}
    </span>
  </div>
);

const PayslipView = ({ payroll, user }) => {
  const currency = { currency: payroll.currency };
  const gross = payroll.gross ?? ((payroll.basic || 0) + (payroll.hra || 0) + (payroll.allowances || 0) + (payroll.bonus || 0) + (payroll.overtimeEarnings || 0));
  const deductions = (payroll.tax || 0) + (payroll.insurance || 0) + (payroll.otherDeductions || 0)
    + (payroll.advanceDeductions || 0) + (payroll.employeePF || 0) + (payroll.leaveDeduction || 0);
  const net = payroll.net ?? (gross - deductions);

  return (
    <div id="payslip-print" style={{ background: 'white', padding: 32, fontFamily: 'Inter, sans-serif', maxWidth: 700, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, paddingBottom: 20, borderBottom: '2px solid #4f46e5' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, background: 'var(--primary)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: '1rem' }}>E</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}>EMS Portal</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Employee Management System</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ background: 'var(--primary-light)', color: 'var(--primary)', padding: '6px 14px', borderRadius: 20, fontSize: '0.875rem', fontWeight: 600 }}>SALARY SLIP</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{payroll.month} {payroll.year}</div>
        </div>
      </div>

      {/* Employee Info */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24, background: 'var(--bg)', borderRadius: 10, padding: 16 }}>
        <div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Employee Information</div>
          {[['Name', user?.name], ['Employee ID', user?.employeeId || '—'], ['Department', user?.department || '—'], ['Designation', user?.designation || '—']].map(([k,v]) => (
            <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 100, fontSize: '0.8rem', color: 'var(--text-muted)' }}>{k}:</span>
              <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{v}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Payment Details</div>
          {[['Pay Period', `${payroll.month} ${payroll.year}`], ['Payment Date', payroll.paymentDate || '—'], ['Payment Mode', 'Bank Transfer'], ['Status', payroll.status], ['Employer PF Contribution', formatINR(payroll.employerPF || 0, currency)], ['Paid Leave Days', payroll.paidLeaveDays || 0], ['Unpaid Leave Days', payroll.unpaidLeaveDays || 0]].map(([k,v]) => (
            <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 100, fontSize: '0.8rem', color: 'var(--text-muted)' }}>{k}:</span>
              <span style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'capitalize' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Earnings & Deductions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ background: '#d1fae5', borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: '0.75rem', fontWeight: 700, color: '#065f46', textTransform: 'uppercase' }}>Earnings</div>
          {[['Basic Salary', payroll.basic], ['HRA', payroll.hra], ['Allowances', payroll.allowances], ['Bonus', payroll.bonus], ['Overtime Earnings', payroll.overtimeEarnings]].map(([k,v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 4px', borderBottom: '1px solid #f1f5f9', fontSize: '0.825rem' }}>
              <span style={{ color: '#475569' }}>{k}</span>
              <span style={{ fontWeight: 600 }}>{formatINR(v || 0, currency)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 4px', fontSize: '0.875rem', fontWeight: 700, borderTop: '2px solid #d1fae5', marginTop: 4 }}>
            <span style={{ color: '#065f46' }}>Gross Earnings</span>
            <span style={{ color: '#10b981' }}>{formatINR(gross, currency)}</span>
          </div>
        </div>
        <div>
          <div style={{ background: '#fee2e2', borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: '0.75rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase' }}>Deductions</div>
          {[['Income Tax (TDS)', payroll.tax], ['Health Insurance', payroll.insurance], ['Other Deductions', payroll.otherDeductions], ['Employee PF Contribution', payroll.employeePF], ['Advance Deductions', payroll.advanceDeductions], ['Unpaid Leave Deduction', payroll.leaveDeduction]].map(([k,v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 4px', borderBottom: '1px solid #f1f5f9', fontSize: '0.825rem' }}>
              <span style={{ color: '#475569' }}>{k}</span>
              <span style={{ fontWeight: 600, color: '#ef4444' }}>−{formatINR(v || 0, currency)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 4px', fontSize: '0.875rem', fontWeight: 700, borderTop: '2px solid #fee2e2', marginTop: 4 }}>
            <span style={{ color: '#991b1b' }}>Total Deductions</span>
            <span style={{ color: '#ef4444' }}>−{formatINR(deductions, currency)}</span>
          </div>
        </div>
      </div>

      {/* Net Salary */}
      <div style={{ background: 'var(--primary)', borderRadius: 10, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'white', fontWeight: 600, fontSize: '1rem' }}>Net Salary</span>
        <span style={{ color: 'white', fontWeight: 800, fontSize: '1.5rem' }}>{formatINR(net, currency)}</span>
      </div>
      <div style={{ textAlign: 'center', marginTop: 16, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        Computer-generated salary slip — No signature required. Currency: {payroll.currency || 'UNVERIFIED'}.
      </div>
    </div>
  );
};

const EmployeePayroll = () => {
  const { payrollData } = useApp();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const formatPayrollMoney = (value, record) => formatINR(value, { currency: record?.currency });
  const [selectedPayslip, setSelectedPayslip] = useState(null);

  const myPayroll = useMemo(() =>
    payrollData
      .filter(p => String(p.userId || '') === String(user?._id || user?.id || '')
        || (user?.employeeId && p.employeeId === user.employeeId)
        || (user?.email && p.email === user.email))
      .sort((a, b) => {
        const aStr = `${a.year}-${String(a.month).padStart(2,'0')}`;
        const bStr = `${b.year}-${String(b.month).padStart(2,'0')}`;
        return bStr.localeCompare(aStr);
      }),
    [payrollData, user]
  );

  const latestPayroll = myPayroll[0] || null;

  const gross = latestPayroll
    ? (latestPayroll.gross ?? ((latestPayroll.basic||0)+(latestPayroll.hra||0)+(latestPayroll.allowances||0)+(latestPayroll.bonus||0)+(latestPayroll.overtimeEarnings||0)))
    : 0;
  const deductions = latestPayroll
    ? (latestPayroll.tax||0)+(latestPayroll.insurance||0)+(latestPayroll.otherDeductions||0)
      +(latestPayroll.advanceDeductions||0)+(latestPayroll.employeePF||0)+(latestPayroll.leaveDeduction||0)
    : 0;
  const net = latestPayroll?.net ?? (gross - deductions);

  const handlePrint = () => {
    try {
      printElement(document.getElementById('payslip-print'), 'Salary Slip');
    } catch (error) {
      toast.error(error.message || 'Unable to print this payslip.');
    }
  };

  const handleDownload = async () => {
    const payroll = selectedPayslip || latestPayroll;
    if (!payroll) return toast.error('No payslip is available to download.');
    const filename = `salary-slip-${String(user?.name || 'employee').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${payroll.month}-${payroll.year}.pdf`;
    try {
      await downloadElementPdf(document.getElementById('payslip-print'), filename);
      toast.success('Payslip PDF downloaded.');
    } catch (error) {
      toast.error(error.message || 'Unable to download this payslip.');
    }
  };

  const renderOverview = () => (
    <div>
      {latestPayroll ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-4 grid-gap-sm mb-6">
            {[
              { label: 'Basic Salary',     value: formatPayrollMoney(latestPayroll.basic || 0, latestPayroll), color: 'var(--primary)', bg: 'var(--primary-light)', icon: DollarSign },
              { label: 'Gross Salary',     value: formatPayrollMoney(gross, latestPayroll), color: 'var(--info)', bg: 'var(--info-light)', icon: TrendingUp },
              { label: 'Total Deductions', value: `−${formatPayrollMoney(deductions, latestPayroll)}`, color: 'var(--danger)', bg: 'var(--danger-light)', icon: FileText },
              { label: 'Net Salary',       value: formatPayrollMoney(net, latestPayroll), color: 'var(--success)', bg: 'var(--success-light)', icon: DollarSign },
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div className="stat-card-icon" style={{ background: s.bg }}>
                  <s.icon size={22} color={s.color} />
                </div>
                <div className="stat-card-value" style={{ color: s.color }}>{s.value}</div>
                <div className="stat-card-label">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-2 grid-gap-lg">
            <div className="card">
              <div className="card-header"><h3 className="card-title">Earnings Breakdown</h3></div>
              <div className="card-body">
                <InfoRow label="Basic Salary"       value={formatPayrollMoney(latestPayroll.basic || 0, latestPayroll)} />
                <InfoRow label="House Rent (HRA)"   value={formatPayrollMoney(latestPayroll.hra || 0, latestPayroll)} />
                <InfoRow label="Other Allowances"   value={formatPayrollMoney(latestPayroll.allowances || 0, latestPayroll)} />
                <InfoRow label="Bonus"              value={formatPayrollMoney(latestPayroll.bonus || 0, latestPayroll)} />
                <InfoRow label="Overtime Earnings"  value={formatPayrollMoney(latestPayroll.overtimeEarnings || 0, latestPayroll)} />
                <InfoRow label="Gross Salary"       value={formatPayrollMoney(gross, latestPayroll)} highlight />
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3 className="card-title">Deductions & Net Pay</h3></div>
              <div className="card-body">
                <InfoRow label="Income Tax (TDS)"   value={`−${formatPayrollMoney(latestPayroll.tax || 0, latestPayroll)}`} negative />
                <InfoRow label="Health Insurance"   value={`−${formatPayrollMoney(latestPayroll.insurance || 0, latestPayroll)}`} negative />
                <InfoRow label="Other Deductions"  value={`−${formatPayrollMoney(latestPayroll.otherDeductions || 0, latestPayroll)}`} negative />
                <InfoRow label="Employee PF"        value={`−${formatPayrollMoney(latestPayroll.employeePF || 0, latestPayroll)}`} negative />
                <InfoRow label="Advance Deductions" value={`−${formatPayrollMoney(latestPayroll.advanceDeductions || 0, latestPayroll)}`} negative />
                <InfoRow label="Unpaid Leave"       value={`−${formatPayrollMoney(latestPayroll.leaveDeduction || 0, latestPayroll)}`} negative />
                <InfoRow label="Paid Leave Days"    value={latestPayroll.paidLeaveDays || 0} />
                <InfoRow label="Unpaid Leave Days"  value={latestPayroll.unpaidLeaveDays || 0} />
                <InfoRow label="Total Deductions"   value={`−${formatPayrollMoney(deductions, latestPayroll)}`} negative />
                <InfoRow label="Net Salary"         value={formatPayrollMoney(net, latestPayroll)} highlight />
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-header"><h3 className="card-title">Payment Info</h3></div>
            <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <InfoRow label="Pay Period"    value={`${latestPayroll.month} ${latestPayroll.year || ''}`} />
              <InfoRow label="Payment Date"  value={latestPayroll.paymentDate || '—'} />
              <InfoRow label="Status"        value={<Badge status={latestPayroll.status} />} />
              <InfoRow label="Employer PF Contribution" value={formatPayrollMoney(latestPayroll.employerPF || 0, latestPayroll)} />
            </div>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>💰</div>
          <div className="empty-state-title">No salary records yet</div>
          <div className="empty-state-desc">Your salary information will appear here once a salary record is generated.</div>
        </div>
      )}
    </div>
  );

  const renderHistory = () => (
    <div>
      {myPayroll.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>📊</div>
          <div className="empty-state-title">No salary history</div>
          <div className="empty-state-desc">Salary records will appear here once generated.</div>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Gross Salary</th>
                <th>Deductions</th>
                <th>Net Salary</th>
                <th>Payment Date</th>
                <th>Status</th>
                <th>Payslip</th>
              </tr>
            </thead>
            <tbody>
              {myPayroll.map(p => {
                const g = p.gross ?? ((p.basic||0)+(p.hra||0)+(p.allowances||0)+(p.bonus||0)+(p.overtimeEarnings||0));
                const d = (p.tax||0)+(p.insurance||0)+(p.otherDeductions||0)+(p.advanceDeductions||0)+(p.employeePF||0)+(p.leaveDeduction||0);
                const n = p.net ?? (g - d);
                return (
                  <tr key={p._id || p.id}>
                    <td style={{ fontWeight: 600 }}>{p.month} {p.year}</td>
                    <td>{formatPayrollMoney(g, p)}</td>
                    <td style={{ color: 'var(--danger)' }}>−{formatPayrollMoney(d, p)}</td>
                    <td style={{ fontWeight: 700, color: 'var(--success)' }}>{formatPayrollMoney(n, p)}</td>
                    <td style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{p.paymentDate || '—'}</td>
                    <td><Badge status={p.status} /></td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => { setSelectedPayslip(p); setActiveTab(2); }}>
                        <FileText size={12} /> View
                      </button>
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

  const renderPayslip = () => (
    <div>
      {myPayroll.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🧾</div>
          <div className="empty-state-title">No payslips available</div>
          <div className="empty-state-desc">Payslips will appear here once payroll is generated</div>
        </div>
      ) : (
        <>
          {/* Select payslip */}
          <div className="card" style={{ marginBottom: 16, padding: '12px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, whiteSpace: 'nowrap' }}>Select Payslip:</label>
              <select
                className="form-control form-select"
                style={{ maxWidth: 240 }}
                value={selectedPayslip ? (selectedPayslip._id || selectedPayslip.id) : (latestPayroll ? (latestPayroll._id || latestPayroll.id) : '')}
                onChange={e => setSelectedPayslip(myPayroll.find(p => (p._id || p.id) === e.target.value) || null)}
              >
                {myPayroll.map(p => (
                  <option key={p._id || p.id} value={p._id || p.id}>{p.month} {p.year}</option>
                ))}
              </select>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn btn-outline btn-sm" onClick={handlePrint}><Printer size={14} /> Print</button>
                <button className="btn btn-primary btn-sm" onClick={handleDownload}><Download size={14} /> Download PDF</button>
              </div>
            </div>
          </div>
          <PayslipView payroll={selectedPayslip || latestPayroll} user={user} />
        </>
      )}
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">My Salary</h1>
        <p className="page-subtitle">View your salary information and payslips</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="tabs" style={{ padding: '0 24px' }}>
          {TABS.map((t, i) => (
            <div key={t} className={`tab ${activeTab === i ? 'active' : ''}`} onClick={() => setActiveTab(i)}>{t}</div>
          ))}
        </div>
        <div className="card-body">
          {activeTab === 0 && renderOverview()}
          {activeTab === 1 && renderHistory()}
          {activeTab === 2 && renderPayslip()}
        </div>
      </div>
    </div>
  );
};

export default EmployeePayroll;
