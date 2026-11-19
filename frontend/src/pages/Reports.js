import React, { useState } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
  Download, FileText, Users, Clock, PlaneTakeoff,
  DollarSign, Star, ChevronRight, Printer, Filter
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatINR, formatINRCompact } from '../utils/currency';
import { downloadElementPdf } from '../utils/documentExport';
import toast from 'react-hot-toast';

const REPORT_CATEGORIES = [
  {
    id: 'employee', label: 'Employee Reports', icon: Users, color: 'var(--primary)', bg: 'var(--primary-light)',
    reports: [
      { id: 'emp-list',       name: 'Employee List',                desc: 'Complete list of all employees with details' },
      { id: 'dept-wise',      name: 'Department-wise Employees',    desc: 'Employee distribution across departments' },
      { id: 'active-inactive',name: 'Active / Inactive Employees',  desc: 'Employee status breakdown' },
      { id: 'new-joiners',    name: 'New Joiners',                   desc: 'Employees who joined this month/quarter' },
    ],
  },
  {
    id: 'attendance', label: 'Attendance Reports', icon: Clock, color: 'var(--info)', bg: 'var(--info-light)',
    reports: [
      { id: 'daily-att',   name: 'Daily Attendance',   desc: 'Day-wise attendance summary' },
      { id: 'monthly-att', name: 'Monthly Attendance',  desc: 'Monthly attendance analysis' },
      { id: 'absenteeism', name: 'Absenteeism Report',  desc: 'Employees with high absence rates' },
      { id: 'late-arrivals',name: 'Late Arrivals',      desc: 'Employees who arrive late frequently' },
      { id: 'overtime',    name: 'Overtime Report',     desc: 'Overtime hours by employee' },
    ],
  },
  {
    id: 'leave', label: 'Leave Reports', icon: PlaneTakeoff, color: 'var(--purple)', bg: 'var(--purple-light)',
    reports: [
      { id: 'leave-summary',  name: 'Leave Summary',           desc: 'Overall leave statistics' },
      { id: 'emp-leave-hist', name: 'Employee Leave History',   desc: 'Individual leave records' },
      { id: 'dept-leave',     name: 'Department Leave Report',  desc: 'Leave analysis by department' },
      { id: 'pending-leave',  name: 'Pending Leave Requests',   desc: 'All unapproved leave requests' },
    ],
  },
  {
    id: 'payroll', label: 'Salary Reports', icon: DollarSign, color: 'var(--teal)', bg: 'var(--teal-light)',
    reports: [
      { id: 'monthly-payroll', name: 'Monthly Salaries',   desc: 'Monthly payroll snapshots by recorded currency' },
      { id: 'salary-summary',  name: 'Salary Summary',    desc: 'Salary breakdown by department and currency' },
      { id: 'deductions',      name: 'Deductions Report', desc: 'Tax, PF, insurance and other deductions by currency' },
      { id: 'payslip-report',  name: 'Salary Slip Report', desc: 'Stored salary snapshots and deductions' },
    ],
  },
  {
    id: 'performance', label: 'Performance Reports', icon: Star, color: 'var(--warning)', bg: 'var(--warning-light)',
    reports: [
      { id: 'emp-perf',    name: 'Employee Performance',  desc: 'Individual performance ratings' },
      { id: 'dept-perf',   name: 'Department Performance',desc: 'Average performance by department' },
      { id: 'perf-ratings',name: 'Performance Ratings',   desc: 'Rating distribution across teams' },
    ],
  },
];

// Currency-aware tooltip
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="value" style={{ color: p.color }}>
          {p.name}:{' '}
          {typeof p.value === 'number' && p.value > 1000
            ? formatINR(p.value, { currency: ['INR', 'USD'].includes(p.dataKey) ? p.dataKey : 'UNVERIFIED' })
            : p.value}
        </div>
      ))}
    </div>
  );
};

const perfByDept = [
  { dept: 'Engineering', avg: 4.5 },
  { dept: 'HR',          avg: 4.3 },
  { dept: 'Marketing',   avg: 4.1 },
  { dept: 'Sales',       avg: 4.4 },
  { dept: 'Finance',     avg: 4.2 },
  { dept: 'Design',      avg: 4.0 },
];

const Reports = () => {
  const { employees, departments, leaveRequests, payrollData, attendanceData, performanceReviews } = useApp();
  const [activeCategory, setActiveCategory] = useState('employee');
  const [dateFrom,   setDateFrom]   = useState('');
  const [dateTo,     setDateTo]     = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [search,     setSearch]     = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');

  const category = REPORT_CATEGORIES.find(c => c.id === activeCategory);
  const Icon     = category?.icon;

  const payrollNet = record => record.net ?? (
    (record.basic || 0) + (record.hra || 0) + (record.allowances || 0) + (record.bonus || 0) + (record.overtimeEarnings || 0)
    - (record.tax || 0) - (record.insurance || 0) - (record.otherDeductions || 0)
    - (record.advanceDeductions || 0) - (record.employeePF || 0) - (record.leaveDeduction || 0)
  );
  const reportRows = (() => {
    const term = search.trim().toLowerCase();
    const textMatches = record => !term || [
      record.name, record.employeeName, record.employeeId, record.email, record.department,
    ].some(value => String(value || '').toLowerCase().includes(term));
    const departmentMatches = record => !deptFilter || record.department === deptFilter;
    const dateMatches = (start, end = start) => (!dateFrom || !end || end >= dateFrom)
      && (!dateTo || !start || start <= dateTo);
    if (activeCategory === 'employee') {
      return employees.filter(record => textMatches(record) && departmentMatches(record)
        && dateMatches(record.joiningDate || '', record.joiningDate || '')).map(record => ({
        'Employee ID': record.employeeId || '',
        Employee: record.name || '',
        Email: record.email || '',
        Department: record.department || '',
        Designation: record.designation || '',
        Status: record.status || '',
        'Joining Date': record.joiningDate || '',
        Currency: record.currency || 'UNVERIFIED',
        'Annual Salary': record.salary ?? '',
      }));
    }
    if (activeCategory === 'attendance') {
      return attendanceData.filter(record => textMatches(record) && departmentMatches(record)
        && dateMatches(record.date, record.date)).map(record => ({
        Date: record.date || '',
        Employee: record.name || record.employeeName || '',
        Email: record.email || '',
        Department: record.department || '',
        'Check In': record.checkIn || '',
        'Check Out': record.checkOut || '',
        Hours: record.hours ?? 0,
        Status: record.status || '',
        Late: record.late ? 'Yes' : 'No',
      }));
    }
    if (activeCategory === 'leave') {
      return leaveRequests.filter(record => textMatches(record) && departmentMatches(record)
        && dateMatches(record.startDate, record.endDate)).map(record => ({
        Employee: record.employeeName || '',
        Department: record.department || '',
        'Leave Type': record.leaveType || '',
        Start: record.startDate || '',
        End: record.endDate || '',
        Days: record.days ?? 0,
        Status: record.status || '',
        'Applied Date': record.appliedDate || '',
      }));
    }
    if (activeCategory === 'payroll') {
      return payrollData.filter(record => {
        const monthNumber = String(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(record.month) + 1).padStart(2, '0');
        const periodStart = `${record.year}-${monthNumber}-01`;
        const periodEnd = new Date(Number(record.year), Number(monthNumber), 0).toISOString().slice(0, 10);
        return textMatches(record) && departmentMatches(record)
          && (!currencyFilter || (record.currency || 'UNVERIFIED') === currencyFilter)
          && dateMatches(periodStart, periodEnd);
      }).map(record => ({
        Period: `${record.month} ${record.year}`,
        Employee: record.employeeName || '',
        'Employee ID': record.employeeId || '',
        Department: record.department || '',
        Currency: record.currency || 'UNVERIFIED',
        Basic: record.basic ?? 0,
        Gross: record.gross ?? ((record.basic || 0) + (record.hra || 0) + (record.allowances || 0) + (record.bonus || 0) + (record.overtimeEarnings || 0)),
        Tax: record.tax ?? 0,
        Insurance: record.insurance ?? 0,
        'Other Deductions': record.otherDeductions ?? 0,
        'Advance Deductions': record.advanceDeductions ?? 0,
        'Employee PF': record.employeePF ?? 0,
        'Leave Deduction': record.leaveDeduction ?? 0,
        Net: payrollNet(record),
        Status: record.status || '',
      }));
    }
    return performanceReviews.filter(record => textMatches(record) && departmentMatches(record)
      && dateMatches(record.reviewDate || '', record.reviewDate || '')).map(record => ({
      Employee: record.employeeName || '',
      Department: record.department || '',
      'Review Period': record.reviewPeriod || '',
      'Review Date': record.reviewDate || '',
      Rating: record.overallRating ?? '',
      Status: record.status || '',
    }));
  })();

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const printReport = (title = 'Report') => {
    const headers = Object.keys(reportRows[0] || {});
    if (!headers.length) {
      toast.error('There are no matching records to print.');
      return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Allow pop-ups to print or save this report as PDF.');
      return;
    }
    printWindow.opener = null;
    const rows = reportRows.map(row => `<tr>${headers.map(header => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('');
    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>body{font:12px Arial,sans-serif;padding:24px;color:#111}h1{font-size:20px}p{color:#555}table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eee} @page{size:landscape;margin:12mm}</style></head><body><h1>${escapeHtml(title)}</h1><p>${reportRows.length} matching records · Generated ${new Date().toLocaleString()}</p><table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };
  const downloadReportPdf = async (reportName) => {
    const headers = Object.keys(reportRows[0] || {});
    if (!headers.length) {
      toast.error('There are no matching records to export.');
      return;
    }

    const container = document.createElement('section');
    container.style.cssText = 'background:#fff;color:#111;padding:24px;font:12px Arial,sans-serif;width:1100px';
    const title = document.createElement('h1');
    title.textContent = reportName || category?.label || 'Report';
    const details = document.createElement('p');
    details.textContent = `${reportRows.length} matching records · Generated ${new Date().toLocaleString()}`;
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse';
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
      const cell = document.createElement('th');
      cell.textContent = header;
      cell.style.cssText = 'border:1px solid #bbb;padding:6px;text-align:left;background:#eee';
      headerRow.appendChild(cell);
    });
    head.appendChild(headerRow);
    const body = document.createElement('tbody');
    reportRows.forEach(row => {
      const rowElement = document.createElement('tr');
      headers.forEach(header => {
        const cell = document.createElement('td');
        cell.textContent = String(row[header] ?? '');
        cell.style.cssText = 'border:1px solid #bbb;padding:6px;text-align:left';
        rowElement.appendChild(cell);
      });
      body.appendChild(rowElement);
    });
    table.append(head, body);
    container.append(title, details, table);
    document.body.appendChild(container);
    try {
      const filename = `${String(reportName || category?.label || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
      await downloadElementPdf(container, filename, { jsPDF: { orientation: 'landscape' } });
      toast.success('Report PDF downloaded.');
    } catch (error) {
      toast.error(error.message || 'Unable to download this report.');
    } finally {
      container.remove();
    }
  };
  const handleExport = (format, reportName) => {
    const headers = Object.keys(reportRows[0] || {});
    if (!headers.length) {
      toast.error('There are no matching records to export.');
      return;
    }
    if (format === 'pdf') {
      downloadReportPdf(reportName || category?.label || 'Report');
      return;
    }
    const csv = [
      headers.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','),
      ...reportRows.map(row => headers.map(header => `"${String(row[header] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${String(reportName || category?.label || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => printReport(category?.label || 'Report');

  // Build department distribution from live employee data
  const deptDist = departments.map(d => ({
    name:      d.name,
    employees: employees.filter(e => e.department === d.name).length,
    color:     ['#4f46e5','#10b981','#f59e0b','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316'][departments.indexOf(d) % 8],
  })).filter(d => d.employees > 0);

  // Build salary distribution from live employees
  const salaryByDept = (() => {
    const groups = {};
    reportRows.forEach(record => {
      const key = `${record.Department}|${record.Currency}`;
      if (!groups[key]) groups[key] = { dept: `${record.Department.slice(0, 6)} · ${record.Currency}`, total: 0, count: 0 };
      groups[key].total += Number(record.Net || 0);
      groups[key].count += 1;
    });
    return Object.values(groups).map(group => ({ dept: group.dept, avg: Math.round(group.total / group.count) }));
  })();

  // Payroll trend from actual payroll records
  const payrollTrend = (() => {
    const byMonth = {};
    reportRows.forEach(record => {
      const key = record.Period;
      const currency = record.Currency;
      byMonth[key] ||= { month: key };
      byMonth[key][currency] = (byMonth[key][currency] || 0) + Number(record.Net || 0);
    });
    return Object.values(byMonth);
  })();

  // Leave stats from live requests
  const leaveStatData = ['Annual Leave','Sick Leave','Casual Leave','Other'].map((name, i) => ({
    name,
    value: leaveRequests.filter(r => r.leaveType === name).length || 0,
    color: ['#4f46e5','#ef4444','#3b82f6','#8b5cf6'][i],
  })).filter(s => s.value > 0);

  // Attendance from live data
  const attByDay = ['Mon','Tue','Wed','Thu','Fri'].map(day => ({
    day,
    present: attendanceData.filter(a => a.status === 'present').length,
    absent:  attendanceData.filter(a => a.status === 'absent').length,
    late:    attendanceData.filter(a => a.late).length,
  }));

  const EmptyChart = ({ message }) => (
    <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', flexDirection: 'column', gap: 8 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FileText size={18} color="var(--text-muted)" />
      </div>
      {message || 'No data yet — add records to see charts'}
    </div>
  );

  const renderChart = () => {
    switch (activeCategory) {
      case 'employee':
        return (
          <div className="grid grid-2">
            <div className="card">
              <div className="card-header"><h3 className="card-title">Department Distribution</h3></div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                {deptDist.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={deptDist} barSize={20}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="employees" name="Employees" radius={4}>
                        {deptDist.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Add employees to see department distribution" />}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3 className="card-title">Employment Type</h3></div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                {employees.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Full-time', value: employees.filter(e => e.employmentType === 'Full-time').length  },
                          { name: 'Contract',  value: employees.filter(e => e.employmentType === 'Contract').length   },
                          { name: 'Part-time', value: employees.filter(e => e.employmentType === 'Part-time').length  },
                          { name: 'Intern',    value: employees.filter(e => e.employmentType === 'Intern').length     },
                        ].filter(d => d.value > 0)}
                        cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="name"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {['#4f46e5','#10b981','#f59e0b','#8b5cf6'].map((c, i) => <Cell key={i} fill={c} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Add employees to see employment types" />}
              </div>
            </div>
          </div>
        );

      case 'attendance':
        return (
          <div className="grid grid-2">
            <div className="card">
              <div className="card-header"><h3 className="card-title">Attendance Summary</h3></div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                {attendanceData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={attByDay} barSize={14}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="day" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Bar dataKey="present" fill="#10b981" radius={3} name="Present" />
                      <Bar dataKey="absent"  fill="#ef4444" radius={3} name="Absent"  />
                      <Bar dataKey="late"    fill="#f59e0b" radius={3} name="Late"    />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Mark attendance to see charts" />}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3 className="card-title">Attendance Status Breakdown</h3></div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                {attendanceData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Present', value: attendanceData.filter(a => a.status === 'present').length },
                          { name: 'Absent',  value: attendanceData.filter(a => a.status === 'absent').length  },
                          { name: 'Late',    value: attendanceData.filter(a => a.status === 'late').length    },
                          { name: 'Leave',   value: attendanceData.filter(a => a.status === 'leave').length   },
                        ].filter(d => d.value > 0)}
                        cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="name"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {['#10b981','#ef4444','#f59e0b','#3b82f6'].map((c, i) => <Cell key={i} fill={c} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Mark attendance to see breakdown" />}
              </div>
            </div>
          </div>
        );

      case 'leave':
        return (
          <div className="grid grid-2">
            <div className="card">
              <div className="card-header"><h3 className="card-title">Leave Type Distribution</h3></div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                {leaveStatData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={leaveStatData} cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="name"
                        label={({ name, value }) => `${name}: ${value}`}>
                        {leaveStatData.map((s, i) => <Cell key={i} fill={s.color} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Submit leave requests to see distribution" />}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3 className="card-title">Leave Status Summary</h3></div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={[
                    { status: 'Approved', count: leaveRequests.filter(r => r.status === 'approved').length },
                    { status: 'Pending',  count: leaveRequests.filter(r => r.status === 'pending').length  },
                    { status: 'Rejected', count: leaveRequests.filter(r => r.status === 'rejected').length },
                  ]} barSize={40}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="status" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" name="Requests" radius={4}>
                      <Cell fill="#10b981" /><Cell fill="#f59e0b" /><Cell fill="#ef4444" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        );

      case 'payroll':
        return (
          <div className="grid grid-2">
            <div className="card">
              <div className="card-header"><h3 className="card-title">Salary Trend by Currency</h3></div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                {payrollTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={payrollTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false}
                        tickFormatter={v => currencyFilter ? formatINRCompact(v, currencyFilter) : v.toLocaleString('en-IN')} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="INR" stroke="#14b8a6" strokeWidth={2.5} dot={{ r: 4, fill: '#14b8a6' }} name="Net Salary (INR)" />
                      <Line type="monotone" dataKey="USD" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 4, fill: '#4f46e5' }} name="Net Salary (USD)" />
                      <Line type="monotone" dataKey="UNVERIFIED" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 4, fill: '#f59e0b' }} name="Net Salary (Unverified)" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Generate salaries to see trends" />}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3 className="card-title">Average Net Payroll by Department / Currency</h3></div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                {salaryByDept.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={salaryByDept} barSize={24}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="dept" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false}
                        tickFormatter={v => formatINRCompact(v)} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="avg" fill="#4f46e5" radius={4} name="Average Net Payroll" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart message="Add employees with salaries to see this chart" />}
              </div>
            </div>
          </div>
        );

      case 'performance':
        return (
          <div className="grid grid-2">
            <div className="card">
              <div className="card-header"><h3 className="card-title">Avg Rating by Department</h3></div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={perfByDept} barSize={24} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="dept" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={70} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="avg" fill="#f59e0b" radius={4} name="Avg Rating" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3 className="card-title">Rating Distribution</h3></div>
              <div className="card-body" style={{ paddingTop: 8 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={[
                    { rating: '1 — Poor',           count: 0 },
                    { rating: '2 — Needs Imp.',     count: 0 },
                    { rating: '3 — Meets',          count: 0 },
                    { rating: '4 — Very Good',      count: 0 },
                    { rating: '5 — Excellent',      count: 0 },
                  ]} barSize={30}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="rating" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" name="Employees" radius={4}>
                      {['#ef4444','#f97316','#f59e0b','#3b82f6','#10b981'].map((c, i) => <Cell key={i} fill={c} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        );

      default: return null;
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-top">
          <div>
            <h1 className="page-title">Reports & Analytics</h1>
            <p className="page-subtitle">Generate and export filtered reports using stored records and currency metadata.</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline btn-sm" onClick={handlePrint}><Printer size={14} /> Print</button>
            <button className="btn btn-outline btn-sm" onClick={() => handleExport('csv', category?.label)}><Download size={14} /> Export CSV</button>
            <button className="btn btn-primary btn-sm"  onClick={() => handleExport('pdf', category?.label)}><Download size={14} /> Export PDF</button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20, padding: '14px 20px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            <Filter size={14} /> Filters:
          </div>
          <input type="date" className="form-control" style={{ width: 150 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>to</span>
          <input type="date" className="form-control" style={{ width: 150 }} value={dateTo}   onChange={e => setDateTo(e.target.value)} />
          <select className="form-control form-select" style={{ width: 180 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">All Departments</option>
            {departments.map(d => <option key={d._id || d.id} value={d.name}>{d.name}</option>)}
          </select>
          {activeCategory === 'payroll' && (
            <select className="form-control form-select" style={{ width: 180 }} value={currencyFilter} onChange={event => setCurrencyFilter(event.target.value)}>
              <option value="">All currencies</option>
              <option value="INR">INR</option>
              <option value="USD">USD</option>
              <option value="UNVERIFIED">Unverified</option>
            </select>
          )}
          <input className="form-control" style={{ width: 180 }} placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24 }}>
        {/* Category sidebar */}
        <div className="card" style={{ overflow: 'hidden', height: 'fit-content' }}>
          {REPORT_CATEGORIES.map(cat => {
            const CatIcon  = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <div key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{
                padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                background: isActive ? cat.bg : 'transparent',
                display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.15s',
              }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: isActive ? cat.color : 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CatIcon size={16} color={isActive ? 'white' : cat.color} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: isActive ? cat.color : 'var(--text-primary)' }}>{cat.label}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{cat.reports.length} reports</div>
                </div>
                {isActive && <ChevronRight size={14} color={cat.color} />}
              </div>
            );
          })}
        </div>

        {/* Charts + report list */}
        <div>
          <div style={{ marginBottom: 20 }}>{renderChart()}</div>

          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {Icon && <Icon size={18} color={category?.color} />}
                <h3 className="card-title">{category?.label}</h3>
              </div>
            </div>
            <div style={{ padding: 0 }}>
              {category?.reports.map((rep, i) => (
                <div key={rep.id} style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px',
                  borderBottom: i < category.reports.length - 1 ? '1px solid var(--border)' : 'none',
                  transition: 'background 0.15s',
                }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: category.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <FileText size={16} color={category.color} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{rep.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{rep.desc}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => handleExport('csv', rep.name)}><Download size={12} /> CSV</button>
                    <button className="btn btn-outline btn-sm" onClick={() => handleExport('pdf', rep.name)}><Download size={12} /> PDF</button>
                    <button className="btn btn-ghost   btn-sm" onClick={handlePrint}><Printer size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Reports;
