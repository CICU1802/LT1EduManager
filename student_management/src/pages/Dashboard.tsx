import { useState, useEffect } from 'react';
import { Users, AlertTriangle, TrendingUp, CreditCard, Activity } from 'lucide-react';
import api from '../utils/api';

const Dashboard = () => {
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalClasses: 0,
    totalRevenue: 0,
    absentWarnings: 0,
    recentActivity: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Fetch parallel requests for performance
        const [studentRes, classRes, tuitionRes] = await Promise.all([
          api.get('/api/students'),
          api.get('/api/classes'),
          api.get('/api/tuition')
        ]);
        
        const students = studentRes.data || [];
        const classes = classRes.data || [];
        const tuitions = tuitionRes.data || [];

        // Calculate Revenue
        let sumRevenue = 0;
        tuitions.forEach(t => {
           if (t.amount && !isNaN(t.amount)) sumRevenue += Number(t.amount);
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
          action: `Đóng học phí: ${formatMoney(Number(t.amount))}`,
          status: t.status === 'Đã nộp' ? 'Hoàn tất' : 'Đang xử lý',
          badge: t.status === 'Đã nộp' ? 'badge-success' : 'badge-warning',
          time: t.date || 'Gần đây'
        }));

        setStats({
          totalStudents: students.length,
          totalClasses: classes.length,
          totalRevenue: formatMoney(sumRevenue),
          absentWarnings: warningCount,
          recentActivity: activities.length > 0 ? activities : [
            { id: students[0]?.id || 'HS001', name: students[0]?.name || 'Hệ thống', action: 'Chưa có hoạt động', status: 'Hoàn tất', badge: 'badge-success', time: 'Vừa xong' }
          ]
        });
      } catch (err) {
        console.error('Error fetching stats:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  return (
    <div className="fade-in">
      <div className="dashboard-grid">
        <div className="glass-panel stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="stat-label">Tổng Học Sinh</div>
            <Users size={20} color="var(--accent-primary)" />
          </div>
          <div className="stat-value">{loading ? '...' : stats.totalStudents}</div>
          <div style={{ color: 'var(--accent-success)', fontSize: '0.85rem', display:'flex', gap:'4px', alignItems:'center' }}>
            <TrendingUp size={14} /> +12% so với tháng trước
          </div>
        </div>

        <div className="glass-panel stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="stat-label">Lớp Đang Hoạt Động</div>
            <Activity size={20} color="var(--accent-primary)" />
          </div>
          <div className="stat-value">{loading ? '...' : stats.totalClasses}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Trung bình 28 HS / Lớp</div>
        </div>

        <div className="glass-panel stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="stat-label">Doanh Thu Học Phí</div>
            <CreditCard size={20} color="var(--accent-success)" />
          </div>
          <div className="stat-value" style={{ color: 'var(--accent-success)' }}>{loading ? '...' : stats.totalRevenue}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Đã thu 85% tổng dự kiến</div>
        </div>

        <div className="glass-panel stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="stat-label">Cảnh Báo Nghỉ Học</div>
            <AlertTriangle size={20} color="var(--accent-danger)" />
          </div>
          <div className="stat-value" style={{ color: 'var(--accent-danger)' }}>{loading ? '...' : stats.absentWarnings}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Học sinh có số buổi vắng {'>'} 0</div>
        </div>
      </div>

      <div className="glass-panel" style={{ marginTop: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2>Hoạt động gần đây</h2>
          <button className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={() => alert('Đang tải toàn bộ lịch sử hoạt động...')}>Xem tất cả</button>
        </div>
        
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
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
              stats.recentActivity.map((log, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--accent-primary)', fontWeight: '500' }}>{log.id}</td>
                  <td>{log.name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{log.action}</td>
                  <td><span className={`badge ${log.badge}`}>{log.status}</span></td>
                  <td style={{ color: 'var(--text-secondary)' }}>{log.time}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Dashboard;
