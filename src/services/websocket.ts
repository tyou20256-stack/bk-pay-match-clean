import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

let wss: WebSocketServer;
const clients = new Set<WebSocket>();

export function initWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
    ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
  });

  console.log('[WebSocket] Server initialized on /ws');
}

export function broadcast(type: string, data: any) {
  const msg = JSON.stringify({ type, data, timestamp: Date.now() });
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch(e) {}
    }
  });
}

export function getClientCount() { return clients.size; }
