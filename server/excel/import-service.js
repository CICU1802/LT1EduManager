import { createHash, randomUUID } from "node:crypto";
import {
  analyzeWorkbook,
  normalize,
  openWorkbook,
  patchWorkbook,
  appendDetailSheet,
  colLetter,
  isoDate,
} from "./workbook.js";
import { audit, dateText, todayVN } from "../db/service.js";
import { invalid, isDateMatch } from "../integrity.js";
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function createImportService(service) {
  const db = service?.db;
  async function decorate(analysis, client) {
    const revision = client
      ? Number(
          (await client.query("SELECT revision FROM system_state WHERE id=1"))
            .rows[0].revision,
        )
      : null;
    const students = client ? await service.students(client) : [],
      balances = client ? await service.balances(client) : [];
    const classes = client ? await service.classes(client) : [];
    for (const sheet of analysis.sheets) {
      const matches = classes.filter(
        (c) =>
          c.academicYear === analysis.academicYear &&
          (c.kind === sheet.kind || c.kind === "manual") &&
          (normalize(c.name) === normalize(sheet.name) ||
            normalize(c.id) === normalize(sheet.name)),
      );
      if (matches.length === 1) {
        sheet.classKey = matches[0].id;
        for (const item of analysis.items)
          if (item.sheet === sheet.name && item.kind !== "archive")
            item.classKey = sheet.classKey;
      }
    }
    const marks = client
      ? (
          await client.query(
            "SELECT * FROM attendance WHERE session_key='default'",
          )
        ).rows
      : [];
    const byName = new Map();
    for (const student of students) {
      const key = normalize(student.name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(student);
    }
    const byId = new Map(students.map((s) => [s.id, s])),
      byBalance = new Map(
        balances.map((b) => [`${b.class_id}/${b.student_id}`, b]),
      );
    const byMark = new Map(
      marks.map((m) => [
        `${m.class_id}/${m.student_id}/${dateText(m.attendance_date)}`,
        m,
      ]),
    );
    const counts = {
      ready: 0,
      review: 0,
      invalid: 0,
      unchanged: 0,
      archive: 0,
    };
    for (const item of analysis.items) {
      if (item.kind === "archive") {
        item.classification = "archive";
        counts.archive++;
        continue;
      }
      let match = item.student.id ? byId.get(item.student.id) : null;
      const candidates = byName.get(normalize(item.student.name)) || [];
      item.candidates = candidates.map((s) => ({
        id: s.id,
        name: s.name,
        school: s.school || "",
        phone: s.phone || "",
      }));
      if (!item.student.id) {
        const strong = candidates.filter(
          (s) =>
            (item.student.phone &&
              [s.phone, s.parentPhone].some(
                (p) => p && normalize(item.student.phone) === normalize(p),
              )) ||
            (item.student.school &&
              s.school &&
              normalize(item.student.school) === normalize(s.school)),
        );
        if (strong.length === 1) match = strong[0];
      }
      if (match && normalize(match.name) !== normalize(item.student.name))
        item.issues.push(
          "Mã học sinh đã có nhưng tên không khớp. Cần sửa file hoặc đối chiếu mã.",
        );
      item.matchId = match?.id || null;
      item.currentPaid = null;
      item.changes = [];
      if (item.student.id && !match && candidates.length)
        item.changes.push("Mã mới nhưng có người cùng tên trong hệ thống.");
      if (match) {
        const balance = byBalance.get(`${item.classKey}/${match.id}`);
        item.currentPaid = balance?.paid ?? null;
        if (item.kind === "balance" && balance && balance.paid !== item.paid)
          item.changes.push(`Thực đóng: ${balance.paid} → ${item.paid}`);
        if (
          item.kind === "balance" &&
          balance &&
          item.paid < Number(balance.new_paid)
        )
          item.issues.push(
            "Số tiền trong file nhỏ hơn các hóa đơn đã ghi nhận. Cần đối soát.",
          );
        if (
          balance &&
          balance.status !== (item.transferred ? "transferred" : "active")
        )
          item.changes.push("Thay đổi trạng thái đăng ký lớp.");
        for (const mark of item.marks) {
          const old = byMark.get(`${item.classKey}/${match.id}/${mark.date}`);
          if (
            old &&
            (old.status !== mark.status ||
              (mark.note && old.note !== mark.note))
          )
            item.changes.push(
              `Điểm danh ${mark.date}: ${old.status}${old.note ? " (" + old.note + ")" : ""} → ${mark.status}${mark.note ? " (" + mark.note + ")" : ""}`,
            );
        }
        const profileChanged = ["phone", "school"].some(
          (k) => item.student[k] && item.student[k] !== match[k],
        );
        item.classification = item.issues.length
          ? "invalid"
          : item.changes.length
            ? "review"
            : balance &&
                item.marks.every((m) =>
                  byMark.has(`${item.classKey}/${match.id}/${m.date}`),
                ) &&
                (!item.kind.startsWith("balance") ||
                  (balance.paid === item.paid && balance.due === item.due)) &&
                !profileChanged
              ? "unchanged"
              : "ready";
      } else
        item.classification = item.issues.length
          ? "invalid"
          : item.student.id && item.candidates.length === 0
            ? "ready"
            : "review";
      item.destination =
        item.kind === "balance"
          ? "Hồ sơ / đăng ký lớp / số dư học phí"
          : "Hồ sơ / đăng ký lớp / điểm danh";
      counts[item.classification]++;
    }
    return {
      ...analysis,
      revision,
      counts,
      snapshotDate: analysis.snapshotDate || todayVN(),
    };
  }
  return {
    async preview(
      buffer,
      { filename, academicYear, snapshotDate = todayVN() },
      actor,
    ) {
      isDateMatch(snapshotDate, snapshotDate);
      if (snapshotDate > todayVN())
        throw invalid("Ngày chốt file không được nằm trong tương lai.");
      const analysis = analyzeWorkbook(buffer, {
        academicYear,
        today: snapshotDate,
      });
      analysis.snapshotDate = snapshotDate;
      if (!db)
        return {
          id: null,
          state: "analysis-only",
          ...(await decorate(analysis, null)),
          canCommit: false,
        };
      return db.transaction(async (c) => {
        await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        const digest = createHash("sha256")
          .update(buffer)
          .update(academicYear)
          .update(snapshotDate)
          .digest("hex");
        const old = (
          await c.query(
            "SELECT id,state,analysis FROM import_documents WHERE digest=$1",
            [digest],
          )
        ).rows[0];
        if (old?.state === "committed")
          return {
            id: old.id,
            state: old.state,
            ...old.analysis,
            canCommit: false,
            alreadyImported: true,
          };
        const decorated = await decorate(analysis, c),
          id = old?.id || `IMP-${randomUUID()}`;
        const saved = await c.query(
          `INSERT INTO import_documents(id,digest,filename,academic_year,workbook,analysis,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(digest) DO UPDATE SET analysis=EXCLUDED.analysis RETURNING id`,
          [
            id,
            digest,
            filename,
            academicYear,
            buffer,
            JSON.stringify(decorated),
            actor,
          ],
        );
        return {
          id: saved.rows[0].id,
          state: "preview",
          ...decorated,
          canCommit: true,
        };
      });
    },
    async commit(id, { revision, decisions }, actor) {
      if (!db) throw invalid("Chưa kết nối PostgreSQL.", 503);
      if (!Array.isArray(decisions) || decisions.length > 15000)
        throw invalid("Danh sách xác nhận không hợp lệ.");
      return service.write(async (c) => {
        const doc = (
          await c.query(
            "SELECT * FROM import_documents WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!doc) throw invalid("Không tìm thấy phiên nhập.", 404);
        if (doc.state === "committed")
          return { success: true, alreadyImported: true, id };
        const current = Number(
          (await c.query("SELECT revision FROM system_state WHERE id=1"))
            .rows[0].revision,
        );
        if (
          Number(revision) !== current ||
          Number(doc.analysis.revision) !== current
        )
          throw invalid(
            "Dữ liệu đã thay đổi sau khi phân tích. Tải file và đối chiếu lại.",
            409,
          );
        const analysis = doc.analysis,
          byKey = new Map(analysis.items.map((i) => [i.key, i])),
          seen = new Set(),
          newIds = new Map(),
          targets = new Set();
        const selected = [];
        for (const decision of decisions) {
          const item = byKey.get(decision.key);
          if (!item || seen.has(decision.key))
            throw invalid("Dòng nhập không tồn tại hoặc bị trùng.");
          seen.add(decision.key);
          if (decision.action === "skip") continue;
          if (decision.action !== "apply")
            throw invalid("Thao tác xác nhận không hợp lệ.");
          if (item.kind !== "archive" && item.issues.length)
            throw invalid(
              `Tab ${item.sheet}, hàng ${item.row} còn lỗi cần sửa.`,
            );
          if (item.kind === "archive") {
            selected.push({ item });
            continue;
          }
          let studentId = String(
            decision.studentId || item.matchId || item.student.id || "",
          );
          if (decision.createNew) {
            studentId = item.student.id || `HS-${randomUUID()}`;
            newIds.set(item.key, studentId);
          }
          if (!studentId)
            throw invalid(
              `Tab ${item.sheet}, hàng ${item.row} cần chọn mã học sinh hoặc tạo hồ sơ.`,
            );
          selected.push({ item, decision, studentId });
        }
        if (!selected.length) throw invalid("Chưa chọn dữ liệu để nhập.");
        for (const entry of selected) {
          if (entry.studentId?.startsWith("new:")) {
            const linked = newIds.get(entry.studentId.slice(4));
            if (!linked)
              throw invalid("Hồ sơ mới được ghép chưa được chọn tạo.");
            entry.studentId = linked;
          }
        }
        const initialStudentIds = new Set(
          (await c.query("SELECT id FROM students")).rows.map((s) => s.id),
        );
        // All new identities are created before enrollment/attendance writes, allowing explicit cross-tab linking.
        for (const { item, decision, studentId } of selected) {
          if (item.kind === "archive") continue;
          const old = (
            await c.query("SELECT * FROM students WHERE id=$1", [studentId])
          ).rows[0];
          if (
            !old &&
            !decision.createNew &&
            item.student.id !== studentId &&
            !newIds.has(decision.studentId?.slice(4))
          )
            throw invalid("Mã học sinh được chọn không tồn tại.");
          if (
            old &&
            decision.createNew &&
            !item.matchId &&
            initialStudentIds.has(studentId)
          )
            throw invalid(
              "Mã hồ sơ mới đã tồn tại. Phân tích lại file trước khi nhập.",
              409,
            );
          if (
            old &&
            normalize(old.name) !== normalize(item.student.name) &&
            !decision.confirmIdentity
          )
            throw invalid(
              `Cần xác nhận ghép tên ${item.student.name} với mã ${studentId}.`,
            );
          const profile = { ...(old?.profile || {}) };
          if (item.student.school) profile.school = item.student.school;
          if (item.student.phone)
            profile.importedContactPhone = item.student.phone;
          if (!old) {
            await c.query(
              "INSERT INTO students(id,name,profile) VALUES($1,$2,$3)",
              [studentId, item.student.name, JSON.stringify(profile)],
            );
            await audit(
              c,
              actor,
              "import.student.create",
              studentId,
              null,
              { name: item.student.name, profile },
              id,
            );
          } else if (!equal(old.profile, profile)) {
            await c.query(
              "UPDATE students SET profile=$2,version=version+1,updated_at=now() WHERE id=$1",
              [studentId, JSON.stringify(profile)],
            );
            await audit(
              c,
              actor,
              "import.student.update",
              studentId,
              old.profile,
              profile,
              id,
            );
          }
        }
        for (const { item, studentId } of selected) {
          if (item.kind === "archive") {
            await c.query(
              "INSERT INTO legacy_records(document_id,item_key,kind,data) VALUES($1,$2,$3,$4)",
              [
                id,
                item.key,
                item.archiveKind,
                JSON.stringify({ sheet: item.sheet, message: item.message }),
              ],
            );
            continue;
          }
          const identity = `${item.classKey}/${studentId}`;
          if (targets.has(identity))
            throw invalid(
              `Có hai hàng cùng học sinh/lớp ${item.sheet}. Kiểm tra trước khi nhập.`,
            );
          targets.add(identity);
          const sheet = analysis.sheets.find((s) => s.name === item.sheet);
          const classOld = (
            await c.query("SELECT * FROM classes WHERE id=$1", [item.classKey])
          ).rows[0];
          if (!classOld) {
            await c.query(
              "INSERT INTO classes(id,name,academic_year,course,kind,profile) VALUES($1,$2,$3,$4,$5,$6)",
              [
                item.classKey,
                item.sheet.trim(),
                analysis.academicYear,
                sheet.metadata.course,
                sheet.kind,
                JSON.stringify(sheet.metadata),
              ],
            );
            await audit(
              c,
              actor,
              "import.class.create",
              item.classKey,
              null,
              sheet.metadata,
              id,
            );
          } else if (!equal(classOld.profile, sheet.metadata)) {
            await c.query(
              "UPDATE classes SET profile=$2,version=version+1 WHERE id=$1",
              [item.classKey, JSON.stringify(sheet.metadata)],
            );
            await audit(
              c,
              actor,
              "import.class.update",
              item.classKey,
              classOld.profile,
              sheet.metadata,
              id,
            );
          }
          const old = (
            await c.query(
              "SELECT * FROM enrollments WHERE student_id=$1 AND class_id=$2",
              [studentId, item.classKey],
            )
          ).rows[0];
          await c.query(
            "INSERT INTO enrollments(student_id,class_id,status,details) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
            [
              studentId,
              item.classKey,
              item.transferred ? "transferred" : "active",
              JSON.stringify({
                notes: item.notes,
                address: item.address,
                sourcePhone: item.student.phone,
              }),
            ],
          );
          if (item.kind === "balance") {
            const ledger = Number(
              (
                await c.query(
                  "SELECT COALESCE(sum(amount),0) AS paid FROM invoices WHERE student_id=$1 AND class_id=$2 AND status='Đã nộp'",
                  [studentId, item.classKey],
                )
              ).rows[0].paid,
            );
            if (item.paid < ledger)
              throw invalid(
                "Số dư nhập thấp hơn hóa đơn đã ghi nhận. Cần đối soát.",
                409,
              );
            await c.query(
              "UPDATE enrollments SET base_paid=$3,base_due=$4,baseline_date=$5,status=$6,details=$7,version=version+1 WHERE student_id=$1 AND class_id=$2",
              [
                studentId,
                item.classKey,
                item.paid - ledger,
                item.due,
                analysis.snapshotDate,
                item.transferred ? "transferred" : "active",
                JSON.stringify({
                  notes: item.notes,
                  address: item.address,
                  collectionDate: item.collectionDate,
                  sourcePhone: item.student.phone,
                }),
              ],
            );
          } else
            await c.query(
              "UPDATE enrollments SET status=$3,version=version+1 WHERE student_id=$1 AND class_id=$2",
              [
                studentId,
                item.classKey,
                item.transferred ? "transferred" : "active",
              ],
            );
          if (item.marks.length) {
            const previous = (
              await c.query(
                "SELECT attendance_date,status,note FROM attendance WHERE student_id=$1 AND class_id=$2 AND session_key='default'",
                [studentId, item.classKey],
              )
            ).rows;
            const changed = item.marks
              .map((m) => {
                const before = previous.find(
                  (p) => dateText(p.attendance_date) === m.date,
                );
                // Legacy checkbox cells cannot express a separate note or an explicit deletion.
                return { ...m, note: m.note || before?.note || "" };
              })
              .filter((m) => {
                const before = previous.find(
                  (p) => dateText(p.attendance_date) === m.date,
                );
                return (
                  !before ||
                  before.status !== m.status ||
                  before.note !== m.note
                );
              });
            if (changed.length) {
              await c.query(
                `INSERT INTO attendance(student_id,class_id,attendance_date,status,note)
       SELECT $1,$2,mark.date::date,mark.status,mark.note FROM jsonb_to_recordset($3::jsonb) AS mark(date text,status text,note text)
       ON CONFLICT(student_id,class_id,attendance_date,session_key) DO UPDATE SET status=EXCLUDED.status,note=EXCLUDED.note,version=attendance.version+1,updated_at=now()`,
                [studentId, item.classKey, JSON.stringify(changed)],
              );
              await audit(
                c,
                actor,
                "import.attendance",
                identity,
                previous,
                changed,
                id,
              );
            }
          }
          await c.query(
            "INSERT INTO import_bindings(document_id,item_key,sheet_name,row_number,student_id,class_id,kind) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              id,
              item.key,
              item.sheet,
              item.row,
              studentId,
              item.classKey,
              item.kind,
            ],
          );
          await audit(
            c,
            actor,
            "import.enrollment",
            identity,
            old || null,
            {
              paid: item.paid,
              due: item.due,
              status: item.transferred ? "transferred" : "active",
            },
            id,
          );
        }
        await c.query(
          "UPDATE import_documents SET state='committed',committed_at=now() WHERE id=$1",
          [id],
        );
        for (const classId of new Set(
          selected
            .filter((x) => x.item.kind !== "archive")
            .map((x) => x.item.classKey),
        ))
          await service.refreshTasks(c, classId);
        await audit(
          c,
          actor,
          "import.commit",
          id,
          null,
          {
            applied: selected.length,
            skipped: analysis.items.length - selected.length,
          },
          id,
        );
        return {
          success: true,
          id,
          applied: selected.length,
          skipped: analysis.items.length - selected.length,
        };
      });
    },
    async inspect(id, actor) {
      if (!db) throw invalid("Chưa kết nối PostgreSQL.", 503);
      const doc = (
        await db.query("SELECT * FROM import_documents WHERE id=$1", [id])
      ).rows[0];
      if (!doc) throw invalid("Không tìm thấy phiên nhập.", 404);
      if (doc.state === "committed")
        return {
          id,
          state: doc.state,
          ...doc.analysis,
          canCommit: false,
          alreadyImported: true,
        };
      return this.preview(
        Buffer.from(doc.workbook),
        {
          filename: doc.filename,
          academicYear: doc.academic_year,
          snapshotDate: doc.analysis.snapshotDate,
        },
        actor,
      );
    },
    async history() {
      if (!db) return [];
      return (
        await db.query(
          `SELECT id,filename,academic_year,state,created_at,committed_at,created_by,analysis->'summary' AS summary FROM import_documents ORDER BY created_at DESC LIMIT 50`,
        )
      ).rows;
    },
    async export(id, actor) {
      if (!db) throw invalid("Chưa kết nối PostgreSQL.", 503);
      return db.transaction(async (c) => {
        await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        const doc = (
          await c.query(
            "SELECT * FROM import_documents WHERE id=$1 AND state='committed'",
            [id],
          )
        ).rows[0];
        if (!doc) throw invalid("Chỉ xuất từ file mẫu đã xác nhận nhập.", 404);
        const bindings = (
          await c.query("SELECT * FROM import_bindings WHERE document_id=$1", [
            id,
          ])
        ).rows;
        const students = new Map(
            (await service.students(c)).map((s) => [s.id, s]),
          ),
          balances = await service.balances(c),
          marks = (
            await c.query(
              "SELECT * FROM attendance WHERE session_key='default'",
            )
          ).rows;
        const byBalance = new Map(
            balances.map((b) => [`${b.class_id}/${b.student_id}`, b]),
          ),
          byMark = new Map(
            marks.map((m) => [
              `${m.class_id}/${m.student_id}/${dateText(m.attendance_date)}`,
              m,
            ]),
          );
        const extraMarks = (await c.query("SELECT * FROM attendance")).rows;
        const attendanceClasses = doc.analysis.sheets
          .filter((s) => s.kind === "attendance")
          .map((s) => s.classKey);
        const book = openWorkbook(Buffer.from(doc.workbook)),
          patches = {};
        let appended = 0;
        for (const sheet of doc.analysis.sheets) {
          if (!sheet.supported) continue;
          const rows = bindings.filter((b) => b.sheet_name === sheet.name),
            bound = new Set(rows.map((r) => r.student_id));
          if (!rows.length) continue;
          const extra = balances.filter(
            (b) => b.class_id === sheet.classKey && !bound.has(b.student_id),
          );
          const original = book.sheets.find((s) => s.name === sheet.name);
          // Never overwrite an unreviewed original roster. Only original blank rows may be used.
          for (const extraRow of extra) {
            const student = students.get(extraRow.student_id);
            const unmapped = doc.analysis.items.some(
              (i) =>
                i.sheet === sheet.name &&
                i.student &&
                normalize(i.student.name) === normalize(student.name) &&
                !bindings.some((b) => b.item_key === i.key),
            );
            if (unmapped)
              throw invalid(
                `Tab ${sheet.name} còn dòng chưa ghép của học sinh ${student.name}. Đối chiếu dòng gốc trước khi xuất.`,
                409,
              );
          }
          const blankRows = [...original.rows]
            .filter(
              ([r, cells]) =>
                r > sheet.headerRow + 1 &&
                !String(cells.get(sheet.columns.name)?.value || "").trim(),
            )
            .map(([r]) => r);
          if (extra.length > blankRows.length)
            throw invalid(
              `Tab ${sheet.name} thiếu ${extra.length - blankRows.length} hàng trống. Thêm hàng vào mẫu và nhập lại để xuất đầy đủ.`,
              409,
            );
          extra.forEach((b, i) => {
            rows.push({
              row_number: blankRows[i],
              student_id: b.student_id,
              class_id: b.class_id,
            });
            appended++;
          });
          const changes = (patches[sheet.name] = {});
          for (const row of rows) {
            const student = students.get(row.student_id),
              balance = byBalance.get(`${row.class_id}/${row.student_id}`);
            if (!student || !balance)
              throw invalid("Mẫu tham chiếu đến hồ sơ không tồn tại.", 409);
            const set = (key, value) => {
              if (sheet.columns[key])
                changes[`${colLetter(sheet.columns[key])}${row.row_number}`] =
                  value;
            };
            set("name", student.name);
            set("id", student.id);
            set("school", student.school || "");
            set(
              "phone",
              balance.details.sourcePhone ||
                student.phone ||
                student.parentPhone ||
                "",
            );
            if (sheet.kind === "tuition") {
              set("paid", balance.paid);
              set("due", balance.due);
              set("notes", balance.details.notes || "");
              set("address", balance.details.address || "");
              const last =
                dateText(balance.latest_date) || balance.details.collectionDate;
              if (last) {
                const ref = `${colLetter(sheet.columns.date)}${row.row_number}`;
                if (sheet.columns.date)
                  changes[ref] =
                    (Date.parse(last + "T00:00:00Z") -
                      Date.UTC(
                        book.date1904 ? 1904 : 1899,
                        book.date1904 ? 0 : 11,
                        book.date1904 ? 1 : 30,
                      )) /
                    86400000;
              }
            } else
              for (const { column, date } of sheet.dateColumns) {
                if (date > todayVN()) continue;
                const mark = byMark.get(
                  `${row.class_id}/${row.student_id}/${date}`,
                );
                changes[`${colLetter(column)}${row.row_number}`] = mark
                  ? mark.status === "Có mặt"
                    ? true
                    : mark.status === "Vắng"
                      ? false
                      : mark.status === "Đi trễ"
                        ? `Đi trễ${mark.note ? ": " + mark.note : ""}`
                        : mark.status === "Vắng có phép"
                          ? `Vắng có phép${mark.note ? ": " + mark.note : ""}`
                          : mark.status === "Chưa điểm danh"
                            ? null
                            : mark.note || "Khác"
                  : null;
              }
          }
        }
        let buffer = patchWorkbook(Buffer.from(doc.workbook), patches);
        const details = extraMarks.filter((m) =>
          attendanceClasses.includes(m.class_id),
        );
        if (details.length)
          buffer = appendDetailSheet(buffer, [
            [
              "Học sinh",
              "Định danh",
              "Lớp",
              "Ngày",
              "Ca",
              "Trạng thái",
              "Ghi chú",
            ],
            ...details.map((m) => [
              students.get(m.student_id)?.name || "",
              m.student_id,
              m.class_id,
              dateText(m.attendance_date),
              m.session_key,
              m.status,
              m.note,
            ]),
          ]);
        const skipped = doc.analysis.items.filter(
          (i) =>
            i.kind !== "archive" && !bindings.some((b) => b.item_key === i.key),
        ).length;
        await audit(
          c,
          actor,
          "excel.export",
          id,
          null,
          {
            managedRows: bindings.length,
            addedRows: appended,
            unmappedRows: skipped,
          },
          id,
        );
        return {
          buffer,
          filename: doc.filename.replace(/\.xlsx$/i, "") + "-doi-chieu.xlsx",
          unmappedRows: skipped,
          addedRows: appended,
        };
      });
    },
  };
}
