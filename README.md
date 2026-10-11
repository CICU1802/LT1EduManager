# LT1EduManager

React/Vite frontend (`student_management`) and Express + Google Sheets backend (`server`).

## Financial and attendance integrity update

- Each new invoice is for one student, one class and one monthly period (`YYYY-MM`). To pay multiple classes, create separate invoices with the actual amounts. A debt invoice never changes the class sheet's collected total.
- New invoice columns in `DB_HocPhi`: H class ID, I period, J synchronization status, K error, L durable absolute synchronization plan, M request ID, N creator. A:G retain their previous meaning.
- Synchronization updates the selected class's existing cumulative `THỰC ĐÓNG` and `NGÀY ĐÓNG` fields. The period is recorded in the invoice ledger, not a new monthly column in legacy class sheets. Select the appropriate current class/period; legacy sheets are not automatically reset for a new month.
- A persisted request ID prevents duplicate invoice submission; the browser keeps the draft in session storage across reloads. Retrying an invoice reuses an absolute target rather than blindly adding the amount again. If a previous write committed but its response was lost, the retry recognizes the target. Conflicting manual edits produce a visible reconciliation error.
- New payments to the same student/class wait behind unresolved synchronization plans. Resolve the earlier invoice using its retry button first. Historical invoices without class/period metadata remain visible and cannot be automatically retried or redistributed.
- This Google Sheets implementation requires **one running backend process/replica**. Its write queue is process-local. Sheets offers no compare-and-swap or transactions across spreadsheets. Do not concurrently sort, insert/delete rows, or edit collected totals while requests are saving. A shared transactional datastore/lock is required before horizontal scaling.
- Attendance resolves IDs from a fresh sheet read before writing, ignoring browser row indices. Missing/duplicate IDs fail before date headers or attendance are changed. The name column must be immediately followed by a unique student ID column; there is no name-based fallback.
- `DB_ChoDuyet` preserves processed rows: G status, H processor, I ISO UTC processing timestamp. Dashboard shows separate pending/history views.
- Student, invoice and pending-report IDs use prefixed UUIDs. Existing IDs are unchanged.
- Default calendar dates use `Asia/Ho_Chi_Minh`. Dashboard revenue has a month selector, sums only paid invoices by collection date, and removes fixed demo metrics. Class count represents the whole class catalogue; mean roster size is derived from active student records and exact comma-separated class IDs.

## Deployment

1. Back up the affected Google spreadsheets. Verify that `DB_HocPhi` H:N and `DB_ChoDuyet` H:I are unused or have the expected headers. Confirm each student/class pair exists in `DB_DangKyLop` A:B. Existing free-text `DB_HocSinh` class names alone are not accepted as enrollment evidence.
2. In `server`, install dependencies with `npm ci`. Existing environment variables and service-account configuration are retained.
3. Inspect `node setup_integrity_schema.js`; run `node setup_integrity_schema.js --apply` to add headers/capacity after checking the dry run. The script refuses incompatible existing headers and does not rewrite historical invoices.
4. Deploy the backend and frontend together. Older clients lack class/period/request ID and will receive a validation error. Refresh open browser tabs. The old destructive pending-report DELETE endpoint has been replaced by POST `/api/pending-students/:id/resolve`.
5. Keep backend replicas/process count at one. Exercise a paid invoice, an unpaid invoice, a failed sync/retry and reordered attendance rows against a **test copy** of the spreadsheet before production use.

No live spreadsheets were changed by this code update. Authentication/role enforcement is a separate follow-up.

## Verification

- `cd server && npm test`: mocked Sheets integration tests cover paid vs unpaid, selected-class allocation, duplicate/concurrent requests, network failure before and after commit, restart-safe retries, reconciliation conflicts and reordered attendance rows.
- `cd student_management && npm ci && npm run build && npm run lint`.
