import test from "node:test";
import assert from "node:assert/strict";
import { createSheetsAttendance } from "../sheets-attendance.js";
function fixture() {
  const rows = [
      ["HỌ VÀ TÊN", "MÃ HS", ""],
      ["", "", "01/10/2026"],
      ["An", "A", ""],
      ["Bình", "B", "FALSE"],
    ],
    notes = new Map(),
    logs = [];
  let hasLog = false,
    writes = 0;
  const sheets = {
    spreadsheets: {
      get: async (args) => {
        const properties = {
          title: "9A",
          sheetId: 1,
          gridProperties: { columnCount: 3 },
        };
        return {
          data: {
            sheets: args.includeGridData
              ? [
                  {
                    properties,
                    data: [
                      {
                        rowData: rows.map((r, i) => ({
                          values: r.map((_, j) => ({
                            note: notes.get(`${i}/${j}`) || "",
                            effectiveFormat: {
                              backgroundColor: {
                                red: 0.2,
                                green: 0.2,
                                blue: 0.2,
                              },
                            },
                          })),
                        })),
                      },
                    ],
                  },
                ]
              : [
                  { properties },
                  ...(hasLog
                    ? [
                        {
                          properties: {
                            title: "DB_AttendanceAudit",
                            sheetId: 2,
                          },
                        },
                      ]
                    : []),
                ],
          },
        };
      },
      values: {
        get: async ({ range }) => ({
          data: {
            values: range.startsWith("DB_LopHoc")
              ? [["9A", "Lớp 9", "9", "", "", ""]]
              : range.startsWith("DB_HocSinh")
                ? [["A", "An", "", "", "", "", "", "9A"]]
                : range.startsWith("DB_AttendanceAudit")
                  ? logs
                  : rows.map((r) => [...r]),
          },
        }),
      },
      batchUpdate: async ({ requestBody: { requests } }) => {
        if (requests[0].addSheet) {
          hasLog = true;
          return {
            data: {
              replies: [
                {
                  addSheet: {
                    properties: { title: "DB_AttendanceAudit", sheetId: 2 },
                  },
                },
              ],
            },
          };
        }
        writes++;
        for (const req of requests) {
          if (req.updateCells) {
            const { start, rows: data } = req.updateCells,
              cell = data[0].values[0],
              { rowIndex: i, columnIndex: j } = start;
            rows[i] ||= [];
            rows[i][j] =
              cell.userEnteredValue.boolValue === true
                ? "TRUE"
                : cell.userEnteredValue.boolValue === false
                  ? "FALSE"
                  : cell.userEnteredValue.stringValue;
            if (cell.note) notes.set(`${i}/${j}`, cell.note);
          }
          if (req.appendCells)
            logs.push(
              req.appendCells.rows[0].values.map(
                (v) => v.userEnteredValue.stringValue,
              ),
            );
        }
        return { data: {} };
      },
    },
  };
  return {
    service: createSheetsAttendance(async () => sheets, {
      SPREADSHEET_ID: "MASTER",
      SPREADSHEET_ID_ATTENDANCE_C2: "C2",
    }),
    rows,
    notes,
    logs,
    get writes() {
      return writes;
    },
  };
}
test("Sheets preserves notes with booleans and clear status, ignores decorative color, records audit", async () => {
  const f = fixture(),
    s = f.service;
  let roster = await s.list("9A", "2026-10-01");
  assert.equal(roster[0].status, null);
  assert.equal(roster[0].isTransferred, false);
  assert.equal(roster[1].status, "Vắng");
  const body = {
    classId: "9A",
    date: "2026-10-01",
    requestId: "req1",
    records: [{ ...roster[0], status: "Có mặt", note: "Ghi chú cần giữ" }],
  };
  const result = await s.save(body, "vp");
  roster = await s.list("9A", "2026-10-01");
  assert.equal(roster[0].status, "Có mặt");
  assert.equal(roster[0].note, "Ghi chú cần giữ");
  assert.equal(roster[0].version, result.versions.A);
  assert.deepEqual(await s.save(body, "vp"), result);
  assert.equal(f.writes, 1);
  assert.equal((await s.history("9A", "2026-10-01"))[0].actor, "vp");
  await s.save(
    {
      ...body,
      requestId: "req2",
      records: [{ ...roster[0], status: null, note: "Chờ xác nhận" }],
    },
    "vp",
  );
  assert.equal((await s.list("9A", "2026-10-01"))[0].status, null);
  assert.equal((await s.list("9A", "2026-10-01"))[0].note, "Chờ xác nhận");
});
test("Sheets serializes app writes and rejects stale versions without writing", async () => {
  const f = fixture(),
    roster = await f.service.list("9A", "2026-10-01");
  const body = {
    classId: "9A",
    date: "2026-10-01",
    records: [{ ...roster[0], status: "Vắng" }],
  };
  const r = await Promise.allSettled([
    f.service.save({ ...body, requestId: "one" }, "a"),
    f.service.save({ ...body, requestId: "two" }, "b"),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(r.find((x) => x.status === "rejected").reason.status, 409);
  assert.equal(f.writes, 1);
});
test("Sheets checks IDs after rows move and adds dates after identity validation", async () => {
  const f = fixture(),
    roster = await f.service.list("9A", "2026-10-02");
  [f.rows[2], f.rows[3]] = [f.rows[3], f.rows[2]];
  await f.service.save(
    {
      classId: "9A",
      date: "2026-10-02",
      requestId: "moved",
      records: [{ ...roster[0], status: "Đi trễ", note: "5 phút" }],
    },
    "ta",
  );
  assert.equal(f.rows[3][3], "Đi trễ");
  assert.equal(f.rows[2][3], undefined);
  const bad = await f.service.list("9A", "2026-10-03");
  await assert.rejects(
    f.service.save(
      {
        classId: "9A",
        date: "2026-10-03",
        requestId: "bad",
        records: [{ ...bad[0], id: "" }],
      },
      "ta",
    ),
  );
  assert.equal(f.rows[1][4], undefined);
});
