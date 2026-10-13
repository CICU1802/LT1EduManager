import { createSheetsAttendance } from "./sheets-attendance.js";
import { createDatabase } from "./db/database.js";
import { createDataService } from "./db/service.js";
import { createDataRouter } from "./db/router.js";
import { createExcelRouter } from "./excel/router.js";
import {
  loadClassCatalog,
  loadStudents,
  studentSpreadsheetId,
} from "./normalized-sheets.js";
import { timingSafeEqual, createHash } from "node:crypto";
import express from "express";
import { createTuitionService } from "./tuition.js";
import cors from "cors";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(
  cors({
    exposedHeaders: [
      "Content-Disposition",
      "X-LT1-Unmapped-Rows",
      "X-LT1-Added-Rows",
    ],
  }),
);
app.use(express.json({ limit: "4mb" }));

// Test Accounts (Demo RBAC)
const TEST_USERS = {
  admin: { pass: "123456", role: "admin" },
  vanphong: { pass: "123456", role: "vanphong" },
  trogiang: { pass: "123456", role: "trogiang" },
};

if (
  process.env.DATA_BACKEND &&
  !["sheets", "postgres"].includes(process.env.DATA_BACKEND)
)
  throw new Error("DATA_BACKEND must be sheets or postgres.");
const DATABASE_ACTIVE = process.env.DATA_BACKEND === "postgres";
const database = createDatabase();
if (DATABASE_ACTIVE && !database)
  throw new Error("DATA_BACKEND=postgres requires DATABASE_URL.");
const dataService = database ? createDataService(database) : null;
const configuredUsers = process.env.AUTH_USERS_JSON
  ? JSON.parse(process.env.AUTH_USERS_JSON)
  : null;
if (
  (DATABASE_ACTIVE || process.env.NODE_ENV === "production") &&
  (!configuredUsers ||
    Object.keys(configuredUsers).length === 0 ||
    Object.values(configuredUsers).some(
      (u) =>
        !["admin", "vanphong", "trogiang"].includes(u.role) ||
        typeof u.pass !== "string" ||
        u.pass.length < 12,
    ))
)
  throw new Error(
    "Configure strong per-user AUTH_USERS_JSON before production or PostgreSQL.",
  );
const authUsers = configuredUsers || TEST_USERS;
const equalPassword = (a, b) =>
  timingSafeEqual(
    createHash("sha256")
      .update(String(a || ""))
      .digest(),
    createHash("sha256")
      .update(String(b || ""))
      .digest(),
  );

// Internal Authentication Middleware
app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();

  const clientUser = req.headers["x-api-user"];
  const clientKey = req.headers["x-api-key"];
  const serverKey = process.env.API_PASSWORD || "trungtam123";

  // Fallback for old sessions that only have API_PASSWORD
  if (
    !DATABASE_ACTIVE &&
    !configuredUsers &&
    !clientUser &&
    clientKey === serverKey
  ) {
    req.user = { username: "admin", role: "admin" };
    return next();
  }

  if (
    clientUser &&
    Object.hasOwn(authUsers, clientUser) &&
    equalPassword(authUsers[clientUser].pass, clientKey)
  ) {
    req.user = { username: clientUser, role: authUsers[clientUser].role };
    return next();
  }

  return res
    .status(401)
    .json({ error: "Unauthorized: Incorrect username or password" });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// Enforce the same office boundaries in both persistence modes.
app.use("/api", (req, res, next) => {
  if (
    req.user?.role === "trogiang" &&
    (/^\/(tuition|balances|audit|parent-tasks|families|results|enrollments|data)(?:\/|$)/.test(
      req.path,
    ) ||
      (req.method !== "GET" &&
        (/^\/(students|classes)(?:\/|$)/.test(req.path) ||
          /\/(resolve|enroll)$/.test(req.path))))
  )
    return res
      .status(403)
      .json({ error: "Chức năng này dành cho văn phòng và quản trị viên." });
  next();
});
app.get("/api/attendance/capabilities", (req, res) =>
  res.json({
    backend: DATABASE_ACTIVE ? "postgres" : "sheets",
    sessions: DATABASE_ACTIVE,
    operations: DATABASE_ACTIVE,
    notes: true,
    versions: true,
  }),
);
const sheetAttendance = createSheetsAttendance(getSheetsAPI, process.env);
if (!DATABASE_ACTIVE) {
  const sheetRoute = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      res.status(e.status || 500).json({
        error: e.status
          ? e.message
          : "Chưa lưu hoặc đọc được Sheets. Giữ bản nháp và thử lại.",
      });
    }
  };
  app.get(
    "/api/attendance/class/:classId",
    sheetRoute((req) =>
      sheetAttendance.list(
        req.params.classId,
        req.query.date ||
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Ho_Chi_Minh",
          }).format(new Date()),
      ),
    ),
  );
  app.post(
    "/api/attendance",
    sheetRoute((req) => sheetAttendance.save(req.body, req.user.username)),
  );
  app.get(
    "/api/attendance/history",
    sheetRoute((req) =>
      sheetAttendance.history(req.query.classId, req.query.date),
    ),
  );
}

// Excel tools are available for analysis during setup; writes require explicit PostgreSQL cutover.
app.use(
  "/api/data",
  createExcelRouter(dataService, { active: DATABASE_ACTIVE }),
);
if (DATABASE_ACTIVE) {
  app.use("/api", createDataRouter(dataService));
  app.use("/api", (req, res, next) =>
    req.path === "/health"
      ? next()
      : res
          .status(404)
          .json({ error: "API không tồn tại trong chế độ PostgreSQL." }),
  );
}

// Load Service Account Credentials
// The user will need to place their google-credentials.json in this directory
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

async function getAuth() {
  try {
    let authOptions = { scopes: SCOPES };

    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      // Use credentials from ENV variable on Render
      const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      authOptions.credentials = credentials;
    } else {
      // Use local file
      authOptions.keyFile = "./google-credentials.json";
    }

    const auth = new google.auth.GoogleAuth(authOptions);
    return auth;
  } catch (error) {
    console.error("Error loading Google credentials:", error.message);
    return null;
  }
}

// Helper to get Google Sheets instance
async function getSheetsAPI() {
  const auth = await getAuth();
  if (!auth) throw new Error("Authentication failed");
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

let classCatalogCache = null;
async function getClassCatalog(sheets) {
  if (classCatalogCache && Date.now() - classCatalogCache.loadedAt < 30_000)
    return classCatalogCache.value;
  const value = await loadClassCatalog(sheets, process.env);
  classCatalogCache = { loadedAt: Date.now(), value };
  return value;
}

const masterSpreadsheetId = () => studentSpreadsheetId(process.env);

async function readOptionalInternalSheet(sheets, range) {
  try {
    return (
      await sheets.spreadsheets.values.get({
        spreadsheetId: masterSpreadsheetId(),
        range,
      })
    ).data.values || [];
  } catch (error) {
    if ([400, 404].includes(error?.code) || [400, 404].includes(error?.status))
      return null;
    throw error;
  }
}

async function ensurePendingSheet(sheets) {
  const existing = await readOptionalInternalSheet(sheets, "DB_ChoDuyet!A1:I");
  if (existing !== null) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: masterSpreadsheetId(),
    requestBody: {
      requests: [
        { addSheet: { properties: { title: "DB_ChoDuyet", hidden: true } } },
      ],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: masterSpreadsheetId(),
    range: "DB_ChoDuyet!A1:I1",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        "id",
        "ngay",
        "lop",
        "ho_ten",
        "ghi_chu",
        "nguoi_bao",
        "trang_thai",
        "nguoi_xu_ly",
        "xu_ly_luc",
      ]],
    },
  });
}

// Test Endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "Server is running",
    integrityVersion: 1,
    sheetsConfigured: !!masterSpreadsheetId(),
    dataBackend: DATABASE_ACTIVE ? "postgres" : "sheets",
    databaseConfigured: !!database,
  });
});

// Get Students (Học Sinh)
app.get("/api/students", async (req, res) => {
  try {
    const sheets = await getSheetsAPI();
    const [source, catalog] = await Promise.all([
      loadStudents(sheets, process.env),
      getClassCatalog(sheets),
    ]);
    const students = source.map((student) => ({
      id: student.id,
      name: student.name,
      phone: student.phone,
      parentPhone: student.secondPhone,
      parentName: "",
      dob: student.birthYear,
      school: student.school,
      address: student.address,
      classes:
        student.classes ||
        catalog.classes
          .filter((item) => catalog.memberships.get(item.id)?.has(student.id))
          .map((item) => item.id)
          .join(", "),
      dateJoined: "",
      status: "Đang học",
      debtStatus: "Hoàn tất",
      absences: 0,
      notes: student.notes,
      level: student.level,
    }));

    res.json(students);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Add Student (Thêm Học Sinh)
app.post("/api/students", async (req, res) => {
  try {
    const {
      name,
      phone,
      parentPhone,
      parentName,
      dob,
      school,
      classes,
      dateJoined,
      status,
      notes,
      address,
      level,
    } = req.body;
    const sheets = await getSheetsAPI();
    const existing = await loadStudents(sheets, process.env);
    const year = Number(String(dob || "").match(/^(\d{4})/)?.[1]);
    if (!name?.trim() || !Number.isInteger(year) || year < 2000 || year > 2030)
      return res.status(422).json({ error: "Cần họ tên và năm sinh từ 2000 đến 2030." });
    if (phone && !/^0\d{9}$/.test(String(phone).trim()))
      return res.status(422).json({ error: "SĐT 1 phải gồm 10 chữ số và bắt đầu bằng 0." });
    if (parentPhone && !/^0\d{9}$/.test(String(parentPhone).trim()))
      return res.status(422).json({ error: "SĐT 2 phải gồm 10 chữ số và bắt đầu bằng 0." });
    const next =
      Math.max(
        0,
        ...existing.map((student) => Number(student.id.match(/-(\d{6})$/)?.[1] || 0)),
      ) + 1;
    if (next > 999999) return res.status(409).json({ error: "Đã hết dải mã học sinh." });
    const newId = `${year}-${String(next).padStart(6, "0")}`;
    const chosenLevel = Number(level) === 3 ? 3 : Number(level) === 2 ? 2 : year <= 2011 ? 3 : 2;
    const extraNotes = [
      notes,
      parentName ? `Phụ huynh: ${parentName}` : "",
      classes ? `Lớp đăng ký: ${classes}` : "",
      dateJoined ? `Ngày vào: ${dateJoined}` : "",
      status && status !== "Đang học" ? `Trạng thái: ${status}` : "",
    ].filter(Boolean).join("; ");

    await sheets.spreadsheets.values.append({
      spreadsheetId: masterSpreadsheetId(),
      range: `HOC_SINH_CAP${chosenLevel}!A:H`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[newId, year, name.trim(), school || "", phone || "", parentPhone || "", address || "", extraNotes]],
      },
    });

    res.json({
      success: true,
      student: {
        id: newId,
        name,
        phone,
        parentPhone,
        parentName,
        dob: String(year),
        school,
        classes,
        dateJoined,
        status,
        debtStatus: "Hoàn tất",
        absences: 0,
        notes: extraNotes,
        address,
        level: chosenLevel,
      },
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Get Classes (Lớp Học)
app.get("/api/classes", async (req, res) => {
  try {
    const sheets = await getSheetsAPI();
    const { classes } = await getClassCatalog(sheets);
    res.json(classes);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Financial writes are serialized in this server; see deployment notes.
const tuitionService = createTuitionService(getSheetsAPI, process.env);
app.get("/api/tuition", async (req, res) => {
  try {
    res.json(await tuitionService.list());
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});
app.post("/api/tuition", async (req, res) => {
  try {
    res.json(await tuitionService.create(req.body, req.user.username));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});
app.post("/api/tuition/:id/retry", async (req, res) => {
  try {
    res.json(await tuitionService.retry(req.params.id));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Add Class (Thêm Lớp Học)
app.post("/api/classes", async (req, res) => {
  res.status(422).json({
    error:
      "Hãy tạo cặp sheet điểm danh và học phí từ mẫu, đặt tên {mã_lớp}_{mã_khóa}; web sẽ tự nhận lớp mới.",
  });
});

// Get Pending Students (Học sinh chờ duyệt)
app.get("/api/pending-students", async (req, res) => {
  try {
    const sheets = await getSheetsAPI();
    const rows = (await readOptionalInternalSheet(sheets, "DB_ChoDuyet!A2:I")) || [];
    const pending = rows.map((row) => ({
      id: row[0] || "",
      date: row[1] || "",
      class: row[2] || "",
      name: row[3] || "",
      note: row[4] || "",
      reportedBy: row[5] || "",
      status: row[6] || "Chờ duyệt",
      processedBy: row[7] || "",
      processedAt: row[8] || "",
    }));
    res.json(pending);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Add Pending Student (Trợ giảng báo cáo học sinh mới)
app.post("/api/pending-students", async (req, res) => {
  const { date, className, studentName, note } = req.body;
  try {
    if (!req.body.classId || !req.body.requestId || !studentName?.trim())
      return res.status(422).json({ error: "Thiếu tên, lớp hoặc mã yêu cầu." });
    await sheetAttendance.list(req.body.classId, date);
    const newId =
      "CD-" +
      createHash("sha256")
        .update(req.user.username + req.body.requestId)
        .digest("hex");
    const reporter = req.user?.username || "unknown";

    const sheets = await getSheetsAPI();
    await ensurePendingSheet(sheets);
    const existing = (await readOptionalInternalSheet(sheets, "DB_ChoDuyet!A2:I")) || [];
    const duplicate = existing.find(
      (r) =>
        r[0] === newId ||
        (r[1] === date &&
          r[2] === className &&
          String(r[3]).trim().toLowerCase() ===
            studentName.trim().toLowerCase() &&
          r[6] === "Chờ duyệt"),
    );
    if (duplicate)
      return res.json({ success: true, id: duplicate[0], duplicate: true });
    await sheets.spreadsheets.values.append({
      spreadsheetId: masterSpreadsheetId(),
      range: "DB_ChoDuyet!A:G",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [newId, date, className, studentName, note, reporter, "Chờ duyệt"],
        ],
      },
    });
    res.json({ success: true, id: newId });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Delete/Approve Pending Student
app.post("/api/pending-students/:id/resolve", async (req, res) => {
  const { id } = req.params;
  try {
    const sheets = await getSheetsAPI();
    const rows = (await readOptionalInternalSheet(sheets, "DB_ChoDuyet!A2:I")) || [];
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === id) {
        rowIndex = i + 2; // +1 for 0-index, +1 for header
        break;
      }
    }

    if (rowIndex === -1) return res.status(404).json({ error: "Not found" });

    if (rows[rowIndex - 2][6] === "Đã xử lý")
      return res.json({ success: true });
    await sheets.spreadsheets.values.update({
      spreadsheetId: masterSpreadsheetId(),
      range: `DB_ChoDuyet!G${rowIndex}:I${rowIndex}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["Đã xử lý", req.user.username, new Date().toISOString()]],
      },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({
    error:
      error.status === 413
        ? "Dữ liệu vượt quá giới hạn cho phép."
        : "Yêu cầu không hợp lệ hoặc máy chủ chưa xử lý được.",
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(
    `Make sure to configure SPREADSHEET_ID in .env and place google-credentials.json`,
  );
});
