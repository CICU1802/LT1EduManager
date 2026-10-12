# PostgreSQL and LT1 Excel workflows

The database code and Excel review interface are implemented. Production stays on Sheets until a PostgreSQL connection, schema, initial migration and explicit cutover are configured. Deploying this change alone does not migrate or alter live records.

## Data ownership

PostgreSQL holds students, academic-year classes, enrollments, attendance, invoice receipts, opening fee balances, pending reports, original workbook templates and audit history. Excel is an import/export interface, not a second live datastore.

- Stable student IDs are retained. Classes are separated by academic year. Original sheet names distinguish lesson groups and courses; fee sheets and attendance sheets with different names are not silently merged.
- “THỰC ĐÓNG” from a fee sheet is an opening/current balance snapshot, not a newly collected invoice. On a reviewed reimport, the snapshot replaces the account total after subtracting already-recorded paid invoices. It is never added again. Debt invoices do not increase collected totals.
- Monthly revenue uses dated receipts. A historical cumulative fee balance does not provide enough information to invent dated receipts or allocate a combined receipt between classes.
- Attendance is keyed by student ID, class ID and date. Future zeros are excluded using the file's declared cutoff. Existing conflicting marks are displayed for review. Missing-ID rows require explicit matching or explicit profile creation unless a unique name and matching school/phone identify an existing profile.
- Tabs for discounts, reminders and combined receipts are stored as references in the original workbook. This version does not automatically turn free-form notes or combined payments into operational invoices, discount rules or pending reports.
- Hidden tabs are parsed and retained; the UI leaves them unselected by default. Duplicate IDs and conflicting identity data are blocked. Blank cells do not erase existing student phone/school fields. Generic Excel contact numbers are retained with their enrollment/source and do not overwrite a known student phone number or assume a parent/student role.

## Setup and cutover

Use a managed PostgreSQL database with private credentials, durable storage and backups. Render is an available integration for the existing backend; it can be connected to provision/configure the datastore. Keep the database close to the backend to avoid excessive latency during imports. The connection string belongs in backend secret environment variables, never in `VITE_*`, Git or the frontend.

1. Keep `DATA_BACKEND=sheets` (or unset it) initially. Set `DATABASE_URL` on the backend. Use the service provider's verified TLS connection settings. Install server dependencies with `npm ci`.
2. Run `npm run db:migrate` in `server`. The schema migration is transactional and uses a PostgreSQL advisory lock. The `/api/data/status` endpoint reports configuration/readiness; the UI will not allow imports into a dormant database.
3. Set `MIGRATION_ACADEMIC_YEAR`, e.g. `2026-2027`. With the existing Sheets credentials and master `SPREADSHEET_ID`, run `npm run db:seed-sheets` to inspect counts. This is read-only by default. Review the master IDs and registrations, then run `npm run db:seed-sheets -- --apply` against an empty database. The script preserves IDs and pending-report history, copies a private source archive, imports fully allocated/dated valid receipts and archives receipts that cannot be safely matched. It refuses duplicate IDs, broken registrations or overwriting an existing database. It never writes to Google Sheets.
4. Configure `AUTH_USERS_JSON` as a secret JSON object: each username maps to `{ "pass": "a unique strong password", "role": "admin" }`, with roles `admin`, `vanphong` or `trogiang`. PostgreSQL mode refuses startup with demo credentials or passwords shorter than 12 characters. Provide the new credentials securely to the center's users.
5. Test against a staging database first. Freeze operational writes during the final master snapshot/cutover. Set `DATA_BACKEND=postgres` and redeploy the backend. A configured PostgreSQL failure returns an error; it never falls back to Sheets for writes.
6. Import the original attendance/fee workbooks through **Nhập & xuất Excel**. Select the correct academic year and actual date to which each file is complete. Review identity mapping, hidden courses and changed balances before confirming. Save a reviewed export and compare representative accounts and dates with the source before resuming normal operation.

## Import API and review

`POST /api/data/preview` accepts raw `.xlsx` bytes with headers `X-Filename` (URI-encoded), `X-Academic-Year` and `X-Snapshot-Date`. Maximum compressed size is 12 MB. Macro/encrypted/invalid packages and excessive decompressed sizes are rejected. Imported strings and formula cached values are inspected; formulas are never evaluated and workbook links are never fetched.

The preview labels rows as ready, review, invalid, unchanged or reference. It carries a database revision. `POST /api/data/imports/:id/commit` takes that revision and explicit per-row decisions. Any intervening operational write invalidates the preview; analyze again instead of overwriting newer data. The entire selected batch commits or rolls back together. Exact file/year/cutoff repeats reuse the same import record and cannot be applied twice. File identity alone is not the record key; changing row order cannot create duplicated attendance or add balances twice.

For a missing-ID row, select an existing ID or create a new profile. Multiple rows can explicitly reference a profile created elsewhere in the same import with `studentId: "new:<item key>"`; its creating row must be selected. Distinct same-name people are not automatically collapsed. Editing a source ID or ambiguous money/date text should be done in Excel and reuploaded, rather than overridden through unvalidated JSON fields.

Only admins/office staff can import, export, inspect balances or edit financial records. Assistants can save attendance and pending reports. Audit rows record actor, original state, resulting state and source import.

## Export fidelity and scope

`GET /api/data/imports/:id/export` starts with the committed original workbook bytes stored privately in PostgreSQL. It patches only managed roster/contact/fee/attendance cells by the bound student and class IDs. It preserves sheet order and visibility, existing cell styles, merged ranges, column widths, row heights, drawings, print settings and formulas outside managed fields.

The export is for the sheets represented by that chosen template, not every unrelated class in the database. Unmapped original rows and reference tabs are copied unchanged and explicitly reported by `X-LT1-Unmapped-Rows` and the UI. They are not represented as synchronized operational records. New students in a represented class fill original blank rows; if space is exhausted or an unresolved source row could duplicate that student, export stops with a visible error. Extend/review the template rather than silently omitting records or changing its layout.

Computed values in managed fee cells may be replaced by database numbers; formulas in unmanaged cells remain intact. Spreadsheet-engine recalculation and complex template-native totals should be compared in Excel during the staging acceptance step. No universal free-form Excel parser is claimed: unsupported tabs and ambiguous entries remain references/review items.

## Verification

- `npm --prefix server test`: existing Sheets integrity checks plus PostgreSQL-engine tests (PGlite) for import atomicity, repeat protection, stale previews, missing IDs, balance reconciliation, receipt idempotency, export capacity and package/layout preservation.
- `npm --prefix student_management run build` and `npm --prefix student_management run lint`.
- `npx playwright install chromium` in `student_management`, then `npm run test:ui` and `npm run test:excel-ui`. Browser tests use production assets and intercepted fixture APIs; no real records are written. `CHROMIUM_PATH` can select an existing Chromium executable.

SQL/schema behavior is tested with an embedded PostgreSQL engine. Managed-server connectivity, cross-process concurrency, TLS, backup restoration and native Excel recalculation remain staging checks before cutover. The web app continues to use its existing Sheets source until that step is completed.
