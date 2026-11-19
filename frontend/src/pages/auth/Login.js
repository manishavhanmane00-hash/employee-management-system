import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, AlertCircle, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { authAPI } from '../../services/api';
import toast from 'react-hot-toast';

const Login = () => {
  const [form, setForm]         = useState({ identifier: '', password: '', remember: false });
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [notice, setNotice] = useState('');
  const [setupAvailable, setSetupAvailable] = useState(false);

  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.state?.message) setNotice(location.state.message);
  }, [location.state]);

  useEffect(() => {
    authAPI.getInitialSetupStatus()
      .then(({ data }) => setSetupAvailable(data.available === true))
      .catch(() => setSetupAvailable(false));
  }, []);

  // ── Email/password form ────────────────────────────────────────────────────
  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
    if (error) setError('');
    if (notice) setNotice('');
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.identifier || !form.password) { setError('Please enter your Employee ID (or email) and password'); return; }
    setError('');
    setNotice('');
    const res = await login(form.identifier, form.password, form.remember);
    if (res.success) {
      toast.success('Welcome back!');
      if (res.mustChangePassword) {
        navigate(res.role === 'Employee' ? '/employee/settings' : '/settings');
      } else {
        const onboardingRequired = res.role === 'Employee'
          && (res.registrationStatus !== 'approved'
            || res.accountStatus !== 'active'
            || res.onboardingStatus !== 'completed'
            || res.personalInfoApprovalStatus !== 'approved'
            || res.documentVerificationStatus !== 'verified');
        navigate(res.role === 'Employee'
          ? (onboardingRequired ? '/employee/onboarding' : '/employee/dashboard')
          : '/dashboard');
      }
    } else {
      setError(res.error || 'Login failed. Please check your credentials.');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="auth-page">
      {/* ── Left panel ─────────────────────────────────────────────────── */}
      <div className="auth-left">
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: 12 }}>EMS Portal</h1>
          <p style={{ opacity: 0.85, lineHeight: 1.7, fontSize: '1rem' }}>
            Complete Employee Management System — manage your workforce with powerful tools for HR, payroll, attendance, and performance.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 32 }}>
            {['Employee Records', 'Salary Management (₹ INR)', 'Attendance Tracking', 'Performance Reviews'].map(f => (
              <div key={f} style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '12px 16px', fontSize: '0.875rem', fontWeight: 500 }}>
                ✓ {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right form ─────────────────────────────────────────────────── */}
      <div className="auth-right">
        <div className="auth-card">

          {/* Logo */}
          <div className="auth-brand" style={{ marginBottom: 32 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                <span style={{ color: 'var(--primary)' }}>EMS</span> Portal
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Employee Management System</div>
            </div>
          </div>

          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Sign in</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 28 }}>
            Enter your credentials to access the system
          </p>

          {setupAvailable && (
            <div style={{ background: 'var(--primary-light)', border: '1px solid var(--primary-mid)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: '0.875rem', color: 'var(--primary-deeper)' }}>
              <strong>Initial installation required.</strong> Set up the first Admin using the server-provided setup key.{' '}
              <Link to="/setup" style={{ fontWeight: 600, color: 'var(--primary)', textDecoration: 'underline' }}>
                Secure Admin setup →
              </Link>
            </div>
          )}

          {/* ── Alert banner — two variants ───────────────────────────── */}
          {error && (
            <div role="alert" style={{ background: 'var(--danger-light)', border: '1px solid var(--danger-mid)', borderRadius: 10, padding: '12px 14px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--danger)', fontSize: '0.875rem' }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div role="status" style={{ background: 'var(--info-light)', border: '1px solid var(--info-mid)', borderRadius: 10, padding: '12px 14px', marginBottom: 20, color: '#1d4ed8', fontSize: '0.875rem' }}>
              {notice}
            </div>
          )}

          {/* ── Email / password form ─────────────────────────────────── */}
          <form onSubmit={handleSubmit} noValidate>
            {/* Employee ID or Email */}
            <div className="form-group">
              <label htmlFor="login-identifier" className="form-label">
                Employee ID or Email
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  id="login-identifier"
                  type="text" name="identifier" value={form.identifier}
                  onChange={handleChange}
                  placeholder="EMP-0001 or you@company.com"
                  required
                  autoComplete="username"
                  className="form-control"
                  style={{ paddingLeft: 38 }}
                />
              </div>
            </div>

            {/* Password */}
            <div className="form-group">
              <label htmlFor="login-password" className="form-label">
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'} name="password" value={form.password}
                  onChange={handleChange}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className="form-control"
                  style={{ paddingRight: 40, paddingLeft: 38 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Remember + forgot */}
            <div className="flex-between" style={{ marginBottom: 24 }}>
              <label className="form-check" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox" name="remember" checked={form.remember}
                  onChange={handleChange}
                />
                Remember me
              </label>
              <Link to="/forgot-password" style={{ fontSize: '0.875rem', color: 'var(--primary)', fontWeight: 500 }}>
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary btn-lg w-full"
            >
              {loading
                ? <><div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> Signing in…</>
                : 'Sign In'}
            </button>
          </form>

          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Don't have an account?{' '}
              <Link to="/register" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                <UserPlus size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Create account
              </Link>
            </p>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Login;
