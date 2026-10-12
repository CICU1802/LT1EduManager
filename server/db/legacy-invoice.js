import { money } from '../integrity.js';
import { isoDate } from '../excel/workbook.js';
// The current master ledger is A:N. Do not infer payment allocation from a name or total.
export function legacyInvoice(row,year){
 const [id,studentId,studentName,rawAmount,date,method,status,classId,period,syncStatus]=row;void studentName;
 let amount;try{amount=money(rawAmount);}catch{return null;}
 const collectionDate=isoDate(date,year.slice(0,4));
 if(!id||!studentId||!classId||!collectionDate||!Number.isSafeInteger(amount)||amount<=0||!['Đã nộp','Nợ'].includes(status)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period||'')||(status==='Đã nộp'&&syncStatus!=='Đã đồng bộ'))return null;
 return {id,requestId:row[12]||`legacy:${id}`,studentId,classId,period,amount,status,date:collectionDate,method:method||'Tiền mặt',createdBy:row[13]||'migration'};
}
