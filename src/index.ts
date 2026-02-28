import express from 'express';
import path from 'path';
import apiRouter from './routes/api';
import { updateAllCryptos } from './services/aggregator';
import { CONFIG } from './config';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', apiRouter);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

async function start() {
  console.log('🚀 BK P2P Aggregator starting...');
  console.log(`📡 Exchanges: Bybit, Binance, OKX`);
  console.log(`💱 Cryptos: ${CONFIG.cryptos.join(', ')}`);
  console.log(`🔄 Update interval: ${CONFIG.updateIntervalMs / 1000}s`);

  // Initial fetch
  await updateAllCryptos().catch(err => console.error('Initial fetch error:', err.message));

  // Schedule updates
  setInterval(() => {
    updateAllCryptos().catch(err => console.error('Update error:', err.message));
  }, CONFIG.updateIntervalMs);

  app.listen(CONFIG.port, () => {
    console.log(`\n✅ Dashboard: http://localhost:${CONFIG.port}`);
    console.log(`📊 API: http://localhost:${CONFIG.port}/api/rates`);
  });
}

start();
