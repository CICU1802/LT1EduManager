const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const classes = [{id:'9T1-K1',name:'9T1-K1',grade:'9',teacher:'Nguyễn Minh Anh',schedule:'T2 T3 T4 T5 T6 T7 CN',tuition:500000,students:24}];
const students = Array.from({length:24},(_,i)=>({id:`HS${1000+i}`,name:`Nguyễn Minh An ${i+1}`,phone:'0901234567',parentName:'Nguyễn Văn Minh',parentPhone:'0912345678',classes:'9T1-K1',status:'Đang học',absences:i%4,dob:'2011-04-03',dateJoined:'2026-09-01',school:'THCS Lê Quý Đôn',notes:''}));
const tuition = students.map((s,i)=>({id:`HD${1000+i}`,studentId:s.id,studentName:s.name,classId:'9T1-K1',period:'2026-10',amount:500000,date:'2026-10-11',method:'Chuyển khoản',status:i%2?'Chưa nộp':'Đã nộp',syncStatus:i===0?'Lỗi đồng bộ':'Đã đồng bộ',syncError:i===0?'Kết nối tạm thời gián đoạn':''}));
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.CHROMIUM_PATH});
 const serveBuild = async context => context.route(`${base}/**`, async route => {
   const pathname = new URL(route.request().url()).pathname;
   const file = path.resolve(__dirname, '../dist', pathname.startsWith('/assets/') ? pathname.slice(1) : 'index.html');
   const ext = path.extname(file), contentType = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'text/html';
   await route.fulfill({body:fs.readFileSync(file),contentType});
 });
 const context=await browser.newContext();await serveBuild(context);
 await context.addInitScript(()=>{localStorage.setItem('edu_user','fixture');localStorage.setItem('edu_password','fixture');localStorage.setItem('edu_role','admin');});
 const writes=[], errors=[];let attendanceRows=students.map(s=>({...s,status:null,note:'',version:0,isTransferred:false}));
 await context.route('**/api/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;let data=[];
   if(req.method()==='POST'){writes.push({path:p,data:req.postDataJSON()});data={success:true,tuition:{syncStatus:'Đã đồng bộ'}};if(p==='/api/attendance'){const versions={};for(const r of req.postDataJSON().records){const row=attendanceRows.find(s=>s.id===r.id);Object.assign(row,r,{version:row.version+1});versions[r.id]=row.version;}data.versions=versions;}}
   else if(p==='/api/auth/me')data={role:'admin'};
   else if(p==='/api/students')data=students;
   else if(p==='/api/classes')data=classes;
   else if(p==='/api/tuition')data=tuition;
   else if(p==='/api/attendance/capabilities')data={backend:'sheets',sessions:false,operations:false};
   else if(p.includes('/attendance/class/'))data=attendanceRows;
   else if(p==='/api/pending-students')data=[{id:'P1',name:'Trần Bảo Ngọc',class:'9T1-K1',date:'2026-10-11',note:'Phụ huynh cần tư vấn',reportedBy:'trogiang',status:'Chờ duyệt'}];
   await route.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 for(const width of [320,390,640,768,1024,1440,1920]){
   await page.setViewportSize({width,height:900});
   for(const path of ['dashboard','students','classes','attendance','tuition']){
     await page.goto(`${base}/${path}`);await page.locator('h1').waitFor();await page.locator('.fade-in').first().waitFor();await page.waitForTimeout(200);
     if(['students','tuition'].includes(path))await page.locator('tbody tr').first().waitFor();
     if(path==='dashboard')await page.locator('.dashboard-intro').waitFor();

     if(path==='attendance'){await page.locator('tbody tr').first().waitFor();}
     const dim=await page.evaluate(()=>({view:innerWidth,scroll:document.documentElement.scrollWidth}));
     assert.ok(dim.scroll<=dim.view,`${width} ${path}: overflow ${JSON.stringify(dim)}`);
     if((width===390&&['students','attendance'].includes(path))||(width===1440&&path==='dashboard'))await page.screenshot({path:`/tmp/lt1-${path}-${width}.png`,fullPage:true});
   }
 }
 await page.setViewportSize({width:390,height:844});await page.goto(`${base}/students`);
 await page.getByRole('button',{name:'Mở menu',exact:true}).click();assert.equal(await page.locator('.sidebar').getAttribute('aria-modal'),'true');
 await page.keyboard.press('Escape');await page.waitForTimeout(250);assert.equal(await page.getByRole('button',{name:'Mở menu',exact:true}).getAttribute('aria-expanded'),'false');
 await page.getByRole('button',{name:'Mở tìm kiếm học sinh'}).click();await page.getByRole('textbox',{name:'Tìm học sinh theo tên, mã hoặc số điện thoại'}).fill('HS1003');await page.getByRole('button',{name:'Tìm học sinh',exact:true}).click();await page.waitForTimeout(150);assert.equal(await page.locator('tbody tr').count(),1);
 await page.goto(`${base}/students`);await page.getByRole('button',{name:/Thêm học sinh/i}).click();
 const dialog=page.getByRole('dialog');await dialog.waitFor();assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));
 await page.keyboard.press('Shift+Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));
 await page.getByLabel('Họ và Tên *',{exact:true}).focus();await page.waitForTimeout(250);await page.screenshot({path:'/tmp/lt1-modal-390.png'});await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
 await page.getByRole('button',{name:/Thêm học sinh/i}).click();await page.getByLabel('Họ và Tên *',{exact:true}).fill('Học sinh thử nghiệm');await page.getByRole('dialog').getByRole('button',{name:'Thêm Học Sinh',exact:true}).click();await page.locator('.toast-success').waitFor();assert.ok(writes.some(x=>x.path==='/api/students'));assert.equal(await page.getByRole('dialog').count(),0);
 await page.goto(`${base}/tuition`);await page.getByRole('button',{name:/Lập Hóa Đơn Mới/i}).last().click();await page.getByLabel('Lớp *',{exact:true}).selectOption('9T1-K1');await page.getByLabel('Mã Học Sinh *',{exact:true}).fill('HS1000');await page.getByLabel('Số tiền thu (VNĐ) *',{exact:true}).fill('500000');await page.getByRole('button',{name:/Lưu hóa đơn/i}).click();await page.locator('.toast-success').waitFor();const receipt=writes.find(x=>x.path==='/api/tuition');assert.equal(receipt.data.classId,'9T1-K1');assert.equal(receipt.data.amount,500000);assert.ok(receipt.data.period&&receipt.data.requestId);
 await page.goto(`${base}/attendance`);await page.getByRole('combobox',{name:'Trạng thái Nguyễn Minh An 1',exact:true}).selectOption('Đi trễ');await page.getByRole('button',{name:/Lưu điểm danh/i}).click();await page.locator('.toast-success').waitFor();const attendance=writes.find(x=>x.path==='/api/attendance');assert.equal(attendance.data.records[0].status,'Đi trễ');assert.equal(attendance.data.records[0].note,'');assert.equal(attendance.data.records[0].id,'HS1000');
 await page.goto(`${base}/classes`);await page.getByRole('button',{name:'Chi tiết & Danh sách HS'}).click();await page.getByRole('dialog').locator('tbody tr').first().waitFor();await page.waitForTimeout(250);assert.ok(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);
 const loginContext=await browser.newContext();await serveBuild(loginContext);await loginContext.route('**/api/auth/me',r=>r.fulfill({status:401,json:{error:'Unauthorized'},headers:{'Access-Control-Allow-Origin':'*'}}));const login=await loginContext.newPage();await login.setViewportSize({width:390,height:844});await login.goto(base);await login.getByLabel('Tài khoản',{exact:true}).fill('wrong');await login.getByLabel('Mật khẩu',{exact:true}).fill('wrong');await login.getByRole('button',{name:'Hiện mật khẩu'}).click();assert.equal(await login.getByLabel('Mật khẩu',{exact:true}).getAttribute('type'),'text');await login.getByRole('button',{name:'Đăng nhập',exact:true}).click();await login.getByRole('alert').waitFor();assert.match(await login.getByRole('alert').textContent(),/chưa đúng/);await login.screenshot({path:'/tmp/lt1-login-390.png',fullPage:true});
 console.log('PASS: 35 responsive page/viewport checks, navigation, search, dialog focus, student creation, invoice allocation, late attendance, login error; no browser exceptions.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
