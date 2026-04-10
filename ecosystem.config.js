module.exports = {
  apps: [
    {
      name: 'bk-pay-match',
      script: './dist/index.js',
      env_file: '.env',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      // Daily DB backup (cron expression: every 6 hours)
      cron_restart: '0 */6 * * *',
    },
  ],
};
