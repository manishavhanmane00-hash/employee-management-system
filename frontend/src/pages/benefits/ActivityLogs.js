import React, { useEffect, useState } from 'react';
import { AlertCircle, Search } from 'lucide-react';
import { benefitsAPI } from '../../services/api';
import SkeletonLoader from '../../components/shared/SkeletonLoader';

const ActivityLogs = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await benefitsAPI.getActivityLogs({ limit: 200 });
      setRecords(data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to load activity logs.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = records.filter(record =>
    [record.userName, record.userRole, record.employeeId, record.module, record.action]
      .some(value => String(value || '').toLowerCase().includes(search.toLowerCase()))
  );

  if (loading) return <SkeletonLoader />;
  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb"><span>System</span><span className="breadcrumb-sep">/</span><span>Activity Logs</span></div>
        <h1 className="page-title">Activity Logs</h1>
        <p className="page-subtitle">Auditable history of employee-benefit changes</p>
      </div>
      {error && <div className="card" style={{ padding: 14, color: 'var(--danger)' }}><AlertCircle size={16} /> {error} <button className="btn btn-outline btn-sm" onClick={load}>Retry</button></div>}
      <div className="card" style={{ marginBottom: 16, padding: 14 }}>
        <div className="search-input-wrapper"><Search size={14} className="search-icon" /><input className="form-control" placeholder="Search user, employee, module, action..." value={search} onChange={event => setSearch(event.target.value)} /></div>
      </div>
      <div className="table-container">
        <table className="table">
          <thead><tr><th>Date / Time</th><th>User</th><th>Role</th><th>Employee ID</th><th>Module</th><th>Action</th><th>Record</th></tr></thead>
          <tbody>
            {filtered.map(record => <tr key={record._id}>
              <td>{new Date(record.createdAt).toLocaleString()}</td><td>{record.userName}</td><td>{record.userRole}</td>
              <td>{record.employeeId || '—'}</td><td>{record.module}</td><td>{record.action}</td><td>{record.recordId || '—'}</td>
            </tr>)}
            {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No activity logs found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ActivityLogs;
