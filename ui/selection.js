import {ROWS,COLS,box,address,points} from '../core/grid-model.js';
export const point = p => ({r:p.r,c:p.c});
export function selectedBox(a,b,kind) {
  const bounds=box(a,b);
  if (kind==='all') return {r0:0,c0:0,r1:ROWS-1,c1:COLS-1};
  if (kind==='row') return {...bounds,c0:0,c1:COLS-1};
  if (kind==='col') return {...bounds,r0:0,r1:ROWS-1};
  return bounds;
}
export const notation = b => {
  const start=address(b.r0,b.c0), end=address(b.r1,b.c1);
  return start===end?start:start+':'+end;
};
export const area = b => (b.r1-b.r0+1)*(b.c1-b.c0+1);
export function* addresses(ranges) {
  for (const range of ranges) for (const {r,c} of points(range)) yield address(r,c);
}
