import {FunctionRegistry} from '../core/function-registry.js';
import {definitions} from './functions/standard.js';
import {extended} from './functions/extended.js';

export const excelAliases = new Map();
for (const [english,spanish,fn,options] of [...definitions,...extended]) {
  for (const name of new Set([english,spanish])) {
    FunctionRegistry.register(name,fn,options);
    excelAliases.set(name,english);
  }
}
FunctionRegistry.register('CONCATENATE',FunctionRegistry.get('CONCAT').fn);

for (const [alias,name] of [['STDEV','STDEV.S'],['STDEVP','STDEV.P'],['ÍNDICE','INDICE'],['DÍA','DIA']]) {
  const entry=FunctionRegistry.get(name);
  FunctionRegistry.register(alias,entry.fn,entry);
  excelAliases.set(alias,excelAliases.get(name));
}
