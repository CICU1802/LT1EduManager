import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { invalid, isDateMatch } from "../integrity.js";
import { audit, dateText, todayVN } from "./service.js";

export const statuses = [
  "Có mặt",
  "Vắng",
  "Đi trễ",
  "Vắng có phép",
  "Khác",
  "Chưa điểm danh",
];
export function scheduledDays(profile = {}) {
  if (Array.isArray(profile.weekdays)) return profile.weekdays;
  const text = String(profile.schedule || "");
  return [0, 1, 2, 3, 4, 5, 6].filter((day) =>
    new RegExp(
      day === 0
        ? "(?:CN|Chủ nhật|Chu nhat)"
        : `(?:T${day + 1}(?!\\d)|Thứ ${day + 1}(?!\\d)|Thu ${day + 1}(?!\\d))`,
      "i",
    ).test(text),
  );
}
export function eligible(en, date) {
  if (en.starts_on && date < dateText(en.starts_on)) return false;
  if (en.ends_on && date >= dateText(en.ends_on)) return false;
  return en.status === "active" || !!en.ends_on;
}
export function createAttendanceOperations(service) {
  const { db, write } = service;
  const key = (value) => {
    const v = value || "default";
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(v)) throw invalid("Mã ca không hợp lệ.");
    return v;
  };
  async function session(c, classId, date, slot) {
    isDateMatch(date, date);
    const cls = (await c.query("SELECT * FROM classes WHERE id=$1", [classId]))
      .rows[0];
    if (!cls) throw invalid("Lớp không tồn tại.", 404);
    const saved = (
      await c.query(
        "SELECT * FROM class_sessions WHERE class_id=$1 AND session_date=$2 AND session_key=$3",
        [classId, date, slot],
      )
    ).rows[0];
    if (!saved) {
      if (slot !== "default") throw invalid("Ca học chưa được tạo.");
      const days = scheduledDays(cls.profile);
      if (cls.profile.schedule && !days.length)
        throw invalid(
          "Lịch chưa chuẩn hóa. Văn phòng cần thiết lập thứ học hoặc tạo buổi ngoại lệ.",
        );
      if (
        days.length &&
        !days.includes(new Date(date + "T12:00:00Z").getUTCDay())
      )
        throw invalid(
          "Ngày ngoài lịch học. Văn phòng cần tạo buổi ngoại lệ kèm lý do.",
        );
    }
    return cls;
  }
  async function enrolledOn(c, en, date) {
    const periods = (
      await c.query(
        "SELECT starts_on,ends_on FROM enrollment_periods WHERE student_id=$1 AND class_id=$2",
        [en.student_id, en.class_id],
      )
    ).rows;
    return periods.length
      ? periods.some(
          (p) =>
            date >= dateText(p.starts_on) &&
            (!p.ends_on || date < dateText(p.ends_on)),
        )
      : eligible(en, date);
  }
  async function idempotent(c, id, payload, fn) {
    if (id) {
      if (typeof id !== "string" || id.length > 120)
        throw invalid("Mã yêu cầu không hợp lệ.");
      const old = (
        await c.query("SELECT * FROM operation_requests WHERE id=$1", [id])
      ).rows[0];
      if (old) {
        if (!isDeepStrictEqual(old.payload, payload))
          throw invalid("Mã yêu cầu đã dùng cho nội dung khác.", 409);
        return old.result;
      }
    }
    const result = await fn();
    if (id)
      await c.query(
        "INSERT INTO operation_requests(id,payload,result) VALUES($1,$2,$3)",
        [id, JSON.stringify(payload), JSON.stringify(result)],
      );
    return result;
  }
  async function refreshTasks(c, classId) {
    const rows = (
      await c.query(
        "SELECT a.*,COALESCE(cs.starts_at,'00:00'::time) AS session_time FROM attendance a LEFT JOIN class_sessions cs ON cs.class_id=a.class_id AND cs.session_date=a.attendance_date AND cs.session_key=a.session_key WHERE a.class_id=$1 ORDER BY a.attendance_date,session_time,a.session_key",
        [classId],
      )
    ).rows;
    const sessions = (
      await c.query(
        `SELECT DISTINCT session_date,session_key,starts_at FROM (
   SELECT a.attendance_date AS session_date,a.session_key,COALESCE(cs.starts_at,'00:00'::time) AS starts_at FROM attendance a LEFT JOIN class_sessions cs ON cs.class_id=a.class_id AND cs.session_date=a.attendance_date AND cs.session_key=a.session_key WHERE a.class_id=$1
   UNION SELECT session_date,session_key,starts_at FROM class_sessions WHERE class_id=$1
  ) x WHERE session_date <= $2 ORDER BY session_date,starts_at,session_key`,
        [classId, todayVN()],
      )
    ).rows;
    const enrollments = (
      await c.query("SELECT * FROM enrollments WHERE class_id=$1", [classId])
    ).rows;
    const periods = (
      await c.query("SELECT * FROM enrollment_periods WHERE class_id=$1", [
        classId,
      ])
    ).rows;
    for (const en of enrollments) {
      const studentPeriods = periods.filter(
        (p) => p.student_id === en.student_id,
      );
      const studentId = en.student_id;
      let run = [];
      for (const lesson of sessions) {
        const lessonDate = dateText(lesson.session_date);
        if (
          !(studentPeriods.length
            ? studentPeriods.some(
                (p) =>
                  lessonDate >= dateText(p.starts_on) &&
                  (!p.ends_on || lessonDate < dateText(p.ends_on)),
              )
            : eligible(en, lessonDate))
        )
          continue;
        const m = rows.find(
          (r) =>
            r.student_id === studentId &&
            dateText(r.attendance_date) === dateText(lesson.session_date) &&
            r.session_key === lesson.session_key,
        );
        if (m?.status === "Vắng") run.push(m);
        else run = [];
      }
      const episode =
        run.length >= 2
          ? `${dateText(run[0].attendance_date)}/${run[0].session_key}`
          : null;
      await c.query(
        "UPDATE parent_tasks SET status='superseded',resolved_at=now(),note=note || ' [Chuyên cần đã cập nhật]' WHERE student_id=$1 AND class_id=$2 AND status='open' AND episode<>$3",
        [studentId, classId, episode || ""],
      );
      if (episode)
        await c.query(
          "INSERT INTO parent_tasks(id,student_id,class_id,episode) VALUES($1,$2,$3,$4) ON CONFLICT(student_id,class_id,episode) DO UPDATE SET status='open',resolved_at=NULL,resolved_by=NULL WHERE parent_tasks.status='superseded'",
          [`CALL-${randomUUID()}`, studentId, classId, episode],
        );
    }
  }
  const ops = {
    refreshTasks,
    async sessions(classId, date) {
      isDateMatch(date, date);
      const cls = (
        await db.query("SELECT * FROM classes WHERE id=$1", [classId])
      ).rows[0];
      if (!cls) throw invalid("Lớp không tồn tại.", 404);
      const list = (
        await db.query(
          "SELECT * FROM class_sessions WHERE class_id=$1 AND session_date=$2 ORDER BY session_key",
          [classId, date],
        )
      ).rows;
      return [
        {
          session_key: "default",
          label: "Buổi thường",
          ...list.find((x) => x.session_key === "default"),
        },
        ...list.filter((x) => x.session_key !== "default"),
      ];
    },
    async createSession(body, actor) {
      return write(async (c) => {
        isDateMatch(body.date, body.date);
        const slot = key(body.sessionKey);
        if (body.startsAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.startsAt))
          throw invalid("Giờ bắt đầu không hợp lệ.");
        if (!body.label?.trim() || !body.reason?.trim())
          throw invalid("Cần tên ca và lý do tạo buổi.");
        if (
          !(await c.query("SELECT id FROM classes WHERE id=$1", [body.classId]))
            .rows.length
        )
          throw invalid("Lớp không tồn tại.");
        await c.query(
          "INSERT INTO class_sessions(class_id,session_date,session_key,label,reason,created_by,starts_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            body.classId,
            body.date,
            slot,
            body.label.trim(),
            body.reason.trim(),
            actor,
            body.startsAt || "00:00",
          ],
        );
        await audit(c, actor, "session.create", body.classId, null, body);
        return { success: true };
      });
    },
    async attendanceList(classId, date = todayVN(), slot = "default") {
      slot = key(slot);
      await session(db, classId, date, slot);
      const rows = (
        await db.query(
          `SELECT s.id,s.name,s.profile,e.status AS enrollment_status,e.starts_on,e.ends_on,a.status AS mark,a.note,a.version
    FROM enrollments e JOIN students s ON s.id=e.student_id LEFT JOIN attendance a ON a.student_id=e.student_id AND a.class_id=e.class_id AND a.attendance_date=$2 AND a.session_key=$3
    WHERE e.class_id=$1 ORDER BY s.name,s.id`,
          [classId, date, slot],
        )
      ).rows;
      const makeups = (
        await db.query(
          `SELECT m.*,s.name FROM makeup_lessons m JOIN students s ON s.id=m.student_id WHERE m.target_class=$1 AND m.target_date=$2 AND m.target_session=$3`,
          [classId, date, slot],
        )
      ).rows;
      for (const m of makeups)
        if (!rows.some((r) => r.id === m.student_id)) {
          const a =
            (
              await db.query(
                "SELECT status AS mark,note,version FROM attendance WHERE student_id=$1 AND class_id=$2 AND attendance_date=$3 AND session_key=$4",
                [m.student_id, classId, date, slot],
              )
            ).rows[0] || {};
          rows.push({
            id: m.student_id,
            name: m.name,
            profile: {},
            enrollment_status: "active",
            ...a,
          });
        }
      const periods = (
        await db.query("SELECT * FROM enrollment_periods WHERE class_id=$1", [
          classId,
        ])
      ).rows;
      return rows.map((s) => ({
        id: s.id,
        name: s.name,
        school: s.profile.school || "",
        status: s.mark === "Chưa điểm danh" ? null : s.mark || null,
        note: s.note || "",
        version: s.version || 0,
        isTransferred:
          !(periods.some((p) => p.student_id === s.id)
            ? periods.some(
                (p) =>
                  p.student_id === s.id &&
                  date >= dateText(p.starts_on) &&
                  (!p.ends_on || date < dateText(p.ends_on)),
              )
            : eligible(
                {
                  status: s.enrollment_status,
                  starts_on: s.starts_on,
                  ends_on: s.ends_on,
                },
                date,
              )) && !makeups.some((m) => m.student_id === s.id),
        isMakeup: makeups.some((m) => m.student_id === s.id),
      }));
    },
    async saveAttendance(body, actor) {
      return write(async (c) => {
        const slot = key(body.sessionKey);
        await session(c, body.classId, body.date, slot);
        if (body.date > todayVN())
          throw invalid("Không lưu điểm danh cho ngày tương lai.");
        return idempotent(
          c,
          body.requestId,
          { kind: "attendance", actor, ...body },
          async () => {
            if (
              !Array.isArray(body.records) ||
              !body.records.length ||
              body.records.length > 500
            )
              throw invalid("Danh sách điểm danh không hợp lệ.");
            const seen = new Set(),
              versions = {};
            for (const r of body.records) {
              if (!r.id || seen.has(r.id))
                throw invalid("Mã học sinh thiếu hoặc trùng.");
              seen.add(r.id);
              const status = r.status || "Chưa điểm danh";
              if (!statuses.includes(status))
                throw invalid("Trạng thái điểm danh không hợp lệ.");
              if (!Number.isInteger(r.version) || r.version < 0)
                throw invalid("Thiếu phiên bản. Tải lại danh sách.");
              if (String(r.note || "").length > 2000)
                throw invalid("Ghi chú quá dài.");
              const en = (
                await c.query(
                  "SELECT * FROM enrollments WHERE student_id=$1 AND class_id=$2",
                  [r.id, body.classId],
                )
              ).rows[0];
              const makeup = (
                await c.query(
                  "SELECT id FROM makeup_lessons WHERE student_id=$1 AND target_class=$2 AND target_date=$3 AND target_session=$4",
                  [r.id, body.classId, body.date, slot],
                )
              ).rows[0];
              if (!en || (!(await enrolledOn(c, en, body.date)) && !makeup))
                throw invalid("Học sinh không thuộc lớp trong ngày này.");
              const old = (
                await c.query(
                  "SELECT * FROM attendance WHERE student_id=$1 AND class_id=$2 AND attendance_date=$3 AND session_key=$4",
                  [r.id, body.classId, body.date, slot],
                )
              ).rows[0];
              if (Number(old?.version || 0) !== r.version)
                throw invalid(
                  `Điểm danh của ${r.id} đã đổi. Giữ bản nháp và tải lại để đối chiếu.`,
                  409,
                );
              await c.query(
                `INSERT INTO attendance(student_id,class_id,attendance_date,session_key,status,note) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(student_id,class_id,attendance_date,session_key) DO UPDATE SET status=EXCLUDED.status,note=EXCLUDED.note,version=attendance.version+1,updated_at=now()`,
                [r.id, body.classId, body.date, slot, status, r.note || ""],
              );
              versions[r.id] = r.version + 1;
              await audit(
                c,
                actor,
                "attendance.save",
                JSON.stringify([body.classId, r.id, body.date, slot]),
                old || null,
                {
                  ...r,
                  status,
                  classId: body.classId,
                  date: body.date,
                  sessionKey: slot,
                  reason: body.reason || "",
                },
              );
            }
            await refreshTasks(c, body.classId);
            return {
              success: true,
              versions,
              savedAt: new Date().toISOString(),
            };
          },
        );
      });
    },
    async attendanceHistory(classId, date, slot = "default") {
      isDateMatch(date, date);
      return (
        await db.query(
          "SELECT actor,entity,before_data,after_data,created_at FROM audit_log WHERE action='attendance.save' AND after_data->>'classId'=$1 AND after_data->>'date'=$2 AND after_data->>'sessionKey'=$3 ORDER BY id DESC LIMIT 500",
          [classId, date, key(slot)],
        )
      ).rows;
    },
    async attendanceReport(classId) {
      return (
        await db.query(
          "SELECT s.name,a.* FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.class_id=$1 ORDER BY attendance_date,session_key,s.name",
          [classId],
        )
      ).rows;
    },
    async tasks() {
      return (
        await db.query(
          "SELECT t.*,s.name,s.profile FROM parent_tasks t JOIN students s ON s.id=t.student_id ORDER BY t.created_at DESC",
        )
      ).rows;
    },
    async resolveTask(id, body, actor) {
      return write(async (c) => {
        if (!body.note?.trim()) throw invalid("Nhập kết quả liên hệ.");
        const old = (
          await c.query("SELECT * FROM parent_tasks WHERE id=$1", [id])
        ).rows[0];
        if (!old) throw invalid("Không tìm thấy công việc.", 404);
        await c.query(
          "UPDATE parent_tasks SET status='done',note=$2,resolved_by=$3,resolved_at=now() WHERE id=$1",
          [id, body.note, actor],
        );
        await audit(c, actor, "task.resolve", id, old, body);
        return { success: true };
      });
    },
    async makeups() {
      return (
        await db.query(
          "SELECT m.*,s.name FROM makeup_lessons m JOIN students s ON s.id=m.student_id ORDER BY target_date DESC",
        )
      ).rows;
    },
    async createMakeup(body, actor) {
      return write(async (c) => {
        const source = key(body.sourceSession),
          target = key(body.targetSession);
        await session(c, body.targetClass, body.targetDate, target);
        isDateMatch(body.sourceDate, body.sourceDate);
        const absent = (
          await c.query(
            "SELECT * FROM attendance WHERE student_id=$1 AND class_id=$2 AND attendance_date=$3 AND session_key=$4 AND status IN ('Vắng','Vắng có phép')",
            [body.studentId, body.sourceClass, body.sourceDate, source],
          )
        ).rows[0];
        if (!absent) throw invalid("Chọn một buổi vắng đã ghi nhận.");
        if (body.targetDate < body.sourceDate)
          throw invalid("Buổi học bù phải từ ngày vắng trở đi.");
        await c.query(
          "INSERT INTO enrollments(student_id,class_id,status,details) VALUES($1,$2,'transferred',$3) ON CONFLICT DO NOTHING",
          [
            body.studentId,
            body.targetClass,
            JSON.stringify({ makeupOnly: true }),
          ],
        );
        const id = `BU-${randomUUID()}`;
        await c.query(
          "INSERT INTO makeup_lessons(id,student_id,source_class,source_date,source_session,target_class,target_date,target_session,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            id,
            body.studentId,
            body.sourceClass,
            body.sourceDate,
            source,
            body.targetClass,
            body.targetDate,
            target,
            body.note || "",
            actor,
          ],
        );
        await audit(c, actor, "makeup.create", id, null, body);
        return { success: true, id };
      });
    },
    async setEnrollment(body, actor) {
      return write(async (c) => {
        isDateMatch(body.startsOn, body.startsOn);
        if (body.endsOn) {
          isDateMatch(body.endsOn, body.endsOn);
          if (body.endsOn <= body.startsOn)
            throw invalid("Ngày kết thúc phải sau ngày bắt đầu.");
        }
        const old = (
          await c.query(
            "SELECT * FROM enrollments WHERE student_id=$1 AND class_id=$2",
            [body.studentId, body.classId],
          )
        ).rows[0];
        await c.query(
          `INSERT INTO enrollments(student_id,class_id,status,starts_on,ends_on) VALUES($1,$2,$3,$4,$5) ON CONFLICT(student_id,class_id) DO UPDATE SET status=EXCLUDED.status,starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on,version=enrollments.version+1`,
          [
            body.studentId,
            body.classId,
            body.endsOn ? "transferred" : "active",
            body.startsOn,
            body.endsOn || null,
          ],
        );
        const overlaps = (
          await c.query(
            "SELECT 1 FROM enrollment_periods WHERE student_id=$1 AND class_id=$2 AND starts_on<>$3 AND (ends_on IS NULL OR ends_on>$3) AND ($4::date IS NULL OR starts_on<$4)",
            [body.studentId, body.classId, body.startsOn, body.endsOn || null],
          )
        ).rows;
        if (overlaps.length)
          throw invalid(
            "Khoảng đăng ký bị trùng. Kết thúc khoảng cũ trước khi đăng ký lại.",
          );
        await c.query(
          "INSERT INTO enrollment_periods(student_id,class_id,starts_on,ends_on) VALUES($1,$2,$3,$4) ON CONFLICT(student_id,class_id,starts_on) DO UPDATE SET ends_on=EXCLUDED.ends_on",
          [body.studentId, body.classId, body.startsOn, body.endsOn || null],
        );
        if (body.targetClass) {
          if (!body.endsOn || body.targetClass === body.classId)
            throw invalid("Chuyển lớp cần ngày kết thúc và lớp đích khác.");
          const existing = (
            await c.query(
              "SELECT 1 FROM enrollments WHERE student_id=$1 AND class_id=$2",
              [body.studentId, body.targetClass],
            )
          ).rows[0];
          if (existing)
            throw invalid(
              "Đã có đăng ký ở lớp đích. Đối chiếu ngày hiệu lực trước khi chuyển.",
            );
          await c.query(
            "INSERT INTO enrollments(student_id,class_id,starts_on) VALUES($1,$2,$3)",
            [body.studentId, body.targetClass, body.endsOn],
          );
          await c.query(
            "INSERT INTO enrollment_periods(student_id,class_id,starts_on) VALUES($1,$2,$3)",
            [body.studentId, body.targetClass, body.endsOn],
          );
          await audit(c, actor, "enrollment.transfer", body.studentId, old, {
            ...body,
          });
        }
        await refreshTasks(c, body.classId);
        await audit(
          c,
          actor,
          "enrollment.update",
          `${body.studentId}/${body.classId}`,
          old || null,
          body,
        );
        return { success: true };
      });
    },
    async setSchedule(classId, body, actor) {
      return write(async (c) => {
        if (
          !Array.isArray(body.weekdays) ||
          body.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
          !body.weekdays.length
        )
          throw invalid("Chọn ít nhất một thứ học.");
        const old = (
          await c.query("SELECT * FROM classes WHERE id=$1", [classId])
        ).rows[0];
        if (!old) throw invalid("Lớp không tồn tại.", 404);
        const profile = {
          ...old.profile,
          weekdays: [...new Set(body.weekdays)],
          schedule: body.weekdays
            .map((d) => (d === 0 ? "CN" : `T${d + 1}`))
            .join(", "),
        };
        await c.query(
          "UPDATE classes SET profile=$2,version=version+1 WHERE id=$1",
          [classId, JSON.stringify(profile)],
        );
        await audit(c, actor, "class.schedule", classId, old.profile, profile);
        return { success: true };
      });
    },
    async createPending(body, actor) {
      return write(async (c) => {
        if (!body.studentName?.trim() || !body.classId || !body.requestId)
          throw invalid("Thiếu tên, lớp hoặc mã yêu cầu.");
        await session(c, body.classId, body.date, key(body.sessionKey));
        return idempotent(
          c,
          body.requestId,
          { kind: "pending", actor, ...body },
          async () => {
            const existing = (
              await c.query(
                "SELECT id FROM pending_students WHERE status='Chờ duyệt' AND data->>'classId'=$1 AND data->>'date'=$2 AND lower(data->>'name')=lower($3) AND COALESCE(data->>'sessionKey','default')=$4",
                [
                  body.classId,
                  body.date,
                  body.studentName.trim(),
                  key(body.sessionKey),
                ],
              )
            ).rows[0];
            if (existing)
              return { success: true, id: existing.id, duplicate: true };
            const id = `PD-${randomUUID()}`;
            await c.query(
              "INSERT INTO pending_students(id,data,created_by) VALUES($1,$2,$3)",
              [
                id,
                JSON.stringify({
                  name: body.studentName.trim(),
                  class: body.className,
                  classId: body.classId,
                  date: body.date,
                  sessionKey: key(body.sessionKey),
                  note: body.note || "",
                }),
                actor,
              ],
            );
            await audit(c, actor, "pending.create", id, null, body);
            return { success: true, id };
          },
        );
      });
    },
    async enrollPending(id, body, actor) {
      return write(async (c) => {
        const old = (
          await c.query("SELECT * FROM pending_students WHERE id=$1", [id])
        ).rows[0];
        if (!old) throw invalid("Không tìm thấy báo cáo.", 404);
        if (old.status === "Đã xử lý") return { success: true };
        const classId = body.classId || old.data.classId;
        if (!classId) throw invalid("Chọn lớp cho báo cáo cũ.");
        let studentId = body.studentId;
        if (!studentId) {
          studentId = `HS-${randomUUID()}`;
          await c.query(
            "INSERT INTO students(id,name,profile) VALUES($1,$2,$3)",
            [
              studentId,
              old.data.name,
              JSON.stringify({ notes: old.data.note, status: "Đang học" }),
            ],
          );
        } else if (
          !(await c.query("SELECT id FROM students WHERE id=$1", [studentId]))
            .rows.length
        )
          throw invalid("Mã học sinh không tồn tại.");
        await c.query(
          "INSERT INTO enrollments(student_id,class_id,starts_on) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [studentId, classId, old.data.date],
        );
        if (body.attendanceStatus) {
          if (!statuses.includes(body.attendanceStatus))
            throw invalid("Trạng thái không hợp lệ.");
          const date = old.data.date,
            slot = key(old.data.sessionKey);
          await session(c, classId, date, slot);
          if (date > todayVN())
            throw invalid("Không điểm danh ngày tương lai.");
          const en = (
            await c.query(
              "SELECT * FROM enrollments WHERE student_id=$1 AND class_id=$2",
              [studentId, classId],
            )
          ).rows[0];
          if (!(await enrolledOn(c, en, date)))
            throw invalid(
              "Học sinh ngoài thời gian đăng ký; cần điều chỉnh ngày hiệu lực trước.",
            );
          const marked = (
            await c.query(
              "SELECT 1 FROM attendance WHERE student_id=$1 AND class_id=$2 AND attendance_date=$3 AND session_key=$4",
              [studentId, classId, date, slot],
            )
          ).rows[0];
          if (marked)
            throw invalid(
              "Học sinh đã có điểm danh. Đối chiếu trên trang Điểm danh trước.",
              409,
            );
          await c.query(
            "INSERT INTO attendance(student_id,class_id,attendance_date,session_key,status,note) VALUES($1,$2,$3,$4,$5,$6)",
            [
              studentId,
              classId,
              date,
              slot,
              body.attendanceStatus,
              body.attendanceNote || "",
            ],
          );
          await audit(
            c,
            actor,
            "attendance.save",
            JSON.stringify([classId, studentId, date, slot]),
            null,
            {
              id: studentId,
              classId,
              date,
              sessionKey: slot,
              status: body.attendanceStatus,
              note: body.attendanceNote || "",
              reason: "Xử lý học sinh phát sinh",
            },
          );
          await refreshTasks(c, classId);
        }
        await c.query(
          "UPDATE pending_students SET status='Đã xử lý',processed_by=$2,processed_at=now() WHERE id=$1",
          [id, actor],
        );
        await audit(c, actor, "pending.enroll", id, old, {
          studentId,
          classId,
        });
        return { success: true, studentId };
      });
    },
    async studentDetail(id) {
      const student = (await service.students()).find((s) => s.id === id);
      if (!student) throw invalid("Không tìm thấy học sinh.", 404);
      return {
        student,
        enrollments: (
          await db.query("SELECT * FROM enrollments WHERE student_id=$1", [id])
        ).rows,
        results: (
          await db.query(
            "SELECT * FROM student_results WHERE student_id=$1 ORDER BY test_date DESC",
            [id],
          )
        ).rows,
        periods: (
          await db.query(
            "SELECT * FROM enrollment_periods WHERE student_id=$1 ORDER BY class_id,starts_on",
            [id],
          )
        ).rows,
        family:
          (
            await db.query(
              "SELECT f.* FROM families f JOIN students s ON s.family_id=f.id WHERE s.id=$1",
              [id],
            )
          ).rows[0] || null,
      };
    },
    async setFamily(body, actor) {
      return write(async (c) => {
        if (
          !body.name?.trim() ||
          !Array.isArray(body.studentIds) ||
          body.studentIds.length < 1 ||
          !Number.isFinite(Number(body.discountPercent || 0)) ||
          Number(body.discountPercent || 0) < 0 ||
          Number(body.discountPercent || 0) > 100
        )
          throw invalid("Nhập tên gia đình và học sinh.");
        const id = body.id || `FAM-${randomUUID()}`;
        await c.query(
          "INSERT INTO families(id,name,discount_percent) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,discount_percent=EXCLUDED.discount_percent",
          [id, body.name, Number(body.discountPercent || 0)],
        );
        for (const sid of body.studentIds) {
          const old = (
            await c.query("SELECT * FROM students WHERE id=$1", [sid])
          ).rows[0];
          if (!old) throw invalid("Mã học sinh không tồn tại.");
          await c.query("UPDATE students SET family_id=$2 WHERE id=$1", [
            sid,
            id,
          ]);
          await audit(
            c,
            actor,
            "family.assign",
            sid,
            { familyId: old.family_id },
            { familyId: id },
          );
        }
        return { success: true, id };
      });
    },
    async feeQuote(studentId, classId) {
      const row = (
        await db.query(
          `SELECT c.profile,f.discount_percent,(SELECT count(*) FROM students x WHERE x.family_id=s.family_id) AS siblings FROM enrollments e JOIN students s ON s.id=e.student_id JOIN classes c ON c.id=e.class_id LEFT JOIN families f ON f.id=s.family_id WHERE e.student_id=$1 AND e.class_id=$2`,
          [studentId, classId],
        )
      ).rows[0];
      if (!row) throw invalid("Học sinh chưa đăng ký lớp.");
      const base = Number(
        String(row.profile.tuition || 0).replace(/[.,\sđ₫]/g, ""),
      );
      if (!Number.isSafeInteger(base) || base <= 0)
        throw invalid("Lớp chưa có mức học phí hợp lệ.");
      const percent =
        Number(row.siblings) >= 2 ? Number(row.discount_percent || 0) : 0;
      return {
        base,
        discountPercent: percent,
        discount: Math.round((base * percent) / 100),
        amount: base - Math.round((base * percent) / 100),
      };
    },
    async saveResult(body, actor) {
      return write(async (c) => {
        isDateMatch(body.date, body.date);
        if (
          !body.title?.trim() ||
          !Number.isFinite(Number(body.score)) ||
          !Number.isFinite(Number(body.maximum)) ||
          Number(body.maximum) <= 0 ||
          Number(body.score) < 0 ||
          Number(body.score) > Number(body.maximum)
        )
          throw invalid("Điểm kiểm tra không hợp lệ.");
        if (
          !(
            await c.query(
              "SELECT 1 FROM enrollments WHERE student_id=$1 AND class_id=$2",
              [body.studentId, body.classId],
            )
          ).rows.length
        )
          throw invalid("Học sinh chưa đăng ký lớp.");
        const id = `KQ-${randomUUID()}`;
        await c.query(
          "INSERT INTO student_results(id,student_id,class_id,title,test_date,score,maximum,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            id,
            body.studentId,
            body.classId,
            body.title,
            body.date,
            body.score,
            body.maximum,
            actor,
          ],
        );
        await audit(c, actor, "result.create", id, null, body);
        return { success: true, id };
      });
    },
  };
  return ops;
}
