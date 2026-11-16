# Multiple browser frontend origins

Configure BROWSER_SESSION_ORIGINS as a comma-separated list of exact frontend origins:

```ini
BROWSER_SESSION_ORIGINS=https://app.example.com,https://dev.example.com,https://localhost:5173
```

These are placeholders, not deployed URLs. The nonempty plural setting takes precedence over BROWSER_SESSION_ORIGIN. Existing singular configurations remain supported. Whitespace around entries is trimmed and duplicates removed. Paths, trailing slashes, query strings, credentials, wildcards and empty entries are rejected. Each origin includes its scheme and non-default port.

All origins on a production backend require HTTPS, including local development. Use a trusted local HTTPS Vite server when testing against that backend. HTTP is retained only for loopback-only nonproduction configurations. Mixed HTTP/HTTPS is rejected rather than silently downgrading the shared Secure cookie policy.

This remains a same-origin BFF architecture, not credentialed cross-origin CORS. Each frontend must proxy /api/v1/browser to the backend, preserving the browser's Origin and Fetch Metadata. Vite's development proxy does not deploy with the build; configure the equivalent external rewrite in Vercel. Do not call the remote API directly or rewrite Origin to bypass validation. Cookies remain host-only, HttpOnly, Secure for HTTPS, SameSite=Lax, Path=/; log in separately on each frontend origin. Unsafe requests still require an allowlisted Origin, JSON and CSRF token; cross-site Fetch Metadata and bearer headers remain rejected.

The allowlist permits frontend entry points; it does not isolate data or backend versions. A local UI pointed at the shared backend uses shared data and existing authorization. Use a separate backend/database for destructive tests or experimental backend behavior.

No live origins, keys, proxy configuration or deployment are changed by this implementation. Set the actual explicit origins in deployment configuration and restart only after review.
