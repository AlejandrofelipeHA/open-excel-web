import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Workbook,nodeKey} from '../core/grid-model.js';
import {FormulaEngine,shiftFormula,excelFormula} from '../core/formula-engine.js';
import {FunctionRegistry} from '../core/function-registry.js';
import {CommandManager,CellCommand} from '../core/command-manager.js';
import {excelAliases} from '../plugins/standard-functions.js';
import '../plugins/functions/example.js';
import {importFile,exportFile} from '../io/file-manager.js';
import {parseTSV,tsv} from '../io/clipboard.js';

const cell = raw => ({raw,style:{}});
function setup() {
  const book=new Workbook(), engine=new FormulaEngine(book);
  const history=new CommandManager(()=>{});
  const set=(cells,sheet=book.active)=>history.run(new CellCommand(book,engine,sheet,new Map(
    Object.entries(cells).map(([a,raw])=>[a,cell(raw)])
  )));
  return {book,engine,history,set,value:(a,id=book.active)=>engine.value(id,a)};
}
test('cross-sheet incremental updates, lazy IF, ranges, undo and redo',()=>{
  const {book,engine,history,set,value}=setup();
  let evaluations=0;
  FunctionRegistry.register('INCREMENTAL_TEST',()=>++evaluations);
  set({A1:'2',A2:'3',B1:'=SUMA(A1:A2)*2',C1:'=INCREMENTAL_TEST()',D1:'=SI(FALSO;1/0;DOBLE(A1))'});
  set({A1:"='Hoja 1'!B1+1"},'sheet-2');
  assert.equal(value('A1','sheet-2'),11);
  set({A1:'7'});
  assert.equal(value('A1','sheet-2'),21);
  assert.equal(value('D1'),14);
  assert.equal(evaluations,1);
  history.undo();
  assert.equal(value('A1','sheet-2'),11);
  history.redo();
  assert.equal(value('A1','sheet-2'),21);
  assert.equal(new Workbook(book.serialize()).get(book.active).cells.get('A1').raw,'7');
  assert.equal(engine.graph.ranges.get(book.active).size,1);
});
test('cycle formation and recovery through a range and another sheet',()=>{
  const {set,value,history}=setup();
  set({A1:'1',B1:'=SUM(A1:A2)',C1:'=B1+1'});
  set({A1:"='Hoja 1'!C1"},'sheet-2');
  set({A2:"='Hoja 2'!A1"});
  assert.equal(value('B1'),'#CIRC!');
  assert.equal(value('A1','sheet-2'),'#CIRC!');
  history.undo();
  assert.equal(value('B1'),1);
  assert.equal(value('A1','sheet-2'),2);
});
test('formula operators, lookup, relative filling and Excel translation',()=>{
  const {set,value}=setup();
  set({A1:'1',B1:'uno',A2:'2',B2:'dos',C1:'=BUSCARV(2;A1:B2;2;FALSO)',
    C2:'=-2^2+50%',C3:'=SI.ERROR(1/0;"x")',C4:'=REDONDEAR(-1.25;1)'});
  assert.equal(value('C1'),'dos');
  assert.equal(value('C2'),-3.5);
  assert.equal(value('C3'),'x');
  assert.equal(value('C4'),-1.3);
  assert.equal(shiftFormula('=$A1+B$2+\'Hoja 2\'!C3&"A1"',2,3),'=$A3+E$2+\'Hoja 2\'!F5&"A1"');
  assert.equal(shiftFormula('=A1',-1,0),'=#REF!');
  assert.equal(excelFormula('=SI(A1;SUMA(A2:A4);"A;B")',excelAliases),'IF(A1,SUM(A2:A4),"A;B")');
});
test('long chains use an iterative topological plan',()=>{
  const {set,value}=setup();
  const cells={A1:'1'};
  for (let i=2;i<=11000;i++) cells['A'+i]='=A'+(i-1)+'+1';
  set(cells);
  assert.equal(value('A11000'),11000);
  set({A1:'3'});
  assert.equal(value('A11000'),11002);
});
test('quoted Excel TSV handles multiline text, tabs and empty trailing fields',()=>{
  const rows=[['a\tb','a"b',''],['first\r\nsecond','2','3']];
  assert.deepEqual(parseTSV(tsv(rows)),rows);
  assert.deepEqual(parseTSV('a\tb\r\nc\td\r\n'),[['a','b'],['c','d']]);
});
test('real XLSX and CSV round trip via vendored SheetJS',async()=>{
  const context={};
  vm.runInNewContext(await readFile(new URL('../assets/xlsx.full.min.js',import.meta.url),'utf8'),context);
  const x=context.XLSX;
  let bytes;
  globalThis.XLSX={...x,writeFile(wb,name,{bookType}){
    bytes=x.write(wb,{bookType,type:'array'});
  }};
  const {book,engine,set}=setup();
  set({A1:'3',B1:'=SUMA(A1;2)',A2:"'=literal"});
  set({A1:"='Hoja 1'!B1+1"},'sheet-2');
  exportFile(book,engine,'xlsx');
  const sheets=await importFile({name:'workbook.xlsx',arrayBuffer:async()=>new Uint8Array(bytes).buffer});
  assert.equal(sheets.length,2);
  assert.equal(sheets[0].cells.get('B1').raw,'=SUM(A1,2)');
  assert.equal(sheets[0].cells.get('A2').raw,"'=literal");
  const restored=new Workbook();
  restored.sheets=sheets;
  const calculator=new FormulaEngine(restored);
  assert.equal(calculator.value(sheets[1].id,'A1'),6);
  assert.equal(calculator.values.get(nodeKey(sheets[0].id,'B1')),5);
  exportFile(book,engine,'csv');
  const [csv]=await importFile({name:'workbook.csv',text:async()=>new TextDecoder().decode(new Uint8Array(bytes))});
  assert.equal(csv.cells.get('B1').raw,'5');
  assert.equal(csv.cells.get('A2').raw,"'=literal");
});
