import { useCallback, useState, useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { pageMeta } from '../utils/navigation';
export default function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false), close = useCallback(() => setOpen(false), [setOpen]);
  const { pathname } = useLocation(), meta = pageMeta[pathname] || { title: 'LT1 Education', sub: 'Quản lý trung tâm' };
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [pathname]);
  const [today] = useState(() => new Date());
  const date = new Intl.DateTimeFormat('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'}).format(today);
  return <div className="app-container"><a className="skip-link" href="#main-content">Đến nội dung chính</a><Sidebar open={open} onClose={close} /><div className="main-content"><Header menuOpen={open} onMenu={() => setOpen(!open)} /><main id="main-content" className="page-content" tabIndex={-1}>
    <div className="page-heading"><div><span className="eyebrow">QUẢN LÝ TRUNG TÂM</span><h1>{meta.title}</h1><p>{meta.sub}</p></div><time className="page-date">{date}</time></div>{children}
  </main><footer className="app-footer"><span>LT1 EDUCATION</span><span>Đồng hành cùng sự tiến bộ.</span></footer></div></div>;
}
