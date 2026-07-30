import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { StoreProvider } from './storeContext';
import { Home } from './Home';
import { Drill } from './Drill';
import { Stats } from './Stats';
import { Settings } from './Settings';
import { decodeSession } from '../core/encode';
import type { SessionConfig } from '../core/session';

/**
 * Hash router — `#/drill?m=…` links work on any static host with zero rewrite
 * rules. Fresh sessions travel in memory (pendingConfig); only shared
 * challenge links carry params, which is exactly what marks them as replays.
 */
function useHashRoute(): string {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener('hashchange', cb);
    return () => window.removeEventListener('hashchange', cb);
  }, []);
  return useSyncExternalStore(subscribe, () => window.location.hash);
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}

export default function App() {
  const hash = useHashRoute();
  const [pendingConfig, setPendingConfig] = useState<SessionConfig | null>(null);

  const [route, query] = (() => {
    const h = hash.startsWith('#/') ? hash.slice(2) : '';
    const qIdx = h.indexOf('?');
    return qIdx === -1 ? [h, ''] : [h.slice(0, qIdx), h.slice(qIdx + 1)];
  })();

  const startSession = useCallback((config: SessionConfig) => {
    setPendingConfig(config);
    navigate('#/drill');
  }, []);

  // A shared link carries its whole config; a fresh session uses the in-memory one.
  const drillConfig = route === 'drill' ? (query ? decodeSession(query) : pendingConfig) : null;

  const inDrill = route === 'drill' && drillConfig !== null;

  useEffect(() => {
    if (route === 'drill' && drillConfig === null) navigate('#/');
  }, [route, drillConfig]);

  return (
    <StoreProvider>
      {inDrill ? (
        <Drill
          key={`${drillConfig.seed}-${drillConfig.mode}`}
          config={drillConfig}
          onExit={() => {
            setPendingConfig(null);
            navigate('#/');
          }}
          onRestart={startSession}
        />
      ) : (
        <div className="shell">
          <header className="topbar">
            <a className="wordmark" href="#/">
              mental<span className="x">×</span>math
            </a>
            <nav aria-label="Main">
              <a href="#/" aria-current={route === '' ? 'page' : undefined}>Drill</a>
              <a href="#/stats" aria-current={route === 'stats' ? 'page' : undefined}>Stats</a>
              <a href="#/settings" aria-current={route === 'settings' ? 'page' : undefined}>Settings</a>
            </nav>
          </header>
          <main>
            {route === 'stats' ? <Stats /> : route === 'settings' ? <Settings /> : <Home onStart={startSession} />}
          </main>
        </div>
      )}
    </StoreProvider>
  );
}
