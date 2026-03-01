"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initWebSocket = initWebSocket;
exports.broadcast = broadcast;
exports.getClientCount = getClientCount;
const ws_1 = require("ws");
let wss;
const clients = new Set();
function initWebSocket(server) {
    wss = new ws_1.WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws) => {
        clients.add(ws);
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
        ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
    });
    console.log('[WebSocket] Server initialized on /ws');
}
function broadcast(type, data) {
    const msg = JSON.stringify({ type, data, timestamp: Date.now() });
    clients.forEach(ws => {
        if (ws.readyState === ws_1.WebSocket.OPEN) {
            try {
                ws.send(msg);
            }
            catch (e) { }
        }
    });
}
function getClientCount() { return clients.size; }
