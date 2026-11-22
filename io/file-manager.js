import {address,coordinates,newSheet,ROWS,COLS} from '../core/grid-model.js';
import {excelFormula,literal} from '../core/formula-engine.js';
import {excelAliases} from '../plugins/standard-functions.js';

export async function openStorage() {
  const db=await new Promise((resolve,reject)=>{
    const req=indexedDB.open('luma-hojas',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('workbooks');
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return {
    load:()=>new Promise((resolve,reject)=>{
      const req=db.transaction('workbooks').objectStore('workbooks').get('current');
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    }),
    save:data=>new Promise((resolve,reject)=>{
      const tx=db.transaction('workbooks','readwrite');
      tx.objectStore('workbooks').put(data,'current');
      tx.oncomplete=()=>resolve();
      tx.onerror=tx.onabort=()=>reject(tx.error);
    })
  };
}

function library() {
  if (!globalThis.XLSX) throw new Error('SheetJS no está disponible.');
  return globalThis.XLSX;
}
const styleFormat = z => /%/.test(z) ? 'percent' : /[$€£]/.test(z) ? 'currency'
  : /^[#0,]+\.0+$/.test(z) ? 'decimal' : z && library().SSF.is_date(z) ? 'date' : undefined;
const formats={percent:'0.00%',currency:'"$"#,##0.00',decimal:'0.00',date:'yyyy-mm-dd'};

export async function importFile(file) {
  const x=library(), isCSV=/\.csv$/i.test(file.name);
  const opts={cellNF:true,cellStyles:true};
  const src=isCSV ? x.read(await file.text(),{...opts,type:'string',raw:true}) : x.read(await file.arrayBuffer(),opts);
  const sheets=src.SheetNames.map(name=>{
    const result=newSheet(name), data=src.Sheets[name];
    for (const [a,entry] of Object.entries(data)) {
      if (a.startsWith('!')) continue;
      if (!coordinates(a)) throw new Error('El archivo supera el área de 12.000 filas × 1.024 columnas.');
      const format=styleFormat(entry.z ?? '');
      const style=format ? {format} : {};
      if (entry.f) result.cells.set(a,{raw:'='+entry.f,style});
      else if (entry.v!=null && entry.v!=='') {
        const value=String(entry.v);
        const raw=entry.t==='s' && (!isCSV || value.startsWith('=')) && (value.startsWith('=') || value.startsWith("'") || typeof literal(value)!=='string')
          ? "'"+value : value;
        result.cells.set(a,{raw,style});
      }
    }
    for (const [metadata,key,dim,max,minimum] of [
      ['!cols','cols','wpx',COLS,32],
      ['!rows','rows','hpx',ROWS,20]
    ]) {
      for (const [i,entry] of (data[metadata] ?? []).entries()) {
        const size=entry?.[dim];
        if (i<max && Number.isFinite(size) && size>0) result[key].set(i,Math.max(minimum,Math.min(600,Math.round(size))));
      }
    }
    return result;
  });
  if (!sheets.length) throw new Error('El archivo no contiene hojas.');
  return sheets;
}

export function exportFile(book,engine,extension) {
  const x=library(), out=x.utils.book_new();
  const all=extension==='csv'?[book.get(book.active)]:book.sheets;
  for (const sheet of all) {
    const data={};
    let r1=-1,c1=-1;
    for (const [a,cell] of sheet.cells) {
      if (!cell.raw) continue;
      const {r,c}=coordinates(a);
      r1=Math.max(r,r1);c1=Math.max(c,c1);
      let failed=false,value;
      try {value=engine.read(sheet.id,a);} catch(error) {failed=true;value=error.message;}
      const errorCode={'#¡DIV/0!':7,'#¡VALOR!':15,'#REF!':23,'#¿NOMBRE?':29,'#¡NUM!':36,'#N/A':42}[value] ?? 15;
      const t=failed&&extension==='xlsx'?'e':typeof value==='number'?'n':typeof value==='boolean'?'b':'s';
      const entry={t,v:t==='e'?errorCode:value??''};
      if (cell.raw.startsWith('=') && extension==='xlsx') entry.f=excelFormula(cell.raw,excelAliases);
      if (formats[cell.style?.format]) entry.z=formats[cell.style.format];
      data[a]=entry;
    }
    data['!ref']='A1:'+address(Math.max(0,r1),Math.max(0,c1));
    data['!cols']=Array.from({length:Math.max(0,...sheet.cols.keys())+1},(_,i)=>sheet.cols.has(i)?{wpx:sheet.cols.get(i)}:undefined);
    data['!rows']=Array.from({length:Math.max(0,...sheet.rows.keys())+1},(_,i)=>sheet.rows.has(i)?{hpx:sheet.rows.get(i)}:undefined);
    x.utils.book_append_sheet(out,data,sheet.name);
  }
  x.writeFile(out,'Luma.'+extension,{bookType:extension,cellStyles:true});
}
