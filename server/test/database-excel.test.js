import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { createDataService } from '../db/service.js';
import { createImportService } from '../excel/import-service.js';
import { createExcelRouter } from '../excel/router.js';
import { analyzeWorkbook,openWorkbook,patchWorkbook,isoDate } from '../excel/workbook.js';
import { legacyInvoice } from '../db/legacy-invoice.js';
import { fixture, twoClassFixture } from './fixtures/workbook.js';
const options={filename:'fixture.xlsx',academicYear:'2026-2027',snapshotDate:'2026-10-01'};
async function setup(){
 const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const db={query:(s,v)=>pg.query(s,v),transaction:fn=>pg.transaction(tx=>fn(tx))};const service=createDataService(db),imports=createImportService(service);
 return {pg,db,service,imports};
}
const apply=p=>p.items.filter(i=>!i.issues?.length).map(i=>({key:i.key,action:'apply',createNew:!i.matchId,studentId:i.matchId||i.student?.id}));
test('Parser distinguishes future blanks, preserves booleans and rejects invalid dates',()=>{
 const a=analyzeWorkbook(fixture(),{academicYear:'2026-2027',today:'2026-10-12'});assert.equal(a.items.length,1);assert.equal(a.items[0].marks.length,1);assert.equal(a.items[0].marks[0].status,'Có mặt');assert.equal(isoDate('31/02/2026','2026'),null);
 assert.throws(()=>analyzeWorkbook(fixture(),{academicYear:'wrong'}));assert.throws(()=>openWorkbook(Buffer.from('not xlsx')));
});
test('OOXML export retains styles, drawings, merges, widths and row height while changing managed cells',()=>{
 const original=fixture(),updated=patchWorkbook(original,{'9T-K1':{B7:'Tên <mới> & đầy đủ',E7:false,F8:'mới'}});const before=openWorkbook(original),after=openWorkbook(updated);
 assert.equal(after.sheets[0].rows.get(7).get(2).value,'Tên <mới> & đầy đủ');assert.equal(after.sheets[0].rows.get(7).get(5).value,false);
 for(const path of ['xl/styles.xml','xl/workbook.xml','xl/drawings/drawing1.xml'])assert.deepEqual(after.parts[path],before.parts[path]);
 const xml=Buffer.from(after.parts['xl/worksheets/sheet1.xml']).toString();for(const text of ['mergeCell ref="D1:H1"','width="32"','ht="24"','s="1"','pageMargins','pane ySplit="6"'])assert.ok(xml.includes(text));assert.throws(()=>patchWorkbook(original,{'9T-K1':{A1000:'missing'}}));
});
test('Reviewed import is atomic, idempotent, keyed by identity and refuses stale preview',async()=>{
 const {pg,service,imports}=await setup();try{
  const p=await imports.preview(fixture(),options,'admin');assert.equal(p.counts.ready,1);await imports.commit(p.id,{revision:p.revision,decisions:apply(p)},'admin');
  assert.equal((await service.students()).length,1);assert.equal((await service.attendanceList('2026-2027:9T-K1','2026-10-01'))[0].status,'Có mặt');
  const repeat=await imports.preview(fixture(),options,'admin');assert.equal(repeat.alreadyImported,true);await imports.commit(p.id,{revision:0,decisions:[]},'admin');assert.equal((await service.students()).length,1);
  const changed=await imports.preview(fixture({mark:false}),options,'admin');assert.equal(changed.counts.review,1);
  await service.saveAttendance({classId:'2026-2027:9T-K1',date:'2026-10-01',records:[{id:'HS1',status:'Khác',note:'Đã xin phép',version:1}]},'trogiang');
  await assert.rejects(imports.commit(changed.id,{revision:changed.revision,decisions:apply(changed)},'admin'),/đã thay đổi/);
  const fresh=await imports.inspect(changed.id,'admin');await imports.commit(fresh.id,{revision:fresh.revision,decisions:apply(fresh)},'admin');assert.equal((await service.attendanceList('2026-2027:9T-K1','2026-10-01'))[0].status,'Vắng');
 }finally{await pg.close();}
});
test('No-ID rosters need explicit matching and ambiguous duplicate targets roll back the whole batch',async()=>{
 const {pg,service,imports}=await setup();try{
  const p=await imports.preview(fixture({id:''}),options,'admin');assert.equal(p.counts.review,1);await assert.rejects(imports.commit(p.id,{revision:p.revision,decisions:[{key:p.items[0].key,action:'apply'}]},'admin'),/cần chọn/);assert.equal((await service.students()).length,0);
  await imports.commit(p.id,{revision:p.revision,decisions:[{key:p.items[0].key,action:'apply',createNew:true}]},'admin');assert.equal((await service.students()).length,1);
  const again=await imports.preview(fixture({id:'',mark:false}),options,'admin');assert.ok(again.items[0].matchId); // unique name + school
  await imports.commit(again.id,{revision:again.revision,decisions:apply(again)},'admin');assert.equal((await service.students()).length,1);
  const duplicate=patchWorkbook(fixture({id:'',mark:true}),{'9T-K1':{B8:'Học sinh mẫu',C8:'',D8:'THCS A',E8:false}});
  const conflict=await imports.preview(duplicate,options,'admin');
  await assert.rejects(imports.commit(conflict.id,{revision:conflict.revision,decisions:apply(conflict)},'admin'),/Có hai hàng/);
  assert.equal((await service.attendanceList('2026-2027:9T-K1','2026-10-01'))[0].status,'Vắng');
  assert.equal((await service.students()).length,1);
  assert.equal((await service.db.query('SELECT state FROM import_documents WHERE id=$1',[conflict.id])).rows[0].state,'preview');
 }finally{await pg.close();}
});
test('Fee snapshots replace totals, never become revenue, and payments remain idempotent on reimport',async()=>{
 const {pg,service,imports}=await setup();try{
  const initial=await imports.preview(fixture({kind:'tuition'}),options,'admin');await imports.commit(initial.id,{revision:initial.revision,decisions:apply(initial)},'admin');assert.equal((await service.invoices()).length,0);assert.equal((await service.balances())[0].paid,1000000);
  const body={requestId:'REQ-1',studentId:'HS1',classId:'2026-2027:9T-K1',period:'2026-10',amount:200000,status:'Đã nộp',date:'2026-10-02',method:'Tiền mặt'};
  await service.saveInvoice(body,'vanphong');await service.saveInvoice(body,'vanphong');assert.equal((await service.invoices()).length,1);assert.equal((await service.balances())[0].paid,1200000);
  await assert.rejects(service.saveInvoice({...body,amount:300000},'vanphong'),/đã dùng/);
  const p=await imports.preview(fixture({kind:'tuition',paid:1200000}),options,'admin');await imports.commit(p.id,{revision:p.revision,decisions:apply(p)},'admin');assert.equal((await service.balances())[0].paid,1200000);
  const output=await imports.export(p.id,'admin');assert.equal(openWorkbook(output.buffer).sheets[0].rows.get(7).get(4).value,'1200000');
  await service.saveInvoice({...body,requestId:'REQ-DEBT',status:'Nợ'},'vanphong');assert.equal((await service.balances())[0].paid,1200000);
  await assert.rejects(service.saveInvoice({...body,requestId:'REQ-OLD',date:'2026-09-30'},'vanphong'),/số dư/);
 }finally{await pg.close();}
});
test('Export includes new students in template blank rows and refuses silent omission when full',async()=>{
 const {pg,service,imports}=await setup();try{
  const p=await imports.preview(fixture(),options,'admin');await imports.commit(p.id,{revision:p.revision,decisions:apply(p)},'admin');
  await service.createStudent({name:'Học sinh mới',classes:'2026-2027:9T-K1'},'admin');const result=await imports.export(p.id,'admin');assert.equal(result.addedRows,1);assert.equal(openWorkbook(result.buffer).sheets[0].rows.get(8).get(2).value,'Học sinh mới');
  await service.createStudent({name:'Học sinh thứ ba',classes:'2026-2027:9T-K1'},'admin');await assert.rejects(imports.export(p.id,'admin'),/hàng trống/);
 }finally{await pg.close();}
});
test('Excel endpoints support analysis before database setup and enforce office roles',async()=>{
 const app=express();app.use((req,res,next)=>{req.user={username:'test',role:req.headers['x-role']||'admin'};next();});app.use('/api/data',createExcelRouter(null));
 const status=await request(app).get('/api/data/status');assert.equal(status.body.active,false);
 const denied=await request(app).get('/api/data/imports').set('X-Role','trogiang');assert.equal(denied.status,403);
 const result=await request(app).post('/api/data/preview').set('Content-Type','application/octet-stream').set('X-Filename','sample.xlsx').set('X-Academic-Year','2026-2027').set('X-Snapshot-Date','2026-10-01').send(fixture());assert.equal(result.status,200);assert.equal(result.body.canCommit,false);assert.equal(result.body.summary.rows,1);
});

test('Master migration decodes exact A:N positions and archives unallocated or unresolved receipts',()=>{
 const row=['HP1','HS1','Học sinh mẫu','500.000','12/10/2026','Chuyển khoản','Đã nộp','9T-K1','2026-10','Đã đồng bộ','','','REQ1','vanphong'];
 const invoice=legacyInvoice(row,'2026-2027');assert.equal(invoice.amount,500000);assert.equal(invoice.date,'2026-10-12');assert.equal(invoice.classId,'9T-K1');assert.equal(invoice.studentId,'HS1');assert.equal(invoice.status,'Đã nộp');
 assert.equal(legacyInvoice(row.slice(0,7),'2026-2027'),null);assert.equal(legacyInvoice(row.map((v,i)=>i===9?'Lỗi đồng bộ':v),'2026-2027'),null);assert.equal(legacyInvoice(row.map((v,i)=>i===8?'2026-99':v),'2026-2027'),null);
});

test('One new student ID can appear across course tabs; source contacts do not overwrite known numbers',async()=>{
 const {pg,service,imports}=await setup();try{
  const p=await imports.preview(await twoClassFixture(),options,'admin');assert.equal(p.counts.ready,2);await imports.commit(p.id,{revision:p.revision,decisions:apply(p)},'admin');
  assert.equal((await service.students()).length,1);assert.equal((await service.classes()).length,2);assert.equal((await service.balances()).length,2);
  await service.db.query('UPDATE students SET profile=profile || $2::jsonb WHERE id=$1',['HS1',JSON.stringify({phone:'0999999999',parentPhone:'0888888888'})]);
  const updated=await imports.preview(fixture({kind:'tuition',name:'9T-HP-K1',paid:1200000}),options,'admin');await imports.commit(updated.id,{revision:updated.revision,decisions:apply(updated)},'admin');
  const student=(await service.students())[0];assert.equal(student.phone,'0999999999');assert.equal(student.parentPhone,'0888888888');assert.equal(student.importedContactPhone,'0901234567');
 }finally{await pg.close();}
});
