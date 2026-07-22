# ProboxAI

NestJS control plane for authenticated, programmatic ProboxAI coding sessions.

## Programmatic runner contract

The server launches the configured `PROBOXAI_BIN` without a shell. Its command
shape is intentionally identical to the operator-facing contract:

```bash
proboxai exec --json --sandbox read-only -C /opt/apps/Test 'Reply with exactly: PROBOXAI_PROGRAMMATIC_CONTROL_OK'
```

Every JSONL frame is written to the session archive before it is published over
SSE and persisted in PostgreSQL with a hash-chain. The runner also records the
final binary Git diff and stderr stream.

## Local setup

1. Install the local `proboxai` command with `pnpm link --global`, then copy
   `.env.example` to `.env` and set a strong `JWT_SECRET`, Telegram values,
   and the VPS-specific `PROBOXAI_*` paths.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. In development, create and commit the initial migration with
   `pnpm prisma:migrate -- --name init`; deploy committed migrations on the VPS
   with `pnpm prisma:deploy`. Then create the initial pending administrator with
   `pnpm db:seed-admin`.
4. Configure the Telegram webhook to `POST /api/v1/telegram/webhook` with the
   configured secret token.
5. Run `pnpm start`.

The seeded administrator must verify their own Telegram contact before using
the Telegram-delivered OTP dashboard login flow.

## VPS configuration

Run the API as a dedicated, unprivileged `proboxai` user. The user must own the
application checkout, the permitted workspaces, and the session archive:

```bash
sudo useradd --system --create-home --home-dir /home/proboxai --shell /bin/bash proboxai
sudo install -d -o proboxai -g proboxai /opt/proboxai-api /opt/apps /var/lib/proboxai/archive
sudo install -d -o root -g proboxai -m 0750 /etc/proboxai
```

Place the checkout in `/opt/proboxai-api` and make the configured
`PROBOXAI_BIN` executable by the `proboxai` user. `PROBOXAI_BIN` should be an
absolute path on a VPS: services do not use an interactive shell and therefore
must not rely on shell aliases or a user-specific `PATH`.

Store secrets outside the checkout in `/etc/proboxai/proboxai.env` (owned by
`root:proboxai`, mode `0640`). Example production configuration:

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://proboxai:<strong-password>@127.0.0.1:5432/proboxai?schema=public
JWT_SECRET=<long-random-secret>
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
TELEGRAM_BOT_TOKEN=<bot-token>
TELEGRAM_WEBHOOK_SECRET=<random-webhook-secret>
PUBLIC_BASE_URL=https://proboxai.example.com
PROBOXAI_BIN=/usr/local/bin/proboxai
PROBOXAI_ARCHIVE_DIR=/var/lib/proboxai/archive
PROBOXAI_ALLOWED_WORKSPACE_ROOT=/opt/apps
PROBOXAI_RUNNER_TOKEN=<runner-token-if-required-by-the-cli>
BOOTSTRAP_ADMIN_PHONE=+998000000000
BOOTSTRAP_ADMIN_NAME=ProboxAI Administrator
```

`DATABASE_URL` should point at a database not exposed to the public internet.
Likewise, expose only the reverse proxy on ports 80/443; keep PostgreSQL and
the application port (`3000`) bound to the VPS loopback interface or private
network. Do not commit this file or reuse the development Docker credentials.

Deploy application dependencies and migrations as the service user:

```bash
sudo -u proboxai corepack pnpm install --frozen-lockfile
sudo -u proboxai corepack pnpm prisma:generate
sudo -u proboxai corepack pnpm build
sudo -u proboxai corepack pnpm prisma:deploy
sudo -u proboxai corepack pnpm db:seed-admin  # first deployment only
```

Create `/etc/systemd/system/proboxai.service` to keep the API running:

```ini
[Unit]
Description=ProboxAI API
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=proboxai
Group=proboxai
WorkingDirectory=/opt/proboxai-api
EnvironmentFile=/etc/proboxai/proboxai.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Enable it after each deployment:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now proboxai
sudo systemctl status proboxai
```

Terminate TLS at Nginx and proxy the public hostname to the local API. Disable
proxy buffering so browser clients receive session events immediately:

```nginx
server {
    listen 443 ssl http2;
    server_name proboxai.example.com;

    # Configure the certificate paths supplied by your TLS provider here.
    ssl_certificate /etc/letsencrypt/live/proboxai.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/proboxai.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600;
    }
}
```

Use `https://proboxai.example.com/api/v1/telegram/webhook` as the Telegram
webhook URL and provide the same value as `TELEGRAM_WEBHOOK_SECRET` when
registering the webhook. Check `journalctl -u proboxai -f` for service logs;
session JSONL, stderr, and final Git diffs are retained under
`/var/lib/proboxai/archive`.

## Safety boundary

The API never accepts an executable path or shell command from a request. It
validates the requested session working directory against
`PROBOXAI_ALLOWED_WORKSPACE_ROOT` and invokes the configured `proboxai` binary
with `shell: false`.
