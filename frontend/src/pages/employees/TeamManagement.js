import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, UserMinus, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { employeeAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import EmployeeSelect from '../../components/shared/EmployeeSelect';
import Avatar from '../../components/shared/Avatar';

const TeamManagement = () => {
  const { user, can } = useAuth();
  const { fetchEmployees, fetchDashboardStats } = useApp();
  const isManager = user?.role === 'Manager';
  const canChooseManager = ['Admin', 'HR'].includes(user?.role);
  const canManageTeam = can('employees', 'manage');
  const [managerId, setManagerId] = useState(isManager ? user?.id || user?._id || '' : '');
  const [team, setTeam] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [optionsVersion, setOptionsVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchTeam = useCallback(async () => {
    if (canChooseManager && !managerId) {
      setTeam([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await employeeAPI.getTeam(managerId ? { managerId } : undefined);
      setTeam(data.data?.flatMap(group => group.employees || []) || []);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to load the team.');
    } finally {
      setLoading(false);
    }
  }, [canChooseManager, managerId]);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  useEffect(() => {
    const refresh = () => {
      setOptionsVersion(version => version + 1);
      fetchTeam();
    };
    window.addEventListener('ems:reporting-updated', refresh);
    return () => window.removeEventListener('ems:reporting-updated', refresh);
  }, [fetchTeam]);

  const saveMembership = async managerUserId => {
    if (!selectedEmployee) return toast.error('Select an Employee first.');
    setSaving(true);
    try {
      await employeeAPI.setManager(selectedEmployee, managerUserId);
      setSelectedEmployee('');
      toast.success(managerUserId ? 'Employee added to the team.' : 'Employee removed from the team.');
      await Promise.all([fetchTeam(), fetchEmployees(), fetchDashboardStats()]);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to update team membership.');
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async employee => {
    setSaving(true);
    try {
      await employeeAPI.setManager(employee._id, '');
      toast.success(`${employee.name} was removed from the team.`);
      await Promise.all([fetchTeam(), fetchEmployees(), fetchDashboardStats()]);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to remove the employee.');
    } finally {
      setSaving(false);
    }
  };

  const currentManagerId = managerId || user?.id || user?._id || '';
  const memberIds = new Set(team.flatMap(employee => [employee.userId, employee._id]).filter(Boolean).map(String));

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Team Management</h1>
          <p className="page-subtitle">Manage reporting relationships without changing employee history.</p>
        </div>
      </div>

      {canChooseManager && (
        <div className="card" style={{ padding: 18, marginBottom: 18 }}>
          <label className="form-label">Manager</label>
          <EmployeeSelect
            key={`manager-${managerId}-${optionsVersion}`}
            roles={['Manager']}
            value={managerId}
            blankLabel="Select a Manager"
            onChange={id => setManagerId(id)}
          />
        </div>
      )}

      {currentManagerId && canManageTeam && (
        <div className="card" style={{ padding: 18, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'end', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px' }}>
              <label className="form-label">Add Employee to Team</label>
              <EmployeeSelect
                key={`${managerId}-${team.length}-${optionsVersion}`}
                roles={['Employee']}
                includeUnassigned
                value={selectedEmployee}
                blankLabel="Select an unassigned Employee"
                onChange={id => setSelectedEmployee(id)}
              />
            </div>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!selectedEmployee || saving || memberIds.has(String(selectedEmployee))}
              onClick={() => saveMembership(currentManagerId)}
            >
              <UserPlus size={16} /> Add to Team
            </button>
          </div>
          {memberIds.has(String(selectedEmployee)) && (
            <div className="form-hint">This employee is already on the selected team.</div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={18} />
          <strong>Team Members</strong>
          <span className="badge badge-neutral">{team.length}</span>
        </div>
        {loading ? (
          <div className="empty-state">Loading team…</div>
        ) : team.length === 0 ? (
          <div className="empty-state">No employees are assigned to this team yet.</div>
        ) : (
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr><th>Employee</th><th>Employee ID</th><th>Department</th><th>Designation</th>{canManageTeam && <th />}</tr>
              </thead>
              <tbody>
                {team.map(employee => (
                  <tr key={employee._id}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={employee.name} size="sm" />{employee.name}</div></td>
                    <td>{employee.employeeId || '—'}</td>
                    <td>{employee.department || '—'}</td>
                    <td>{employee.designation || employee.position || '—'}</td>
                    {canManageTeam && (
                      <td>
                        <button
                          className="btn btn-ghost"
                          type="button"
                          disabled={saving}
                          onClick={() => removeMember(employee)}
                          title="Remove from team"
                        >
                          <UserMinus size={16} /> Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamManagement;
