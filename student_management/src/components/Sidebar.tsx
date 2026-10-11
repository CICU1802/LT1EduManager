import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, BookOpen, CalendarCheck, CreditCard, GraduationCap, LogOut, X, ChevronRight } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
const links = [
  { path: '/dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { path: '/students', label: 'Học sinh', icon: Users },
  { path: '/classes', label: 'Lớp học & lịch', icon: BookOpen },
  { path: '/attendance', label: 'Điểm danh', icon: CalendarCheck },
  { path: '/tuition', label: 'Học phí', icon: CreditCard },
  { path: '/grades', label: 'Sổ điểm', icon: GraduationCap }
];
export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => { const media = window.matchMedia('(max-width: 1023px)'); const change = () => { setMobile(media.matches); if (!media.matches) onClose(); }; media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, [onClose]);
  const ref = useDialogFocus(mobile && open, onClose);
  const role = localStorage.getItem('edu_role'), user = localStorage.getItem('edu_user') || 'Nội bộ';
  const roleName = role === 'admin' ? 'Quản trị viên' : role === 'trogiang' ? 'Trợ giảng' : 'Văn phòng';
  return <>
    {mobile && open && <button className="sidebar-backdrop" aria-label="Đóng menu điều hướng" onClick={onClose} tabIndex={-1} />}
    <div ref={ref} id="app-navigation" className={`sidebar ${open ? 'is-open' : ''}`} role={mobile && open ? 'dialog' : undefined} aria-modal={mobile && open ? true : undefined} aria-label="Điều hướng chính" inert={mobile && !open} tabIndex={-1}>
      <NavLink className="sidebar-logo" to="/dashboard" onClick={onClose}><span className="brand-mark"><GraduationCap size={25} /></span><span>LT1 <strong>EDUCATION</strong><small>Quản lý trung tâm</small></span></NavLink>
      <button className="icon-button sidebar-close" aria-label="Đóng menu" onClick={onClose}><X size={20} /></button>
      <div className="nav-caption">KHÔNG GIAN LÀM VIỆC</div>
      <nav aria-label="Các chức năng">{links.filter(link => role !== 'trogiang' || link.path !== '/tuition').map(({path, label, icon: Icon}) => <NavLink key={path} to={path} onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={20} /><span>{label}</span><ChevronRight size={15} className="nav-arrow" /></NavLink>)}</nav>
      <div className="sidebar-note"><span className="eyebrow">LT1 EDUCATION</span><p>Mỗi học sinh.<br />Một hành trình tiến bộ.</p><span className="sidebar-note-line" /></div>
      <div className="sidebar-account"><div className="avatar">{user.slice(0, 1).toUpperCase()}</div><div><strong>{user}</strong><small>{roleName}</small></div><button className="icon-button" aria-label="Đăng xuất" title="Đăng xuất" onClick={() => { ['edu_user','edu_password','edu_role'].forEach(key => localStorage.removeItem(key)); window.location.href = '/'; }}><LogOut size={19} /></button></div>
    </div>
  </>;
}
