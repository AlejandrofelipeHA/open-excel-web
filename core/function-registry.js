const functions = new Map();
export const FunctionRegistry = Object.freeze({
  register(name, fn, options = {}) {
    if (!/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name) || typeof fn !== 'function') {
      throw new TypeError('Nombre o función inválidos');
    }
    functions.set(name.toUpperCase(), {fn, ...options});
  },
  get: name => functions.get(name.toUpperCase()),
  names: () => [...functions.keys()].sort()
});
