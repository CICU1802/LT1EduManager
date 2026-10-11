import { randomUUID } from 'node:crypto';
import { invalid, money, isDateMatch } from './integrity.js';
const columns = ['id', 'studentId', 'studentName', 'amount', 'date', 'method', 'status', 'classId', 'period', 'syncStatus', 'syncError', 'plan', 'requestId', 'createdBy'];
const quote = title => `'${title.replaceAll("'", "''")}'`;
const letter = index => { let s = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
export function createTuitionService(getSheets, env) {
  let queue = Promise.resolve();
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const read = async (sheets, spreadsheetId, range) => (await sheets.spreadsheets.values.get({ spreadsheetId, range })).data.values || [];
  const listRows = sheets => read(sheets, env.SPREADSHEET_ID, 'DB_HocPhi!A2:N');
  const decode = row => Object.fromEntries(columns.map((key, i) => [key, row[i] || '']));
  const update = (sheets, row, values) => sheets.spreadsheets.values.update({ spreadsheetId: env.SPREADSHEET_ID, range: `DB_HocPhi!J${row}:L${row}`, valueInputOption: 'RAW', requestBody: { values: [values] } });
  async function target(sheets, invoice) {
    const spreadsheetId = /10|11|12|ĐGNL/.test(invoice.classId.toUpperCase()) ? env.SPREADSHEET_ID_TUITION_C3 || env.SPREADSHEET_ID : env.SPREADSHEET_ID_TUITION_C2 || env.SPREADSHEET_ID;
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const title = meta.data.sheets.map(s => s.properties.title).find(t => t.trim() === invoice.classId.trim());
    if (!title) throw invalid('Không tìm thấy sheet học phí của lớp.');
    const rows = await read(sheets, spreadsheetId, quote(title));
    const header = rows.findIndex((r, i) => i < 15 && r.some(v => String(v).trim().toUpperCase() === 'MÃ HS'));
    if (header < 0) throw invalid('Không tìm thấy cấu trúc học phí.');
    const find = name => rows[header].findIndex(v => String(v).trim().toUpperCase() === name);
    const idCol = find('MÃ HS'), amountCol = find('THỰC ĐÓNG'), dateCol = find('NGÀY ĐÓNG');
    if (amountCol < 0 || dateCol < 0) throw invalid('Thiếu cột THỰC ĐÓNG hoặc NGÀY ĐÓNG.');
    const matches = rows.flatMap((r, i) => i > header && String(r[idCol] || '').trim() === invoice.studentId ? [i] : []);
    if (matches.length !== 1) throw invalid('Mã học sinh thiếu hoặc trùng trong sheet học phí.');
    const row = matches[0];
    return { spreadsheetId, title, row: row + 1, amountCol, dateCol, current: money(rows[row][amountCol]), previousDate: String(rows[row][dateCol] || '') };
  }
  async function sync(sheets, invoice, row) {
    if (invoice.status !== 'Đã nộp') return { ...invoice, syncStatus: 'Không áp dụng' };
    if (invoice.syncStatus === 'Đã đồng bộ') return invoice;
    try {
      // Prevent another invoice from overtaking an unresolved write to the same account.
      const other = (await listRows(sheets)).map(decode).find(t => t.id !== invoice.id && t.studentId === invoice.studentId && t.classId === invoice.classId && t.plan && t.syncStatus !== 'Đã đồng bộ');
      if (other) throw invalid(`Cần xử lý đồng bộ hóa đơn ${other.id} trước.`);
      const dest = await target(sheets, invoice);
      let plan = invoice.plan ? JSON.parse(invoice.plan) : null;
      if (!plan) {
        plan = { spreadsheetId: dest.spreadsheetId, title: dest.title, before: dest.current, after: dest.current + money(invoice.amount), previousDate: dest.previousDate };
        invoice.plan = JSON.stringify(plan);
        // Persist absolute target BEFORE issuing the write: safe to retry after a timeout/restart.
        await update(sheets, row, ['Chờ đồng bộ', '', invoice.plan]);
      }
      if (plan.spreadsheetId !== dest.spreadsheetId || plan.title !== dest.title) throw invalid('Đích đồng bộ đã thay đổi. Cần đối soát.');
      if (dest.current === plan.after && dest.previousDate === invoice.date) {
        // The previous attempt already reached Sheets.
      } else if (dest.current === plan.before && dest.previousDate === plan.previousDate) {
        await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: dest.spreadsheetId, requestBody: { valueInputOption: 'RAW', data: [
          { range: `${quote(dest.title)}!${letter(dest.amountCol)}${dest.row}`, values: [[plan.after]] },
          { range: `${quote(dest.title)}!${letter(dest.dateCol)}${dest.row}`, values: [[invoice.date]] }
        ] } });
      } else throw invalid('Số tiền hoặc ngày trên Sheets đã thay đổi. Cần đối soát trước khi thử lại.');
      await update(sheets, row, ['Đã đồng bộ', '', invoice.plan]);
      return { ...invoice, syncStatus: 'Đã đồng bộ', syncError: '' };
    } catch (error) {
      await update(sheets, row, ['Lỗi đồng bộ', error.message, invoice.plan || '']);
      return { ...invoice, syncStatus: 'Lỗi đồng bộ', syncError: error.message };
    }
  }
  return {
    async list() { const sheets = await getSheets(); const names = Object.fromEntries(await read(sheets, env.SPREADSHEET_ID, 'DB_HocSinh!A2:B')); return (await listRows(sheets)).map(row => { const t = decode(row); delete t.plan; delete t.requestId; return { ...t, studentName: t.studentName || names[t.studentId] || 'Unknown', syncStatus: t.syncStatus || 'Dữ liệu cũ — cần đối soát' }; }); },
    create(body, user) { return serial(async () => {
      const sheets = await getSheets();
      const invoice = Object.fromEntries(['studentId', 'classId', 'period', 'date', 'method', 'status', 'requestId'].map(k => [k, String(body[k] || '').trim()]));
      if (!invoice.studentId || !invoice.classId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(invoice.period) || !/^[a-zA-Z0-9-]{16,100}$/.test(invoice.requestId)) throw invalid('Cần mã học sinh, lớp, kỳ học YYYY-MM và mã yêu cầu hợp lệ.');
      isDateMatch(invoice.date, invoice.date);
      invoice.amount = money(body.amount);
      if (!Number.isSafeInteger(invoice.amount) || invoice.amount <= 0 || !['Đã nộp', 'Nợ'].includes(invoice.status) || !['Tiền mặt', 'Chuyển khoản', 'Khác'].includes(invoice.method)) throw invalid('Số tiền, trạng thái hoặc phương thức không hợp lệ.');
      let rows = await listRows(sheets);
      const existingIndex = rows.findIndex(r => r[12] === invoice.requestId);
      if (existingIndex >= 0) {
        const old = decode(rows[existingIndex]);
        if (['studentId', 'classId', 'period', 'date', 'method', 'status', 'amount'].some(k => String(old[k]) !== String(invoice[k]))) throw invalid('Mã yêu cầu đã được dùng cho nội dung khác.', 409);
        return { success: true, tuition: await sync(sheets, old, existingIndex + 2) };
      }
      const students = await read(sheets, env.SPREADSHEET_ID, 'DB_HocSinh!A2:B');
      if (!students.some(r => r[0] === invoice.studentId)) throw invalid('Mã học sinh không tồn tại.');
      const classes = await read(sheets, env.SPREADSHEET_ID, 'DB_LopHoc!A2:A');
      if (!classes.some(r => r[0] === invoice.classId)) throw invalid('Lớp không tồn tại.');
      const enrollments = await read(sheets, env.SPREADSHEET_ID, 'DB_DangKyLop!A2:C');
      if (!enrollments.some(r => r[0] === invoice.studentId && r[1] === invoice.classId)) throw invalid('Học sinh chưa đăng ký lớp đã chọn.');
      Object.assign(invoice, { id: `HD-${randomUUID()}`, createdBy: user, syncStatus: invoice.status === 'Đã nộp' ? 'Chờ đồng bộ' : 'Không áp dụng' });
      await sheets.spreadsheets.values.append({ spreadsheetId: env.SPREADSHEET_ID, range: 'DB_HocPhi!A:N', valueInputOption: 'RAW', requestBody: { values: [columns.map(k => invoice[k] ?? '')] } });
      rows = await listRows(sheets);
      const row = rows.findIndex(r => r[0] === invoice.id) + 2;
      if (row < 2) throw invalid('Không xác nhận được hóa đơn đã lưu. Hãy thử lại cùng yêu cầu.', 503);
      return { success: true, tuition: await sync(sheets, invoice, row) };
    }); },
    retry(id) { return serial(async () => {
      const sheets = await getSheets(), rows = await listRows(sheets), index = rows.findIndex(r => r[0] === id);
      if (index < 0) throw invalid('Không tìm thấy hóa đơn.', 404);
      const invoice = decode(rows[index]);
      if (!invoice.classId || !invoice.period) throw invalid('Hóa đơn cũ chưa có lớp/kỳ học. Cần đối soát thủ công.');
      return { success: true, tuition: await sync(sheets, invoice, index + 2) };
    }); }
  };
}
