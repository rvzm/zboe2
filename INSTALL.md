# Installing zboe2

zboe2 is a NodeJS/Express app with no build step. It listens on `PORT` (default
3000) and manages its own background lifecycle — there is no systemd unit to
install.

## Requirements

- NodeJS 20+ and npm
- `dialog` (optional — only needed for the `./zboe.sh` admin TUI)
- A reverse proxy (optional — see below) if you want it on ports 80/443

## Quick install

From the project root:

```bash
./install-arch.sh      # Arch Linux (pacman)
./install-ubuntu.sh    # Ubuntu / Debian (apt)
```

Either script installs NodeJS if missing, runs `npm install`, and prints a
summary — including a reverse-proxy snippet if it detects Apache or nginx on
the machine.

Manual equivalent:

```bash
npm install
```

## Configure before first run

All settings live in `config.js`:

- **`game_config.sessionSecret` — required.** While it's the default
  `'changeme'`, non-dev runs refuse to start (dev runs warn). Set it to a long
  random string.
- `app_version`, log/db filenames, zombie tuning (`zombie_config`), and the
  rest are documented inline in the file.
- Any value can be overridden for a single run:
  `node server.js --set game_config.timeout=15`

Environment overrides: `PORT`, `DB_PATH`.

## Running

```bash
node server.js            # start in the BACKGROUND (writes logs/zboe.pid)
node server.js --verbose  # stay attached as a live colorized console
node server.js --stop     # stop the backgrounded server
node server.js --dev --mock-db   # dev run seeded with admin/player1/player2
./zboe.sh                 # dialog TUI: server/users/players/database/logs
```

The first visit is `http://<host>:3000/` — register an account, then grant it
admin from the TUI (`User Management`) or CLI:

```bash
node util/index.mjs users setadmin <name> 1
```

## Reverse proxy (Apache / nginx)

zboe2 serves plain HTTP on `127.0.0.1:3000`. To put it behind your httpd on
port 80/443, proxy everything straight through — there are no special paths,
websockets, or rewrites to worry about (the game page polls over normal HTTP).

### nginx

Create a server block (Ubuntu/Debian: `/etc/nginx/sites-available/zboe.conf`
+ symlink into `sites-enabled/`; Arch: `/etc/nginx/conf.d/zboe.conf`):

```nginx
server {
    listen 80;
    server_name zboe.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then:

```bash
nginx -t && sudo systemctl reload nginx
```

### Apache

Enable the proxy modules, then add a vhost.

Ubuntu/Debian:

```bash
sudo a2enmod proxy proxy_http
# vhost: /etc/apache2/sites-available/zboe.conf, then: sudo a2ensite zboe
```

Arch (`httpd`): uncomment these in `/etc/httpd/conf/httpd.conf`:

```apache
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
```

The vhost (either distro):

```apache
<VirtualHost *:80>
    ServerName zboe.example.com

    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
</VirtualHost>
```

Then reload (`sudo systemctl reload apache2` / `sudo systemctl reload httpd`).

### HTTPS

Two options:

**Native TLS (no proxy needed).** Point `ssl_config` in `config.js` at a PEM
cert/key and enable it:

```js
export const ssl_config = {
  enabled: true,
  certFile: "/etc/letsencrypt/live/zboe.example.com/fullchain.pem",
  keyFile:  "/etc/letsencrypt/live/zboe.example.com/privkey.pem",
};
```

Relative paths resolve from the project root. All cookies automatically switch
to `Secure` when SSL is enabled. Misconfiguration (enabled but unreadable
files) is a FATAL at startup — the server never silently falls back to plain
HTTP. For a quick self-signed cert to test with:

```bash
mkdir -p certs   # gitignored
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout certs/server.key -out certs/server.crt -subj "/CN=localhost"
```

**Behind a proxy.** Put certificates on the proxy as usual (`certbot --nginx` /
`certbot --apache`) and proxy to the app over HTTP as shown above. Note the
app's cookies only carry `Secure` when `ssl_config.enabled` is true, so for an
HTTPS-only proxy setup either terminate TLS at the app anyway, or flip the
`secure:` values in `server.js` (`setSession()` and `issueServerSession()`)
by hand.

## Where things live

| Path | What |
|---|---|
| `data/zboe.sqlite` | the database (WAL mode; `DB_PATH` overrides) |
| `logs/server.log` | log file (3MB cap, rotates to `server.old.log`) |
| `logs/zboe.pid` | PID of the backgrounded server |
| `util/backups/` | DB backups (`zboe.sh` → Database Management) |

## Dev notes

This is a dev build: when the schema changes, delete `data/zboe.sqlite*` and
let the server recreate it on boot. See `CLAUDE.md` for the full architecture
notes and `changelog.md` for version history.
