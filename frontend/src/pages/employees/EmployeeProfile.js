import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Edit2, Download, Mail, Phone, MapPin, Calendar, Briefcase, Building2, Star, FileText } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import Avatar from '../../components/shared/Avatar';
import Badge from '../../components/shared/Badge';
import { formatINR } from '../../utils/currency';
import { authAPI, benefitsAPI, employeeAPI } from '../../services/api';
import toast from 'react-hot-toast';

const TABS = ['Personal Info', 'Employment', 'Attendance', 'Leave', 'Salary', 'Benefits', 'Performance', 'Documents'];

const InfoRow = ({ label, value }) => (
  <div style={{ display: 'flex', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
    <span style={{ width: 180, flexShrink: 0, fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
    <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{value || '—'}</span>
  </div>
);

const StatMini = ({ label, value, color = 'var(--primary)' }) => (
  <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
    <div style={{ fontSize: '1.4rem', fontWeight: 700, color, marginBottom: 4 }}>{value}</div>
    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}</div>
  </div>
);

const EmployeeProfile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { employees, attendanceData, leaveRequests, payrollData, performanceReviews } = useApp();
  const { user, can, canAccess } = useAuth();
  const canLinkAccount = ['Admin', 'HR'].includes(user?.role) && can('employees', 'edit');
  const visibleTabs = user?.role === 'Admin' || canAccess('payroll.allRecords')
    ? TABS
    : TABS.filter(tab => tab !== 'Salary');
  const [activeTab, setActiveTab] = useState(0);
  const [benefits, setBenefits] = useState({ allowances: [], profiles: [], contributions: [], insurance: [] });
  const [benefitsLoading, setBenefitsLoading] = useState(false);
  const [employeeAccounts, setEmployeeAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [showAccountLinker, setShowAccountLinker] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [linkingAccount, setLinkingAccount] = useState(false);
  const [linkedAccountId, setLinkedAccountId] = useState('');
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);

  const emp = employees.find(e => e._id === id || e._id?.toString() === id);
  useEffect(() => {
    setLinkedAccountId(emp?.userId?.toString?.() || '');
  }, [emp?._id, emp?.userId]);

  useEffect(() => {
    let active = true;
    if (!linkedAccountId) {
      setDocuments([]);
      setDocumentsLoading(false);
      return undefined;
    }
    setDocumentsLoading(true);
    authAPI.getEmployeeOnboardingDocuments(linkedAccountId)
      .then(({ data }) => {
        if (active && data.success) setDocuments(data.data || []);
      })
      .catch(error => {
        if (active) toast.error(error.response?.data?.message || 'Unable to load employee documents.');
      })
      .finally(() => {
        if (active) setDocumentsLoading(false);
      });
    return () => { active = false; };
  }, [linkedAccountId]);

  const openEmployeeDocument = async (document, download = false) => {
    try {
      const { data } = await authAPI.downloadOnboardingDocument(linkedAccountId, document.id);
      const url = URL.createObjectURL(data);
      if (download) {
        const link = window.document.createElement('a');
        link.href = url;
        link.download = document.name;
        link.click();
      } else {
        const tab = window.open(url, '_blank');
        if (!tab) throw new Error('Allow pop-ups to view this document.');
        tab.opener = null;
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to access this document.');
    }
  };

  const loadEmployeeAccounts = async () => {
    setAccountsLoading(true);
    try {
      const { data } = await employeeAPI.getEmployeeAccounts();
      if (data.success) {
        const accounts = data.data || [];
        setEmployeeAccounts(accounts);
        const linked = accounts.find(account =>
          account._id === emp?.userId?.toString?.()
          || account.employeeRef?.toString?.() === emp?._id?.toString?.()
          || account.linkedEmployeeRecordId === emp?._id?.toString?.()
        );
        if (linked) {
          setLinkedAccountId(linked._id);
          setSelectedAccount(linked._id);
        }
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to load Employee login accounts.');
    } finally {
      setAccountsLoading(false);
    }
  };

  const saveAccountLink = async () => {
    if (!selectedAccount || !emp) return;
    const account = employeeAccounts.find(item => item._id === selectedAccount);
    const replacing = Boolean(linkedAccountId && linkedAccountId !== selectedAccount);
    if (replacing && !window.confirm('Replace the current login account link for this employee?')) return;
    setLinkingAccount(true);
    try {
      const { data } = await employeeAPI.linkAccount(emp._id, {
        userId: selectedAccount,
        replaceExisting: replacing,
      });
      setLinkedAccountId(account?._id || '');
      toast.success(data.warning || 'Employee login account linked successfully.');
      setShowAccountLinker(false);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to link this Employee account.');
    } finally {
      setLinkingAccount(false);
    }
  };
  useEffect(() => {
    let active = true;
    if (!emp?.employeeId) return () => { active = false; };
    setBenefitsLoading(true);
    Promise.all([
      benefitsAPI.getAllowances({ employeeId: emp.employeeId }),
      benefitsAPI.getPFRecords({ employeeId: emp.employeeId }),
      benefitsAPI.getInsurance({ employeeId: emp.employeeId }),
    ]).then(([allowanceResponse, pfResponse, insuranceResponse]) => {
      if (!active) return;
      setBenefits({
        allowances: allowanceResponse.data.data || [],
        profiles: pfResponse.data.data.profiles || [],
        contributions: pfResponse.data.data.contributions || [],
        insurance: insuranceResponse.data.data || [],
      });
    }).catch(error => {
      if (active) toast.error(error.response?.data?.message || 'Unable to load employee benefits.');
    }).finally(() => {
      if (active) setBenefitsLoading(false);
    });
    return () => { active = false; };
  }, [emp?.employeeId]);

  if (!emp) return (
    <div className="empty-state">
      <div className="empty-state-title">Employee not found</div>
      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/employees/list')}>Back to List</button>
    </div>
  );

  // Match by _id, email, or userId — all are stored on attendance/leave/payroll/performance records
  const matchEmp = (record) =>
    record.employeeId === emp.employeeId ||
    record.employeeId === emp._id?.toString() ||
    record.employeeId === emp._id ||
    record.email      === emp.email;

  const empAttendance = attendanceData.filter(matchEmp);
  const empLeave      = leaveRequests.filter(matchEmp);
  const empPayroll    = payrollData.filter(matchEmp);
  const empPerf       = performanceReviews.filter(matchEmp);

  const gross = (emp.salary || 0) + (emp.hra || 0) + (emp.allowances || 0) + (emp.bonus || 0);
  const net   = gross - (emp.deductions || 0);

  // Derive current rating from latest performance review
  const latestReview   = empPerf.sort((a, b) => (b.reviewDate || '').localeCompare(a.reviewDate || ''))[0] || null;
  const currentRating  = latestReview ? `${latestReview.overallRating}/5` : 'N/A';
  const lastReviewDate = latestReview?.reviewDate || null;

  const empIdDisplay = String(emp._id || '').slice(-8).toUpperCase();
  const availableEmployeeAccounts = employeeAccounts.filter(account => account.isActive
    && (!account.employeeRef || account.employeeRef.toString() === emp._id.toString())
    && (!account.linkedEmployeeRecordId || account.linkedEmployeeRecordId === emp._id.toString())
    && (!account.employeeId || account.employeeId === emp.employeeId || account._id === linkedAccountId
      || !employees.some(other => other._id.toString() !== emp._id.toString() && other.employeeId === account.employeeId)));

  const tabs = {
    'Personal Info': (
      <div className="grid grid-2" style={{ gap: 32 }}>
        <div>
          <h4 style={{ fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>Personal Details</h4>
          <InfoRow label="Full Name"       value={emp.name}     />
          <InfoRow label="Date of Birth"   value={emp.dob}      />
          <InfoRow label="Gender"          value={emp.gender}   />
          <InfoRow label="Email"           value={emp.email}    />
          <InfoRow label="Phone"           value={emp.phone}    />
          <InfoRow label="Alternate Phone" value={emp.altPhone} />
        </div>
        <div>
          <h4 style={{ fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>Address</h4>
          <InfoRow label="Street Address" value={emp.address} />
          <InfoRow label="City"           value={emp.city}    />
          <InfoRow label="State"          value={emp.state}   />
          <InfoRow label="Country"        value={emp.country} />
          <InfoRow label="Postal Code"    value={emp.postal}  />
        </div>
      </div>
    ),
    'Employment': (
      <div className="grid grid-2" style={{ gap: 32 }}>
        <div>
          <h4 style={{ fontWeight: 600, marginBottom: 16 }}>Employment Details</h4>
          <InfoRow label="Employee ID"     value={empIdDisplay}       />
          <InfoRow label="Department"      value={emp.department}     />
          <InfoRow label="Designation"     value={emp.designation || emp.position} />
          <InfoRow label="Manager"         value={emp.manager}        />
          <InfoRow label="Joining Date"    value={emp.joiningDate}    />
          <InfoRow label="Employment Type" value={emp.employmentType} />
          <InfoRow label="Work Location"   value={emp.workLocation}   />
          <InfoRow label="Probation Period"value={emp.probation}      />
          <InfoRow label="Status"          value={<Badge status={emp.status} />} />
        </div>
        <div>
          <h4 style={{ fontWeight: 600, marginBottom: 16 }}>Skills</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(emp.skills || []).length > 0
              ? emp.skills.map(s => <span key={s} className="badge badge-primary">{s}</span>)
              : <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>No skills listed</span>}
          </div>
          <h4 style={{ fontWeight: 600, margin: '24px 0 12px' }}>Employee Login Account</h4>
          <InfoRow label="Link status" value={linkedAccountId ? 'Login account linked' : 'No login account linked'} />
          {canLinkAccount && (
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-outline btn-sm" onClick={() => {
                setShowAccountLinker(value => !value);
                if (!employeeAccounts.length) loadEmployeeAccounts();
              }}>
                {linkedAccountId ? 'Correct Account Mapping' : 'Link Login Account'}
              </button>
              {showAccountLinker && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  {accountsLoading ? <span style={{ color: 'var(--text-muted)' }}>Loading Employee accounts…</span> : availableEmployeeAccounts.length ? (
                    <>
                      <select className="form-control form-select" style={{ flex: '1 1 220px' }} value={selectedAccount} onChange={event => setSelectedAccount(event.target.value)}>
                        <option value="">Select an unlinked Employee login</option>
                        {availableEmployeeAccounts.map(account => <option key={account._id} value={account._id}>{account.name} · {account.email || account.employeeId || account._id}</option>)}
                      </select>
                      <button className="btn btn-primary btn-sm" onClick={saveAccountLink} disabled={!selectedAccount || linkingAccount}>
                        {linkingAccount ? 'Linking…' : 'Save Mapping'}
                      </button>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>No eligible active Employee login accounts are available. Create or reactivate an Employee account first.</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    ),
    'Attendance': (
      <div>
        <div className="grid grid-4 grid-gap-sm mb-6">
          <StatMini label="Present Days"  value={empAttendance.filter(a => a.status === 'present').length} color="var(--success)" />
          <StatMini label="Absent Days"   value={empAttendance.filter(a => a.status === 'absent').length}  color="var(--danger)"  />
          <StatMini label="Late Days"     value={empAttendance.filter(a => a.late).length}                 color="var(--warning)" />
          <StatMini label="Attendance %"  value={empAttendance.length > 0
            ? `${Math.round((empAttendance.filter(a => a.status === 'present').length / empAttendance.length) * 100)}%`
            : 'N/A'} color="var(--primary)" />
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Check In</th><th>Check Out</th><th>Hours</th><th>Status</th></tr>
            </thead>
            <tbody>
              {empAttendance.length > 0
                ? empAttendance
                    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                    .map((a, i) => (
                    <tr key={a._id || i}>
                      <td>{a.date}</td>
                      <td>{a.checkIn  || '—'}</td>
                      <td>{a.checkOut || '—'}</td>
                      <td>{a.hours ? `${a.hours}h` : '—'}</td>
                      <td><Badge status={a.status} /></td>
                    </tr>
                  ))
                : <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No attendance records found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    ),
    'Leave': (
      <div>
        <div className="grid grid-4 grid-gap-sm mb-6">
          <StatMini label="Total Requests" value={empLeave.length} />
          <StatMini label="Approved"  value={empLeave.filter(l => l.status === 'approved').length} color="var(--success)" />
          <StatMini label="Pending"   value={empLeave.filter(l => l.status === 'pending').length}  color="var(--warning)" />
          <StatMini label="Rejected"  value={empLeave.filter(l => l.status === 'rejected').length} color="var(--danger)"  />
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Applied</th><th>Status</th></tr>
            </thead>
            <tbody>
              {empLeave.length > 0
                ? empLeave.map(l => (
                  <tr key={l._id || l.id}>
                    <td>{l.leaveType}</td>
                    <td>{l.startDate}</td>
                    <td>{l.endDate}</td>
                    <td>{l.days}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{l.appliedDate || '—'}</td>
                    <td><Badge status={l.status} /></td>
                  </tr>
                ))
                : <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No leave records found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    ),
    'Salary': (
      <div>
        <div className="grid grid-4 grid-gap-sm mb-6">
          <StatMini label="Basic Salary"   value={formatINR(emp.salary || 0, { currency: emp.currency || 'UNVERIFIED' })}    />
          <StatMini label="Gross Salary"   value={formatINR(gross, { currency: emp.currency || 'UNVERIFIED' })}               color="var(--info)"    />
          <StatMini label="Deductions"     value={formatINR(emp.deductions || 0, { currency: emp.currency || 'UNVERIFIED' })} color="var(--danger)"  />
          <StatMini label="Net Salary"     value={formatINR(net, { currency: emp.currency || 'UNVERIFIED' })}                 color="var(--success)" />
        </div>
        <div className="grid grid-2 grid-gap-lg">
          <div>
            <h4 style={{ fontWeight: 600, marginBottom: 16 }}>Salary Components ({emp.currency || 'Unverified'} / year)</h4>
            <InfoRow label="Basic Salary"    value={formatINR(emp.salary || 0, { currency: emp.currency || 'UNVERIFIED' })}      />
            <InfoRow label="HRA"             value={formatINR(emp.hra || 0, { currency: emp.currency || 'UNVERIFIED' })}          />
            <InfoRow label="Allowances"      value={formatINR(emp.allowances || 0, { currency: emp.currency || 'UNVERIFIED' })}   />
            <InfoRow label="Bonus"           value={formatINR(emp.bonus || 0, { currency: emp.currency || 'UNVERIFIED' })}        />
            <InfoRow label="Deductions"      value={`−${formatINR(emp.deductions || 0, { currency: emp.currency || 'UNVERIFIED' })}`} />
            <InfoRow label="Payment Method"  value={emp.paymentMethod}               />
            <InfoRow label="Bank"            value={emp.bankName}                    />
          </div>
          <div>
            <h4 style={{ fontWeight: 600, marginBottom: 16 }}>Salary History</h4>
            {empPayroll.length > 0
              ? empPayroll
                  .sort((a, b) => `${b.year}${b.month}`.localeCompare(`${a.year}${a.month}`))
                  .map(p => {
                    const pNet = p.net ?? ((p.basic || 0) + (p.hra || 0) + (p.allowances || 0) + (p.bonus || 0) + (p.overtimeEarnings || 0) - (p.tax || 0) - (p.insurance || 0) - (p.otherDeductions || 0) - (p.advanceDeductions || 0) - (p.employeePF || 0) - (p.leaveDeduction || 0));
                    return (
                      <div key={p._id || p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: '0.875rem' }}>{p.month} {p.year}</span>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{formatINR(pNet, { currency: p.currency || 'UNVERIFIED' })}</span>
                          <Badge status={p.status} />
                        </div>
                      </div>
                    );
                  })
              : <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No salary records yet</p>}
          </div>
        </div>
      </div>
    ),
    'Performance': (
      <div>
        <div className="grid grid-3 grid-gap-sm mb-6">
          <StatMini label="Current Rating" value={currentRating}       color="var(--warning)" />
          <StatMini label="Reviews Done"   value={empPerf.length}      />
          <StatMini label="Last Review"    value={lastReviewDate || 'N/A'} color="var(--info)" />
        </div>
        {empPerf.length > 0
          ? empPerf
              .sort((a, b) => (b.reviewDate || '').localeCompare(a.reviewDate || ''))
              .map(rev => (
              <div key={rev._id || rev.id} className="card" style={{ marginBottom: 16, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{rev.reviewPeriod}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Reviewed by {rev.reviewer} on {rev.reviewDate}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[1,2,3,4,5].map(s => (
                      <Star key={s} size={16}
                        fill={s <= rev.overallRating ? 'var(--accent)' : 'none'}
                        color={s <= rev.overallRating ? 'var(--accent)' : 'var(--border)'} />
                    ))}
                  </div>
                </div>
                <div className="grid grid-2 grid-gap-sm">
                  {rev.strengths && (
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '0.8rem', marginBottom: 6 }}>Strengths</div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{rev.strengths}</p>
                    </div>
                  )}
                  {rev.improvements && (
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '0.8rem', marginBottom: 6 }}>Areas for Improvement</div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{rev.improvements}</p>
                    </div>
                  )}
                </div>
                {rev.managerComments && (
                  <div style={{ marginTop: 12, padding: '12px', background: 'var(--bg)', borderRadius: 8 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 4 }}>Manager Comments</div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{rev.managerComments}</p>
                  </div>
                )}
              </div>
            ))
          : <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>No performance reviews yet</p>}
      </div>
    ),
    'Benefits': (
      <div>
        {benefitsLoading && <p style={{ color: 'var(--text-muted)' }}>Loading benefit records…</p>}
        <h4 style={{ fontWeight: 600, marginBottom: 12 }}>Allowances</h4>
        {benefits.allowances.length ? benefits.allowances.map(item => (
          <InfoRow key={item._id} label={`${item.type} (${item.frequency})`}
            value={`${formatINR(item.amount, { currency: item.currency || 'UNVERIFIED' })} · ${item.effectiveFrom}${item.effectiveTo ? ` to ${item.effectiveTo}` : ''}${item.isActive ? '' : ' · Inactive'}`} />
        )) : <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 24 }}>No allowance records.</p>}

        <h4 style={{ fontWeight: 600, margin: '24px 0 12px' }}>Provident Fund</h4>
        {benefits.profiles.length ? benefits.profiles.map(profile => (
          <div key={profile._id}>
            <InfoRow label="PF Account Number" value={profile.pfAccountNumber} />
            <InfoRow label="UAN" value={profile.uanNumber} />
            <InfoRow label="Eligibility" value={profile.isEligible && profile.isApplicable ? 'Eligible and applicable' : 'Not applicable'} />
          </div>
        )) : <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No PF profile.</p>}
        {benefits.contributions.map(record => (
          <InfoRow key={record._id} label={`Contribution · ${record.month} ${record.year}`}
            value={`Employee ${formatINR(record.employeeContribution, { currency: record.currency || 'UNVERIFIED' })} · Employer ${formatINR(record.employerContribution, { currency: record.currency || 'UNVERIFIED' })}`} />
        ))}

        <h4 style={{ fontWeight: 600, margin: '24px 0 12px' }}>Insurance</h4>
        {benefits.insurance.length ? benefits.insurance.map(policy => (
          <div key={policy._id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
            <InfoRow label="Policy" value={`${policy.type} · ${policy.provider}`} />
            <InfoRow label="Coverage" value={formatINR(policy.sumInsured, { currency: policy.currency || 'UNVERIFIED' })} />
            <InfoRow label="Policy period" value={`${policy.startDate} to ${policy.expiryDate} · ${policy.status}`} />
            <InfoRow label="Premium" value={`${formatINR(policy.premiumAmount, { currency: policy.currency || 'UNVERIFIED' })} (${policy.premiumFrequency})`} />
          </div>
        )) : <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No insurance policies.</p>}
      </div>
    ),
    'Documents': (
      <div>
        {documentsLoading && <div className="empty-state">Loading employee documents…</div>}
        {!documentsLoading && !documents.length && (
          <div className="empty-state">{linkedAccountId ? 'No uploaded documents are available.' : 'Link an Employee login account to view uploaded documents.'}</div>
        )}
        <div className="grid grid-2 grid-gap-sm">
          {documents.filter(document => !document.archivedAt).map(doc => (
            <div key={doc.id} className="file-item">
              <div style={{ width: 36, height: 36, background: 'var(--primary-light)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileText size={14} color="var(--primary)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{doc.name}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{doc.mimeType} · {doc.verificationStatus || 'pending'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-outline btn-sm" onClick={() => openEmployeeDocument(doc)}>View</button>
                <button className="btn btn-outline btn-sm" onClick={() => openEmployeeDocument(doc, true)}><Download size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  };

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb">
          <span style={{ cursor: 'pointer', color: 'var(--primary)' }} onClick={() => navigate('/employees/list')}>
            Employees
          </span>
          <span className="breadcrumb-sep">/</span>
          <span>{emp.name}</span>
        </div>
      </div>

      {/* Profile Header */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{
          padding: '32px 32px 24px',
          background: 'linear-gradient(135deg, var(--primary-light) 0%, var(--surface) 100%)',
          borderRadius: '14px 14px 0 0',
        }}>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            <Avatar name={emp.name} size="2xl" />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>{emp.name}</h2>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>{emp.designation || emp.position}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Badge status={emp.status} />
                    {emp.employmentType && <Badge label={emp.employmentType} dot={false} variant="badge-primary" />}
                    {latestReview && (
                      <span className="badge badge-warning">⭐ {latestReview.overallRating}/5</span>
                    )}
                  </div>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => navigate(`/employees/edit/${emp._id}`)}>
                  <Edit2 size={14} /> Edit Profile
                </button>
              </div>
              <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
                {[
                  { icon: Briefcase, text: empIdDisplay },
                  { icon: Building2, text: emp.department },
                  { icon: Mail,      text: emp.email },
                  { icon: Phone,     text: emp.phone },
                  emp.workLocation && { icon: MapPin, text: emp.workLocation },
                  emp.joiningDate  && { icon: Calendar, text: `Joined: ${emp.joiningDate}` },
                ].filter(Boolean).map(({ icon: Icon, text }) => (
                  <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <Icon size={13} /> {text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="card">
        <div className="tabs" style={{ padding: '0 24px' }}>
          {visibleTabs.map((t, i) => (
            <div key={t} className={`tab ${activeTab === i ? 'active' : ''}`} onClick={() => setActiveTab(i)}>
              {t}
            </div>
          ))}
        </div>
        <div className="card-body">
          {tabs[visibleTabs[activeTab]]}
        </div>
      </div>
    </div>
  );
};

export default EmployeeProfile;
