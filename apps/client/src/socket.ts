import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@translate/shared';

// Connects to the same origin the page was loaded from (Vite proxies it in development). A
// reader's page sends the session's code (auth.code); a host's page has its sign-in cookie.
// Not connected yet: the page connects once its listeners are in place.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: false,
});

/** An action got no reply in time while the socket looks connected: a fresh connection. */
export function freshIfStale(): void {
  if (socket.connected) socket.disconnect().connect();
}
