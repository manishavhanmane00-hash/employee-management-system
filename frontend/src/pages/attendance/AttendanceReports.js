import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Download, TrendingUp, Clock, AlertCircle, CheckCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { downloadElementPdf, printElement } from '../../utils/documentExport';
import toast from 'react-hot-toast';

const currentMonth = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const ATTENDANCE_STATUSES = new Set(['present', 'absent', 'late', 'half-day']);

const AttendanceReports = () => {
  const { attendanceData } = useApp();
  const [month, setMonth] = useState(currentMonth);
  const [department, setDepartment] = useState('');

  const departments = useMemo(() => Array.from(new Set(
    attendanceData.map(record => record.department).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b)), [attendanceData]);

  const filteredRecords = useMemo(() => attendanceData.filter(record =>
    String(record.date || '').startsWith(month)
    && (!department || record.department === department)
    && ATTENDANCE_STATUSES.has(record.status)
  ), [attendanceData, month, department]);

  const departmentRows = useMemo(() => {
    const groups = new Map();
    filteredRecords.forEach(record => {
      const name = record.department || 'Unassigned';
      if (!groups.has(name)) groups.set(name, { department: name, total: 0, present: 0, absent: 0, late: 0, halfDay: 0, attended: 0 });
      const row = groups.get(name);
      row.total += 1;
      if (record.status === 'late' || record.late) row.late += 1;
      else if (record.status === 'present') row.present += 1;
      else if (record.status === 'absent') row.absent += 1;
      else if (record.status === 'half-day') row.halfDay += 1;
      if (['present', 'late', 'half-day'].includes(record.status) || record.late) row.attended += 1;
    });
    return Array.from(groups.values()).sort((a, b) => a.department.localeCompare(b.department)).map(row => ({
      ...row,
      attendanceRate: row.total ? Math.round(((row.present + row.late + row.halfDay) / row.total) * 1000) / 10 : 0,
    }));
  }, [filteredRecords]);

  const totals = useMemo(() => departmentRows.reduce((result, row) => ({
    total: result.total + row.total,
    present: result.present + row.present,
    absent: result.absent + row.absent,
    late: result.late + row.late,
    halfDay: result.halfDay + row.halfDay,
    attended: result.attended + row.attended,
  }), { total: 0, present: 0, absent: 0, late: 0, halfDay: 0, attended: 0 }), [departmentRows]);

  const dailyOverview = useMemo(() => {
    const byDate = new Map();
    filteredRecords.forEach(record => {
      if (!byDate.has(record.date)) byDate.set(record.date, { date: record.date.slice(-2), present: 0, absent: 0, late: 0, halfDay: 0 });
      const row = byDate.get(record.date);
      if (record.status === 'late' || record.late) row.late += 1;
      else if (record.status === 'present') row.present += 1;
      if (record.status === 'absent') row.absent += 1;
      if (record.status === 'half-day') row.halfDay += 1;
    });
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredRecords]);

  const reportRows = useMemo(() => [
    ...departmentRows.map(row => ({
      Department: row.department,
      'Attendance Records': row.total,
      Present: row.present,
      Absent: row.absent,
      Late: row.late,
      'Half Days': row.halfDay,
      'Attendance Rate': `${row.attendanceRate}%`,
    })),
    ...(departmentRows.length ? [{
      Department: 'Total',
      'Attendance Records': totals.total,
      Present: totals.present,
      Absent: totals.absent,
      Late: totals.late,
      'Half Days': totals.halfDay,
      'Attendance Rate': `${totals.total ? Math.round((totals.attended / totals.total) * 1000) / 10 : 0}%`,
    }] : []),
  ], [departmentRows, totals]);

  const downloadCsv = () => {
    if (!reportRows.length) return toast.error('There are no matching attendance records to export.');
    const headers = Object.keys(reportRows[0]);
    const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.map(quote).join(','), ...reportRows.map(row => headers.map(header => quote(row[header])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-report-${month}${department ? `-${department.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = async () => {
    if (!reportRows.length) return toast.error('There are no matching attendance records to export.');
    try {
      await downloadElementPdf(
        document.getElementById('attendance-report-document'),
        `attendance-report-${month}.pdf`
      );
      toast.success('Attendance report PDF downloaded.');
    } catch (error) {
      toast.error(error.message || 'Unable to download the attendance report.');
    }
  };

  const printReport = () => {
    if (!reportRows.length) return toast.error('There are no matching attendance records to print.');
    try {
      printElement(document.getElementById('attendance-report-document'), `Attendance Report ${month}`);
    } catch (error) {
      toast.error(error.message || 'Unable to print the attendance report.');
    }
  };

  const attendanceRate = totals.total
    ? Math.round((totals.attended / totals.total) * 1000) / 10
    : 0;

  return (
    <div>
      <div className="page-header">
        <div className="breadcrumb"><span>Attendance</span><span className="breadcrumb-sep">/</span><span>Reports</span></div>
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Attendance Reports</h1>
            <p className="page-subtitle">Reports are calculated from attendance records available to your account.</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline btn-sm" onClick={downloadPdf}><Download size={14} /> Export PDF</button>
            <button className="btn btn-outline btn-sm" onClick={downloadCsv}><Download size={14} /> Export CSV</button>
            <button className="btn btn-outline btn-sm" onClick={printReport}>Print</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', gap: 12, padding: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <label className="form-group" style={{ margin: 0 }}>
          <span className="form-label">Month</span>
          <input className="form-control" type="month" value={month} onChange={event => setMonth(event.target.value)} />
        </label>
        <label className="form-group" style={{ margin: 0 }}>
          <span className="form-label">Department</span>
          <select className="form-control form-select" value={department} onChange={event => setDepartment(event.target.value)}>
            <option value="">All departments</option>
            {departments.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 24 }}>
        {[
          { icon: CheckCircle, label: 'Recorded Attendance Rate', value: `${attendanceRate}%`, color: 'var(--success)', bg: 'var(--success-light)' },
          { icon: TrendingUp, label: 'Present Records', value: totals.present.toLocaleString(), color: 'var(--primary)', bg: 'var(--primary-light)' },
          { icon: AlertCircle, label: 'Absent Records', value: totals.absent.toLocaleString(), color: 'var(--danger)', bg: 'var(--danger-light)' },
          { icon: Clock, label: 'Late Records', value: totals.late.toLocaleString(), color: 'var(--warning)', bg: 'var(--warning-light)' },
        ].map(stat => (
          <div key={stat.label} className="stat-card">
            <div className="stat-card-icon" style={{ background: stat.bg }}><stat.icon size={22} color={stat.color} /></div>
            <div className="stat-card-value">{stat.value}</div>
            <div className="stat-card-label">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header"><h3 className="card-title">Daily Attendance Overview</h3></div>
        <div className="card-body" style={{ paddingTop: 8 }}>
          {dailyOverview.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dailyOverview}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="present" fill="#10b981" radius={3} name="Present" />
                <Bar dataKey="absent" fill="#ef4444" radius={3} name="Absent" />
                <Bar dataKey="late" fill="#f59e0b" radius={3} name="Late" />
                <Bar dataKey="halfDay" fill="#7c3aed" radius={3} name="Half Day" />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty-state">No attendance records match the selected month and department.</div>}
        </div>
      </div>

      <div id="attendance-report-document" className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Department-wise Summary</h3>
            <div className="form-hint">{month}{department ? ` · ${department}` : ' · All departments'} · {filteredRecords.length} matching records</div>
          </div>
        </div>
        <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
          <table className="table">
            <thead>
              <tr><th>Department</th><th>Attendance Records</th><th>Present</th><th>Absent</th><th>Late</th><th>Half Days</th><th>Attendance %</th></tr>
            </thead>
            <tbody>
              {reportRows.map(row => (
                <tr key={row.Department}>
                  <td style={{ fontWeight: 500 }}>{row.Department}</td>
                  <td>{row['Attendance Records']}</td>
                  <td>{row.Present}</td>
                  <td>{row.Absent}</td>
                  <td>{row.Late}</td>
                  <td>{row['Half Days']}</td>
                  <td>{row['Attendance Rate']}</td>
                </tr>
              ))}
              {!reportRows.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32 }}>No records for the selected filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AttendanceReports;
