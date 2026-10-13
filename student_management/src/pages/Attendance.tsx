import { useCallback, useEffect, useRef, useState } from "react";
import api from "../utils/api";
import { vietnamDate } from "../utils/date";
import { notify } from "../utils/notify";
import { AttendanceOperations } from "./AttendanceOperations";

const labels = ["Có mặt", "Đi trễ", "Vắng", "Vắng có phép"];
const normalize = (s) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase();
const signature = (s) => JSON.stringify([s.status || null, s.note || ""]);
const csv = (v) =>
  '"' +
  String(/^\s*[=+@-]/.test(String(v ?? "")) ? "'" + v : (v ?? "")).replace(
    /"/g,
    '""',
  ) +
  '"';
function downloadCSV(rows, name) {
  const blob = new Blob(
    ["\uFEFF" + rows.map((r) => r.map(csv).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export default function Attendance() {
  const [classes, setClasses] = useState([]),
    [classId, setClassId] = useState(""),
    [date, setDate] = useState(vietnamDate()),
    [slot, setSlot] = useState("default");
  const [caps, setCaps] = useState(null),
    [sessions, setSessions] = useState([]),
    [students, setStudents] = useState([]),
    [baseline, setBaseline] = useState([]),
    [loaded, setLoaded] = useState("");
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [savedAt, setSavedAt] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [history, setHistory] = useState(null),
    [pendingName, setPendingName] = useState(""),
    [pendingNote, setPendingNote] = useState(""),
    [sending, setSending] = useState(false),
    [reason, setReason] = useState("");
  const [draftOffer, setDraftOffer] = useState(null),
    [operations, setOperations] = useState(false),
    [revision, setRevision] = useState(0);
  const requestRef = useRef(null),
    reportRef = useRef(null),
    sequence = useRef(0),
    dirtyRef = useRef(false),
    saveDraftRef = useRef(() => {});
  const user = localStorage.getItem("edu_user") || "",
    office = localStorage.getItem("edu_role") !== "trogiang";
  const context = JSON.stringify([classId, date, slot]);
  const draftKey = "lt1-attendance:" + user + ":" + loaded;
  const changes = students.filter(
    (s) =>
      !s.isTransferred &&
      signature(s) !== signature(baseline.find((b) => b.id === s.id) || {}),
  );
  const dirty = changes.length > 0;
  const coherent = loaded === context && !loading;
  const persist = useCallback(() => {
    if (dirty && loaded) {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            students,
            baseline,
            request: requestRef.current,
            updatedAt: new Date().toISOString(),
          }),
        );
        return true;
      } catch {
        setError(
          "Không lưu được bản nháp trên thiết bị. Hãy lưu trước khi rời trang.",
        );
        return false;
      }
    }
    return true;
  }, [dirty, loaded, draftKey, students, baseline]);
  useEffect(() => {
    dirtyRef.current = dirty;
    saveDraftRef.current = persist;
  });
  useEffect(() => {
    Promise.all([
      api.get("/api/classes"),
      api.get("/api/attendance/capabilities"),
    ])
      .then(([a, b]) => {
        setClasses(a.data);
        setCaps(b.data);
        if (a.data.length) setClassId(a.data[0].id);
      })
      .catch(() => setError("Không tải được danh mục hoặc phiên bản máy chủ."));
  }, []);
  useEffect(() => {
    if (dirty && !draftOffer) persist();
    else if (coherent && !dirty && !draftOffer && loaded)
      localStorage.removeItem(draftKey);
  }, [persist, coherent, dirty, draftKey, loaded, draftOffer]);
  useEffect(() => {
    const unload = (e) => {
      if (dirtyRef.current) {
        saveDraftRef.current();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const click = (e) => {
      const link = e.target.closest?.("a[href]");
      if (
        dirtyRef.current &&
        link &&
        !window.confirm(
          "Có thay đổi chưa lưu. Bản nháp được giữ trên thiết bị. Rời trang?",
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, []);
  const load = useCallback(async () => {
    if (!classId || !date || !caps) return;
    const seq = ++sequence.current;
    setLoading(true);
    setError("");
    setHistory(null);
    setDraftOffer(null);
    try {
      const b = caps.sessions
        ? await api.get("/api/attendance/sessions", {
            params: { classId, date },
          })
        : { data: [{ session_key: "default", label: "Buổi thường" }] };
      if (seq !== sequence.current) return;
      setSessions(b.data);
      const a = await api.get(
        `/api/attendance/class/${encodeURIComponent(classId)}`,
        { params: { date, sessionKey: slot } },
      );
      if (seq !== sequence.current) return;
      const rows = a.data.map((s) =>
        s.status === "Khác" && /^Đi trễ(?:$|: )/.test(s.note || "")
          ? {
              ...s,
              status: "Đi trễ",
              note: s.note.replace(/^Đi trễ(?:: )?/, ""),
            }
          : s,
      );
      setStudents(rows);
      setBaseline(rows);
      setLoaded(context);
      setSessions(b.data);
      setPage(1);
      setQuery("");
      setSavedAt("");
      requestRef.current = null;
      try {
        const draft = JSON.parse(
          localStorage.getItem("lt1-attendance:" + user + ":" + context) ||
            "null",
        );
        if (draft) setDraftOffer(draft);
      } catch {}
    } catch (e) {
      if (seq === sequence.current) {
        setError(e.response?.data?.error || "Không tải được điểm danh.");
        setLoaded("");
        setStudents([]);
      }
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, [classId, date, slot, caps, context, user]);
  useEffect(() => {
    const requestSequence = sequence;
    load();
    return () => {
      requestSequence.current++;
    };
  }, [load, revision]);
  function changeContext(fn) {
    if (
      dirty &&
      !window.confirm(
        "Lưu bản nháp và chuyển buổi? Chọn Hủy để tiếp tục chỉnh sửa.",
      )
    )
      return;
    if (!persist()) return;
    fn();
  }
  function reload() {
    if (
      dirty &&
      !window.confirm("Tải dữ liệu mới để đối chiếu? Bản nháp sẽ được giữ.")
    )
      return;
    if (!persist()) return;
    setRevision((v) => v + 1);
  }
  function restore() {
    const d = draftOffer;
    const edited = d.students.filter(
      (s) =>
        signature(s) !== signature(d.baseline.find((b) => b.id === s.id) || {}),
    );
    let conflict = false;
    const restored = students.map((s) => {
      const old = edited.find((x) => x.id === s.id);
      if (!old || s.isTransferred) return s;
      const base = d.baseline.find((x) => x.id === s.id);
      if (base?.version !== s.version) {
        if (signature(old) !== signature(s)) conflict = true;
        return s;
      }
      return { ...s, status: old.status, note: old.note };
    });
    if (conflict) {
      setError(
        "Bản nháp có dòng đã bị sửa. Tải bản nháp để đối chiếu rồi nhập lại; chưa khôi phục để tránh mất nội dung.",
      );
      return;
    }
    setStudents(restored);
    setDraftOffer(null);
    requestRef.current = d.request || null;
  }
  const mark = (id, patch) => {
    requestRef.current = null;
    setStudents((list) =>
      list.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  };
  async function save() {
    if (!coherent || !dirty || saving || draftOffer) return;
    const missing = students.filter(
      (s) => !s.isTransferred && !s.status,
    ).length;
    if (
      missing &&
      !window.confirm(
        `Còn ${missing} học sinh chưa điểm danh. Lưu phần đã chỉnh sửa?`,
      )
    )
      return;
    const payload = {
      classId,
      date,
      sessionKey: slot,
      reason,
      records: changes.map(({ id, status, note, version }) => ({
        id,
        status,
        note,
        version,
      })),
    };
    const payloadText = JSON.stringify(payload);
    if (requestRef.current?.payload !== payloadText)
      requestRef.current = { id: crypto.randomUUID(), payload: payloadText };
    persist();
    setSaving(true);
    setError("");
    try {
      const r = await api.post("/api/attendance", {
        ...payload,
        requestId: requestRef.current.id,
      });
      const versions = r.data.versions || {};
      const rows = students.map((s) =>
        Object.hasOwn(versions, s.id) ? { ...s, version: versions[s.id] } : s,
      );
      setStudents(rows);
      setBaseline(rows);
      setSavedAt(r.data.savedAt || new Date().toISOString());
      localStorage.removeItem(draftKey);
      setDraftOffer(null);
      requestRef.current = null;
      notify("Đã lưu điểm danh và ghi chú.", "success");
      try {
        const verify = await api.get(
          `/api/attendance/class/${encodeURIComponent(classId)}`,
          { params: { date, sessionKey: slot } },
        );
        if (
          changes.some((s) => {
            const actual = verify.data.find((x) => x.id === s.id);
            return !actual || actual.version !== versions[s.id];
          })
        )
          setError(
            "Đã lưu, nhưng dữ liệu vừa có thay đổi khác. Tải lại để đối chiếu.",
          );
      } catch {
        setError(
          "Máy chủ đã xác nhận lưu. Chưa đọc lại được để đối chiếu; hãy tải lại khi kết nối ổn định.",
        );
      }
    } catch (e) {
      setError(
        e.response?.data?.error ||
          "Chưa xác nhận được kết quả. Giữ nguyên bản nháp và bấm Lưu lại để kiểm tra cùng yêu cầu.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function report() {
    if (!coherent || !pendingName.trim()) return;
    setSending(true);
    try {
      const payload = {
        classId,
        className: classes.find((c) => c.id === classId)?.name,
        date,
        sessionKey: slot,
        studentName: pendingName.trim(),
        note: pendingNote,
      };
      const text = JSON.stringify(payload);
      if (reportRef.current?.payload !== text)
        reportRef.current = { id: crypto.randomUUID(), payload: text };
      const r = await api.post("/api/pending-students", {
        ...payload,
        requestId: reportRef.current.id,
      });
      setPendingName("");
      setPendingNote("");
      reportRef.current = null;
      notify(
        r.data.duplicate
          ? "Báo cáo này đã có trong danh sách chờ xử lý."
          : "Đã gửi báo cáo cho văn phòng.",
        "success",
      );
    } catch (e) {
      setError(e.response?.data?.error || "Gửi chưa thành công. Hãy thử lại.");
    } finally {
      setSending(false);
    }
  }
  const active = students.filter((s) => !s.isTransferred),
    count = (s) => active.filter((x) => x.status === s).length;
  const filtered = students.filter((s) =>
      normalize(s.name + " " + s.id).includes(normalize(query)),
    ),
    pages = Math.max(1, Math.ceil(filtered.length / 15)),
    visible = filtered.slice((page - 1) * 15, page * 15);
  return (
    <div className="fade-in">
      <div className="glass-panel attendance-selector">
        <label>
          Lớp / khóa
          <select
            className="form-input"
            value={classId}
            disabled={saving}
            onChange={(e) =>
              changeContext(() => {
                setClassId(e.target.value);
                setSlot("default");
              })
            }
          >
            <option value="">Chọn lớp</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ngày điểm danh
          <input
            className="form-input"
            type="date"
            value={date}
            max={vietnamDate()}
            disabled={saving}
            onChange={(e) =>
              changeContext(() => {
                setDate(e.target.value);
                setSlot("default");
              })
            }
          />
        </label>
        <label>
          Ca học
          <select
            className="form-input"
            value={slot}
            disabled={saving || !caps?.sessions}
            onChange={(e) => changeContext(() => setSlot(e.target.value))}
          >
            {(sessions.length
              ? sessions
              : [{ session_key: "default", label: "Buổi thường" }]
            ).map((s) => (
              <option key={s.session_key} value={s.session_key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-secondary"
          disabled={loading || saving}
          onClick={reload}
        >
          {loading ? "Đang tải…" : "Tải lại để đối chiếu"}
        </button>
      </div>
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      {draftOffer && (
        <div className="glass-panel">
          <p>
            Có bản nháp trên thiết bị từ {draftOffer.updatedAt}. Chỉ khôi phục
            các dòng chưa bị người khác sửa.
          </p>
          <button className="btn" onClick={restore}>
            Khôi phục bản nháp
          </button>
          <button
            className="btn"
            onClick={() =>
              downloadCSV(
                [
                  ["Mã", "Tên", "Trạng thái", "Ghi chú"],
                  ...draftOffer.students.map((s) => [
                    s.id,
                    s.name,
                    s.status,
                    s.note,
                  ]),
                ],
                "ban-nhap-diem-danh.csv",
              )
            }
          >
            Tải bản nháp để đối chiếu
          </button>
          <button
            className="btn"
            onClick={() => {
              if (window.confirm("Bỏ bản nháp trên thiết bị?")) {
                localStorage.removeItem(draftKey);
                setDraftOffer(null);
              }
            }}
          >
            Bỏ bản nháp
          </button>
        </div>
      )}
      {coherent && (
        <section className="glass-panel">
          <h2>
            {classes.find((c) => c.id === classId)?.name} · {date} ·{" "}
            {sessions.find((s) => s.session_key === slot)?.label || slot}
          </h2>
          <p aria-live="polite">
            {dirty
              ? `${changes.length} học sinh có thay đổi chưa lưu · bản nháp trên thiết bị`
              : savedAt
                ? `Đã lưu lúc ${new Date(savedAt).toLocaleTimeString("vi-VN")}`
                : "Dữ liệu đã tải từ máy chủ"}
          </p>
          <div className="attendance-summary">
            {labels.map((s) => (
              <span className="badge" key={s}>
                {s}: {count(s)}
              </span>
            ))}
            <span className="badge">
              Đã đến lớp: {count("Có mặt") + count("Đi trễ")}
            </span>
            <span className="badge">
              Chưa điểm danh: {active.filter((s) => !s.status).length}
            </span>
          </div>
          <div className="toolbar-filters">
            <input
              className="form-input"
              placeholder="Tìm tên hoặc mã HS"
              aria-label="Tìm tên hoặc mã HS"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
            <button
              className="btn btn-secondary"
              disabled={saving || !!draftOffer}
              onClick={() => {
                if (
                  window.confirm(
                    "Đánh dấu Có mặt cho học sinh chưa điểm danh trong toàn bộ danh sách?",
                  )
                ) {
                  requestRef.current = null;
                  setStudents((list) =>
                    list.map((s) =>
                      !s.isTransferred && !s.status
                        ? { ...s, status: "Có mặt" }
                        : s,
                    ),
                  );
                }
              }}
            >
              Có mặt cho người chưa đánh dấu
            </button>
          </div>
          <div className="table-scroll">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Học sinh</th>
                  <th>Trạng thái</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.id}>
                    <td data-label="Học sinh">
                      {s.name}
                      <small style={{ display: "block" }}>
                        {s.id}{" "}
                        {s.isTransferred ? "· Ngoài thời gian đăng ký" : ""}{" "}
                        {s.isMakeup ? "· Học bù" : ""}
                      </small>
                    </td>
                    <td data-label="Trạng thái">
                      <select
                        className="form-input"
                        aria-label={`Trạng thái ${s.name}`}
                        disabled={saving || !!draftOffer || s.isTransferred}
                        value={s.status || ""}
                        onChange={(e) =>
                          mark(s.id, { status: e.target.value || null })
                        }
                      >
                        <option value="">Chưa điểm danh</option>
                        {[...labels, "Khác"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Ghi chú">
                      <input
                        className="form-input"
                        maxLength={2000}
                        aria-label={`Ghi chú ${s.name}`}
                        value={s.note || ""}
                        disabled={saving || !!draftOffer || s.isTransferred}
                        onChange={(e) => mark(s.id, { note: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <p>
              Không có học sinh phù hợp. Bạn vẫn có thể báo cáo học sinh mới bên
              dưới.
            </p>
          )}
          <div className="pagination">
            <button
              className="btn"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Trang trước
            </button>
            <span>
              Trang {page}/{pages} · {filtered.length} học sinh
            </span>
            <button
              className="btn"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Trang sau
            </button>
          </div>
          <label>
            Lý do chỉnh sửa (nếu có)
            <input
              className="form-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
            />
          </label>
          <div className="form-actions">
            <button
              className="btn btn-primary"
              disabled={!dirty || saving || !!draftOffer}
              onClick={save}
            >
              {saving ? "Đang lưu…" : "Lưu điểm danh"}
            </button>
            <button
              className="btn"
              onClick={async () => {
                try {
                  const r = await api.get("/api/attendance/history", {
                    params: { classId, date, sessionKey: slot },
                  });
                  setHistory(r.data);
                } catch {
                  setError("Không đọc được lịch sử.");
                }
              }}
            >
              Lịch sử sửa
            </button>
            {office && caps.operations && (
              <button
                className="btn"
                onClick={async () => {
                  try {
                    const r = await api.get("/api/attendance/report", {
                      params: { classId },
                    });
                    downloadCSV(
                      [
                        ["Tên", "Mã HS", "Ngày", "Ca", "Trạng thái", "Ghi chú"],
                        ...r.data.map((s) => [
                          s.name,
                          s.student_id,
                          String(s.attendance_date).slice(0, 10),
                          s.session_key,
                          s.status,
                          s.note,
                        ]),
                      ],
                      "so-diem-danh-chi-tiet.csv",
                    );
                  } catch {
                    setError("Không xuất được báo cáo.");
                  }
                }}
              >
                Xuất sổ chi tiết CSV
              </button>
            )}
          </div>
          {history && (
            <div>
              <h3>Lịch sử thay đổi</h3>
              {!history.length ? (
                <p>Chưa có lịch sử.</p>
              ) : (
                history.map((h, i) => (
                  <p key={i}>
                    {h.actor} · {new Date(h.created_at).toLocaleString("vi-VN")}{" "}
                    · {h.after_data?.id || h.entity}:{" "}
                    {h.before_data?.status || "Chưa điểm danh"} →{" "}
                    {h.after_data?.status || "Chưa điểm danh"} ·{" "}
                    {h.after_data?.note || ""}
                  </p>
                ))
              )}
            </div>
          )}
          <hr />
          <h3>Học sinh mới chưa có tên</h3>
          <label>
            Tên học sinh mới
            <input
              className="form-input"
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
            />
          </label>
          <label>
            SĐT / ghi chú
            <input
              className="form-input"
              value={pendingNote}
              onChange={(e) => setPendingNote(e.target.value)}
            />
          </label>
          <button
            className="btn"
            disabled={sending || !pendingName.trim() || saving}
            onClick={report}
          >
            {sending ? "Đang gửi…" : "Gửi báo cáo lên Văn phòng"}
          </button>
        </section>
      )}
      {office && caps?.operations && (
        <>
          <button
            className="btn btn-secondary"
            disabled={saving || dirty}
            onClick={() => setOperations(!operations)}
          >
            Văn phòng: buổi học, học bù và chuyên cần
          </button>
          {operations && (
            <AttendanceOperations
              classes={classes}
              classId={classId}
              date={date}
              onChange={reload}
            />
          )}
        </>
      )}
    </div>
  );
}
