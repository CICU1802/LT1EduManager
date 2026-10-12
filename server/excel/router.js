import express from 'express';
import { createImportService } from './import-service.js';
import { invalid } from '../integrity.js';
export function createExcelRouter(service,{active=false}={}) {
 const router=express.Router(),imports=createImportService(active?service:null);
 router.use((req,res,next)=>{if(!['admin','vanphong'].includes(req.user?.role))return res.status(403).json({error:'Chỉ quản trị viên và văn phòng được nhập/xuất dữ liệu.'});next();});
 let processing=false;
 const route=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
 const heavy=fn=>route(async(req,res)=>{if(processing)throw invalid('Đang xử lý một file khác. Vui lòng thử lại sau.',429);processing=true;try{await fn(req,res);}finally{processing=false;}});
 router.get('/status',route(async(req,res)=>{
  let ready=false;if(service)try{ready=Number((await service.db.query('SELECT max(version) AS v FROM schema_migrations')).rows[0].v)>=1;}catch{/* Setup is incomplete. */}
  res.json({configured:!!service,ready,active:active&&ready,backend:active?'postgres':'sheets',canCommit:active&&ready,message:!service?'Chưa kết nối PostgreSQL. Bạn có thể phân tích file; chưa thể nhập vào cơ sở dữ liệu.':!ready?'Cần chạy khởi tạo cơ sở dữ liệu.':!active?'PostgreSQL đã kết nối. Cần chuyển nguồn dữ liệu sang PostgreSQL trước khi xác nhận nhập.':'Dữ liệu được lưu trong PostgreSQL. Excel dùng để nhập và đối chiếu.'});
 }));
 router.get('/imports',route(async(req,res)=>res.json(active&&service?await imports.history():[])));
 router.post('/preview',express.raw({type:['application/octet-stream','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],limit:'12mb'}),heavy(async(req,res)=>{
  if(!Buffer.isBuffer(req.body)||!req.body.length)throw invalid('Chọn một file .xlsx.');
  let filename;try{filename=decodeURIComponent(req.headers['x-filename']||'du-lieu.xlsx');}catch{throw invalid('Tên file không hợp lệ.');}
  if(!/\.xlsx$/i.test(filename)||filename.length>200)throw invalid('Chỉ hỗ trợ file .xlsx.');filename=filename.replace(/[\/\\\r\n]/g,'_');
  const result=await imports.preview(req.body,{filename,academicYear:req.headers['x-academic-year'],snapshotDate:req.headers['x-snapshot-date']},req.user.username);
  if(!active)result.canCommit=false;res.json(result);
 }));
 router.get('/imports/:id/preview',route(async(req,res)=>{const result=await imports.inspect(req.params.id,req.user.username);if(!active)result.canCommit=false;res.json(result);}));
 router.post('/imports/:id/commit',route(async(req,res)=>{if(!active)throw invalid('Chưa chuyển hệ thống sang PostgreSQL.',503);res.json(await imports.commit(req.params.id,req.body,req.user.username));}));
 router.get('/imports/:id/export',heavy(async(req,res)=>{
  if(!active)throw invalid('Chưa chuyển hệ thống sang PostgreSQL.',503);const result=await imports.export(req.params.id,req.user.username);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="LT1-export.xlsx"; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
  res.setHeader('X-LT1-Unmapped-Rows',result.unmappedRows);res.setHeader('X-LT1-Added-Rows',result.addedRows);res.send(result.buffer);
 }));
 router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const status=error.status||500;res.status(status).json({error:status>=500?'Chưa xử lý được dữ liệu. Kiểm tra kết nối cơ sở dữ liệu và thử lại.':error.message});});
 return router;
}
