import { google } from 'googleapis';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  
  const spreadsheetId = process.env.SPREADSHEET_ID_ATTENDANCE_C3 || process.env.SPREADSHEET_ID;
  const classId = '10T T5A';
  
  const metaResponse = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTitles = metaResponse.data.sheets.map(s => s.properties.title);
  const exactSheetName = sheetTitles.find(t => t.trim().includes(classId.trim()));
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${exactSheetName}'`,
    valueRenderOption: 'FORMATTED_VALUE'
  });
  
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

  const students = [];
  for (let i = headerRowIdx + 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const studentName = row[nameColIdx];
    if (!studentName || studentName.toString().trim() === '') continue;
    
    students.push({
      name: studentName.toString().trim(),
      rowIndex: i + 1
    });
  }

  console.log(JSON.stringify(students, null, 2));
}
run().catch(console.error);
