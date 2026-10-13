import { useEffect, useState } from "react";
import api from "../utils/api";
import { vietnamDate } from "../utils/date";

function Form({ title, fields, submit }) {
  const [values, setValues] = useState({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <details className="glass-panel" style={{ marginTop: 16 }}>
      <summary>{title}</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            await submit(
              Object.fromEntries(
                fields.map((f) => [f.key, values[f.key] ?? f.value ?? ""]),
              ),
            );
            setMessage("Đã lưu thành công.");
          } catch (err) {
            setMessage(
              err.response?.data?.error || err.message || "Không lưu được.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {fields.map((f) => (
          <label key={f.key} style={{ display: "block", marginTop: 12 }}>
            {f.label}
            {f.options ? (
              <select
                className="form-input"
                required={!f.optional}
                value={values[f.key] ?? f.value ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
              >
                <option value="">Chọn…</option>
                {f.options.map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="form-input"
                required={!f.optional}
                type={f.type || "text"}
                step={f.type === "number" ? "any" : undefined}
                value={values[f.key] ?? f.value ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
              />
            )}
          </label>
        ))}
        <p role="status">{message}</p>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Đang lưu…" : "Lưu"}
        </button>
      </form>
    </details>
  );
}
export function AttendanceOperations({ classes, classId, date, onChange }) {
  const [tasks, setTasks] = useState([]),
    [pending, setPending] = useState([]),
    [makeups, setMakeups] = useState([]),
    [error, setError] = useState(""),
    [detail, setDetail] = useState(null),
    [studentId, setStudentId] = useState("");
  const load = async () => {
    try {
      const [a, b, c] = await Promise.all([
        api.get("/api/parent-tasks"),
        api.get("/api/pending-students"),
        api.get("/api/makeups"),
      ]);
      setTasks(a.data);
      setPending(b.data.filter((p) => p.status !== "Đã xử lý"));
      setMakeups(c.data);
    } catch (e) {
      setError(e.response?.data?.error || "Không tải được dữ liệu văn phòng.");
    }
  };
  useEffect(() => {
    load();
  }, []);
  const post = async (path, body) => {
    await api.post(path, body);
    await load();
    onChange();
  };
  const cls = (key, label, value = classId) => ({
      key,
      label,
      options: classes,
      value,
    }),
    input = (key, label, value = "", optional = false) => ({
      key,
      label,
      value,
      optional,
    }),
    day = (key, label, value = date) => ({ key, label, value, type: "date" });
  return (
    <section>
      <h2>Công việc văn phòng</h2>
      {error && <p role="alert">{error}</p>}
      <Form
        title="Tạo ca học / buổi ngoại lệ"
        fields={[
          cls("classId", "Lớp"),
          day("date", "Ngày"),
          input("sessionKey", "Mã ca (default, sang, chieu...)", "default"),
          input("label", "Tên ca", "Buổi thường"),
          { ...input("startsAt", "Giờ bắt đầu", "00:00"), type: "time" },
          input("reason", "Lý do tạo buổi"),
        ]}
        submit={(v) => post("/api/attendance/sessions", v)}
      />
      <Form
        title="Chuẩn hóa lịch học của lớp"
        fields={[
          cls("classId", "Lớp"),
          input(
            "days",
            "Thứ học: 2–7, Chủ nhật ghi 8; ngăn bằng dấu phẩy",
            "2,4,6",
          ),
        ]}
        submit={(v) =>
          post(`/api/classes/${encodeURIComponent(v.classId)}/schedule`, {
            weekdays: v.days
              .split(",")
              .map((x) => (Number(x.trim()) === 8 ? 0 : Number(x.trim()) - 1)),
          })
        }
      />
      <Form
        title="Đăng ký / kết thúc lớp theo ngày hiệu lực"
        fields={[
          input("studentId", "Mã học sinh"),
          cls("classId", "Lớp"),
          day("startsOn", "Ngày bắt đầu"),
          {
            ...day("endsOn", "Ngày đầu tiên không còn học", ""),
            optional: true,
          },
          {
            ...cls(
              "targetClass",
              "Chuyển sang lớp (bỏ trống nếu chỉ kết thúc)",
            ),
            value: "",
            optional: true,
          },
        ]}
        submit={(v) => post("/api/enrollments", v)}
      />
      <Form
        title="Xếp lịch học bù cho một buổi vắng"
        fields={[
          input("studentId", "Mã học sinh"),
          cls("sourceClass", "Lớp buổi vắng"),
          day("sourceDate", "Ngày vắng"),
          input("sourceSession", "Mã ca buổi vắng", "default"),
          cls("targetClass", "Lớp học bù"),
          day("targetDate", "Ngày học bù"),
          input("targetSession", "Mã ca học bù", "default"),
          input("note", "Ghi chú", "", true),
        ]}
        submit={(v) => post("/api/makeups", v)}
      />
      <details className="glass-panel">
        <summary>Lịch học bù ({makeups.length})</summary>
        {makeups.map((m) => (
          <p key={m.id}>
            {m.name} · {String(m.source_date).slice(0, 10)} → {m.target_class} ·{" "}
            {String(m.target_date).slice(0, 10)} · {m.target_session}
          </p>
        ))}
      </details>
      <h3>Liên hệ phụ huynh</h3>
      <p>
        Tạo việc nội bộ khi có ít nhất hai buổi ghi nhận Vắng liên tiếp. Không
        tự gửi tin nhắn.
      </p>
      {tasks
        .filter((t) => t.status === "open")
        .map((t) => (
          <Form
            key={t.id}
            title={`${t.name} · ${t.class_id} · ${t.profile.parentPhone || "Chưa có SĐT phụ huynh"}`}
            fields={[input("note", "Kết quả liên hệ")]}
            submit={(v) => post(`/api/parent-tasks/${t.id}/resolve`, v)}
          />
        ))}
      {!tasks.some((t) => t.status === "open") && (
        <p>Không có việc gọi phụ huynh đang mở.</p>
      )}
      <details>
        <summary>Lịch sử liên hệ</summary>
        {tasks
          .filter((t) => t.status !== "open")
          .map((t) => (
            <p key={t.id}>
              {t.name}: {t.note} · {t.resolved_by || "Hệ thống"}
            </p>
          ))}
      </details>
      <h3>Học sinh mới chờ xử lý</h3>
      {pending.map((p) => (
        <Form
          key={p.id}
          title={`${p.name} · ${p.class} · ${p.date}`}
          fields={[
            input(
              "studentId",
              "Mã học sinh đã có (để trống để tạo mới)",
              "",
              true,
            ),
            cls("classId", "Lớp đăng ký", p.classId || classId),
            {
              key: "attendanceStatus",
              label: "Điểm danh buổi phát sinh (tùy chọn)",
              optional: true,
              options: ["Có mặt", "Vắng", "Đi trễ", "Vắng có phép"].map(
                (x) => ({ id: x, name: x }),
              ),
            },
            input("attendanceNote", "Ghi chú buổi phát sinh", "", true),
          ]}
          submit={(v) => post(`/api/pending-students/${p.id}/enroll`, v)}
        />
      ))}
      <Form
        title="Gia đình và mức giảm học phí anh/chị/em"
        fields={[
          input("id", "Mã gia đình đã có (để trống để tạo mới)", "", true),
          input("name", "Tên gia đình"),
          input("ids", "Các mã học sinh, ngăn bằng dấu phẩy"),
          {
            ...input(
              "discountPercent",
              "Tỷ lệ giảm do văn phòng quy định (%)",
              "0",
            ),
            type: "number",
          },
        ]}
        submit={(v) =>
          post("/api/families", {
            ...v,
            studentIds: v.ids
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
            discountPercent: Number(v.discountPercent),
          })
        }
      />
      <Form
        title="Ghi nhận điểm kiểm tra vào hồ sơ"
        fields={[
          input("studentId", "Mã học sinh"),
          cls("classId", "Lớp"),
          input("title", "Tên bài kiểm tra"),
          day("date", "Ngày kiểm tra", vietnamDate()),
          { ...input("score", "Điểm"), type: "number" },
          { ...input("maximum", "Thang điểm", "10"), type: "number" },
        ]}
        submit={(v) => post("/api/results", v)}
      />
      <div className="glass-panel">
        <h3>Tra cứu hồ sơ, gia đình và kết quả</h3>
        <label>
          Mã học sinh
          <input
            className="form-input"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          />
        </label>
        <button
          className="btn"
          onClick={async () => {
            try {
              setDetail(
                (
                  await api.get(
                    `/api/students/${encodeURIComponent(studentId)}/details`,
                  )
                ).data,
              );
            } catch {
              setError("Không tìm thấy hồ sơ.");
            }
          }}
        >
          Tra cứu
        </button>
        {detail && (
          <>
            <h4>{detail.student.name}</h4>
            <p>
              {detail.family
                ? `${detail.family.name} (${detail.family.id})`
                : "Chưa ghép gia đình"}{" "}
              · Số buổi vắng: {detail.student.absences}
            </p>
            {detail.enrollments.map((e) => (
              <p key={e.class_id}>
                {e.class_id}: {e.status} ·{" "}
                {String(e.starts_on || "").slice(0, 10)} —{" "}
                {String(e.ends_on || "").slice(0, 10)}
              </p>
            ))}
            {detail.periods?.map((p) => (
              <p key={`${p.class_id}/${p.starts_on}`}>
                Lịch sử {p.class_id}: {String(p.starts_on).slice(0, 10)} đến{" "}
                {p.ends_on ? String(p.ends_on).slice(0, 10) : "hiện tại"}
              </p>
            ))}
            {detail.results.map((r) => (
              <p key={r.id}>
                {r.title} · {String(r.test_date).slice(0, 10)}: {r.score}/
                {r.maximum}
              </p>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
