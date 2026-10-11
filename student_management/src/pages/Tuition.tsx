import { vietnamDate } from '../utils/date';
import { useState, useEffect } from 'react';
import { QrCode, RefreshCw, Plus, X, Search as SearchIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../utils/api';

const Tuition = () => {
  const [tuitions, setTuitions] = useState([]);
  const [filteredTuitions, setFilteredTuitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Class selection state
  const [classesList, setClassesList] = useState([]);
  const [groupedClasses, setGroupedClasses] = useState({});
  const [selectedBaseClass, setSelectedBaseClass] = useState('');
  const [selectedClass, setSelectedClass] = useState('All');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [newTuition, setNewTuition] = useState(() => {
    try { const saved = sessionStorage.getItem('tuition_draft'); if (saved) return JSON.parse(saved); } catch { /* Ignore invalid draft */ }
    return { requestId: crypto.randomUUID(), classId: '', period: vietnamDate().slice(0, 7), studentId: '', amount: 0, method: 'Tiền mặt', status: 'Đã nộp', date: vietnamDate() };
  });
  useEffect(() => { sessionStorage.setItem('tuition_draft', JSON.stringify(newTuition)); }, [newTuition]);
  const [saving, setSaving] = useState(false);

  const fetchTuitionsAndClasses = async () => {
    setLoading(true);
    try {
      const [tuitionRes, studentsRes, classesRes] = await Promise.all([
        api.get('/api/tuition'),
        api.get('/api/students'),
        api.get('/api/classes')
      ]);
      
      const studentClassMap = {};
      studentsRes.data.forEach(s => {
          studentClassMap[s.id] = s.classes || '';
      });
      
      const enrichedTuitions = tuitionRes.data.map(t => ({
          ...t,
          classes: t.classId || studentClassMap[t.studentId] || ''
      }));
      setTuitions(enrichedTuitions);
      
      const cList = classesRes.data;
      setClassesList(cList);
      
      const groups = {};
      cList.forEach(c => {
        let baseName = c.name;
        let khoa = 'Khóa Mặc định';
        const match = c.name.match(/(.*?)[-\s]*([Kk]\d+(?:\s*mới)?)$/);
        if (match) {
            baseName = match[1].trim();
            khoa = match[2].trim().toUpperCase();
        }
        if (!groups[baseName]) groups[baseName] = [];
        groups[baseName].push({ id: c.id, khoa: khoa });
      });
      setGroupedClasses(groups);
      
    } catch (err) {
      setError('Không thể tải dữ liệu từ máy chủ.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTuitionsAndClasses();
  }, []);

  useEffect(() => {
    let result = tuitions;
    
    // Class Filter
    if (selectedClass !== 'All') {
      result = result.filter(t => t.classId === selectedClass);
    }
    
    // Status Filter
    if (statusFilter !== 'All') {
      result = result.filter(t => t.status === statusFilter);
    }
    
    // Search Filter
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      result = result.filter(t => 
        (t.studentName && t.studentName.toLowerCase().includes(q)) || 
        (t.studentId && t.studentId.toLowerCase().includes(q))
      );
    }
    
    setFilteredTuitions(result);
    setCurrentPage(1); // Reset page
  }, [searchQuery, statusFilter, selectedClass, tuitions]);

  const handleBaseClassChange = (e) => {
    const val = e.target.value;
    setSelectedBaseClass(val);
    if (val === '' || val === 'All') {
      setSelectedClass('All');
    } else if (groupedClasses[val] && groupedClasses[val].length > 0) {
      setSelectedClass(groupedClasses[val][0].id);
    } else {
      setSelectedClass('All');
    }
  };

  const handleAddTuition = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await api.post('/api/tuition', newTuition);
      if (response.data.success) {
        sessionStorage.removeItem('tuition_draft');
        if (response.data.tuition.syncStatus === 'Lỗi đồng bộ') {
          setError('Hóa đơn đã lưu nhưng chưa đồng bộ: ' + response.data.tuition.syncError);
        }
        setShowModal(false);
        setNewTuition({ requestId: crypto.randomUUID(), classId: '', period: vietnamDate().slice(0, 7), studentId: '', amount: 0, method: 'Tiền mặt', status: 'Đã nộp', date: vietnamDate() });
        fetchTuitionsAndClasses();
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Chưa xác nhận được kết quả. Thử lại để tiếp tục cùng hóa đơn.');
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (amount) => {
    if (!amount) return '0 đ';
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
  };

  // Pagination logic
  const totalPages = Math.ceil(filteredTuitions.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedTuitions = filteredTuitions.slice(startIndex, startIndex + itemsPerPage);

  const renderPaginationButtons = () => {
    let pages = [];
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        pages = [1, 2, 3, 4, 5];
      } else if (currentPage >= totalPages - 2) {
        pages = [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
      } else {
        pages = [currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2];
      }
    }

    return pages.map(pageNum => (
      <button 
        key={pageNum}
        className={`btn ${currentPage === pageNum ? 'btn-primary' : 'btn-secondary'}`}
        style={{ 
          padding: '8px', 
          minWidth: '36px', 
          height: '36px',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          borderRadius: '8px',
          fontWeight: currentPage === pageNum ? 'bold' : 'normal'
        }}
        onClick={() => setCurrentPage(pageNum)}
      >
        {pageNum}
      </button>
    ));
  };

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', flex: '1' }}>
          <button className="btn btn-secondary" onClick={fetchTuitionsAndClasses} disabled={loading}>
            <RefreshCw size={18} className={loading ? 'spin' : ''} /> Làm mới
          </button>
          
          <div style={{ position: 'relative' }}>
            <SearchIcon size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input 
              type="text" 
              className="form-input" 
              placeholder="Tìm theo Mã hoặc Tên HS..." 
              style={{ width: '220px', paddingLeft: '40px' }} 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', minWidth: '250px' }}>
            <input 
              type="text"
              list="tuition-base-classes"
              className="form-input" 
              style={{ flex: '2' }} 
              value={selectedBaseClass} 
              onChange={handleBaseClassChange} 
              placeholder="Gõ để tìm lớp..."
            />
            <datalist id="tuition-base-classes">
              {Object.keys(groupedClasses).map(baseName => (
                <option key={baseName} value={baseName} />
              ))}
            </datalist>
            
            <select 
              className="form-input" 
              style={{ flex: '1' }} 
              value={selectedClass} 
              onChange={(e) => setSelectedClass(e.target.value)}
              disabled={!selectedBaseClass || !groupedClasses[selectedBaseClass]}
            >
              {!selectedBaseClass ? (
                <option value="All">Tất cả</option>
              ) : (
                (groupedClasses[selectedBaseClass] || []).map(k => (
                  <option key={k.id} value={k.id}>{k.khoa}</option>
                ))
              )}
            </select>
          </div>

          <select 
            className="form-input" 
            style={{ width: '150px' }} 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="All">Tất cả Trạng thái</option>
            <option value="Đã nộp">Đã nộp</option>
            <option value="Nợ">Nợ / Chưa nộp</option>
          </select>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={18} /> Lập Hóa Đơn Mới
        </button>
      </div>

      <div className="dashboard-grid" style={{ marginBottom: '24px' }}>
        <div className="glass-panel stat-card">
          <div className="stat-label">Tổng Đã Thu</div>
          <div className="stat-value">
            {formatCurrency(tuitions.filter(t => t.status === 'Đã nộp').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0))}
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-label">Công Nợ Tồn Đọng</div>
          <div className="stat-value" style={{ color: 'var(--accent-danger)' }}>
            {formatCurrency(tuitions.filter(t => t.status !== 'Đã nộp').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0))}
          </div>
        </div>
      </div>

      {error && (
        <div className="glass-panel" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'var(--accent-danger)', marginBottom: '24px' }}>
          <p style={{ color: 'var(--accent-danger)' }}>{error}</p>
        </div>
      )}

      <div className="glass-panel">
        <h2 style={{ marginBottom: '24px' }}>Danh sách Hóa Đơn</h2>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>Mã HĐ</th>
              <th>Học Sinh</th>
              <th>Mã HS</th>
              <th>Số Tiền</th>
              <th>Lớp / Kỳ học</th>
              <th>Đồng bộ</th>
              <th>Ngày Thu</th>
              <th>Phương Thức</th>
              <th>Trạng Thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
                  Đang tải dữ liệu học phí...
                </td>
              </tr>
            ) : filteredTuitions.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
                  Không tìm thấy hóa đơn nào phù hợp.
                </td>
              </tr>
            ) : (
              paginatedTuitions.map((t, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>{t.id}</td>
                  <td style={{ fontWeight: '500' }}>{t.studentName}</td>
                  <td style={{ color: 'var(--accent-primary)' }}>{t.studentId}</td>
                  <td style={{ color: 'var(--accent-warning)', fontWeight: '600' }}>{formatCurrency(t.amount)}</td>
                  <td>{t.classId || 'Chưa xác định'} / {t.period || 'Dữ liệu cũ'}</td>
                  <td><span title={t.syncError}>{t.syncStatus}</span>{['Lỗi đồng bộ', 'Chờ đồng bộ'].includes(t.syncStatus) && <button className="btn btn-secondary" disabled={saving} onClick={async () => { setSaving(true); try { const res = await api.post(`/api/tuition/${t.id}/retry`); setError(res.data.tuition.syncError || ''); await fetchTuitionsAndClasses(); } catch (err) { setError(err.response?.data?.error || 'Không thể thử lại.'); } finally { setSaving(false); } }}>Thử lại</button>}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{t.date}</td>
                  <td>{t.method}</td>
                  <td>
                    <span className={`badge ${t.status === 'Đã nộp' ? 'badge-success' : 'badge-danger'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-secondary" style={{ padding: '6px', borderRadius: '8px' }} title="Tạo mã QR" onClick={() => alert(`Tính năng tự động sinh mã QR thanh toán ngân hàng cho hóa đơn ${t.id} đang được phát triển!`)}>
                      <QrCode size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {!loading && filteredTuitions.length > 0 && (
        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', backgroundColor: 'var(--bg-panel)', padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--border-color)' }}>
            Hiển thị <strong style={{ color: 'var(--text-primary)' }}>{startIndex + 1}</strong> đến <strong style={{ color: 'var(--text-primary)' }}>{Math.min(startIndex + itemsPerPage, filteredTuitions.length)}</strong> trong tổng số <strong style={{ color: 'var(--text-primary)' }}>{filteredTuitions.length}</strong> hóa đơn
          </div>
          
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button 
              className="btn btn-secondary" 
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              style={{ padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronLeft size={18} />
            </button>
            
            <div style={{ display: 'flex', gap: '4px' }}>
              {renderPaginationButtons()}
            </div>
            
            <button 
              className="btn btn-secondary" 
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages || totalPages === 0}
              style={{ padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Add Tuition Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2>Lập Hóa Đơn Thu Phí</h2>
              <button className="btn btn-secondary" style={{ padding: '8px', borderRadius: '50%' }} onClick={() => setShowModal(false)}>
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleAddTuition}>
              <p>Mỗi hóa đơn ghi nhận tiền cho một lớp và một kỳ học.</p>
              <div className="form-group">
                <label className="form-label">Lớp *</label>
                <select required className="form-input" value={newTuition.classId} onChange={e => setNewTuition({...newTuition, classId: e.target.value})}>
                  <option value="">Chọn lớp</option>
                  {classesList.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Kỳ học phí (tháng) *</label>
                <input required type="month" className="form-input" value={newTuition.period} onChange={e => setNewTuition({...newTuition, period: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Mã Học Sinh *</label>
                <input required type="text" className="form-input" placeholder="VD: HS2620001" value={newTuition.studentId} onChange={(e) => setNewTuition({...newTuition, studentId: e.target.value})} />
              </div>
              
              <div style={{ display: 'flex', gap: '16px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Số tiền thu (VNĐ) *</label>
                  <input required min="1" step="1" type="number" className="form-input" value={newTuition.amount} onChange={(e) => setNewTuition({...newTuition, amount: Number(e.target.value)})} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Ngày thu</label>
                  <input required type="date" className="form-input" value={newTuition.date} onChange={(e) => setNewTuition({...newTuition, date: e.target.value})} />
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: '16px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Phương thức thanh toán</label>
                  <select className="form-input" value={newTuition.method} onChange={(e) => setNewTuition({...newTuition, method: e.target.value})}>
                    <option value="Tiền mặt">Tiền mặt</option>
                    <option value="Chuyển khoản">Chuyển khoản</option>
                    <option value="Khác">Khác</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Trạng thái</label>
                  <select className="form-input" value={newTuition.status} onChange={(e) => setNewTuition({...newTuition, status: e.target.value})}>
                    <option value="Đã nộp">Đã nộp</option>
                    <option value="Nợ">Nợ</option>
                  </select>
                </div>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '32px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Lưu Hóa Đơn'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tuition;
