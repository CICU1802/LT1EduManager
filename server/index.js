import { createSheetsAttendance } from "./sheets-attendance.js";
import { createDatabase } from "./db/database.js";
import { createDataService } from "./db/service.js";
import { createDataRouter } from "./db/router.js";
import { createExcelRouter } from "./excel/router.js";
import { timingSafeEqual, createHash } from "node:crypto";
import express from "express";
import { randomUUID } from "node:crypto";
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

// Test Endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "Server is running",
    integrityVersion: 1,
    sheetsConfigured: !!process.env.SPREADSHEET_ID,
    dataBackend: DATABASE_ACTIVE ? "postgres" : "sheets",
    databaseConfigured: !!database,
  });
});

// Get Students (Học Sinh)
app.get("/api/students", async (req, res) => {
  try {
    const sheets = await getSheetsAPI();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: "DB_HocSinh!A2:M",
    });
    const rows = response.data.values || [];

    // Map rows to objects
    const students = rows.map((row) => ({
      id: row[0] || "",
      name: row[1] || "",
      phone: row[2] || "",
      parentPhone: row[3] || "",
      parentName: row[4] || "",
      dob: row[5] || "",
      school: row[6] || "",
      classes: row[7] || "",
      dateJoined: row[8] || "",
      status: row[9] || "",
      debtStatus: row[10] || "Hoàn tất",
      absences: row[11] || 0,
      notes: row[12] || "",
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
      debtStatus,
      absences,
      notes,
    } = req.body;
    const sheets = await getSheetsAPI();

    // Create new ID
    const newId = `HS-${randomUUID()}`;

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: "DB_HocSinh!A:M",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            newId,
            name || "",
            phone || "",
            parentPhone || "",
            parentName || "",
            dob || "",
            school || "",
            classes || "",
            dateJoined || "",
            status || "",
            debtStatus || "Hoàn tất",
            absences || 0,
            notes || "",
          ],
        ],
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
        dob,
        school,
        classes,
        dateJoined,
        status,
        debtStatus,
        absences,
        notes,
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
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: "DB_LopHoc!A2:F",
    });
    const rows = response.data.values || [];
    const classes = rows.map((row) => ({
      id: row[0],
      name: row[1],
      grade: row[2],
      teacher: row[3],
      tuition: row[4],
      schedule: row[5],
    }));
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
  try {
    const { id, name, grade, teacher, tuition, schedule } = req.body;
    const sheets = await getSheetsAPI();

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: "DB_LopHoc!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[id, name, grade, teacher, tuition, schedule]],
      },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Get Pending Students (Học sinh chờ duyệt)
app.get("/api/pending-students", async (req, res) => {
  try {
    const sheets = await getSheetsAPI();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: "DB_ChoDuyet!A2:I",
    });
    const rows = response.data.values || [];
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
    const existing =
      (
        await sheets.spreadsheets.values.get({
          spreadsheetId: process.env.SPREADSHEET_ID,
          range: "DB_ChoDuyet!A2:I",
        })
      ).data.values || [];
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
      spreadsheetId: process.env.SPREADSHEET_ID,
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
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: "DB_ChoDuyet!A2:I",
    });
    const rows = response.data.values || [];
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
      spreadsheetId: process.env.SPREADSHEET_ID,
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
