import React from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import EmployeeSidebar from './EmployeeSidebar';
import EmployeeHeader from './EmployeeHeader';
import Chatbot from '../chat/Chatbot';

const EmployeeLayout = () => {
  const { user, logout } = useAuth();
  const { sidebarCollapsed } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  if (!user) return <Navigate to="/login" replace />;

  // Admins/HR/Managers go back to admin dashboard if they land on employee routes
  if (user.role !== 'Employee') return <Navigate to="/dashboard" replace />;

  const onboardingComplete = user.registrationStatus === 'approved'
    && user.accountStatus === 'active'
    && user.onboardingStatus === 'completed'
    && user.personalInfoApprovalStatus === 'approved'
    && user.documentVerificationStatus === 'verified';
  if (!onboardingComplete && location.pathname !== '/employee/onboarding') {
    return <Navigate to="/employee/onboarding" replace />;
  }
  if (!onboardingComplete) {
    return (
      <div className="app-layout">
        <main className="page-container" data-page-path={location.pathname} style={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 0' }}>
            <button type="button" className="btn btn-outline" onClick={() => { logout(); navigate('/login'); }}>Sign Out</button>
          </div>
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <EmployeeSidebar />
      <div className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <EmployeeHeader />
        <main className="page-container" data-page-path={location.pathname}>
          <Outlet />
        </main>
      </div>
      <Chatbot />
    </div>
  );
};

export default EmployeeLayout;
