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
  size(i) {return this.offset(i+1)-this.offset(i);}
  window(scroll, length, header, freeze) {
    const fixed=freeze?this.size(0):0;
    const result=[];
    for (let i=Math.max(Number(freeze),this.index(scroll+fixed)); i<this.count; i++) {
      const start=this.offset(i)-scroll+header;
      if (start >= length) break;
      const size=this.size(i);
      if (size) result.push({i,start,size});
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
  if (typeof value==='number'&&style.excelFormat) {
    try {return globalThis.XLSX?.SSF.format(style.excelFormat,value) ?? String(value);}
    catch {return String(value);}
  }
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
    this.hidden=new Set();
    this.dimensions();
    this.invalidate();
  }
  setHidden(hidden) {
    this.hidden=hidden;
    this.dimensions();
    this.invalidate();
  }
  frozen(axis) {
    const isRow=axis==='row';
    const available=isRow?this.scroll.clientHeight-HEADER_Y:this.scroll.clientWidth-HEADER_X;
    const size=(isRow?this.y:this.x).size(0);
    return this.sheet.freeze?.[axis] && size>0 && size+24<available ? size : 0;
  }
  dimensions() {
    const dimensions=axis=>{
      const stored=this.sheet[axis], g=this.gesture;
      if (g?.mode!=='resize' || g.axis!==axis || g.preview===undefined) return stored;
      return new Map(stored).set(g.index,g.preview);
    };
    this.x.set(dimensions('cols'));
    const rows=new Map(dimensions('rows'));
    for (const row of this.hidden) rows.set(row,0);
    this.y.set(rows);
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
  cellRect({r,c},freezeX=this.frozen('col'),freezeY=this.frozen('row')) {
    return {
      x:HEADER_X+this.x.offset(c)-(c===0&&freezeX?0:this.scroll.scrollLeft),
      y:HEADER_Y+this.y.offset(r)-(r===0&&freezeY?0:this.scroll.scrollTop),
      w:this.x.size(c),h:this.y.size(r)
    };
  }
  rect(point) {
    const merge=this.mergeAt(point.r,point.c);
    return merge?this.region(merge):this.cellRect(point);
  }
  mergeAt(r,c) {
    return this.sheet.merges?.find(b=>contains(b,r,c));
  }
  editorClip({r,c}) {
    const merge=this.mergeAt(r,c), fx=this.frozen('col'),fy=this.frozen('row');
    return {
      clipX:HEADER_X+(c===0||merge?.c0===0?0:fx),
      clipY:HEADER_Y+(r===0||merge?.r0===0?0:fy),
      clipRight:c===0&&fx&&!merge?HEADER_X+fx:this.scroll.clientWidth,
      clipBottom:r===0&&fy&&!merge?HEADER_Y+fy:this.scroll.clientHeight
    };
  }
  ensure(point) {
    const {x,y,w,h}=this.cellRect(point);
    const s=this.scroll,fx=this.frozen('col'),fy=this.frozen('row'),left=HEADER_X+fx,top=HEADER_Y+fy;
    if (point.c!==0||!fx) {
      if (x<left) s.scrollLeft+=x-left;
      else if (x+w>s.clientWidth) s.scrollLeft+=Math.min(x-left,x+w-s.clientWidth);
    }
    if (point.r!==0||!fy) {
      if (y<top) s.scrollTop+=y-top;
      else if (y+h>s.clientHeight) s.scrollTop+=Math.min(y-top,y+h-s.clientHeight);
    }
    this.invalidate();
  }
  region(bounds,freezeX=this.frozen('col'),freezeY=this.frozen('row')) {
    const first=this.cellRect({r:bounds.r0,c:bounds.c0},freezeX,freezeY);
    const last=this.cellRect({r:bounds.r1,c:bounds.c1},freezeX,freezeY);
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
    const fx=this.frozen('col'),fy=this.frozen('row');
    const cols=this.x.window(scroll.scrollLeft,width,HEADER_X,Boolean(fx));
    const rows=this.y.window(scroll.scrollTop,height,HEADER_Y,Boolean(fy));
    const xParts=[{items:cols,start:HEADER_X+fx,end:width,min:fx?1:0,max:COLS-1}];
    const yParts=[{items:rows,start:HEADER_Y+fy,end:height,min:fy?1:0,max:ROWS-1}];
    if (fx) xParts.push({items:[{i:0,start:HEADER_X,size:fx}],start:HEADER_X,end:HEADER_X+fx,min:0,max:0});
    if (fy) yParts.push({items:[{i:0,start:HEADER_Y,size:fy}],start:HEADER_Y,end:HEADER_Y+fy,min:0,max:0});
    const state=this.callbacks.state(),ranges=state.ranges;
    const additions=[...ranges,state.fill,state.reference].filter(Boolean);
    ctx.fillStyle=grid;ctx.fillRect(0,0,width,height);
    ctx.textBaseline='middle';
    const drawCell=(r,c,x,y,w,h)=>{
      if (w<=0||h<=0) return;
      const a=address(r,c),cell=this.sheet.cells.get(a),style=cell?.style ?? {};
      if (style.bg) {ctx.fillStyle=style.bg;ctx.fillRect(x,y,w,h);}
      if (ranges.some(b=>contains(b,r,c))&&(r!==state.active.r||c!==state.active.c)) {
        ctx.fillStyle=color('selection');ctx.fillRect(x,y,w,h);
      }
      if (!cell?.raw) return;
      if (this.callbacks.cached(a)) {
        ctx.fillStyle='#a86b12';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+7,y);ctx.lineTo(x,y+7);ctx.fill();
      }
      const value=this.callbacks.value(a), align=style.align ?? (typeof value==='number'?'right':'left');
      ctx.save();ctx.beginPath();ctx.rect(x+3,y+1,w-6,h-2);ctx.clip();
      ctx.fillStyle=style.fg||ink;
      const fontSize=style.size||14;
      ctx.font=(style.italic?'italic ':'')+(style.bold?'600 ':'')+fontSize+'px system-ui';
      ctx.textAlign=align;
      const text=display(value,style), tx=align==='right'?x+w-8:align==='center'?x+w/2:x+8;
      const ty=style.vertical==='top'?y+fontSize/2+2:style.vertical==='bottom'?y+h-fontSize/2-2:y+h/2;
      if (style.wrap) {
        const lines=[];
        const width=Math.max(1,w-16);
        for (const paragraph of text.split(/\r?\n/)) {
          let line='';
          for (const word of paragraph.split(/\s+/)) {
            const next=line?line+' '+word:word;
            if (line&&ctx.measureText(next).width>width) {lines.push(line);line=word;}
            else line=next;
          }
          lines.push(line);
        }
        const step=fontSize*1.17;
        const start=style.vertical==='top'?ty:style.vertical==='bottom'?ty-step*(lines.length-1):ty-step*(lines.length-1)/2;
        for (const [index,line] of lines.entries()) ctx.fillText(line,tx,start+index*step);
      } else ctx.fillText(text,tx,ty);
      if (!style.wrap&&(style.underline||style.strike)) {
        const tw=ctx.measureText(text).width,start=align==='right'?tx-tw:align==='center'?tx-tw/2:tx;
        ctx.fillRect(start,ty+(style.underline?fontSize*.38:0),tw,1);
      }
      ctx.restore();
    };
    const primary=ranges.at(-1);
    for (const xp of xParts) for (const yp of yParts) {
      if (!xp.items.length||!yp.items.length) continue;
      ctx.save();ctx.beginPath();ctx.rect(xp.start,yp.start,xp.end-xp.start,yp.end-yp.start);ctx.clip();
      const merges=(this.sheet.merges ?? []).filter(b=>b.r0<=yp.items.at(-1).i&&b.r1>=yp.items[0].i
        && b.c0<=xp.items.at(-1).i&&b.c1>=xp.items[0].i);
      for (const {i:r,start:y,size:h} of yp.items) for (const {i:c,start:x,size:w} of xp.items) {
        if (!merges.some(b=>contains(b,r,c))) drawCell(r,c,x,y,w,h);
      }
      ctx.beginPath();ctx.lineWidth=1;
      for (const {start,size} of xp.items) {const x=Math.round(start+size)-.5;ctx.moveTo(x,yp.start);ctx.lineTo(x,yp.end);}
      for (const {start,size} of yp.items) {const y=Math.round(start+size)-.5;ctx.moveTo(xp.start,y);ctx.lineTo(xp.end,y);}
      ctx.strokeStyle=line;ctx.stroke();
      for (const merge of merges) {
        const b={r0:Math.max(yp.min,merge.r0),r1:Math.min(yp.max,merge.r1),c0:Math.max(xp.min,merge.c0),c1:Math.min(xp.max,merge.c1)};
        const {x,y,w,h}=this.region(b,fx,fy);
        if (w<=0||h<=0) continue;
        ctx.fillStyle=grid;ctx.fillRect(x,y,w,h);
        if (b.r0===merge.r0&&b.c0===merge.c0) drawCell(b.r0,b.c0,x,y,w,h);
        ctx.strokeStyle=line;ctx.strokeRect(x-.5,y-.5,w,h);
      }
      for (const range of additions) {
        const b={r0:Math.max(yp.min,range.r0),r1:Math.min(yp.max,range.r1),c0:Math.max(xp.min,range.c0),c1:Math.min(xp.max,range.c1)};
        if (b.r0>b.r1||b.c0>b.c1) continue;
        const {x,y,w,h}=this.region(b,fx,fy);
        if (w<=0||h<=0) continue;
        ctx.strokeStyle=range===state.reference?'#a855f7':accent;ctx.lineWidth=2;
        ctx.setLineDash(range===state.fill||range===state.reference?[5,3]:[]);
        ctx.strokeRect(x+1,y+1,w-2,h-2);
      }
      ctx.setLineDash([]);
      if (primary.c1>=xp.min&&primary.c1<=xp.max&&primary.r1>=yp.min&&primary.r1<=yp.max) {
        const {x,y,w,h}=this.cellRect({r:primary.r1,c:primary.c1},fx,fy);
        ctx.fillStyle=accent;ctx.fillRect(x+w-5,y+h-5,8,8);
      }
      ctx.restore();
    }
    ctx.fillStyle=header;ctx.fillRect(0,0,width,HEADER_Y);ctx.fillRect(0,0,HEADER_X,height);
    ctx.font='12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    for (const [parts,isColumn] of [[xParts,true],[yParts,false]]) for (const part of parts) {
      ctx.save();ctx.beginPath();
      if (isColumn) ctx.rect(part.start,0,part.end-part.start,HEADER_Y);
      else ctx.rect(0,part.start,HEADER_X,part.end-part.start);
      ctx.clip();
      for (const {i,start,size} of part.items) {
        const selected=ranges.some(b=>isColumn?i>=b.c0&&i<=b.c1:i>=b.r0&&i<=b.r1);
        const x=isColumn?start:0,y=isColumn?0:start,w=isColumn?size:HEADER_X,h=isColumn?HEADER_Y:size;
        if (selected) {ctx.fillStyle=color('selection');ctx.fillRect(x,y,w,h);}
        ctx.fillStyle=selected?accent:color('muted');
        ctx.fillText(isColumn?column(i):String(i+1),x+w/2,y+h/2);
        ctx.strokeStyle=line;ctx.strokeRect(Math.round(x)-.5,Math.round(y)-.5,w,h);
      }
      ctx.restore();
    }
    ctx.fillStyle=accent;
    if (fx) ctx.fillRect(HEADER_X+fx-1,0,2,height);
    if (fy) ctx.fillRect(0,HEADER_Y+fy-1,width,2);
    ctx.fillStyle=color('muted');ctx.beginPath();ctx.moveTo(34,21);ctx.lineTo(43,12);ctx.lineTo(43,21);ctx.fill();
  }
  hit(e) {
    const rect=this.canvas.getBoundingClientRect(), x=e.clientX-rect.left, y=e.clientY-rect.top;
    const fx=this.frozen('col'),fy=this.frozen('row');
    const ax=x-HEADER_X+(fx&&x<HEADER_X+fx?0:this.scroll.scrollLeft);
    const ay=y-HEADER_Y+(fy&&y<HEADER_Y+fy?0:this.scroll.scrollTop);
    const c=this.x.index(ax),r=this.y.index(ay), tolerance=e.pointerType==='touch'?10:5;
    const merge=x>=HEADER_X&&y>=HEADER_Y?this.mergeAt(r,c):null;
    const boundary=(axis,index,pixel)=>{
      if (index>0 && axis.size(index-1)>0 && Math.abs(pixel-axis.offset(index))<=tolerance) return index-1;
      return Math.abs(pixel-axis.offset(index+1))<=tolerance ? index : -1;
    };
    const resize=x>=HEADER_X && y<HEADER_Y ? ['cols',boundary(this.x,c,ax)]
      : y>=HEADER_Y && x<HEADER_X ? ['rows',boundary(this.y,r,ay)] : null;
    const end=this.callbacks.state().ranges.at(-1);
    const b=this.cellRect({r:end.r1,c:end.c1});
    return {x,y,r:merge?.r0 ?? r,c:merge?.c0 ?? c,merge,resize,header:x<HEADER_X || y<HEADER_Y,
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
