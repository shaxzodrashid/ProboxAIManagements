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

## Safety boundary

The API never accepts an executable path or shell command from a request. It
validates the requested session working directory against
`PROBOXAI_ALLOWED_WORKSPACE_ROOT` and invokes the configured `proboxai` binary
with `shell: false`.
