import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Lock, Mail, User } from 'lucide-react';
import { authAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

const InitialAdminSetup = () => {
  const { setupInitialAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [available, setAvailable] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', setupKey: '' });

  useEffect(() => {
    authAPI.getInitialSetupStatus()
      .then(({ data }) => setAvailable(data.available))
      .catch(requestError => {
        setAvailable(false);
        setError(requestError.response?.data?.message || 'Could not verify initial setup availability.');
      });
  }, []);

  const handleSubmit = async event => {
    event.preventDefault();
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    if (form.password !== form.confirm) return setError('Passwords do not match.');
    setError('');
    const result = await setupInitialAdmin({
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      password: form.password,
      setupKey: form.setupKey,
    });
    if (!result.success) return setError(result.error);
    toast.success('Initial Admin account created.');
    navigate('/dashboard', { replace: true });
  };

  const inputStyle = {
    width: '100%', padding: '10px 14px 10px 38px', borderRadius: 10,
    border: '1.5px solid var(--border)', fontSize: '0.875rem', outline: 'none',
    background: 'var(--bg)', color: 'var(--text-primary)',
  };

  return (
    <div className="auth-page" style={{ justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <div className="auth-card" style={{ maxWidth: 500 }}>
        <div className="auth-brand" style={{ marginBottom: 28 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}><span style={{ color: 'var(--primary)' }}>EMS</span> Portal</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Initial administrator installation</div>
          </div>
        </div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Create Initial Admin</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 20 }}>
          This one-time setup requires the server-only INITIAL_ADMIN_SETUP_KEY. It closes permanently after an Admin is created.
        </p>
        {available === false && (
          <div style={{ background: 'var(--warning-light)', border: '1px solid var(--warning-mid)', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: '0.875rem', color: '#92400e' }}>
            {error || 'Initial setup is unavailable because an Admin already exists or the server setup key is not configured.'}
          </div>
        )}
        {error && available !== false && <div style={{ background: 'var(--danger-light)', border: '1px solid var(--danger-mid)', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: '0.875rem', color: '#b91c1c' }}>{error}</div>}
        {available && (
          <form onSubmit={handleSubmit}>
            {[
              ['name', 'Full Name', User, 'Your name'],
              ['email', 'Email Address', Mail, 'admin@company.com'],
              ['setupKey', 'Initial Setup Key', KeyRound, 'Server setup key'],
              ['password', 'Password', Lock, 'Minimum 8 characters'],
              ['confirm', 'Confirm Password', Lock, 'Re-enter password'],
            ].map(([field, label, Icon, placeholder]) => (
              <div key={field} className="form-group">
                <label className="form-label">{label}</label>
                <div style={{ position: 'relative' }}>
                  <Icon size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    required
                    type={field === 'password' || field === 'confirm' || field === 'setupKey' ? 'password' : field === 'email' ? 'email' : 'text'}
                    autoComplete={field === 'password' ? 'new-password' : field === 'confirm' ? 'new-password' : 'off'}
                    value={form[field]}
                    onChange={event => setForm(current => ({ ...current, [field]: event.target.value }))}
                    placeholder={placeholder}
                    style={inputStyle}
                  />
                </div>
              </div>
            ))}
            <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
              {loading ? 'Creating Admin…' : 'Create Initial Admin'}
            </button>
          </form>
        )}
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--primary)', fontSize: '0.875rem', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default InitialAdminSetup;
