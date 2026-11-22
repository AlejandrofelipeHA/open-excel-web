import {RangeValue,compare,fail,number,scalar} from '../../core/formula-engine.js';

const text=v=>String(scalar(v) ?? '');
const integer=v=>Math.trunc(number(v));
const positive=v=>{const n=integer(v);return n>=0?n:fail('#¡VALOR!');};
const vector=v=>{
  if (!(v instanceof RangeValue)) return [v];
  if (v.length>250000) fail('#¡NUM!');
  return [...v];
};
const numeric=args=>{
  const values=[];
  for (const v of args) {
    const items=v instanceof RangeValue&&v.populated?v.populated():vector(v);
    for (const item of items) if (typeof item==='number') values.push(item);
  }
  return values;
};
const dateSerial=d=>d.getTime()/86400000+25569;
const serialDate=v=>new Date((number(v)-25569)*86400000);
const date=(y,m,d)=>{
  const year=integer(y);
  if (year<0||year>9999) fail('#¡NUM!');
  const value=new Date(0);
  value.setUTCFullYear(year<1900?year+1900:year,integer(m)-1,integer(d));
  return dateSerial(value);
};
const grammar=/^(<=|>=|<>|=|<|>)?(.*)$/s;
const escape=s=>s.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
function criterion(input) {
  const v=scalar(input);
  if (typeof v!=='string') return x=>compare(x,v)===0;
  const [,operator='=',content]=grammar.exec(v);
  if (['=','<>'].includes(operator) && /[?*~]/.test(content)) {
    const pattern=content.match(/~[~?*]|./gs).map(c=>c==='*'?'.*':c==='?'?'.':escape(c.length===2?c[1]:c)).join('');
    const regex=new RegExp('^'+pattern+'$','isu');
    return x=>regex.test(String(x ?? ''))===(operator==='=');
  }
  const target=/^[+-]?\d+(?:\.\d+)?$/.test(content)?Number(content):content;
  return value=>{
    const candidate=typeof target==='number'&&typeof value==='string'&&/^[+-]?\d+(?:\.\d+)?$/.test(value)?Number(value):value;
    const cmp=compare(candidate ?? (target===''?'':0),target);
    return ({'=':cmp===0,'<>':cmp!==0,'<':cmp<0,'>':cmp>0,'<=':cmp<=0,'>=':cmp>=0})[operator];
  };
}
function aggregate(kind,range,criteria) {
  if (!criteria.length || criteria.length%2) fail('#¡VALOR!');
  const sources=[];
  for (let i=0;i<criteria.length;i+=2) sources.push({values:vector(criteria[i]),test:criterion(criteria[i+1])});
  const values=range===null?null:vector(range);
  const length=sources[0].values.length;
  if (sources.some(s=>s.values.length!==length)||values&&values.length!==length) fail('#¡VALOR!');
  let count=0,sum=0;
  for (let i=0;i<length;i++) {
    if (!sources.every(s=>s.test(s.values[i]))) continue;
    if (kind==='count') count++;
    else if (typeof values[i]==='number') {sum+=values[i];count++;}
  }
  if (kind==='count') return count;
  return kind==='average'?(count?sum/count:fail('#¡DIV/0!')):sum;
}
function index(range,row,col=1) {
  const r=integer(row)-1,c=integer(col)-1;
  if (!(range instanceof RangeValue)) return r===0&&c===0?range:fail('#REF!');
  if (r<0||c<0||r>range.bounds.r1-range.bounds.r0||c>range.bounds.c1-range.bounds.c0) fail('#REF!');
  return range.at(r,c);
}
function match(key,range,mode=1) {
  const m=integer(mode), values=vector(range);
  if (![-1,0,1].includes(m)) fail('#¡VALOR!');
  let best=-1;
  const test=m===0&&typeof scalar(key)==='string'?criterion('='+scalar(key)):null;
  for (const [i,value] of values.entries()) {
    const cmp=compare(value,key);
    if (test?test(value):cmp===0) return i+1;
    if (m && cmp===-m && (best<0 || compare(value,values[best])===m)) best=i;
  }
  return best<0?fail('#N/A'):best+1;
}
function xlookup(key,range,result,missing=()=>fail('#N/A'),mode=()=>0,search=()=>1) {
  const values=vector(range()), output=vector(result()), wanted=key(), m=integer(mode()), direction=integer(search());
  if (values.length!==output.length || ![0,-1,1,2].includes(m) || ![1,-1].includes(direction)) fail('#¡VALOR!');
  const wildcard=m===2?criterion('='+text(wanted)):null;
  let best=-1;
  for (let i=direction===1?0:values.length-1;i>=0&&i<values.length;i+=direction) {
    const cmp=compare(values[i],wanted);
    if (wildcard?wildcard(values[i]):!cmp) return output[i];
    if ((m===1||m===-1)&&cmp===m&&(best<0||compare(values[i],values[best])===-m)) best=i;
  }
  return best<0?missing():output[best];
}
const rounded=(value,digits,towards)=>{
  const n=number(value), power=10**integer(digits);
  return Math.sign(n)*towards(Math.abs(n)*power)/power;
};
const median=(...args)=>{
  const values=numeric(args).sort((a,b)=>a-b), m=Math.floor(values.length/2);
  return values.length?(values.length%2?values[m]:(values[m-1]+values[m])/2):fail('#¡NUM!');
};
function deviation(sample,args) {
  const values=numeric(args);
  if (values.length<=sample) fail('#¡DIV/0!');
  let mean=0,m2=0;
  for (const [i,x] of values.entries()) {
    const delta=x-mean;mean+=delta/(i+1);m2+=delta*(x-mean);
  }
  return Math.sqrt(m2/(values.length-sample));
}
export const extended=[
  ['SUMIF','SUMAR.SI',(r,c,s=r)=>aggregate('sum',s,[r,c])],
  ['SUMIFS','SUMAR.SI.CONJUNTO',(s,...c)=>aggregate('sum',s,c)],
  ['COUNTIF','CONTAR.SI',(r,c)=>aggregate('count',null,[r,c])],
  ['COUNTIFS','CONTAR.SI.CONJUNTO',(...c)=>aggregate('count',null,c)],
  ['AVERAGEIF','PROMEDIO.SI',(r,c,s=r)=>aggregate('average',s,[r,c])],
  ['AVERAGEIFS','PROMEDIO.SI.CONJUNTO',(s,...c)=>aggregate('average',s,c)],
  ['INDEX','INDICE',index],['MATCH','COINCIDIR',match],['XLOOKUP','BUSCARX',xlookup,{lazy:true}],
  ['HLOOKUP','BUSCARH',(key,r,c,m=true)=>{
    if (!(r instanceof RangeValue)) fail('#¡VALOR!');
    const row=integer(c)-1, width=r.bounds.c1-r.bounds.c0+1;
    if (row<0||row>r.bounds.r1-r.bounds.r0) fail('#REF!');
    const lookup=new RangeValue({r0:0,r1:0,c0:0,c1:width-1},(_,i)=>r.at(0,i));
    return r.at(row,match(key,lookup,m?1:0)-1);
  }],
  ['LEFT','IZQUIERDA',(v,n=1)=>text(v).slice(0,positive(n))],
  ['RIGHT','DERECHA',(v,n=1)=>{const s=text(v);return s.slice(Math.max(0,s.length-positive(n)));}],
  ['MID','EXTRAE',(v,start,len)=>{const i=positive(start)-1;return i<0?fail('#¡VALOR!'):text(v).slice(i,i+positive(len));}],
  ['UPPER','MAYUSC',v=>text(v).toUpperCase()],['LOWER','MINUSC',v=>text(v).toLowerCase()],
  ['PROPER','NOMPROPIO',v=>text(v).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu,(_,left,ch)=>left+ch.toUpperCase())],
  ['TRIM','ESPACIOS',v=>text(v).trim().replace(/ +/g,' ')],
  ['SUBSTITUTE','SUSTITUIR',(v,a,b,k)=>{
    const s=text(v),from=text(a),to=text(b);
    if (!from) return s;
    if (k===undefined) return s.replaceAll(from,()=>to);
    const n=positive(k);if (!n) fail('#¡VALOR!');
    let i=0;return s.replaceAll(from,()=>++i===n?to:from);
  }],
  ['FIND','ENCONTRAR',(a,b,p=1)=>{const i=positive(p);const at=text(b).indexOf(text(a),i-1);return i&&at>=0?at+1:fail('#¡VALOR!');}],
  ['TEXTJOIN','UNIRCADENAS',(sep,skip,...args)=>args.flatMap(vector).map(text).filter(s=>!scalar(skip)||s!=='').join(text(sep))],
  ['VALUE','VALOR',v=>number(text(v))],
  ['DATE','FECHA',date],['YEAR','AÑO',v=>serialDate(v).getUTCFullYear()],
  ['MONTH','MES',v=>serialDate(v).getUTCMonth()+1],['DAY','DIA',v=>serialDate(v).getUTCDate()],
  ['NOW','AHORA',()=>dateSerial(new Date())],
  ['DAYS','DIAS',(end,start)=>Math.floor(number(end))-Math.floor(number(start))],
  ['INT','ENTERO',v=>Math.floor(number(v))],
  ['ROUNDUP','REDONDEAR.MAS',(v,d)=>rounded(v,d,Math.ceil)],
  ['ROUNDDOWN','REDONDEAR.MENOS',(v,d)=>rounded(v,d,Math.floor)],
  ['TRUNC','TRUNCAR',(v,d=0)=>rounded(v,d,Math.floor)],
  ['PRODUCT','PRODUCTO',(...args)=>{const values=numeric(args);return values.length?values.reduce((a,b)=>a*b,1):0;}],
  ['MEDIAN','MEDIANA',median],['STDEV.S','DESVEST.M',(...args)=>deviation(1,args)],
  ['STDEV.P','DESVEST.P',(...args)=>deviation(0,args)],
  ['COUNTBLANK','CONTAR.BLANCO',v=>{
    if (!(v instanceof RangeValue)) return Number(v==null||v==='');
    let remaining=v.length;
    for (const x of v.populated?v.populated():v) if (x!=null&&x!=='') remaining--;
    return remaining;
  }],
  ['IFNA','SI.ND',(value,fallback)=>{try{return scalar(value());}catch(error){if(error.message==='#N/A')return fallback();throw error;}},{lazy:true}],
  ['ISNUMBER','ESNUMERO',v=>typeof scalar(v)==='number'],
  ['ISTEXT','ESTEXTO',v=>typeof scalar(v)==='string'],
  ['ISBLANK','ESBLANCO',v=>scalar(v)==null],
  ['ISERROR','ESERROR',v=>{try{scalar(v());return false;}catch{return true;}},{lazy:true}],
  ['SUMPRODUCT','SUMAPRODUCTO',(...args)=>{
    const vectors=args.map(vector),length=vectors[0]?.length;
    if (!length||vectors.some(v=>v.length!==length)) fail('#¡VALOR!');
    let total=0;
    for (let i=0;i<length;i++) total+=vectors.reduce((p,v)=>p*(typeof v[i]==='number'?v[i]:0),1);
    return total;
  }],
  ['EOMONTH','FIN.MES',(start,months)=>{const d=serialDate(start);d.setUTCMonth(d.getUTCMonth()+integer(months)+1,0);return Math.floor(dateSerial(d));}],
  ['WEEKDAY','DIASEM',(v,type=1)=>{
    const day=serialDate(v).getUTCDay(), mode=integer(type);
    if (mode===1||mode===17) return day+1;
    if (mode===2||mode===11) return (day+6)%7+1;
    if (mode===3) return (day+6)%7;
    return mode>=12&&mode<=16?(day+18-mode)%7+1:fail('#¡NUM!');
  }],
  ['NPV','VNA',(rate,...args)=>{
    const r=number(rate);
    if (r===-1) fail('#¡DIV/0!');
    return numeric(args).reduce((sum,v,i)=>sum+v/(1+r)**(i+1),0);
  }],
  ['PMT','PAGO',(rate,periods,pv,fv=0,type=0)=>{
    const r=number(rate), n=number(periods), p=number(pv), f=number(fv);
    if (!n) fail('#¡DIV/0!');
    if (!r) return -(p+f)/n;
    const power=(1+r)**n;
    return -(p*power+f)*r/((1+r*Number(Boolean(scalar(type))))*(power-1));
  }],
  ['NA','NOD',()=>fail('#N/A')]
];
