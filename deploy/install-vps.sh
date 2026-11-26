#!/usr/bin/env bash
# Automated Ubuntu VPS Provisioning Script for MATN Platform
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

if [ ! -f ".env" ]; then
  echo "⚙️ Generating secure .env file via scripts/setup-env.js..."
  DOMAIN_ARG="${MATN_DOMAIN:-}"
  if [ -n "$DOMAIN_ARG" ]; then
    node scripts/setup-env.js --yes --domain="$DOMAIN_ARG"
  else
    node scripts/setup-env.js
  fi
fi

MATN_DOMAIN_RESOLVED="${MATN_DOMAIN:-}"
if [ -z "$MATN_DOMAIN_RESOLVED" ] && [ -f ".env" ]; then
  MATN_DOMAIN_RESOLVED="$(grep -E '^CORS_ALLOWED_ORIGINS=' .env | head -n1 | cut -d'=' -f2- | sed -E 's#https?://([^,/ ]+).*#\1#')"
fi
MATN_DOMAIN_RESOLVED="${MATN_DOMAIN_RESOLVED:-your-domain.com}"

echo "🕌 Installing Node.js 22 LTS, Nginx, Certbot & UFW..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get update -y
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx sqlite3 default-mysql-client ufw
sudo npm install -g pm2

# Configure firewall (allow SSH, HTTP, HTTPS only; port 4000 stays bound to 127.0.0.1)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Increase OS file descriptor limits (idempotent) and ensure logs/backups directories exist
grep -qF "* soft nofile 65535" /etc/security/limits.conf || echo "* soft nofile 65535" | sudo tee -a /etc/security/limits.conf >/dev/null
grep -qF "* hard nofile 65535" /etc/security/limits.conf || echo "* hard nofile 65535" | sudo tee -a /etc/security/limits.conf >/dev/null
mkdir -p "$APP_DIR/logs" "$APP_DIR/backups" "$APP_DIR/uploads/videos" "$APP_DIR/uploads/pdfs"

echo "📦 Installing Node.js production dependencies..."
npm ci --omit=dev

echo "✅ Running database migrations & indexes..."
npm run db:migrate

echo "✅ Running production pre-flight checks..."
NODE_ENV=production npm run preflight

echo "✅ Starting MATN Platform via PM2..."
pm2 start deploy/ecosystem.config.js --env production
pm2 save

echo "✅ Configuring PM2 startup on boot..."
TARGET_USER="${SUDO_USER:-$USER}"
TARGET_HOME="$(eval echo ~"$TARGET_USER")"
STARTUP_CMD=$(pm2 startup systemd -u "$TARGET_USER" --hp "$TARGET_HOME" | grep -E "^\s*sudo " | head -n 1 || true)
if [ -n "$STARTUP_CMD" ]; then
  eval "$STARTUP_CMD"
else
  sudo env PATH="$PATH" pm2 startup systemd -u "$TARGET_USER" --hp "$TARGET_HOME" || true
fi
pm2 save

# Register daily 03:30 AM backup cron job (retains latest 14 backups automatically)
CRON_CMD="30 3 * * * cd $APP_DIR && /usr/bin/node scripts/backup-db.js backup >> $APP_DIR/logs/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -v "scripts/backup-db.js"; echo "$CRON_CMD") | crontab -

# Configure Nginx template with resolved domain and uploads/videos path
sudo mkdir -p /var/www/certbot /etc/nginx/sites-available
sed -e "s|__MATN_DOMAIN__|${MATN_DOMAIN_RESOLVED}|g" \
    -e "s|__MATN_UPLOADS_VIDEOS_DIR__|${APP_DIR}/uploads/videos|g" \
    "$APP_DIR/deploy/nginx-matn.conf" | sudo tee /etc/nginx/sites-available/matn-platform >/dev/null
if [ ! -e /etc/nginx/sites-enabled/matn-platform ]; then
  sudo ln -s /etc/nginx/sites-available/matn-platform /etc/nginx/sites-enabled/matn-platform
fi

echo "🎉 Server setup complete! Issue SSL via: sudo certbot --nginx -d ${MATN_DOMAIN_RESOLVED} && sudo nginx -t && sudo systemctl reload nginx"
