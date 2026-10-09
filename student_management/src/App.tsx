import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import Students from './pages/Students';
import Attendance from './pages/Attendance';
import Classes from './pages/Classes';
import Tuition from './pages/Tuition';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  
  useEffect(() => {
    const user = localStorage.getItem('edu_user');
    const pass = localStorage.getItem('edu_password');
    if (user && pass) {
      setIsAuthenticated(true);
      // Fetch role
      import('./utils/api').then(({ default: api }) => {
        api.get('/api/auth/me')
           .then(res => localStorage.setItem('edu_role', res.data.role))
           .catch(() => {
              localStorage.removeItem('edu_user');
              localStorage.removeItem('edu_password');
              setIsAuthenticated(false);
           });
      });
    } else if (pass) {
      // Legacy fallback
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (usernameInput.trim() !== '' && passwordInput.trim() !== '') {
      localStorage.setItem('edu_user', usernameInput.toLowerCase().trim());
      localStorage.setItem('edu_password', passwordInput);
      setIsAuthenticated(true);
      window.location.reload(); 
    }
  };

  if (!isAuthenticated) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-default)' }}>
        <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '32px' }}>
          <h2 style={{ textAlign: 'center', marginBottom: '24px', color: 'var(--text-primary)' }}>Nội Bộ LT1 EDUCATION</h2>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label className="form-label">Tài khoản (Tên đăng nhập)</label>
              <input 
                type="text" 
                className="form-input" 
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="VD: admin, vanphong, trogiang..." 
                autoFocus
              />
            </div>
            <div>
              <label className="form-label">Mật khẩu</label>
              <input 
                type="password" 
                className="form-input" 
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Nhập mật khẩu..." 
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Đăng nhập</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <div className="app-container">
        <Sidebar />
        <main className="main-content">
          <Header />
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/students" element={<Students />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/classes" element={<Classes />} />
            <Route path="/tuition" element={<Tuition />} />
            <Route path="/grades" element={<div className="glass-panel" style={{height:'400px', display:'flex', alignItems:'center', justifyContent:'center'}}><h2>Kết quả học tập - Đang phát triển</h2></div>} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
