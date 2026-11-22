export const ROWS = 12000, COLS = 1024;
export function column(index) {
  let name = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + (n - 1) % 26) + name;
  }
  return name;
}
export const address = (r, c) => column(c) + (r + 1);
export function coordinates(a) {
  const match = /^\$?([A-Z]+)\$?([1-9]\d*)$/i.exec(a);
  if (!match) return null;
  const c = [...match[1].toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const r = Number(match[2]) - 1;
  return r < ROWS && c < COLS ? {r, c} : null;
}
export function box(a, b = a) {
  return {r0:Math.min(a.r,b.r), r1:Math.max(a.r,b.r), c0:Math.min(a.c,b.c), c1:Math.max(a.c,b.c)};
}
export const contains = (b, r, c) => r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1;
export function* points(b) {
  for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) yield {r,c};
}
export const nodeKey = (sheet, a) => sheet + '\u0000' + a;
export const splitKey = key => key.split('\u0000');
export const newSheet = (name, id = crypto.randomUUID()) => ({id,name,cells:new Map(), rows:new Map(), cols:new Map()});
export class Workbook {
  constructor(data) {
    this.sheets = data?.sheets?.length ? data.sheets.map(s => ({
      ...s, cells:new Map(s.cells), rows:new Map(s.rows), cols:new Map(s.cols)
    })) : [newSheet('Hoja 1','sheet-1'),newSheet('Hoja 2','sheet-2')];
    this.active = this.get(data?.active)?.id ?? this.sheets[0].id;
  }
  get(id) { return this.sheets.find(s => s.id === id); }
  byName(name) { return this.sheets.find(s => s.name.toUpperCase() === name.toUpperCase()); }
  set(id, a, cell) {
    const {cells} = this.get(id);
    if (cell && (cell.raw !== '' || Object.keys(cell.style ?? {}).length)) cells.set(a, cell);
    else cells.delete(a);
  }
  serialize() {
    return {active:this.active, sheets:this.sheets.map(s => ({
      ...s, cells:[...s.cells], rows:[...s.rows], cols:[...s.cols]
    }))};
  }
}
