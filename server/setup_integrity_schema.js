// Run without --apply to inspect. Never migrates or guesses historical invoices.
import dotenv from 'dotenv';
import { google } from 'googleapis';
dotenv.config();
const credentials = process.env.GOOGLE_CREDENTIALS_JSON ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) : undefined;
const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'], ...(credentials ? { credentials } : { keyFile: './google-credentials.json' }) });
const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
const spreadsheetId = process.env.SPREADSHEET_ID;
if (!spreadsheetId) throw new Error('Missing SPREADSHEET_ID');
const meta = await sheets.spreadsheets.get({ spreadsheetId });
const changes = [
  { title: 'DB_HocPhi', start: 'H1', end: 'N1', width: 14, headers: ['Lớp', 'Kỳ học', 'Trạng thái đồng bộ', 'Lỗi đồng bộ', 'Kế hoạch đồng bộ', 'Mã yêu cầu', 'Người lập'] },
  { title: 'DB_ChoDuyet', start: 'H1', end: 'I1', width: 9, headers: ['Người xử lý', 'Thời điểm xử lý'] }
];
const data = [], requests = [];
for (const change of changes) {
  const props = meta.data.sheets.find(s => s.properties.title === change.title)?.properties;
  if (!props) throw new Error(`Missing ${change.title}`);
  const range = `${change.title}!${change.start}:${change.end}`;
  const old = (await sheets.spreadsheets.values.get({ spreadsheetId, range })).data.values?.[0] || [];
  if (old.some((value, index) => value && value !== change.headers[index])) throw new Error(`Existing incompatible columns: ${range}. Reconcile before applying.`);
  if (props.gridProperties.columnCount < change.width) requests.push({ appendDimension: { sheetId: props.sheetId, dimension: 'COLUMNS', length: change.width - props.gridProperties.columnCount } });
  data.push({ range, values: [change.headers] });
}
if (!process.argv.includes('--apply')) {
  console.log('Dry run: columns to add/check:', data.map(d => d.range).join(', '));
  console.log('Run with --apply after backing up the spreadsheet.');
} else {
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  console.log('Schema headers updated. Existing rows retained.');
}
