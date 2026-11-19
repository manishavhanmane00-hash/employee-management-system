import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  employeeAPI, attendanceAPI, leaveAPI, payrollAPI, performanceAPI,
  notificationAPI, requestAPI, departmentAPI, designationAPI, taskAPI, reportAPI,
  holidayAPI, overtimeAPI, advanceAPI,
} from '../services/api';
import { useAuth } from './AuthContext';
import toast from 'react-hot-toast';

const AppContext = createContext(null);

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};

export const AppProvider = ({ children }) => {
  const { user } = useAuth();

  // ── Sidebar ────────────────────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // ── DB-backed data ─────────────────────────────────────────────────────────
  const [employees,          setEmployees]          = useState([]);
  const [employeesLoading,   setEmployeesLoading]   = useState(false);
  const [employeesError,      setEmployeesError]      = useState('');
  const [departments,        setDepartments]        = useState([]);
  const [designationRecords, setDesignationRecords] = useState([]);
  const [attendanceData,     setAttendanceData]     = useState([]);
  const [leaveRequests,      setLeaveRequests]      = useState([]);
  const [leaveBalances,      setLeaveBalances]      = useState([]);
  const [tasks,              setTasks]              = useState([]);
  const [payrollData,        setPayrollData]        = useState([]);
  const [performanceReviews, setPerformanceReviews] = useState([]);
  const [notifications,      setNotifications]      = useState([]);
  const [centralRequests,    setCentralRequests]    = useState([]);
  const [dashboardStats,     setDashboardStats]     = useState(null);
  const [holidays,           setHolidays]           = useState([]);
  const [overtimeEntries,    setOvertimeEntries]    = useState([]);
  const [advanceRecords,     setAdvanceRecords]     = useState([]);

  const currency = { code: 'INR', symbol: '₹', locale: 'en-IN' };
  const toggleSidebar = () => setSidebarCollapsed(c => !c);

  // ── Fetch helpers ──────────────────────────────────────────────────────────
  const fetchEmployees = useCallback(async () => {
    setEmployeesLoading(true);
    setEmployeesError('');
    try {
      const pageSize = 100;
      const firstPage = await employeeAPI.getAll({ page: 1, limit: pageSize });
      if (!firstPage.data?.success || !Array.isArray(firstPage.data.data)) {
        throw new Error(firstPage.data?.message || 'The employee list response was invalid.');
      }

      const total = Number(firstPage.data.total ?? firstPage.data.count ?? firstPage.data.data.length);
      const totalPages = Math.max(1, Number(firstPage.data.totalPages) || Math.ceil(total / pageSize));
      const remainingPages = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, index) =>
          employeeAPI.getAll({ page: index + 2, limit: pageSize })
        )
      );
      const pages = [firstPage, ...remainingPages].map(response => {
        if (!response.data?.success || !Array.isArray(response.data.data)) {
          throw new Error(response.data?.message || 'An employee list page could not be loaded.');
        }
        return response.data.data;
      });
      const allEmployees = pages.flat();
      if (Number.isFinite(total) && allEmployees.length < total) {
        throw new Error(`Loaded ${allEmployees.length} of ${total} employee records. Refresh to try again.`);
      }
      setEmployees(allEmployees);
      return allEmployees;
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Unable to load employee records.';
      setEmployeesError(message);
      console.error('[Employee list]', message);
      throw new Error(message);
    } finally {
      setEmployeesLoading(false);
    }
  }, []);

  const fetchDepartments = useCallback(async () => {
    try {
      const { data } = await departmentAPI.getAll();
      if (data.success) setDepartments(data.data);
    } catch { }
  }, []);

  const fetchDesignations = useCallback(async () => {
    const { data } = await designationAPI.getAll({ includeInactive: true });
    if (!data.success || !Array.isArray(data.data)) {
      throw new Error(data.message || 'Unable to load role / designation records.');
    }
    setDesignationRecords(data.data);
    return data.data;
  }, []);

  const fetchAttendance = useCallback(async () => {
    try {
      const { data } = await attendanceAPI.getAll();
      if (data.success) setAttendanceData(data.data);
    } catch { }
  }, []);

  const fetchLeave = useCallback(async () => {
    try {
      const { data } = await leaveAPI.getAll();
      if (data.success) setLeaveRequests(data.data);
    } catch { }
  }, []);

  const fetchLeaveBalances = useCallback(async (params) => {
    try {
      const { data } = await leaveAPI.getBalance(params);
      if (data.success) setLeaveBalances(data.data);
    } catch { }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const { data } = await taskAPI.getAll();
      if (data.success) setTasks(data.data);
    } catch { }
  }, []);

  const fetchPayroll = useCallback(async () => {
    try {
      const { data } = await payrollAPI.getAll();
      if (data.success) setPayrollData(data.data);
    } catch { }
  }, []);

  const fetchPerformance = useCallback(async () => {
    try {
      const { data } = await performanceAPI.getAll();
      if (data.success) setPerformanceReviews(data.data);
    } catch { }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data } = await notificationAPI.getAll();
      if (data.success) setNotifications(data.data);
    } catch { }
  }, []);

  const fetchCentralRequests = useCallback(async () => {
    try {
      const { data } = await requestAPI.getAll();
      if (data.success) setCentralRequests(data.data);
    } catch { }
  }, []);

  const fetchDashboardStats = useCallback(async () => {
    try {
      const { data } = await reportAPI.dashboard();
      if (data.success) setDashboardStats(data.data);
    } catch { }
  }, []);

  const fetchHolidays = useCallback(async () => {
    try {
      const { data } = await holidayAPI.getAll();
      if (data.success) setHolidays(data.data);
    } catch { }
  }, []);

  const fetchOvertime = useCallback(async () => {
    try {
      const { data } = await overtimeAPI.getAll();
      if (data.success) setOvertimeEntries(data.data);
    } catch { }
  }, []);

  const fetchAdvances = useCallback(async () => {
    try {
      const { data } = await advanceAPI.getAll();
      if (data.success) setAdvanceRecords(data.data);
    } catch { }
  }, []);

  // Load all data when user logs in
  useEffect(() => {
    if (!user) {
      setEmployees([]); setDepartments([]); setDesignationRecords([]); setAttendanceData([]); setLeaveRequests([]);
      setEmployeesError('');
      setPayrollData([]); setPerformanceReviews([]); setNotifications([]); setCentralRequests([]); setTasks([]);
      setLeaveBalances([]); setDashboardStats(null);
      setHolidays([]); setOvertimeEntries([]); setAdvanceRecords([]);
      return;
    }
    const employeeOnboardingPending = user.role === 'Employee'
      && !(user.registrationStatus === 'approved'
        && user.accountStatus === 'active'
        && user.onboardingStatus === 'completed'
        && user.personalInfoApprovalStatus === 'approved'
        && user.documentVerificationStatus === 'verified');
    if (employeeOnboardingPending) {
      fetchNotifications();
      return;
    }
    fetchEmployees().catch(() => {});
    fetchDepartments();
    fetchDesignations().catch(() => {});
    fetchAttendance();
    fetchLeave();
    fetchLeaveBalances();
    fetchTasks();
    fetchPayroll();
    fetchPerformance();
    fetchNotifications();
    fetchCentralRequests();
    fetchDashboardStats();
    fetchHolidays();
    fetchOvertime();
    fetchAdvances();
  }, [user, fetchEmployees, fetchDepartments, fetchDesignations, fetchAttendance, fetchLeave, fetchLeaveBalances, fetchTasks, fetchPayroll, fetchPerformance, fetchNotifications, fetchCentralRequests, fetchDashboardStats, fetchHolidays, fetchOvertime, fetchAdvances]);

  useEffect(() => {
    if (!user) return undefined;
    const controller = new AbortController();
    let active = true;
    const connect = async () => {
      while (active) {
        try {
          const response = await fetch(requestAPI.streamUrl, {
            headers: { Authorization: `Bearer ${localStorage.getItem('ems-token') || ''}` },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error(`Notification stream returned ${response.status}`);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (active) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';
            for (const event of events) {
              const payload = event.split('\n').find(line => line.startsWith('data: '));
              if (payload) {
                try {
                  const notification = JSON.parse(payload.slice(6));
                  setNotifications(previous => [
                    notification,
                    ...previous.filter(item => String(item._id || item.id) !== String(notification._id)),
                  ]);
                  if ((notification.type === 'onboarding' && notification.requestStatus === 'Approved')
                    || (notification.type === 'account' && notification.requestStatus === 'Active')) {
                    window.dispatchEvent(new Event('ems:auth-refresh'));
                  }
                  fetchCentralRequests();
                  if (notification.type === 'leave' || notification.requestType === 'Leave') {
                    fetchLeaveBalances();
                    fetchLeave();
                    fetchAttendance();
                    fetchDashboardStats();
                  }
                  if (notification.type === 'overtime' || notification.type === 'payroll' || notification.requestType === 'Overtime') {
                    fetchOvertime();
                    window.dispatchEvent(new Event('ems:overtime-updated'));
                  }
                  if (notification.requestType === 'Advance' || notification.type === 'advance') {
                    fetchAdvances();
                    fetchDashboardStats();
                  }
                  if (notification.type === 'payroll') {
                    fetchAdvances();
                    fetchPayroll();
                    fetchDashboardStats();
                  }
                  if (notification.type === 'reporting') {
                    fetchEmployees();
                    fetchDashboardStats();
                    window.dispatchEvent(new Event('ems:reporting-updated'));
                  }
                  if (notification.type === 'directory') {
                    fetchEmployees();
                    fetchDashboardStats();
                    window.dispatchEvent(new Event('ems:reporting-updated'));
                  }
                } catch { /* Ignore malformed stream events and keep the connection alive. */ }
              }
            }
          }
        } catch (error) {
          if (error.name === 'AbortError') return;
        }
        if (active) await new Promise(resolve => setTimeout(resolve, 3000));
      }
    };
    connect();
    return () => {
      active = false;
      controller.abort();
    };
  }, [user, fetchCentralRequests, fetchLeaveBalances, fetchLeave, fetchAttendance, fetchDashboardStats, fetchOvertime, fetchAdvances, fetchPayroll, fetchEmployees]);

  // ── Employee CRUD ──────────────────────────────────────────────────────────
  const addEmployee = async (emp) => {
    const { data } = await employeeAPI.create(emp);
    if (data.success) {
      setEmployees(prev => [
        data.data,
        ...prev.filter(employee => !employee.accountOnly
          || (String(employee._id) !== String(data.data.userId)
            && String(employee._id) !== String(data.data.employeeRef)
            && employee.email?.toLowerCase() !== data.data.email?.toLowerCase())),
      ]);
      return data.data;
    }
    throw new Error(data.message);
  };

  const updateEmployee = async (id, updates) => {
    const { data } = await employeeAPI.update(id, updates);
    if (data.success) { setEmployees(prev => prev.map(e => e._id === id ? data.data : e)); return data.data; }
    throw new Error(data.message);
  };

  const deleteEmployee = async (id) => {
    await employeeAPI.delete(id);
    setEmployees(prev => prev.filter(e => e._id !== id));
  };

  const setEmployeeStatus = async (id, status) => {
    const { data } = await employeeAPI.setStatus(id, { status });
    if (data.success) { setEmployees(prev => prev.map(e => e._id === id ? data.data : e)); return data.data; }
    throw new Error(data.message);
  };

  // ── Employee drafts (resume-able partially-filled forms) ────────────────────
  const getEmployeeDrafts = async () => {
    const { data } = await employeeAPI.getDrafts();
    if (data.success) return data.data;
    throw new Error(data.message);
  };

  const getEmployeeDraft = async (id) => {
    const { data } = await employeeAPI.getDraft(id);
    if (data.success) return data.data;
    throw new Error(data.message);
  };

  // Create or update a draft depending on whether a draftId is provided.
  const saveEmployeeDraft = async (draftId, draftData) => {
    const { data } = draftId
      ? await employeeAPI.updateDraft(draftId, draftData)
      : await employeeAPI.createDraft(draftData);
    if (data.success) return data.data;
    throw new Error(data.message);
  };

  const deleteEmployeeDraft = async (id) => {
    const { data } = await employeeAPI.deleteDraft(id);
    if (data.success) return data.data;
    throw new Error(data.message);
  };

  // ── Department CRUD ──────────────────────────────────────────────────────────
  const addDepartment = async (dept) => {
    const { data } = await departmentAPI.create(dept);
    if (data.success) { setDepartments(prev => [...prev, data.data]); return data.data; }
    throw new Error(data.message);
  };

  const updateDepartment = async (id, updates) => {
    const { data } = await departmentAPI.update(id, updates);
    if (data.success) {
      setDepartments(prev => prev.map(d => d._id === id ? data.data : d));
      await fetchEmployees();
      return data.data;
    }
    throw new Error(data.message);
  };

  const deleteDepartment = async (id) => {
    const { data } = await departmentAPI.delete(id);
    if (data.success) { setDepartments(prev => prev.filter(d => d._id !== id)); return data.data; }
    throw new Error(data.message);
  };

  // ── Attendance ─────────────────────────────────────────────────────────────
  const markAttendance = async (record) => {
    try {
      const { data } = await attendanceAPI.mark(record);
      if (data.success) {
        setAttendanceData(prev => {
          const idx = prev.findIndex(a => a.date === data.data.date && (
            a.employeeId === data.data.employeeId
            || a._id === data.data._id
            || (a.userId && data.data.userId && String(a.userId) === String(data.data.userId))
            || (a.email && data.data.email && a.email === data.data.email)
          ));
          if (idx >= 0) {
            const u = [...prev];
            const holidays = prev[idx].holidays || [];
            u[idx] = {
              ...data.data,
              holidays,
              ...(holidays.length ? { attendanceStatus: data.data.status, status: 'holiday' } : {}),
            };
            return u;
          }
          return [data.data, ...prev];
        });
        await fetchOvertime();
        return data.data;
      }
    } catch { }
  };

  const selfMarkAttendance = async (record) => {
    try {
      const { data } = await attendanceAPI.selfMark(record);
      if (data.success) {
        setAttendanceData(prev => {
          const idx = prev.findIndex(a =>
            a.date === data.data.date &&
            (a.userId === data.data.userId ||
             a.email  === data.data.email  ||
             a._id?.toString() === data.data._id?.toString())
          );
          if (idx >= 0) {
            const u = [...prev];
            const holidays = prev[idx].holidays || [];
            u[idx] = {
              ...data.data,
              holidays,
              ...(holidays.length ? { attendanceStatus: data.data.status, status: 'holiday' } : {}),
            };
            return u;
          }
          return [data.data, ...prev];
        });
        return data.data;
      }
      throw new Error(data.message || 'Failed to save attendance');
    } catch (err) {
      // Re-throw with the backend error message if available
      const message = err.response?.data?.message || err.message || 'Failed to save attendance';
      throw new Error(message);
    }
  };

  const doCheckIn = async () => {
    try {
      const { data } = await attendanceAPI.checkIn();
      if (data.success) {
        setAttendanceData(prev => {
          const idx = prev.findIndex(a => a._id === data.data._id || (
            a.date === data.data.date
            && ((a.userId && String(a.userId) === String(data.data.userId))
              || (a.email && data.data.email && a.email === data.data.email))
          ));
          if (idx >= 0) {
            const u = [...prev];
            const holidays = prev[idx].holidays || [];
            u[idx] = {
              ...data.data,
              holidays,
              ...(holidays.length ? { attendanceStatus: data.data.status, status: 'holiday' } : {}),
            };
            return u;
          }
          return [data.data, ...prev];
        });
        return data;
      }
      throw new Error(data.message);
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Check-in failed';
      throw new Error(message);
    }
  };

  const doCheckOut = async () => {
    try {
      const { data } = await attendanceAPI.checkOut();
      if (data.success) {
        setAttendanceData(prev => prev.map(a => a._id === data.data._id || (
          a.date === data.data.date
          && ((a.userId && String(a.userId) === String(data.data.userId))
            || (a.email && data.data.email && a.email === data.data.email))
        ) ? {
          ...data.data,
          holidays: a.holidays || [],
          ...(a.holidays?.length ? { attendanceStatus: data.data.status, status: 'holiday' } : {}),
        } : a));
        await fetchOvertime();
        return data;
      }
      throw new Error(data.message);
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Check-out failed';
      throw new Error(message);
    }
  };

  // ── Leave ──────────────────────────────────────────────────────────────────
  const addLeaveRequest = async (req) => {
    try {
      const { data } = await leaveAPI.apply(req);
      if (!data.success) {
        throw new Error(data.message || 'Leave request submission failed.');
      }
      setLeaveRequests(prev => [data.data, ...prev]);
      await fetchLeaveBalances();
      return data.data;
    } catch (error) {
      throw new Error(
        error.response?.data?.message
        || error.message
        || 'Leave request submission failed. Please try again.'
      );
    }
  };

  const updateLeaveStatus = async (id, status, reason = '') => {
    const { data } = await leaveAPI.updateStatus(id, { status, rejectionReason: reason });
    if (data.success) {
      setLeaveRequests(prev => prev.map(r => (r._id === id || r.id === id) ? data.data : r));
      await fetchLeaveBalances();
      await Promise.all([fetchAttendance(), fetchDashboardStats()]);
      return data.data;
    }
    throw new Error(data.message);
  };

  const cancelLeave = async (id) => {
    const { data } = await leaveAPI.cancel(id);
    if (data.success) {
      setLeaveRequests(prev => prev.map(r => (r._id === id || r.id === id) ? data.data : r));
      await fetchLeaveBalances();
      await Promise.all([fetchAttendance(), fetchDashboardStats()]);
      return data.data;
    }
    throw new Error(data.message);
  };

  // ── Holidays ───────────────────────────────────────────────────────────────
  const addHoliday = async (holiday) => {
    const { data } = await holidayAPI.create(holiday);
    if (data.success) { setHolidays(prev => [data.data, ...prev]); await fetchAttendance(); return data.data; }
    throw new Error(data.message);
  };

  const updateHoliday = async (id, updates) => {
    const { data } = await holidayAPI.update(id, updates);
    if (data.success) { setHolidays(prev => prev.map(h => (h._id === id || h.id === id) ? data.data : h)); await fetchAttendance(); return data.data; }
    throw new Error(data.message);
  };

  const deleteHoliday = async (id) => {
    const { data } = await holidayAPI.delete(id);
    if (data.success) {
      setHolidays(prev => prev.map(h => (h._id === id || h.id === id) ? data.data : h));
      await fetchAttendance();
      return data.data;
    }
    throw new Error(data.message);
  };

  // ── Overtime ───────────────────────────────────────────────────────────────
  const addOvertime = async (entry) => {
    const { data } = await overtimeAPI.create(entry);
    if (data.success) { setOvertimeEntries(prev => [data.data, ...prev]); return data; }
    throw new Error(data.message);
  };

  const updateOvertime = async (id, updates) => {
    const { data } = await overtimeAPI.update(id, updates);
    if (data.success) { setOvertimeEntries(prev => prev.map(o => (o._id === id || o.id === id) ? data.data : o)); return data; }
    throw new Error(data.message);
  };

  const settleOvertime = async (id, paymentReference = '') => {
    const { data } = await overtimeAPI.settle(id, { paymentReference });
    if (data.success) { setOvertimeEntries(prev => prev.map(o => (o._id === id || o.id === id) ? data.data : o)); return data; }
    throw new Error(data.message);
  };

  const setOvertimeApproval = async (id, approvalStatus) => {
    const { data } = await overtimeAPI.setApproval(id, { approvalStatus });
    if (data.success) { setOvertimeEntries(prev => prev.map(o => (o._id === id || o.id === id) ? data.data : o)); return data; }
    throw new Error(data.message);
  };

  const deleteOvertime = async (id) => {
    const { data } = await overtimeAPI.delete(id);
    if (data.success) { setOvertimeEntries(prev => prev.filter(o => o._id !== id && o.id !== id)); return data; }
    throw new Error(data.message);
  };

  // ── Advances ───────────────────────────────────────────────────────────────
  const addAdvance = async (record) => {
    const { data } = await advanceAPI.create(record);
    if (data.success) {
      setAdvanceRecords(prev => [data.data, ...prev.filter(item => String(item._id || item.id) !== String(data.data._id || data.data.id))]);
      await Promise.all([fetchCentralRequests(), fetchNotifications()]);
      return data;
    }
    throw new Error(data.message);
  };

  const updateAdvance = async (id, updates) => {
    const { data } = await advanceAPI.update(id, updates);
    if (data.success) {
      setAdvanceRecords(prev => prev.map(a => (a._id === id || a.id === id) ? data.data : a));
      await Promise.all([fetchAdvances(), fetchNotifications(), fetchCentralRequests(), fetchPayroll(), fetchDashboardStats()]);
      return data;
    }
    throw new Error(data.message);
  };

  const setAdvanceApproval = async (id, approvalStatus) => {
    const { data } = await advanceAPI.setApproval(id, { approvalStatus });
    if (data.success) {
      setAdvanceRecords(prev => prev.map(a => (a._id === id || a.id === id) ? data.data : a));
      await Promise.all([fetchAdvances(), fetchNotifications(), fetchCentralRequests(), fetchDashboardStats()]);
      return data;
    }
    throw new Error(data.message);
  };

  const deleteAdvance = async (id) => {
    const { data } = await advanceAPI.delete(id);
    if (data.success) { setAdvanceRecords(prev => prev.filter(a => a._id !== id && a.id !== id)); return data.data; }
    throw new Error(data.message);
  };

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const addTask = async (task) => {
    const { data } = await taskAPI.create(task);
    if (data.success) { setTasks(prev => [data.data, ...prev]); return data.data; }
    throw new Error(data.message);
  };

  const updateTask = async (id, updates) => {
    const { data } = await taskAPI.update(id, updates);
    if (data.success) { setTasks(prev => prev.map(t => t._id === id ? data.data : t)); return data.data; }
    throw new Error(data.message);
  };

  const deleteTask = async (id) => {
    const { data } = await taskAPI.delete(id);
    if (data.success) { setTasks(prev => prev.filter(t => t._id !== id)); return data.data; }
    throw new Error(data.message);
  };

  // ── Payroll ────────────────────────────────────────────────────────────────
  const generatePayroll = async (dataArr) => {
    const payload = Array.isArray(dataArr) ? dataArr : [dataArr];
    const { data } = await payrollAPI.generate(payload);
    if (data.success) {
      await fetchPayroll();
      return data;
    }
    throw new Error(data.message);
  };

  const approvePayroll = async (id) => {
    const { data } = await payrollAPI.approve(id);
    if (data.success) {
      setPayrollData(prev => prev.map(p => (p._id === id || p.id === id) ? data.data : p));
      return data.data;
    }
    throw new Error(data.message);
  };

  const markPayrollPaid = async (id) => {
    const { data } = await payrollAPI.markPaid(id);
    if (data.success) {
      setPayrollData(prev => prev.map(payroll => payroll._id === id ? data.data : payroll));
      await fetchOvertime();
      return data.data;
    }
    throw new Error(data.message);
  };

  // ── Performance ────────────────────────────────────────────────────────────
  const savePerformanceReview = async (review) => {
    const { data } = await performanceAPI.create(review);
    if (data.success) {
      setPerformanceReviews(prev => [data.data, ...prev]);
      return data.data;
    }
    throw new Error(data.message);
  };

  // ── Notifications ──────────────────────────────────────────────────────────
  const markNotifRead = async (id) => {
    try {
      const { data } = await notificationAPI.markRead(id);
      if (!data.success) throw new Error(data.message || 'Unable to mark this notification as read.');
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to mark this notification as read.');
      return false;
    }
    setNotifications(prev => prev.map(n => (n._id === id || n.id === id) ? { ...n, isRead: true, read: true } : n));
    return true;
  };

  const markAllNotifsRead = async () => {
    try {
      const { data } = await notificationAPI.markAllRead();
      if (!data.success) throw new Error(data.message || 'Unable to mark notifications as read.');
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to mark notifications as read.');
      return false;
    }
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true, read: true })));
    return true;
  };

  const deleteNotif = async (id) => {
    try {
      const { data } = await notificationAPI.delete(id);
      if (!data.success) throw new Error(data.message || 'Unable to delete this notification.');
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to delete this notification.');
      return false;
    }
    setNotifications(prev => prev.filter(n => n._id !== id && n.id !== id));
    return true;
  };

  const submitCentralRequest = async (request) => {
    const { data } = await requestAPI.submit(request);
    if (!data.success) throw new Error(data.message || 'Request submission failed.');
    setCentralRequests(previous => [data.data, ...previous.filter(item => item._id !== data.data._id)]);
    return data.data;
  };

  const reviewCentralRequest = async (id, decision) => {
    const { data } = await requestAPI.review(id, decision);
    if (!data.success) throw new Error(data.message || 'Request review failed.');
    setCentralRequests(previous => previous.map(item => item._id === id ? data.data : item));
    await Promise.all([fetchNotifications(), fetchLeave(), fetchOvertime(), fetchAdvances()]);
    return data.data;
  };

  // Preserve legacy employee assignments while preferring the managed catalog.
  const catalogPairs = new Set(designationRecords.map(item => `${item.name.toLocaleLowerCase()}\u0000${item.department.toLocaleLowerCase()}`));
  const legacyDesignations = new Map();
  employees.forEach(employee => {
    const name = String(employee.designation || '').trim();
    const department = String(employee.department || '').trim();
    if (!name) return;
    const key = `${name.toLocaleLowerCase()}\u0000${department.toLocaleLowerCase()}`;
    if (!catalogPairs.has(key) && !legacyDesignations.has(key)) {
      legacyDesignations.set(key, { name, department, status: 'legacy' });
    }
  });
  const designations = [...designationRecords, ...legacyDesignations.values()];

  const value = {
    sidebarCollapsed, toggleSidebar, setSidebarCollapsed,
    mobileSidebarOpen, setMobileSidebarOpen,
    currency,
    employees, employeesLoading, employeesError, fetchEmployees,
    addEmployee, updateEmployee, deleteEmployee, setEmployeeStatus,
    getEmployeeDrafts, getEmployeeDraft, saveEmployeeDraft, deleteEmployeeDraft,
    departments,  addDepartment,  updateDepartment,  deleteDepartment,  fetchDepartments,
    designations, designationRecords, fetchDesignations,
    attendanceData, markAttendance, selfMarkAttendance, doCheckIn, doCheckOut,
    leaveRequests,  addLeaveRequest, updateLeaveStatus, cancelLeave,
    leaveBalances,  setLeaveBalances, fetchLeaveBalances,
    tasks,          addTask, updateTask, deleteTask, fetchTasks,
    payrollData,    generatePayroll, approvePayroll, markPayrollPaid,
    performanceReviews, setPerformanceReviews, savePerformanceReview,
    notifications, markNotifRead, markAllNotifsRead, deleteNotif,
    centralRequests, fetchCentralRequests, submitCentralRequest, reviewCentralRequest,
    dashboardStats, fetchDashboardStats,
    holidays,        addHoliday,  updateHoliday,  deleteHoliday,  fetchHolidays,
    overtimeEntries, addOvertime, updateOvertime, settleOvertime, setOvertimeApproval, deleteOvertime, fetchOvertime,
    advanceRecords,  addAdvance,  updateAdvance,  setAdvanceApproval, deleteAdvance,  fetchAdvances,
    // Refresh helpers
    fetchAttendance, fetchLeave,
    fetchPayroll, fetchPerformance, fetchNotifications,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
