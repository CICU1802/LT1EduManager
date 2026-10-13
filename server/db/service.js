import {
  createAttendanceOperations,
  eligible,
} from "./attendance-operations.js";
import { randomUUID } from "node:crypto";
import { invalid, money, isDateMatch } from "../integrity.js";
import { normalize } from "../excel/workbook.js";
export const todayVN = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
    new Date(),
  );
export const dateText = (date) =>
  date instanceof Date
    ? date.toISOString().slice(0, 10)
    : String(date || "").slice(0, 10);
export async function audit(
  client,
  actor,
  action,
  entity,
  before,
  after,
  documentId = null,
) {
  await client.query(
    "INSERT INTO audit_log(actor,action,entity,before_data,after_data,document_id) VALUES($1,$2,$3,$4,$5,$6)",
    [
      actor,
      action,
      entity,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
      documentId,
    ],
  );
}
export function createDataService(db) {
  const write = (fn) =>
    db.transaction(async (client) => {
      await client.query(
        "SELECT revision FROM system_state WHERE id=1 FOR UPDATE",
      );
      const result = await fn(client);
      await client.query(
        "UPDATE system_state SET revision=revision+1 WHERE id=1",
      );
      return result;
    });
  async function students(client = db) {
    const result = await client.query(
      `SELECT s.*,COALESCE(string_agg(DISTINCT e.class_id, ', '),'') AS classes,
   (SELECT count(*)::int FROM attendance a WHERE a.student_id=s.id AND a.status IN ('Vắng','Vắng có phép')) AS absences
   FROM students s LEFT JOIN enrollments e ON e.student_id=s.id AND (CASE WHEN EXISTS(SELECT 1 FROM enrollment_periods p WHERE p.student_id=e.student_id AND p.class_id=e.class_id) THEN EXISTS(SELECT 1 FROM enrollment_periods p WHERE p.student_id=e.student_id AND p.class_id=e.class_id AND p.starts_on<=$1::date AND (p.ends_on IS NULL OR p.ends_on>$1::date)) ELSE (e.starts_on IS NULL OR e.starts_on<=$1::date) AND (e.ends_on IS NULL OR e.ends_on>$1::date) AND (e.status='active' OR e.ends_on IS NOT NULL) END) GROUP BY s.id ORDER BY s.name,s.id`,
      [todayVN()],
    );
    return result.rows.map((s) => ({
      ...s.profile,
      phone: s.profile.phone || s.profile.importedContactPhone || "",
      id: s.id,
      name: s.name,
      version: s.version,
      classes: s.classes,
      status: s.profile.status || "Đang học",
      absences: s.absences,
    }));
  }
  async function classes(client = db) {
    return (
      await client.query("SELECT * FROM classes ORDER BY name,id")
    ).rows.map((c) => ({
      ...c.profile,
      id: c.id,
      name: c.name,
      academicYear: c.academic_year,
      course: c.course,
      kind: c.kind,
    }));
  }
  async function invoices(client = db) {
    return (
      await client.query(
        "SELECT i.*,s.name FROM invoices i JOIN students s ON s.id=i.student_id ORDER BY i.created_at",
      )
    ).rows.map((i) => ({
      id: i.id,
      studentId: i.student_id,
      studentName: i.name,
      classId: i.class_id,
      period: i.period,
      amount: Number(i.amount),
      date: dateText(i.collection_date),
      status: i.status,
      method: i.method,
      requestId: i.request_id,
      createdBy: i.created_by,
      syncStatus: "Đã lưu CSDL",
      syncError: "",
    }));
  }
  async function enroll(client, studentId, classId) {
    const result = await client.query(
      "SELECT * FROM enrollments WHERE student_id=$1 AND class_id=$2 FOR UPDATE",
      [studentId, classId],
    );
    if (!result.rows.length) throw invalid("Học sinh chưa đăng ký lớp này.");
    return result.rows[0];
  }
  const service = {
    db,
    write,
    students,
    classes,
    invoices,
    async createStudent(body, actor) {
      return write(async (c) => {
        if (typeof body.name !== "string" || !body.name.trim())
          throw invalid("Thiếu tên học sinh.");
        const id = `HS-${randomUUID()}`;
        const { name, ...profile } = body;
        const classIds = String(body.classes || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        for (const classId of classIds)
          if (
            !(await c.query("SELECT id FROM classes WHERE id=$1", [classId]))
              .rows.length
          )
            throw invalid(
              `Lớp ${classId} chưa tồn tại. Chọn mã lớp trong danh mục.`,
            );
        await c.query(
          "INSERT INTO students(id,name,profile) VALUES($1,$2,$3)",
          [id, name.trim(), JSON.stringify(profile)],
        );
        for (const classId of classIds)
          await c.query(
            "INSERT INTO enrollments(student_id,class_id) VALUES($1,$2)",
            [id, classId],
          );
        await audit(c, actor, "student.create", id, null, { name, profile });
        return { success: true, student: { id, name, ...profile } };
      });
    },
    async createClass(body, actor) {
      return write(async (c) => {
        if (
          typeof body.id !== "string" ||
          !body.id.trim() ||
          typeof body.name !== "string" ||
          !body.name.trim() ||
          !/^\d{4}-\d{4}$/.test(body.academicYear || "") ||
          Number(body.academicYear.slice(5)) !==
            Number(body.academicYear.slice(0, 4)) + 1
        )
          throw invalid("Lớp cần mã, tên và năm học hợp lệ.");
        const id = body.id.startsWith(body.academicYear + ":")
          ? body.id
          : `${body.academicYear}:${body.id.trim()}`;
        await c.query(
          "INSERT INTO classes(id,name,academic_year,kind,profile) VALUES($1,$2,$3,'manual',$4)",
          [id, body.name.trim(), body.academicYear, JSON.stringify(body)],
        );
        await audit(c, actor, "class.create", id, null, body);
        return { success: true, id };
      });
    },
    async saveInvoice(body, actor) {
      return write(async (c) => {
        if (!body.requestId || String(body.requestId).length > 100)
          throw invalid("Thiếu mã yêu cầu thu học phí.");
        const existing = (
          await c.query("SELECT * FROM invoices WHERE request_id=$1", [
            body.requestId,
          ])
        ).rows[0];
        const amount = money(body.amount);
        if (!Number.isSafeInteger(amount) || amount <= 0)
          throw invalid("Số tiền phải là số nguyên dương.");
        isDateMatch(body.date, body.date);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period || ""))
          throw invalid("Kỳ học phí không hợp lệ.");
        if (!["Đã nộp", "Nợ"].includes(body.status))
          throw invalid("Trạng thái hóa đơn không hợp lệ.");
        if (existing) {
          if (
            existing.student_id !== body.studentId ||
            existing.class_id !== body.classId ||
            Number(existing.amount) !== amount ||
            existing.period !== body.period ||
            existing.status !== body.status ||
            dateText(existing.collection_date) !== body.date ||
            existing.method !== (body.method || "Tiền mặt")
          )
            throw invalid("Mã yêu cầu đã dùng cho hóa đơn khác.", 409);
          return {
            success: true,
            tuition: (await invoices(c)).find((i) => i.id === existing.id),
          };
        }
        const enrollment = await enroll(c, body.studentId, body.classId);
        const periods = (
          await c.query(
            "SELECT starts_on,ends_on FROM enrollment_periods WHERE student_id=$1 AND class_id=$2",
            [body.studentId, body.classId],
          )
        ).rows;
        const registered = periods.length
          ? periods.some(
              (p) =>
                body.date >= dateText(p.starts_on) &&
                (!p.ends_on || body.date < dateText(p.ends_on)),
            )
          : eligible(enrollment, body.date);
        if (!registered)
          throw invalid("Ngày thu nằm ngoài thời gian đăng ký lớp.");
        if (
          enrollment.baseline_date &&
          body.date < dateText(enrollment.baseline_date)
        )
          throw invalid(
            "Ngày thu nằm trong số dư đã nhập từ Excel. Cần đối soát thay vì cộng lại.",
            409,
          );
        const id = `HP-${randomUUID()}`;
        await c.query(
          "INSERT INTO invoices(id,request_id,student_id,class_id,period,amount,status,collection_date,method,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            id,
            body.requestId,
            body.studentId,
            body.classId,
            body.period,
            amount,
            body.status,
            body.date,
            body.method || "Tiền mặt",
            actor,
          ],
        );
        await c.query(
          "UPDATE enrollments SET version=version+1 WHERE student_id=$1 AND class_id=$2",
          [body.studentId, body.classId],
        );
        await audit(c, actor, "invoice.create", id, null, body);
        return {
          success: true,
          tuition: (await invoices(c)).find((i) => i.id === id),
        };
      });
    },
    async pending() {
      return (
        await db.query("SELECT * FROM pending_students ORDER BY created_at")
      ).rows.map((p) => ({
        ...p.data,
        id: p.id,
        status: p.status,
        reportedBy: p.created_by,
        processedBy: p.processed_by,
        processedAt: p.processed_at,
      }));
    },
    async resolvePending(id, actor) {
      return write(async (c) => {
        const old = (
          await c.query("SELECT * FROM pending_students WHERE id=$1", [id])
        ).rows[0];
        if (!old) throw invalid("Không tìm thấy báo cáo.", 404);
        if (old.status !== "Đã xử lý") {
          await c.query(
            "UPDATE pending_students SET status='Đã xử lý',processed_by=$2,processed_at=now() WHERE id=$1",
            [id, actor],
          );
          await audit(c, actor, "pending.resolve", id, old, {
            status: "Đã xử lý",
          });
        }
        return { success: true };
      });
    },
    async balances(client = db) {
      return (
        await client.query(
          `SELECT e.*, COALESCE(sum(i.amount) FILTER (WHERE i.status='Đã nộp'),0) AS new_paid,max(i.collection_date) FILTER (WHERE i.status='Đã nộp') AS latest_date FROM enrollments e LEFT JOIN invoices i ON i.student_id=e.student_id AND i.class_id=e.class_id GROUP BY e.student_id,e.class_id`,
        )
      ).rows.map((e) => ({
        ...e,
        paid: Number(e.base_paid) + Number(e.new_paid),
        due: e.base_due == null ? null : Number(e.base_due),
      }));
    },
    normalize,
  };
  return Object.assign(service, createAttendanceOperations(service));
}
