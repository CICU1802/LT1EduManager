import express from 'express';
import { randomUUID } from 'node:crypto';
import { createTuitionService } from './tuition.js';
import { resolveAttendanceRecords, isDateMatch } from './integrity.js';
import cors from 'cors';
import dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Test Accounts (Demo RBAC)
const TEST_USERS = {
  'admin': { pass: '123456', role: 'admin' },
  'vanphong': { pass: '123456', role: 'vanphong' },
  'trogiang': { pass: '123456', role: 'trogiang' }
};

// Internal Authentication Middleware
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  
  const clientUser = req.headers['x-api-user'];
  const clientKey = req.headers['x-api-key'];
  const serverKey = process.env.API_PASSWORD || 'trungtam123';
  
  // Fallback for old sessions that only have API_PASSWORD
  if (!clientUser && clientKey === serverKey) {
    req.user = { username: 'admin', role: 'admin' };
    return next();
  }

  if (clientUser && TEST_USERS[clientUser] && TEST_USERS[clientUser].pass === clientKey) {
    req.user = { username: clientUser, role: TEST_USERS[clientUser].role };
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized: Incorrect username or password' });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// Load Service Account Credentials
// The user will need to place their google-credentials.json in this directory
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

async function getAuth() {
  try {
    let authOptions = { scopes: SCOPES };
    
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      // Use credentials from ENV variable on Render
      const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      authOptions.credentials = credentials;
    } else {
      // Use local file
      authOptions.keyFile = './google-credentials.json';
    }
    
    const auth = new google.auth.GoogleAuth(authOptions);
    return auth;
  } catch (error) {
    console.error('Error loading Google credentials:', error.message);
    return null;
  }
}

// Helper to get Google Sheets instance
async function getSheetsAPI() {
  const auth = await getAuth();
  if (!auth) throw new Error('Authentication failed');
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

// Test Endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running', sheetsConfigured: !!process.env.SPREADSHEET_ID });
});

// Get Students (Học Sinh)
app.get('/api/students', async (req, res) => {
  try {
    const sheets = await getSheetsAPI();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'DB_HocSinh!A2:M',
    });
    const rows = response.data.values || [];
    
    // Map rows to objects
    const students = rows.map(row => ({
      id: row[0] || '',
      name: row[1] || '',
      phone: row[2] || '',
      parentPhone: row[3] || '',
      parentName: row[4] || '',
      dob: row[5] || '',
      school: row[6] || '',
      classes: row[7] || '',
      dateJoined: row[8] || '',
      status: row[9] || '',
      debtStatus: row[10] || 'Hoàn tất',
      absences: row[11] || 0,
      notes: row[12] || ''
    }));
    
    res.json(students);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Add Student (Thêm Học Sinh)
app.post('/api/students', async (req, res) => {
  try {
    const { name, phone, parentPhone, parentName, dob, school, classes, dateJoined, status, debtStatus, absences, notes } = req.body;
    const sheets = await getSheetsAPI();
    
    // Create new ID
    const newId = `HS-${randomUUID()}`;
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'DB_HocSinh!A:M',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[newId, name || '', phone || '', parentPhone || '', parentName || '', dob || '', school || '', classes || '', dateJoined || '', status || '', debtStatus || 'Hoàn tất', absences || 0, notes || '']]
      }
    });
    
    res.json({ success: true, student: { id: newId, name, phone, parentPhone, parentName, dob, school, classes, dateJoined, status, debtStatus, absences, notes } });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Get Classes (Lớp Học)
app.get('/api/classes', async (req, res) => {
  try {
    const sheets = await getSheetsAPI();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'DB_LopHoc!A2:F',
    });
    const rows = response.data.values || [];
    const classes = rows.map(row => ({
      id: row[0],
      name: row[1],
      grade: row[2],
      teacher: row[3],
      tuition: row[4],
      schedule: row[5]
    }));
    res.json(classes);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Helper to convert column index to letter (A, B, C...)
function colToLetter(colIndex) {
  let letter = '';
  while (colIndex >= 0) {
    letter = String.fromCharCode((colIndex % 26) + 65) + letter;
    colIndex = Math.floor(colIndex / 26) - 1;
  }
  return letter;
}

// Helper to check if cellDate matches the requested date
// Get Students in a specific class for attendance (Direct from Class Sheet)
app.get('/api/attendance/class/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    const { date } = req.query; // e.g. 2026-07-20
    const sheets = await getSheetsAPI();
    
    // Determine which Spreadsheet to use based on classId
    let spreadsheetId = process.env.SPREADSHEET_ID_ATTENDANCE || process.env.SPREADSHEET_ID;
    const upperClassId = classId.toUpperCase();
    if (upperClassId.includes('10') || upperClassId.includes('11') || upperClassId.includes('12') || upperClassId.includes('ĐGNL')) {
      spreadsheetId = process.env.SPREADSHEET_ID_ATTENDANCE_C3 || spreadsheetId;
    } else {
      spreadsheetId = process.env.SPREADSHEET_ID_ATTENDANCE_C2 || spreadsheetId;
    }

    const metaResponse = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetTitles = metaResponse.data.sheets.map(s => s.properties.title);
    const exactSheetName = sheetTitles.find(t => t.trim() === classId.trim());
    
    if (!exactSheetName) {
      return res.status(404).json({ error: `Không tìm thấy sheet lớp ${classId} (hoặc tên sheet không khớp).` });
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${exactSheetName}'`,
      valueRenderOption: 'FORMATTED_VALUE'
    });
    
    // Also fetch formatting to detect "blacked out" rows
    const formatResponse = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [`'${exactSheetName}'`],
      includeGridData: true
    });
    let rowData = [];
    if (formatResponse.data.sheets && formatResponse.data.sheets[0] && formatResponse.data.sheets[0].data && formatResponse.data.sheets[0].data[0]) {
      rowData = formatResponse.data.sheets[0].data[0].rowData || [];
    }
    
    const rows = response.data.values || [];
    let nameColIdx = -1;
    let headerRowIdx = -1;
    
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = rows[i];
      for (let j = 0; j < row.length; j++) {
        const val = row[j] ? row[j].toString().toUpperCase() : '';
        if (val.includes('HỌ VÀ TÊN') || val.includes('TÊN HS')) {
          headerRowIdx = i;
          nameColIdx = j;
          break;
        }
      }
      if (headerRowIdx !== -1) break;
    }

    if (headerRowIdx === -1) {
      return res.status(404).json({ error: 'Không tìm thấy cấu trúc bảng điểm danh trong sheet này.' });
    }

    // Find Date column
    let dateColIdx = -1;
    const dateRow = rows[headerRowIdx + 1] || [];
    if (date) {
      for (let j = nameColIdx + 1; j < dateRow.length; j++) {
        const cellDate = dateRow[j] ? dateRow[j].toString().trim() : '';
        if (isDateMatch(cellDate, date)) {
          dateColIdx = j;
          break;
        }
      }
    }

    // Fetch master DB_HocSinh to check transfer status
    const studentRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'DB_HocSinh!A2:M'
    });
    const studentRows = studentRes.data.values || [];
    const transferMap = {};
    const cIdUpper = classId.toUpperCase();
    
    studentRows.forEach(r => {
      const sId = r[0] ? r[0].toString().trim() : '';
      const sName = r[1] ? r[1].toString().trim() : '';
      const sClasses = r[7] ? r[7].toString().toUpperCase() : '';
      
      // Check if classes string contains this class with a transfer keyword
      if (sClasses.includes(`${cIdUpper} (CHUYỂN)`) || 
          sClasses.includes(`${cIdUpper} (ĐÃ CHUYỂN)`) ||
          sClasses.includes(`${cIdUpper}(CHUYỂN)`) ||
          sClasses.includes(`${cIdUpper} (NGHỈ)`) ||
          sClasses.includes(`${cIdUpper}(NGHỈ)`)) {
         if (sId) transferMap[sId] = true;
         if (sName) transferMap[sName] = true;
      }
    });

    const students = [];
    for (let i = headerRowIdx + 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const studentName = row[nameColIdx];
      if (!studentName || studentName.toString().trim() === '') continue;
      
      const studentId = row[nameColIdx + 1] ? row[nameColIdx + 1].toString().trim() : '';
      
      let status = null;
      let note = '';
      if (dateColIdx !== -1 && row[dateColIdx] !== undefined) {
        const val = row[dateColIdx].toString().trim().toUpperCase();
        if (val === 'TRUE') status = 'Có mặt';
        else if (val === 'FALSE') status = 'Vắng';
        else {
          status = 'Khác';
          note = row[dateColIdx].toString(); // e.g. "đã nhắn"
        }
      }
      
      const sNameStr = studentName.toString().trim();
      const sIdStr = studentId.toString().trim();
      
      let isTransferred = transferMap[sIdStr] || transferMap[sNameStr] || false;
      
      // Check if row is black/dark in the Google Sheet (via rowData)
      if (rowData[i] && rowData[i].values) {
         let isDark = false;
         // Check name column and id column
         [nameColIdx, nameColIdx + 1, 0, 1].forEach(cIdx => {
           if (rowData[i].values[cIdx]) {
             const cell = rowData[i].values[cIdx];
             if (cell.effectiveFormat) {
               let bgR = 1, bgG = 1, bgB = 1;
               if (cell.effectiveFormat.backgroundColor) {
                 const bg = cell.effectiveFormat.backgroundColor;
                 bgR = bg.red !== undefined ? bg.red : 1;
                 bgG = bg.green !== undefined ? bg.green : 1;
                 bgB = bg.blue !== undefined ? bg.blue : 1;
               }
               
               let isStrikethrough = false;
               if (cell.effectiveFormat.textFormat && cell.effectiveFormat.textFormat.strikethrough) {
                 isStrikethrough = true;
               }

               // Check for dark/gray color (white is 3.0, gray is ~1.8)
               if ((bgR + bgG + bgB) < 2.6 || isStrikethrough) {
                 isDark = true;
               }
             }
           }
         });
         if (isDark) isTransferred = true;
      }
      
      students.push({
        id: sIdStr,
        name: sNameStr,
        status: status,
        note: note,
        isTransferred: isTransferred,
        rowIndex: i + 1 // 1-indexed for Google Sheets update
      });
    }

    res.json(students);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Save Attendance (Direct to Class Sheet Tickboxes)
app.post('/api/attendance', async (req, res) => {
  try {
    const { classId, date, records } = req.body;
    if (typeof classId !== 'string' || !classId.trim()) return res.status(422).json({ error: 'Thiếu lớp điểm danh.' });
    isDateMatch(date, date);
    const sheets = await getSheetsAPI();
    
    let spreadsheetId = process.env.SPREADSHEET_ID_ATTENDANCE || process.env.SPREADSHEET_ID;
    const upperClassId = classId.toUpperCase();
    if (upperClassId.includes('10') || upperClassId.includes('11') || upperClassId.includes('12') || upperClassId.includes('ĐGNL')) {
      spreadsheetId = process.env.SPREADSHEET_ID_ATTENDANCE_C3 || spreadsheetId;
    } else {
      spreadsheetId = process.env.SPREADSHEET_ID_ATTENDANCE_C2 || spreadsheetId;
    }
    
    const metaResponse = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetTitles = metaResponse.data.sheets.map(s => s.properties.title);
    const exactSheetName = sheetTitles.find(t => t.trim() === classId.trim());
    
    if (!exactSheetName) {
      return res.status(404).json({ error: `Không tìm thấy sheet lớp ${classId}.` });
    }

    // First, we need to find the column for the date
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${exactSheetName.replaceAll("'", "''")}'`,
      valueRenderOption: 'FORMATTED_VALUE'
    });
    
    const rows = response.data.values || [];
    let nameColIdx = -1;
    let headerRowIdx = -1;
    
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      for (let j = 0; j < rows[i].length; j++) {
        const val = rows[i][j] ? rows[i][j].toString().toUpperCase() : '';
        if (val.includes('HỌ VÀ TÊN') || val.includes('TÊN HS')) {
          headerRowIdx = i;
          nameColIdx = j;
          break;
        }
      }
      if (headerRowIdx !== -1) break;
    }
    
    if (headerRowIdx < 0) return res.status(422).json({ error: 'Không tìm thấy cấu trúc bảng điểm danh.' });
    const resolvedRecords = resolveAttendanceRecords(rows, headerRowIdx, nameColIdx, records);
    let dateColIdx = -1;
    const dateRow = rows[headerRowIdx + 1] || [];
    
    for (let j = nameColIdx + 1; j < dateRow.length; j++) {
      const cellDate = dateRow[j] ? dateRow[j].toString().trim() : '';
      if (isDateMatch(cellDate, date)) {
        dateColIdx = j;
        break;
      }
    }
    
    // If date column not found, automatically create it at the end of the date row
    if (dateColIdx === -1) {
      dateColIdx = dateRow.length;
      if (dateColIdx <= nameColIdx) dateColIdx = nameColIdx + 2; // ensure it's after name and ID
      
      const reqDateParts = date.split('-');
      const formattedDate = `${reqDateParts[2]}/${reqDateParts[1]}/${reqDateParts[0]}`;
      
      // Ensure the sheet has enough columns to write the new date
      const sheetProps = metaResponse.data.sheets.find(s => s.properties.title === exactSheetName).properties;
      if (dateColIdx >= sheetProps.gridProperties.columnCount) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              appendDimension: {
                sheetId: sheetProps.sheetId,
                dimension: 'COLUMNS',
                length: 5
              }
            }]
          }
        });
      }
      
      // Update the date header cell in the sheet
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${exactSheetName.replaceAll("'", "''")}'!${colToLetter(dateColIdx)}${headerRowIdx + 2}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[formattedDate]] }
      });
    }
    
    // Prepare batch update
    const data = resolvedRecords.map(record => {
      let val = '';
      if (record.status === 'Có mặt') val = true;
      else if (record.status === 'Vắng') val = false;
      else val = record.note || record.status || '';
      
      return {
        range: `'${exactSheetName.replaceAll("'", "''")}'!${colToLetter(dateColIdx)}${record.rowIndex}`,
        values: [[val]]
      };
    });

    if (data.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: data
        }
      });
    }
    
    res.json({ success: true, message: 'Saved successfully' });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Financial writes are serialized in this server; see deployment notes.
const tuitionService = createTuitionService(getSheetsAPI, process.env);
app.get('/api/tuition', async (req, res) => {
  try { res.json(await tuitionService.list()); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
app.post('/api/tuition', async (req, res) => {
  try { res.json(await tuitionService.create(req.body, req.user.username)); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
app.post('/api/tuition/:id/retry', async (req, res) => {
  try { res.json(await tuitionService.retry(req.params.id)); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

// Add Class (Thêm Lớp Học)
app.post('/api/classes', async (req, res) => {
  try {
    const { id, name, grade, teacher, tuition, schedule } = req.body;
    const sheets = await getSheetsAPI();
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'DB_LopHoc!A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[id, name, grade, teacher, tuition, schedule]]
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Get Pending Students (Học sinh chờ duyệt)
app.get('/api/pending-students', async (req, res) => {
  try {
    const sheets = await getSheetsAPI();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'DB_ChoDuyet!A2:I',
    });
    const rows = response.data.values || [];
    const pending = rows.map(row => ({
      id: row[0] || '',
      date: row[1] || '',
      class: row[2] || '',
      name: row[3] || '',
      note: row[4] || '',
      reportedBy: row[5] || '',
      status: row[6] || 'Chờ duyệt',
      processedBy: row[7] || '',
      processedAt: row[8] || ''
    }));
    res.json(pending);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Add Pending Student (Trợ giảng báo cáo học sinh mới)
app.post('/api/pending-students', async (req, res) => {
  const { date, className, studentName, note } = req.body;
  try {
    const newId = 'CD-' + randomUUID();
    const reporter = req.user?.username || 'unknown';
    
    const sheets = await getSheetsAPI();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'DB_ChoDuyet!A:G',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[newId, date, className, studentName, note, reporter, 'Chờ duyệt']]
      }
    });
    res.json({ success: true, id: newId });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Delete/Approve Pending Student
app.post('/api/pending-students/:id/resolve', async (req, res) => {
  const { id } = req.params;
  try {
    const sheets = await getSheetsAPI();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'DB_ChoDuyet!A2:I',
    });
    const rows = response.data.values || [];
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === id) {
        rowIndex = i + 2; // +1 for 0-index, +1 for header
        break;
      }
    }
    
    if (rowIndex === -1) return res.status(404).json({ error: 'Not found' });
    
    if (rows[rowIndex - 2][6] === 'Đã xử lý') return res.json({ success: true });
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `DB_ChoDuyet!G${rowIndex}:I${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Đã xử lý', req.user.username, new Date().toISOString()]] }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Make sure to configure SPREADSHEET_ID in .env and place google-credentials.json`);
});
