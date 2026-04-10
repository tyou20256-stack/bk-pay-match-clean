import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import type { Server as HttpsServer } from 'https';
import { validateSession } from './database.js';
import logger from './logger.js';

interface AuthenticatedWebSocket extends WebSocket {
  isAlive: boolean;
  sessionToken: string;
  clientIp: string;
}

let wss: WebSocketServer;
const clients = new Set<AuthenticatedWebSocket>();
const MAX_CLIENTS = 100;
const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach(pair => {
    const [key, ...vals] = pair.trim().split('=');
    if (key) cookies[key.trim()] = vals.join('=').trim();
  });
  return cookies;
}

export function initWebSocket(server: Server | HttpsServer) {
  wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const aWs = ws as AuthenticatedWebSocket;
    // Authenticate WebSocket connections via cookie
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies['bkpay_token'];
    const wsIp = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || '';
    if (!token || !validateSession(token, wsIp)) {
      ws.close(4401, 'Unauthorized');
      return;
    }
    aWs.sessionToken = token;
    aWs.clientIp = wsIp;

    // Connection limit
    if (clients.size >= MAX_CLIENTS) {
      ws.close(4429, 'Too many connections');
      return;
    }

    aWs.isAlive = true;
    clients.add(aWs);

    ws.on('pong', () => { aWs.isAlive = true; });
    ws.on('close', () => clients.delete(aWs));
    ws.on('error', () => clients.delete(aWs));
    ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
  });

  // Heartbeat: ping all clients, terminate unresponsive ones
  heartbeatTimer = setInterval(() => {
    clients.forEach(aWs => {
      if (aWs.isAlive === false) {
        clients.delete(aWs);
        return aWs.terminate();
      }

      // During heartbeat, check if session is still valid
      if (aWs.sessionToken) {
        const valid = validateSession(aWs.sessionToken, aWs.clientIp);
        if (!valid) {
          clients.delete(aWs);
          aWs.close(4401, 'Session expired');
          return;
        }
      }

      aWs.isAlive = false;
      try { aWs.ping(); } catch { clients.delete(aWs); }
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  });

  logger.info('WebSocket server initialized', { path: '/ws', maxClients: MAX_CLIENTS });
}

export function broadcast(type: string, data: Record<string, unknown>) {
  const msg = JSON.stringify({ type, data, timestamp: Date.now() });
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch {}
    }
  });
}

export function getClientCount() { return clients.size; }

export function closeWebSocket(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  clients.forEach(ws => { try { ws.close(1001, 'Server shutting down'); } catch {} });
  clients.clear();
  if (wss) { try { wss.close(); } catch {} }
}
