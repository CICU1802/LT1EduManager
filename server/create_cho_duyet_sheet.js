import { google } from 'googleapis';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  let authOptions = { scopes: ['https://www.googleapis.com/auth/spreadsheets'] };
  if (fs.existsSync('google-credentials.json')) {
    authOptions.keyFile = 'google-credentials.json';
  } else {
    authOptions.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  }
  const auth = new google.auth.GoogleAuth(authOptions);
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = 'DB_ChoDuyet';
  
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.find(s => s.properties.title === sheetName);
  
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: { properties: { title: sheetName } }
        }]
      }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:G1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [["ID", "Ngày", "Lớp", "Tên học sinh", "SĐT/Ghi chú", "Người báo cáo", "Trạng thái"]]
      }
    });
    console.log('Created DB_ChoDuyet');
  } else {
    console.log('DB_ChoDuyet already exists');
  }
}
run().catch(console.error);
