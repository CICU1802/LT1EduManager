# LT1EduManager

React/Vite frontend (`student_management`) and Express + Google Sheets backend (`server`).

## Financial and attendance integrity update

- Each new invoice is for one student, one class and one monthly period (`YYYY-MM`). To pay multiple classes, create separate invoices with the actual amounts. A debt invoice never changes the class sheet's collected total.
- New invoice columns in `DB_HocPhi`: H class ID, I period, J synchronization status, K error, L durable absolute synchronization plan, M request ID, N creator. A:G retain their previous meaning.
- Synchronization updates the selected class's existing cumulative `THỰC ĐÓNG` and `NGÀY ĐÓNG` fields. The period is recorded in the invoice ledger, not a new monthly column in legacy class sheets. Select the appropriate current class/period; legacy sheets are not automatically reset for a new month.
- A persisted request ID prevents duplicate invoice submission; the browser keeps the draft in session storage across reloads. Retrying an invoice reuses an absolute target rather than blindly adding the amount again. If a previous write committed but its response was lost, the retry recognizes the target. Conflicting manual edits produce a visible reconciliation error.
- New payments to the same student/class wait behind unresolved synchronization plans. Resolve the earlier invoice using its retry button first. Historical invoices without class/period metadata remain visible and cannot be automatically retried or redistributed.
- This Google Sheets implementation requires **one running backend process/replica**. Its write queue is process-local. Sheets offers no compare-and-swap or transactions across spreadsheets. Do not concurrently sort, insert/delete rows, or edit collected totals while requests are saving. A shared transactional datastore/lock is required before horizontal scaling.
- Attendance resolves the `ma_hs` column from a fresh sheet read before writing, ignoring browser row indices. Missing/duplicate IDs fail before date headers or attendance are changed; there is no name-based fallback.
- `DB_ChoDuyet` preserves processed rows: G status, H processor, I ISO UTC processing timestamp. Dashboard shows separate pending/history views.
- New student IDs use `YYYY-NNNNNN`; invoice and pending-report IDs remain request-safe internal identifiers.
- Default calendar dates use `Asia/Ho_Chi_Minh`. Dashboard revenue has a month selector, sums only paid invoices by collection date, and removes fixed demo metrics. Class count represents the whole class catalogue; mean roster size is derived from active student records and exact comma-separated class IDs.

## Deployment

### Google Sheets schema 2026–2027

The Sheets backend accepts the normalized LT1 workbooks directly:

- Student tabs: `HOC_SINH_CAP2` and `HOC_SINH_CAP3`, columns `ma_hs` through `ghi_chu`.
- Attendance class tabs: metadata in rows 1–5, headcount in row 6, week labels in row 7, headers in row 8, exactly twelve attendance columns C:N and notes in O.
- Attendance values are stored as `CM`, `ON`, `TR`, `BU`, `P`, `K`, `LE` or blank. Rows whose `ma_hs` is still blank remain visible and read-only in the web app.
- Tuition class tabs use the row-8 headers `ma_hs`, `ho_ten`, `ca_so`, `ca_hinh`, `hoc_phi_niem_yet`, `so_tien_giam`, `ly_do_giam`, `phai_dong`, `so_tien_thuc_nhan`, `con_thieu`, `ghi_chu`. Payment synchronization updates only `so_tien_thuc_nhan`; formula columns are left to Sheets.
- The class list is discovered from attendance sheet names (`{ma_lop}_{ma_khoa}`), so `DB_LopHoc` and the old class-name field in `DB_HocSinh` are no longer required. Internal audit, pending-student and payment-ledger tabs are created only when those web workflows are first used.

Configure `SPREADSHEET_ID_STUDENTS`, `SPREADSHEET_ID_ATTENDANCE_C2`, `SPREADSHEET_ID_ATTENDANCE_C3`, `SPREADSHEET_ID_TUITION_C2` and `SPREADSHEET_ID_TUITION_C3`. `SPREADSHEET_ID` remains the backward-compatible fallback. Use `ATTENDANCE_SHEET_MAP_JSON` or `TUITION_SHEET_MAP_JSON` only for exceptional names that do not match the web class ID.

1. Back up the five normalized Google spreadsheets and share them with the backend service account.
2. Set the five spreadsheet IDs above on the backend. Keep `DATA_BACKEND=sheets`, one backend process/replica, and strong `AUTH_USERS_JSON` credentials.
3. In `server`, run `npm ci` and `npm test`; in `student_management`, run `npm ci`, `npm run build`, `npm run lint` and `npm run test:attendance`.
4. Deploy backend and frontend together, then refresh open browser tabs.
5. Exercise one attendance edit for every status code and one paid invoice against a test copy before using production Sheets.

No live spreadsheets were changed by this code update. Authentication/role enforcement is a separate follow-up.

## Verification

- `cd server && npm test`: mocked Sheets integration tests cover paid vs unpaid, selected-class allocation, duplicate/concurrent requests, network failure before and after commit, restart-safe retries, reconciliation conflicts and reordered attendance rows.
- `cd student_management && npm ci && npm run build && npm run lint`.

## PostgreSQL and reviewed Excel exchange

The **Nhập & xuất Excel** screen supports file analysis, identity matching, reviewed transactional import and template-preserving export. PostgreSQL stores operational data and import/audit history. Until a database is connected and `DATA_BACKEND=postgres` is explicitly configured, production continues using Sheets; file analysis is available without database writes.

See [database setup, migration and Excel behavior](docs/DATABASE_EXCEL.md) for cutover steps, source-template scope and the handling of legacy/ambiguous payments. Original student workbooks and credentials must remain private and are not committed to this repository.
