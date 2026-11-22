import {address,coordinates} from './grid-model.js';
import {compare,shiftFormula} from './formula-engine.js';

export function filteredRows(filter, value) {
  const hidden=new Set();
  if (!filter) return hidden;
  const {range}=filter;
  const rules=(filter.rules ?? [filter]).map(rule=>({...rule,needle:rule.query.trim().toLocaleLowerCase()}));
  for (let row=range.r0+1;row<=range.r1;row++) {
    const matches=rules.every(({column,mode,needle})=>{
      const cell=value(address(row,column));
      if (['gt','gte','lt','lte'].includes(mode)) {
        const limit=Number(needle.replace(',','.'));
        if (!needle||!Number.isFinite(limit)||typeof cell!=='number') return false;
        return mode==='gt'?cell>limit:mode==='gte'?cell>=limit:mode==='lt'?cell<limit:cell<=limit;
      }
      const text=String(cell ?? '').trim().toLocaleLowerCase();
      return mode==='equals'?text===needle:mode==='empty'?!text:mode==='nonempty'?Boolean(text)
        :mode==='not-contains'?!text.includes(needle):text.includes(needle);
    });
    if (!matches) hidden.add(row);
  }
  return hidden;
}

export function dataRegion(sheet,active) {
  let r0=Infinity,c0=Infinity,r1=-1,c1=-1;
  for (const [a,cell] of sheet.cells) {
    if (!cell.raw) continue;
    const {r,c}=coordinates(a);
    r0=Math.min(r0,r);c0=Math.min(c0,c);r1=Math.max(r1,r);c1=Math.max(c1,c);
  }
  return r1<0?{r0:active.r,r1:active.r,c0:active.c,c1:active.c}:{r0,r1,c0,c1};
}

export function sortCells(sheet,range,column,ascending,header,value) {
  const start=range.r0+Number(header), order=[];
  for (let r=start;r<=range.r1;r++) order.push({r,key:value(address(r,column))});
  order.sort((a,b)=>{
    const aBlank=a.key==null||a.key==='',bBlank=b.key==null||b.key==='';
    if (aBlank!==bBlank) return aBlank?1:-1;
    return (ascending?1:-1)*compare(a.key,b.key);
  });
  const updates=new Map();
  for (const [index,{r}] of order.entries()) {
    const dest=start+index;
    if (dest===r) continue;
    for (let c=range.c0;c<=range.c1;c++) {
      const source=sheet.cells.get(address(r,c));
      const a=address(dest,c);
      if (!source&&!sheet.cells.has(a)) continue;
      updates.set(a,source?{...source,raw:shiftFormula(source.raw,dest-r,0),cached:undefined}:undefined);
    }
  }
  return updates;
}

export function findCells(sheet,query,value,useRaw) {
  const needle=query.toLocaleLowerCase();
  if (!needle) return [];
  return [...sheet.cells].filter(([a,cell])=>cell.raw &&
    String(useRaw?cell.raw:value(a) ?? '').toLocaleLowerCase().includes(needle))
    .map(([a])=>({a,...coordinates(a)})).sort((a,b)=>a.r-b.r||a.c-b.c);
}

export function chartData(range,value,hidden=new Set(),kind) {
  const rows=[];
  for (let r=range.r0+1;r<=range.r1;r++) if (!hidden.has(r)) rows.push(r);
  const firstSeries=range.c0+Number(range.c1>range.c0);
  const labels=rows.map(r=>firstSeries===range.c0?String(r+1):String(value(address(r,range.c0)) ?? r+1));
  const series=[];
  for (let c=firstSeries;c<=range.c1;c++) {
    const values=rows.map(r=>{
      const v=value(address(r,c));
      return typeof v==='number'&&Number.isFinite(v)?v:null;
    });
    if (values.some(v=>v!==null)) series.push({name:String(value(address(range.r0,c)) ?? address(range.r0,c)),values});
  }
  if (kind==='scatter') for (const item of series) item.x=rows.map(r=>{
    const v=firstSeries===range.c0?r+1:value(address(r,range.c0));
    return typeof v==='number'&&Number.isFinite(v)?v:null;
  });
  return {labels,series};
}

export function resolveChartData(chart,sheet,book,read) {
  function values(source) {
    if (!source) return [];
    const bang=source.lastIndexOf('!');
    const sheetName=source.slice(0,bang).replace(/^'|'$/g,'').replaceAll("''","'");
    const target=bang<0?sheet:book.byName(sheetName);
    const [a,b]=source.slice(bang+1).split(':');
    const from=coordinates(a),to=coordinates(b??a);
    if (!target||!from||!to) return [];
    const result=[];
    for (let r=from.r;r<=to.r&&result.length<500;r++) {
      for (let c=from.c;c<=to.c&&result.length<500;c++) result.push(read(target.id,address(r,c)));
    }
    return result;
  }
  const series=chart.data.series.map(s=>{
    const linked=values(s.source), categories=values(s.categorySource);
    return {name:String(values(s.nameSource)[0]??s.name),
      values:linked.length?linked.map(v=>typeof v==='number'&&Number.isFinite(v)?v:null):s.values,categories,x:categories.length?categories.map(v=>v==null?null:Number(v)):s.x,trend:s.trend,connect:s.connect,labels:s.labels};
  });
  const length=Math.max(chart.data.labels.length,...series.map(s=>s.values.length));
  return {
    labels:Array.from({length},(_,i)=>String(series.find(s=>s.categories[i]!=null)?.categories[i]??chart.data.labels[i]??i+1)),
    series:series.map(({name,values,x,trend,connect,labels})=>({name,...(chart.kind==='scatter'?{x,trend,connect,labels}:{}),values:Array.from({length},(_,i)=>values[i]??null)}))
  };
}
