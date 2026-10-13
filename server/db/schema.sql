CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS students (
 id text PRIMARY KEY, name text NOT NULL CHECK(length(trim(name))>0), profile jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS students_name_idx ON students(lower(name));
CREATE TABLE IF NOT EXISTS classes (
 id text PRIMARY KEY, name text NOT NULL, academic_year text NOT NULL, course text NOT NULL DEFAULT '',
 kind text NOT NULL CHECK(kind IN ('attendance','tuition','manual')), profile jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS enrollments (
 student_id text NOT NULL REFERENCES students(id), class_id text NOT NULL REFERENCES classes(id),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','transferred')),
 base_paid bigint NOT NULL DEFAULT 0 CHECK(base_paid>=0), base_due bigint CHECK(base_due>=0),
 baseline_date date, details jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(student_id,class_id)
);
CREATE TABLE IF NOT EXISTS invoices (
 id text PRIMARY KEY, request_id text UNIQUE NOT NULL, student_id text NOT NULL, class_id text NOT NULL,
 period text NOT NULL, amount bigint NOT NULL CHECK(amount>0), status text NOT NULL CHECK(status IN ('Đã nộp','Nợ')),
 collection_date date NOT NULL, method text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(student_id,class_id) REFERENCES enrollments(student_id,class_id)
);
CREATE INDEX IF NOT EXISTS invoices_report_idx ON invoices(collection_date,status);
CREATE TABLE IF NOT EXISTS attendance (
 student_id text NOT NULL, class_id text NOT NULL, attendance_date date NOT NULL,
 status text NOT NULL CHECK(status IN ('Có mặt','Vắng','Khác')), note text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(student_id,class_id) REFERENCES enrollments(student_id,class_id), PRIMARY KEY(student_id,class_id,attendance_date)
);
CREATE TABLE IF NOT EXISTS pending_students (
 id text PRIMARY KEY, data jsonb NOT NULL, status text NOT NULL DEFAULT 'Chờ duyệt', created_by text NOT NULL,
 processed_by text, processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS import_documents (
 id text PRIMARY KEY, digest text UNIQUE NOT NULL, filename text NOT NULL, academic_year text NOT NULL,
 workbook bytea NOT NULL, analysis jsonb NOT NULL, state text NOT NULL DEFAULT 'preview' CHECK(state IN ('preview','committed')),
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), committed_at timestamptz
);
CREATE TABLE IF NOT EXISTS import_bindings (
 document_id text NOT NULL REFERENCES import_documents(id), item_key text NOT NULL, sheet_name text NOT NULL,
 row_number integer NOT NULL, student_id text REFERENCES students(id), class_id text REFERENCES classes(id),
 kind text NOT NULL, PRIMARY KEY(document_id,item_key)
);
CREATE TABLE IF NOT EXISTS legacy_records (
 document_id text NOT NULL REFERENCES import_documents(id), item_key text NOT NULL, kind text NOT NULL,
 data jsonb NOT NULL, PRIMARY KEY(document_id,item_key)
);
CREATE TABLE IF NOT EXISTS audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL, action text NOT NULL, entity text NOT NULL,
 before_data jsonb, after_data jsonb, document_id text REFERENCES import_documents(id), created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS system_state (id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL DEFAULT 0);
INSERT INTO system_state(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS migration_archives (
 id text PRIMARY KEY, digest text UNIQUE NOT NULL, datasets jsonb NOT NULL,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

-- Attendance operations v2. Existing rows belong to the default daily session.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS session_key text NOT NULL DEFAULT 'default';
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_pkey;
ALTER TABLE attendance ADD PRIMARY KEY(student_id,class_id,attendance_date,session_key);
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_status_check CHECK(status IN ('Có mặt','Vắng','Đi trễ','Vắng có phép','Khác','Chưa điểm danh'));
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS starts_on date;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS ends_on date;
CREATE TABLE IF NOT EXISTS class_sessions (
 class_id text NOT NULL REFERENCES classes(id), session_date date NOT NULL, session_key text NOT NULL,
 label text NOT NULL, reason text NOT NULL DEFAULT '', created_by text NOT NULL,
 PRIMARY KEY(class_id,session_date,session_key)
);
CREATE TABLE IF NOT EXISTS operation_requests (
 id text PRIMARY KEY, payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS parent_tasks (
 id text PRIMARY KEY, student_id text NOT NULL REFERENCES students(id), class_id text NOT NULL REFERENCES classes(id),
 episode text NOT NULL, status text NOT NULL DEFAULT 'open', note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), resolved_by text, resolved_at timestamptz,
 UNIQUE(student_id,class_id,episode)
);
CREATE TABLE IF NOT EXISTS makeup_lessons (
 id text PRIMARY KEY, student_id text NOT NULL REFERENCES students(id), source_class text NOT NULL REFERENCES classes(id),
 source_date date NOT NULL, source_session text NOT NULL, target_class text NOT NULL REFERENCES classes(id),
 target_date date NOT NULL, target_session text NOT NULL, note text NOT NULL DEFAULT '', created_by text NOT NULL,
 UNIQUE(student_id,source_class,source_date,source_session)
);
CREATE TABLE IF NOT EXISTS families (id text PRIMARY KEY, name text NOT NULL);
ALTER TABLE students ADD COLUMN IF NOT EXISTS family_id text REFERENCES families(id);
CREATE TABLE IF NOT EXISTS student_results (
 id text PRIMARY KEY, student_id text NOT NULL REFERENCES students(id), class_id text NOT NULL REFERENCES classes(id),
 title text NOT NULL, test_date date NOT NULL, score numeric NOT NULL, maximum numeric NOT NULL CHECK(maximum>0),
 created_by text NOT NULL, CHECK(score>=0 AND score<=maximum)
);
INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;
ALTER TABLE families ADD COLUMN IF NOT EXISTS discount_percent numeric NOT NULL DEFAULT 0 CHECK(discount_percent>=0 AND discount_percent<=100);

ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS starts_at time NOT NULL DEFAULT '00:00';
CREATE TABLE IF NOT EXISTS enrollment_periods (
 student_id text NOT NULL, class_id text NOT NULL, starts_on date NOT NULL, ends_on date,
 PRIMARY KEY(student_id,class_id,starts_on), FOREIGN KEY(student_id,class_id) REFERENCES enrollments(student_id,class_id),
 CHECK(ends_on IS NULL OR ends_on>starts_on)
);
CREATE INDEX IF NOT EXISTS attendance_audit_context_idx ON audit_log((after_data->>'classId'),(after_data->>'date'),(after_data->>'sessionKey')) WHERE action='attendance.save';
