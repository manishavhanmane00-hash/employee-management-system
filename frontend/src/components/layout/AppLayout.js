import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import Sidebar from './Sidebar';
import Header from './Header';
import Chatbot from '../chat/Chatbot';

const AppLayout = () => {
  const { user } = useAuth();
  const { sidebarCollapsed } = useApp();

  if (!user) return <Navigate to="/login" replace />;

  // Employees must use the employee portal — redirect them
  if (user.role === 'Employee') return <Navigate to="/employee/dashboard" replace />;

  return (
    <div className="app-layout">
      <Sidebar />
      <div className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <Header />
        <main className="page-container">
          <Outlet />
        </main>
      </div>
      <Chatbot />
    </div>
  );
};

export default AppLayout;
