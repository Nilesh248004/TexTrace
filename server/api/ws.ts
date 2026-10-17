import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { bus } from '../lib/events';
import type { LedgerService } from '../ledger/types';

export function attachWebSocket(server: Server, ledger: LedgerService): { close(): void } {
  const sockets = new WebSocketServer({ server, path: '/ws' });
  sockets.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'hello', data: { serverTime: new Date().toISOString(), height: ledger.height() } }));
  });
  const unsubscribe = bus.onEvent((event) => {
    const message = JSON.stringify(event);
    for (const socket of sockets.clients) if (socket.readyState === WebSocket.OPEN) socket.send(message);
  });
  return {
    close() {
      unsubscribe();
      for (const socket of sockets.clients) socket.close(1001, 'Server shutting down');
      sockets.close();
    },
  };
}