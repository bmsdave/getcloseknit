/**
 * One value kept outside React state: the map hands it over on every timeline step, and only the
 * components that read it (useSyncExternalStore) re-render, never the whole page.
 */
export interface ValueStore<Value> {
  get: () => Value;
  set: (next: Value) => void;
  subscribe: (listener: () => void) => () => void;
}

export function valueStore<Value>(initial: Value): ValueStore<Value> {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      if (Object.is(next, current)) return;
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
