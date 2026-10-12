import { notify } from '../utils/notify';
import { vietnamDate } from '../utils/date';
import { useState, useEffect } from 'react';
import { Check, X, Clock, AlertCircle, Save, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../utils/api';

const Attendance = () => {
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(vietnamDate());

  const [students, setStudents] = useState([]);
  const [loadedContext, setLoadedContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [studentSearch, setStudentSearch] = useState('');
  const [groupedClasses, setGroupedClasses] = useState({});
  const [selectedBaseClass, setSelectedBaseClass] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Pending student state
  const [pendingName, setPendingName] = useState('');
  const [pendingNote, setPendingNote] = useState('');
  const [submittingPending, setSubmittingPending] = useState(false);
  const [pendingSuccess, setPendingSuccess] = useState('');

  // Fetch list of classes on mount
  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const response = await api.get('/api/classes');
        const classList = response.data.filter(c => c.kind !== 'tuition');
        setClasses(classList);

        const groups = {};
        classList.forEach(c => {
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

        const baseKeys = Object.keys(groups);
        if (baseKeys.length > 0) {
          const firstBase = baseKeys[0];
          setSelectedBaseClass(firstBase);
          setSelectedClass(groups[firstBase][0].id);
        }
      } catch (err) {
        console.error('Error fetching classes:', err);
        setError('Không thể tải danh sách lớp học.');
      }
    };
    fetchClasses();
  }, []);

  // Fetch students when class or date changes
  const loadAttendance = async () => {
    if (!selectedClass) return;

    const classInfo = classes.find(c => c.id === selectedClass);
    if (classInfo && classInfo.schedule) {
       const dow = new Date(`${attendanceDate}T12:00:00Z`).getUTCDay(); // 0-6
       const map = {
          0: /(CN|Chủ nhật|Chu nhat)/i,
          1: /(T2|Thứ 2|Thu 2)/i,
          2: /(T3|Thứ 3|Thu 3)/i,
          3: /(T4|Thứ 4|Thu 4)/i,
          4: /(T5|Thứ 5|Thu 5)/i,
          5: /(T6|Thứ 6|Thu 6)/i,
          6: /(T7|Thứ 7|Thu 7)/i,
       };
       if (!map[dow].test(classInfo.schedule)) {
          setError(`Lớp không có ca học vào thời gian này (Lịch học: ${classInfo.schedule}).`);
          setStudents([]);
          return;
       }
    }

    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const response = await api.get(`/api/attendance/class/${selectedClass}?date=${attendanceDate}`);
      setStudentSearch('');
      setStudents(response.data.map(s => s.status === 'Khác' && /^Đi trễ(?:$|: )/.test(s.note || '') ? { ...s, status: 'Đi trễ', note: s.note.replace(/^Đi trễ(?:: )?/, '') } : s));
      setLoadedContext(`${selectedClass}|${attendanceDate}`);
      setCurrentPage(1); // Reset page on data load
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Lỗi tải danh sách điểm danh.');
    } finally {
      setLoading(false);
    }
  };

  const handleBaseClassChange = (e) => {
    const val = e.target.value;
    setSelectedBaseClass(val);
    if (groupedClasses[val] && groupedClasses[val].length > 0) {
      setSelectedClass(groupedClasses[val][0].id);
    } else {
      setSelectedClass('');
    }
  };

  const handleStatusChange = (studentId, newStatus) => {
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, status: newStatus } : s));
  };

  const handleNoteChange = (studentId, note) => {
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, note } : s));
  };

  const saveAttendance = async () => {
    setSaving(true);
    setError('');
    setSuccessMsg('');
    try {
      if (loadedContext !== `${selectedClass}|${attendanceDate}`) {
        setError('Lớp hoặc ngày đã đổi. Vui lòng tải lại danh sách trước khi lưu.');
        return;
      }
      // Filter out students who haven't been marked yet
      const recordsToSave = students.filter(s => !s.isTransferred && s.status !== null);
      if (recordsToSave.length === 0) {
        setError('Vui lòng điểm danh ít nhất 1 học sinh trước khi lưu.');
        setSaving(false);
        return;
      }

      const saved = await api.post('/api/attendance', {
        classId: selectedClass,
        date: attendanceDate,
        records: recordsToSave.map(({ id, status, note, version }) => ({ id, version, status: status === 'Đi trễ' ? 'Khác' : status, note: status === 'Đi trễ' ? `Đi trễ${note ? ': ' + note : ''}` : note }))
      });
      if (saved.data.versions) setStudents(prev => prev.map(s => saved.data.versions[s.id] ? {...s, version:saved.data.versions[s.id]} : s));
      setSuccessMsg('Đã lưu điểm danh thành công!');
      notify('Đã lưu điểm danh thành công.', 'success');
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Lỗi khi lưu điểm danh.');
    } finally {
      setSaving(false);
    }
  };

  const submitPendingStudent = async () => {
    if (!pendingName.trim()) {
      setError('Vui lòng nhập tên học sinh mới.');
      return;
    }

    setSubmittingPending(true);
    setPendingSuccess('');
    setError('');

    try {
      const classInfo = classes.find(c => c.id === selectedClass);
      const className = classInfo ? classInfo.name : selectedClass;

      await api.post('/api/pending-students', {
        date: attendanceDate,
        className: className,
        studentName: pendingName,
        note: pendingNote
      });

      setPendingSuccess('Đã báo cáo học sinh mới thành công! Văn phòng sẽ xử lý sớm.');
      setPendingName('');
      setPendingNote('');

      setTimeout(() => setPendingSuccess(''), 5000);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Lỗi khi báo cáo học sinh.');
    } finally {
      setSubmittingPending(false);
    }
  };

  const presentCount = students.filter(s => !s.isTransferred && s.status === 'Có mặt').length;
  const absentCount = students.filter(s => !s.isTransferred && s.status === 'Vắng').length;

  const filteredStudents = students.filter(s =>
    !studentSearch ||
    (s.name && s.name.toLowerCase().includes(studentSearch.toLowerCase())) ||
    (s.id && s.id.toLowerCase().includes(studentSearch.toLowerCase()))
  );


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
      <div className="glass-panel attendance-selector">
        <div style={{ flex: '1', minWidth: '200px' }}>
          <label className="form-label" htmlFor="attendance-class">Chọn lớp học (Gõ để tìm kiếm)</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              id="attendance-class"
              list="base-classes-list"
              className="form-input"
              style={{ flex: '2' }}
              value={selectedBaseClass}
              onChange={handleBaseClassChange}
              placeholder="Nhập tên lớp..."
            />
            <datalist id="base-classes-list">
              {Object.keys(groupedClasses).map(baseName => (
                <option key={baseName} value={baseName} />
              ))}
            </datalist>

            <select aria-label="Khóa học"
              className="form-input"
              style={{ flex: '1' }}
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              disabled={!groupedClasses[selectedBaseClass]}
            >
              {(groupedClasses[selectedBaseClass] || []).map(k => (
                <option key={k.id} value={k.id}>{k.khoa}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="form-label" htmlFor="attendance-field-1">Ngày điểm danh</label>
          <input id="attendance-field-1" type="date" className="form-input" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} />
        </div>
        <button className="btn btn-primary" style={{ marginTop: '24px' }} onClick={loadAttendance} disabled={loading}>
          {loading ? 'Đang tải...' : 'Tải danh sách'}
        </button>
      </div>

      {error && (
        <div className="glass-panel" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'var(--accent-danger)', marginBottom: '24px' }}>
          <p role="alert" style={{ color: 'var(--accent-danger)', display: 'flex', alignItems: 'center', gap: '8px' }}><AlertCircle size={18}/> {error}</p>
        </div>
      )}

      {successMsg && (
        <div className="glass-panel" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'var(--accent-success)', marginBottom: '24px' }}>
          <p style={{ color: 'var(--accent-success)', display: 'flex', alignItems: 'center', gap: '8px' }}><Check size={18}/> {successMsg}</p>
        </div>
      )}

      {students.length > 0 && (
        <div className="glass-panel fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <h2>Danh sách lớp</h2>

            <div className="attendance-summary">
              <input
                type="text"
                className="form-input"
                placeholder="Tìm tên hoặc mã HS..." aria-label="Tìm tên hoặc mã HS..."
                value={studentSearch}
                onChange={(e) => { setStudentSearch(e.target.value); setCurrentPage(1); }}
                style={{ width: '250px' }}
              />
              <span className="badge badge-success">Có mặt: {presentCount}</span>
              <span className="badge badge-danger">Vắng: {absentCount}</span>
            </div>
          </div>

          <div className="table-scroll" role="region" aria-label="Danh sách điểm danh" tabIndex={0}><table className="responsive-table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>STT</th>
                <th>Họ và Tên</th>
                <th>Mã HS</th>
                <th style={{ textAlign: 'center' }}>Điểm danh</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {paginatedStudents.map((hs, i) => (
                <tr key={`${hs.id}-${hs.rowIndex || i}`}>
                  <td data-label="STT" style={{ color: 'var(--text-secondary)', opacity: hs.isTransferred ? 0.5 : 1 }}>{startIndex + i + 1}</td>
                  <td data-label="Họ và tên" style={{ fontWeight: '500', opacity: hs.isTransferred ? 0.6 : 1 }}>
                    {hs.isTransferred ? <del>{hs.name}</del> : hs.name}
                    {hs.isTransferred && <span className="badge badge-secondary" style={{ marginLeft: '8px', fontSize: '0.75rem' }}>Đã chuyển</span>}
                  </td>
                  <td data-label="Mã HS" style={{ color: 'var(--text-secondary)', opacity: hs.isTransferred ? 0.5 : 1 }}>{hs.id}</td>
                  <td data-label="Điểm danh" style={{ opacity: hs.isTransferred ? 0.5 : 1 }}>
                    <div className="attendance-controls">
                      <button
                        onClick={() => handleStatusChange(hs.id, 'Có mặt')}
                        className={`btn ${hs.status === 'Có mặt' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '8px', borderRadius: '50%', background: hs.status === 'Có mặt' ? 'var(--accent-success)' : '' }}
                        aria-label={`Có mặt: ${hs.name}`} title="Có mặt"
                        disabled={hs.isTransferred}
                      >
                        <Check size={16} /><span>Có mặt</span>
                      </button>
                      <button
                        onClick={() => handleStatusChange(hs.id, 'Vắng')}
                        className={`btn ${hs.status === 'Vắng' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '8px', borderRadius: '50%', background: hs.status === 'Vắng' ? 'var(--accent-danger)' : '' }}
                        aria-label={`Vắng: ${hs.name}`} title="Vắng"
                        disabled={hs.isTransferred}
                      >
                        <X size={16} /><span>Vắng</span>
                      </button>
                      <button
                        onClick={() => handleStatusChange(hs.id, 'Đi trễ')}
                        className={`btn ${hs.status === 'Đi trễ' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '8px', borderRadius: '50%', background: hs.status === 'Đi trễ' ? 'var(--accent-warning)' : '' }}
                        aria-label={`Đi trễ: ${hs.name}`} title="Đi trễ"
                        disabled={hs.isTransferred}
                      >
                        <Clock size={16} /><span>Đi trễ</span>
                      </button>
                    </div>
                  </td>
                  <td data-label="Ghi chú" style={{ opacity: hs.isTransferred ? 0.5 : 1 }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ghi chú..." aria-label="Ghi chú..."
                      style={{ padding: '8px', fontSize: '0.85rem' }}
                      value={hs.note || ''}
                      onChange={(e) => handleNoteChange(hs.id, e.target.value)}
                      disabled={hs.isTransferred}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>

          {/* Pagination Controls */}
          {students.length > 0 && (
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

          <div className="attendance-save">
            <button className="btn btn-primary" onClick={saveAttendance} disabled={saving}>
              {saving ? <span className="spin"><RefreshCw size={18}/></span> : <Save size={18} />}
              <span style={{ marginLeft: '8px' }}>{saving ? 'Đang lưu...' : 'Lưu Điểm Danh'}</span>
            </button>
          </div>

          {/* Report New Student Form */}
          <div style={{ marginTop: '48px', paddingTop: '24px', borderTop: '1px solid var(--border-color)' }}>
            <h3 style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>Có học sinh mới phát sinh chưa có tên?</h3>
            {pendingSuccess && (
              <div style={{ padding: '12px', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-success)', borderRadius: '8px', marginBottom: '16px' }}>
                {pendingSuccess}
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '1', minWidth: '200px' }}>
                <label className="form-label" htmlFor="attendance-field-2">Tên học sinh mới</label>
                <input id="attendance-field-2" type="text" className="form-input" placeholder="Ví dụ: Nguyễn Văn A" value={pendingName} onChange={e => setPendingName(e.target.value)} />
              </div>
              <div style={{ flex: '1', minWidth: '200px' }}>
                <label className="form-label" htmlFor="attendance-field-3">SĐT / Ghi chú</label>
                <input id="attendance-field-3" type="text" className="form-input" placeholder="SĐT phụ huynh hoặc ghi chú thêm" value={pendingNote} onChange={e => setPendingNote(e.target.value)} />
              </div>
              <button className="btn btn-secondary" onClick={submitPendingStudent} disabled={submittingPending || !pendingName.trim()}>
                {submittingPending ? 'Đang gửi...' : 'Gửi báo cáo lên Văn phòng'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Attendance;
