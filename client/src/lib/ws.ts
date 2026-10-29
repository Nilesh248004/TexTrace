import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLive, useSession } from './store';

/** Live updates: ledger height + "something changed" → refetch active queries. */
export function useLiveSocket(): void {
  const qc = useQueryClient();
  const token = useSession((s) => s.token);
  useEffect(() => {
    if (!token) return;
    let socket: WebSocket | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let debounce: ReturnType<typeof setTimeout> | undefined; let alive = true; let tries = 0;
    const connect = () => {
      if (!alive) return;
      const url = new URL('/ws', window.location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      socket.onopen = () => { tries = 0; useLive.getState().set({ online: true }); };
      socket.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data)) as { type: string; data: { height?: number; number?: number } };
          if (m.type === 'hello' && typeof m.data.height === 'number') useLive.getState().set({ height: m.data.height });
          if (m.type === 'block' && typeof m.data.number === 'number') useLive.getState().set({ height: m.data.number });
          if (m.type === 'invalidate') { clearTimeout(debounce); debounce = setTimeout(() => void qc.invalidateQueries({ queryKey: ['api'] }), 350); }
        } catch { /* ignore malformed frames */ }
      };
      socket.onclose = () => { useLive.getState().set({ online: false }); if (alive) timer = setTimeout(connect, Math.min(15000, 800 * 2 ** tries++)); };
    };
    connect();
    return () => { alive = false; clearTimeout(timer); clearTimeout(debounce); socket?.close(); };
  }, [token, qc]);
}
