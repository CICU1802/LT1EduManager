import { Search as SearchIcon, Plus as PlusIcon, Bell } from 'lucide-react';
import { useLocation } from 'react-router-dom';

const Header = () => {
  const location = useLocation();
  
  const getTitle = () => {
    switch (location.pathname) {
      case '/dashboard': return { title: 'Chào buổi sáng, Quản trị viên!', sub: 'Hôm nay là một ngày tuyệt vời để quản lý trung tâm.' };
      case '/students': return { title: 'Quản lý Học sinh', sub: 'Tìm kiếm, thêm mới và quản lý hồ sơ học sinh.' };
      case '/attendance': return { title: 'Điểm danh & Học bù', sub: 'Ghi nhận chuyên cần và lịch học bù.' };
      case '/classes': return { title: 'Lớp học & Lịch học', sub: 'Quản lý danh sách lớp, sĩ số và lịch giảng dạy.' };
      case '/tuition': return { title: 'Học phí & Hóa đơn', sub: 'Quản lý thu học phí, combo giảm giá và công nợ.' };
      default: return { title: 'Hệ thống Quản lý', sub: 'Trung tâm dạy thêm' };
    }
  };
  
  const { title, sub } = getTitle();

  return (
    <header className="header">
      <div className="fade-in">
        <h1 style={{ color: 'var(--text-primary)', margin: 0 }}>{title}</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>{sub}</p>
      </div>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <SearchIcon size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input type="text" className="input-field" placeholder="Tìm kiếm nhanh..." style={{ width: '250px', paddingLeft: '40px' }} />
        </div>
        <button className="btn btn-secondary" style={{ padding: '12px', borderRadius: '50%' }}>
          <Bell size={20} />
        </button>
      </div>
    </header>
  );
};

export default Header;
