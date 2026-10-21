# Shared personal web/Telegram model preferences

Approved19 October: web and Telegram share personal provider/model/thinking-effort
preferences, while explicit project/session choices remain unchanged.

`GET /users/me/model-preferences` and `PUT /users/me/model-preferences` use the
authenticated self identity and current sessions.create permission, matching the
existing Telegram model panel and model catalogue. No new permission is created.
GET returns saved `{providerId,model,reasoningEffort}`, effective selection (or null
for invalid legacy values), valid, and catalogVersion. A missing row yields managed
defaults without writing. Invalid legacy values remain visible for deliberate
repair rather than silently resetting settings.

PUT accepts a complete managed-catalog triple and `expected`, the exact previously
read saved triple. All other fields and query selectors are rejected. Catalogue
validation enforces each provider/model's supported efforts. Value conflicts return
409 MODEL_PREFERENCES_CHANGED; reread after a conflict or uncertain response. This
is value comparison, not a historical revision/ABA guarantee or request receipt.

The existing TelegramConversation preference fields are the single storage source;
there is no asynchronous copy or two-channel synchronization. Only providerId,
model and reasoningEffort are written. ProjectId/sessionId selectors survive.
Workspace then subject User locks serialize REST saves with current Telegram
confirmation, grants and lifecycle; current authority is checked again at write.
Old Telegram drafts cannot overwrite a different web selection.

A new session with no explicit provider/model/effort fields resolves these personal
settings inside acceptance. If any selection field is explicit, the prior catalogue
resolution behavior wins as a whole; personal provider/effort are not mixed into an
explicit model choice. Saved sessions retain their original effective selection
and catalogue snapshot. No project/directory setting or existing run is rewritten.
Invalid legacy personal selection blocks only inherited creation until repaired;
explicit valid session selection remains usable.

The cookie BFF permits exactly GET/PUT users/me/model-preferences. PUT retains exact
Origin, JSON and current CSRF checks and never forwards browser credentials to an
arbitrary upstream. There is no schema migration, provider request, task creation,
authentication edit, initial-session retention policy or live settings change.
