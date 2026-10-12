import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { createDatabase } from '../db/database.js';
import { createDataService, audit } from '../db/service.js';
import { legacyInvoice } from '../db/legacy-invoice.js';

// Read-only source. This script never modifies or deletes Google Sheets.
const apply=process.argv.includes('--apply');
const year=process.env.MIGRATION_ACADEMIC_YEAR;
if(!/^\d{4}-\d{4}$/.test(year||''))throw new Error('Set MIGRATION_ACADEMIC_YEAR, e.g. 2026-2027.');
if(!process.env.SPREADSHEET_ID)throw new Error('Set SPREADSHEET_ID to the existing master data workbook.');
const credentials=process.env.GOOGLE_CREDENTIALS_JSON?JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON):null;
const auth=new google.auth.GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets.readonly'],...(credentials?{credentials}:{keyFile:'./google-credentials.json'})});
const sheets=google.sheets({version:'v4',auth});
const names=['DB_HocSinh','DB_LopHoc','DB_DangKyLop','DB_HocPhi','DB_ChoDuyet'];
const source=await sheets.spreadsheets.values.batchGet({spreadsheetId:process.env.SPREADSHEET_ID,ranges:names.map(n=>`${n}!A2:N`),valueRenderOption:'FORMATTED_VALUE'});
const datasets=Object.fromEntries(names.map((n,i)=>[n,(source.data.valueRanges[i].values||[]).filter(r=>r[0])]));
const digest=createHash('sha256').update(JSON.stringify(datasets)).digest('hex');
const students=datasets.DB_HocSinh,classes=datasets.DB_LopHoc,enrollments=datasets.DB_DangKyLop;
for(const [label,rows]of [['students',students],['classes',classes]]){const ids=rows.map(r=>String(r[0]).trim());if(new Set(ids).size!==ids.length)throw new Error(`Duplicate ${label} IDs in master workbook. Resolve before migration.`);}
const studentIds=new Set(students.map(r=>String(r[0]).trim())),classIds=new Set(classes.map(r=>String(r[0]).trim()));
for(const row of enrollments)if(!studentIds.has(String(row[0]).trim())||!classIds.has(String(row[1]).trim()))throw new Error('Enrollment references an unknown student/class. Resolve the master workbook first.');
console.log({mode:apply?'apply':'dry-run',counts:Object.fromEntries(names.map(n=>[n,datasets[n].length])),academicYear:year});
if(!apply){console.log('No database writes. Use --apply only after reviewing counts and backing up sources.');process.exit(0);}
const db=createDatabase();if(!db)throw new Error('Set DATABASE_URL securely.');
const service=createDataService(db);
try{await service.write(async c=>{
 if((await c.query('SELECT id FROM migration_archives WHERE digest=$1',[digest])).rows.length){console.log('This master snapshot was already imported.');return;}
 if(Number((await c.query('SELECT count(*) AS count FROM students')).rows[0].count)||Number((await c.query('SELECT count(*) AS count FROM classes')).rows[0].count))throw new Error('Seed requires an empty database. Existing data will not be overwritten.');
 await c.query('INSERT INTO migration_archives(id,digest,datasets,created_by) VALUES($1,$2,$3,$4)',[`MIG-${randomUUID()}`,digest,JSON.stringify(datasets),'migration']);
 for(const row of classes)await c.query("INSERT INTO classes(id,name,academic_year,kind,profile) VALUES($1,$2,$3,'manual',$4)",[String(row[0]).trim(),row[1]||row[0],year,JSON.stringify({grade:row[2]||'',teacher:row[3]||'',tuition:row[4]||'',schedule:row[5]||''})]);
 for(const row of students){const keys=['phone','parentPhone','parentName','dob','school','classes','dateJoined','status','debtStatus','absences','notes'];const profile=Object.fromEntries(keys.map((k,i)=>[k,row[i+2]||'']));await c.query('INSERT INTO students(id,name,profile) VALUES($1,$2,$3)',[String(row[0]).trim(),row[1]||row[0],JSON.stringify(profile)]);}
 for(const row of enrollments)await c.query('INSERT INTO enrollments(student_id,class_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[String(row[0]).trim(),String(row[1]).trim()]);
 let ledger=0,archived=0;
 for(const row of datasets.DB_HocPhi){const invoice=legacyInvoice(row,year);
  if(!invoice){archived++;continue;}
  const enrolled=(await c.query('SELECT 1 FROM enrollments WHERE student_id=$1 AND class_id=$2',[invoice.studentId,invoice.classId])).rows.length;
  if(!enrolled){archived++;continue;}
  await c.query('INSERT INTO invoices(id,request_id,student_id,class_id,period,amount,status,collection_date,method,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[invoice.id,invoice.requestId,invoice.studentId,invoice.classId,invoice.period,invoice.amount,invoice.status,invoice.date,invoice.method,invoice.createdBy]);ledger++;
 }
 for(const r of datasets.DB_ChoDuyet)await c.query('INSERT INTO pending_students(id,data,status,created_by,processed_by,processed_at) VALUES($1,$2,$3,$4,$5,$6)',[r[0],JSON.stringify({date:r[1],class:r[2],name:r[3],note:r[4]}),r[6]||'Chờ duyệt',r[5]||'migration',r[7]||null,r[8]&&Number.isFinite(Date.parse(r[8]))?r[8]:null]);
 await audit(c,'migration','sheets.seed','master',null,{students:students.length,classes:classes.length,enrollments:enrollments.length,ledger,archived});console.log({preservedStudentIds:students.length,importedInvoices:ledger,archivedInvoices:archived});
});}finally{await db.close();}
