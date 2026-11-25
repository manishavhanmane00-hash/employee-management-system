import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts';
import {
  Users, UserCheck, UserMinus, Clock, AlertCircle, Calendar,
  DollarSign, TrendingUp, ArrowUpRight, ArrowDownRight, Cake, Star
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import Avatar from '../components/shared/Avatar';
import Badge from '../components/shared/Badge';
import { formatINR, formatINRCompact } from '../utils/currency';

const StatCard = ({ icon: Icon, label, value, change, changeType, color, bg }) => (
  <div className="stat-card">
    <div className="stat-card-icon" style={{ background: bg }}>
      <Icon size={22} color={color} />
    </div>
    <div className="stat-card-value">
      {typeof value === 'number' && value > 999
        ? formatINRCompact(value)
        : value}
    </div>
    <div className="stat-card-label">{label}</div>
    {change && (
      <div className={`stat-card-trend ${changeType}`}>
        {changeType === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
        {change}
      </div>
    )}
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="value" style={{ color: p.color }}>{p.name}: {p.value}</div>
      ))}
    </div>
  );
};

const Dashboard = () => {
  const { employees, leaveRequests, attendanceData, dashboardStats, notifications, holidays } = useApp();
  const { user } = useAuth();
  const navigate = useNavigate();
  const pendingLeave = leaveRequests.filter(r => r.status === 'pending');

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const todayAttendance = attendanceData.filter(a => a.date === today);
  const presentToday = todayAttendance.filter(a => a.status === 'present' || a.status === 'late').length;
  const absentToday = todayAttendance.filter(a => a.status === 'absent').length;
  const attendanceTrend = dashboardStats?.attendanceTrend || [];
  const attendanceOverview = attendanceTrend.map(record => ({
    day: new Date(`${record.date}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
    present: Number(record.present || 0),
    absent: Number(record.absent || 0),
    late: Number(record.late || 0),
  }));
  const measuredAttendance = attendanceTrend
    .map(record => {
      const total = Number(record.present || 0) + Number(record.absent || 0) + Number(record.late || 0);
      return total ? ((Number(record.present || 0) + Number(record.late || 0)) / total) * 100 : null;
    })
    .filter(value => value !== null);
  const avgAttendance = measuredAttendance.length
    ? Math.round(measuredAttendance.reduce((total, value) => total + value, 0) / measuredAttendance.length)
    : null;
  const employeeGrowth = Array.from({ length: 6 }, (_, index) => {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    const period = monthStart.toLocaleDateString('en-IN', { month: 'short' });
    const count = employees.filter(employee => {
      if (!employee.createdAt) return false;
      const createdAt = new Date(employee.createdAt);
      return createdAt >= monthStart && createdAt < nextMonth;
    }).length;
    return { month: period, employees: count };
  });
  const leaveStatusColors = { pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444', cancelled: '#94a3b8' };
  const leaveStats = ['pending', 'approved', 'rejected', 'cancelled']
    .map(status => ({
      name: status.charAt(0).toUpperCase() + status.slice(1),
      value: leaveRequests.filter(request => request.status === status).length,
      color: leaveStatusColors[status],
    }))
    .filter(status => status.value > 0);
  const recentActivities = notifications.slice(0, 4).map(notification => ({
    id: notification._id,
    text: notification.title ? `${notification.title}: ${notification.message}` : notification.message,
    time: notification.createdAt ? new Date(notification.createdAt).toLocaleString('en-IN') : '',
  }));
  const upcomingEvents = holidays.map(holiday => {
    if (holiday.status !== 'active') return null;
    const currentDay = new Date(`${today}T00:00:00Z`);
    for (let offset = 0; offset <= 180; offset += 1) {
      const occurrence = new Date(currentDay.getTime() + offset * 86400000);
      const occurrenceDate = occurrence.toISOString().slice(0, 10);
      if (holiday.type === 'Festival' || holiday.type === 'Custom') {
        const startDate = holiday.startDate || holiday.date;
        const endDate = holiday.endDate || startDate;
        if (startDate && endDate && occurrenceDate >= startDate && occurrenceDate <= endDate) {
          return { id: holiday._id, name: holiday.holidayName, date: occurrenceDate, type: holiday.type };
        }
      } else if (holiday.type === 'Weekly'
        && Number.isInteger(holiday.recurrence?.dayOfWeek)
        && occurrence.getUTCDay() === holiday.recurrence.dayOfWeek) {
        return { id: holiday._id, name: holiday.holidayName, date: occurrenceDate, type: holiday.type };
      } else if (holiday.type === 'Monthly'
        && Number.isInteger(holiday.recurrence?.dayOfMonth)
        && occurrence.getUTCDate() === holiday.recurrence.dayOfMonth) {
        return { id: holiday._id, name: holiday.holidayName, date: occurrenceDate, type: holiday.type };
      }
    }
    return null;
  }).filter(Boolean).sort((first, second) => first.date.localeCompare(second.date)).slice(0, 3);
  const monthlyPayrollTotal = Object.entries(dashboardStats?.monthlyPayrollTotals || {})
    .map(([currency, total]) => `${formatINR(total.amount, { currency })} ${currency}`)
    .join(' · ') || 'No payroll this month';
  const payrollTrend = dashboardStats?.payrollTrend || [];
  const hasPayrollTrend = payrollTrend.some(record => ['INR', 'USD', 'UNVERIFIED']
    .some(currency => Number(record[currency] || 0) > 0));
  const departmentDistribution = (dashboardStats?.departmentStats || [])
    .filter(department => department.employeeCount > 0)
    .map((department, index) => ({
      ...department,
      employees: department.employeeCount,
      color: ['#2563eb', '#7c3aed', '#3b82f6', '#8b5cf6', '#5b21b6'][index % 5],
    }));

  const stats = [
    { icon: Users,     label: 'Total Employees',      value: dashboardStats?.totalEmployees ?? employees.length,                      change: null, changeType: 'up',   color: 'var(--secondary)', bg: 'var(--info-light)' },
    { icon: UserCheck, label: 'Active Employees',      value: dashboardStats?.activeEmployees ?? employees.filter(e=>e.status==='active').length, change: null, changeType: 'up',   color: 'var(--accent)', bg: 'var(--purple-light)' },
    { icon: Calendar,  label: 'On Leave Today',        value: employees.filter(e=>e.status==='on-leave').length,                      change: null, changeType: 'down', color: 'var(--secondary)', bg: 'var(--info-light)' },
    { icon: UserCheck, label: 'Present Today',         value: dashboardStats?.presentToday ?? presentToday,                           change: null, changeType: 'up',   color: 'var(--accent)', bg: 'var(--purple-light)' },
    { icon: UserMinus, label: 'Absent Today',          value: dashboardStats?.absentToday ?? absentToday,                             change: null, changeType: 'up',   color: 'var(--secondary)', bg: 'var(--info-light)' },
    { icon: AlertCircle,label: 'Pending Leave',        value: dashboardStats?.pendingLeave ?? pendingLeave.length,                     change: null, changeType: 'down', color: 'var(--accent)', bg: 'var(--purple-light)' },
    { icon: DollarSign, label: 'Current Month Payroll', value: monthlyPayrollTotal, change: null, changeType: 'up', color: 'var(--secondary)', bg: 'var(--info-light)' },
    { icon: TrendingUp, label: 'Avg Attendance (7 days)', value: avgAttendance === null ? 'N/A' : `${avgAttendance}%`,                 change: null, changeType: 'up',   color: 'var(--accent)', bg: 'var(--purple-light)' },
  ];

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Welcome back, {user?.name || 'Admin'} — here's what's happening today.</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline btn-sm">
              <Clock size={14} /> Today: {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/employees/add')}>
              + Add Employee
            </button>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-4 mb-6">
        {stats.map(s => <StatCard key={s.label} {...s} />)}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-2-1 mb-6">
        {/* Employee Growth */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Employee Records Added</h3>
            <span className="badge badge-gray">Employee records added · last 6 months</span>
          </div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            {employees.some(employee => employee.createdAt) ? <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={employeeGrowth}>
                <defs><linearGradient id="empGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} /><stop offset="95%" stopColor="#2563eb" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="employees" stroke="#2563eb" strokeWidth={2.5} fill="url(#empGrad)" dot={false} name="Records added" />
              </AreaChart>
            </ResponsiveContainer> : <div className="empty-state" style={{ height: 220 }}>No dated employee records are available.</div>}
          </div>
        </div>

        {/* Department Distribution */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">By Department</h3>
          </div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            {departmentDistribution.length ? <><ResponsiveContainer width="100%" height={130}>
              <PieChart>
                <Pie data={departmentDistribution} cx="50%" cy="50%" outerRadius={55} dataKey="employees" nameKey="name">
                  {departmentDistribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={({ active, payload }) => active && payload?.length ? (
                  <div className="custom-tooltip"><div className="label">{payload[0].name}</div><div className="value">{payload[0].value} employees</div></div>
                ) : null} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              {departmentDistribution.slice(0, 4).map(d => (
                <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color }} />
                    <span style={{ color: 'var(--text-secondary)' }}>{d.name}</span>
                  </div>
                  <span style={{ fontWeight: 600 }}>{d.employees}</span>
                </div>
              ))}
            </div>
            </> : <div className="empty-state" style={{ height: 180 }}>No department employee data is available.</div>}
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-3 mb-6">
        {/* Attendance Overview */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Attendance This Week</h3>
          </div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            {attendanceOverview.length ? <ResponsiveContainer width="100%" height={200}>
              <BarChart data={attendanceOverview} barSize={12}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="present" fill="#10b981" radius={3} name="Present" />
                <Bar dataKey="absent" fill="#ef4444" radius={3} name="Absent" />
                <Bar dataKey="late" fill="#f59e0b" radius={3} name="Late" />
              </BarChart>
            </ResponsiveContainer> : <div className="empty-state" style={{ height: 200 }}>No attendance records for this period.</div>}
          </div>
        </div>

        {/* Leave Statistics */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Leave Statistics</h3>
          </div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            {leaveStats.length ? <><ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={leaveStats} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" nameKey="name" paddingAngle={3}>
                  {leaveStats.map(status => <Cell key={status.name} fill={status.color} />)}
                </Pie>
                <Tooltip content={({ active, payload }) => active && payload?.length ? (
                  <div className="custom-tooltip"><div className="label">{payload[0].name}</div><div className="value">{payload[0].value} requests</div></div>
                ) : null} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginTop: -8 }}>
              {leaveStats.map(s => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem' }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                  <span style={{ color: 'var(--text-secondary)' }}>{s.name}</span>
                </div>
              ))}
            </div>
            </> : <div className="empty-state" style={{ height: 200 }}>No leave requests are recorded.</div>}
          </div>
        </div>

        {/* Salary Overview */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Salary Trend</h3>
          </div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            {hasPayrollTrend ? <ResponsiveContainer width="100%" height={200}>
              <LineChart data={payrollTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={v => v.toLocaleString('en-IN')} />
                <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                  <div className="custom-tooltip">
                    <div className="label">{label}</div>
                    {payload.map(item => <div key={item.dataKey} className="value">{item.name}: {formatINR(item.value, { currency: item.dataKey })}</div>)}
                  </div>
                ) : null} />
                <Line type="monotone" dataKey="INR" stroke="#2563eb" strokeWidth={2.5} dot={{ fill: '#2563eb', r: 4 }} name="Payroll (INR)" />
                <Line type="monotone" dataKey="USD" stroke="#7c3aed" strokeWidth={2.5} dot={{ fill: '#7c3aed', r: 4 }} name="Payroll (USD)" />
                <Line type="monotone" dataKey="UNVERIFIED" stroke="#f59e0b" strokeWidth={2.5} dot={{ fill: '#f59e0b', r: 4 }} name="Payroll (Unverified)" />
              </LineChart>
            </ResponsiveContainer> : <div className="empty-state" style={{ height: 200 }}>No payroll records are available for this period.</div>}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-3">
        {/* Recent Employees */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">{user?.role === 'Manager' ? 'My Team' : 'Recent Employees'}</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(user?.role === 'Manager' ? '/employees/team' : '/employees/list')}>
              {user?.role === 'Manager' ? 'Manage team' : 'View all'}
            </button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {employees.slice(0, 5).map(emp => (
              <div key={emp._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => navigate(`/employees/${emp._id}`)}>
                <Avatar name={emp.name} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {emp.designation}{emp.manager ? ` · Reports to ${emp.manager}` : ''}
                  </div>
                </div>
                <Badge status={emp.status} dot={true} />
              </div>
            ))}
          </div>
        </div>

        {/* Pending Leave Requests */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Pending Leave</h3>
            <span className="badge badge-warning">{pendingLeave.length} pending</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {pendingLeave.slice(0, 5).map(req => (
              <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => navigate('/leave/approval')}>
                <Avatar name={req.employeeName} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{req.employeeName}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{req.leaveType} · {req.days} day{req.days > 1 ? 's' : ''}</div>
                </div>
                <Badge status="pending" />
              </div>
            ))}
            {pendingLeave.length === 0 && (
              <div className="empty-state" style={{ padding: 32 }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No pending requests</p>
              </div>
            )}
          </div>
        </div>

        {/* Activity & Events */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Recent Activity */}
          <div className="card" style={{ flex: 1 }}>
            <div className="card-header">
              <h3 className="card-title">Recent Activity</h3>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {recentActivities.map(act => (
                <div key={act.id} style={{ display: 'flex', gap: 10, padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Star size={14} color="var(--primary)" />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>{act.text}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 3 }}>{act.time}</div>
                  </div>
                </div>
              ))}
              {!recentActivities.length && <div className="empty-state" style={{ padding: 24 }}>No recent notifications.</div>}
            </div>
          </div>

          {/* Upcoming Events */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Upcoming Events</h3>
            </div>
            <div className="card-body" style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {upcomingEvents.map(ev => (
                <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Cake size={14} color="var(--primary)" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>{ev.name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{new Date(`${ev.date}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</div>
                  </div>
                </div>
              ))}
              {!upcomingEvents.length && <div className="empty-state" style={{ padding: 16 }}>No upcoming holidays are scheduled.</div>}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Dashboard;
