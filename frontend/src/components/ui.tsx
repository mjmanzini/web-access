import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * The shared state kit every page uses.
 *
 * Three things kept going wrong, each one making the dashboard look broken
 * rather than busy:
 *
 *  - Content appeared out of nowhere. A page rendered its empty state while
 *    still loading, so "no devices yet" and "still fetching" looked identical.
 *  - Buttons gave no sign a tap had landed. A slow request and a dead button
 *    are indistinguishable, so people tap again.
 *  - Failures went to the console. Seventeen `.catch(() => {})` calls meant a
 *    dropped session or an unreachable API showed as a page that simply never
 *    filled in.
 *
 * Everything here exists so a new feature gets all three by default instead of
 * having to remember them.
 */

// ---------------------------------------------------------------- data loads

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** True only for the first load, so a refresh does not blank the screen. */
  initial: boolean;
}

/**
 * Load data with loading/error/retry handled once. `deps` behaves like
 * useEffect's. The fetcher's result is ignored if the component unmounted or a
 * newer load started, so a slow response cannot overwrite a fresh one.
 */
export function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState(true);
  const runId = useRef(0);
  const alive = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(() => {
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((out) => {
        if (!alive.current || id !== runId.current) return;
        setData(out);
      })
      .catch((e: unknown) => {
        if (!alive.current || id !== runId.current) return;
        setError((e as Error)?.message || 'Could not load this. Check the connection.');
      })
      .finally(() => {
        if (!alive.current || id !== runId.current) return;
        setLoading(false);
        setInitial(false);
      });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, deps);

  return { data, loading, error, reload: load, initial };
}

// ------------------------------------------------------------- mutations

export interface ActionState {
  /** Runs fn, tracking in-flight state and surfacing any failure by name. */
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
  /** Is this particular button in flight? */
  busy: (key: string) => boolean;
  anyBusy: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * In-flight state keyed per button, so pressing "Pause" on one device does not
 * grey out every other row — which is what a single global `busy` flag does.
 */
export function useAction(): ActionState {
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setInFlight((prev) => new Set(prev).add(key));
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error)?.message || 'That did not work. Please try again.');
    } finally {
      setInFlight((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  return {
    run,
    busy: (key: string) => inFlight.has(key),
    anyBusy: inFlight.size > 0,
    error,
    clearError: () => setError(null),
  };
}

// ------------------------------------------------------------------ display

/** Grey bars standing in for content, so a load never looks like an empty page. */
export function Skeleton({ rows = 3, height = 18 }: { rows?: number; height?: number }) {
  return (
    <div className="grid" style={{ gap: 8 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height, width: `${100 - (i % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}

/** A failure the user can actually see, name, and retry. */
export function ErrorNotice({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="alert"
      className="card"
      style={{ borderColor: 'var(--danger)', marginBottom: 12, padding: 12 }}
    >
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: 'var(--danger)', fontSize: 13 }}>{message}</span>
        <div className="row" style={{ gap: 6 }}>
          {onRetry && (
            <button className="ghost" onClick={onRetry}>
              Try again
            </button>
          )}
          {onDismiss && (
            <button className="ghost" onClick={onDismiss} aria-label="Dismiss">
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Deliberately distinct from loading: this means "we looked, there is nothing". */
export function EmptyState({
  icon = '—',
  title,
  hint,
}: {
  icon?: string;
  title: string;
  hint?: string;
}) {
  return (
    <div style={{ textAlign: 'center', padding: '28px 16px' }}>
      <div style={{ fontSize: 30, marginBottom: 8, opacity: 0.7 }}>{icon}</div>
      <div style={{ fontSize: 14, marginBottom: 4 }}>{title}</div>
      {hint && <div className="muted" style={{ fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

/**
 * Loading → error → empty → content, in one place, so no page can accidentally
 * show its empty state while a request is still in flight.
 */
export function Async<T>({
  state,
  empty,
  skeleton,
  children,
}: {
  state: AsyncState<T>;
  empty?: { title: string; hint?: string; icon?: string; when?: (data: T) => boolean };
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.error && state.data === undefined) {
    return <ErrorNotice message={state.error} onRetry={state.reload} />;
  }
  if (state.initial && state.loading) return <>{skeleton ?? <Skeleton />}</>;
  if (state.data === undefined) return <>{skeleton ?? <Skeleton />}</>;

  const isEmpty = empty?.when
    ? empty.when(state.data)
    : Array.isArray(state.data) && state.data.length === 0;
  if (empty && isEmpty) {
    return <EmptyState icon={empty.icon} title={empty.title} hint={empty.hint} />;
  }
  return (
    <>
      {/* A refresh that fails keeps the stale data on screen and says so, rather
          than throwing the page away. */}
      {state.error && <ErrorNotice message={state.error} onRetry={state.reload} />}
      {children(state.data)}
    </>
  );
}

// ------------------------------------------------------------------ confirm

interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<((req: ConfirmRequest) => Promise<boolean>) | null>(null);

/**
 * A confirm dialog that names the thing it is about.
 *
 * Browser `confirm()` is blocked or styled unusably in some mobile contexts and
 * cannot say "Forget Samsung tv?" in a way that reads well on a phone. Reserved
 * for actions that are irreversible or that change what the household can do —
 * asking about everything trains people to tap through without reading.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback((r: ConfirmRequest) => {
    setReq(r);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setReq(null);
  };

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {req && (
        <div
          className="confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={req.title}
          onClick={(e) => {
            if (e.target === e.currentTarget) close(false);
          }}
        >
          <div className="confirm-box">
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{req.title}</div>
            {req.body && (
              <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>{req.body}</div>
            )}
            {/* Cancel first on the left, action on the right, both full-height:
                a mis-tap should be the harmless one. */}
            <div className="confirm-actions">
              <button className="ghost" onClick={() => close(false)}>
                Cancel
              </button>
              <button
                className={req.danger ? 'danger' : ''}
                onClick={() => close(true)}
                autoFocus
              >
                {req.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/** `const confirm = useConfirm(); if (!(await confirm({...}))) return;` */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
