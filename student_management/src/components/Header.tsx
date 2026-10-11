import { useState, useRef, useEffect } from 'react';
import { Search, Menu, ArrowRight, ChevronRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { pageMeta } from '../utils/navigation';
export default function Header({ onMenu, menuOpen }: { onMenu: () => void; menuOpen: boolean }) {
  const { pathname } = useLocation(), navigate = useNavigate();
  const [query, setQuery] = useState(''), [searchOpen, setSearchOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => { if (e.key === '/' && !(e.target instanceof HTMLElement && (e.target.matches('input,textarea,select') || e.target.isContentEditable))) { e.preventDefault(); setSearchOpen(true); requestAnimationFrame(() => search.current?.focus()); } };
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, []);
  return <header className="header">
    <div className="header-start"><button className="icon-button menu-toggle" aria-label="Mở menu" aria-controls="app-navigation" aria-expanded={menuOpen} onClick={onMenu}><Menu size={22} /></button><div className="breadcrumb"><span>Không gian làm việc</span><ChevronRight size={14} /><strong>{pageMeta[pathname]?.title || 'LT1 Education'}</strong></div></div>
    <div className="header-end"><form className={`global-search ${searchOpen ? 'search-open' : ''}`} onSubmit={e => { e.preventDefault(); if (!query.trim()) return; navigate(`/students?q=${encodeURIComponent(query.trim())}`); setSearchOpen(false); search.current?.blur(); }}>
      <Search size={17} /><input ref={search} aria-label="Tìm học sinh theo tên, mã hoặc số điện thoại" placeholder="Tìm học sinh…" value={query} onChange={e => setQuery(e.target.value)} /><button type="submit" className="search-submit" aria-label="Tìm học sinh"><ArrowRight size={16} /></button><kbd>/</kbd>
    </form><button className="icon-button mobile-search-toggle" aria-label="Mở tìm kiếm học sinh" aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); requestAnimationFrame(() => search.current?.focus()); }}><Search size={20} /></button><span className="workspace-label">Nội bộ LT1</span></div>
  </header>;
}
