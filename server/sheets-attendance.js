import { createHash, randomUUID } from "node:crypto";
import { invalid, isDateMatch, resolveAttendanceRecords } from "./integrity.js";
import { scheduledDays } from "./db/attendance-operations.js";
import {
  findDateColumn,
  locateClassSheet,
  quote,
  readValues,
} from "./normalized-sheets.js";
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
    new Date(),
  );
const STATUS_FROM_SHEET = {
  CM: "Có mặt",
  ON: "Học online",
  TR: "Đi trễ",
  BU: "Học bù",
  P: "Vắng có phép",
  K: "Vắng",
  LE: "Nghỉ lễ",
  TRUE: "Có mặt",
  FALSE: "Vắng",
};
const STATUS_TO_SHEET = {
  "Có mặt": "CM",
  "Học online": "ON",
  "Đi trễ": "TR",
  "Học bù": "BU",
  Vắng: "K",
  "Vắng có phép": "P",
  "Nghỉ lễ": "LE",
};
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
    const located = await locateClassSheet(
      sheets,
      env,
      "attendance",
      classId,
    );
    const { spreadsheetId, meta, sheet, title, rows, schema } = located;
    let schedule = schema.metadata.schedule;
    if (!schedule && !schema.normalized && env.SPREADSHEET_ID) {
      try {
        const catalogue = await readValues(
          sheets,
          env.SPREADSHEET_ID,
          "DB_LopHoc!A2:F",
        );
        schedule = String(
          catalogue.find((row) => row[0] === classId)?.[5] || "",
        );
      } catch {
        // A standardized deployment intentionally has no DB_LopHoc tab.
      }
    }
    const days = scheduledDays({ schedule });
    if (schedule && !days.length)
      throw invalid("Lịch lớp chưa nhận diện được. Cần chuẩn hóa lịch.");
    if (
      days.length &&
      !days.includes(new Date(date + "T12:00:00Z").getUTCDay())
    )
      throw invalid("Ngày ngoài lịch học của lớp.");
    const grid =
      (
        await sheets.spreadsheets.get({
          spreadsheetId,
          ranges: [quote(title)],
          includeGridData: true,
        })
      ).data.sheets?.[0]?.data?.[0]?.rowData || [];
    let dateCol = findDateColumn(rows, schema, date);
    const students = rows.flatMap((r, i) => {
      if (i < schema.dataStart || !String(r[schema.nameCol] || "").trim())
        return [];
      const realId = String(r[schema.idCol] || "").trim();
      const unmatched = !realId;
      const id = realId || `CHUA-DOI-CHIEU-${i + 1}`;
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
        note =
          detail?.note ||
          String(schema.noteCol >= 0 ? r[schema.noteCol] || "" : "").trim();
      const code = value.trim().toUpperCase();
      if (STATUS_FROM_SHEET[code]) status = STATUS_FROM_SHEET[code];
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
          id,
          name: String(r[schema.nameCol]).trim(),
          status,
          note,
          version: hash([
            value,
            cellNote,
            schema.noteCol >= 0 ? r[schema.noteCol] || "" : "",
          ]),
          isTransferred: unmatched,
          unmatched,
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
      schema,
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
        const { sheets, spreadsheetId, sheet, rows, schema } = ctx;
        const resolved = resolveAttendanceRecords(
          rows,
          { dataStart: schema.dataStart, idCol: schema.idCol },
          body.records,
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
              "Học online",
              "Học bù",
              "Nghỉ lễ",
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
          col = -1;
          for (let candidate = schema.firstDateCol; candidate <= schema.lastDateCol; candidate += 1) {
            if (!String(rows[schema.dateHeader]?.[candidate] || "").trim()) {
              col = candidate;
              break;
            }
          }
          if (col < 0)
            throw invalid(
              "Lớp đã đủ 12 cột điểm danh. Hãy chọn một ngày có trong dòng 8.",
            );
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
                rowIndex: schema.dateHeader,
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
          const formatted = r.status ? STATUS_TO_SHEET[r.status] : "";
          const value = { stringValue: formatted };
          versions[r.id] = hash([
            formatted,
            note,
            schema.noteCol >= 0 ? rows[row]?.[schema.noteCol] || "" : "",
          ]);
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
