import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { GraduationCap, Eye, EyeOff, ArrowRight, ShieldCheck, BookOpen, Users, CalendarCheck, LoaderCircle } from 'lucide-react';
import AppShell from './components/AppShell';
import Toast from './components/Toast';
import api from './utils/api';
const DataExchange = lazy(() => import('./pages/DataExchange'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Students = lazy(() => import('./pages/Students'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Classes = lazy(() => import('./pages/Classes'));
const Tuition = lazy(() => import('./pages/Tuition'));
function App() {
  const [authenticated, setAuthenticated] = useState(false), [initializing, setInitializing] = useState(() => !!localStorage.getItem('edu_password'));
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState(''), [loggingIn, setLoggingIn] = useState(false);
  useEffect(() => {
    const expired = () => { setAuthenticated(false); setLoginError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); };
    window.addEventListener('edu-session-expired', expired);
    if (localStorage.getItem('edu_password')) {
      api.get('/api/auth/me').then(res => { localStorage.setItem('edu_role',res.data.role); setAuthenticated(true); }).catch(() => { ['edu_user','edu_password','edu_role'].forEach(key => localStorage.removeItem(key)); }).finally(() => setInitializing(false));
    }
    return () => window.removeEventListener('edu-session-expired', expired);
  }, []);
  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setLoggingIn(true); setLoginError('');
    localStorage.setItem('edu_user', username.trim().toLowerCase()); localStorage.setItem('edu_password', password);
    try { const res = await api.get('/api/auth/me'); localStorage.setItem('edu_role', res.data.role); setAuthenticated(true); setPassword(''); }
    catch (err) { ['edu_user','edu_password','edu_role'].forEach(key => localStorage.removeItem(key)); setLoginError((err as {response?: {status: number}}).response?.status === 401 ? 'Tài khoản hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại.' : 'Chưa kết nối được máy chủ. Vui lòng thử lại.'); }
    finally { setLoggingIn(false); }
  };
  if (initializing) return <div className="app-loading" role="status"><span className="brand-mark"><GraduationCap size={28} /></span><LoaderCircle className="spin" size={22} /><p>Đang mở không gian làm việc…</p></div>;
  return <><Toast />{!authenticated ? <div className="login-page"><section className="login-brand"><a className="login-logo" href="/"><span className="brand-mark"><GraduationCap size={27} /></span><strong>LT1 EDUCATION</strong></a><div className="login-brand-content"><span className="eyebrow">KHÔNG GIAN QUẢN LÝ TRUNG TÂM</span><h1>Vận hành rõ ràng.<br /><span>Đồng hành tốt hơn.</span></h1><p>Kết nối thông tin học sinh, lớp học và chuyên cần để mỗi ngày làm việc hiệu quả hơn.</p><div className="login-features"><span><Users size={19} /> Hồ sơ học sinh</span><span><CalendarCheck size={19} /> Chuyên cần</span><span><BookOpen size={19} /> Lớp học</span></div></div><p className="login-brand-footer">Mỗi học sinh. Một hành trình tiến bộ.</p></section><section className="login-form-section"><div className="login-card"><span className="login-security"><ShieldCheck size={17} /> DÀNH CHO NHÂN SỰ LT1</span><h2>Chào mừng trở lại</h2><p className="login-subtitle">Đăng nhập để tiếp tục công việc của bạn.</p><form onSubmit={login}>
    <div className="form-group"><label className="form-label" htmlFor="login-username">Tài khoản</label><input id="login-username" required autoComplete="username" className="form-input" placeholder="Tên đăng nhập" value={username} onChange={e => setUsername(e.target.value)} autoFocus /></div>
    <div className="form-group"><label className="form-label" htmlFor="login-password">Mật khẩu</label><div className="password-field"><input id="login-password" required autoComplete="current-password" type={showPassword ? 'text' : 'password'} className="form-input" placeholder="Nhập mật khẩu" value={password} onChange={e => setPassword(e.target.value)} /><button type="button" className="icon-button" aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></div>
    {loginError && <p className="login-error" role="alert">{loginError}</p>}<button disabled={loggingIn} className="btn btn-primary login-submit">{loggingIn ? <LoaderCircle className="spin" size={18} /> : null}{loggingIn ? 'Đang đăng nhập…' : 'Đăng nhập'}{!loggingIn && <ArrowRight size={18} />}</button>
  </form><p className="login-help">Cần hỗ trợ tài khoản? Liên hệ quản trị viên trung tâm.</p></div><span className="login-bottom">LT1 EDUCATION · HỆ THỐNG NỘI BỘ</span></section></div> : <Router><AppShell><Suspense fallback={<div className="route-loading" role="status"><LoaderCircle className="spin" size={22} /><span>Đang tải nội dung…</span></div>}><Routes><Route path="/" element={<Navigate to="/dashboard" replace />} /><Route path="/dashboard" element={<Dashboard />} /><Route path="/students" element={<Students />} /><Route path="/attendance" element={<Attendance />} /><Route path="/classes" element={<Classes />} /><Route path="/tuition" element={<Tuition />} /><Route path="/data" element={<DataExchange />} /><Route path="/grades" element={<div className="glass-panel empty-state"><GraduationCap size={36} /><h2>Sổ điểm đang được hoàn thiện</h2><p>Bạn vẫn có thể quản lý học sinh, lớp học và chuyên cần ở các mục bên cạnh.</p></div>} /><Route path="*" element={<Navigate to="/dashboard" replace />} /></Routes></Suspense></AppShell></Router>}</>;
}
export default App;
