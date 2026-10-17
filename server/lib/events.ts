// In-process event bus. The runtime publishes WsEvents; server/api/ws.ts broadcasts them to browsers.
import { EventEmitter } from 'node:events';
import type { QueryDomain, WsEvent } from '@shared/api';

class Bus extends EventEmitter {
  publish(event: WsEvent): void {
    this.emit('ws', event);
  }
  invalidate(domains: QueryDomain[] | ['*']): void {
    this.publish({ type: 'invalidate', data: { domains } });
  }
  onEvent(listener: (event: WsEvent) => void): () => void {
    this.on('ws', listener);
    return () => this.off('ws', listener);
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
