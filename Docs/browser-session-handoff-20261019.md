# Verified local browser login handoff — 19 October 2026

The approved local BFF and frontend adapter are implemented and verified. All34
source files still match the recorded verification hashes. This handoff changes
documentation/packaging only; no additional feature implementation, production
migration, credential provisioning, deployment, push or Postman action is included.

## What Chrome actually exercised

The verification manifest contains **six checks**, executed within one main
browser scenario (including a second tab) and a separate expiry context. Earlier
shorthand calling these six journeys did not mean six independently isolated runs.

1. **Anonymous protected navigation redirects to sign-in.** Chrome navigated
   directly to `/setup`; the actual frontend bootstrapped the BFF and redirected
   to `/auth/sign-in`.
2. **Real sign-in through project/task/catalog/preflight to controlled session
   acceptance.** Chrome filled and submitted the actual username/password form,
   selected the fixture project, task and `openai::gpt-6-sol` model through the UI,
   entered a prompt and clicked Start. Actual BFF login, password verification,
   PostgreSQL records, current grants/resource checks, directory preflight and
   `POST /sessions` ran. The backend returned201 and the UI showed acceptance.
3. **Cookie fetch SSE receives sequenced controlled output and authoritative
   completion; REST agrees.** A browser-side fetch, executed by the test through
   the page, consumed the actual BFF SSE endpoint. It checked increasing persisted
   sequences, controlled assistant text and authoritative `session.state` COMPLETED.
   Chrome then clicked the UI's Check persisted status button and observed the
   REST-confirmed COMPLETED value. This does **not** claim a rendered output feed:
   the minimal page currently renders acceptance and persisted status only.
4. **HttpOnly local development cookie; no browser bearer header or persistent
   credentials.** Chrome verified HttpOnly/SameSite=Lax, that document.cookie could
   not read the session cookie, no browser Authorization request header, and empty
   localStorage/sessionStorage. The server kept access/refresh tokens.
5. **Browser logout removes protected access and clears the other tab.** A second
   tab shared the browser session. Clicking Sign out redirected both tabs; a
   subsequent cookie-based protected identity request returned401.
6. **Server idle expiry removes protected UI and denies subsequent cookie access.**
   A fresh browser context signed in with a synthetic5-second idle configuration,
   reached real setup, then returned to sign-in at expiry. Protected access
   subsequently returned401. This did not change production lifetimes/settings.

The main scenario received7 persisted events, started1 controlled generation,
made0 provider calls and recorded0 page errors. The separate context tested expiry
without starting another coding run.

## Real services versus controlled fixtures

Real: Chrome, frontend route/form/adapter, same-origin proxy, BFF, existing password
verification/JWT services, PostgreSQL transactions/migration, authorization guards,
workspace/resource checks, project/task/catalog services, directory checks,
session persistence, REST and SSE.

Synthetic: the isolated database's users/grants/project/task, temporary workspace
directory, random runtime-only password and signing/encryption keys. The runner
was deliberately replaced with an in-process controlled adapter emitting labelled
output and completion. No agent, shell, provider, Telegram or storage integration
started. This is an integration test of the real control plane, not evidence of
live model credentials or agent execution.

## Security verification and its limits

The16 new backend tests and5 frontend transport tests cover:

- Opaque cookie rotation; repeat bootstrap retains tab-compatible CSRF; no returned
  access/refresh values; cookie alone cannot authenticate original bearer routes.
- Exact-origin/JSON/CSRF enforcement, including foreign/missing/null Origin,
  forged browser Authorization, wrong CSRF and undeclared login fields.
- AES-GCM ciphertext binding to record/key; independent-key validation; production
  HTTP rejection. Production `__Host-`/Secure/HttpOnly/Path=/, no-Domain and Lax
  attributes were checked in a controlled HTTP response, not deployed TLS.
- Persisted idle/absolute deadlines, current OPEN status and bound workspace;
  another workspace cannot read the original task.
- One refresh under concurrent requests; refresh503 failure; logout serialized
  behind refresh cannot resurrect the browser. A storage failure rolls back newly
  issued refresh persistence; a store outage is503 rather than anonymous success.
- Browser-only logout revokes its bound refresh, preserves another browser and
  legacy bearer behavior, and closes an active SSE without interrupting the run.
- Explicit proxy allowlist, sequenced SSE/REST agreement and no idle extension
  through background reads/streaming; uncertain login is not replayed, late
  decoded responses are discarded, and uncertain logout clears protected exposure.

Source review also confirms fixed server-owned loopback upstream/header filtering,
15-second comment heartbeats and75-second upstream-idle closure. Those two long
timer durations were not timed end to end in this pass. A complete BFF reconnect/
recovery UI is not implemented; the existing backend reconnect regressions passed.

Validation: backend build/lint/typecheck and **1,285 tests /71 suites** passed;
frontend `pnpm check` passed **58 tests /12 suites**, including artifact/boundary/
locale/secret checks, and dependency audit found no known vulnerabilities. The
first full backend process exited with0xC0000409 before reporting results; the
retained clean retry passed. All175 exported operations have resolving schema refs.

## Integration readiness and remaining work

There is no remaining blocker to the controlled local login/setup slice once the
updated checkouts, installed dependencies/Chrome and retained isolated database
are available. The database and development server were stopped after verification;
cleanup confirmed0 BrowserSession rows and0 harness workspaces.

The portable ZIP is a documentation/contracts/evidence bundle, **not a standalone
application or a patch**. It requires the updated backend/frontend checkouts whose
34 files and hashes are listed in CHANGED-FILES.json.

Remaining boundaries:

- Production stays disabled. An operator must separately arrange same-origin TLS/
  routing, an independent managed encryption key with rotation policy, edge
  throttling and expired-row retention/pruning. No production TLS was exercised.
- Full session output/reconnect/recovery UI remains unfinished. The setup page is
  a minimal real surface, not the final product UI.
- Initial session-create receipts/idempotency remain a separate proposal. No
  implementation was started; uncertain initial submissions are not replayed.
- Activation/recovery temporary-grant transport remains unwired. Existing bearer
  JWTs retain their previous lifetime/revocation behavior.

## Changed files

17 backend files: four new browser-session module/config/controller/service files;
AppModule/AuthModule/AuthService wiring; additive Prisma model/migration and default
configuration; controlled harness/CLI/browser verifier and HTTP regression suite;
implementation/proposal/handoff documentation. The verification record is an
additional evidence artifact.

17 frontend files: same-origin transport and tests; sign-in adapter/public boundary/
uncertain-logout notice; auth/setup routes; minimal session-setup feature; three
locale catalogs; local Vite proxy configuration and ADR-003. No dependencies changed.
Exact file names and SHA256 values are in the verification record/CHANGED-FILES.json.
This delivery adds a handoff guide, packager and delivery receipts without changing
those34 implementation files.

## Safe local startup (PowerShell)

Prerequisites: updated sibling backend/frontend checkouts, Node24.20.0,
pnpm10.13.1, installed dependencies/Chrome and the **existing synthetic** PostgreSQL
cluster. Do not start AppModule, deploy.sh, a real runner or a production database.
Do not create a new database/user/key or change database trust settings here.

For this laptop, the retained cluster locator is the local Temp file
`proboxai-current-clean-root.txt`. Before starting it, resolve the path and verify
it remains beneath the user's Temp directory with a `proboxai-handoff-clean-`
directory name. Start only that verified cluster on127.0.0.1:55439. If it is absent
or ownership is unclear, stop and obtain an explicitly isolated test target.

In the backend terminal:

```powershell
Set-Location <BACKEND_CHECKOUT>
# Read only the exact allowlisted synthetic URL; this import starts no services.
$env:PROFILE_TEST_DATABASE_URL = node -e "require('ts-node').register({transpileOnly:true}); process.stdout.write(require('./test/support/frontend-session-harness.ts').fixtureDatabaseUrl)"
pnpm handoff:prepare
pnpm handoff:serve --browser-origin=http://127.0.0.1:5173
```

`handoff:prepare` rejects every other URL and never falls back to DATABASE_URL.
It applies migrations to the isolated fixture only. The server listens on3050,
creates runtime-only synthetic credentials and prints them for this local run.
Use those current values; do not save or distribute the terminal output.

In the frontend terminal:

```powershell
Set-Location <FRONTEND_CHECKOUT>
$env:BROWSER_BFF_LOCAL_TARGET = 'http://127.0.0.1:3050'
pnpm dev
```

Open `http://127.0.0.1:5173/auth/sign-in`. Login, choose the fixture project/task,
model/effort and a prompt, then Start session. The sandbox is read-only and the
runner remains controlled. Use Check persisted status for the real persisted result.

For automated browser verification, stop the manual backend fixture with Ctrl+C
first (keep the frontend running), then run from the backend:

```powershell
node scripts/verify-browser-session.mjs
```

The verifier owns port3050 and cleans its fixture on exit. Do not run it alongside
`handoff:serve`. On completion, stop the frontend and manual fixture with Ctrl+C,
then stop only the same verified synthetic PostgreSQL cluster. No persistent
browser-session key is needed: the fixture generates independent keys in memory.
