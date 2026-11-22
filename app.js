import {Workbook,newSheet,ROWS,COLS,address,coordinates,box,contains,points} from './core/grid-model.js';
import {FormulaEngine,shiftFormula} from './core/formula-engine.js';
import {CommandManager,CellCommand} from './core/command-manager.js';
import './plugins/standard-functions.js';
import {CanvasRenderer,BASE,clamp,display} from './ui/canvas-renderer.js';
import {EditorOverlay} from './ui/editor-overlay.js';
import {point,selectedBox,notation,area,addresses} from './ui/selection.js';
import {openStorage,importFile,exportFile} from './io/file-manager.js';
import {parseTSV,tsv} from './io/clipboard.js';
import {chartData,filteredRows,resolveChartData} from './core/data-tools.js';
import {setupWorkbookTools} from './ui/workbook-tools.js';
import {renderChart} from './ui/chart-view.js';

const $=id=>document.getElementById(id);
const grid=$('grid'), canvas=grid.querySelector('canvas'), saveStatus=$('save-status');
let storage,saved;
try {storage=await openStorage();saved=await storage.load();}
catch {storage=null;}
const book=new Workbook(saved);
const sheet=()=>book.get(book.active);
if (!saved) seed(book);
const engine=new FormulaEngine(book);
const views=new Map();
let hidden=new Set();
let active,anchor,ranges,fillPreview,referencePreview,saveVersion=0;
let touchRange=false, clipboard, clipboardWrite=0, clipboardRead=0;
resetSelection();

function resetSelection() {
  active={r:0,c:0};anchor=active;
  ranges=[box(active)];fillPreview=null;referencePreview=null;
}
function seed(workbook) {
  const example=[
    ['Producto','Unidades','Precio USD','Subtotal USD'],
    ['Cuaderno','12','4.5','=B2*C2'],
    ['Bolígrafo','25','1.2','=B3*C3'],
    ['Carpeta','8','3.75','=B4*C4'],
    [],
    ['Total','','','=SUMA(D2:D4)']
  ];
  const first=workbook.sheets[0];
  example.forEach((row,r)=>row.forEach((raw,c)=>{
    if (!raw) return;
    const style=r===0 ? {bold:true,bg:'#d9f1e6',fg:'#15503c'} : {};
    if (r>0 && c>=2) style.format='currency';
    if (r===5) style.bold=true;
    workbook.set(first.id,address(r,c),{raw,style});
  }));
  first.cols.set(0,155);first.cols.set(3,135);
  workbook.set(workbook.sheets[1].id,'A1',{raw:'Total de Hoja 1',style:{bold:true}});
  workbook.set(workbook.sheets[1].id,'B1',{raw:"='Hoja 1'!D6",style:{format:'currency'}});
  workbook.sheets[1].cols.set(0,150);
}
function currentAddress() {return address(active.r,active.c);}
function currentCell() {return sheet().cells.get(currentAddress());}
function tell(message) {$('grid-status').textContent=message;}
function persist() {
  const version=++saveVersion;
  if (!storage) {saveStatus.textContent='Guardado no disponible';return;}
  saveStatus.textContent='Guardando…';
  const write=()=>storage.save(book.serialize()).then(()=>{
    if (version===saveVersion) saveStatus.textContent='Guardado en este dispositivo';
  },()=>{if(version===saveVersion) saveStatus.textContent='Error al guardar';});
  // Enqueue the write immediately so closing the tab cannot cancel a debounce timer.
  write();
}
function sync() {
  const a=currentAddress(), range=ranges.at(-1), value=display(engine.value(book.active,a),currentCell()?.style);
  if (document.activeElement!==$('active-cell')) $('active-cell').value=notation(range);
  tell(value ? a+' · '+value+(engine.usesCache(book.active,a)?' · Valor guardado por Excel':'') : notation(range));
  editor.show(currentCell()?.raw ?? '');
  const style=currentCell()?.style ?? {};
  for (const id of ['bold','italic','underline','wrap','borders']) $(id).setAttribute('aria-pressed',Boolean(style[id]));
  $('font-size').value=String(style.size ?? '');
  for (const id of ['align','format']) $(id).value=style[id] ?? '';
  for (const id of ['fg','bg']) $(id).style.setProperty('--swatch',style[id] ?? 'var(--accent)');
  $('undo').disabled=!history.undoStack.length;
  $('redo').disabled=!history.redoStack.length;
  renderer.invalidate();
}
function refreshRows() {
  hidden=filteredRows(sheet().filter,a=>engine.value(book.active,a));
  if (!sheet().revealSourceRows) for (const row of sheet().sourceHidden ?? []) hidden.add(row);
  renderer.setHidden(hidden);
  const badge=$('filter-count');
  badge.hidden=!hidden.size&&!sheet().filter;
  badge.textContent=hidden.size+' ocultas';
}
const history=new CommandManager(()=>{refreshRows();sync();invalidateCharts();persist();});
const renderer=new CanvasRenderer(grid,{
  state:()=>({active,ranges,fill:fillPreview,reference:referencePreview}),
  layout:()=>{editor.position();layoutCharts();},
  value:a=>engine.value(book.active,a),
  cached:a=>engine.usesCache(book.active,a),
  beforePointer:()=>{editor.finish(true,false);$('palette').hidden=true;$('cell-menu').hidden=true;},
  referencing:()=>editor.referencing,
  touchRange:()=>touchRange,
  select,extend,fill,resize,
  reference:(a,b,end,done)=>{
    if (end) {
      editor.endReference(!done);
      referencePreview=null;
    } else {
      referencePreview=box(a,b);
      editor.reference(notation(referencePreview));
    }
    renderer.invalidate();
  },
  edit:p=>{select(p,false,false);editor.open(currentCell()?.raw ?? '');}
});
const editor=new EditorOverlay({
  root:grid,fx:$('fx'),menu:$('suggestions'),grid:canvas,
  layout:()=>({...renderer.rect(active),...renderer.editorClip(active)}),
  save:raw=>apply(new Map([[currentAddress(),{raw,style:currentCell()?.style ?? {}}]])),
  move
});

function apply(updates) {
  for (const [a,cell] of updates) {
    const old=sheet().cells.get(a);
    if ((!old && !cell?.raw && !Object.keys(cell?.style ?? {}).length) ||
      (old?.raw===cell?.raw && old?.cached===cell?.cached && old?.error===cell?.error && JSON.stringify(old?.style)===JSON.stringify(cell?.style))) updates.delete(a);
  }
  if (updates.size) history.run(new CellCommand(book,engine,book.active,updates));
}
function select(p,extendCurrent,add) {
  const target=point(p);
  if (!extendCurrent) {active=target;anchor=target;}
  if (!extendCurrent && !add) ranges=[];
  const range=p.merge&&!extendCurrent?p.merge:selectedBox(anchor,target,p.kind);
  if (extendCurrent) ranges[ranges.length-1]=range;
  else ranges.push(range);
  sync();
}
function extend(p,kind) {
  ranges[ranges.length-1]=selectedBox(anchor,p,kind);
  sync();
}
function move(dr,dc,extendCurrent=false) {
  const range=ranges.at(-1);
  const edge=extendCurrent?{
    r:range.r0===anchor.r?range.r1:range.r0,
    c:range.c0===anchor.c?range.c1:range.c0
  }:active;
  let row=clamp(edge.r+dr,0,ROWS-1);
  for (const step=Math.sign(dr)||1;hidden.has(row)&&row>=0&&row<ROWS;row+=step) {}
  if (row<0||row>=ROWS) return;
  const p={r:row,c:clamp(edge.c+dc,0,COLS-1)};
  select(p,extendCurrent,false);
  renderer.ensure(p);
}
function resize(axis,i,after,before) {
  const target=sheet();
  const resizeTo=size=>{
    if (size===BASE[axis]) target[axis].delete(i);
    else target[axis].set(i,size);
    if (sheet()===target) renderer.dimensions();
  };
  history.run({execute:()=>resizeTo(after),undo:()=>resizeTo(before)});
}
function fill(p,end,done) {
  const source=ranges.at(-1);
  const rowDistance=Math.max(0,source.r0-p.r,p.r-source.r1);
  const colDistance=Math.max(0,source.c0-p.c,p.c-source.c1);
  const target=rowDistance>=colDistance?{...source,r0:Math.min(source.r0,p.r),r1:Math.max(source.r1,p.r)}
    :{...source,c0:Math.min(source.c0,p.c),c1:Math.max(source.c1,p.c)};
  fillPreview=end?null:target;
  if (end&&done&&area(target)<=250000) {
    const updates=new Map(), height=source.r1-source.r0+1,width=source.c1-source.c0+1;
    const repeat=(x,size)=>((x%size)+size)%size;
    for (const {r,c} of points(target)) {
      if (contains(source,r,c)) continue;
      const sr=source.r0+repeat(r-source.r0,height),sc=source.c0+repeat(c-source.c0,width);
      const entry=sheet().cells.get(address(sr,sc));
      updates.set(address(r,c),entry ? {...entry,raw:shiftFormula(entry.raw,r-sr,c-sc),cached:undefined} : undefined);
    }
    ranges[ranges.length-1]=target;
    apply(updates);sync();
  } else if (end&&done) tell('El relleno admite hasta 250.000 celdas por operación.');
  renderer.invalidate();
}
function clear() {
  const updates=new Map();
  for (const [a,cell] of sheet().cells) {
    const {r,c}=coordinates(a);
    if (cell.raw && ranges.some(range=>contains(range,r,c))) updates.set(a,{raw:'',style:cell.style});
  }
  apply(updates);
}
function styleCells(key,value) {
  if (ranges.reduce((n,b)=>n+area(b),0)>250000) {tell('El formato admite hasta 250.000 celdas por operación.');return;}
  const updates=new Map();
  for (const a of addresses(ranges)) {
    const cell=sheet().cells.get(a), style={...cell?.style};
    if (key==='format') delete style.excelFormat;
    if (value) style[key]=value;else delete style[key];
    updates.set(a,{...cell,raw:cell?.raw ?? '',style});
  }
  apply(updates);
}

function copyData() {
  const range=ranges.at(-1);
  if (area(range)>250000) {tell('El portapapeles admite hasta 250.000 celdas.');return null;}
  const rows=[], data=[];
  for (let r=range.r0;r<=range.r1;r++) {
    const row=[], values=[];
    for (let c=range.c0;c<=range.c1;c++) {
      const a=address(r,c), cell=sheet().cells.get(a);
      row.push(cell);
      const value=engine.value(book.active,a);
      values.push(typeof value==='boolean'?String(value).toUpperCase():value);
    }
    data.push(row);rows.push(values);
  }
  return {text:tsv(rows),range,data};
}
function paste(text,source,target) {
  if (book.active!==target.sheet) return;
  const {r:originR,c:originC}=target.point, internal=source?.text===text?source:null;
  const rows=internal?.data ?? parseTSV(text);
  const width=rows.reduce((n,row)=>Math.max(n,row.length),0);
  if (rows.length*width>250000) {tell('El pegado admite hasta 250.000 celdas.');return;}
  const updates=new Map();
  rows.forEach((row,i)=>row.forEach((value,j)=>{
    const r=originR+i,c=originC+j;
    if (r>=ROWS || c>=COLS) return;
    const a=address(r,c);
    if (internal && !internal.cut) {
      updates.set(a,value?{...value,raw:shiftFormula(value.raw,originR-internal.range.r0,originC-internal.range.c0),cached:undefined}:undefined);
    } else if (internal) updates.set(a,value);
    else updates.set(a,{raw:value,style:sheet().cells.get(a)?.style ?? {}});
  }));
  apply(updates);
}
const pasteTarget=()=>({sheet:book.active,point:{...active}});
function clearCut(range,target) {
  const updates=new Map();
  if (book.active!==target) return;
  for (const [a,cell] of sheet().cells) {
    const {r,c}=coordinates(a);
    if(contains(range,r,c)) updates.set(a,{raw:'',style:cell.style});
  }
  apply(updates);
}
for (const type of ['copy','cut','paste']) document.addEventListener(type,e=>{
  if (editor.field || e.target!==canvas || !e.clipboardData) return;
  e.preventDefault();
  if (type==='paste') {
    if (Array.from(e.clipboardData.types).includes('text/plain')) {
      const token=e.clipboardData.getData('application/x-luma');
      paste(e.clipboardData.getData('text/plain'),token&&token===clipboard?.token?clipboard:null,pasteTarget());
    }
    return;
  }
  const data=copyData();
  if (!data) return;
  data.token=crypto.randomUUID();
  data.cut=type==='cut';
  clipboard=data;
  e.clipboardData.setData('text/plain',data.text);
  e.clipboardData.setData('application/x-luma',data.token);
  if (data.cut) clearCut(data.range,book.active);
});

function recordView() {
  views.set(book.active,{active,anchor,ranges,x:renderer.scroll.scrollLeft,y:renderer.scroll.scrollTop});
}
function renderTabs() {
  $('tabs').replaceChildren(...book.sheets.map(s=>{
    const button=document.createElement('button');
    button.textContent=s.name;button.setAttribute('aria-current',String(s.id===book.active));
    button.onclick=()=>switchSheet(s.id);
    return button;
  }),Object.assign(document.createElement('button'),{textContent:'+',title:'Añadir hoja',onclick:addSheet}));
}
function activate(id) {
  book.active=id;
  const view=views.get(id);
  resetSelection();
  if (view) ({active,anchor,ranges}=view);
  renderer.setSheet(sheet());
  refreshRows();
  $('document-name').textContent=sheet().fileName || 'Libro de trabajo';
  invalidateCharts();
  renderer.scroll.scrollTo(view?.x ?? 0,view?.y ?? 0);
  renderTabs();
  sync();
}
function switchSheet(id) {
  if (id===book.active) return;
  editor.finish(true,false);
  recordView();activate(id);persist();
}
function addSheet() {
  editor.finish(true,false);
  let i=1;
  while (book.byName('Hoja '+i)) i++;
  const added=newSheet('Hoja '+i), previous=book.active;
  recordView();
  history.run({
    execute:()=>{book.sheets.push(added);engine.rebuild();activate(added.id);},
    undo:()=>{book.sheets=book.sheets.filter(s=>s!==added);engine.rebuild();activate(previous);}
  });
}
canvas.addEventListener('keydown',e=>{
  if (e.isComposing || e.keyCode===229) return;
  const key=e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    const actions={z:()=>e.shiftKey?history.redo():history.undo(),y:()=>history.redo(),b:()=>styleCells('bold',!currentCell()?.style?.bold)};
    if (actions[key]) {e.preventDefault();actions[key]();}
    return;
  }
  const nav={arrowup:[-1,0],arrowdown:[1,0],arrowleft:[0,-1],arrowright:[0,1],enter:[e.shiftKey?-1:1,0],tab:[0,e.shiftKey?-1:1]};
  if (nav[key]) {e.preventDefault();move(...nav[key],e.shiftKey && key.startsWith('arrow'));return;}
  if (key==='delete' || key==='backspace') {e.preventDefault();clear();return;}
  if (key==='f2' || e.key.length===1 && !e.altKey) {
    e.preventDefault();renderer.ensure(active);
    const raw=currentCell()?.raw ?? '';
    editor.open(raw,key==='f2'?raw:e.key);
  }
});
for (const id of ['undo','redo','clear','bold','italic']) {
  $(id).onclick=()=>{
    editor.finish(true,false);
    if (id==='clear') clear();
    else if (id==='undo' || id==='redo') history[id]();
    else styleCells(id,!currentCell()?.style?.[id]);
    canvas.focus({preventScroll:true});
  };
}
for (const id of ['align','format']) $(id).onchange=e=>{
  styleCells(id,e.target.value);canvas.focus({preventScroll:true});
};
for (const id of ['fg','bg']) $(id).onclick=()=>{
  const palette=$('palette'), rect=$(id).getBoundingClientRect(), base=palette.parentElement.getBoundingClientRect();
  palette.replaceChildren(...['','#17272e','#ffffff','#137653','#dcf5e7','#f8d87d','#f8b5b9','#bfd7ff','#864cd1','#ae2636'].map(color=>{
    const button=document.createElement('button');button.textContent=color?'':'Quitar';
    button.title=color || 'Quitar color';button.setAttribute('aria-label',button.title);
    if (color) button.style.setProperty('--color',color);
    button.onclick=()=>{styleCells(id,color);palette.hidden=true;canvas.focus({preventScroll:true});};
    return button;
  }));
  palette.style.top=rect.bottom-base.top+'px';
  palette.style.left=clamp(rect.left-base.left,0,Math.max(0,base.width-250))+'px';
  palette.hidden=false;
};
for (const type of ['copy','cut','paste']) $(type).onclick=async()=>{
  editor.finish(true,false);
  canvas.focus({preventScroll:true});
  try {
    if (type==='paste') {
      const version=++clipboardRead, target=pasteTarget();
      let text,token;
      if (navigator.clipboard.read) {
        const items=await navigator.clipboard.read();
        const item=items.find(v=>v.types.includes('text/plain'));
        if (!item) return;
        text=await (await item.getType('text/plain')).text();
        if (item.types.includes('web application/x-luma')) token=await (await item.getType('web application/x-luma')).text();
      } else text=await navigator.clipboard.readText();
      if (version===clipboardRead) paste(text,token&&token===clipboard?.token?clipboard:null,target);
    } else {
      const data=copyData(), id=book.active, version=++clipboardWrite;
      if (!data) return;
      data.token=crypto.randomUUID();data.cut=type==='cut';
      if (navigator.clipboard.write && globalThis.ClipboardItem?.supports?.('web application/x-luma')) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain':new Blob([data.text],{type:'text/plain'}),
          'web application/x-luma':new Blob([data.token],{type:'application/x-luma'})
        })]);
      } else await navigator.clipboard.writeText(data.text);
      if (version!==clipboardWrite) return;
      clipboard=data;
      if (data.cut && book.active===id && [...points(data.range)].every(({r,c})=>
        sheet().cells.get(address(r,c))===data.data[r-data.range.r0][c-data.range.c0])) clearCut(data.range,id);
    }
  } catch {tell('El navegador bloqueó el portapapeles. Prueba el atajo de teclado.');}
};
$('range-mode').onclick=()=>{
  touchRange=!touchRange;$('range-mode').setAttribute('aria-pressed',touchRange);
};
const ribbon=$('ribbon'), ribbonTabs=[...document.querySelectorAll('[data-ribbon]')];
function collapseRibbon(collapsed) {
  ribbon.hidden=collapsed;
  $('toggle').setAttribute('aria-expanded',!collapsed);
  $('toggle').setAttribute('aria-label',collapsed?'Expandir cinta':'Contraer cinta');
  $('toggle').title=$('toggle').getAttribute('aria-label');
  $('toggle').textContent=collapsed?'⌄':'⌃';
}
for (const tab of ribbonTabs) tab.onclick=()=>{
  for (const item of ribbonTabs) item.setAttribute('aria-pressed',item===tab);
  for (const panel of ribbon.children) panel.hidden=panel.dataset.panel!==tab.dataset.ribbon;
  collapseRibbon(false);
};
$('toggle').onclick=()=>collapseRibbon(!ribbon.hidden);
$('active-cell').onkeydown=e=>{
  if (e.key==='Escape') {canvas.focus();sync();return;}
  if (e.key!=='Enter') return;
  const [a,b,extra]=e.target.value.trim().split(':').map(v=>v.trim());
  const first=coordinates(a), last=b?coordinates(b):first;
  if (!first||!last||extra||hidden.has(first.r)) {tell('Escribe una dirección visible, por ejemplo B12 o B12:D20.');return;}
  editor.finish(true,false);
  active=first;anchor=first;ranges=[box(first,last)];
  canvas.focus({preventScroll:true});renderer.ensure(first);sync();
};
$('active-cell').onblur=()=>{$('active-cell').value=notation(ranges.at(-1));};
function setZoom(value) {
  const zoom=clamp(Number(value),50,160);
  $('zoom').value=zoom;
  $('zoom-reset').textContent=zoom+'%';
  renderer.setZoom(zoom/100);
}
$('zoom').oninput=e=>setZoom(e.target.value);
$('zoom-out').onclick=()=>setZoom(Number($('zoom').value)-10);
$('zoom-in').onclick=()=>setZoom(Number($('zoom').value)+10);
$('zoom-reset').onclick=()=>setZoom(100);
$('font-size').onchange=e=>styleCells('size',Number(e.target.value));
$('borders').onclick=()=>{
  editor.finish(true,false);
  const edge={style:'thin',color:'#435a60'};
  styleCells('borders',currentCell()?.style?.borders?null:{left:edge,right:edge,top:edge,bottom:edge});
};
$('underline').onclick=()=>{editor.finish(true,false);styleCells('underline',!currentCell()?.style?.underline);};
$('wrap').onclick=()=>{editor.finish(true,false);styleCells('wrap',!currentCell()?.style?.wrap);};
const chartLayer=$('sheet-charts');
let chartNodes=[];
function invalidateCharts() {
  for (const item of chartNodes) item.node?.remove();
  chartNodes=(sheet().charts ?? []).map((chart,i)=>({
    chart,anchor:chart.anchor ?? {from:{r:Math.min(ROWS-1,(chart.range?.r1??4)+2+i*17),c:chart.range?.c0??1,dx:0,dy:0},w:590,h:350}
  }));
  renderer.invalidate();
}
function layoutCharts() {
  const clip=renderer.chartClip();
  chartLayer.style.clipPath='inset('+clip.y+'px '+Math.max(0,grid.clientWidth-clip.w)+'px '+Math.max(0,grid.clientHeight-clip.h)+'px '+clip.x+'px)';
  if (chartLayer.hidden) return;
  for (const item of chartNodes) {
    const {x,y,w,h}=renderer.chartRect(item.anchor);
    const visible=w>0&&h>0&&x<clip.w&&y<clip.h&&x+w>clip.x&&y+h>clip.y;
    if (!visible) {if(item.node) item.node.hidden=true;continue;}
    if (!item.node) {
      const {chart}=item, node=document.createElement('section'),title=document.createElement('h3'),content=document.createElement('div');
      node.className='sheet-chart';title.textContent=chart.title;content.className='chart-content';
      node.append(title,content);chartLayer.append(node);item.node=node;
      const data=chart.range?chartData(chart.range,a=>engine.value(book.active,a),hidden,chart.kind):
        resolveChartData(chart,sheet(),book,(id,a)=>engine.value(id,a));
      renderChart(content,data,chart.kind,chart.title,chart.axes);
    }
    item.node.hidden=false;
    Object.assign(item.node.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
  }
}
$('chart-toggle').onclick=()=>{
  chartLayer.hidden=!chartLayer.hidden;
  $('chart-toggle').setAttribute('aria-pressed',!chartLayer.hidden);
  renderer.invalidate();
};
function setTheme(theme) {
  document.documentElement.dataset.theme=theme;renderer.invalidate();
  try {localStorage.setItem('luma-theme',theme);} catch {}
}
try {setTheme(localStorage.getItem('luma-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));}
catch {}
$('theme').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
const filePicker=$('import-file');
let importPending=false;
$('import').onclick=()=>filePicker.click();
filePicker.onchange=async()=>{
  const file=filePicker.files[0];
  filePicker.value='';
  if (!file||importPending) return;
  importPending=true;
  $('import').disabled=true;
  tell('Leyendo '+file.name+'…');
  try {
    const after=await importFile(file);
    for (const tab of after) tab.fileName=file.name;
    const warning=after.warnings?.length?'\n\n'+after.warnings.join('\n'):'';
    if (!window.confirm('¿Reemplazar el libro abierto? Puedes deshacer la importación.'+warning)) {sync();return;}
    editor.finish(true,false);
    recordView();
    const before=book.sheets,id=book.active;
    const swap=(sheets,activeId)=>{book.sheets=sheets;engine.rebuild();activate(activeId);};
    history.run({execute:()=>swap(after,after[0].id),undo:()=>swap(before,id)});
    tell('Importado · '+file.name+(warning?' · '+after.warnings.join(' '):''));
  } catch(error) {tell('Error al importar · '+error.message);}
  finally {importPending=false;$('import').disabled=false;}
};
for (const button of document.querySelectorAll('[data-export]')) button.onclick=()=>{
  editor.finish(true,false);
  try {exportFile(book,engine,button.dataset.export);}
  catch(error) {tell('Error al exportar · '+error.message);}
};
const cellMenu=$('cell-menu');
function showCellMenu(x,y) {
  const parent=cellMenu.parentElement.getBoundingClientRect();
  cellMenu.hidden=false;
  const bounds=cellMenu.getBoundingClientRect();
  cellMenu.style.left=clamp(x-parent.left,0,Math.max(0,parent.width-bounds.width))+'px';
  cellMenu.style.top=clamp(y-parent.top,0,Math.max(0,parent.height-bounds.height))+'px';
  cellMenu.querySelector('button').focus();
}
canvas.addEventListener('contextmenu',e=>{
  e.preventDefault();editor.finish(true,false);
  const hit=renderer.hit(e);
  if (!ranges.some(b=>contains(b,hit.r,hit.c))) select(hit,false,false);
  showCellMenu(e.clientX,e.clientY);
});
canvas.addEventListener('keydown',e=>{
  if (e.key==='ContextMenu'||e.shiftKey&&e.key==='F10') {
    e.preventDefault();
    const bounds=canvas.getBoundingClientRect(), cell=renderer.rect(active);
    showCellMenu(bounds.left+cell.x,bounds.top+cell.y+cell.h);
  }
});
cellMenu.addEventListener('keydown',e=>{
  if (e.key!=='Escape') return;
  e.preventDefault();cellMenu.hidden=true;canvas.focus({preventScroll:true});
});
cellMenu.addEventListener('click',e=>{
  const action=e.target.closest('button')?.dataset.cellAction;
  if (!action) return;
  cellMenu.hidden=true;
  ($(action) ?? document.querySelector('[data-tool="'+action+'"]'))?.click();
});
document.addEventListener('pointerdown',e=>{
  if (!cellMenu.hidden&&!cellMenu.contains(e.target)) cellMenu.hidden=true;
});
setupWorkbookTools({
  canvas,sheet,active:()=>active,range:()=>ranges.at(-1),hidden:()=>hidden,
  importedChart:chart=>resolveChartData(chart,sheet(),book,(id,a)=>engine.value(id,a)),
  finish:()=>editor.finish(true,false),focus:()=>canvas.focus({preventScroll:true}),
  value:a=>engine.value(book.active,a),apply,
  go:p=>{
    if (hidden.has(p.r)) return false;
    select(p,false,false);renderer.ensure(p);return true;
  },
  change:(key,value)=>{
    const target=sheet(),previous=target[key];
    const set=next=>{target[key]=next;};
    history.run({execute:()=>set(value),undo:()=>set(previous)});
  }
});
activate(book.active);
persist();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(error=>console.warn('PWA',error));
