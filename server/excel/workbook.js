import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { invalid, money } from '../integrity.js';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, parseAttributeValue: false, processEntities: false });
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const unescape = s => String(s ?? '').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const text = node => typeof node === 'string' ? unescape(node) : node ? (node.t != null ? text(node.t) : node['#text'] != null ? text(node['#text']) : array(node.r).map(text).join('')) : '';
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/\s+/g,' ').trim();
export const colNumber = letters => [...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
export function colLetter(n) { let s=''; while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s; }
export function isoDate(value, year, date1904=false) {
 if(value==null||value==='')return null;
 if(/^\d{5}(?:\.0+)?$/.test(String(value))){const n=Number(value);return new Date((date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30))+n*86400000).toISOString().slice(0,10);}
 const s=String(value).trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);let date=m?`${m[1]}-${m[2]}-${m[3]}`:null;
 if(!m){m=s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);if(m)date=`${m[3]?(m[3].length===2?'20'+m[3]:m[3]):year}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
 if(!date)return null;const timestamp=new Date(date+'T12:00:00Z');return Number.isFinite(timestamp.getTime())&&timestamp.toISOString().slice(0,10)===date?date:null;
}
function xml(parts,path){if(!parts[path])throw invalid('File Excel thiếu thành phần bắt buộc.');const source=strFromU8(parts[path]);if(/<!DOCTYPE|<!ENTITY/i.test(source))throw invalid('File XML không được hỗ trợ.');return parser.parse(source);}
export function openWorkbook(buffer) {
 if(buffer.length>12*1024*1024)throw invalid('File vượt quá 12 MB.',413);
 if(buffer[0]!==0x50||buffer[1]!==0x4b)throw invalid('Chỉ hỗ trợ file .xlsx, không hỗ trợ .xls hoặc file mã hóa.');
 let expanded=0,count=0,parts;
 try { parts=unzipSync(buffer,{filter:file=>{expanded+=file.originalSize;count++;if(expanded>160*1024*1024||count>5000)throw invalid('File Excel giải nén quá lớn.',413);return true;}}); }
 catch(error){if(error.status)throw error;throw invalid('File Excel bị hỏng hoặc không hợp lệ.');}
 if(Object.keys(parts).some(p=>/vbaProject|\.bin$/i.test(p)))throw invalid('Không hỗ trợ workbook chứa macro.');
 const workbook=xml(parts,'xl/workbook.xml').workbook,rels=xml(parts,'xl/_rels/workbook.xml.rels').Relationships;
 const shared=parts['xl/sharedStrings.xml']?array(xml(parts,'xl/sharedStrings.xml').sst.si).map(text):[];
 const styles=parts['xl/styles.xml']?xml(parts,'xl/styles.xml').styleSheet:{};
 const fonts=array(styles.fonts?.font),formats=array(styles.cellXfs?.xf);
 const date1904=['1','true'].includes(workbook.workbookPr?.['@date1904']);
 const targets=new Map(array(rels.Relationship).map(r=>[r['@Id'],r['@Target']]));
 const sheets=array(workbook.sheets?.sheet).map(sheet=>{
  const target=targets.get(sheet['@r:id']);if(!target||target.includes('..'))throw invalid('Đường dẫn worksheet không hợp lệ.');
  const path=target.startsWith('/')?target.slice(1):'xl/'+target;const rows=new Map();
  for(const row of array(xml(parts,path).worksheet.sheetData?.row)){
   const cells=new Map();for(const c of array(row.c)){
    const ref=c['@r'];if(!/^[A-Z]+\d+$/.test(ref||''))continue;
    const type=c['@t'];const v=text(c.v);const value=type==='s'?shared[Number(v)]??'':type==='inlineStr'?text(c.is):type==='b'?v==='1':v;
    const font=fonts[Number(formats[Number(c['@s']||0)]?.['@fontId']||0)];
    cells.set(colNumber(ref.match(/^[A-Z]+/)[0]),{ref,value,formula:c.f!=null,error:type==='e',strike:font?.strike!=null});
   }
   rows.set(Number(row['@r']),cells);
  }
  return {name:sheet['@name'],hidden:sheet['@state']==='hidden'||sheet['@state']==='veryHidden',path,rows};
 });
 return {parts,sheets,date1904};
}
const labels={name:['ho va ten','ten hs','ten hoc sinh','ho ten'],id:['ma hs','ma hoc sinh'],school:['truong'],phone:['sdt','sdt ph','so dien thoai'],paid:['thuc dong'],due:['kiem tra','kt'],date:['ngay dong','ngay thu'],notes:['ghi chu','note'],address:['dia chi']};
export function analyzeWorkbook(buffer,{academicYear,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date())}={}) {
 if(!/^\d{4}-\d{4}$/.test(academicYear||'')||Number(academicYear.slice(5))!==Number(academicYear.slice(0,4))+1)throw invalid('Năm học phải có dạng 2026-2027.');
 const book=openWorkbook(buffer),sheets=[],items=[],warnings=[];
 for(const sheet of book.sheets){
  let headerRow=0,columns={};
  for(const [r,cells]of sheet.rows){if(r>20)break;const found={};for(const [c,cell]of cells){const v=normalize(cell.value);for(const [key,aliases]of Object.entries(labels))if(aliases.includes(v)&&!found[key])found[key]=c;}
   if(found.name){headerRow=r;columns=found;break;}
  }
  const meta=[...sheet.rows].filter(([r])=>r<headerRow).flatMap(([,cells])=>[...cells.values()].map(c=>String(c.value))).filter(Boolean);
  const metadata={schedule:meta.filter(v=>/lich hoc/i.test(normalize(v))).join('\n'),teacher:meta.filter(v=>/^gv\s*:/i.test(v.trim())).join('\n'),course:sheet.name.match(/\bK\s*(\d+)/i)?.[1]||'',grade:sheet.name.match(/(?:^|\s)(6|7|8|9|10|11|12)/)?.[1]||''};
  const courseLine=meta.find(v=>/khoa/i.test(normalize(v))),dates=courseLine?.match(/\d{1,2}\/\d{1,2}\/\d{4}/g)||[];
  metadata.startDate=isoDate(dates[0],academicYear.slice(0,4));metadata.endDate=isoDate(dates[1],academicYear.slice(0,4));
  const dateColumns=[];if(headerRow)for(const [r,cells]of sheet.rows){if(r<=headerRow||r>headerRow+2)continue;for(const [c,cell]of cells){const d=isoDate(cell.value,academicYear.slice(0,4),book.date1904);const heading=sheet.rows.get(headerRow)?.get(c)?.value;
   if(d&&Number(d.slice(0,4))>=Number(academicYear.slice(0,4))-1&&Number(d.slice(0,4))<=Number(academicYear.slice(5))+1&&c>columns.name&&!Object.values(columns).includes(c)&&!['dd','tai lieu','tap','tl'].includes(normalize(heading)))dateColumns.push({column:c,date:d});}if(dateColumns.length)break;}
  const kind=columns.paid?'tuition':dateColumns.length?'attendance':/nhac.*hoc/.test(normalize(sheet.name))?'reminders':/giam/.test(normalize(sheet.name))?'discounts':/dong tien/.test(normalize(sheet.name))?'receipts':'reference';
  const supported=!!headerRow&&['tuition','attendance'].includes(kind);
  const info={name:sheet.name,hidden:sheet.hidden,kind,supported,headerRow,columns,dateColumns,metadata,classKey:`${academicYear}:${sheet.name.trim()}`};sheets.push(info);
  if(metadata.startDate&&metadata.endDate&&metadata.endDate<metadata.startDate)warnings.push({sheet:sheet.name,message:'Ngày kết thúc khóa trước ngày bắt đầu; cần kiểm tra tiêu đề gốc.'});
  if(!supported){items.push({key:`${sheet.name}!archive`,sheet:sheet.name,row:0,kind:'archive',archiveKind:kind,hidden:sheet.hidden,message:'Lưu nguyên tab tham chiếu. Các khoản thu gộp/ưu đãi không tự cộng vào doanh thu.'});continue;}
  const duplicateIds=new Map();
  for(const [r,cells]of sheet.rows){if(r<=headerRow+1)continue;const val=key=>cells.get(columns[key])?.value;const name=String(val('name')||'').trim();if(!name||[...labels.name,'tong','tong cong','tong so'].includes(normalize(name)))continue;
   const id=String(val('id')||'').trim();const item={key:`${sheet.name}!${r}`,sheet:sheet.name,row:r,kind:kind==='tuition'?'balance':'roster',classKey:info.classKey,hidden:sheet.hidden,student:{id,name,school:String(val('school')||'').trim(),phone:String(val('phone')||'').trim()},transferred:!!cells.get(columns.name)?.strike,notes:String(val('notes')||''),address:String(val('address')||''),marks:[],issues:[]};
   if(id){duplicateIds.set(id,[...(duplicateIds.get(id)||[]),item]);if(!/^HS[-A-Za-z0-9]+$/.test(id))item.issues.push('Mã học sinh không đúng định dạng.');}
   if(cells.get(columns.name)?.formula)item.issues.push('Tên học sinh là công thức; cần kiểm tra giá trị.');
   if(kind==='tuition'){
    for(const [key,column]of [['paid',columns.paid],['due',columns.due]]){
     const cell=cells.get(column);if(!cell||cell.value===''){item[key]=key==='paid'?0:null;continue;}
     try{if(cell.error)throw invalid('Lỗi công thức');item[key]=money(/^\d+\.0+$/.test(String(cell.value))?String(cell.value).replace(/\.0+$/,''):cell.value);if(!Number.isSafeInteger(item[key]))throw invalid('Số tiền quá lớn');}catch{item.issues.push(`${key==='paid'?'Thực đóng':'Học phí'} không phải số tiền hợp lệ.`);}
    }
    const raw=val('date');item.collectionDate=isoDate(raw,academicYear.slice(0,4),book.date1904);if(raw&&!item.collectionDate)item.dateNote=String(raw);
    if(item.collectionDate&&item.collectionDate>today)item.issues.push('Ngày đóng nằm sau mốc chốt file.');
    if(!metadata.course)item.issues.push('Không xác định được khóa học.');
   }else{
    const seen=new Map();for(const {column,date}of dateColumns){const cell=cells.get(column);if(!cell||cell.value===''||date>today)continue;const value=cell.value;const mark={date,status:value===true||value==='1'?'Có mặt':value===false||value==='0'?'Vắng':'Khác',note:value===true||value===false||value==='1'||value==='0'?'':String(value),column};
     if(cell.formula||cell.error){item.issues.push(`Điểm danh ${date} là công thức/lỗi Excel.`);continue;}
     if(seen.has(date)&&JSON.stringify({...mark,column:0})!==JSON.stringify({...seen.get(date),column:0}))item.issues.push(`Có nhiều cột điểm danh khác nhau cho ngày ${date}.`);else seen.set(date,mark);
    }item.marks=[...seen.values()];
   }
   items.push(item);
  }
  for(const list of duplicateIds.values())if(list.length>1)list.forEach(i=>i.issues.push('Mã học sinh trùng trong cùng tab.'));
 }
 if(items.length>15000)throw invalid('File có quá nhiều dòng. Vui lòng tách file theo khóa.');
 const identities=new Map();for(const item of items){if(!item.student?.id)continue;const key=item.student.id;if(!identities.has(key))identities.set(key,[]);identities.get(key).push(item);}
 for(const list of identities.values())if(new Set(list.map(i=>normalize(i.student.name))).size>1)list.forEach(i=>i.issues.push('Cùng mã học sinh nhưng có nhiều tên trong file.'));
 return {academicYear,sheets,items,warnings,summary:{sheets:sheets.length,rows:items.filter(i=>i.kind!=='archive').length,withoutId:items.filter(i=>i.kind!=='archive'&&!i.student.id).length,hidden:sheets.filter(s=>s.hidden).length}};
}
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
// Patch only managed cells in the original OOXML package. Styles, merged cells, drawings,
// formulas in unmanaged cells, print settings and hidden tabs remain byte-identical.
export function patchWorkbook(buffer,patches){
 const book=openWorkbook(buffer);
 for(const sheet of book.sheets){
  const changes=patches[sheet.name];if(!changes)continue;
  const byRow=new Map();
  for(const [ref,value]of Object.entries(changes)){
   if(!/^[A-Z]+\d+$/.test(ref))throw invalid('Ô Excel không hợp lệ.');
   const r=Number(ref.match(/\d+$/)[0]);if(!byRow.has(r))byRow.set(r,new Map());byRow.get(r).set(ref,value);
  }
  const foundRows=new Set();
  const source=strFromU8(book.parts[sheet.path]).replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g,(original,attributes,body='')=>{
   const rowNumber=Number(attributes.match(/\br="(\d+)"/)?.[1]);const updates=byRow.get(rowNumber);if(!updates)return original;foundRows.add(rowNumber);
   const cells=new Map();for(const match of body.matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)){const ref=match[0].match(/\br="([A-Z]+\d+)"/)?.[1];if(ref)cells.set(ref,match[0]);}
   for(const [ref,value]of updates){const style=cells.get(ref)?.match(/\bs="([^"]*)"/)?.[1];const attrs=`r="${ref}"${style?` s="${style}"`:''}`;
    const content=value==null||value===''?`<c ${attrs}/>`:typeof value==='number'?`<c ${attrs}><v>${value}</v></c>`:typeof value==='boolean'?`<c ${attrs} t="b"><v>${value?1:0}</v></c>`:`<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
    cells.set(ref,content);
   }
   const extras=body.replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,'');
   return `<row${attributes}>${[...cells].sort(([a],[b])=>colNumber(a.match(/^[A-Z]+/)[0])-colNumber(b.match(/^[A-Z]+/)[0])).map(([,v])=>v).join('')}${extras}</row>`;
  });
  if([...byRow.keys()].some(r=>!foundRows.has(r)))throw invalid('Không tìm thấy hàng trong mẫu Excel.');
  book.parts[sheet.path]=strToU8(source);
 }
 return Buffer.from(zipSync(book.parts,{level:6}));
}
