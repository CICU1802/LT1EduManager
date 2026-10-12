const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const base='http://127.0.0.1:5173';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chromium',executablePath:process.env.CHROMIUM_PATH});const ctx=await browser.newContext();
 await ctx.addInitScript(()=>{localStorage.setItem('edu_user','fixture');localStorage.setItem('edu_password','fixture');localStorage.setItem('edu_role','admin');});
 await ctx.route(`${base}/**`,r=>{const p=new URL(r.request().url()).pathname;const file=path.resolve(__dirname,'../dist',p.startsWith('/assets/')?p.slice(1):'index.html');return r.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});});
 let active=true,committed=false,commitBody;const uploads=[];const errors=[];
 const preview={id:'IMP-TEST',state:'preview',revision:1,canCommit:true,summary:{sheets:2,rows:2,withoutId:1,hidden:0},sheets:[{name:'9T-K1'},{name:'Nhắc học'}],counts:{ready:1,review:1,archive:1},warnings:[],items:[
  {key:'9T-K1!7',sheet:'9T-K1',row:7,kind:'roster',hidden:false,classification:'ready',student:{id:'HS1',name:'Học sinh mẫu',school:'THCS A'},issues:[],changes:[],marks:[{date:'2026-10-01',status:'Có mặt',note:''}],destination:'Hồ sơ / điểm danh'},
  {key:'9T-K1!8',sheet:'9T-K1',row:8,kind:'roster',hidden:false,classification:'review',student:{id:'',name:'Học sinh thiếu mã',school:'THCS A'},issues:[],changes:['Chưa xác định hồ sơ'],marks:[],candidates:[]},
  {key:'Nhắc học!archive',sheet:'Nhắc học',row:0,kind:'archive',classification:'archive',hidden:false,message:'Lưu tab tham chiếu'}]};
 await ctx.route('**/api/**',async r=>{const p=new URL(r.request().url()).pathname;let data=[];
  if(p==='/api/auth/me')data={role:'admin'};
  else if(p==='/api/data/status')data={active,message:active?'Dữ liệu được lưu trong PostgreSQL.':'Chưa kết nối PostgreSQL. Có thể phân tích nhưng chưa thể ghi.'};
  else if(p==='/api/data/imports')data=committed?[{id:'IMP-TEST',filename:'mau.xlsx',academic_year:'2026-2027',state:'committed',created_by:'fixture',created_at:'2026-10-12T00:00:00Z'}]:[];
  else if(p==='/api/data/preview'){uploads.push(r.request().headers());data={...preview,canCommit:active};}
  else if(p.endsWith('/commit')){commitBody=r.request().postDataJSON();committed=true;data={success:true,applied:3};}
  else if(p.endsWith('/export'))return r.fulfill({body:Buffer.from('test-download'),contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers:{'Content-Disposition':"attachment; filename*=UTF-8''LT1-test.xlsx",'X-LT1-Unmapped-Rows':'1','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Disposition,X-LT1-Unmapped-Rows'}});
  await r.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Disposition,X-LT1-Unmapped-Rows'}});
 });
 const page=await ctx.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});await page.goto(`${base}/data`);await page.getByText('Nguồn dữ liệu: PostgreSQL',{exact:true}).waitFor();
  await page.getByLabel('Chọn file Excel',{exact:true}).setInputFiles({name:'mau.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('fixture')});await page.getByRole('button',{name:'Phân tích file',exact:true}).click();await page.getByRole('heading',{name:'Kết quả phân tích',exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
  assert.equal(await page.getByRole('checkbox',{name:'Nhập 9T-K1 hàng 8'}).isChecked(),false);
  if(width===390||width===1440){await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});await page.waitForTimeout(250);await page.screenshot({path:`/tmp/lt1-excel-${width}.png`,fullPage:true});}
 }
 await page.getByRole('combobox',{name:'Ghép hồ sơ 9T-K1!8'}).selectOption('__new');await page.getByRole('checkbox',{name:'Nhập 9T-K1 hàng 8'}).check();
 await page.getByRole('button',{name:'Xác nhận nhập 3 dòng',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Xác nhận ghi dữ liệu',exact:true}).click();await page.getByText('Đã nhập 3 dòng. Lịch sử đã được lưu.',{exact:true}).waitFor();assert.equal(commitBody.decisions.find(d=>d.key==='9T-K1!8').createNew,true);assert.equal(commitBody.revision,1);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Xuất Excel',exact:true}).click();assert.equal((await download).suggestedFilename(),'LT1-test.xlsx');
 active=false;await page.goto(`${base}/data`);await page.getByText('Chuẩn bị kho dữ liệu riêng',{exact:true}).waitFor();await page.getByLabel('Chọn file Excel',{exact:true}).setInputFiles({name:'mau.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('fixture')});await page.getByRole('button',{name:'Phân tích file',exact:true}).click();await page.getByRole('heading',{name:'Kết quả phân tích',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/Xác nhận nhập 2 dòng/}).isDisabled(),true);
 assert.ok(uploads.every(h=>h['x-academic-year']&&h['x-snapshot-date']&&h['content-type']==='application/octet-stream'));assert.deepEqual(errors,[]);
 console.log('PASS: Excel preview at 4 viewport widths; explicit missing-ID selection; confirmation and upload metadata; export download; database setup gate; no browser exceptions.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
