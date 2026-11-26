module.exports = {
  apps: [
    {
      name: 'matn-platform',
      script: 'server.js',
      instances: 1, // Keep 1 process with SQLite WAL & in-memory rate-limit/upload state; use Hostinger MySQL + Redis for multi-instance cluster
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 2000,
      kill_timeout: 16000,
      error_file: './logs/matn-error.log',
      out_file: './logs/matn-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'production',
        UV_THREADPOOL_SIZE: '16'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
        UV_THREADPOOL_SIZE: '16'
      }
    }
  ]
};
