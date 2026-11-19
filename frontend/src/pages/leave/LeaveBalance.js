import React, { useState, useMemo, useEffect } from 'react';
import { CheckCircle, XCircle, Info } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import Avatar from '../../components/shared/Avatar';
import Badge from '../../components/shared/Badge';
import Modal from '../../components/shared/Modal';
import { leaveAPI } from '../../services/api';
import toast from 'react-hot-toast';

// The "Earned" screenshot label is stored as "Annual Leave" (see Req 3.3 / 18.1).
// This map lets us surface a friendly display label while reading the stored type.
const DISPLAY_LABELS = {
  'Annual Leave': 'Earned (Annual Leave)',
};
const PAID_LEAVE_TYPES = [
  'Annual Leave',
  'Sick Leave',
  'Casual Leave',
  'Maternity Leave',
  'Paternity Leave',
  'Compensatory Leave',
];
const ALL_LEAVE_TYPES = [...PAID_LEAVE_TYPES, 'Unpaid Leave'];

const LeaveBalance = () => {
  const { leaveBalances, leaveRequests, updateLeaveStatus, fetchLeaveBalances } = useApp();
  const { user } = useAuth();

  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [allocationUser, setAllocationUser] = useState(null);
  const [allocationValues, setAllocationValues] = useState({});
  const [allocationComment, setAllocationComment] = useState('');
  const [loadingAllocation, setLoadingAllocation] = useState(false);
  const isAdmin = user?.role === 'Admin';

  useEffect(() => {
    if (!isAdmin) return;
    fetchLeaveBalances({
      role: roleFilter,
      department: departmentFilter,
      leaveType: leaveTypeFilter,
      search: search.trim(),
      fromDate,
      toDate,
    });
  }, [isAdmin, roleFilter, departmentFilter, leaveTypeFilter, search, fromDate, toDate, fetchLeaveBalances]);

  // Only Admin and HR may approve/reject. Managers are explicitly excluded from
  // leave approval actions (Req 16.4), matching the backend restriction.
  const canDecide = user?.role === 'Admin' || user?.role === 'HR';

  // Pending records awaiting a decision (Req 4.1).
  const pendingRequests = useMemo(
    () => leaveRequests.filter(r => r.status === 'pending'),
    [leaveRequests]
  );

  // A guard reused for the UI: an approver cannot act on their own request (Req 4.4).
  const isSelf = (req) => {
    const approverId = user?.id || user?._id;
    const ownerId = (req.userId && req.userId.toString?.()) || req.userId;
    return !!approverId && !!ownerId && ownerId.toString() === approverId.toString();
  };

  const handleApprove = async (req) => {
    const id = req._id || req.id;
    // Already-decided guard reflected in UI messaging (Req 4.3).
    if (req.status !== 'pending') {
      toast.error(`This request has already been ${req.status}`);
      return;
    }
    // Self-approval guard reflected in UI messaging (Req 4.4).
    if (isSelf(req)) {
      toast.error('You cannot approve your own leave request');
      return;
    }
    setBusyId(id);
    try {
      await updateLeaveStatus(id, 'approved');
      toast.success(`Leave approved for ${req.employeeName}`);
    } catch (err) {
      toast.error(err.message || 'Failed to approve leave');
    } finally {
      setBusyId(null);
    }
  };

  const openReject = (req) => {
    if (req.status !== 'pending') {
      toast.error(`This request has already been ${req.status}`);
      return;
    }
    setRejectReason('');
    setRejectModal(req);
  };

  const handleReject = async () => {
    const id = rejectModal._id || rejectModal.id;
    setBusyId(id);
    try {
      await updateLeaveStatus(id, 'rejected', rejectReason);
      toast.success(`Leave rejected for ${rejectModal.employeeName}`);
      setRejectModal(null);
      setRejectReason('');
    } catch (err) {
      toast.error(err.message || 'Failed to reject leave');
    } finally {
      setBusyId(null);
    }
  };

  const renderRemaining = (bal) => {
    if (bal.remaining === 'Unlimited' || bal.leaveType === 'Unpaid Leave') {
      return <span style={{ fontWeight: 600, color: 'var(--info)' }}>Unlimited</span>;
    }
    const remaining = Number(bal.remaining);
    const color = remaining > 5 ? 'var(--success)' : remaining > 2 ? 'var(--warning)' : 'var(--danger)';
    return <span style={{ fontWeight: 600, color }}>{remaining} days</span>;
  };

  const openAllocation = async row => {
    setAllocationUser(row);
    setAllocationComment('');
    setAllocationValues({});
    setLoadingAllocation(true);
    try {
      const { data } = await leaveAPI.getBalance({ userId: row.userId });
      if (!data.success || !data.data?.[0]) throw new Error('Unable to load this user’s current leave allocation.');
      setAllocationValues(Object.fromEntries(
        data.data[0].leaves
          .filter(item => item.leaveType !== 'Unpaid Leave')
          .map(item => [item.leaveType, String(item.totalAllocated)])
      ));
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Unable to load leave allocations.');
      setAllocationUser(null);
    } finally {
      setLoadingAllocation(false);
    }
  };

  const saveAllocations = async event => {
    event.preventDefault();
    if (!allocationUser) return;
    setLoadingAllocation(true);
    try {
      await leaveAPI.updateAllocations(allocationUser.userId, {
        allocations: PAID_LEAVE_TYPES.map(leaveType => ({
          leaveType,
          allocatedDays: Number(allocationValues[leaveType]),
        })),
        comment: allocationComment,
      });
      toast.success(`Leave allocations updated for ${allocationUser.name}`);
      setAllocationUser(null);
      await fetchLeaveBalances({
        role: roleFilter,
        department: departmentFilter,
        leaveType: leaveTypeFilter,
        search: search.trim(),
        fromDate,
        toDate,
      });
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Unable to update leave allocations.');
    } finally {
      setLoadingAllocation(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb"><span>Leave</span><span className="breadcrumb-sep">/</span><span>Leave Balance</span></div>
        <h1 className="page-title">Leave Balance</h1>
        <p className="page-subtitle">{isAdmin ? 'Review and configure leave allocations for active Employees, HR, and Managers' : 'Your allocated, used, pending, and remaining leave balance'}</p>
      </div>

      {isAdmin ? (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header"><h3 className="card-title">All Active User Leave Balances</h3></div>
          <div className="grid grid-3" style={{ gap: 12, padding: 16 }}>
            <input className="form-control" placeholder="Search name or Employee ID" value={search} onChange={event => setSearch(event.target.value)} />
            <select className="form-control form-select" value={roleFilter} onChange={event => setRoleFilter(event.target.value)}>
              <option value="">All roles</option><option value="Employee">Employee</option><option value="HR">HR</option><option value="Manager">Manager</option>
            </select>
            <select className="form-control form-select" value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)}>
              <option value="">All departments</option>
              {[...new Set(leaveBalances.map(row => row.department).filter(Boolean))].sort().map(department => <option key={department}>{department}</option>)}
            </select>
            <select className="form-control form-select" value={leaveTypeFilter} onChange={event => setLeaveTypeFilter(event.target.value)}>
              <option value="">All leave types</option>{ALL_LEAVE_TYPES.map(type => <option key={type}>{type}</option>)}
            </select>
            <input className="form-control" aria-label="From date" type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} />
            <input className="form-control" aria-label="To date" type="date" value={toDate} onChange={event => setToDate(event.target.value)} min={fromDate || undefined} />
          </div>
          {leaveBalances.length === 0 ? (
            <div className="empty-state"><div className="empty-state-title">No leave balance records</div><div className="empty-state-desc">Active Employee, HR, and Manager accounts will appear here.</div></div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead><tr><th>User</th><th>Employee ID</th><th>Department</th><th>Designation / Role</th><th>Total Allocated</th><th>Approved Paid Used</th><th>Pending</th><th>Approved Unpaid</th><th>Remaining Paid</th><th>Action</th></tr></thead>
                <tbody>{leaveBalances.map(row => (
                  <tr key={row.userId}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={row.name} size="sm" />{row.name}</div></td>
                    <td>{row.employeeId || '—'}</td><td>{row.department || '—'}</td>
                    <td>{row.designation || row.role} <span className="badge badge-info">{row.role}</span></td>
                    <td>{row.totalAllocated} days</td><td>{row.used} days</td><td>{row.pending} days</td>
                    <td>{row.approvedUnpaid} days</td><td>{row.paidLeaveBalance} days</td>
                    <td><button className="btn btn-outline btn-sm" onClick={() => openAllocation(row)}>Configure</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header"><h3 className="card-title">My Leave Balance</h3></div>
          {leaveBalances.length === 0 ? (
            <div className="empty-state"><div className="empty-state-title">No balance data</div><div className="empty-state-desc">Your leave balances will appear here once your account is set up.</div></div>
          ) : (
            <div className="table-container"><table className="table">
              <thead><tr><th>Leave Type</th><th>Total Allocated</th><th>Approved Paid Used</th><th>Pending Paid</th><th>Approved Unpaid</th><th>Pending Unpaid</th><th>Remaining Paid</th></tr></thead>
              <tbody>{leaveBalances.map(bal => (
                <tr key={bal.leaveType}>
                  <td style={{ fontWeight: 600, fontSize: '0.875rem' }}>{DISPLAY_LABELS[bal.leaveType] || bal.leaveType}</td>
                  <td>{bal.leaveType === 'Unpaid Leave' ? '—' : `${bal.totalAllocated} days`}</td>
                  <td>{bal.approvedPaid} days</td><td>{bal.pendingPaid} days</td>
                  <td>{bal.approvedUnpaid} days</td><td>{bal.pendingUnpaid} days</td>
                  <td>{renderRemaining(bal)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {allocationUser && (
        <Modal open onClose={() => !loadingAllocation && setAllocationUser(null)} title={`Configure Leave Allocation — ${allocationUser.name}`} size="md"
          footer={<><button className="btn btn-outline" onClick={() => setAllocationUser(null)} disabled={loadingAllocation}>Cancel</button><button className="btn btn-primary" onClick={saveAllocations} disabled={loadingAllocation}>{loadingAllocation ? 'Saving…' : 'Save Allocations'}</button></>}>
          <form onSubmit={saveAllocations}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>Adjust paid leave entitlements. Pending requests remain separate and do not reduce the remaining paid balance until approved.</p>
            {PAID_LEAVE_TYPES.map(type => (
              <div className="form-group" key={type}>
                <label className="form-label">{type} (days)</label>
                <input className="form-control" type="number" min="0" max="366" step="0.5" required value={allocationValues[type] ?? ''} onChange={event => setAllocationValues(current => ({ ...current, [type]: event.target.value }))} />
              </div>
            ))}
            <div className="form-group"><label className="form-label">Allocation note</label><textarea className="form-control" rows={2} maxLength={500} value={allocationComment} onChange={event => setAllocationComment(event.target.value)} /></div>
          </form>
        </Modal>
      )}

      {/* Pending approvals — visible only for Admin/HR (Req 4.1) */}
      {canDecide && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Pending Approvals</h3>
            <span className="badge badge-warning">{pendingRequests.length} pending</span>
          </div>

          {pendingRequests.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-title">No pending requests</div>
              <div className="empty-state-desc">Leave requests awaiting a decision will appear here.</div>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Employee</th><th>Leave Type</th><th>From</th><th>To</th>
                    <th>Days</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRequests.map(req => {
                    const id = req._id || req.id;
                    const self = isSelf(req);
                    const busy = busyId === id;
                    return (
                      <tr key={id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Avatar name={req.employeeName} size="sm" />
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{req.employeeName}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{req.department}</div>
                            </div>
                          </div>
                        </td>
                        <td><span className="badge badge-info" style={{ fontSize: '0.75rem' }}>{req.leaveType}</span></td>
                        <td style={{ fontSize: '0.875rem' }}>{req.startDate}</td>
                        <td style={{ fontSize: '0.875rem' }}>{req.endDate}</td>
                        <td><span style={{ fontWeight: 600 }}>{req.days}</span></td>
                        <td><Badge status={req.status} /></td>
                        <td>
                          {self ? (
                            // Self-approval guard reflected in disabled state + messaging (Req 4.4).
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              <Info size={13} /> Your own request
                            </span>
                          ) : (
                            <div className="table-actions">
                              <button
                                className="btn-icon"
                                style={{ color: 'var(--success)', borderColor: 'var(--success-light)' }}
                                onClick={() => handleApprove(req)}
                                disabled={busy}
                                title="Approve"
                              >
                                <CheckCircle size={13} />
                              </button>
                              <button
                                className="btn-icon danger"
                                onClick={() => openReject(req)}
                                disabled={busy}
                                title="Reject"
                              >
                                <XCircle size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <Modal open={true} onClose={() => setRejectModal(null)} title="Reject Leave Request" size="sm"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setRejectModal(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleReject} disabled={busyId === (rejectModal._id || rejectModal.id)}>Reject Leave</button>
            </>
          }>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            Rejecting leave request for <strong>{rejectModal?.employeeName}</strong>
          </p>
          <div className="form-group">
            <label className="form-label">Rejection Reason</label>
            <textarea className="form-control" rows={3} placeholder="Provide a reason for rejection..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </div>
        </Modal>
      )}
    </div>
  );
};

export default LeaveBalance;
