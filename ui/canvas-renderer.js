import {ROWS,COLS,address,column,box,contains} from '../core/grid-model.js';

const HEADER_X = 50, HEADER_Y = 30;
export const BASE = {cols:110,rows:28};
export const clamp = (n,min,max) => Math.max(min,Math.min(max,n));

class Axis {
  constructor(count, base) { this.count=count; this.base=base; }
  set(overrides) {
    this.keys = [...overrides.keys()].sort((a,b)=>a-b);
    this.delta = [0];
    for (const key of this.keys) this.delta.push(this.delta.at(-1) + overrides.get(key) - this.base);
  }
  offset(i) {
    let lo=0, hi=this.keys.length;
    while (lo < hi) {
      const mid=(lo+hi)>>1;
      if (this.keys[mid] < i) lo=mid+1;
      else hi=mid;
    }
    return i*this.base+this.delta[lo];
  }
  index(pixel) {
    let lo=0, hi=this.count;
    while (lo+1 < hi) {
      const mid=(lo+hi)>>1;
      if (this.offset(mid) <= pixel) lo=mid;
      else hi=mid;
    }
    return lo;
  }
  window(scroll, length, header) {
    const result=[];
    for (let i=this.index(scroll); i<this.count; i++) {
      const start=this.offset(i)-scroll+header;
      if (start >= length) break;
      result.push({i,start,size:this.offset(i+1)-this.offset(i)});
    }
    return result;
  }
}

const dateFormat = new Intl.DateTimeFormat('es',{timeZone:'UTC'});
const numberFormats = {
  currency:new Intl.NumberFormat('es',{style:'currency',currency:'USD'}),
  percent:new Intl.NumberFormat('es',{style:'percent',maximumFractionDigits:2}),
  decimal:new Intl.NumberFormat('es',{minimumFractionDigits:2,maximumFractionDigits:2})
};

export function display(value, style={}) {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'VERDADERO' : 'FALSO';
  if (typeof value !== 'number' || !style.format) return String(value);
  if (style.format === 'date') {
    const date = new Date((value-25569)*86400000);
    return Number.isNaN(date.getTime()) ? String(value) : dateFormat.format(date);
  }
  return numberFormats[style.format]?.format(value) ?? String(value);
}

export class CanvasRenderer {
  constructor(root, callbacks) {
    this.root=root;
    this.scroll=root.querySelector('.scroll');
    this.space=root.querySelector('.space');
    this.canvas=root.querySelector('canvas');
    this.ctx=this.canvas.getContext('2d');
    this.callbacks=callbacks;
    this.x=new Axis(COLS,BASE.cols);
    this.y=new Axis(ROWS,BASE.rows);
    this.scroll.addEventListener('scroll',()=>this.invalidate(),{passive:true});
    new ResizeObserver(()=>this.invalidate()).observe(root);
    window.addEventListener('resize',()=>this.invalidate());
    this.canvas.addEventListener('wheel',e=>{
      if (e.ctrlKey) return;
      e.preventDefault();
      const factor=e.deltaMode===1?28:e.deltaMode===2?this.scroll.clientHeight:1;
      this.scroll.scrollBy((e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX)*factor,e.shiftKey?0:e.deltaY*factor);
    },{passive:false});
    for (const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture']) {
      this.canvas.addEventListener(type,e=>this.pointer(e));
    }
  }
  setSheet(sheet) {
    this.sheet=sheet;
    this.dimensions();
    this.invalidate();
  }
  dimensions() {
    const dimensions=axis=>{
      const stored=this.sheet[axis], g=this.gesture;
      if (g?.mode!=='resize' || g.axis!==axis || g.preview===undefined) return stored;
      return new Map(stored).set(g.index,g.preview);
    };
    this.x.set(dimensions('cols'));
    this.y.set(dimensions('rows'));
    this.space.style.width=(HEADER_X+this.x.offset(COLS))+'px';
    this.space.style.height=(HEADER_Y+this.y.offset(ROWS))+'px';
  }
  invalidate() {
    if (this.frame) return;
    this.frame=requestAnimationFrame(()=>{
      this.frame=0;
      this.draw();
      this.callbacks.layout();
    });
  }
  rect({r,c}) {
    return {
      x:HEADER_X+this.x.offset(c)-this.scroll.scrollLeft,
      y:HEADER_Y+this.y.offset(r)-this.scroll.scrollTop,
      w:this.x.offset(c+1)-this.x.offset(c),h:this.y.offset(r+1)-this.y.offset(r)
    };
  }
  ensure(point) {
    const {x,y,w,h}=this.rect(point);
    const s=this.scroll;
    if (x<HEADER_X) s.scrollLeft+=x-HEADER_X;
    else if (x+w>s.clientWidth) s.scrollLeft+=Math.min(x-HEADER_X,x+w-s.clientWidth);
    if (y<HEADER_Y) s.scrollTop+=y-HEADER_Y;
    else if (y+h>s.clientHeight) s.scrollTop+=Math.min(y-HEADER_Y,y+h-s.clientHeight);
    this.invalidate();
  }
  region(bounds) {
    const first=this.rect({r:bounds.r0,c:bounds.c0});
    const last=this.rect({r:bounds.r1,c:bounds.c1});
    return {x:first.x,y:first.y,w:last.x+last.w-first.x,h:last.y+last.h-first.y};
  }
  draw() {
    const {canvas,ctx,scroll}=this, width=scroll.clientWidth, height=scroll.clientHeight;
    if (!width || !height || !this.sheet) return;
    const dpr=window.devicePixelRatio || 1;
    const dw=Math.round(width*dpr),dh=Math.round(height*dpr);
    if (canvas.width!==dw || canvas.height!==dh || canvas.style.width!==width+'px' || canvas.style.height!==height+'px') {
      canvas.width=dw; canvas.height=dh;
      canvas.style.width=width+'px'; canvas.style.height=height+'px';
    }
    ctx.setTransform(dw/width,0,0,dh/height,0,0);
    const css=getComputedStyle(this.root), color=key=>css.getPropertyValue('--'+key).trim();
    const grid=color('paper'), ink=color('ink'), line=color('line'), header=color('header'), accent=color('accent');
    const cols=this.x.window(scroll.scrollLeft,width,HEADER_X), rows=this.y.window(scroll.scrollTop,height,HEADER_Y);
    const state=this.callbacks.state(), ranges=state.ranges;
    ctx.fillStyle=grid; ctx.fillRect(0,0,width,height);
    ctx.save(); ctx.beginPath(); ctx.rect(HEADER_X,HEADER_Y,width-HEADER_X,height-HEADER_Y); ctx.clip();
    ctx.textBaseline='middle';
    for (const {i:r,start:y,size:h} of rows) for (const {i:c,start:x,size:w} of cols) {
      const a=address(r,c), cell=this.sheet.cells.get(a), style=cell?.style ?? {};
      if (style.bg) { ctx.fillStyle=style.bg; ctx.fillRect(x,y,w,h); }
      if (ranges.some(range=>contains(range,r,c)) && (r!==state.active.r || c!==state.active.c)) {
        ctx.fillStyle=color('selection'); ctx.fillRect(x,y,w,h);
      }
      if (!cell?.raw) continue;
      const value=this.callbacks.value(a);
      const align=style.align ?? (typeof value==='number'?'right':'left');
      ctx.save(); ctx.beginPath(); ctx.rect(x+3,y+1,w-6,h-2); ctx.clip();
      ctx.fillStyle=style.fg || ink;
      ctx.font=(style.italic?'italic ':'')+(style.bold?'600 ':'')+'14px system-ui';
      ctx.textAlign=align;
      ctx.fillText(display(value,style),align==='right'?x+w-8:align==='center'?x+w/2:x+8,y+h/2);
      ctx.restore();
    }
    ctx.beginPath();
    for (const {start,size} of cols) { const x=Math.round(start+size)-.5;ctx.moveTo(x,HEADER_Y);ctx.lineTo(x,height); }
    for (const {start,size} of rows) { const y=Math.round(start+size)-.5;ctx.moveTo(HEADER_X,y);ctx.lineTo(width,y); }
    ctx.strokeStyle=line; ctx.stroke();
    for (const range of [...ranges,state.fill,state.reference].filter(Boolean)) {
      const {x,y,w,h}=this.region(range);
      ctx.strokeStyle=range===state.reference?'#a855f7':accent;ctx.lineWidth=2;
      ctx.setLineDash(range===state.fill || range===state.reference?[5,3]:[]);
      ctx.strokeRect(x+1,y+1,w-2,h-2);
    }
    ctx.setLineDash([]);
    const primary=this.region(ranges.at(-1));
    ctx.fillStyle=accent;
    ctx.fillRect(primary.x+primary.w-5,primary.y+primary.h-5,8,8);
    ctx.restore();

    ctx.fillStyle=header; ctx.fillRect(0,0,width,HEADER_Y);ctx.fillRect(0,0,HEADER_X,height);
    ctx.font='12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    for (const [items,isColumn] of [[cols,true],[rows,false]]) {
      ctx.save();ctx.beginPath();
      if (isColumn) ctx.rect(HEADER_X,0,width-HEADER_X,HEADER_Y);
      else ctx.rect(0,HEADER_Y,HEADER_X,height-HEADER_Y);
      ctx.clip();
      for (const {i,start,size} of items) {
        const selected=ranges.some(b=>isColumn?i>=b.c0&&i<=b.c1:i>=b.r0&&i<=b.r1);
        const x=isColumn?start:0,y=isColumn?0:start,w=isColumn?size:HEADER_X,h=isColumn?HEADER_Y:size;
        if (selected) {ctx.fillStyle=color('selection');ctx.fillRect(x,y,w,h);}
        ctx.fillStyle=selected?accent:color('muted');
        ctx.fillText(isColumn?column(i):String(i+1),x+w/2,y+h/2);
        ctx.strokeStyle=line;ctx.strokeRect(Math.round(x)-.5,Math.round(y)-.5,w,h);
      }
      ctx.restore();
    }
    ctx.fillStyle=color('muted');ctx.beginPath();ctx.moveTo(34,21);ctx.lineTo(43,12);ctx.lineTo(43,21);ctx.fill();
  }
  hit(e) {
    const rect=this.canvas.getBoundingClientRect(), x=e.clientX-rect.left, y=e.clientY-rect.top;
    const ax=x-HEADER_X+this.scroll.scrollLeft, ay=y-HEADER_Y+this.scroll.scrollTop;
    const c=this.x.index(ax),r=this.y.index(ay), tolerance=e.pointerType==='touch'?10:5;
    const boundary=(axis,index,pixel)=>{
      if (index>0 && Math.abs(pixel-axis.offset(index))<=tolerance) return index-1;
      return Math.abs(pixel-axis.offset(index+1))<=tolerance ? index : -1;
    };
    const resize=x>=HEADER_X && y<HEADER_Y ? ['cols',boundary(this.x,c,ax)]
      : y>=HEADER_Y && x<HEADER_X ? ['rows',boundary(this.y,r,ay)] : null;
    const b=this.region(this.callbacks.state().ranges.at(-1));
    return {x,y,r,c,resize,header:x<HEADER_X || y<HEADER_Y,
      kind:x<HEADER_X?(y<HEADER_Y?'all':'row'):y<HEADER_Y?'col':'cell',
      handle:x>=HEADER_X && y>=HEADER_Y && Math.abs(x-b.x-b.w)<=tolerance && Math.abs(y-b.y-b.h)<=tolerance};
  }
  pointer(e) {
    const p=this.hit(e), cb=this.callbacks;
    if (e.type==='pointerdown') {
      if (this.gesture || e.button!==0) return;
      const referencing=cb.referencing() && !p.header;
      if (!referencing) cb.beforePointer();
      e.preventDefault();
      if (!referencing) this.canvas.focus({preventScroll:true});
      this.canvas.setPointerCapture(e.pointerId);
      const g=this.gesture={id:e.pointerId,p,touch:e.pointerType==='touch',x:this.scroll.scrollLeft,y:this.scroll.scrollTop};
      const now=performance.now(), last=this.last;
      const double=!p.header && !p.handle && last && last.r===p.r && last.c===p.c
        && last.touch===g.touch && now-last.time<(g.touch?380:450);
      if (referencing) { g.mode='reference'; cb.reference(p,p,false); }
      else if (p.resize?.[1]>=0) {
        g.mode='resize'; [g.axis,g.index]=p.resize;
        g.size=this.sheet[g.axis].get(g.index) ?? BASE[g.axis];
      } else if (p.handle) g.mode='fill';
      else if (double) {
        this.last=null;
        g.mode='edit';
        cb.edit(p);
      } else if (g.touch && !p.header && !cb.touchRange()) g.mode='tap';
      else {
        g.mode='select';
        cb.select(p,e.shiftKey,e.ctrlKey || e.metaKey);
      }
      return;
    }
    const g=this.gesture;
    if (!g || g.id!==e.pointerId) {
      if (e.type==='pointermove') this.canvas.style.cursor=p.resize?.[1]>=0
        ? (p.resize[0]==='cols'?'col-resize':'row-resize') : p.handle?'crosshair':'cell';
      return;
    }
    const dx=p.x-g.p.x,dy=p.y-g.p.y;
    if (e.type==='pointermove') {
      if (Math.hypot(dx,dy)>7) g.moved=true;
      if (g.mode==='tap' && g.moved) {g.mode='pan';this.last=null;}
      if (g.mode==='pan') this.scroll.scrollTo(g.x-dx,g.y-dy);
      if (g.mode==='resize') {
        g.preview=clamp(Math.round(g.size+(g.axis==='cols'?dx:dy)),g.axis==='cols'?32:20,600);
        this.dimensions();this.invalidate();
      }
      if (g.mode==='reference') cb.reference(g.p,p,false);
      if (g.mode==='select' && g.moved) cb.extend(p,g.p.kind);
      if (g.mode==='fill') cb.fill(p,false);
      return;
    }
    this.gesture=null;
    const done=e.type==='pointerup';
    if (g.mode==='resize' && g.preview!==undefined) {
      if (done && g.preview!==g.size) cb.resize(g.axis,g.index,g.preview,g.size);
      this.dimensions();this.invalidate();
    }
    if (g.mode==='reference') cb.reference(g.p,p,true,done);
    if (g.mode==='fill') cb.fill(p,true,done && g.moved);
    if (done && g.mode==='tap') cb.select(p,false,false);
    if (done && !g.moved && !p.header && ['tap','select'].includes(g.mode)) {
      this.last={r:p.r,c:p.c,touch:g.touch,time:performance.now()};
    }
  }
}
