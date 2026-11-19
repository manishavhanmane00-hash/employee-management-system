import axios from 'axios';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Axios instance with base URL
const api = axios.create({ baseURL: BASE });
const PUBLIC_AUTH_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/google',
  '/auth/forgot-password',
  '/auth/setup/status',
  '/auth/setup/admin',
]);

// ── Request interceptor: attach JWT as Bearer token ───────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ems-token') || sessionStorage.getItem('ems-token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

// ── Response interceptor: handle 401 globally ─────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestPath = error.config?.url?.split('?')[0];
    // Keep public auth failures on their form so credentials/code errors are shown in place.
    if (error.response?.status === 401 && !PUBLIC_AUTH_PATHS.has(requestPath)) {
      localStorage.removeItem('ems-token');
      localStorage.removeItem('ems-user');
      sessionStorage.removeItem('ems-token');
      sessionStorage.removeItem('ems-user');
      // Only redirect if we're not already on the login page
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  getInitialSetupStatus: () => api.get('/auth/setup/status'),
  setupInitialAdmin: (data) => api.post('/auth/setup/admin', data),
  register:       (data) => api.post('/auth/register', data),
  login:          (data) => api.post('/auth/login', data),
  googleLogin:    (data) => api.post('/auth/google', data, { headers: { 'X-Requested-With': 'XmlHttpRequest' } }),
  forgotPassword: (data) => api.post('/auth/forgot-password', data),
  getMe:          ()     => api.get('/auth/me'),
  updateMe:       (data) => api.put('/auth/me', data),
  changePassword: (data) => api.put('/auth/change-password', data),
  getUsers:       ()     => api.get('/auth/users'),
  setUserStatus:  (id, data) => api.put(`/auth/users/${id}/status`, data),
  createUser:     (data) => api.post('/auth/users', data),
  resetUserPassword: (id, data) => api.put(`/auth/users/${id}/reset-password`, data),
  getRegistrationReviews: () => api.get('/auth/registrations'),
  reviewRegistration: (id, data) => api.patch(`/auth/registrations/${id}/review`, data),
  getOnboarding: () => api.get('/auth/onboarding'),
  markOnboardingWelcomeSeen: () => api.post('/auth/onboarding/welcome'),
  saveOnboarding: (data) => api.put('/auth/onboarding', data),
  submitOnboarding: () => api.post('/auth/onboarding/submit'),
  requestProfileCorrection: (data) => api.post('/auth/profile-correction', data),
  reviewOnboarding: (id, data) => api.patch(`/auth/onboarding/reviews/${id}`, data),
  downloadOnboardingDocument: (userId, documentId) => api.get(`/auth/onboarding/documents/${userId}/${documentId}`, { responseType: 'blob' }),
  getEmployeeOnboardingDocuments: (userId) => api.get(`/auth/onboarding/documents/${userId}`),
};

// ── Role Permissions (Admin only) ──────────────────────────────────────────────
export const permissionAPI = {
  getAll:  ()             => api.get('/permissions'),
  getRole: (role)         => api.get(`/permissions/${role}`),
  update:  (role, data)   => api.put(`/permissions/${role}`, data),
};

// ── Employees ─────────────────────────────────────────────────────────────────
export const employeeAPI = {
  getAll:       (params)   => api.get('/employees', { params }),
  getById:      (id)       => api.get(`/employees/${id}`),
  getMe:        ()         => api.get('/employees/me'),
  getOptions:   (params)   => api.get('/employees/options', { params }),
  getTeam:      (params)   => api.get('/employees/team', { params }),
  setManager:   (id, managerUserId) => api.patch(`/employees/${id}/manager`, { managerUserId }),
  getEmployeeAccounts: () => api.get('/employees/accounts'),
  linkAccount:  (id, data) => api.patch(`/employees/${id}/account`, data),
  create:       (data)     => api.post('/employees', data),
  update:       (id, data) => api.put(`/employees/${id}`, data),
  setStatus:    (id, data) => api.patch(`/employees/${id}/status`, data),
  delete:       (id)       => api.delete(`/employees/${id}`),
  // Drafts — partially-filled employee records that can be resumed later
  getDrafts:    ()         => api.get('/employees/drafts'),
  getDraft:     (id)       => api.get(`/employees/drafts/${id}`),
  createDraft:  (data)     => api.post('/employees/drafts', data),
  updateDraft:  (id, data) => api.put(`/employees/drafts/${id}`, data),
  deleteDraft:  (id)       => api.delete(`/employees/drafts/${id}`),
};

// ── Departments ───────────────────────────────────────────────────────────────
export const departmentAPI = {
  getAll:   ()           => api.get('/departments'),
  getById:  (id)         => api.get(`/departments/${id}`),
  create:   (data)       => api.post('/departments', data),
  update:   (id, data)   => api.put(`/departments/${id}`, data),
  delete:   (id)         => api.delete(`/departments/${id}`),
};

export const designationAPI = {
  getAll: (params) => api.get('/departments/roles', { params }),
  create: (data) => api.post('/departments/roles', data),
  update: (id, data) => api.put(`/departments/roles/${id}`, data),
  delete: (id) => api.delete(`/departments/roles/${id}`),
};

// ── Attendance ────────────────────────────────────────────────────────────────
export const attendanceAPI = {
  getAll:     (params) => api.get('/attendance', { params }),
  mark:       (data)   => api.post('/attendance', data),
  selfMark:   (data)   => api.post('/attendance/self', data),
  checkIn:    ()       => api.post('/attendance/check-in'),
  checkOut:   ()       => api.put('/attendance/check-out'),
  correct:    (id, data) => api.put(`/attendance/${id}/correct`, data),
  mySummary:  (month)  => api.get('/attendance/my-summary', { params: { month } }),
};

// ── Leave ─────────────────────────────────────────────────────────────────────
export const leaveAPI = {
  getAll:       (params)    => api.get('/leave', { params }),
  getBalance:   (params)    => api.get('/leave/balance', { params }),
  updateAllocations: (userId, data) => api.put(`/leave/balance/allocations/${encodeURIComponent(userId)}`, data),
  apply:        (data)      => api.post('/leave', data),
  updateStatus: (id, data)  => api.put(`/leave/${id}/status`, data),
  cancel:       (id)        => api.put(`/leave/${id}/cancel`),
  downloadDocument: (id)    => api.get(`/leave/${id}/document`, { responseType: 'blob' }),
};

// ── Holidays ──────────────────────────────────────────────────────────────────
export const holidayAPI = {
  getAll:   (params)   => api.get('/holidays', { params }),
  getById:  (id)       => api.get(`/holidays/${id}`),
  getEligibleEmployees: () => api.get('/holidays/eligible-employees'),
  create:   (data)     => api.post('/holidays', data),
  update:   (id, data) => api.put(`/holidays/${id}`, data),
  delete:   (id)       => api.delete(`/holidays/${id}`),
};

// ── Overtime ──────────────────────────────────────────────────────────────────
export const overtimeAPI = {
  getPolicies: () => api.get('/overtime/policies'),
  setPolicies: (data) => api.put('/overtime/policies', data),
  getAll:   (params)   => api.get('/overtime', { params }),
  create:   (data)     => api.post('/overtime', data),
  update:   (id, data) => api.put(`/overtime/${id}`, data),
  setApproval: (id, data) => api.put(`/overtime/${id}/approval`, data),
  settle:   (id, data) => api.put(`/overtime/${id}/settle`, data),
  delete:   (id)       => api.delete(`/overtime/${id}`),
};

// ── Advances ──────────────────────────────────────────────────────────────────
export const advanceAPI = {
  getAll:   (params)   => api.get('/advances', { params }),
  create:   (data)     => api.post('/advances', data),
  update:   (id, data) => api.put(`/advances/${id}`, data),
  setApproval: (id, data) => api.put(`/advances/${id}/approval`, data),
  downloadDocument: (id) => api.get(`/advances/${id}/document`, { responseType: 'blob' }),
  delete:   (id)       => api.delete(`/advances/${id}`),
};

// ── Resignation Letters ──────────────────────────────────────────────────────
export const resignationAPI = {
  getAll:        (params)   => api.get('/resignations', { params }),
  getStats:      (params)   => api.get('/resignations/stats', { params }),
  getById:       (id)       => api.get(`/resignations/${id}`),
  create:        (data)     => api.post('/resignations', data),
  update:        (id, data) => api.put(`/resignations/${id}`, data),
  submit:        (id)       => api.put(`/resignations/${id}/submit`),
  withdraw:      (id, data) => api.put(`/resignations/${id}/withdraw`, data),
  managerReview: (id, data) => api.put(`/resignations/${id}/manager-review`, data),
  hrReview:      (id, data) => api.put(`/resignations/${id}/hr-review`, data),
  finalize:      (id, data) => api.put(`/resignations/${id}/finalize`, data),
  complete:      (id, data) => api.put(`/resignations/${id}/complete`, data),
  delete:        (id)       => api.delete(`/resignations/${id}`),
  downloadAttachment: (id) => api.get(`/resignations/${id}/attachment`, { responseType: 'blob' }),
};

// ── Employee benefits ─────────────────────────────────────────────────────────
export const benefitsAPI = {
  getEligibleUsers: (module, action) => api.get('/benefits/eligible-users', { params: { module, action } }),
  getAllowanceTypes: () => api.get('/benefits/allowances/types'),
  createAllowanceType: (data) => api.post('/benefits/allowances/types', data),
  getAllowances: (params) => api.get('/benefits/allowances', { params }),
  createAllowance: (data) => api.post('/benefits/allowances', data),
  updateAllowance: (id, data) => api.put(`/benefits/allowances/${id}`, data),
  deactivateAllowance: (id) => api.delete(`/benefits/allowances/${id}`),
  getPFConfiguration: () => api.get('/benefits/pf/configuration'),
  createPFConfiguration: (data) => api.post('/benefits/pf/configuration', data),
  updatePFConfiguration: (id, data) => api.put(`/benefits/pf/configuration/${id}`, data),
  getPFRecords: (params) => api.get('/benefits/pf', { params }),
  savePFProfile: (data) => api.post('/benefits/pf/profiles', data),
  updatePFProfile: (employeeId, data) => api.put(`/benefits/pf/profiles/${encodeURIComponent(employeeId)}`, data),
  calculatePF: (data) => api.post('/benefits/pf/contributions/calculate', data),
  getInsurance: (params) => api.get('/benefits/insurance', { params }),
  createInsurance: (data) => api.post('/benefits/insurance', data),
  updateInsurance: (id, data) => api.put(`/benefits/insurance/${id}`, data),
  setInsuranceStatus: (id, data) => api.patch(`/benefits/insurance/${id}/status`, data),
  uploadInsuranceDocument: (id, data) => api.post(`/benefits/insurance/${id}/documents`, data),
  downloadInsuranceDocument: (id, filename) => api.get(`/benefits/insurance/${id}/documents/${encodeURIComponent(filename)}`, { responseType: 'blob' }),
  getActivityLogs: (params) => api.get('/benefits/activity-logs', { params }),
};

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const taskAPI = {
  getAll:   (params)   => api.get('/tasks', { params }),
  create:   (data)     => api.post('/tasks', data),
  update:   (id, data) => api.put(`/tasks/${id}`, data),
  delete:   (id)       => api.delete(`/tasks/${id}`),
};

// ── Payroll ───────────────────────────────────────────────────────────────────
export const payrollAPI = {
  getAll:   (params)   => api.get('/payroll', { params }),
  preview:  (data)     => api.post('/payroll/preview', data),
  generate: (data)     => api.post('/payroll', data),
  approve:  (id)       => api.put(`/payroll/${id}/approve`),
  markPaid: (id)       => api.put(`/payroll/${id}/pay`),
};

// ── Performance ───────────────────────────────────────────────────────────────
export const performanceAPI = {
  getAll:   (params)   => api.get('/performance', { params }),
  create:   (data)     => api.post('/performance', data),
  update:   (id, data) => api.put(`/performance/${id}`, data),
};

// ── Reports ───────────────────────────────────────────────────────────────────
export const reportAPI = {
  dashboard:   ()       => api.get('/reports/dashboard'),
  attendance:  (params) => api.get('/reports/attendance', { params }),
  leave:       (params) => api.get('/reports/leave', { params }),
  employees:   (params) => api.get('/reports/employees', { params }),
  departments: ()       => api.get('/reports/departments'),
};

// ── Notifications ─────────────────────────────────────────────────────────────
export const notificationAPI = {
  getAll:      ()    => api.get('/notifications'),
  markRead:    (id)  => api.put(`/notifications/${id}/read`),
  markAllRead: ()    => api.put('/notifications/read-all'),
  delete:      (id)  => api.delete(`/notifications/${id}`),
};

export const chatAPI = {
  suggestions: (module) => api.get('/chat/suggestions', { params: { module } }),
  answer: (data) => api.post('/chat/answer', data),
  feedback: (data) => api.post('/chat/feedback', data),
  feedbackAnalytics: () => api.get('/chat/feedback/analytics'),
  createTicket: (data) => api.post('/chat/tickets', data),
  listTickets: () => api.get('/chat/tickets'),
  updateTicket: (id, data) => api.patch(`/chat/tickets/${id}`, data),
  commentOnTicket: (id, message) => api.post(`/chat/tickets/${id}/comments`, { message }),
};

export const requestAPI = {
  getAll:   (params) => api.get('/requests', { params }),
  submit:   (data) => api.post('/requests', data),
  review:   (id, data) => api.put(`/requests/${id}/review`, data),
  streamUrl: `${BASE}/requests/stream`,
};

export default api;
