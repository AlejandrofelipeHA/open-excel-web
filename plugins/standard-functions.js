import {FunctionRegistry} from '../core/function-registry.js';
import {definitions} from './functions/standard.js';

export const excelAliases = new Map();
for (const [english,spanish,fn,options] of definitions) {
  for (const name of new Set([english,spanish])) {
    FunctionRegistry.register(name,fn,options);
    excelAliases.set(name,english);
  }
}
FunctionRegistry.register('CONCATENATE',FunctionRegistry.get('CONCAT').fn);
