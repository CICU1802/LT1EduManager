import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, BookOpen, CalendarCheck, CreditCard, GraduationCap, LogOut } from 'lucide-react';

const Sidebar = () => {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <GraduationCap size={32} strokeWidth={2.5} />
        LT1 EDUCATION
      </div>
      
      <nav>
        <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={20} />
          Tổng quan
        </NavLink>
        <NavLink to="/students" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Users size={20} />
          Học sinh
        </NavLink>
        <NavLink to="/classes" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <BookOpen size={20} />
          Lớp học & Lịch
        </NavLink>
        <NavLink to="/attendance" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <CalendarCheck size={20} />
          Điểm danh
        </NavLink>
        {localStorage.getItem('edu_role') !== 'trogiang' && (
          <NavLink to="/tuition" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <CreditCard size={20} />
            Học phí
          </NavLink>
        )}
        <NavLink to="/grades" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <GraduationCap size={20} />
          Sổ điểm
        </NavLink>
      </nav>
      
      <div style={{ padding: '24px', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 'auto' }}>
        <button 
          onClick={() => {
            localStorage.removeItem('edu_user');
            localStorage.removeItem('edu_password');
            localStorage.removeItem('edu_role');
            window.location.reload();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
            padding: '12px',
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: '12px',
            color: 'white',
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontWeight: 500
          }}
          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
        >
          <LogOut size={20} />
          Đăng xuất
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
