export function invalid(message, status = 422) {
  return Object.assign(new Error(message), { status });
}
export function isDateMatch(cell, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw invalid('Ngày không hợp lệ.');
  const [y, m, d] = date.split('-').map(Number);
  const check = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== date) throw invalid('Ngày không hợp lệ.');
  const text = String(cell || '').trim();
  if (text === date) return true;
  // Sheets use Vietnamese day/month order. Match complete date tokens only.
  const match = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  return !!match && +match[1] === d && +match[2] === m &&
    (!match[3] || +match[3] === y || (match[3].length === 2 && +match[3] === y % 100));
}
export function resolveAttendanceRecords(rows, header, nameCol, records) {
  if (!Array.isArray(records) || !records.length) throw invalid('Chưa có bản ghi điểm danh.');
  const seen = new Set();
  return records.map(record => {
    const id = String(record.id || '').trim();
    if (!id || seen.has(id)) throw invalid('Mã học sinh bị thiếu hoặc trùng.');
    seen.add(id);
    if (!['Có mặt', 'Vắng', 'Khác'].includes(record.status)) throw invalid('Trạng thái điểm danh không hợp lệ.');
    const matches = rows.flatMap((row, i) => i > header + 1 && row[nameCol] &&
      String(row[nameCol + 1] || '').trim() === id ? [i + 1] : []);
    if (matches.length !== 1) throw invalid(`Mã ${id} không tồn tại hoặc bị trùng trong lớp. Vui lòng tải lại danh sách.`, 409);
    return { ...record, rowIndex: matches[0] };
  });
}
export function money(value) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);
  if (/^\d{1,3}([.,]\d{3})+(\s*(đ|₫|VND))?$/i.test(text)) return Number(text.replace(/\D/g, ''));
  throw invalid(`Số tiền không hợp lệ: ${text}`);
}
