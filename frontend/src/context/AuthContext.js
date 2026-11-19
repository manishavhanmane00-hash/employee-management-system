import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('ems-user') || sessionStorage.getItem('ems-user');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(false);

  const persistUser = (userInfo, token, remember = !sessionStorage.getItem('ems-token')) => {
    setUser(userInfo);
    const storage = remember ? localStorage : sessionStorage;
    const otherStorage = remember ? sessionStorage : localStorage;
    storage.setItem('ems-user', JSON.stringify(userInfo));
    if (token) storage.setItem('ems-token', token);
    otherStorage.removeItem('ems-user');
    otherStorage.removeItem('ems-token');
    // Mark that at least one account has been created — survives logout
    localStorage.setItem('ems-has-accounts', 'true');
  };

  // ── Login ──────────────────────────────────────────────────────────────────
  const login = async (identifier, password, remember = true) => {
    setLoading(true);
    try {
      // `identifier` may be an Employee ID (EMP-0001) or an email address.
      const { data } = await authAPI.login({ identifier, password });
      if (data.success) {
        persistUser(data.user, data.token, remember);
        setLoading(false);
        return {
          success: true,
          role: data.user.role,
          mustChangePassword: data.user.mustChangePassword === true,
          registrationStatus: data.user.registrationStatus,
          accountStatus: data.user.accountStatus,
          onboardingStatus: data.user.onboardingStatus,
          personalInfoApprovalStatus: data.user.personalInfoApprovalStatus,
          documentVerificationStatus: data.user.documentVerificationStatus,
        };
      }
      setLoading(false);
      return { success: false, error: data.message };
    } catch (err) {
      setLoading(false);
      return { success: false, error: err.response?.data?.message || 'Login failed' };
    }
  };

  // ── Register ───────────────────────────────────────────────────────────────
  const register = async (data) => {
    setLoading(true);
    try {
      const res = await authAPI.register(data);
      if (res.data.success) {
        setLoading(false);
        if (res.data.pendingApproval) {
          return { success: true, pendingApproval: true, message: res.data.message };
        }
        persistUser(res.data.user, res.data.token);
        return { success: true, role: res.data.user.role };
      }
      setLoading(false);
      return { success: false, error: res.data.message };
    } catch (err) {
      setLoading(false);
      return { success: false, error: err.response?.data?.message || 'Registration failed' };
    }
  };

  const setupInitialAdmin = async (data) => {
    setLoading(true);
    try {
      const { data: response } = await authAPI.setupInitialAdmin(data);
      if (response.success) {
        persistUser(response.user, response.token);
        setLoading(false);
        return { success: true, role: response.user.role };
      }
      setLoading(false);
      return { success: false, error: response.message };
    } catch (err) {
      setLoading(false);
      return { success: false, error: err.response?.data?.message || 'Initial Admin setup failed.' };
    }
  };

  // ── Google Sign-In ─────────────────────────────────────────────────────────
  // Google authorization codes are exchanged and verified by the backend.
  const loginWithGoogle = async (authorizationCode) => {
    setLoading(true);
    try {
      if (!authorizationCode || typeof authorizationCode !== 'string') {
        setLoading(false);
        return { success: false, error: 'Google did not return an authorization code. Please try again.' };
      }

      const res = await authAPI.googleLogin({ code: authorizationCode });

      if (res.data.success) {
        if (res.data.pendingApproval) {
          setLoading(false);
          return { success: true, pendingApproval: true, message: res.data.message };
        }
        persistUser(res.data.user, res.data.token);
        setLoading(false);
        return {
          success: true,
          role: res.data.user.role,
          isNew: res.data.isNew,
          registrationStatus: res.data.user.registrationStatus,
          accountStatus: res.data.user.accountStatus,
          onboardingStatus: res.data.user.onboardingStatus,
          personalInfoApprovalStatus: res.data.user.personalInfoApprovalStatus,
          documentVerificationStatus: res.data.user.documentVerificationStatus,
        };
      }
      setLoading(false);
      return { success: false, error: res.data.message };
    } catch (err) {
      setLoading(false);
      const msg = err.response?.data?.message;
      // 401 → invalid/expired token; 403 → deactivated/unverified; 409 → email conflict
      return { success: false, error: msg || 'Google sign-in failed. Please try again.' };
    }
  };

  // ── Logout ─────────────────────────────────────────────────────────────────
  const logout = () => {
    setUser(null);
    localStorage.removeItem('ems-user');
    localStorage.removeItem('ems-token');
    sessionStorage.removeItem('ems-user');
    sessionStorage.removeItem('ems-token');
    // Clear any cached role/session data
    sessionStorage.clear();
    // Note: 'ems-has-accounts' is intentionally kept so the login page
    // knows accounts exist and doesn't show the "No accounts yet" banner.
  };

  // ── Update profile (calls backend) ────────────────────────────────────────
  const updateProfile = async (data) => {
    try {
      const res = await authAPI.updateMe(data);
      if (res.data.success) {
        persistUser(res.data.user, res.data.token);
        return { success: true };
      }
      return { success: false, error: res.data.message };
    } catch (err) {
      return { success: false, error: err.response?.data?.message || 'Update failed' };
    }
  };

  // ── Change password ────────────────────────────────────────────────────────
  const changePassword = async (currentPassword, newPassword) => {
    try {
      const res = await authAPI.changePassword({ currentPassword, newPassword });
      return res.data.success ? { success: true } : { success: false, error: res.data.message };
    } catch (err) {
      return { success: false, error: err.response?.data?.message || 'Password change failed' };
    }
  };

  // ── Permissions ──────────────────────────────────────────────────────────
  // The backend returns `user.permissions` ({ moduleKey: boolean }) on login,
  // register, google-login and /me. Admin receives every key = true.
  //
  // `canAccess(moduleKey)` is the single gate used by routes, the sidebar, and
  // any component that wants to hide/show a module.
  const canAccess = (moduleKey) => {
    if (!user) return false;
    if (user.role === 'Admin') return true;
    if (user.role === 'Employee' && moduleKey === 'pf.records') return true;
    const perms = user.permissions || {};
    return perms[moduleKey] === true;
  };

  // Action-level check: can the current user perform `action`
  // (view/add/edit/delete/manage) on a top-level `moduleKey`?
  // Admin always true. moduleKey may be a submodule key (e.g. 'employees.list')
  // — the parent module's actions apply.
  const can = (moduleKey, action = 'view') => {
    if (!user) return false;
    if (user.role === 'Admin') return true;
    const parent = String(moduleKey || '').split('.')[0];
    const actions = user.actions || {};
    const moduleActions = actions[parent];
    return !!moduleActions && moduleActions[action] === true;
  };

  // Legacy helper kept for backward compatibility with older call sites.
  const hasPermission = (permission) => canAccess(permission);

  const isAdmin    = () => user?.role === 'Admin' || user?.role === 'HR' || user?.role === 'Manager';
  const isEmployee = () => user?.role === 'Employee';
  // Strictly the Admin role — used to gate permission management itself.
  const isSuperAdmin = () => user?.role === 'Admin';

  // ── Dynamic permission refresh (no re-login required) ──────────────────────
  // Re-fetch the current user (which includes live permissions) on an interval
  // and when the tab regains focus, so Admin permission changes take effect for
  // already-logged-in users within a short window.
  const refreshMe = async () => {
    try {
      const { data } = await authAPI.getMe();
      if (data?.success && data.user) {
        setUser(prev => {
          const next = data.user;
          // Only persist if something actually changed to avoid redundant writes.
          const changed = JSON.stringify(prev?.permissions) !== JSON.stringify(next.permissions)
            || JSON.stringify(prev?.actions) !== JSON.stringify(next.actions)
            || prev?.role !== next.role
            || prev?.registrationStatus !== next.registrationStatus
            || prev?.accountStatus !== next.accountStatus
            || prev?.onboardingStatus !== next.onboardingStatus
            || prev?.personalInfoApprovalStatus !== next.personalInfoApprovalStatus
            || prev?.documentVerificationStatus !== next.documentVerificationStatus;
          if (changed) {
            const storage = sessionStorage.getItem('ems-token') ? sessionStorage : localStorage;
            storage.setItem('ems-user', JSON.stringify(next));
          }
          return changed ? next : prev;
        });
      }
    } catch { /* ignore transient errors; interceptor handles 401 */ }
  };

  useEffect(() => {
    if (!user) return undefined;
    // Refresh shortly after mount, then poll every 30s, and on focus.
    refreshMe();
    const interval = setInterval(refreshMe, 30000);
    const onFocus = () => refreshMe();
    const onAuthRefresh = () => refreshMe();
    window.addEventListener('focus', onFocus);
    window.addEventListener('ems:auth-refresh', onAuthRefresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('ems:auth-refresh', onAuthRefresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Legacy compatibility: getRegistry returns empty array (no longer needed)
  const getRegistry   = () => [];
  // hasAnyAccount: true if someone is currently logged in OR if any account
  // was ever created in this browser (persisted flag survives logout).
  const hasAnyAccount = () => !!user || localStorage.getItem('ems-has-accounts') === 'true';

  return (
    <AuthContext.Provider value={{
      user, loading,
      login, loginWithGoogle, logout, register, setupInitialAdmin,
      hasPermission, canAccess, can, getRegistry, hasAnyAccount,
      updateProfile, changePassword,
      isAdmin, isEmployee, isSuperAdmin,
      refreshMe,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
