import { google } from 'googleapis';
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
  const sheetName = '10T T5A K1';
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'`,
    valueRenderOption: 'FORMATTED_VALUE'
  });
  
  const rows = response.data.values || [];
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    console.log(`Row ${i}:`, rows[i]);
  }
}
run().catch(console.error);
