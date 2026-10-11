import { useSearchParams } from 'react-router-dom';
import { notify } from '../utils/notify';
import Modal from '../components/Modal';
import { vietnamDate } from '../utils/date';
import { useState, useEffect } from 'react';
import { Plus, Search as SearchIcon, Download, RefreshCw, X, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../utils/api';

const Students = () => {
  const [searchParams] = useSearchParams();
  const [students, setStudents] = useState([]);
  const [filteredStudents, setFilteredStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  useEffect(() => { setSearchQuery(searchParams.get('q') || ''); }, [searchParams]);
  const [sortOrder, setSortOrder] = useState('asc'); // asc or desc

  // Class selection state
  const [groupedClasses, setGroupedClasses] = useState({});
  const [selectedBaseClass, setSelectedBaseClass] = useState('');
  const [selectedClass, setSelectedClass] = useState('All');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [newStudent, setNewStudent] = useState({
    name: '', phone: '', parentName: '', parentPhone: '', dob: '', school: '', classes: '',
    address: '', dateJoined: vietnamDate(), status: 'Đang học', notes: ''
  });
  const [saving, setSaving] = useState(false);

  const fetchStudentsAndClasses = async () => {
    setLoading(true);
    setError('');
    try {
      const [studentsRes, classesRes] = await Promise.all([
        api.get('/api/students'),
        api.get('/api/classes')
      ]);
      setStudents(studentsRes.data);

      const cList = classesRes.data;

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
      setError('Lỗi tải dữ liệu: ' + (err.message || String(err)));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudentsAndClasses();
  }, []);

  // Search and Filter logic
  useEffect(() => {
    let result = students;

    // Class Filter
    if (selectedClass !== 'All') {
      result = result.filter(s => s.classes && s.classes.includes(selectedClass));
    }

    // Search Query Filter
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.id && s.id.toLowerCase().includes(q)) ||
        (s.phone && s.phone.includes(q))
      );
    }

    setFilteredStudents([...result].sort((a, b) => sortOrder === 'asc' ? (a.name || '').localeCompare(b.name || '', 'vi') : (b.name || '').localeCompare(a.name || '', 'vi')));
    setCurrentPage(1); // Reset page
  }, [searchQuery, selectedClass, students, sortOrder]);

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

  const toggleSort = () => {
    const newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    setSortOrder(newOrder);
    setCurrentPage(1); // Reset page on sort
  };

  const formatClassesList = (classesStr) => {
    if (!classesStr) return 'Chưa xếp lớp';
    const classArray = classesStr.split(',').map(c => c.trim());
    const baseClasses = classArray.map(c => {
      const match = c.match(/(.*?)[-\s]*([Kk]\d+(?:\s*mới)?)$/);
      return match ? match[1].trim() : c;
    });
    const uniqueBaseClasses = [...new Set(baseClasses)];
    return uniqueBaseClasses.join(', ');
  };

  const handleAddStudent = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await api.post('/api/students', newStudent);
      if (response.data.success) {
        setShowModal(false);
        setNewStudent({
          name: '', phone: '', parentName: '', parentPhone: '', dob: '', school: '', classes: '',
          address: '', dateJoined: vietnamDate(), status: 'Đang học', notes: ''
        });
        notify('Đã thêm học sinh thành công.', 'success');
        fetchStudentsAndClasses();
      }
    } catch (err) {
      console.error(err);
      notify('Lỗi khi thêm học sinh!');
    } finally {
      setSaving(false);
    }
  };

  // Pagination logic
  const totalPages = Math.ceil(filteredStudents.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedStudents = filteredStudents.slice(startIndex, startIndex + itemsPerPage);

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
        <div className="toolbar-filters">
          <button className="btn btn-secondary" onClick={fetchStudentsAndClasses} disabled={loading}>
            <RefreshCw size={18} className={loading ? 'spin' : ''} /> Làm mới
          </button>

          <div className="search-field">
            <SearchIcon size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Tìm tên, mã, SĐT..." aria-label="Tìm tên, mã, SĐT..."
              style={{ width: '250px', paddingLeft: '40px' }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="field-pair">
            <input
              type="text"
              list="students-base-classes"
              className="form-input"
              style={{ flex: '2' }}
              value={selectedBaseClass}
              onChange={handleBaseClassChange}
              placeholder="Gõ để tìm lớp..." aria-label="Gõ để tìm lớp..."
            />
            <datalist id="students-base-classes">
              {Object.keys(groupedClasses).map(baseName => (
                <option key={baseName} value={baseName} />
              ))}
            </datalist>

            <select aria-label="Khóa học"
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

          <button className="btn btn-secondary" onClick={() => {
            const csvContent = "data:text/csv;charset=utf-8,\uFEFF" +
              "Mã HS,Họ và Tên,Số Điện Thoại,Ngày Vào,Trạng Thái,Ghi Chú\n" +
              filteredStudents.map(s => `${s.id},${s.name},${s.phone},${s.dateJoined},${s.status},${s.notes || ''}`).join("\n");
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", "danh_sach_hoc_sinh.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}>
            <Download size={18} /> Xuất CSV
          </button>
        </div>
        {localStorage.getItem('edu_role') !== 'trogiang' && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={18} /> Thêm Học Sinh
          </button>
        )}
      </div>

      {error && (
        <div className="glass-panel" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'var(--accent-danger)', marginBottom: '24px' }}>
          <p role="alert" style={{ color: 'var(--accent-danger)' }}>{error}</p>
        </div>
      )}

      <div className="glass-panel">
        <div className="table-scroll" role="region" aria-label="Danh sách học sinh" tabIndex={0}><table className="responsive-table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>Mã HS</th>
              <th aria-sort={sortOrder === 'asc' ? 'ascending' : 'descending'}>
                <button className="table-sort" onClick={toggleSort}>Họ và Tên <ArrowUpDown size={14} /></button>
              </th>
              <th>Liên hệ</th>
              <th>Khối/Lớp</th>
              <th>Trạng thái & Cảnh báo</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
                  Đang tải dữ liệu...
                </td>
              </tr>
            ) : filteredStudents.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
                  Không tìm thấy học sinh nào.
                </td>
              </tr>
            ) : (
              paginatedStudents.map((hs, i) => (
                <tr key={i} style={{ transition: 'all 0.2s ease', borderBottom: '1px solid var(--border-color)' }}>
                  <td data-label="Mã HS" style={{ color: 'var(--accent-primary)', fontWeight: '600' }}>{hs.id}</td>
                  <td data-label="Họ và tên" style={{ fontWeight: '500' }}>
                    {hs.name}
                    {hs.dob && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>SN: {hs.dob}</div>}
                  </td>
                  <td data-label="Liên hệ" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {hs.phone && <div>HS: {hs.phone}</div>}
                    {hs.parentPhone && <div>PH: {hs.parentPhone} {hs.parentName && `(${hs.parentName})`}</div>}
                  </td>
                  <td data-label="Lớp học" style={{ color: 'var(--text-secondary)' }}>{formatClassesList(hs.classes)}</td>
                  <td data-label="Trạng thái">
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <span className={`badge ${hs.status === 'Đang học' ? 'badge-success' : 'badge-danger'}`} style={{ boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                        {hs.status}
                      </span>
                      {hs.debtStatus === 'Đang nợ' && (
                        <span className="badge badge-warning" style={{ boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>Nợ HP</span>
                      )}
                      {hs.absences > 0 && (
                        <span className="badge badge-danger" style={{ boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>Vắng: {hs.absences}</span>
                      )}
                    </div>
                  </td>
                  <td data-label="Thao tác">
                    <button className="btn btn-secondary" style={{ padding: '6px 16px', fontSize: '0.85rem', borderRadius: '20px' }} onClick={() => { setSelectedStudent(hs); setShowDetailModal(true); }}>Chi tiết</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table></div>
      </div>

      {/* Pagination Controls */}
      {!loading && filteredStudents.length > 0 && (
        <div className="pagination">
          <div className="pagination-info" aria-live="polite">
            Hiển thị <strong style={{ color: 'var(--text-primary)' }}>{startIndex + 1}</strong> đến <strong style={{ color: 'var(--text-primary)' }}>{Math.min(startIndex + itemsPerPage, filteredStudents.length)}</strong> trong tổng số <strong style={{ color: 'var(--text-primary)' }}>{filteredStudents.length}</strong> học sinh
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

      {/* Add Student Modal */}
      {showModal && (
        <Modal label="Thêm học sinh" onClose={() => !saving && setShowModal(false)}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Thêm Học Sinh Mới</h2>
              <button className="btn btn-secondary" style={{ padding: '8px', borderRadius: '50%' }} aria-label="Đóng cửa sổ" disabled={saving} onClick={() => setShowModal(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddStudent}>
              <div className="form-group">
                <label className="form-label" htmlFor="students-field-1">Họ và Tên *</label>
                <input id="students-field-1" required type="text" className="form-input" value={newStudent.name} onChange={(e) => setNewStudent({...newStudent, name: e.target.value})} />
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="students-field-2">Số Điện Thoại HS</label>
                  <input id="students-field-2" type="text" className="form-input" value={newStudent.phone} onChange={(e) => setNewStudent({...newStudent, phone: e.target.value})} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="students-field-3">Ngày sinh</label>
                  <input id="students-field-3" type="date" className="form-input" value={newStudent.dob} onChange={(e) => setNewStudent({...newStudent, dob: e.target.value})} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="students-field-4">Tên Phụ Huynh</label>
                  <input id="students-field-4" type="text" className="form-input" value={newStudent.parentName} onChange={(e) => setNewStudent({...newStudent, parentName: e.target.value})} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="students-field-5">SĐT Phụ Huynh</label>
                  <input id="students-field-5" type="text" className="form-input" value={newStudent.parentPhone} onChange={(e) => setNewStudent({...newStudent, parentPhone: e.target.value})} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="students-field-6">Trường học</label>
                  <input id="students-field-6" type="text" className="form-input" value={newStudent.school} onChange={(e) => setNewStudent({...newStudent, school: e.target.value})} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="students-field-7">Lớp/Khối (Dự kiến)</label>
                  <input id="students-field-7" type="text" className="form-input" value={newStudent.classes} onChange={(e) => setNewStudent({...newStudent, classes: e.target.value})} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="students-field-8">Ngày vào học</label>
                  <input id="students-field-8" type="date" className="form-input" value={newStudent.dateJoined} onChange={(e) => setNewStudent({...newStudent, dateJoined: e.target.value})} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="students-field-9">Trạng thái</label>
                  <select id="students-field-9" className="form-input" value={newStudent.status} onChange={(e) => setNewStudent({...newStudent, status: e.target.value})}>
                    <option value="Đang học">Đang học</option>
                    <option value="Đã nghỉ">Đã nghỉ</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="students-field-10">Ghi chú</label>
                <textarea id="students-field-10" className="form-input" style={{ minHeight: '80px', resize: 'vertical' }} value={newStudent.notes} onChange={(e) => setNewStudent({...newStudent, notes: e.target.value})}></textarea>
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" aria-label="Đóng cửa sổ" disabled={saving} onClick={() => setShowModal(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Thêm Học Sinh'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedStudent && (
        <Modal label="Hồ sơ học sinh" onClose={() => setShowDetailModal(false)}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Hồ Sơ Chi Tiết</h2>
              <button className="btn btn-secondary" style={{ padding: '8px', borderRadius: '50%' }} aria-label="Đóng cửa sổ" onClick={() => setShowDetailModal(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="dashboard-grid detail-stats" style={{ gap: '16px', gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="glass-panel stat-card">
                <div className="stat-label">Mã Học Sinh</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--accent-primary)' }}>{selectedStudent.id}</div>
              </div>
              <div className="glass-panel stat-card">
                <div className="stat-label">Trạng Thái Học</div>
                <div>
                  <span className={`badge ${selectedStudent.status === 'Đang học' ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '1rem', padding: '4px 12px' }}>
                    {selectedStudent.status}
                  </span>
                </div>
              </div>
              <div className="glass-panel stat-card">
                <div className="stat-label">Công Nợ</div>
                <div>
                  <span className={`badge ${selectedStudent.debtStatus === 'Hoàn tất' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '1rem', padding: '4px 12px' }}>
                    {selectedStudent.debtStatus || 'Hoàn tất'}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '24px' }}>
              <div className="detail-row" style={{ display: 'flex', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ width: '150px', color: 'var(--text-secondary)' }}>Họ và Tên</div>
                <div style={{ fontWeight: 500, flex: 1 }}>{selectedStudent.name}</div>
                <div style={{ width: '150px', color: 'var(--text-secondary)' }}>Ngày Sinh</div>
                <div style={{ fontWeight: 500, flex: 1 }}>{selectedStudent.dob || 'Chưa cập nhật'}</div>
              </div>
              <div className="detail-row" style={{ display: 'flex', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ width: '150px', color: 'var(--text-secondary)' }}>SĐT Học Sinh</div>
                <div style={{ fontWeight: 500, flex: 1 }}>{selectedStudent.phone || 'Chưa cập nhật'}</div>
                <div style={{ width: '150px', color: 'var(--text-secondary)' }}>Trường</div>
                <div style={{ fontWeight: 500, flex: 1 }}>{selectedStudent.school || 'Chưa cập nhật'}</div>
              </div>
              <div className="detail-row" style={{ display: 'flex', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ width: '150px', color: 'var(--text-secondary)' }}>Phụ Huynh</div>
                <div style={{ fontWeight: 500, flex: 1 }}>{selectedStudent.parentName || ''} {selectedStudent.parentPhone ? `- ${selectedStudent.parentPhone}` : '(Chưa có)'}</div>
                <div style={{ width: '150px', color: 'var(--text-secondary)' }}>Lớp/Khối</div>
                <div style={{ fontWeight: 500, flex: 1 }}>{selectedStudent.classes || 'Chưa cập nhật'}</div>
              </div>
              <div className="detail-row" style={{ display: 'flex', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ width: '150px', color: 'var(--text-secondary)' }}>Số buổi vắng</div>
                <div style={{ fontWeight: 500, flex: 1, color: selectedStudent.absences > 0 ? 'var(--accent-danger)' : 'inherit' }}>{selectedStudent.absences || 0} buổi</div>
                <div style={{ width: '150px', color: 'var(--text-secondary)' }}>Ngày vào học</div>
                <div style={{ fontWeight: 500, flex: 1 }}>{selectedStudent.dateJoined || 'Chưa cập nhật'}</div>
              </div>
              <div className="detail-row" style={{ display: 'flex', padding: '12px 0' }}>
                <div style={{ width: '150px', color: 'var(--text-secondary)' }}>Ghi chú</div>
                <div style={{ fontWeight: 500 }}>{selectedStudent.notes || 'Không có ghi chú'}</div>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-primary" aria-label="Đóng cửa sổ" onClick={() => setShowDetailModal(false)}>Đóng</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Students;
