import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';

const ResetPassword = () => {
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async e => {
    e.preventDefault();
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return; }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setLoading(true);
    await new Promise(r => setTimeout(r, 1000));
    setLoading(false);
    toast.success('Password reset successfully!');
    navigate('/login');
  };

  return (
    <div className="auth-page" style={{ justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <div className="auth-card" style={{ maxWidth: 420 }}>
        <div className="auth-brand" style={{ marginBottom: 32 }}>
          <div><div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}><span style={{ color: 'var(--primary)' }}>EMS</span> Portal</div></div>
        </div>

        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Reset password</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 28 }}>Enter your new password below.</p>

        <form onSubmit={handleSubmit}>
          {[
            { label: 'New Password', name: 'password', placeholder: 'Minimum 6 characters' },
            { label: 'Confirm Password', name: 'confirm', placeholder: 'Re-enter your password' },
          ].map(field => (
            <div key={field.name} className="form-group">
              <label className="form-label">{field.label}</label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={form[field.name]}
                  onChange={e => setForm(f => ({ ...f, [field.name]: e.target.value }))}
                  placeholder={field.placeholder} required
                  className="form-control"
                  style={{ paddingRight: 40, paddingLeft: 38 }}
                />
                {field.name === 'password' && (
                  <button type="button" onClick={() => setShowPass(s => !s)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
              </div>
            </div>
          ))}

          <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--primary)', fontSize: '0.875rem', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
