import { useEffect, useState } from "react";
import api from "../utils/api";
export default function StudentAcademicSummary({ studentId }) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api
      .get("/api/attendance/capabilities")
      .then(async (r) => {
        if (r.data.operations) {
          const d = await api.get(
            `/api/students/${encodeURIComponent(studentId)}/details`,
          );
          if (active) setData(d.data);
        }
      })
      .catch(() => {
        if (active) setError("Chưa tải được kết quả học tập.");
      });
    return () => {
      active = false;
    };
  }, [studentId]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return null;
  return (
    <section>
      <h3>Gia đình và kết quả học tập</h3>
      <p>
        {data.family
          ? `${data.family.name} · Mã ${data.family.id} · Mức giảm ${data.family.discount_percent}%`
          : "Chưa ghép gia đình"}
      </p>
      {data.results.length ? (
        <div className="table-scroll">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Bài kiểm tra</th>
                <th>Ngày</th>
                <th>Điểm</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.id}>
                  <td data-label="Bài kiểm tra">
                    {r.title} · {r.class_id}
                  </td>
                  <td data-label="Ngày">{String(r.test_date).slice(0, 10)}</td>
                  <td data-label="Điểm">
                    {r.score}/{r.maximum}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>Chưa có điểm kiểm tra.</p>
      )}
    </section>
  );
}
