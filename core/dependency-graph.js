import {splitKey, coordinates, contains} from './grid-model.js';

// References retain their rectangles. Large blank ranges never allocate graph nodes.
export class DependencyGraph {
  direct = new Map();
  ranges = new Map();
  references = new Map();

  replace(key, refs) {
    const update = (ref, add) => {
      const index = ref.key ? this.direct : this.ranges;
      const id = ref.key ?? ref.sheet;
      const entries = index.get(id) ?? new Set();
      if (add) {
        entries.add(ref.key ? key : ref);
        index.set(id, entries);
      } else {
        entries.delete(ref.key ? key : ref);
        if (!entries.size) index.delete(id);
      }
    };
    for (const ref of this.references.get(key) ?? []) update(ref, false);
    if (!refs.length) {
      this.references.delete(key);
      return;
    }
    const entries = refs.map(ref => ({...ref, owner:key}));
    this.references.set(key, entries);
    for (const ref of entries) update(ref, true);
  }

  *dependents(key) {
    yield* this.direct.get(key) ?? [];
    const [sheet,a] = splitKey(key);
    const p = coordinates(a);
    for (const ref of this.ranges.get(sheet) ?? []) {
      if (contains(ref,p.r,p.c)) yield ref.owner;
    }
  }

  plan(changed) {
    const nodes = new Set(changed), edges = new Map(), indegree = new Map();
    for (const key of nodes) {
      const next = new Set(this.dependents(key));
      edges.set(key, next);
      for (const dependent of next) {
        nodes.add(dependent);
        indegree.set(dependent, (indegree.get(dependent) ?? 0) + 1);
      }
    }
    const order = [...nodes].filter(key => !indegree.get(key));
    for (const key of order) {
      for (const dependent of edges.get(key)) {
        const remaining = indegree.get(dependent) - 1;
        indegree.set(dependent, remaining);
        if (!remaining) order.push(dependent);
      }
    }
    // Unresolved nodes either belong to a cycle or depend on it.
    return {order, blocked:[...nodes].filter(key => indegree.get(key) > 0)};
  }
}
