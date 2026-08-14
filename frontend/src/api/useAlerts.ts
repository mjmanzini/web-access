import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Alert } from './types';

/**
 * Subscribes to the backend's Socket.IO stream and keeps the last N alerts.
 * Same-origin by default (Vite proxy / Cloudflare route /socket.io upstream).
 */
export function useAlerts(max = 50) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const base = import.meta.env.VITE_API_BASE ?? '';
    const socket: Socket = io(base || '/', { path: '/socket.io' });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('alert', (a: Alert) =>
      setAlerts((prev) => [a, ...prev].slice(0, max)),
    );

    return () => {
      socket.disconnect();
    };
  }, [max]);

  return { alerts, connected };
}
