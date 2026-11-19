import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 1000));
    setLoading(false);
    setSent(true);
  };

  return (
    <div className="auth-page" style={{ justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <div className="auth-card" style={{ maxWidth: 420 }}>
        <div className="auth-brand" style={{ marginBottom: 32 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}><span style={{ color: 'var(--primary)' }}>EMS</span> Portal</div>
          </div>
        </div>

        {!sent ? (
          <>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Forgot password?</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 28 }}>
              Enter your email and we'll send you a reset link.
            </p>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Email address</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@acmecorp.com" required
                    className="form-control"
                    style={{ paddingLeft: 38 }}
                  />
                </div>
              </div>
              <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, background: 'var(--success-light)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <CheckCircle size={32} color="var(--success)" />
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Check your email</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              We sent a password reset link to <strong>{email}</strong>
            </p>
          </div>
        )}

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--primary)', fontSize: '0.875rem', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
