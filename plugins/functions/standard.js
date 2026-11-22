import {RangeValue, scalar, number, compare, fail} from '../../core/formula-engine.js';

function* flatten(args) {
  for (const arg of args) {
    if (arg instanceof RangeValue) yield* arg;
    else yield arg;
  }
}
function* populated(args) {
  for (const arg of args) {
    if (arg instanceof RangeValue) yield* arg.populated?arg.populated():arg;
    else yield arg;
  }
}
function* numeric(args) {
  for (const v of populated(args)) if (typeof v==='number') yield v;
}
const reduce = (values, fn, initial) => {
  let state = initial;
  for (const v of values) state = fn(state,v);
  return state;
};
const sum = (...args) => reduce(numeric(args),(a,b)=>a+b,0);
const count = (...args) => reduce(numeric(args),n=>n+1,0);
const extreme = fn => (...args) => reduce(numeric(args),(a,b)=>a === null ? b : fn(a,b),null) ?? 0;
const today = () => {
  const d = new Date();
  return (Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()) - Date.UTC(1899,11,30))/86400000;
};
function lookup(key, range, index, approximate = true) {
  if (!(range instanceof RangeValue)) fail('#¡VALOR!');
  const col = Math.trunc(number(index)) - 1;
  if (col < 0 || col > range.bounds.c1 - range.bounds.c0) fail('#REF!');
  let candidate = -1;
  for (let r = 0; r <= range.bounds.r1-range.bounds.r0; r++) {
    const cmp = compare(range.at(r,0),key);
    if (cmp === 0) return range.at(r,col);
    if (scalar(approximate) && cmp < 0) candidate = r;
    if (scalar(approximate) && cmp > 0) break;
  }
  if (candidate < 0) fail('#N/A');
  return range.at(candidate,col);
}
export const definitions = [
  ['SUM','SUMA',sum],
  ['AVERAGE','PROMEDIO',(...args)=>count(...args) ? sum(...args)/count(...args) : fail('#¡DIV/0!')],
  ['IF','SI',(test,yes=()=>true,no=()=>false)=>scalar(test()) ? yes() : no(),{lazy:true}],
  ['IFERROR','SI.ERROR',(value,fallback)=>{ try { return scalar(value()); } catch { return fallback(); } },{lazy:true}],
  ['MAX','MAX',extreme(Math.max)],
  ['MIN','MIN',extreme(Math.min)],
  ['COUNT','CONTAR',count],
  ['COUNTA','CONTARA',(...args)=>reduce(populated(args),(n,v)=>n+Number(v != null),0)],
  ['CONCAT','CONCATENAR',(...args)=>reduce(flatten(args),(a,v)=>a+String(v ?? ''),'')],
  ['ROUND','REDONDEAR',(x,d=0)=>{const p=10**Math.trunc(number(d)), n=number(x); return Math.sign(n)*Math.round(Math.abs(n)*p+Number.EPSILON)/p;}],
  ['VLOOKUP','BUSCARV',lookup],
  ['TODAY','HOY',today],
  ['ABS','ABS',x=>Math.abs(number(x))],
  ['SQRT','RAIZ',x=>Math.sqrt(number(x))],
  ['POWER','POTENCIA',(x,y)=>number(x)**number(y)],
  ['AND','Y',(...args)=>reduce(flatten(args),(a,v)=>a && Boolean(v),true)],
  ['OR','O',(...args)=>reduce(flatten(args),(a,v)=>a || Boolean(v),false)],
  ['NOT','NO',x=>!scalar(x)],
  ['LEN','LARGO',x=>String(scalar(x) ?? '').length],
  ['MOD','RESIDUO',(a,b)=>{const d=number(b); return d ? ((number(a)%d)+d)%d : fail('#¡DIV/0!');}]
];
