import {FunctionRegistry} from '../core/function-registry.js';

export class EditorOverlay {
  constructor({root,fx,menu,grid,layout,save,move}) {
    this.input=root.querySelector('input');
    Object.assign(this,{fx,menu,grid,layout,save,move});
    for (const field of [this.input,fx]) {
      field.addEventListener('focus',()=>{if(field===fx && !this.field) this.field=fx;});
      field.addEventListener('input',()=>this.copy(field,this.read(field)));
      field.addEventListener('keydown',e=>this.key(e));
      field.addEventListener('blur',()=>{
        if (this.field===field && !this.hold) this.finish(true,false);
      });
    }
    for (const field of [fx]) field.addEventListener('paste',e=>{
      e.preventDefault();
      document.execCommand('insertText',false,e.clipboardData.getData('text/plain').replace(/[\r\n]+/g,' '));
    });
    menu.addEventListener('pointerdown',e=>e.preventDefault());
    menu.addEventListener('click',e=>{
      const button=e.target.closest('button');
      if (button) this.accept(button.textContent);
    });
  }
  read(field=this.field) { return field===this.input ? field.value : field?.textContent ?? ''; }
  write(field,value) {
    if (field===this.input) field.value=value;
    else field.textContent=value;
  }
  show(raw) {
    if (!this.field) {
      this.original=raw;
      this.write(this.fx,raw);
    }
  }
  open(raw,initial=raw) {
    this.original=raw;
    this.field=this.input;
    this.input.hidden=false;
    this.position();
    this.copy(this.input,initial);
    this.input.focus({preventScroll:true});
    this.caret(initial.length);
  }
  position() {
    if (this.input.hidden) return;
    const {x,y,w,h,clipX,clipY,clipRight,clipBottom}=this.layout();
    const left=Math.max(x,clipX), top=Math.max(y,clipY);
    const width=Math.max(0,Math.min(x+w,clipRight)-left), height=Math.max(0,Math.min(y+h,clipBottom)-top);
    Object.assign(this.input.style,{left:left+'px',top:top+'px',width:width+'px',height:height+'px',
      visibility:width>0&&height>0?'visible':'hidden'});
  }
  copy(field,value) {
    this.write(field===this.input?this.fx:this.input,value);
    this.suggestions(value);
  }
  caret(index) {
    if (this.field===this.input) { this.input.setSelectionRange(index,index); return; }
    const text=this.fx.firstChild ?? this.fx.appendChild(document.createTextNode(''));
    const range=document.createRange();
    range.setStart(text,Math.min(index,text.length));range.collapse(true);
    window.getSelection().removeAllRanges();window.getSelection().addRange(range);
  }
  selection() {
    if (this.field===this.input) return [this.input.selectionStart,this.input.selectionEnd];
    const selection=window.getSelection(), range=selection?.rangeCount?selection.getRangeAt(0):null;
    return range && this.fx.contains(range.commonAncestorContainer) && range.startContainer.nodeType===3
      ? [range.startOffset,range.endOffset] : [this.read().length,this.read().length];
  }
  get referencing() { return Boolean(this.field && this.read().startsWith('=')); }
  reference(text) {
    this.hold=true;
    this.refBase ??= {value:this.read(),selection:this.selection()};
    const {value,selection:[start,end]}=this.refBase;
    const result=value.slice(0,start)+text+value.slice(end);
    this.write(this.field,result);this.copy(this.field,result);this.caret(start+text.length);
  }
  endReference(cancel) {
    if (cancel && this.refBase) {
      this.write(this.field,this.refBase.value);
      this.copy(this.field,this.refBase.value);
      this.caret(this.refBase.selection[0]);
    }
    this.refBase=null;this.hold=false;
  }
  suggestions(value) {
    const match=/[=(,;+\-*/]\s*([\p{L}_][\p{L}\p{N}_.]*)$/u.exec(value.startsWith("=") ? value : "");
    this.matches=match ? FunctionRegistry.names().filter(name=>name.startsWith(match[1].toUpperCase())).slice(0,7) : [];
    this.menu.replaceChildren(...this.matches.map(name=>{
      const button=document.createElement('button');button.type='button';button.textContent=name;return button;
    }));
    this.menu.hidden=!this.matches.length;
  }
  accept(name) {
    const value=this.read().replace(/[\p{L}_][\p{L}\p{N}_.]*$/u,name+'(');
    this.write(this.field,value);this.copy(this.field,value);this.caret(value.length);
  }
  key(e) {
    if (e.isComposing || e.keyCode===229) return;
    if (e.key==='Escape') { e.preventDefault(); this.finish(false); }
    if (e.key==='Enter' || e.key==='Tab') {
      e.preventDefault();
      if (e.key==='Tab' && !e.shiftKey && this.matches?.length) {this.accept(this.matches[0]);return;}
      this.finish(true);
      const delta=e.shiftKey?-1:1;
      this.move(e.key==='Enter'?delta:0,e.key==='Tab'?delta:0);
    }
  }
  finish(commit,focus=true) {
    if (!this.field) return;
    const value=this.read().replace(/[\r\n]+/g,' ');
    this.field=null;this.hold=false;this.refBase=null;this.matches=[];this.menu.hidden=true;
    this.input.hidden=true;
    this.write(this.fx,commit?value:this.original);
    if (commit && value!==this.original) this.save(value);
    if (focus) this.grid.focus({preventScroll:true});
  }
}
