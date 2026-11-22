const colors=['#137653','#3069ba','#ad4572','#a86b12','#6850a5','#00848c','#bf4c2c','#617331'];
const NS='http://www.w3.org/2000/svg';
function element(name,attributes={},text) {
  const result=document.createElementNS(NS,name);
  for (const [key,value] of Object.entries(attributes)) result.setAttribute(key,value);
  if (text!==undefined) result.textContent=text;
  return result;
}
const format=new Intl.NumberFormat('es',{maximumFractionDigits:2,notation:'compact'});
export function renderChart(host,{labels,series},kind,title) {
  host.replaceChildren();
  const values=series.flatMap(s=>s.values).filter(v=>v!==null);
  if (!values.length) {
    host.textContent='El rango seleccionado necesita al menos un valor numérico debajo del encabezado.';
    return;
  }
  const width=760,height=345,x=65,y=20,w=670,h=275;
  const min=values.reduce((a,b)=>Math.min(a,b),0), max=values.reduce((a,b)=>Math.max(a,b),0);
  const span=max-min||1, toY=v=>y+(max-v)*h/span;
  const svg=element('svg',{viewBox:'0 0 '+width+' '+height,role:'img','aria-label':title});
  svg.append(element('title',{},title));
  const group=w/labels.length;
  if (kind==='pie') {
    const first=series[0], total=first.values.reduce((a,b)=>a+Math.max(0,b??0),0);
    if (!total) {host.textContent='La primera serie necesita valores positivos para una gráfica circular.';return;}
    let angle=-Math.PI/2;
    const cx=width/2,cy=height/2,r=130;
    first.values.forEach((value,i)=>{
      if (!(value>0)) return;
      const end=angle+Math.PI*2*value/total;
      const fill=colors[i%colors.length];
      const path=value===total?element('circle',{cx,cy,r,fill}):element('path',{
        fill,d:'M '+cx+' '+cy+' L '+(cx+r*Math.cos(angle))+' '+(cy+r*Math.sin(angle))+
          ' A '+r+' '+r+' 0 '+Number(end-angle>Math.PI)+' 1 '+(cx+r*Math.cos(end))+' '+(cy+r*Math.sin(end))+' Z'
      });
      path.append(element('title',{},labels[i]+' · '+format.format(value)));
      svg.append(path);angle=end;
    });
  } else {
    for (let i=0;i<=5;i++) {
      const value=min+span*i/5, py=toY(value);
      svg.append(element('line',{x1:x,x2:x+w,y1:py,y2:py,class:'chart-grid'}),
        element('text',{x:x-9,y:py+4,'text-anchor':'end'},format.format(value)));
    }
    for (let i=0;i<labels.length;i+=Math.max(1,Math.ceil(labels.length/10))) {
      svg.append(element('text',{x:x+(i+.5)*group,y:y+h+20,'text-anchor':'middle'},
        labels[i].length>12?labels[i].slice(0,11)+'…':labels[i]));
    }
    series.forEach(({name,values},index)=>{
      const fill=colors[index%colors.length];
      let path='', prior=false;
      values.forEach((value,i)=>{
        if (value===null) {prior=false;return;}
        const px=x+(i+.5)*group, py=toY(value);
        let mark;
        if (kind==='line') {
          path+=(prior?' L ':' M ')+px+' '+py;prior=true;
          mark=element('circle',{cx:px,cy:py,r:labels.length>100?2:4,fill});
        } else {
          const bar=group*.78/series.length, baseline=toY(0);
          mark=element('rect',{x:px-group*.39+index*bar,y:Math.min(py,baseline),
            width:Math.max(.2,bar*.9),height:Math.max(1,Math.abs(py-baseline)),fill});
        }
        mark.append(element('title',{},labels[i]+' · '+name+' · '+format.format(value)));
        svg.append(mark);
      });
      if (path) svg.prepend(element('path',{d:path,stroke:fill,fill:'none','stroke-width':2}));
    });
  }
  const legend=document.createElement('ul');
  legend.className='chart-legend';
  const names=kind==='pie'?labels:series.map(s=>s.name);
  names.forEach((name,i)=>{
    const item=document.createElement('li'),swatch=document.createElement('span');
    swatch.style.background=colors[i%colors.length];
    item.append(swatch,document.createTextNode(name));
    legend.append(item);
  });
  host.append(svg,legend);
}
