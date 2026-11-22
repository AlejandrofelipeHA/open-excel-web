import {FunctionRegistry} from '../../core/function-registry.js';
import {number} from '../../core/formula-engine.js';

FunctionRegistry.register('DOBLE',value => number(value) * 2);
