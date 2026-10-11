import { Link } from 'react-router-dom';
import { notify } from '../utils/notify';
import { vietnamDate } from '../utils/date';
import { useState, useEffect } from 'react';
import { Users, AlertTriangle, CreditCard, Activity, Check, ArrowUpRight, CalendarCheck } from 'lucide-react';
import api from '../utils/api';

const Dashboard = () => {
  const [reportMonth, setReportMonth] = useState(vietnamDate().slice(0, 7));
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalClasses: 0,
    totalRevenue: '0đ',
    averageStudents: '0',
    absentWarnings: 0,
    recentActivity: []
  });
  const [pendingStudents, setPendingStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError('');
      try {
        // Fetch parallel requests for performance
        const [studentRes, classRes, tuitionRes, pendingRes] = await Promise.all([
          api.get('/api/students'),
          api.get('/api/classes'),
          api.get('/api/tuition'),
          api.get('/api/pending-students')
        ]);

        const students = studentRes.data || [];
        const classes = classRes.data || [];
        const tuitions = tuitionRes.data || [];
        const pending = pendingRes.data || [];

        setPendingStudents(pending);

        // Calculate Revenue
        let sumRevenue = 0;
        const parseAmount = value => Number(String(value || '').replace(/[.,\sđ₫]/g, '')) || 0;
        const inMonth = value => {
          const text = String(value || '').trim();
          if (/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(text)) return text.slice(0, 7) === reportMonth;
          const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/);
          return !!match && `${match[3]}-${match[2].padStart(2, '0')}` === reportMonth;
        };
        tuitions.forEach(t => {
          if (t.status === 'Đã nộp' && inMonth(t.date)) sumRevenue += parseAmount(t.amount);
        });

        const formatMoney = (amount) => {
          if (amount >= 1000000) return (amount / 1000000).toFixed(1) + 'Tr';
          if (amount >= 1000) return (amount / 1000).toFixed(0) + 'K';
          return amount + 'đ';
        };

        // Calculate Absent Warnings
        let warningCount = 0;
        students.forEach(s => {
          if (s.absences > 0) warningCount++;
        });

        // Recent Activity
        const recentTuitions = [...tuitions].reverse().slice(0, 5);
        const activities = recentTuitions.map(t => ({
          id: t.studentId,
          name: t.studentName,
          action: `${t.status === 'Đã nộp' ? 'Thu học phí' : 'Ghi nhận công nợ'}: ${formatMoney(parseAmount(t.amount))}`,
          status: t.status === 'Đã nộp' ? 'Hoàn tất' : 'Đang xử lý',
          badge: t.status === 'Đã nộp' ? 'badge-success' : 'badge-warning',
          time: t.date || 'Gần đây'
        }));

        setStats({
          totalStudents: students.length,
          totalClasses: classes.length,
          totalRevenue: formatMoney(sumRevenue),
          averageStudents: classes.length ? (students.filter(s => s.status === 'Đang học').reduce((sum, s) => sum + classes.filter(c => String(s.classes || '').split(',').map(v => v.trim()).includes(c.id)).length, 0) / classes.length).toFixed(1) : '0',
          absentWarnings: warningCount,
          recentActivity: activities
        });
      } catch (err) {
        console.error('Error fetching stats:', err);
        setError('Không tải được đầy đủ dữ liệu báo cáo. Vui lòng tải lại.');
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [reportMonth]);

  const handleApprovePending = async (id) => {
    if (!window.confirm('Đánh dấu là đã xử lý xong học sinh này?')) return;
    try {
      await api.post(`/api/pending-students/${id}/resolve`);
      const res = await api.get('/api/pending-students');
      setPendingStudents(res.data);
    } catch (err) {
      console.error(err);
      notify('Lỗi khi duyệt: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="fade-in">
      <section className="dashboard-intro"><div><span className="eyebrow">ĐỒNG HÀNH CÙNG SỰ TIẾN BỘ</span><h2>Một góc nhìn rõ ràng cho mỗi ngày.</h2><p>Hồ sơ, chuyên cần và học phí — những thông tin cần thiết để vận hành trung tâm hiệu quả.</p></div><div className="dashboard-intro-actions"><Link className="btn" to="/attendance"><CalendarCheck size={17} /> Điểm danh <ArrowUpRight size={15} /></Link><Link className="btn btn-secondary" to="/students">Hồ sơ học sinh <ArrowUpRight size={15} /></Link></div></section>
      <div className="report-toolbar"><label htmlFor="report-month">Doanh thu theo tháng <input id="report-month" className="form-input" type="month" value={reportMonth} onChange={e => setReportMonth(e.target.value)} /></label><span className="report-note">Tính theo ngày thu · Chỉ gồm khoản đã nộp</span></div>
      {error && <p role="alert" style={{color: 'var(--accent-danger)'}}>{error}</p>}
      <div className="dashboard-grid">
        <div className="glass-panel stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="stat-label">Tổng Học Sinh</div>
            <Users size={20} color="var(--accent-primary)" />
          </div>
          <div className="stat-value">{loading ? '...' : error ? '—' : stats.totalStudents}</div>
          <div style={{ color: 'var(--accent-success)', fontSize: '0.85rem', display:'flex', gap:'4px', alignItems:'center' }}>
            Số học sinh trong hồ sơ hiện tại
          </div>
        </div>

        <div className="glass-panel stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="stat-label">Tổng lớp trong danh mục</div>
            <Activity size={20} color="var(--accent-primary)" />
          </div>
          <div className="stat-value">{loading ? '...' : error ? '—' : stats.totalClasses}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Trung bình {error ? '—' : stats.averageStudents} HS đang học / lớp</div>
        </div>

        {localStorage.getItem('edu_role') === 'admin' && (
          <div className="glass-panel stat-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="stat-label">Doanh Thu Học Phí</div>
              <CreditCard size={20} color="var(--accent-success)" />
            </div>
            <div className="stat-value" style={{ color: 'var(--accent-success)' }}>{loading ? '...' : error ? '—' : stats.totalRevenue}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Khoản Đã nộp, theo ngày thu trong {reportMonth}</div>
          </div>
        )}

        <div className="glass-panel stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="stat-label">Cảnh Báo Nghỉ Học</div>
            <AlertTriangle size={20} color="var(--accent-danger)" />
          </div>
          <div className="stat-value" style={{ color: 'var(--accent-danger)' }}>{loading ? '...' : error ? '—' : stats.absentWarnings}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Học sinh có số buổi vắng {'>'} 0</div>
        </div>
      </div>

      {/* Bảng báo cáo Học sinh mới chờ duyệt (Văn phòng / Admin) */}
      {localStorage.getItem('edu_role') !== 'trogiang' && pendingStudents.length > 0 && (
        <div className="glass-panel fade-in" style={{ marginTop: '32px', borderColor: 'var(--accent-warning)' }}>
          <div className="section-title-row">
            <h2 style={{ color: 'var(--accent-warning)', display: 'flex', alignItems: 'center', gap: '8px' }}><AlertTriangle size={24} /> Báo cáo học sinh mới</h2><button className="btn btn-secondary" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Xem chờ xử lý' : 'Xem lịch sử xử lý'}</button>
          </div>
          <div className="table-scroll" role="region" aria-label="Danh sách hoạt động" tabIndex={0}><table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr>
                <th>Lớp</th>
                <th>Ngày báo</th>
                <th>Họ và Tên</th>
                <th>SĐT / Ghi chú</th>
                <th>Người báo</th>
                <th style={{ textAlign: 'right' }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {pendingStudents.filter(p => showHistory ? p.status === 'Đã xử lý' : p.status !== 'Đã xử lý').map(p => (
                <tr key={p.id}>
                  <td data-label="Lớp" style={{ fontWeight: 500 }}>{p.class}</td>
                  <td data-label="Ngày báo" style={{ color: 'var(--text-secondary)' }}>{p.date}</td>
                  <td data-label="Họ và tên" style={{ fontWeight: 'bold' }}>{p.name}</td>
                  <td data-label="Liên hệ / ghi chú" style={{ color: 'var(--text-secondary)' }}>{p.note}</td>
                  <td data-label="Người báo"><span className="badge badge-warning">{p.reportedBy}</span></td>
                  <td data-label="Xử lý" style={{ textAlign: 'right' }}>
                    {p.status === 'Đã xử lý' ? <span>{p.processedBy} · {p.processedAt}</span> : <button className="btn btn-primary" style={{ padding: '6px 16px', fontSize: '0.85rem', background: 'var(--accent-success)' }} onClick={() => handleApprovePending(p.id)}>
                      <Check size={16} /> Đã xử lý xong
                    </button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <div className="glass-panel" style={{ marginTop: '32px' }}>
        <div className="section-title-row">
          <h2>Hoạt động gần đây</h2>
          {localStorage.getItem('edu_role') !== 'trogiang' && <Link className="btn btn-secondary" to="/tuition">Xem hóa đơn <ArrowUpRight size={15} /></Link>}
        </div>

        <div className="table-scroll" role="region" aria-label="Danh sách hoạt động" tabIndex={0}><table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr>
              <th>Mã HS</th>
              <th>Họ và Tên</th>
              <th>Hành động</th>
              <th>Trạng thái</th>
              <th>Thời gian</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{textAlign: 'center', padding: '20px'}}>Đang tải...</td></tr>
            ) : (
              stats.recentActivity.length === 0 ? <tr><td colSpan={5}>Chưa có giao dịch học phí.</td></tr> : stats.recentActivity.map((log, i) => (
                <tr key={i}>
                  <td data-label="Mã HS" style={{ color: 'var(--accent-primary)', fontWeight: '500' }}>{log.id}</td>
                  <td data-label="Học sinh">{log.name}</td>
                  <td data-label="Hoạt động" style={{ color: 'var(--text-secondary)' }}>{log.action}</td>
                  <td data-label="Trạng thái"><span className={`badge ${log.badge}`}>{log.status}</span></td>
                  <td data-label="Ngày thu" style={{ color: 'var(--text-secondary)' }}>{log.time}</td>
                </tr>
              ))
            )}
          </tbody>
        </table></div>
      </div>
    </div>
  );
};

export default Dashboard;
