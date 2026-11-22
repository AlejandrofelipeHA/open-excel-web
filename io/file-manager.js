import {address,coordinates,newSheet,ROWS,COLS} from '../core/grid-model.js';
import {excelFormula,literal} from '../core/formula-engine.js';
import {excelAliases} from '../plugins/standard-functions.js';
import {readOOXML,styledXlsx} from './ooxml.js';

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
  const opts={cellNF:true,cellStyles:true,cellHTML:false,sheetStubs:true,bookFiles:!isCSV};
  const src=isCSV ? x.read(await file.text(),{...opts,type:'string',raw:true}) : x.read(await file.arrayBuffer(),opts);
  const extra=readOOXML(src.files);
  const date1904=Boolean(src.Workbook?.WBProps?.date1904),warnings=[];
  let omitted=0;
  const sheets=src.SheetNames.map(name=>{
    const result=newSheet(name), data=src.Sheets[name];
    const metadata=extra.get(name);
    const objects=data ?? {};
    const merges=(objects['!merges'] ?? []).filter(b=>b.s.r<ROWS&&b.s.c<COLS).map(b=>({
      r0:b.s.r,c0:b.s.c,r1:Math.min(ROWS-1,b.e.r),c1:Math.min(COLS-1,b.e.c)
    }));
    if (merges.length) result.merges=merges;
    if (metadata?.charts.length) result.charts=metadata.charts;
    if (metadata?.freeze) result.freeze=metadata.freeze;
    const hiddenRows=metadata?.hiddenRows ?? (objects['!rows'] ?? []).flatMap((row,i)=>row?.hidden?[i]:[]);
    if (hiddenRows.length) result.sourceHidden=hiddenRows.filter(i=>i>=0&&i<ROWS);
    const autoFilter=objects['!autofilter']?.ref?.split(':').map(coordinates);
    if (autoFilter?.length===2&&autoFilter.every(Boolean)) {
      const [a,b]=autoFilter;
      result.filterRange={r0:a.r,c0:a.c,r1:b.r,c1:b.c};
    }
    for (const [a,entry] of Object.entries(objects)) {
      if (a.startsWith('!')) continue;
      if (!coordinates(a)) {if (entry.v!=null||entry.f) omitted++;continue;}
      const z=entry.z && entry.z!=='General'?String(entry.z):null;
      const format=styleFormat(z ?? '');
      const style={...metadata?.styles.get(a),...(z?{excelFormat:z}:{})};
      if (!style.bg && entry.s?.patternType==='solid' && /^[a-f\d]{6}$/i.test(entry.s.fgColor?.rgb ?? '')) style.bg='#'+entry.s.fgColor.rgb;
      const value=entry.t==='n'&&entry.v!=null&&format==='date'&&date1904?entry.v+1462:entry.v;
      if (entry.f) {
        const cached=entry.t!=='e'&&['number','string','boolean'].includes(typeof value)?value:undefined;
        result.cells.set(a,{raw:'='+entry.f,style,...(cached===undefined?{}:{cached})});
      } else if (entry.t==='e') {
        result.cells.set(a,{raw:entry.w||'#ERROR!',style,error:entry.w||'#ERROR!'});
      } else if (value!=null && value!=='') {
        const str=String(value);
        const raw=['s','str'].includes(entry.t) && (!isCSV || str.startsWith('=')) &&
          (str.startsWith('=') || str.startsWith("'") || typeof literal(str)!=='string') ? "'"+str : str;
        result.cells.set(a,{raw,style});
      } else if (Object.keys(style).length) result.cells.set(a,{raw:'',style});
    }
    for (const [a,style] of metadata?.styles ?? []) {
      if (coordinates(a)&&!result.cells.has(a)) result.cells.set(a,{raw:'',style});
    }
    for (const [metadata,key,dim,max,minimum] of [
      ['!cols','cols','wpx',COLS,32],
      ['!rows','rows','hpx',ROWS,20]
    ]) {
      for (const [i,entry] of (objects[metadata] ?? []).entries()) {
        const size=entry?.[dim];
        if (i<max && Number.isFinite(size) && size>0) result[key].set(i,Math.max(minimum,Math.min(600,Math.round(size))));
      }
    }
    return result;
  });
  if (!sheets.length) throw new Error('El archivo no contiene hojas.');
  if (omitted) warnings.push(omitted+' celdas exceden el área de 12.000 × 1.024 y no se importaron.');
  sheets.warnings=warnings;
  return sheets;
}

function fromFilter(data,b) {
  data['!autofilter']={ref:address(b.r0,b.c0)+':'+address(b.r1,b.c1)};
}
export function exportFile(book,engine,extension) {
  const x=library(), out=x.utils.book_new();
  const all=extension==='csv'?[book.get(book.active)]:book.sheets;
  for (const sheet of all) {
    const data={};
    let r1=-1,c1=-1;
    for (const [a,cell] of sheet.cells) {
      if (!cell.raw && (extension==='csv'||!Object.keys(cell.style ?? {}).length)) continue;
      const {r,c}=coordinates(a);
      r1=Math.max(r,r1);c1=Math.max(c,c1);
      let failed=false,value;
      try {value=engine.read(sheet.id,a);} catch(error) {failed=true;value=error.message;}
      const errorCode={'#¡DIV/0!':7,'#¡VALOR!':15,'#REF!':23,'#¿NOMBRE?':29,'#¡NUM!':36,'#N/A':42}[value] ?? 15;
      const t=failed&&extension==='xlsx'?'e':typeof value==='number'?'n':typeof value==='boolean'?'b':'s';
      const entry={t,v:t==='e'?errorCode:value??''};
      if (cell.raw.startsWith('=') && extension==='xlsx') entry.f=excelFormula(cell.raw,excelAliases);
      if (cell.style?.excelFormat) entry.z=cell.style.excelFormat;
      else if (formats[cell.style?.format]) entry.z=formats[cell.style.format];
      data[a]=entry;
    }
    if (sheet.merges?.length) {
      data['!merges']=sheet.merges.map(b=>({s:{r:b.r0,c:b.c0},e:{r:b.r1,c:b.c1}}));
      for (const b of sheet.merges) {r1=Math.max(r1,b.r1);c1=Math.max(c1,b.c1);}
    }
    const filter=sheet.filter?.range ?? sheet.filterRange;
    if (filter) {
      fromFilter(data,filter);
      r1=Math.max(r1,filter.r1);c1=Math.max(c1,filter.c1);
    }
    data['!ref']='A1:'+address(Math.max(0,r1),Math.max(0,c1));
    data['!cols']=Array.from({length:Math.max(0,...sheet.cols.keys())+1},(_,i)=>sheet.cols.has(i)?{wpx:sheet.cols.get(i)}:undefined);
    data['!rows']=Array.from({length:Math.max(0,...sheet.rows.keys())+1},(_,i)=>sheet.rows.has(i)?{hpx:sheet.rows.get(i)}:undefined);
    x.utils.book_append_sheet(out,data,sheet.name);
  }
  if (extension==='xlsx'&&typeof DOMParser!=='undefined') {
    const bytes=styledXlsx(x,out,all);
    const link=document.createElement('a');
    const url=URL.createObjectURL(new Blob([bytes instanceof ArrayBuffer?bytes:Uint8Array.from(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    link.href=url;link.download='Luma.xlsx';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  } else x.writeFile(out,'Luma.'+extension,{bookType:extension,cellStyles:true});
}
