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
  
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  console.log(meta.data.sheets.map(s => s.properties.title));
}
run().catch(console.error);
