import {address,column} from '../core/grid-model.js';
import {chartData,dataRegion,findCells,sortCells} from '../core/data-tools.js';
import {notation,area} from './selection.js';
import {renderChart} from './chart-view.js';

export function setupWorkbookTools(api) {
  const $=id=>document.getElementById(id);
  const dialog=$('workbook-tools'), form=$('tools-form'), message=$('tools-message');
  const panels=[...dialog.querySelectorAll('[data-panel]')];
  const columns=$('tools-column'), query=$('tools-query');
  const titles={filter:'Filtrar filas',sort:'Ordenar rango',find:'Buscar y reemplazar',chart:'Gráficas',view:'Vista de la hoja'};
  let mode,range,cursor=-1;
  const value=a=>api.value(a);
  const rules=()=>{
    const filter=api.sheet().filter;
    return filter && notation(filter.range)===notation(range)?filter.rules ?? [filter]:[];
  };
  function showRule() {
    const entries=rules(), rule=entries.find(item=>item.column===Number(columns.value));
    query.value=rule?.query ?? '';
    $('tools-condition').value=rule?.mode ?? 'contains';
    $('tools-remove-rule').hidden=!rule;
    message.textContent=entries.length?'Filtros activos · '+entries.map(item=>column(item.column)).join(', '):'';
  }
  function open(type) {
    api.finish();
    mode=type;cursor=-1;
    const sheet=api.sheet(),selected=api.range();
    range=area(selected)>1?selected:type==='filter'&&(sheet.filter?.range||sheet.filterRange)||dataRegion(sheet,api.active());
    panels.forEach(panel=>{panel.hidden=!panel.dataset.panel.split(' ').includes(type);});
    $('tools-title').textContent=titles[type];
    $('tools-range').textContent=type==='find'||type==='view'?sheet.name:'Rango '+notation(range);
    message.textContent='';
    $('tools-apply').hidden=['find','chart','view'].includes(type);
    $('tools-apply').textContent=type==='sort'?'Ordenar':'Aplicar filtro';
    $('tools-clear-filter').hidden=type!=='filter'||!sheet.filter;
    if (type==='filter'||type==='sort') {
      const activeCol=api.active().c;
      const opts=[];
      for (let c=range.c0;c<=range.c1;c++) {
        const label=String(value(address(range.r0,c)) ?? '').trim();
        opts.push(new Option(column(c)+(label?' · '+label:''),String(c)));
      }
      columns.replaceChildren(...opts);
      columns.value=String(Math.max(range.c0,Math.min(range.c1,type==='filter'&&rules().length?rules()[0].column:activeCol)));
      if (type==='filter') showRule();
    }
    if (type==='chart') {
      $('tools-chart-title').value='Datos de '+sheet.name;
      const picker=$('tools-chart-source');
      picker.replaceChildren(new Option('Selección actual',''),...(sheet.charts ?? []).map((chart,i)=>new Option(chart.title,String(i))));
      if (picker.options.length>1) picker.selectedIndex=1;
      showChart();
    }
    if (type==='view') {
      $('freeze-row').checked=Boolean(sheet.freeze?.row);
      $('freeze-col').checked=Boolean(sheet.freeze?.col);
      $('show-hidden').checked=Boolean(sheet.revealSourceRows);
      $('show-hidden').parentElement.hidden=!sheet.sourceHidden?.length;
    }
    dialog.showModal();
    if (type==='find') $('tools-find').focus();
  }
  for (const button of document.querySelectorAll('[data-tool]')) button.onclick=()=>open(button.dataset.tool);
  $('tools-close').onclick=()=>dialog.close();
  columns.onchange=()=>{if(mode==='filter') showRule();};
  $('tools-remove-rule').onclick=()=>{
    const remaining=rules().filter(item=>item.column!==Number(columns.value));
    api.change('filter',remaining.length?{range,rules:remaining}:null);
    dialog.close();
  };
  $('tools-clear-filter').onclick=()=>{api.change('filter',null);dialog.close();};
  dialog.addEventListener('close',()=>api.focus());
  form.onsubmit=e=>{
    e.preventDefault();
    if (mode==='find') {search(false);return;}
    if (mode==='chart'||mode==='view') return;
    const c=Number(columns.value);
    if (mode==='filter') {
      if (range.r1<=range.r0) {message.textContent='Selecciona un encabezado y al menos una fila de datos.';return;}
      const condition=$('tools-condition').value;
      if (['gt','gte','lt','lte'].includes(condition) && (!query.value.trim() || !Number.isFinite(Number(query.value.replace(',','.'))))) {
        message.textContent='Escribe un número para esta condición.';return;
      }
      const entries=rules().filter(item=>item.column!==c);
      entries.push({column:c,mode:condition,query:query.value});
      api.change('filter',{range,rules:entries});
    } else {
      if (api.sheet().merges?.some(b=>b.r0<=range.r1&&b.r1>=range.r0&&b.c0<=range.c1&&b.c1>=range.c0)) {
        message.textContent='El rango contiene celdas combinadas. Selecciona un rango sin combinaciones.';return;
      }
      if (area(range)>250000) {message.textContent='Selecciona hasta 250.000 celdas para ordenar.';return;}
      api.apply(sortCells(api.sheet(),range,c,$('tools-order').value==='asc',$('tools-header').checked,value));
    }
    dialog.close();
  };
  const matches=()=>findCells(api.sheet(),$('tools-find').value,value,$('tools-raw').checked);
  function search(previous) {
    const result=matches();
    if (!result.length) {message.textContent='Sin coincidencias en esta hoja.';return;}
    cursor=(cursor<0?(previous?result.length-1:0):(cursor+(previous?-1:1)+result.length)%result.length);
    const item=result[cursor];
    const visible=api.go(item);
    message.textContent=item.a+' · '+(cursor+1)+' de '+result.length+(visible?'':' · Fila oculta por el filtro');
  }
  for (const id of ['tools-find','tools-raw']) $(id).oninput=()=>{cursor=-1;message.textContent='';};
  $('tools-next').onclick=()=>search(false);
  $('tools-prev').onclick=()=>search(true);
  $('tools-replace-all').onclick=()=>{
    const needle=$('tools-find').value;
    if (!needle) return;
    const rawMatches=findCells(api.sheet(),needle,value,true), replacement=$('tools-replacement').value;
    const escaped=needle.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
    const pattern=new RegExp(escaped,'giu'), updates=new Map();
    for (const {a} of rawMatches) {
      const cell=api.sheet().cells.get(a);
      const raw=cell.raw.replace(pattern,()=>replacement);
      if (raw!==cell.raw) updates.set(a,{...cell,raw,cached:undefined});
    }
    api.apply(updates);
    message.textContent=updates.size+' celdas actualizadas.';
    cursor=-1;
  };
  function showChart() {
    const index=$('tools-chart-source').value, imported=index===''?null:api.sheet().charts?.[Number(index)];
    const host=$('tools-chart-content');
    if (!imported && (range.r1-range.r0>500 || range.c1-range.c0>15)) {
      host.textContent='Selecciona un rango de hasta 500 filas de datos y 16 columnas para la gráfica.';return;
    }
    renderChart(host,imported?.range ? chartData(imported.range,value,api.hidden()) : imported ? api.importedChart(imported) : chartData(range,value,api.hidden()),imported?.kind ?? $('tools-chart-type').value,
      imported?.title ?? $('tools-chart-title').value);
  }
  for (const id of ['tools-chart-type','tools-chart-title','tools-chart-source']) $(id).oninput=showChart;
  $('tools-save-chart').onclick=()=>{
    if (range.r1-range.r0>500 || range.c1-range.c0>15) {message.textContent='Selecciona un rango más pequeño.';return;}
    const data=chartData(range,value,api.hidden());
    if (!data.series.length) {message.textContent='Selecciona un rango válido con números.';return;}
    const chart={title:$('tools-chart-title').value||'Gráfica',kind:$('tools-chart-type').value,range};
    api.change('charts',[...(api.sheet().charts ?? []),chart]);
    const picker=$('tools-chart-source');picker.add(new Option(chart.title,String(picker.options.length-1)));
    picker.value=String(picker.options.length-2);
    message.textContent='Gráfica guardada en esta hoja.';
  };
  $('tools-delete-chart').onclick=()=>{
    const picker=$('tools-chart-source');
    if (picker.value==='') return;
    const index=Number(picker.value);
    api.change('charts',api.sheet().charts.filter((_,i)=>i!==index));
    picker.remove(index+1);
    Array.from(picker.options).slice(1).forEach((option,i)=>{option.value=String(i);});
    picker.value='';showChart();
  };
  for (const id of ['freeze-row','freeze-col']) $(id).onchange=()=>{
    api.change('freeze',{row:$('freeze-row').checked,col:$('freeze-col').checked});
  };
  $('show-hidden').onchange=()=>api.change('revealSourceRows',$('show-hidden').checked);
  api.canvas.addEventListener('keydown',e=>{
    if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f') {e.preventDefault();open('find');}
  });
}
