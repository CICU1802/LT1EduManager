import { notify } from '../utils/notify';
import Modal from '../components/Modal';
import { vietnamDate } from '../utils/date';
import { useState, useEffect } from 'react';
import { QrCode, RefreshCw, Plus, X, Search as SearchIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../utils/api';

const Tuition = () => {
  const [tuitions, setTuitions] = useState([]);
  const [filteredTuitions, setFilteredTuitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [balances, setBalances] = useState([]);
  const [balanceSearch, setBalanceSearch] = useState('');

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
      const [tuitionRes, studentsRes, classesRes, storageRes] = await Promise.all([
        api.get('/api/tuition'),
        api.get('/api/students'),
        api.get('/api/classes'),
        api.get('/api/data/status').catch(() => ({data:{active:false}}))
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
      if (storageRes.data.active) { const b = await api.get('/api/balances'); setBalances(b.data.filter(x => x.baseline_date).map(x => ({...x, name:studentsRes.data.find(s => s.id === x.student_id)?.name || x.student_id}))); }

      const cList = classesRes.data.filter(c => c.kind !== 'attendance');
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
        if (response.data.tuition.syncStatus !== 'Lỗi đồng bộ') notify('Đã lưu hóa đơn thành công.', 'success');
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
      <div className="page-toolbar">
        <div className="toolbar-filters">
          <button className="btn btn-secondary" onClick={fetchTuitionsAndClasses} disabled={loading}>
            <RefreshCw size={18} className={loading ? 'spin' : ''} /> Làm mới
          </button>

          <div className="search-field">
            <SearchIcon size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Tìm theo Mã hoặc Tên HS..." aria-label="Tìm theo Mã hoặc Tên HS..."
              style={{ width: '220px', paddingLeft: '40px' }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="field-pair">
            <input
              type="text"
              list="tuition-base-classes"
              className="form-input"
              style={{ flex: '2' }}
              value={selectedBaseClass}
              onChange={handleBaseClassChange}
              placeholder="Gõ để tìm lớp..." aria-label="Gõ để tìm lớp..."
            />
            <datalist id="tuition-base-classes">
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
        <button className="btn btn-primary" onClick={() => { setError(''); setShowModal(true); }}>
          <Plus size={18} /> Lập Hóa Đơn Mới
        </button>
      </div>

      <div className="dashboard-grid tuition-stats" style={{ marginBottom: '24px' }}>
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
          <p role="alert" style={{ color: 'var(--accent-danger)' }}>{error}</p>
        </div>
      )}

      <div className="glass-panel">
        <h2 style={{ marginBottom: '24px' }}>Danh sách Hóa Đơn</h2>
        <div className="table-scroll" role="region" aria-label="Danh sách hóa đơn" tabIndex={0}><table className="responsive-table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
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
                  <td data-label="Mã hóa đơn" style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>{t.id}</td>
                  <td data-label="Học sinh" style={{ fontWeight: '500' }}>{t.studentName}</td>
                  <td data-label="Mã HS" style={{ color: 'var(--accent-primary)' }}>{t.studentId}</td>
                  <td data-label="Số tiền" style={{ color: 'var(--accent-warning)', fontWeight: '600' }}>{formatCurrency(t.amount)}</td>
                  <td data-label="Lớp / kỳ học">{t.classId || 'Chưa xác định'} / {t.period || 'Dữ liệu cũ'}</td>
                  <td data-label="Đồng bộ"><span title={t.syncError}>{t.syncStatus}</span>{['Lỗi đồng bộ', 'Chờ đồng bộ'].includes(t.syncStatus) && <button className="btn btn-secondary" disabled={saving} onClick={async () => { setSaving(true); try { const res = await api.post(`/api/tuition/${t.id}/retry`); setError(res.data.tuition.syncError || ''); await fetchTuitionsAndClasses(); } catch (err) { setError(err.response?.data?.error || 'Không thể thử lại.'); } finally { setSaving(false); } }}>Thử lại</button>}</td>
                  <td data-label="Ngày thu" style={{ color: 'var(--text-secondary)' }}>{t.date}</td>
                  <td data-label="Phương thức">{t.method}</td>
                  <td data-label="Trạng thái">
                    <span className={`badge ${t.status === 'Đã nộp' ? 'badge-success' : 'badge-danger'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td data-label="Thao tác">
                    <button className="btn btn-secondary" style={{ padding: '6px', borderRadius: '8px' }} title="Mã QR thanh toán đang được hoàn thiện" disabled aria-label="Mã QR thanh toán chưa khả dụng">
                      <QrCode size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table></div>
      </div>

      {/* Pagination Controls */}
      {!loading && filteredTuitions.length > 0 && (
        <div className="pagination">
          <div className="pagination-info" aria-live="polite">
            Hiển thị <strong style={{ color: 'var(--text-primary)' }}>{startIndex + 1}</strong> đến <strong style={{ color: 'var(--text-primary)' }}>{Math.min(startIndex + itemsPerPage, filteredTuitions.length)}</strong> trong tổng số <strong style={{ color: 'var(--text-primary)' }}>{filteredTuitions.length}</strong> hóa đơn
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

      {/* Add Tuition Modal */}
      {balances.length > 0 && <details className="glass-panel" style={{margin:'24px 0'}}><summary style={{cursor:'pointer',fontWeight:650}}>Số dư học phí theo lớp / khóa từ Excel ({balances.length} hồ sơ)</summary><p className="section-caption">Số dư đã bao gồm hóa đơn thu mới của cùng lớp. Số tiền nhập từ Excel không được cộng vào doanh thu tháng như một khoản thu mới.</p><input className="form-input" aria-label="Tìm số dư theo học sinh hoặc lớp" placeholder="Tìm học sinh, mã hoặc lớp…" value={balanceSearch} onChange={e=>setBalanceSearch(e.target.value)} style={{margin:'16px 0'}}/><div className="table-scroll"><table className="responsive-table"><thead><tr><th>Học sinh</th><th>Lớp</th><th>Mốc chốt</th><th>Thực đóng hiện tại</th></tr></thead><tbody>{balances.filter(b => `${b.name} ${b.student_id} ${b.class_id}`.toLowerCase().includes(balanceSearch.toLowerCase())).slice(0,50).map(b => <tr key={`${b.student_id}/${b.class_id}`}><td data-label="Học sinh">{b.name}<small className="cell-subtitle">{b.student_id}</small></td><td data-label="Lớp">{b.class_id}</td><td data-label="Mốc chốt">{String(b.baseline_date).slice(0,10)}</td><td data-label="Thực đóng">{formatCurrency(b.paid)}</td></tr>)}</tbody></table></div><p className="field-hint">Hiển thị tối đa 50 kết quả. Xuất Excel trong mục Nhập & xuất dữ liệu để đối chiếu toàn bộ file.</p></details>}
      {showModal && (
        <Modal label="Lập hóa đơn học phí" onClose={() => !saving && setShowModal(false)}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Lập Hóa Đơn Thu Phí</h2>
              <button className="btn btn-secondary" style={{ padding: '8px', borderRadius: '50%' }} aria-label="Đóng cửa sổ" disabled={saving} onClick={() => setShowModal(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddTuition}>
              <p>Mỗi hóa đơn ghi nhận tiền cho một lớp và một kỳ học.</p>
              <button type="button" className="btn btn-secondary" disabled={!newTuition.studentId||!newTuition.classId} onClick={async()=>{try{const r=await api.get('/api/tuition-quote',{params:{studentId:newTuition.studentId,classId:newTuition.classId}});setNewTuition({...newTuition,amount:r.data.amount});notify(`Mức lớp ${r.data.base.toLocaleString('vi-VN')}đ · Giảm gia đình ${r.data.discountPercent}%`,'success');}catch(err){setError(err.response?.data?.error||'Tính học phí gia đình cần PostgreSQL và mức học phí lớp.');}}}>Áp dụng mức lớp và giảm gia đình</button>
              <div className="form-group">
                <label className="form-label" htmlFor="tuition-field-1">Lớp *</label>
                <select id="tuition-field-1" required className="form-input" value={newTuition.classId} onChange={e => setNewTuition({...newTuition, classId: e.target.value})}>
                  <option value="">Chọn lớp</option>
                  {classesList.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="tuition-field-2">Kỳ học phí (tháng) *</label>
                <input id="tuition-field-2" required type="month" className="form-input" value={newTuition.period} onChange={e => setNewTuition({...newTuition, period: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="tuition-field-3">Mã Học Sinh *</label>
                <input id="tuition-field-3" required type="text" className="form-input" placeholder="VD: HS2620001" value={newTuition.studentId} onChange={(e) => setNewTuition({...newTuition, studentId: e.target.value})} />
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="tuition-field-4">Số tiền thu (VNĐ) *</label>
                  <input id="tuition-field-4" required min="1" step="1" type="number" className="form-input" value={newTuition.amount} onChange={(e) => setNewTuition({...newTuition, amount: Number(e.target.value)})} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="tuition-field-5">Ngày thu</label>
                  <input id="tuition-field-5" required type="date" className="form-input" value={newTuition.date} onChange={(e) => setNewTuition({...newTuition, date: e.target.value})} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="tuition-field-6">Phương thức thanh toán</label>
                  <select id="tuition-field-6" className="form-input" value={newTuition.method} onChange={(e) => setNewTuition({...newTuition, method: e.target.value})}>
                    <option value="Tiền mặt">Tiền mặt</option>
                    <option value="Chuyển khoản">Chuyển khoản</option>
                    <option value="Khác">Khác</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" htmlFor="tuition-field-7">Trạng thái</label>
                  <select id="tuition-field-7" className="form-input" value={newTuition.status} onChange={(e) => setNewTuition({...newTuition, status: e.target.value})}>
                    <option value="Đã nộp">Đã nộp</option>
                    <option value="Nợ">Nợ</option>
                  </select>
                </div>
              </div>

              {error && <p className="login-error" role="alert">{error}</p>}
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" aria-label="Đóng cửa sổ" disabled={saving} onClick={() => setShowModal(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Lưu Hóa Đơn'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Tuition;
