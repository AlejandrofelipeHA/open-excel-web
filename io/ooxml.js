import {address} from '../core/grid-model.js';

const children=(node,name)=>Array.from(node?.children ?? []).filter(el=>el.localName===name);
const child=(node,name)=>children(node,name)[0];
const descendants=(node,name)=>Array.from(node?.getElementsByTagNameNS('*',name) ?? []);
const str=(node,attr)=>node?.getAttribute(attr) ?? '';
const id=(node,attr)=>Number(str(node,attr));
const enabled=(node,attr)=>/^(1|true)$/i.test(str(node,attr));
const rgb=s=>/^#?(?:[a-f\d]{2})?[a-f\d]{6}$/i.test(s)?'#'+s.slice(-6).toLowerCase():undefined;
const parse=text=>{
  if (!text || /<!DOCTYPE/i.test(text)) return null;
  const doc=new DOMParser().parseFromString(text,'application/xml');
  return doc.querySelector('parsererror')?null:doc;
};
const decoder=new TextDecoder();
const decoded=entry=>entry?.content ? decoder.decode(Uint8Array.from(entry.content)) : null;
const rels=path=>path.slice(0,path.lastIndexOf('/')+1)+'_rels/'+path.slice(path.lastIndexOf('/')+1)+'.rels';
const attributeId=el=>Array.from(el?.attributes ?? []).find(attr=>attr.localName==='id'&&attr.prefix)?.value;
function relationships(read,path) {
  return new Map(descendants(read(rels(path)),'Relationship').filter(el=>str(el,'TargetMode')!=='External')
    .map(el=>{
      const target=new URL(str(el,'Target'),'https://local.invalid/'+path);
      return [str(el,'Id'),target.origin==='https://local.invalid'?target.pathname.slice(1):null];
    }));
}
function colorResolver(read,styleDoc) {
  const scheme=descendants(read('xl/theme/theme1.xml'),'clrScheme')[0];
  const names=['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'];
  const indexed=descendants(styleDoc,'rgbColor').map(el=>str(el,'rgb'));
  const defaultColors=['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF'];
  return node=>{
    if (!node) return undefined;
    const theme=names[id(node,'theme')], entry=theme&&child(scheme,theme)?.firstElementChild;
    const index=id(node,'indexed');
    const hex=rgb(str(node,'rgb') || (node.hasAttribute('theme')?(str(entry,'lastClr')||str(entry,'val')):'') ||
      (node.hasAttribute('indexed')?(indexed[index]??defaultColors[index%8]??''):''));
    if (!hex) return undefined;
    const tint=Math.max(-1,Math.min(1,id(node,'tint')));
    if (!tint) return hex;
    return '#'+[1,3,5].map(i=>{
      const channel=parseInt(hex.slice(i,i+2),16);
      return Math.round(tint>0?channel+(255-channel)*tint:channel*(1+tint)).toString(16).padStart(2,'0');
    }).join('');
  };
}
function stylesheet(read,path) {
  const doc=read(path), root=doc?.documentElement, color=colorResolver(read,doc);
  const fonts=children(child(root,'fonts'),'font');
  const fills=children(child(root,'fills'),'fill');
  return children(child(root,'cellXfs'),'xf').map(xf=>{
    const fontId=id(xf,'fontId'),font=fonts[fontId];
    const pattern=child(fills[id(xf,'fillId')],'patternFill'), align=child(xf,'alignment');
    const style={};
    if (fontId>0) {
      for (const [tag,key] of [['b','bold'],['i','italic'],['u','underline'],['strike','strike']]) {
        const el=child(font,tag);
        if (el&&!['0','false','none'].includes(str(el,'val'))) style[key]=true;
      }
      const size=id(child(font,'sz'),'val');
      if (size>=5&&size<=60) style.size=Math.round(size*4/3);
      const fg=color(child(font,'color'));
      if (fg) style.fg=fg;
    }
    if (str(pattern,'patternType')==='solid') {
      const bg=color(child(pattern,'fgColor'));
      if (bg) style.bg=bg;
    }
    const horizontal=str(align,'horizontal'),vertical=str(align,'vertical');
    if (['left','center','right'].includes(horizontal)) style.align=horizontal;
    if (['top','center','bottom'].includes(vertical)) style.vertical=vertical;
    if (enabled(align,'wrapText')) style.wrap=true;
    return style;
  });
}
function chartPoints(root,numeric) {
  const data=[];
  for (const point of descendants(root,'pt')) {
    const index=id(point,'idx'),value=child(point,'v')?.textContent;
    if (Number.isInteger(index)&&index>=0&&index<500&&value!=null) {
      data[index]=numeric?(Number.isFinite(Number(value))?Number(value):null):value;
    }
  }
  return data;
}
function chartData(doc) {
  const items=['barChart','lineChart','pieChart','doughnutChart','areaChart'];
  const type=items.find(name=>descendants(doc,name).length);
  if (!type) return null;
  const root=descendants(doc,type)[0], series=[];
  let labels=[];
  for (const ser of children(root,'ser').slice(0,16)) {
    const vals=child(ser,'val'),cats=child(ser,'cat'),tx=child(ser,'tx');
    const values=chartPoints(vals,true);
    const source=descendants(vals,'f')[0]?.textContent;
    if (!values.length&&!source) continue;
    const categories=chartPoints(cats,false);
    if (categories.length>labels.length) labels=categories;
    const name=descendants(tx,'v')[0]?.textContent || 'Serie '+(series.length+1);
    series.push({name,values,source,categorySource:descendants(cats,'f')[0]?.textContent,
      nameSource:descendants(tx,'f')[0]?.textContent});
  }
  if (!series.length) return null;
  const length=Math.max(labels.length,...series.map(s=>s.values.length));
  return {
    kind:type==='pieChart'||type==='doughnutChart'?'pie':type==='barChart'?'bar':'line',
    title:descendants(descendants(doc,'title')[0],'t').map(el=>el.textContent).join('')||'Gráfica de Excel',
    data:{labels:Array.from({length},(_,i)=>labels[i]??String(i+1)),series:series.map(s=>({...s,
      values:Array.from({length},(_,i)=>s.values[i]??null)}))}
  };
}
export function readOOXML(files) {
  if (typeof DOMParser==='undefined'||!files?.['xl/workbook.xml']) return new Map();
  const read=path=>path?parse(decoded(files[path])):null;
  const workbook='xl/workbook.xml', lookup=relationships(read,workbook);
  const palette=stylesheet(read,'xl/styles.xml'), result=new Map();
  for (const tab of descendants(read(workbook),'sheet')) {
    const path=lookup.get(attributeId(tab)), doc=read(path);
    if (!doc) continue;
    const styles=new Map(), charts=[], hiddenRows=[];
    for (const cell of descendants(doc,'c')) {
      const style=palette[id(cell,'s')], a=str(cell,'r');
      if (a&&style&&Object.keys(style).length) styles.set(a,style);
    }
    for (const row of descendants(doc,'row')) if (enabled(row,'hidden')) hiddenRows.push(id(row,'r')-1);
    const pane=descendants(doc,'pane')[0], state=str(pane,'state');
    const freeze=state.startsWith('frozen')?{row:id(pane,'ySplit')>0,col:id(pane,'xSplit')>0}:undefined;
    const lookupDrawing=relationships(read,path);
    for (const drawing of descendants(doc,'drawing')) {
      const drawingPath=lookupDrawing.get(attributeId(drawing));
      if (!drawingPath) continue;
      const drawingRels=relationships(read,drawingPath);
      for (const chart of descendants(read(drawingPath),'chart')) {
        const item=chartData(read(drawingRels.get(attributeId(chart))));
        if (item) charts.push(item);
      }
    }
    result.set(str(tab,'name'),{styles,charts,hiddenRows,freeze});
  }
  return result;
}

const xmlBytes=new TextEncoder();
export function styledXlsx(xlsx,out,sheets) {
  const initial=xlsx.write(out,{type:'array',bookType:'xlsx',cellStyles:true});
  const zip=xlsx.CFB.read(new Uint8Array(initial),{type:'buffer'});
  const entry=path=>xlsx.CFB.find(zip,'/'+path);
  const read=path=>parse(decoded(entry(path)));
  function save(path,doc) {
    const part=entry(path);
    part.content=xmlBytes.encode(new XMLSerializer().serializeToString(doc));
    part.size=part.content.length;
  }
  const stylePath='xl/styles.xml', styles=read(stylePath), root=styles?.documentElement;
  if (!root) throw new Error('El XLSX generado no contiene un catálogo de estilos válido.');
  const ns=root.namespaceURI;
  const create=(doc,tag,attrs={})=>{
    const node=doc.createElementNS(ns,tag);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
    return node;
  };
  function add(parent,value) {
    const index=parent.childElementCount;parent.append(value);
    parent.setAttribute('count',index+1);return index;
  }
  const fonts=child(root,'fonts'),fills=child(root,'fills'),xfs=child(root,'cellXfs');
  const xfBase=children(xfs,'xf'), cache=new Map(),fontCache=new Map(),fillCache=new Map();
  function styleIndex(style,base) {
    const {bold,italic,underline,strike,size,fg,bg,align,vertical,wrap}=style;
    const key=JSON.stringify([base,bold,italic,underline,strike,size,fg,bg,align,vertical,wrap]);
    if (cache.has(key)) return cache.get(key);
    const xf=(xfBase[base]??xfBase[0]).cloneNode(true);
    if (bold||italic||underline||strike||size||rgb(fg??'')) {
      const k=JSON.stringify([bold,italic,underline,strike,size,fg]);
      if (!fontCache.has(k)) {
        const font=create(styles,'font');
        for (const [tag,active] of [['b',bold],['i',italic],['u',underline],['strike',strike]]) if (active) font.append(create(styles,tag));
        font.append(create(styles,'sz',{val:size?Math.round(size*3/4*10)/10:11}));
        if (rgb(fg??'')) font.append(create(styles,'color',{rgb:'FF'+fg.slice(-6).toUpperCase()}));
        font.append(create(styles,'name',{val:'Calibri'}));
        fontCache.set(k,add(fonts,font));
      }
      xf.setAttribute('fontId',fontCache.get(k));xf.setAttribute('applyFont','1');
    }
    if (rgb(bg??'')) {
      if (!fillCache.has(bg)) {
        const fill=create(styles,'fill'), pattern=create(styles,'patternFill',{patternType:'solid'});
        pattern.append(create(styles,'fgColor',{rgb:'FF'+bg.slice(-6).toUpperCase()}),create(styles,'bgColor',{indexed:64}));
        fill.append(pattern);fillCache.set(bg,add(fills,fill));
      }
      xf.setAttribute('fillId',fillCache.get(bg));xf.setAttribute('applyFill','1');
    }
    if (align||vertical||wrap) {
      const alignment=create(styles,'alignment');
      if (align) alignment.setAttribute('horizontal',align);
      if (vertical) alignment.setAttribute('vertical',vertical);
      if (wrap) alignment.setAttribute('wrapText','1');
      child(xf,'alignment')?.remove();xf.append(alignment);xf.setAttribute('applyAlignment','1');
    }
    const index=add(xfs,xf);cache.set(key,index);return index;
  }
  sheets.forEach((sheet,i)=>{
    const path='xl/worksheets/sheet'+(i+1)+'.xml', doc=read(path);
    if (!doc) return;
    for (const cell of descendants(doc,'c')) {
      const style=sheet.cells.get(str(cell,'r'))?.style;
      if (style&&(style.bold||style.italic||style.underline||style.strike||style.size||
        style.fg||style.bg||style.align||style.vertical||style.wrap)) cell.setAttribute('s',styleIndex(style,id(cell,'s')));
    }
    if (sheet.freeze?.row||sheet.freeze?.col) {
      const view=descendants(doc,'sheetView')[0];
      if (view) {
        const {row,col}=sheet.freeze;
        const pane=create(doc,'pane',{xSplit:Number(col||false),ySplit:Number(row||false),state:'frozen',
          topLeftCell:address(Number(row||false),Number(col||false)),activePane:row&&col?'bottomRight':row?'bottomLeft':'topRight'});
        view.prepend(pane);
      }
    }
    save(path,doc);
  });
  save(stylePath,styles);
  return xlsx.CFB.write(zip,{fileType:'zip',type:'array',compression:true});
}
