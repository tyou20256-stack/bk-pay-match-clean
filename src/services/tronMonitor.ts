// TronGrid USDT deposit monitor
import * as dbSvc from './database.js';
import notifier from './notifier.js';

const TRONGRID_API = 'https://api.trongrid.io';
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT TRC-20
const CHECK_INTERVAL = 30000; // 30 seconds

let lastCheckedTimestamp = Date.now();
let monitorInterval: ReturnType<typeof setInterval> | null = null;

interface TRC20Transfer {
  transaction_id: string;
  token_info: { symbol: string; address: string };
  from: string;
  to: string;
  value: string;
  block_timestamp: number;
}

async function checkDeposits(): Promise<void> {
  const wallet = dbSvc.getWalletConfig() as any;
  if (!wallet?.address) return;

  try {
    const url = `${TRONGRID_API}/v1/accounts/${wallet.address}/transactions/trc20?only_confirmed=true&limit=20&contract_address=${USDT_CONTRACT}&min_timestamp=${lastCheckedTimestamp}`;
    const res = await fetch(url, {
      headers: { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY || '' }
    });
    const data = await res.json() as any;
    
    if (!data.data?.length) return;

    for (const tx of data.data as TRC20Transfer[]) {
      // Only incoming transfers
      if (tx.to.toLowerCase() !== wallet.address.toLowerCase()) continue;
      
      const usdtAmount = parseFloat(tx.value) / 1e6; // USDT has 6 decimals
      console.log(`[TronMonitor] Incoming USDT: ${usdtAmount} from ${tx.from} tx:${tx.transaction_id}`);

      // Try to match with pending orders
      const orders = dbSvc.getAllOrders() as any[];
      const pendingOrders = orders.filter((o: any) => 
        o.status === 'confirming' && 
        Math.abs(o.cryptoAmount - usdtAmount) < 0.01 // Allow tiny variance
      );

      if (pendingOrders.length > 0) {
        const order = pendingOrders[0];
        dbSvc.updateOrderStatus(order.id, 'completed', { completedAt: Date.now() });
        console.log(`[TronMonitor] Auto-completed order ${order.id} (${usdtAmount} USDT)`);
        notifier.notifyCompleted({ ...order, status: 'completed', completedAt: Date.now() });
      } else {
        // Notify about unmatched deposit
        notifier.notifyNewOrder({
          id: 'DEPOSIT',
          amount: 0,
          cryptoAmount: usdtAmount,
          rate: 0,
          payMethod: 'USDT',
          mode: 'deposit',
          exchange: `TX: ${tx.transaction_id.slice(0, 16)}...`
        });
      }

      if (tx.block_timestamp > lastCheckedTimestamp) {
        lastCheckedTimestamp = tx.block_timestamp + 1;
      }
    }
  } catch (e: any) {
    console.error('[TronMonitor] Error:', e.message);
  }
}

export function startMonitor(): void {
  if (monitorInterval) return;
  const wallet = dbSvc.getWalletConfig() as any;
  if (!wallet?.address) {
    console.log('[TronMonitor] No wallet configured. Monitor inactive.');
    return;
  }
  console.log(`[TronMonitor] Monitoring ${wallet.address} for USDT deposits (${CHECK_INTERVAL/1000}s interval)`);
  monitorInterval = setInterval(checkDeposits, CHECK_INTERVAL);
  checkDeposits(); // Initial check
}

export function stopMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

export default { startMonitor, stopMonitor };
