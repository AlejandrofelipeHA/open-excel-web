const colors=['#137653','#3069ba','#ad4572','#a86b12','#6850a5','#00848c','#bf4c2c','#617331'];
const NS='http://www.w3.org/2000/svg';
function element(name,attributes={},text) {
  const result=document.createElementNS(NS,name);
  for (const [key,value] of Object.entries(attributes)) result.setAttribute(key,value);
  if (text!==undefined) result.textContent=text;
  return result;
}
const format=new Intl.NumberFormat('es',{maximumFractionDigits:2,notation:'compact'});
function scatter(svg,series,axes) {
  const left=72,top=14,width=659,height=264;
  const points=series.map(s=>s.values.flatMap((y,i)=>{
    const x=s.x?.[i];
    return Number.isFinite(x)&&Number.isFinite(y)?[{x,y}]:[];
  }));
  const all=points.flat();
  if (!all.length) return false;
  function extent(key) {
    const values=all.map(p=>p[key]), lo=Math.min(...values),hi=Math.max(...values);
    const pad=(hi-lo||Math.abs(lo)||1)*.06;
    return [lo-pad,hi+pad];
  }
  const [x0,x1]=extent('x'),[y0,y1]=extent('y');
  const px=x=>left+(x-x0)/(x1-x0)*width;
  const py=y=>top+(y1-y)/(y1-y0)*height;
  for (let i=0;i<=5;i++) {
    const x=x0+(x1-x0)*i/5,y=y0+(y1-y0)*i/5;
    svg.append(element('line',{x1:px(x),x2:px(x),y1:top,y2:top+height,class:'chart-grid'}),
      element('line',{x1:left,x2:left+width,y1:py(y),y2:py(y),class:'chart-grid'}),
      element('text',{x:px(x),y:top+height+18,'text-anchor':'middle'},format.format(x)),
      element('text',{x:left-8,y:py(y)+4,'text-anchor':'end'},format.format(y)));
  }
  if (axes?.[0]) svg.append(element('text',{x:left+width/2,y:323,'text-anchor':'middle'},axes[0]));
  if (axes?.[1]) svg.append(element('text',{transform:'translate(18 '+(top+height/2)+') rotate(-90)','text-anchor':'middle'},axes[1]));
  points.forEach((items,i)=>{
    const fill=colors[i%colors.length], name=series[i].name;
    const kind=series[i].trend;
    if (items.length>=2&&['linear','power','log','exp'].includes(kind)) {
      const xf=x=>kind==='power'||kind==='log'?Math.log(x):x;
      const yf=y=>kind==='power'||kind==='exp'?Math.log(y):y;
      const transformed=items.map(p=>[xf(p.x),yf(p.y)]).filter(p=>p.every(Number.isFinite));
      if (transformed.length>=2) {
        const n=transformed.length, mx=transformed.reduce((v,p)=>v+p[0],0)/n,my=transformed.reduce((v,p)=>v+p[1],0)/n;
        const spread=transformed.reduce((v,p)=>v+(p[0]-mx)**2,0);
        if (spread) {
          const slope=transformed.reduce((v,p)=>v+(p[0]-mx)*(p[1]-my),0)/spread;
          const lo=Math.min(...items.map(p=>p.x)), hi=Math.max(...items.map(p=>p.x));
          const path=Array.from({length:41},(_,j)=>{
            const x=lo+(hi-lo)*j/40, value= my+slope*(xf(x)-mx);
            const y=kind==='power'||kind==='exp'?Math.exp(value):value;
            return Number.isFinite(y)?[px(x),py(y)]:null;
          }).filter(Boolean).map(p=>p.join(',')).join(' ');
          if (path) svg.append(element('polyline',{points:path,fill:'none',stroke:fill,'stroke-width':1.5,'stroke-dasharray':'4 3'}));
        }
      }
    }
    if (series[i].connect&&items.length>1) svg.append(element('polyline',{
      points:items.map(p=>[px(p.x),py(p.y)].join(',')).join(' '),
      fill:'none',stroke:fill,'stroke-width':2
    }));
    for (const {x,y} of items) {
      const dot=element('circle',{cx:px(x),cy:py(y),r:4,fill});
      dot.append(element('title',{},name+' · X '+format.format(x)+' · Y '+format.format(y)));
      svg.append(dot);
      if (series[i].labels) svg.append(element('text',{x:px(x),y:py(y)-8,'text-anchor':'middle'},format.format(y)));
    }
  });
  return true;
}
export function renderChart(host,{labels,series},kind,title,axes) {
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
  if (kind==='scatter') {
    if (!scatter(svg,series,axes)) {host.textContent='La dispersión necesita pares numéricos X e Y.';return;}
  } else if (kind==='pie') {
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
