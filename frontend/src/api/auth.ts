// Minimal token store + auth events. The token is a JWT from POST /api/auth/login.
const KEY = 'hg.token';

let token: string | null = localStorage.getItem(KEY);
const listeners = new Set<(authed: boolean) => void>();

export const auth = {
  get token() {
    return token;
  },
  get isAuthed() {
    return !!token;
  },
  set(t: string) {
    token = t;
    localStorage.setItem(KEY, t);
    listeners.forEach((l) => l(true));
  },
  clear() {
    token = null;
    localStorage.removeItem(KEY);
    listeners.forEach((l) => l(false));
  },
  /** Subscribe to auth state changes (login/logout/expiry). Returns an
   * unsubscribe fn suitable as a React effect cleanup (returns void). */
  subscribe(fn: (authed: boolean) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
