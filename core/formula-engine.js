import {address, coordinates, box, points, contains, nodeKey, splitKey, ROWS, COLS} from './grid-model.js';
import {DependencyGraph} from './dependency-graph.js';
import {FunctionRegistry} from './function-registry.js';

export class FormulaError extends Error {}
export const fail = code => { throw new FormulaError(code); };
const tokens = /\s+|"(?:[^"]|"")*"|'(?:[^']|'')*'|#REF!|\d+(?:\.\d*)?(?:E[+-]?\d+)?|\.\d+(?:E[+-]?\d+)?|\$\d+|\$?[\p{L}_][\p{L}\p{N}_.]*\$?\d*|<=|>=|<>|[()+\-*/^%,;:!&=<>]/giyu;
export function tokenize(source) {
  const result = [];
  for (let i = 0; i < source.length;) {
    tokens.lastIndex = i;
    const match = tokens.exec(source);
    if (!match) fail('#¡FÓRMULA!');
    i = tokens.lastIndex;
    if (match[0].trim()) result.push({text:match[0], at:match.index});
  }
  return result;
}
const precedence = {'=':1,'<>':1,'<':1,'>':1,'<=':1,'>=':1,'&':2,'+':3,'-':3,'*':4,'/':4,'^':6};
const axisCol = /^\$?[a-z]+$/i;
const axisRow = /^\$?[1-9]\d*$/;
const refPattern = /^\$?[A-Z]+\$?\d+$/i;
const unquote = s => s.startsWith("'") ? s.slice(1,-1).replaceAll("''","'") : s;

export function parse(source) {
  const list = tokenize(source);
  let i = 0;
  const peek = () => list[i]?.text;
  const take = () => list[i++]?.text ?? fail('#¡FÓRMULA!');
  const expect = text => { if (take() !== text) fail('#¡FÓRMULA!'); };
  function reference(first, inherited) {
    let a = first, sheet = inherited;
    if (peek() === '!') {
      take();
      sheet = unquote(first);
      a = take();
    }
    return {kind:'ref', sheet, a:a.replaceAll('$','').toUpperCase()};
  }
  function atom() {
    const t = take();
    if (t === '(') { const value = expression(); expect(')'); return value; }
    if (t === '+' || t === '-') return {kind:'unary', op:t, value:expression(5)};
    if (t.startsWith('"')) return {kind:'literal', value:t.slice(1,-1).replaceAll('""','"')};
    if (/^(?:\d|\.\d)/.test(t) && peek()!==':' && peek()!=='!') return {kind:'literal', value:Number(t)};
    if (t.toUpperCase() === '#REF!') fail('#REF!');
    if (peek() === '(') {
      take();
      const args = [];
      if (peek() !== ')') {
        const argument=()=>[',',';',')'].includes(peek())?{kind:'literal',value:undefined}:expression();
        args.push(argument());
        while (peek() === ',' || peek() === ';') {take();args.push(argument());}
      }
      expect(')');
      return {kind:'call', name:t, args};
    }
    if (peek() === '!' || refPattern.test(t) || peek()===':'&&(axisCol.test(t)||axisRow.test(t))) {
      const start = reference(t);
      if (peek() !== ':') return coordinates(start.a)?start:fail('#REF!');
      take();
      const end = reference(take(),start.sheet);
      if (start.sheet?.toUpperCase() !== end.sheet?.toUpperCase()) fail('#REF!');
      let first=start.a,last=end.a;
      if (axisCol.test(first)&&axisCol.test(last)) {first+='1';last+=ROWS;}
      else if (axisRow.test(first)&&axisRow.test(last)) {first='A'+first;last=address(0,COLS-1).slice(0,-1)+last;}
      const a=coordinates(first), b=coordinates(last);
      if (!a||!b) fail('#REF!');
      // Full-axis ranges preserve both edges even when written in reverse.
      if (axisCol.test(start.a)&&axisCol.test(end.a)) {a.r=0;b.r=ROWS-1;}
      if (axisRow.test(start.a)&&axisRow.test(end.a)) {a.c=0;b.c=COLS-1;}
      return {kind:'range',sheet:start.sheet,bounds:box(a,b)};
    }
    if (/^(TRUE|FALSE|VERDADERO|FALSO)$/i.test(t)) {
      return {kind:'literal', value:/^(TRUE|VERDADERO)$/i.test(t)};
    }
    fail('#¿NOMBRE?');
  }
  function expression(min = 1) {
    let left = atom();
    while (peek() === '%') { take(); left = {kind:'unary', op:'%', value:left}; }
    while ((precedence[peek()] ?? 0) >= min) {
      const op = take();
      left = {kind:'binary', op,left,right:expression(precedence[op] + (op === '^' ? 0 : 1))};
    }
    return left;
  }
  const result = expression();
  if (i !== list.length) fail('#¡FÓRMULA!');
  return result;
}

export class RangeValue {
  constructor(bounds, read, populated) {this.bounds=bounds;this.read=read;this.populated=populated;}
  get length() {const b=this.bounds;return (b.r1-b.r0+1)*(b.c1-b.c0+1);}
  *[Symbol.iterator]() {
    for (const {r,c} of points(this.bounds)) yield this.read(r,c);
  }
  at(row,col) { return this.read(this.bounds.r0 + row,this.bounds.c0 + col); }
}
export const scalar = value => value instanceof RangeValue ? value.at(0,0) : value;
export function number(value) {
  const v = scalar(value);
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) fail('#¡VALOR!');
  return n;
}
export function compare(a,b) {
  const normalize = v => typeof v === 'string' ? v.toUpperCase() : v;
  const x = normalize(scalar(a) ?? 0), y = normalize(scalar(b) ?? 0);
  if (x === y) return 0;
  const rank = v => typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2;
  return rank(x) !== rank(y) ? Math.sign(rank(x)-rank(y)) : x < y ? -1 : 1;
}
const ops = {
  '+':(a,b)=>number(a)+number(b), '-':(a,b)=>number(a)-number(b),
  '*':(a,b)=>number(a)*number(b), '/':(a,b)=>number(b) ? number(a)/number(b) : fail('#¡DIV/0!'),
  '^':(a,b)=>number(a)**number(b), '&':(a,b)=>String(scalar(a) ?? '') + String(scalar(b) ?? ''),
  '=':(a,b)=>compare(a,b)===0, '<>':(a,b)=>compare(a,b)!==0,
  '<':(a,b)=>compare(a,b)<0, '>':(a,b)=>compare(a,b)>0,
  '<=':(a,b)=>compare(a,b)<=0, '>=':(a,b)=>compare(a,b)>=0
};

export function literal(raw) {
  if (raw == null || raw === '') return null;
  if (raw.startsWith("'")) return raw.slice(1);
  if (/^(true|verdadero)$/i.test(raw)) return true;
  if (/^(false|falso)$/i.test(raw)) return false;
  const normalized = raw.trim().replace(',','.');
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(normalized)) {
    const percent = normalized.endsWith('%');
    const n = Number(percent ? normalized.slice(0,-1) : normalized) / (percent ? 100 : 1);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

export class FormulaEngine {
  constructor(book) { this.book = book; this.rebuild(); }
  rebuild() {
    this.graph = new DependencyGraph();
    this.formulas = new Map();
    this.values = new Map();
    this.cachedResults = new Set();
    for (const sheet of this.book.sheets) {
      for (const [a,cell] of sheet.cells) {
        if (cell.raw.startsWith('=')) this.prepare(sheet.id,a);
      }
    }
    this.calculate(this.formulas.keys());
  }
  sheetId(name, current) {
    if (name === undefined) return current;
    return this.book.byName(name)?.id ?? fail('#REF!');
  }
  *references(ast, current) {
    if (ast.kind === 'ref') yield {key:nodeKey(this.sheetId(ast.sheet,current),ast.a)};
    if (ast.kind === 'range') yield {sheet:this.sheetId(ast.sheet,current), ...ast.bounds};
    for (const node of ast.args ?? [ast.left,ast.right,ast.kind === 'unary' ? ast.value : null]) {
      if (node) yield* this.references(node,current);
    }
  }
  prepare(sheet,a) {
    const key = nodeKey(sheet,a), raw = this.book.get(sheet).cells.get(a)?.raw;
    this.graph.replace(key,[]);
    this.formulas.delete(key);
    this.values.delete(key);
    this.cachedResults.delete(key);
    if (!raw?.startsWith('=')) return;
    try {
      const ast = parse(raw.slice(1));
      this.graph.replace(key,[...this.references(ast,sheet)]);
      this.formulas.set(key,ast);
    } catch (error) {
      this.formulas.set(key,{kind:'error', code:error instanceof FormulaError ? error.message : '#¡FÓRMULA!'});
    }
  }
  update(sheet, addresses) {
    for (const a of addresses) this.prepare(sheet,a);
    this.calculate(addresses.map(a => nodeKey(sheet,a)));
  }
  calculate(keys) {
    const {order,blocked} = this.graph.plan(keys);
    for (const key of blocked) {
      this.values.set(key,new FormulaError('#CIRC!'));
      this.cachedResults.delete(key);
    }
    for (const key of order) {
      const ast = this.formulas.get(key);
      if (!ast) continue;
      this.cachedResults.delete(key);
      try {
        const value = scalar(this.evaluate(ast,splitKey(key)[0]));
        if (typeof value === 'number' && !Number.isFinite(value)) fail('#¡NUM!');
        this.values.set(key,value);
      } catch (error) {
        const [sheet,a]=splitKey(key), cached=this.book.get(sheet).cells.get(a)?.cached;
        if (cached!==undefined && ['#¿NOMBRE?','#¡FÓRMULA!','#REF!'].includes(error.message)) {
          this.values.set(key,cached);
          this.cachedResults.add(key);
        } else this.values.set(key,error instanceof FormulaError ? error : new FormulaError('#¡VALOR!'));
      }
    }
  }
  usesCache(sheet,a) {return this.cachedResults.has(nodeKey(sheet,a));}
  read(sheet,a) {
    const key = nodeKey(sheet,a);
    const cell=this.book.get(sheet).cells.get(a);
    if (cell?.error) fail(cell.error);
    const value = this.values.has(key) ? this.values.get(key) : literal(cell?.raw);
    if (value instanceof FormulaError) throw value;
    return value;
  }
  value(sheet,a) {
    try { return this.read(sheet,a); } catch (error) { return error.message; }
  }
  evaluate(ast,sheet) {
    const run = node => this.evaluate(node,sheet);
    switch (ast.kind) {
      case 'literal': return ast.value;
      case 'error': return fail(ast.code);
      case 'ref': return this.read(this.sheetId(ast.sheet,sheet),ast.a);
      case 'range': {
        const id = this.sheetId(ast.sheet,sheet);
        const cells=this.book.get(id).cells, read=a=>this.read(id,a), bounds=ast.bounds;
        const area=(bounds.r1-bounds.r0+1)*(bounds.c1-bounds.c0+1);
        const populated=area>Math.max(512,cells.size*3)?function*(){
          const entries=[];
          for (const [a,cell] of cells) {
            if (!cell.raw) continue;
            const {r,c}=coordinates(a);
            if (contains(bounds,r,c)) entries.push({a,r,c});
          }
          entries.sort((a,b)=>a.r-b.r||a.c-b.c);
          for (const {a} of entries) yield read(a);
        }:null;
        return new RangeValue(bounds,(r,c)=>read(address(r,c)),populated);
      }
      case 'unary': return number(run(ast.value)) * ({'-':-1,'+':1,'%':0.01}[ast.op]);
      case 'binary': return ops[ast.op](run(ast.left),run(ast.right));
      case 'call': {
        const entry = FunctionRegistry.get(ast.name.replace(/^(?:_xlfn\.|_xlws\.)+/i,''));
        if (!entry) fail('#¿NOMBRE?');
        return entry.fn(...ast.args.map(node => entry.lazy ? () => run(node) : run(node)));
      }
    }
  }
}

export function shiftFormula(raw, dr, dc) {
  if (!raw.startsWith('=')) return raw;
  try {
    const list = tokenize(raw.slice(1));
    let result = '', end = 0;
    const source = raw.slice(1);
    for (const [index,token] of list.entries()) {
      result += source.slice(end,token.at);
      end = token.at + token.text.length;
      const next = list[index+1]?.text;
      if (!refPattern.test(token.text) || next === '!' || next === '(') {
        result += token.text;
        continue;
      }
      const p = coordinates(token.text);
      const [,ac,ar] = /^(\$?)[A-Z]+(\$?)\d+$/i.exec(token.text);
      const r = (p?.r ?? -1) + (ar ? 0 : dr), c = (p?.c ?? -1) + (ac ? 0 : dc);
      const dest = p && r >= 0 && c >= 0 ? address(r,c) : '';
      result += coordinates(dest) ? dest.replace(/^([A-Z]+)(\d+)$/,(_,col,row)=>ac+col+ar+row) : '#REF!';
    }
    return '=' + result + source.slice(end);
  } catch { return raw; }
}

// OOXML stores English function names and uses commas as argument separators.
export function excelFormula(raw, aliases) {
  const source = raw.slice(1);
  try {
    let out = '', end = 0;
    const list = tokenize(source);
    for (const [i,{text,at}] of list.entries()) {
      out += source.slice(end,at);
      const upper = text.toUpperCase();
      const english=aliases.get(upper) ?? upper;
      const fn=['XLOOKUP','TEXTJOIN','STDEV.S','STDEV.P','IFNA','CONCAT'].includes(english)?'_xlfn.'+english:english;
      out += text === ';' ? ',' : list[i+1]?.text === '(' ? fn
        : /^(VERDADERO|FALSO)$/.test(upper) && list[i+1]?.text !== '!' ? (upper === 'FALSO' ? 'FALSE' : 'TRUE') : text;
      end = at + text.length;
    }
    return out + source.slice(end);
  } catch { return source; }
}
