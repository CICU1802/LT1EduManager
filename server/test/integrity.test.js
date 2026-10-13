import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttendanceRecords, isDateMatch } from '../integrity.js';
import { createTuitionService } from '../tuition.js';

function fixture() {
  const state = { invoices: [], amount: 100000, date: '2026-09-01', writes: 0, fail: '', enrolled: [['HS1', 'L10'], ['HS1', 'L11']] };
  const sheets = { spreadsheets: {
    get: async () => ({ data: { sheets: [{ properties: { title: 'L10' } }, { properties: { title: 'L11' } }] } }),
    values: {
      get: async ({ range }) => {
        let rows;
        if (range.startsWith('DB_HocPhi')) rows = state.invoices;
        else if (range.startsWith('HOC_SINH_CAP')) throw Object.assign(new Error('missing'), { code: 400 });
        else if (range.startsWith('DB_HocSinh')) rows = [['HS1', 'An']];
        else if (range.startsWith('DB_LopHoc')) rows = [['L10'], ['L11']];
        else if (range.startsWith('DB_DangKyLop')) rows = state.enrolled;
        else rows = [['MÃ HS', 'THỰC ĐÓNG', 'NGÀY ĐÓNG'], ...(state.enrolled.some(r => r[0] === 'HS1' && range.includes(r[1])) ? [['HS1', state.amount, state.date]] : [])];
        return { data: { values: structuredClone(rows) } };
      },
      append: async ({ requestBody }) => { state.invoices.push(...structuredClone(requestBody.values)); return { data: {} }; },
      update: async ({ range, requestBody }) => {
        const row = Number(range.match(/J(\d+)/)[1]) - 2;
        state.invoices[row].splice(9, 3, ...requestBody.values[0]);
        return { data: {} };
      },
      batchUpdate: async ({ requestBody }) => {
        state.writes++;
        if (state.fail === 'before') { state.fail = ''; throw new Error('Network offline'); }
        state.amount = requestBody.data[0].values[0][0];
        state.date = requestBody.data[1].values[0][0];
        if (state.fail === 'after') { state.fail = ''; throw new Error('Response lost after Sheets committed'); }
        return { data: {} };
      }
    }
  } };
  const factory = () => createTuitionService(async () => sheets, { SPREADSHEET_ID: 'master' });
  return { state, service: factory(), factory };
}
const body = (overrides = {}) => ({ studentId: 'HS1', classId: 'L10', period: '2026-10', amount: 500000, date: '2026-10-12', method: 'Tiền mặt', status: 'Đã nộp', requestId: '00000000-0000-4000-8000-000000000001', ...overrides });

test('Attendance resolves a moved student from ID, ignoring stale browser rowIndex', () => {
  const rows = [['HỌ VÀ TÊN', 'MÃ HS'], ['', '', '12/10/2026'], ['Binh', 'HS2'], ['An', 'HS1']];
  assert.equal(resolveAttendanceRecords(rows, 0, 0, [{ id: 'HS1', status: 'Có mặt', rowIndex: 3 }])[0].rowIndex, 4);
  assert.throws(() => resolveAttendanceRecords([...rows, ['An', 'HS1']], 0, 0, [{ id: 'HS1', status: 'Có mặt' }]), /trùng/);
  assert.throws(() => resolveAttendanceRecords(rows, 0, 0, [{ id: '', status: 'Có mặt' }]), /thiếu/);
});
test('Dates match exact Vietnamese dates without substring or month/day ambiguity', () => {
  assert.equal(isDateMatch('12/10/2026', '2026-10-12'), true);
  assert.equal(isDateMatch('12/10', '2026-10-12'), true);
  assert.equal(isDateMatch('11/10/2026', '2026-10-01'), false);
  assert.equal(isDateMatch('10/12/2026', '2026-10-12'), false);
  assert.throws(() => isDateMatch('', '2026-02-30'), /không hợp lệ/);
});
test('Invoice allocates its full amount to the selected class and repeated requests do not duplicate', async () => {
  const { service, state } = fixture();
  const result = await service.create(body(), 'vanphong');
  assert.equal(result.tuition.syncStatus, 'Đã đồng bộ');
  assert.equal(state.amount, 600000);
  assert.equal(state.invoices[0][7], 'L10');
  await service.create(body(), 'vanphong');
  assert.equal(state.invoices.length, 1);
  assert.equal(state.writes, 1);
  await assert.rejects(service.create(body({ amount: 1 }), 'vanphong'), /nội dung khác/);
});
test('An unpaid invoice records debt without updating the class sheet', async () => {
  const { service, state } = fixture();
  assert.equal((await service.create(body({ status: 'Nợ' }), 'admin')).tuition.syncStatus, 'Không áp dụng');
  assert.equal(state.amount, 100000);
  assert.equal(state.writes, 0);
});
test('A failed write can be retried after server restart', async () => {
  const { service, state, factory } = fixture();
  state.fail = 'before';
  const result = await service.create(body(), 'admin');
  assert.equal(result.tuition.syncStatus, 'Lỗi đồng bộ');
  assert.equal(state.amount, 100000);
  assert.equal((await factory().retry(result.tuition.id)).tuition.syncStatus, 'Đã đồng bộ');
  assert.equal(state.amount, 600000);
});
test('Lost response after successful Sheets write cannot double the payment on retry', async () => {
  const { service, state, factory } = fixture();
  state.fail = 'after';
  const result = await service.create(body(), 'admin');
  assert.equal(result.tuition.syncStatus, 'Lỗi đồng bộ');
  assert.equal(state.amount, 600000);
  await factory().retry(result.tuition.id);
  assert.equal(state.amount, 600000);
  assert.equal(state.writes, 1);
});
test('Manual edits cause a visible reconciliation error rather than overwritten totals', async () => {
  const { service, state } = fixture();
  state.fail = 'before';
  const result = await service.create(body(), 'admin');
  state.amount = 200000;
  const retry = await service.retry(result.tuition.id);
  assert.equal(retry.tuition.syncStatus, 'Lỗi đồng bộ');
  assert.match(retry.tuition.syncError, /đối soát/);
  assert.equal(state.amount, 200000);
});
test('An unresolved payment blocks later payments to the same student/class', async () => {
  const { service, state } = fixture();
  state.fail = 'after';
  const first = await service.create(body(), 'admin');
  const second = await service.create(body({ requestId: '00000000-0000-4000-8000-000000000002' }), 'admin');
  assert.equal(second.tuition.syncStatus, 'Lỗi đồng bộ');
  assert.equal(state.amount, 600000);
  await service.retry(first.tuition.id);
  await service.retry(second.tuition.id);
  assert.equal(state.amount, 1100000);
});
test('Concurrent duplicate requests produce one ledger entry', async () => {
  const { service, state } = fixture();
  await Promise.all([service.create(body(), 'admin'), service.create(body(), 'admin')]);
  assert.equal(state.invoices.length, 1);
  assert.equal(state.writes, 1);
});
test('Rejects invalid amounts, dates and unregistered classes before appending', async () => {
  const { service, state } = fixture();
  await assert.rejects(service.create(body({ amount: -1 }), 'admin'));
  await assert.rejects(service.create(body({ date: '2026-02-30' }), 'admin'));
  state.enrolled = [];
  await assert.rejects(service.create(body(), 'admin'), /thiếu hoặc trùng/);
  assert.equal(state.invoices.length, 0);
});
test('Vietnam calendar defaults are correct around midnight regardless of system timezone', async () => {
  const { vietnamDate } = await import('../../student_management/src/utils/date.js');
  assert.equal(vietnamDate(new Date('2026-10-11T17:01:00Z')), '2026-10-12');
  assert.equal(vietnamDate(new Date('2026-10-11T16:59:00Z')), '2026-10-11');
});
