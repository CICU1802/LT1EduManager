import { invalid, isDateMatch } from "./integrity.js";

export const quote = (title) => `'${String(title).replaceAll("'", "''")}'`;

export const normalizeKey = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const unique = (values) => [...new Set(values.filter(Boolean))];

export const studentSpreadsheetId = (env) =>
  env.SPREADSHEET_ID_STUDENTS || env.SPREADSHEET_ID;

export const spreadsheetIdsFor = (env, kind) => {
  if (kind === "attendance")
    return unique([
      env.SPREADSHEET_ID_ATTENDANCE_C2,
      env.SPREADSHEET_ID_ATTENDANCE_C3,
      env.SPREADSHEET_ID_ATTENDANCE,
      env.SPREADSHEET_ID,
    ]);
  if (kind === "tuition")
    return unique([
      env.SPREADSHEET_ID_TUITION_C2,
      env.SPREADSHEET_ID_TUITION_C3,
      env.SPREADSHEET_ID_TUITION,
      env.SPREADSHEET_ID,
    ]);
  return unique([studentSpreadsheetId(env)]);
};

export async function readValues(sheets, spreadsheetId, range, options = {}) {
  return (
    await sheets.spreadsheets.values.get({ spreadsheetId, range, ...options })
  ).data.values || [];
}

async function optionalValues(sheets, spreadsheetId, range, options = {}) {
  try {
    return await readValues(sheets, spreadsheetId, range, options);
  } catch (error) {
    if ([400, 404].includes(error?.code) || [400, 404].includes(error?.status))
      return null;
    throw error;
  }
}

export async function loadStudents(sheets, env) {
  const spreadsheetId = studentSpreadsheetId(env);
  if (!spreadsheetId) throw invalid("Chưa cấu hình bảng học sinh.", 503);
  const [cap2, cap3] = await Promise.all([
    optionalValues(sheets, spreadsheetId, "HOC_SINH_CAP2!A2:H"),
    optionalValues(sheets, spreadsheetId, "HOC_SINH_CAP3!A2:H"),
  ]);
  if (cap2 !== null || cap3 !== null) {
    return [
      ...(cap2 || []).map((row) => ({ row, level: 2 })),
      ...(cap3 || []).map((row) => ({ row, level: 3 })),
    ]
      .filter(({ row }) => String(row[0] || "").trim())
      .map(({ row, level }) => ({
        id: String(row[0] || "").trim(),
        birthYear: String(row[1] || "").trim(),
        name: String(row[2] || "").trim(),
        school: String(row[3] || "").trim(),
        phone: String(row[4] || "").trim(),
        secondPhone: String(row[5] || "").trim(),
        address: String(row[6] || "").trim(),
        notes: String(row[7] || "").trim(),
        level,
      }));
  }

  const legacy = await readValues(sheets, spreadsheetId, "DB_HocSinh!A2:M");
  return legacy
    .filter((row) => String(row[0] || "").trim())
    .map((row) => ({
      id: String(row[0] || "").trim(),
      name: String(row[1] || "").trim(),
      phone: String(row[2] || "").trim(),
      secondPhone: String(row[3] || "").trim(),
      birthYear: String(row[5] || "").slice(0, 4),
      school: String(row[6] || "").trim(),
      classes: String(row[7] || "").trim(),
      address: "",
      notes: String(row[12] || "").trim(),
      legacy: true,
    }));
}

export function parseClassSheet(rows, kind) {
  const header = rows.findIndex((row, index) => {
    if (index > 14) return false;
    const keys = row.map(normalizeKey);
    return kind === "attendance"
      ? keys.includes("mahs") && keys.some((key) => ["hoten", "tenhs"].includes(key))
      : keys.includes("mahs") && keys.some((key) => ["sotienthucnhan", "thucdong"].includes(key));
  });
  if (header < 0) return null;
  const keys = rows[header].map(normalizeKey);
  const idCol = keys.findIndex((key) => key === "mahs");
  const nameCol = keys.findIndex((key) => ["hoten", "tenhs"].includes(key));
  const noteCol = keys.findIndex((key) => key === "ghichu");
  const normalized = idCol === 0 && nameCol === 1;
  const dateHeader = normalized ? header : header + 1;
  const dataStart = kind === "tuition" ? header + 1 : normalized ? header + 1 : header + 2;
  const metadataValue = (row, expected) =>
    normalizeKey(rows[row]?.[0]) === expected
      ? String(rows[row]?.[1] || "").trim()
      : "";
  const metadata = {
    classCode: metadataValue(0, "malop"),
    courseCode: metadataValue(1, "makhoa"),
    schedule: metadataValue(2, "lichhoc"),
    teacher: metadataValue(3, "giaovien"),
    capacity: metadataValue(4, "sisotoida"),
  };
  if (kind === "attendance") {
    const firstDateCol = normalized ? 2 : Math.max(idCol, nameCol) + 1;
    const lastDateCol = normalized ? 13 : Math.max(rows[dateHeader]?.length || 0, firstDateCol) - 1;
    return {
      header,
      idCol,
      nameCol,
      noteCol,
      normalized,
      dateHeader,
      dataStart,
      firstDateCol,
      lastDateCol,
      metadata,
    };
  }
  const find = (...aliases) => keys.findIndex((key) => aliases.includes(key));
  return {
    header,
    idCol,
    nameCol,
    noteCol,
    normalized,
    dataStart,
    amountCol: find("sotienthucnhan", "thucdong"),
    dateCol: find("ngaydong"),
    listedCol: find("hocphiniemyet"),
    dueCol: find("phaidong"),
    remainingCol: find("conthieu"),
    metadata,
  };
}

function mapConfig(env, kind) {
  const raw =
    kind === "attendance"
      ? env.ATTENDANCE_SHEET_MAP_JSON
      : env.TUITION_SHEET_MAP_JSON;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw invalid(
      kind === "attendance"
        ? "ATTENDANCE_SHEET_MAP_JSON không hợp lệ."
        : "TUITION_SHEET_MAP_JSON không hợp lệ.",
      500,
    );
  }
}

export async function locateClassSheet(sheets, env, kind, classId) {
  const mapping = mapConfig(env, kind)[classId];
  const ids = mapping?.spreadsheetId
    ? [mapping.spreadsheetId]
    : spreadsheetIdsFor(env, kind);
  const wanted = String(mapping?.title || classId).trim();
  for (const spreadsheetId of ids) {
    const meta = (await sheets.spreadsheets.get({ spreadsheetId })).data;
    const sheet = meta.sheets.find(
      (item) => item.properties.title.trim() === wanted,
    );
    if (!sheet) continue;
    const title = sheet.properties.title;
    const rows = await readValues(sheets, spreadsheetId, quote(title), {
      valueRenderOption: "FORMATTED_VALUE",
    });
    const schema = parseClassSheet(rows, kind);
    if (!schema)
      throw invalid(
        kind === "attendance"
          ? "Không tìm thấy cấu trúc điểm danh chuẩn."
          : "Không tìm thấy cấu trúc học phí chuẩn.",
      );
    return { spreadsheetId, meta, sheet, title, rows, schema };
  }
  throw invalid(
    kind === "attendance"
      ? "Không tìm thấy sheet điểm danh của lớp."
      : "Không tìm thấy sheet học phí của lớp.",
    404,
  );
}

async function readRanges(sheets, spreadsheetId, ranges) {
  if (!ranges.length) return [];
  if (sheets.spreadsheets.values.batchGet) {
    const result = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
      valueRenderOption: "FORMATTED_VALUE",
    });
    return (result.data.valueRanges || []).map((range) => range.values || []);
  }
  return Promise.all(
    ranges.map((range) =>
      readValues(sheets, spreadsheetId, range, {
        valueRenderOption: "FORMATTED_VALUE",
      }),
    ),
  );
}

export async function loadClassCatalog(sheets, env) {
  const classes = [];
  const memberships = new Map();
  for (const spreadsheetId of spreadsheetIdsFor(env, "attendance")) {
    const meta = (await sheets.spreadsheets.get({ spreadsheetId })).data;
    const candidates = meta.sheets.filter(
      (item) =>
        !/^(HOC_SINH_CAP[23]|DB_AttendanceAudit)$/i.test(
          item.properties.title.trim(),
        ),
    );
    const ranges = candidates.map(
      (item) => `${quote(item.properties.title)}!A1:O`,
    );
    const values = await readRanges(sheets, spreadsheetId, ranges);
    candidates.forEach((item, index) => {
      const rows = values[index] || [];
      const schema = parseClassSheet(rows, "attendance");
      if (!schema) return;
      const id = item.properties.title.trim();
      const base = schema.metadata.classCode || id.split("_")[0];
      const grade = base.match(/(?:^|[^0-9])(6|7|8|9|10|11|12)(?=[^0-9]|$)/)?.[1] ||
        base.match(/^(6|7|8|9|10|11|12)/)?.[1] ||
        "";
      const memberIds = rows
        .slice(schema.dataStart)
        .map((row) => String(row[schema.idCol] || "").trim())
        .filter(Boolean);
      memberships.set(id, new Set(memberIds));
      classes.push({
        id,
        name: id,
        grade,
        teacher: schema.metadata.teacher,
        tuition: 0,
        schedule: schema.metadata.schedule,
        courseCode: schema.metadata.courseCode,
        capacity: schema.metadata.capacity,
      });
    });
  }
  return { classes, memberships };
}

export function findDateColumn(rows, schema, date) {
  for (let col = schema.firstDateCol; col <= schema.lastDateCol; col += 1)
    if (isDateMatch(rows[schema.dateHeader]?.[col], date)) return col;
  return -1;
}

