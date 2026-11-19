import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, User, Mail, Lock, Hash, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import GoogleSignInButton from '../../components/auth/GoogleSignInButton';
import toast from 'react-hot-toast';

const Register = () => {
  const { register, loginWithGoogle, loading } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', employeeId: '', password: '', confirm: '' });
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState({});
  const [authError, setAuthError] = useState('');
  const [useEmailSignup, setUseEmailSignup] = useState(true);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: '' }));
    setAuthError('');
  };

  const validate = () => {
    const errs = {};
    if (!form.name.trim())       errs.name     = 'Full name is required';
    if (!form.email.trim())      errs.email    = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Invalid email address';
    if (!form.password)          errs.password = 'Password is required';
    else if (form.password.length < 8)         errs.password = 'Minimum 8 characters';
    if (!form.employeeId.trim()) errs.employeeId = 'Employee ID is required for identity verification';
    if (form.password !== form.confirm)        errs.confirm  = 'Passwords do not match';
    return errs;
  };

  const handleSubmit = async e => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    const res = await register({
      name:        form.name.trim(),
      email:       form.email.trim().toLowerCase(),
      employeeId:  form.employeeId.trim(),
      password:    form.password,
    });

    if (res.success) {
      toast.success(res.message || 'Registration submitted for Admin approval.');
      navigate('/login', { replace: true, state: { message: res.message || 'Registration submitted for Admin approval.' } });
    } else {
      setAuthError(res.error || 'Registration could not be submitted. Please try again.');
    }
  };

  const handleGoogleAuth = async code => {
    setAuthError('');
    const res = await loginWithGoogle(code);
    if (!res.success) {
      setAuthError(res.error || 'Google sign-up failed. Please try again.');
      return;
    }
    if (res.pendingApproval) {
      toast.success('Google identity verified. Registration is awaiting Admin approval.');
      navigate('/login', { replace: true, state: { message: res.message } });
      return;
    }
    toast.success('Welcome back!');
    const onboardingRequired = res.role === 'Employee'
      && (res.registrationStatus !== 'approved'
        || res.accountStatus !== 'active'
        || res.onboardingStatus !== 'completed'
        || res.personalInfoApprovalStatus !== 'approved'
        || res.documentVerificationStatus !== 'verified');
    navigate(res.role === 'Employee'
      ? (onboardingRequired ? '/employee/onboarding' : '/employee/dashboard')
      : '/dashboard', { replace: true });
  };

  const inputStyle = (err) => ({
    width: '100%', padding: '10px 14px 10px 38px', borderRadius: 10,
    border: `1.5px solid ${err ? 'var(--danger)' : 'var(--border)'}`,
    fontSize: '0.875rem', outline: 'none', background: 'var(--bg)', color: 'var(--text-primary)'
  });

  return (
    <div className="auth-page auth-register-page">
      <div className="auth-register-card">
        <div className="auth-brand" style={{ marginBottom: 28 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}><span style={{ color: 'var(--primary)' }}>EMS</span> Portal</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Employee Management System</div>
          </div>
        </div>

        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Employee Registration
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 24 }}>
          Submit your details for Admin verification. You can sign in after your registration is approved.
        </p>

        {authError && (
          <div role="alert" style={{ background: 'var(--danger-light)', border: '1px solid var(--danger-mid)', borderRadius: 10, padding: '12px 14px', marginBottom: 18, display: 'flex', gap: 10, alignItems: 'flex-start', color: '#b91c1c', fontSize: '0.875rem' }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{authError}</span>
          </div>
        )}

        {useEmailSignup ? (
          <>
            <form className="auth-register-form" onSubmit={handleSubmit}>
          {/* Full name */}
          <div className="register-field">
            <label className="form-label">Full Name <span className="required">*</span></label>
            <div style={{ position: 'relative' }}>
              <User size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Your full name" style={inputStyle(errors.name)} />
            </div>
            {errors.name && <div className="form-error">{errors.name}</div>}
          </div>

          {/* Email */}
          <div className="register-field">
            <label className="form-label">Email Address <span className="required">*</span></label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="you@company.com" autoComplete="email" style={inputStyle(errors.email)} />
            </div>
            {errors.email && <div className="form-error">{errors.email}</div>}
          </div>

          {/* Employee ID */}
          <div className="register-field">
            <label className="form-label">Employee ID <span className="required">*</span></label>
            <div style={{ position: 'relative' }}>
              <Hash size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="text" value={form.employeeId} onChange={e => set('employeeId', e.target.value)} placeholder="EMP-0001" style={inputStyle(errors.employeeId)} autoComplete="off" />
            </div>
            {errors.employeeId && <div className="form-error">{errors.employeeId}</div>}
          </div>

          {/* Password */}
          <div className="register-field">
            <label className="form-label">Password <span className="required">*</span></label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)} placeholder="Minimum 8 characters" style={inputStyle(errors.password)} />
              <button type="button" onClick={() => setShowPass(s => !s)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && <div className="form-error">{errors.password}</div>}
          </div>

          {/* Confirm password */}
          <div className="register-field">
            <label className="form-label">Confirm Password <span className="required">*</span></label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type={showPass ? 'text' : 'password'} value={form.confirm} onChange={e => set('confirm', e.target.value)} placeholder="Re-enter your password" style={inputStyle(errors.confirm)} />
            </div>
            {errors.confirm && <div className="form-error">{errors.confirm}</div>}
          </div>

          <button type="submit" disabled={loading} className="register-submit btn btn-primary btn-lg w-full" style={{ marginTop: 8 }}>
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
            </form>
            <div className="auth-divider register-auth-divider">
              <span>Register with Email and Employee ID</span>
            </div>
            <button type="button" className="register-option-button" onClick={() => setUseEmailSignup(false)}>
              Use Google signup instead
            </button>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 12 }}>
              Continue with your Google account to verify your email. No separate email or password is needed for Google signup.
            </p>
            <GoogleSignInButton
              disabled={loading}
              onAuthorizationCode={handleGoogleAuth}
              onError={message => setAuthError(message)}
            />
            <div className="auth-divider register-auth-divider">
              <span>Or register with email</span>
            </div>
            <button type="button" className="register-option-button" onClick={() => setUseEmailSignup(true)}>
              Register with Email and Employee ID instead
            </button>
          </>
        )}

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Already have an account?{' '}</span>
          <Link to="/login" style={{ color: 'var(--primary)', fontSize: '0.875rem', fontWeight: 600 }}>
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
