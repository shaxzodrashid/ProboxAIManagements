// Explicit allowlist, portable copies only. Never includes .env, raw logs, history or runtime credentials.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = resolve(import.meta.dirname, ".."),
  stage = mkdtempSync(join(tmpdir(), "proboxai-portable-handoff-"));
const read = (name) => readFileSync(join(root, name), "utf8");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const ids = new Map();
const identityKeys = new Set([
  "username",
  "phoneNumber",
  "firstName",
  "lastName",
  "fullName",
  "displayName",
  "bio",
  "birthDate",
  "email",
  "telegramUserId",
  "telegramChatId",
]);
const credentialKeys = new Set([
  "accessToken",
  "refreshToken",
  "temporaryToken",
  "password",
  "passwordConfirmation",
  "passwordHash",
  "tokenHash",
]);
function clean(value, key = "") {
  if (value === null) return null;
  if (credentialKeys.has(key) && typeof value !== "object")
    return "<credential omitted>";
  if (identityKeys.has(key) && typeof value !== "object")
    return "<synthetic identity omitted>";
  if (["log", "databaseLog"].includes(key))
    return "<local-only log omitted; original digest retained>";
  if (key === "snippet")
    return "<raw database log omitted; original digest retained>";
  if (typeof value === "string") {
    if (/^[A-Za-z]:[\\/]/.test(value)) return "<fixture directory omitted>";
    return value
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        (id) => {
          if (!ids.has(id)) ids.set(id, `<fixture-id-${ids.size + 1}>`);
          return ids.get(id);
        },
      )
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email omitted>")
      .replace(/\+\d[\d ()-]{7,}/g, "<phone omitted>");
  }
  if (Array.isArray(value)) return value.map((v) => clean(v));
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "displayName" &&
        (Array.isArray(value.models) ||
          Array.isArray(value.supportedReasoningEfforts))
          ? v
          : clean(v, k),
      ]),
    );
  return value;
}
const write = (name, data) => {
  const target = join(stage, name);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(
    target,
    typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n",
  );
};
const original = JSON.parse(read("Docs/api/frontend-session-examples.json"));
if (
  original.mode !== "CONTROLLED_LOCAL_FIXTURE_CAPTURE" ||
  original.providerCalls !== 0 ||
  original.examples.length !== 23
)
  throw new Error("Unexpected capture provenance");
function assertSynthetic(value, key = "") {
  if (
    key === "username" &&
    typeof value === "string" &&
    !value.startsWith("handoff-")
  )
    throw new Error("Non-fixture identity");
  if (
    key === "phoneNumber" &&
    typeof value === "string" &&
    !value.startsWith("fixture-")
  )
    throw new Error("Non-fixture contact");
  if (
    key === "prompt" &&
    typeof value === "string" &&
    !/controlled|fixture|changed input/i.test(value)
  )
    throw new Error("Non-fixture prompt");
  if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) assertSynthetic(v, k);
}
assertSynthetic(original);
const examples = clean(original);
examples.portableNote =
  "All identity, credential, UUID and machine-directory values are omitted/placeholders. Use the current runtime fixture manifest; this archive contains no working account credentials.";
write("Docs/api/frontend-session-examples.json", examples);
write(
  "Docs/api/frontend-session-readiness.json",
  clean(JSON.parse(read("Docs/api/frontend-session-readiness.json"))),
);
write(
  "review/lock-order-review.json",
  clean(JSON.parse(read("Docs/session-lock-order-review.json"))),
);
function schemaCopy(value) {
  if (Array.isArray(value)) return value.map(schemaCopy);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !["example", "examples"].includes(k))
        .map(([k, v]) => [k, schemaCopy(v)]),
    );
  return value;
}
write(
  "Docs/api/openapi.json",
  clean(schemaCopy(JSON.parse(read("Docs/api/openapi.json")))),
);
write(
  "Docs/api/endpoints.json",
  clean(JSON.parse(read("Docs/api/endpoints.json"))),
);
const collection = {
  info: {
    name: "ProboxAI controlled frontend local reference",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    description:
      "Offline templates only. Do not bulk-run against live data or upload/import into an existing cloud workspace. All credentials/identities are unset. The separate JSON contains 23 verified controlled examples.",
  },
  variable: [
    { key: "base_url", value: "http://127.0.0.1:3050/api/v1" },
    { key: "access_token", value: "" },
  ],
  item: examples.examples.map((e) => ({
    name: e.name,
    request: {
      method: e.request.method,
      url:
        "{{base_url}}" +
        e.request.path.replace(/<fixture-id-(\d+)>/g, "{{fixture_id_$1}}"),
      auth: e.request.authenticated
        ? {
            type: "bearer",
            bearer: [
              { key: "token", value: "{{access_token}}", type: "string" },
            ],
          }
        : { type: "noauth" },
      header: e.request.body
        ? [{ key: "Content-Type", value: "application/json" }]
        : [],
      ...(e.request.body
        ? {
            body: {
              mode: "raw",
              raw: JSON.stringify(e.request.body, null, 2),
              options: { raw: { language: "json" } },
            },
          }
        : {}),
    },
  })),
};
write("Docs/api/postman-local.collection.json", collection);
let guide = read("Docs/frontend-session-handoff.md");
guide = guide.replaceAll(
  "(session-lock-order-review.json)",
  "(../review/lock-order-review.json)",
);
const first = guide.indexOf("```powershell"),
  last = guide.indexOf("```", first + 3);
guide =
  guide.slice(0, first) +
  `\`\`\`powershell
# Requires the current backend checkout with this handoff's local changes.
$env:PROFILE_TEST_DATABASE_URL='postgresql://profile_test@127.0.0.1:55439/profile_test'
# Start your isolated loopback PostgreSQL instance, then:
pnpm handoff:prepare
pnpm handoff:verify
pnpm handoff:serve
\`\`\`` +
  guide.slice(last + 3);
guide = guide.replace(
  /- \[Lifecycle integration tests\][\s\S]*?isolation, denial and dependency failures before execution\./,
  "- [Lock-path review](../review/lock-order-review.json) and verification evidence record regression coverage. Source tests remain in the backend checkout under test/frontend-session-journey.http.spec.ts and test/login-session-setup.http.spec.ts.",
);
guide = guide.replace(
  /with the same `pg_ctl -D \.\.\. stop -m fast -w` command\./,
  "using your isolated PostgreSQL data directory; never stop a production service.",
);
write("Docs/frontend-session-handoff.md", guide);
write(
  "README.md",
  `# ProboxAI frontend session handoff

Start with [the guide](Docs/frontend-session-handoff.md), [23 sanitized examples](Docs/api/frontend-session-examples.json), [verification evidence](Docs/api/frontend-session-readiness.json), and [lock-order review](review/lock-order-review.json).

The full local OpenAPI, endpoint inventory and an offline request collection are included under Docs/api. All credentials and identity values are omitted/placeholders. The collection is not authorized for live execution or cloud synchronization.

This is a portable documentation/contract bundle, not a standalone backend repository. The runnable commands require the current backend checkout with its handoff scripts, helper and local session lock fixes. No environment file, working credential, personal contact data, raw database log, Git history or native executable is included.

Local controlled API development can proceed now. Production browser-session policy remains pending; unknown initial-create outcomes must not be automatically resubmitted. No paid provider or deployed environment was used.
`,
);
write("evidence/verification-summary.json", {
  provenance:
    "Source-generated local contracts and controlled synthetic HTTP captures only",
  captures: 23,
  providerCalls: 0,
  originalCaptureSha256: sha(read("Docs/api/frontend-session-examples.json")),
  redaction: {
    credentials: true,
    identityValues: true,
    uuidValues: true,
    machineDirectories: true,
    schemaExamplesRemoved: true,
  },
  review:
    "See lock-order-review.json for paths, discovered heartbeat omission and bounded coverage",
  notIncluded: [
    "environment files",
    "raw logs",
    "runtime manifest",
    "database contents",
    "Git metadata",
    "working credentials",
    "personal data",
  ],
});
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(directory, e.name))
      : [join(directory, e.name)],
  );
}
const checks = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
  /Synthetic-Handoff-42!/,
  /[A-Za-z]:[\\/]Users[\\/]/,
  /Shakhzod/i,
  /\+998[0-9]{9}/,
];
const entries = files(stage).map((file) => {
  const data = readFileSync(file),
    text = data.toString();
  for (const check of checks)
    if (check.test(text))
      throw new Error("Portable content scan failed: " + relative(stage, file));
  return {
    path: relative(stage, file).replaceAll("\\", "/"),
    bytes: data.length,
    sha256: sha(data),
  };
});
write("MANIFEST.json", {
  files: entries,
  scanPassed: true,
  provenanceValidated: true,
  credentialsAndIdentitiesOmitted: true,
});
mkdirSync(join(root, "artifacts"), { recursive: true });
const archive = join(
  root,
  "artifacts",
  `ProboxAI-frontend-session-handoff-${Date.now()}.zip`,
);
const python = process.env.HANDOFF_PYTHON;
if (!python)
  throw new Error(
    "Set HANDOFF_PYTHON to an installed Python3 executable for standard-library ZIP creation",
  );
const code = `import sys,zipfile,pathlib,json,hashlib
stage=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(stage.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(stage).as_posix())
with zipfile.ZipFile(target) as z:
 assert z.testzip() is None
 manifest=json.loads(z.read('MANIFEST.json'))
 for f in manifest['files']:
  assert hashlib.sha256(z.read(f['path'])).hexdigest()==f['sha256']
 assert all(not n.startswith('/') and '..' not in pathlib.PurePosixPath(n).parts for n in z.namelist())
 print(json.dumps({'zipEntries':len(z.namelist()),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size}))
`;
const result = JSON.parse(
  execFileSync(python, ["-c", code, stage, archive], {
    encoding: "utf8",
    windowsHide: true,
  }),
);
const receipt = { file: archive, stage, ...result, scanPassed: true };
writeFileSync(
  join(root, "Docs/api/frontend-session-package.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify(receipt));
