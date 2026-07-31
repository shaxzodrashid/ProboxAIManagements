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

Install dependencies with `pnpm install`. The install runs Husky's `prepare`
script and configures the repository's Git hooks automatically.

Every commit must pass the following checks:

- ESLint and Prettier checks for staged files.
- A full TypeScript typecheck, including tests.
- The complete Jest test suite.

Run the same gate manually with `pnpm precommit`. Fix reported issues and stage
the corrected files before committing again.

1. Install the local `proboxai` command with `pnpm link --global`, then copy
   `.env.example` to `.env` and set a strong `JWT_SECRET`, Telegram values,
   and the VPS-specific `PROBOXAI_*` paths.
2. Start PostgreSQL and MinIO with `docker compose up -d postgres minio`.
3. In development, create and commit the initial migration with
   `pnpm prisma:migrate -- --name init`; deploy committed migrations on the VPS
   with `pnpm prisma:deploy`. Then create the initial pending administrator with
   `pnpm db:seed-admin`.
4. Configure the Telegram webhook to `POST /api/v1/telegram/webhook` with the
   configured secret token.
5. Run `pnpm start`.

The seeded administrator must share their own phone contact with the Telegram
bot and then complete the platform registration flow described below.

## API reference

With the service running, the interactive OpenAPI reference is available at
`/api/v1/docs` (for example, `http://127.0.0.1:3000/api/v1/docs`). It documents
every public endpoint, validated request field, response schema, authorization
rule, status code, and project-path constraint. Use `POST /api/v1/auth/login` to
obtain an access token, then click **Authorize** and enter the token once to try
protected endpoints from the reference. Session event streaming is exposed
as `text/event-stream`; use an SSE client for that endpoint rather than Swagger's
standard request runner.

## User identity and authentication

Every user has a pre-registered full name and phone number, a role, and one of
four lifecycle states: `PENDING`, `OPEN`, `BANNED`, or `DELETED`. Administrators
create identities through `POST /api/v1/users`; new identities always start as
`PENDING`. A private self-contact shared with the Telegram bot links the Telegram
user and chat but deliberately leaves the identity pending. Only successful
platform registration creates a unique lowercase username, stores a scrypt
password hash, and changes the user to `OPEN`.

The identity migration preserves legacy Telegram links but moves legacy
`ACTIVE` users back to `PENDING`, because those users have no username/password
yet. Legacy suspended users become `BANNED`; legacy OTPs and session tokens are
invalidated during the migration.

Registration uses this ordered flow:

1. `POST /api/v1/auth/registration/otp/send` accepts `phoneNumber` and `locale`
   (`UZ`, `RU`, or `EN`). The phone must already be pre-created and linked to the
   Telegram bot. Telegram receives a formal localized message with the code
   hidden under a spoiler. The message states a one-minute validity period,
   while the backend keeps a five-minute technical window.
2. `POST /api/v1/auth/registration/otp/verify` accepts the phone and six-digit
   code. It returns a purpose-bound, single-use, 384-bit random temporary token
   valid for ten minutes.
3. `GET /api/v1/auth/usernames/availability?username=...` performs the quick
   case-insensitive availability check.
4. `POST /api/v1/auth/registration` accepts `username`, `password`, and
   `passwordConfirmation`; send the temporary token as a Bearer token. Passwords
   require 12–128 characters with uppercase, lowercase, number, and symbol, and
   cannot contain the username.

`POST /api/v1/auth/login` accepts username and password and returns a JWT access
token valid for 30 minutes plus an opaque random refresh token valid for 30 days.
`POST /api/v1/auth/refresh` accepts the refresh token and returns only a new
access token; it does not rotate the refresh token. Access authorization checks
the persisted user state, so banning or deleting an account blocks an already
issued access JWT immediately. `POST /api/v1/users/:id/ban` bans an identity,
and `DELETE /api/v1/users/:id` performs an auditable soft deletion; both revoke
all stored session tokens.

Password recovery follows the equivalent
`password-reset/otp/send` → `password-reset/otp/verify` → `password-reset`
sequence under `/api/v1/auth`. The final request accepts only `password` and
`passwordConfirmation`, uses its own purpose-bound temporary Bearer token, and
revokes every refresh token after changing the password.

## VPS configuration

Run the API as a dedicated, unprivileged `proboxai` user. The user must own the
application checkout, the permitted workspaces, and the session archive:

```bash
sudo useradd --system --create-home --home-dir /home/proboxai --shell /bin/bash proboxai
sudo install -d -o proboxai -g proboxai /opt/proboxai-api /opt/apps /opt/marketing /var/lib/proboxai/archive /var/lib/proboxai/template-uploads
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
TELEGRAM_BOT_TOKEN=<bot-token>
TELEGRAM_WEBHOOK_SECRET=<random-webhook-secret>
PUBLIC_BASE_URL=https://proboxai.example.com
PROBOXAI_BIN=/usr/local/bin/proboxai
PROBOXAI_ARCHIVE_DIR=/var/lib/proboxai/archive
PROBOXAI_ALLOWED_WORKSPACE_ROOTS=/opt/apps,/opt/marketing
PROBOXAI_PROJECTS_HOME=/opt/apps
PROBOXAI_PROJECT_UPLOAD_MAX_BYTES=104857600
MINIO_ENDPOINT=http://127.0.0.1:9000
MINIO_REGION=us-east-1
MINIO_TEMPLATE_BUCKET=proboxai-configuration-templates
MINIO_ACCESS_KEY=<bucket-scoped-access-key>
MINIO_SECRET_KEY=<bucket-scoped-secret-key>
MINIO_FORCE_PATH_STYLE=true
MINIO_AUTO_CREATE_BUCKET=false
PROBOXAI_TEMPLATE_FILE_MAX_BYTES=104857600
PROBOXAI_TEMPLATE_TOTAL_MAX_BYTES=1073741824
PROBOXAI_TEMPLATE_SHELL=/bin/bash
PROBOXAI_TEMPLATE_COMMAND_OUTPUT_MAX_BYTES=1048576
PROBOXAI_UPLOAD_TEMP_DIR=/var/lib/proboxai/template-uploads
PROBOXAI_RUNNER_TOKEN=<runner-token-if-required-by-the-cli>
# Required only when managed sessions use an Anthropic model.
ANTHROPIC_API_KEY=<anthropic-api-key>
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

Managed coding sessions never accept a runner executable from an API request.
They validate the requested working directory against
`PROBOXAI_ALLOWED_WORKSPACE_ROOTS` and invoke the configured `proboxai` binary
with `shell: false`. Configuration-template commands are a separate,
administrator-only automation facility. Structured commands also use
`shell: false`; shell commands use the fixed server-configured Bash path. Both
run with a sanitized environment that excludes database, JWT, Telegram, and
MinIO secrets. Managed coding sessions receive only their runtime variables,
the optional runner token, and `ANTHROPIC_API_KEY` when configured so an
explicitly selected Anthropic model can authenticate. Do not add other provider
or plugin credentials to this allowlist without a demonstrated managed-session
requirement and a separate review.

## Projects

Projects are workspace-scoped directories managed by the API and assigned to a
department. The migration creates a default IT department using the previous
projects home. Administrators can add Marketing or other departments with an
independent absolute home:

```http
POST /api/v1/departments
Content-Type: application/json

{
  "name": "Marketing",
  "homePath": "/opt/marketing"
}
```

The path may be absent. The service validates its nearest existing ancestors,
rejects symlinks and paths outside the root allowlist, creates it recursively,
and verifies read/write/execute access before saving the department. Existing
directories are accepted; regular files at the requested path are rejected. A
department home cannot move after its first project. The deprecated
`GET/PUT /api/v1/settings/projects-home` endpoints continue to address the
default department during the v1 compatibility window.

Creating a project through `POST /api/v1/projects` accepts `departmentId` and
an optional `configurationTemplateId`. Omitting `departmentId` uses the default
IT department. Empty projects are ready immediately. Templated projects return
in `INITIALIZING` status and expose their latest persisted initialization attempt.
If the target directory already exists, the first create request returns `409`
with `code: "PROJECT_DIRECTORY_EXISTS"` and the available confirmation values.
Resubmit the same request with `existingDirectoryAction: "KEEP"` to register the
existing directory without changing its contents, or `"CLEAR"` to permanently
remove all of its contents before creation while retaining the directory. `KEEP`
is intentionally unavailable with a configuration template because templates
are atomically materialized into a fresh directory; choose `CLEAR` to apply one.
A project member or administrator can manage its settings, members, folders,
uploads, moves, initialization cancellation, and clean retries.
Other workspace accounts can list and download files only when that project's
`readAccessEnabled` setting is true. To prevent accidental orphaning of project
files, the home cannot be switched to a different path after the workspace has
created a project.

Available project operations are `GET/POST /projects`, `GET/PUT /projects/:id`,
`POST/DELETE /projects/:id/members`, `GET /projects/:id/files`,
`POST /projects/:id/folders`, `POST /projects/:id/files/upload`,
`POST /projects/:id/files/move`, and `GET /projects/:id/files/download`.
All filesystem paths are project-relative. Traversal paths and symbolic links
are rejected, uploads cannot overwrite an existing file, and the upload limit
defaults to 100 MiB (configurable through `PROBOXAI_PROJECT_UPLOAD_MAX_BYTES`).

### Secure deletion

Each project can maintain a case-insensitive list of protected file extensions
through `/projects/:id/protected-file-types`. Members, the owner, and workspace
administrators may append an extension; only the immutable project owner (the
project creator) may change or remove one. Deleting an unprotected file or
folder moves it into the private project trash for 30 days. A protected file,
or a folder containing one, first creates a five-minute confirmation request;
the separate confirmation endpoint rechecks the target before moving it to
trash. Trash is intentionally hidden from normal file APIs and can be listed
and restored by members or administrators.

Permanent project deletion is intentionally owner-controlled. A member may
create a deletion request, but the owner must approve it. The service checks
initialization and active sessions whose `cwd` is inside the project; the owner
can wait or request an interruption. Once safe, the owner receives a one-time
Telegram token valid for ten minutes and with five attempts. Submitting that
token permanently removes the project directory and its trash. Session records,
events, and artifacts are preserved as historical data because they are not
deleted with the project. Project deletion audit records remain available to
operators while the private quarantine purge is retried.

### Privileged creation of new `/opt` roots

The API normally creates department paths as the unprivileged service user. If
an exact allowlisted root such as `/opt/marketing` does not exist and `/opt` is
not writable, install the included helper as a root-owned executable and give
the service account access only to that helper:

```bash
sudo install -o root -g root -m 0755 scripts/proboxai-create-home.sh /usr/local/libexec/proboxai-create-home
printf '%s\n' /opt/apps /opt/marketing | sudo tee /etc/proboxai/allowed-workspace-roots >/dev/null
sudo chown root:root /etc/proboxai/allowed-workspace-roots
sudo chmod 0644 /etc/proboxai/allowed-workspace-roots
echo 'proboxai ALL=(root) NOPASSWD: /usr/local/libexec/proboxai-create-home *' | sudo tee /etc/sudoers.d/proboxai-home-provisioner >/dev/null
sudo chmod 0440 /etc/sudoers.d/proboxai-home-provisioner
```

Then set this server-owned environment value:

```dotenv
PROBOXAI_HOME_PROVISIONER_COMMAND='["/usr/bin/sudo","-n","/usr/local/libexec/proboxai-create-home"]'
```

The helper independently validates the requested path against its root-owned
allowlist and rejects symbolic links before creating anything.

## Configuration templates

Configuration templates belong to one department. Administrators create a
template, edit its draft manifest, upload files to exact project-relative paths,
and publish an immutable version. Published versions can only be changed by
cloning them into a new draft. Managers can list and select published templates
when creating projects but cannot modify them.

Template uploads are spooled to `PROBOXAI_UPLOAD_TEMP_DIR` and streamed into
private MinIO objects, with PostgreSQL metadata and SHA-256 verification. The
temporary upload is always removed after the request. The default limits are
100 MiB per file and 1 GiB per version, so a 16-document brand-book package is
supported without a special-case cap.
Folders must be declared explicitly; every file parent and command working
directory must match a declared folder.

Commands are organized into ordered stages. A `SEQUENTIAL` stage runs one
command at a time. A `PARALLEL` stage runs with a bounded concurrency limit and
waits for every command before the next stage begins. Commands are either a
structured executable/argument array or an administrator-authored Bash script.
Each command has a project-relative working directory and timeout.

## Project initialization lifecycle

Templated project creation queues a PostgreSQL-backed initialization job. The
worker validates the published manifest, creates folders in same-filesystem
staging, downloads and verifies MinIO objects, executes command stages, and
atomically renames staging into the final department home. File APIs return
`409` until the project is `READY`.

Job status, ordered steps, bounded stdout/stderr, exit codes, failures, and
sequenced events are persisted. REST replay and SSE streaming are available
under `/api/v1/projects/:projectId/initializations`. Cancellation terminates
active process groups. Failed, cancelled, timed-out, or restart-interrupted
attempts quarantine staging and require an explicit clean retry; queued work
continues after restart.
