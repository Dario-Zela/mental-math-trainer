import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Store } from '../store/schema';
import { loadStore, saveStore } from '../store/persist';

interface StoreApi {
  store: Store;
  /** Pure updater; the result is persisted to localStorage synchronously. */
  update(fn: (s: Store) => Store): void;
}

const StoreCtx = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store>(() => loadStore(window.localStorage));
  const update = useCallback((fn: (s: Store) => Store) => {
    setStore((prev) => {
      const next = fn(prev);
      saveStore(window.localStorage, next);
      return next;
    });
  }, []);
  return <StoreCtx.Provider value={{ store, update }}>{children}</StoreCtx.Provider>;
}

export function useStore(): StoreApi {
  const api = useContext(StoreCtx);
  if (!api) throw new Error('useStore outside StoreProvider');
  return api;
}
