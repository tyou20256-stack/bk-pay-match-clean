import type { Server } from 'http';
export declare function initWebSocket(server: Server): void;
export declare function broadcast(type: string, data: any): void;
export declare function getClientCount(): number;
