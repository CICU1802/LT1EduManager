import { createHash, randomUUID } from "node:crypto";
import { invalid, isDateMatch, resolveAttendanceRecords } from "./integrity.js";
import { scheduledDays } from "./db/attendance-operations.js";
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
    new Date(),
  );
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
export function createSheetsAttendance(getSheets, env) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  };
  async function context(classId, date) {
    isDateMatch(date, date);
    const sheets = await getSheets();
    const catalogue =
      (
        await sheets.spreadsheets.values.get({
          spreadsheetId: env.SPREADSHEET_ID,
          range: "DB_LopHoc!A2:F",
        })
      ).data.values || [];
    const cls = catalogue.find((r) => r[0] === classId);
    if (!cls) throw invalid("Lớp không tồn tại.");
    const days = scheduledDays({ schedule: cls[5] });
    if (cls[5] && !days.length)
      throw invalid("Lịch lớp chưa nhận diện được. Cần chuẩn hóa lịch.");
    if (
      days.length &&
      !days.includes(new Date(date + "T12:00:00Z").getUTCDay())
    )
      throw invalid("Ngày ngoài lịch học của lớp.");
    const mapping = JSON.parse(env.ATTENDANCE_SHEET_MAP_JSON || "{}")[classId];
    const spreadsheetId =
      mapping?.spreadsheetId ||
      (/10|11|12|ĐGNL/.test(classId.toUpperCase())
        ? env.SPREADSHEET_ID_ATTENDANCE_C3
        : env.SPREADSHEET_ID_ATTENDANCE_C2) ||
      env.SPREADSHEET_ID_ATTENDANCE ||
      env.SPREADSHEET_ID;
    const meta = (await sheets.spreadsheets.get({ spreadsheetId })).data;
    const sheet = meta.sheets.find(
      (s) => s.properties.title.trim() === (mapping?.title || classId).trim(),
    );
    if (!sheet) throw invalid("Không tìm thấy sheet lớp.", 404);
    const title = sheet.properties.title;
    const rows =
      (
        await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: quote(title),
          valueRenderOption: "FORMATTED_VALUE",
        })
      ).data.values || [];
    const grid =
      (
        await sheets.spreadsheets.get({
          spreadsheetId,
          ranges: [quote(title)],
          includeGridData: true,
        })
      ).data.sheets?.[0]?.data?.[0]?.rowData || [];
    const header = rows.findIndex(
      (r, i) => i < 10 && r.some((v) => /HỌ VÀ TÊN|TÊN HS/i.test(String(v))),
    );
    if (header < 0) throw invalid("Không tìm thấy cấu trúc điểm danh.");
    const nameCol = rows[header].findIndex((v) =>
      /HỌ VÀ TÊN|TÊN HS/i.test(String(v)),
    );
    let dateCol = (rows[header + 1] || []).findIndex(
      (v, i) => i > nameCol && isDateMatch(v, date),
    );
    const master =
      (
        await sheets.spreadsheets.values.get({
          spreadsheetId: env.SPREADSHEET_ID,
          range: "DB_HocSinh!A2:M",
        })
      ).data.values || [];
    const transferred = new Set(
      master
        .filter((r) =>
          String(r[7] || "")
            .split(",")
            .some((v) =>
              new RegExp(
                "^" +
                  classId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                  "\\s*\\((?:CHUYỂN|ĐÃ CHUYỂN|NGHỈ)\\)$",
                "i",
              ).test(v.trim()),
            ),
        )
        .map((r) => String(r[0]).trim()),
    );
    const students = rows.flatMap((r, i) => {
      if (i <= header + 1 || !String(r[nameCol] || "").trim()) return [];
      const value = dateCol < 0 ? "" : String(r[dateCol] ?? "");
      const cellNote =
        dateCol < 0 ? "" : grid[i]?.values?.[dateCol]?.note || "";
      let detail;
      try {
        detail = JSON.parse(cellNote);
        if (detail.lt1 !== 1) detail = null;
      } catch {
        /* Legacy plain note. */
      }
      let status = null,
        note = detail?.note || "";
      if (value.toUpperCase() === "TRUE") status = "Có mặt";
      else if (value.toUpperCase() === "FALSE") status = "Vắng";
      else if (value.startsWith("Đi trễ")) {
        status = "Đi trễ";
        if (!detail) note = value.replace(/^Đi trễ(?:: )?/, "");
      } else if (value.startsWith("Vắng có phép")) {
        status = "Vắng có phép";
        if (!detail) note = value.replace(/^Vắng có phép(?:: )?/, "");
      } else if (value.trim()) {
        status = "Khác";
        if (!detail) note = value;
      }
      return [
        {
          id: String(r[nameCol + 1] || "").trim(),
          name: String(r[nameCol]).trim(),
          status,
          note,
          version: hash([value, cellNote]),
          isTransferred: transferred.has(String(r[nameCol + 1] || "").trim()),
          rowIndex: i + 1,
        },
      ];
    });
    return {
      sheets,
      spreadsheetId,
      meta,
      sheet,
      title,
      rows,
      header,
      nameCol,
      dateCol,
      students,
      grid,
    };
  }
  return {
    async list(classId, date) {
      return (await context(classId, date)).students;
    },
    save(body, actor) {
      return serial(async () => {
        if (
          !Array.isArray(body.records) ||
          !body.records.length ||
          body.records.length > 500
        )
          throw invalid("Danh sách điểm danh không hợp lệ.");
        if (body.records.some((r) => String(r.note || "").length > 2000))
          throw invalid("Ghi chú quá dài.");
        if (body.sessionKey && body.sessionKey !== "default")
          throw invalid("Nhiều ca cần chế độ PostgreSQL.");
        if (body.date > today()) throw invalid("Không lưu ngày tương lai.");
        const ctx = await context(body.classId, body.date);
        const { sheets, spreadsheetId, sheet, rows, header, nameCol } = ctx;
        const mapped = (body.records || []).map((r) => ({
          ...r,
          status: ["Có mặt", "Vắng"].includes(r.status) ? r.status : "Khác",
        }));
        const resolved = resolveAttendanceRecords(
          rows,
          header,
          nameCol,
          mapped,
        );
        const requestId = body.requestId;
        if (
          !requestId ||
          typeof requestId !== "string" ||
          requestId.length > 120
        )
          throw invalid("Thiếu mã yêu cầu.");
        const digest = hash({ actor, ...body });
        let auditSheet = ctx.meta.sheets.find(
          (s) => s.properties.title === "DB_AttendanceAudit",
        );
        if (auditSheet) {
          const log =
            (
              await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: "DB_AttendanceAudit!A:F",
              })
            ).data.values || [];
          const previous = log.find((r) => r[0] === requestId);
          if (previous) {
            if (previous[1] !== digest)
              throw invalid("Mã yêu cầu đã dùng cho nội dung khác.", 409);
            return JSON.parse(previous[5]);
          }
        }
        for (const r of body.records) {
          const current = ctx.students.find((s) => s.id === r.id);
          if (!current || current.isTransferred)
            throw invalid("Học sinh đã chuyển hoặc không tồn tại.");
          if (!r.version || r.version !== current.version)
            throw invalid(
              `Điểm danh ${r.id} đã thay đổi. Tải lại và đối chiếu.`,
              409,
            );
          if (
            ![
              null,
              "Có mặt",
              "Vắng",
              "Đi trễ",
              "Vắng có phép",
              "Khác",
            ].includes(r.status)
          )
            throw invalid("Trạng thái không hợp lệ.");
        }
        if (!auditSheet) {
          const result = await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                { addSheet: { properties: { title: "DB_AttendanceAudit" } } },
              ],
            },
          });
          auditSheet = {
            properties: result.data.replies[0].addSheet.properties,
          };
        }
        let col = ctx.dateCol;
        const requests = [];
        if (col < 0) {
          col = Math.max((rows[header + 1] || []).length, nameCol + 2);
          if (col >= sheet.properties.gridProperties.columnCount)
            requests.push({
              appendDimension: {
                sheetId: sheet.properties.sheetId,
                dimension: "COLUMNS",
                length: col - sheet.properties.gridProperties.columnCount + 1,
              },
            });
          requests.push({
            updateCells: {
              start: {
                sheetId: sheet.properties.sheetId,
                rowIndex: header + 1,
                columnIndex: col,
              },
              rows: [
                { values: [{ userEnteredValue: { stringValue: body.date } }] },
              ],
              fields: "userEnteredValue",
            },
          });
        }
        const versions = {},
          changes = [];
        for (const r of body.records) {
          const row = resolved.find((x) => x.id === r.id).rowIndex - 1;
          const old = ctx.students.find((s) => s.id === r.id);
          const oldNote = ctx.grid[row]?.values?.[col]?.note || "";
          let legacy = oldNote;
          try {
            const parsed = JSON.parse(oldNote);
            if (parsed.lt1 === 1) legacy = parsed.legacy || "";
          } catch {}
          const note = JSON.stringify({
            lt1: 1,
            note: r.note || "",
            legacy,
            revision: randomUUID(),
          });
          const value =
            r.status === "Có mặt"
              ? { boolValue: true }
              : r.status === "Vắng"
                ? { boolValue: false }
                : {
                    stringValue: r.status
                      ? r.status === "Khác"
                        ? r.note || "Khác"
                        : r.status
                      : "",
                  };
          const formatted =
            value.boolValue === true
              ? "TRUE"
              : value.boolValue === false
                ? "FALSE"
                : value.stringValue;
          versions[r.id] = hash([formatted, note]);
          changes.push({
            id: r.id,
            before: { status: old.status, note: old.note },
            after: { status: r.status, note: r.note },
          });
          requests.push({
            updateCells: {
              start: {
                sheetId: sheet.properties.sheetId,
                rowIndex: row,
                columnIndex: col,
              },
              rows: [{ values: [{ userEnteredValue: value, note }] }],
              fields: "userEnteredValue,note",
            },
          });
        }
        const result = {
          success: true,
          versions,
          savedAt: new Date().toISOString(),
        };
        requests.push({
          appendCells: {
            sheetId: auditSheet.properties.sheetId,
            rows: [
              {
                values: [
                  requestId,
                  digest,
                  actor,
                  result.savedAt,
                  JSON.stringify({
                    classId: body.classId,
                    date: body.date,
                    changes,
                  }),
                  JSON.stringify(result),
                ].map((stringValue) => ({ userEnteredValue: { stringValue } })),
              },
            ],
            fields: "userEnteredValue",
          },
        });
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests },
        });
        return result;
      });
    },
    async history(classId, date) {
      const ctx = await context(classId, date);
      if (
        !ctx.meta.sheets.some(
          (s) => s.properties.title === "DB_AttendanceAudit",
        )
      )
        return [];
      const rows =
        (
          await ctx.sheets.spreadsheets.values.get({
            spreadsheetId: ctx.spreadsheetId,
            range: "DB_AttendanceAudit!A:F",
          })
        ).data.values || [];
      return rows
        .flatMap((r) => {
          try {
            const data = JSON.parse(r[4]);
            return data.classId === classId && data.date === date
              ? data.changes.map((change) => ({
                  actor: r[2],
                  created_at: r[3],
                  entity: change.id,
                  before_data: change.before,
                  after_data: change.after,
                }))
              : [];
          } catch {
            return [];
          }
        })
        .reverse();
    },
  };
}
