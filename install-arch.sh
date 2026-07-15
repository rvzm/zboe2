#!/usr/bin/env bash
# zboe2 installer — Arch Linux (pacman)
#
# Installs NodeJS + npm dependencies. There is no system service: the server
# manages its own lifecycle (run `node server.js` to background it, `--stop`
# to kill it, `--verbose` to stay attached as a live console).

set -euo pipefail

APP_NAME="zboe2"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_PORT=3000

########################################
# Helpers
########################################

log()   { echo "[INFO] $*"; }
warn()  { echo "[WARN] $*" >&2; }
error() { echo "[ERROR] $*" >&2; exit 1; }

need_root() {
    if [[ $EUID -ne 0 ]]; then
        error "This operation requires root privileges."
    fi
}

########################################
# Verify Repository
########################################

if [[ ! -f "$PROJECT_DIR/package.json" ]]; then
    error "package.json not found. Run installer from project root."
fi

########################################
# Check Git Status
########################################

if command -v git >/dev/null 2>&1; then
    if git rev-parse --git-dir >/dev/null 2>&1; then
        log "Checking repository status..."

        git remote update >/dev/null 2>&1 || true

        LOCAL=$(git rev-parse @)
        REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "")

        if [[ -n "$REMOTE" ]] && [[ "$LOCAL" != "$REMOTE" ]]; then
            warn ""
            warn "Your repository appears behind origin."
            warn "Recommended:"
            warn ""
            warn "  git pull"
            warn ""
        fi
    fi
fi

########################################
# NodeJS Installation
########################################

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    log "NodeJS already installed."
else
    log "NodeJS not detected."
    need_root
    pacman -Sy --noconfirm nodejs npm
fi

########################################
# Install Dependencies
########################################

log "Installing npm dependencies..."

npm install

chmod +x zboe.sh menus/*.sh 2>/dev/null || true

########################################
# Reverse Proxy Detection
########################################
# If an httpd is already on this machine, print a ready-to-paste proxy
# snippet for it. The full walkthrough (vhost files, module enabling,
# HTTPS/cookie notes) lives in INSTALL.md.

HOSTNAME="$(hostname -f 2>/dev/null || hostname)"
PORT="${PORT:-$DEFAULT_PORT}"

proxy_hints() {
    local found=0

    if command -v nginx >/dev/null 2>&1; then
        found=1
        cat <<EOF

Detected httpd: nginx
  Proxy zboe2 through it with a server block like (/etc/nginx/conf.d/zboe.conf):

    server {
        listen 80;
        server_name zboe.example.com;
        location / {
            proxy_pass http://127.0.0.1:$PORT;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }
    }

  Apply with: nginx -t && sudo systemctl reload nginx
EOF
    fi

    if command -v httpd >/dev/null 2>&1 || command -v apachectl >/dev/null 2>&1; then
        found=1
        cat <<EOF

Detected httpd: Apache (httpd)
  Uncomment mod_proxy + mod_proxy_http in /etc/httpd/conf/httpd.conf:

    LoadModule proxy_module modules/mod_proxy.so
    LoadModule proxy_http_module modules/mod_proxy_http.so

  Then add a vhost:

    <VirtualHost *:80>
        ServerName zboe.example.com
        ProxyPreserveHost On
        ProxyPass        / http://127.0.0.1:$PORT/
        ProxyPassReverse / http://127.0.0.1:$PORT/
    </VirtualHost>

  Apply with: sudo systemctl reload httpd
EOF
    fi

    if [ "$found" -eq 0 ]; then
        echo
        echo "No Apache/nginx detected. If you add one later, INSTALL.md has"
        echo "ready-made proxy configs for both."
    fi

    echo
    echo "Full reverse-proxy + HTTPS walkthrough: INSTALL.md"
}

########################################
# Summary
########################################

echo
echo "========================================="
echo "ZBOE2 Installation Complete"
echo "========================================="
echo
echo "The server backgrounds itself — no system service is installed."
echo
echo "Start (background, writes logs/zboe.pid):"
echo "  node server.js"
echo
echo "Start (attached, live colorized console):"
echo "  node server.js --verbose"
echo
echo "Stop:"
echo "  node server.js --stop"
echo
echo "Web Interface:"
echo "  http://$HOSTNAME:$PORT"
echo
echo "Management (dialog TUI: server/users/players/database/logs):"
echo "  ./zboe.sh"

proxy_hints

echo
echo "Next Steps:"
echo "  1. Set game_config.sessionSecret in config.js (the 'changeme' default"
echo "     refuses to start outside dev mode)."
echo "  2. Run './zboe.sh' and create your first administrator account."
echo "  3. Full install/proxy/HTTPS guide: INSTALL.md"
echo
