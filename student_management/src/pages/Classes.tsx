import { notify } from '../utils/notify';
import Modal from '../components/Modal';
import { currentAcademicYear } from '../utils/date';
import { useState, useEffect } from 'react';
import { BookOpen, Users, Clock, DollarSign, Filter, Plus, X, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../utils/api';

const Classes = () => {
  const [classes, setClasses] = useState([]);
  const [groupedFilteredClasses, setGroupedFilteredClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter state
  const [gradeFilter, setGradeFilter] = useState('All');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedClassGroup, setSelectedClassGroup] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [enrolledStudentsGroups, setEnrolledStudentsGroups] = useState([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [newClass, setNewClass] = useState({ academicYear: currentAcademicYear(), id: '', name: '', grade: '6', teacher: '', tuition: 0, schedule: '' });
  const [saving, setSaving] = useState(false);

  const fetchClasses = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/api/classes');
      setClasses(response.data);
    } catch (err) {
      setError('Không thể tải danh sách lớp học từ Google Sheets.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  useEffect(() => {
    let filtered = classes;
    if (gradeFilter !== 'All') {
      filtered = filtered.filter(c => String(c.grade) === gradeFilter);
    }

    const groups = {};
    filtered.forEach(c => {
      let baseName = c.name;
      let khoa = 'Mặc định';
      const match = c.name.match(/(.*?)[-\s]*([Kk]\d+(?:\s*mới)?)$/);
      if (match) {
        baseName = match[1].trim();
        khoa = match[2].trim().toUpperCase();
      }
      if (!groups[baseName]) {
        groups[baseName] = {
           baseName,
           grade: c.grade,
           teacher: c.teacher,
           schedule: c.schedule,
           tuition: c.tuition,
           variants: []
        };
      }
      groups[baseName].variants.push({ ...c, khoa });
    });

    // Sort variants by Khoa inside each group, then sort groups by name
    const groupedArray = Object.values(groups).map(g => {
      g.variants.sort((a, b) => a.khoa.localeCompare(b.khoa));
      return g;
    }).sort((a, b) => a.baseName.localeCompare(b.baseName));

    setGroupedFilteredClasses(groupedArray);
    setCurrentPage(1); // Reset to page 1 on filter
  }, [gradeFilter, classes]);

  const handleAddClass = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await api.post('/api/classes', newClass);
      if (response.data.success) {
        setShowModal(false);
        setNewClass({ academicYear: currentAcademicYear(), id: '', name: '', grade: '6', teacher: '', tuition: 0, schedule: '' });
        fetchClasses();
      }
    } catch (err) {
      console.error(err);
      notify(err.response?.data?.error || 'Lỗi khi thêm lớp học!');
    } finally {
      setSaving(false);
    }
  };

  const fetchClassGroupDetails = async (group) => {
    setSelectedClassGroup(group);
    setActiveTab(0);
    setShowDetailModal(true);
    setLoadingDetails(true);
    try {
      const responses = await Promise.all(
        group.variants.map(v => api.get(`/api/attendance/class/${v.id}`))
      );
      setEnrolledStudentsGroups(responses.map(r => r.data));
    } catch (err) {
      console.error(err);
      notify('Không thể tải danh sách học sinh của lớp này.');
    } finally {
      setLoadingDetails(false);
    }
  };

  const uniqueGrades = ['All', ...new Set(classes.map(c => String(c.grade)).filter(g => g !== 'undefined' && g !== ''))].sort();

  // Pagination logic
  const totalPages = Math.ceil(groupedFilteredClasses.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedClasses = groupedFilteredClasses.slice(startIndex, startIndex + itemsPerPage);

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
      <div className="page-toolbar">
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <Filter size={18} color="var(--text-secondary)" />
          <select
            className="form-input"
            style={{ width: '150px', padding: '8px' }}
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
          >
            {uniqueGrades.map((g, i) => (
              <option key={i} value={g}>{g === 'All' ? 'Tất cả Khối' : `Khối ${g}`}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={18} /> Tạo Lớp Mới
        </button>
      </div>

      {error && (
        <div className="glass-panel" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'var(--accent-danger)', marginBottom: '24px' }}>
          <p role="alert" style={{ color: 'var(--accent-danger)' }}>{error}</p>
        </div>
      )}

      <div className="dashboard-grid">
        {loading ? (
          <div style={{ padding: '32px', color: 'var(--text-secondary)' }}>Đang tải danh sách lớp học...</div>
        ) : groupedFilteredClasses.length === 0 && !error ? (
          <div style={{ padding: '32px', color: 'var(--text-secondary)' }}>Chưa có lớp học nào phù hợp.</div>
        ) : (
          paginatedClasses.map((group, i) => (
            <div key={i} className="glass-panel stat-card class-card" style={{ gap: '16px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, right: 0, padding: '16px', opacity: 0.1 }}>
                <BookOpen size={64} />
              </div>

              <div style={{ zIndex: 1 }}>
                <div style={{ display: 'inline-block', padding: '4px 8px', background: 'rgba(59, 130, 246, 0.2)', color: 'var(--accent-primary)', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600, marginBottom: '8px' }}>
                  Khối {group.grade}
                </div>
                <h3 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>{group.baseName}</h3>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  {group.variants.map((v, idx) => (
                     <span key={idx} className="badge badge-success">{v.khoa}</span>
                  ))}
                </div>
              </div>

              <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                  <Users size={16} color="var(--text-secondary)"/> Giáo viên: {group.teacher || 'Chưa xếp'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                  <Clock size={16} color="var(--text-secondary)"/> Lịch: {group.schedule || 'Chưa có lịch'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                  <DollarSign size={16} color="var(--text-secondary)"/> Học phí: {group.tuition ? `${new Intl.NumberFormat('vi-VN').format(group.tuition)}đ` : 'Chưa đặt'}
                </div>
              </div>

              <div style={{ zIndex: 1, marginTop: '8px' }}>
                <button className="btn btn-secondary" style={{ width: '100%', padding: '8px', fontSize: '0.85rem' }} onClick={() => fetchClassGroupDetails(group)}>Chi tiết & Danh sách HS</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination Controls */}
      {!loading && groupedFilteredClasses.length > 0 && (
        <div className="pagination">
          <div className="pagination-info" aria-live="polite">
            Hiển thị <strong style={{ color: 'var(--text-primary)' }}>{startIndex + 1}</strong> đến <strong style={{ color: 'var(--text-primary)' }}>{Math.min(startIndex + itemsPerPage, groupedFilteredClasses.length)}</strong> trong tổng số <strong style={{ color: 'var(--text-primary)' }}>{groupedFilteredClasses.length}</strong> lớp học
          </div>

          <div className="pagination-buttons">
            <button
              className="btn btn-secondary"
              aria-label="Trang trước" onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
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
              aria-label="Trang sau" onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages || totalPages === 0}
              style={{ padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Add Class Modal */}
      {showModal && (
        <Modal label="Tạo lớp học" onClose={() => !saving && setShowModal(false)}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Tạo Lớp Học Mới</h2>
              <button className="btn btn-secondary" style={{ padding: '8px', borderRadius: '50%' }} aria-label="Đóng cửa sổ" disabled={saving} onClick={() => setShowModal(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddClass}>
              <div className="form-group"><label className="form-label" htmlFor="class-year">Năm học *</label><input id="class-year" required pattern="[0-9]{4}-[0-9]{4}" className="form-input" value={newClass.academicYear} onChange={e => setNewClass({...newClass,academicYear:e.target.value})}/></div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="classes-field-1">Mã Lớp *</label>
                  <input id="classes-field-1" required type="text" className="form-input" placeholder="VD: 9T1" value={newClass.id} onChange={(e) => setNewClass({...newClass, id: e.target.value})} />
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label" htmlFor="classes-field-2">Tên Lớp (Mô tả) *</label>
                  <input id="classes-field-2" required type="text" className="form-input" placeholder="VD: Toán Cơ Bản Khối 9" value={newClass.name} onChange={(e) => setNewClass({...newClass, name: e.target.value})} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="classes-field-3">Khối</label>
                  <select id="classes-field-3" className="form-input" value={newClass.grade} onChange={(e) => setNewClass({...newClass, grade: e.target.value})}>
                    {[6,7,8,9,10,11,12].map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label" htmlFor="classes-field-4">Giáo viên phụ trách</label>
                  <input id="classes-field-4" type="text" className="form-input" value={newClass.teacher} onChange={(e) => setNewClass({...newClass, teacher: e.target.value})} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="classes-field-5">Lịch học</label>
                <input id="classes-field-5" type="text" className="form-input" placeholder="VD: T3, T5 18:00 - 19:30" value={newClass.schedule} onChange={(e) => setNewClass({...newClass, schedule: e.target.value})} />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="classes-field-6">Học phí mỗi tháng/khóa (VNĐ)</label>
                <input id="classes-field-6" type="number" className="form-input" value={newClass.tuition} onChange={(e) => setNewClass({...newClass, tuition: Number(e.target.value)})} />
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" aria-label="Đóng cửa sổ" disabled={saving} onClick={() => setShowModal(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Tạo Lớp'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedClassGroup && (
        <Modal label="Chi tiết lớp học" onClose={() => setShowDetailModal(false)}>
          <div className="modal-content" style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h2>Chi Tiết Nhóm Lớp: {selectedClassGroup.baseName}</h2>
              <button className="btn btn-secondary" style={{ padding: '8px', borderRadius: '50%' }} aria-label="Đóng cửa sổ" onClick={() => setShowDetailModal(false)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              {selectedClassGroup.variants.map((v, idx) => (
                <button
                  key={idx}
                  className={`btn ${activeTab === idx ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ borderRadius: '20px', padding: '6px 16px', fontSize: '0.9rem' }}
                  onClick={() => setActiveTab(idx)}
                >
                  Khóa {v.khoa}
                </button>
              ))}
            </div>

            <div className="dashboard-grid detail-stats" style={{ gap: '16px', gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="glass-panel stat-card">
                <div className="stat-label">Mã Lớp</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--accent-primary)' }}>{selectedClassGroup.variants[activeTab].id}</div>
              </div>
              <div className="glass-panel stat-card">
                <div className="stat-label">Khối</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{selectedClassGroup.grade}</div>
              </div>
              <div className="glass-panel stat-card">
                <div className="stat-label">Sĩ Số</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                  {enrolledStudentsGroups[activeTab] ? enrolledStudentsGroups[activeTab].length : 0} HS
                </div>
              </div>
            </div>

            <div style={{ marginTop: '24px', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
              <div className="table-scroll" role="region" aria-label="Danh sách học sinh của lớp" tabIndex={0}><table className="responsive-table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th style={{ backgroundColor: 'var(--bg-hover)', padding: '12px', borderBottom: '1px solid var(--border-color)' }}>STT</th>
                    <th style={{ backgroundColor: 'var(--bg-hover)', padding: '12px', borderBottom: '1px solid var(--border-color)' }}>Mã HS</th>
                    <th style={{ backgroundColor: 'var(--bg-hover)', padding: '12px', borderBottom: '1px solid var(--border-color)' }}>Họ và Tên</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingDetails ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>Đang tải danh sách...</td></tr>
                  ) : !enrolledStudentsGroups[activeTab] || enrolledStudentsGroups[activeTab].length === 0 ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>Lớp học này chưa có học sinh nào đăng ký.</td></tr>
                  ) : (
                    enrolledStudentsGroups[activeTab].map((hs, idx) => (
                      <tr key={idx}>
                        <td data-label="STT" style={{ padding: '12px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                        <td data-label="Mã HS" style={{ padding: '12px', borderBottom: '1px solid var(--border-color)', color: 'var(--accent-primary)', fontWeight: 500 }}>{hs.id}</td>
                        <td data-label="Họ và tên" style={{ padding: '12px', borderBottom: '1px solid var(--border-color)', fontWeight: 500 }}>{hs.name}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table></div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '32px' }}>
              <button type="button" className="btn btn-primary" aria-label="Đóng cửa sổ" onClick={() => setShowDetailModal(false)}>Đóng</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Classes;
