import test from "node:test";
import assert from "node:assert/strict";
import { createSheetsAttendance } from "../sheets-attendance.js";

function fixture() {
  const rows = [
      ["Mã lớp", "9A"], ["Mã khóa", "K1-2627"],
      ["Lịch học", "T2 T3 T4 T5 T6 T7 CN"], ["Giáo viên", "GV"],
      ["Sĩ số tối đa", "40"], ["Sĩ số"], ["", "", "Tuần 1", "Tuần 2"],
      ["ma_hs", "ho_ten", "2026-10-01", "", "", "", "", "", "", "", "", "", "", "", "ghi_chu"],
      ["2012-000001", "An", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ["2012-000002", "Bình", "K", "", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "Chưa đối chiếu", "P", "", "", "", "", "", "", "", "", "", "", "", "CHƯA ĐỐI CHIẾU MÃ"],
    ], notes = new Map(), logs = [];
  let hasLog = false, writes = 0;
  const sheets = { spreadsheets: {
    get: async (args) => {
      const properties = { title: "9A_K1-2627", sheetId: 1, gridProperties: { columnCount: 15 } };
      return { data: { sheets: args.includeGridData ? [{ properties, data: [{ rowData: rows.map((r, i) => ({ values: r.map((_, j) => ({ note: notes.get(`${i}/${j}`) || "" })) })) }] }] : [{ properties }, ...(hasLog ? [{ properties: { title: "DB_AttendanceAudit", sheetId: 2 } }] : [])] } };
    },
    values: { get: async ({ range }) => ({ data: { values: range.startsWith("DB_AttendanceAudit") ? logs : rows.map((r) => [...r]) } }) },
    batchUpdate: async ({ requestBody: { requests } }) => {
      if (requests[0].addSheet) { hasLog = true; return { data: { replies: [{ addSheet: { properties: { title: "DB_AttendanceAudit", sheetId: 2 } } }] } }; }
      writes++;
      for (const req of requests) {
        if (req.updateCells) {
          const { start, rows: data } = req.updateCells, cell = data[0].values[0], { rowIndex: i, columnIndex: j } = start;
          rows[i] ||= []; rows[i][j] = cell.userEnteredValue.stringValue;
          if (cell.note) notes.set(`${i}/${j}`, cell.note);
        }
        if (req.appendCells) logs.push(req.appendCells.rows[0].values.map((v) => v.userEnteredValue.stringValue));
      }
      return { data: {} };
    },
  } };
  return { service: createSheetsAttendance(async () => sheets, { SPREADSHEET_ID: "MASTER", SPREADSHEET_ID_ATTENDANCE_C2: "C2" }), rows, notes, logs, get writes() { return writes; } };
}

test("Sheets reads and writes normalized attendance codes and marks unmatched rows", async () => {
  const f = fixture(), s = f.service;
  let roster = await s.list("9A_K1-2627", "2026-10-01");
  assert.equal(roster[0].status, null); assert.equal(roster[1].status, "Vắng");
  assert.equal(roster[2].unmatched, true); assert.equal(roster[2].isTransferred, true);
  const body = { classId: "9A_K1-2627", date: "2026-10-01", requestId: "req1", records: [{ ...roster[0], status: "Học online", note: "Ghi chú cần giữ" }] };
  const result = await s.save(body, "vp"); assert.equal(f.rows[8][2], "ON");
  roster = await s.list("9A_K1-2627", "2026-10-01");
  assert.equal(roster[0].status, "Học online"); assert.equal(roster[0].note, "Ghi chú cần giữ");
  assert.equal(roster[0].version, result.versions["2012-000001"]);
  assert.deepEqual(await s.save(body, "vp"), result); assert.equal(f.writes, 1);
  assert.equal((await s.history("9A_K1-2627", "2026-10-01"))[0].actor, "vp");
});
test("Sheets serializes writes and rejects stale versions", async () => {
  const f = fixture(), roster = await f.service.list("9A_K1-2627", "2026-10-01");
  const body = { classId: "9A_K1-2627", date: "2026-10-01", records: [{ ...roster[0], status: "Vắng có phép" }] };
  const r = await Promise.allSettled([f.service.save({ ...body, requestId: "one" }, "a"), f.service.save({ ...body, requestId: "two" }, "b")]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(r.find((x) => x.status === "rejected").reason.status, 409); assert.equal(f.writes, 1);
});

test("Sheets resolves moved IDs and fills only one of the twelve date columns", async () => {
  const f = fixture(), roster = await f.service.list("9A_K1-2627", "2026-10-02");
  [f.rows[8], f.rows[9]] = [f.rows[9], f.rows[8]];
  await f.service.save({ classId: "9A_K1-2627", date: "2026-10-02", requestId: "moved", records: [{ ...roster[0], status: "Đi trễ", note: "5 phút" }] }, "ta");
  assert.equal(f.rows[9][3], "TR"); assert.equal(f.rows[8][3], ""); assert.equal(f.rows[7][3], "2026-10-02");
});
