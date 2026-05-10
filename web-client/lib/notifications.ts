'use client';

/**
 * notifications.ts — lightweight in-app toaster, browser notifications, and
 * unread badge helpers. Browser permission is requested lazily on the first
 * `notify()` call; silently downgrades to a toast when blocked or unsupported.
 */

export type ToastKind = 'info' | 'success' | 'error' | 'message';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  kind: ToastKind;
  href?: string;
  avatarUrl?: string | null;
}

type Listener = (toasts: Toast[]) => void;

let SEQ = 1;
const listeners = new Set<Listener>();
let toasts: Toast[] = [];

function emit() { for (const l of listeners) l([...toasts]); }

export function subscribeToasts(fn: Listener) {
  listeners.add(fn);
  fn([...toasts]);
  return () => listeners.delete(fn);
}

export function pushToast(t: Omit<Toast, 'id'>, ttlMs = 5500) {
  const id = SEQ++;
  toasts = [...toasts, { id, ...t }];
  emit();
  if (ttlMs > 0) {
    setTimeout(() => dismissToast(id), ttlMs);
  }
  return id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

// ---------------------------------------------------------------------------
// Notification permission + delivery
// ---------------------------------------------------------------------------

let permissionPromise: Promise<NotificationPermission> | null = null;

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : 'denied';
}

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  if (!permissionPromise) {
    permissionPromise = Notification.requestPermission().finally(() => { permissionPromise = null; });
  }
  return permissionPromise;
}

export interface NotifyOptions {
  title: string;
  body?: string;
  href?: string;
  tag?: string;
  icon?: string;
  silent?: boolean;
  kind?: ToastKind;
  avatarUrl?: string | null;
  /** Skip the browser notification path even if granted. */
  inAppOnly?: boolean;
}

function pageVisible(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

export async function notify(opts: NotifyOptions): Promise<void> {
  const { title, body, href, tag, icon, silent, kind = 'message', avatarUrl } = opts;
  // Always toast in-app so the user sees something even when focused.
  pushToast({ title, body, href, kind, avatarUrl });

  if (opts.inAppOnly) return;
  if (pageVisible()) return; // browser notif only when tab is hidden / blurred
  if (!notificationsSupported()) return;

  if (Notification.permission === 'default') {
    await ensureNotificationPermission();
  }
  if (Notification.permission !== 'granted') return;

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(title, {
          body,
          tag,
          icon: icon || '/icons/icon-192.svg',
          badge: '/icons/icon-192.svg',
          silent,
          data: { href: href || '/' },
        });
        return;
      }
    }
    new Notification(title, { body, tag, icon: icon || '/icons/icon-192.svg', silent });
  } catch {
    // Toast already shown; swallow errors.
  }
}

// ---------------------------------------------------------------------------
// App badge (PWA installable shortcut counter)
// ---------------------------------------------------------------------------

interface BadgeNavigator {
  setAppBadge?(count?: number): Promise<void>;
  clearAppBadge?(): Promise<void>;
}

export async function setAppBadge(count: number): Promise<void> {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & BadgeNavigator;
  try {
    if (count > 0 && typeof nav.setAppBadge === 'function') {
      await nav.setAppBadge(count);
    } else if (typeof nav.clearAppBadge === 'function') {
      await nav.clearAppBadge();
    }
  } catch { /* best-effort */ }
}

export async function clearAppBadge(): Promise<void> {
  return setAppBadge(0);
}
