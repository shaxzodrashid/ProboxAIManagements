# API07 self Telegram link status

Local implementation, 12 October 2026. This closes the independently defined stored-link read portion of API07. Relinking, unlinking, recovery authority and authentication/session-revocation policy remain undecided and unimplemented; API07 remains partial. No migration or new permission.

## Contract

`GET /api/v1/users/me/telegram-link` requires an access JWT and a current OPEN account, including accounts with zero permissions. Cache-Control is no-store. It accepts no query fields; identity/workspace selectors and unknown query options return 400. Identity and workspace come from persisted authentication, never request input. Its sole response property is:

```text
{linkState: NOT_LINKED | LINKED | INCOMPLETE}
```

This is a read of the existing verification record. `AccountsService.verifyTelegramContact` writes telegramUserId, telegramChatId and verifiedAt together after checking a matching PENDING account's self-shared contact in a private Telegram chat. The new read classifies those three stored fields:

- NOT_LINKED: all three are absent.
- LINKED: all three are present.
- INCOMPLETE: any partial combination; no repair or migration is inferred.

LINKED does not prove bot reachability, current Telegram ownership, OTP delivery, recovery eligibility, account online presence or permission to change the link. NOT_LINKED does not distinguish never-linked from externally cleared historical data. INCOMPLETE is an explicit stored-record inconsistency, not an invitation to retry registration, link another chat or bypass verification. No Telegram IDs, timestamps, phone numbers, usernames, bot tokens, deep links or credentials are returned.

Existing `GET /users/me` and `/authorization/me` shapes remain unchanged. There are no POST/PATCH/DELETE actions at this route, and no Telegram/API calls, OTP sends, work queues or writes. Repeated and concurrent reads are side-effect-free. Cancelling a client read cannot cancel or initiate any Telegram operation, because none is started; the read itself may finish after transport cancellation.

## Authorization, consistency and errors

The service repeats the OPEN/id/workspace check in the same single statement that selects the three fields. A workspace move or account closure after the authentication guard's earlier snapshot returns 404 from the service instead of exposing the old identity's record. Ordinary missing/expired authentication or non-OPEN accounts are rejected with 401 by the guard. Administrative users.read/users.manage grants do not turn this endpoint into another-account discovery.

The returned presence classification is coherent for that database statement. Existing contact verification writes the fields atomically; subsequent reads reflect subsequent committed changes. A concurrent later change does not alter an already-returned response. No durable capability or session-revocation guarantee is created. Unknown database failures retain the existing sanitized HTTP 500 response; credentials and raw database errors are not in its body.

## Verification and files

HTTP tests cover all eight field-presence combinations, zero-permission access, exact one-property JSON and no-store, BigInt identifier exclusion, unknown selectors/options, unsupported mutations, missing/expired auth, non-OPEN lifecycle, account/workspace changes after the guard, sanitized database failure, repeated/concurrent reads and explicit OpenAPI schemas. Isolated PostgreSQL verifies committed record changes, identifier-safe serialization, wrong-workspace/missing/non-OPEN rejection. Existing authentication and Telegram contact-verification regressions remain applicable. Final cumulative **510 tests / 43 suites passed**. Focused account/auth verification passed **57 tests / 4 suites**; the subsequent administrative race/profile check passed **53 tests / 3 suites**. TypeScript, ESLint, Prettier, Nest build and git diff checks passed. Final independent review found no outstanding actionable findings, including review of the unchanged race expectations with eager rejection handlers. The first cumulative run's late-handler failure was corrected and the complete suite rerun successfully; that failed run was not counted as passing.

Only localhost:55439/profile_test is used for persistence verification; its worker and provider integrations remain inactive and it is stopped afterwards. No schema change, live migration, production setting, Telegram message, commit, push or deployment. Prior cumulative work remains preserved and unstaged.

Files: src/accounts/telegram-link.dto.ts; accounts.controller.ts; accounts.service.ts; test/self-profile.spec.ts; self-profile.persistence.spec.ts; test/admin-concurrency.persistence.spec.ts; this report; README.md. The administrative race tests attach their unchanged ownership/role-deletion rejection assertions eagerly to avoid transient unhandled rejections. Parent owns the Space checklist. This contract does not establish that the full account-management UI or API07 recovery controls are ready.
