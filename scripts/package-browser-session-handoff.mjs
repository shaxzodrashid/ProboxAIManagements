// Documentation/evidence only. Never reads .env, raw logs, runtime credentials or Git history.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const evidence = JSON.parse(
  read("Docs/browser-session-verification-20261019.json"),
);
let checked = 0;
for (const [kind, rows] of Object.entries(evidence.source.sourceFiles)) {
  const base =
    kind === "backend" ? root : resolve(root, "../ProboxAI_Frontend");
  for (const row of rows) {
    assert.equal(
      sha(readFileSync(join(base, row.file))),
      row.sha256,
      `Source drift: ${kind}/${row.file}`,
    );
    checked++;
  }
}
assert.equal(checked, 34);
assert.equal(evidence.validation.browser.checks.length, 6);
assert.equal(evidence.validation.browser.providerCalls, 0);
assert.equal(evidence.validation.backend.fullTests.passed, 1285);
assert.equal(evidence.validation.frontend.tests, 58);

const exported = JSON.parse(read("dist/browser-session-contract/openapi.json"));
const paths = Object.fromEntries(
  Object.entries(exported.paths).filter(([path]) =>
    [
      "/api/v1/browser/session",
      "/api/v1/browser/login",
      "/api/v1/browser/logout",
    ].includes(path),
  ),
);
assert.equal(Object.keys(paths).length, 3);
const schemas = {};
function references(value) {
  if (!value || typeof value !== "object") return;
  if (value.$ref) {
    assert(value.$ref.startsWith("#/components/schemas/"));
    const name = value.$ref.split("/").at(-1);
    if (!schemas[name]) {
      assert(exported.components.schemas[name], name);
      schemas[name] = structuredClone(exported.components.schemas[name]);
      references(schemas[name]);
    }
  }
  for (const child of Object.values(value)) references(child);
}
references(paths);
function portableSchema(value, key = "") {
  if (!value || typeof value !== "object") return;
  if (Object.hasOwn(value, "example")) {
    if (
      /password|token|secret|username|phone|email|fullname|firstname|lastname|displayname/i.test(
        key,
      )
    )
      value.example = `<${key.toUpperCase()}>`;
  }
  for (const [name, child] of Object.entries(value))
    portableSchema(child, name);
}
portableSchema(schemas);
const spec = {
  openapi: exported.openapi,
  info: {
    title: "ProboxAI locally verified browser login contract",
    version: exported.info.version,
    description:
      "Source-derived cookie endpoints only. Disabled by default; deployment unverified. Guarded proxy contracts remain owned by the original backend endpoints. Example credentials are placeholders.",
  },
  paths,
  components: { schemas },
};

const portableEvidence = structuredClone(evidence);
delete portableEvidence.communication;
delete portableEvidence.source.protectedOriginalHashes;
portableEvidence.migration.database =
  "Explicit isolated loopback synthetic database only; obtain its allowlisted URL from the updated checkout";
const stage = mkdtempSync(join(tmpdir(), "proboxai-bff-portable-"));
const entries = [];
function sanitize(text) {
  return text.replaceAll(
    "postgresql://profile_test@127.0.0.1:55439/profile_test",
    "<ISOLATED_FIXTURE_DATABASE_URL>",
  );
}
function write(name, value) {
  assert(/^[A-Z][A-Z0-9-]*\.(md|json)$/.test(name), name);
  const content = sanitize(
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
  );
  const scans = [
    /[A-Za-z]:[\\/]Users[\\/]/,
    /[A-Za-z]:[\\/]Shakhzod[\\/]/i,
    /Shakhzod/i,
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}/,
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
    /postgres(?:ql)?:\/\/[^\s"<>]+@/i,
    /\+998[0-9]{9}/,
    /https?:\/\/[^\s"<>]+:[^\s/@"<>]+@/i,
  ];
  for (const pattern of scans)
    assert(!pattern.test(content), `Sanitization failed: ${name}`);
  const data = Buffer.from(content);
  writeFileSync(join(stage, name), data, { flag: "wx" });
  entries.push({ path: name, bytes: data.length, sha256: sha(data) });
}
write("README.md", read("Docs/browser-session-handoff-20261019.md"));
write(
  "IMPLEMENTATION.md",
  read("Docs/browser-session-local-implementation.md"),
);
write("VERIFICATION.json", portableEvidence);
write("BROWSER-CHECKS.json", evidence.validation.browser);
write("BROWSER-OPENAPI.json", spec);
write("CHANGED-FILES.json", {
  checkedSourceFiles: checked,
  requiresUpdatedCheckouts: true,
  standaloneApplication: false,
  sourceFiles: evidence.source.sourceFiles,
});
write("MANIFEST.json", {
  files: [...entries],
  scanPassed: true,
  sourceHashesVerified: checked,
  bundleType:
    "Sanitized documentation/contracts/evidence; not application source or a patch",
  omitted: [
    "working credentials and token values",
    "environment files",
    "raw logs and screenshots",
    "personal absolute paths",
    "Git data and database files",
    "application source and dependencies",
  ],
});

const python = process.env.HANDOFF_PYTHON;
assert(python, "Set HANDOFF_PYTHON to the available Python3 executable");
const output = join(root, "artifacts");
mkdirSync(output, { recursive: true });
const archive = join(
  output,
  `ProboxAI-browser-login-handoff-2026-10-19-${Date.now()}.zip`,
);
assert(!existsSync(archive));
const code = `import sys,zipfile,pathlib,json,hashlib
stage=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(stage.iterdir()):
  if p.is_file(): z.write(p,p.name)
with zipfile.ZipFile(target) as z:
 assert z.testzip() is None
 assert len(z.namelist())==7
 assert all('/' not in n and '\\\\' not in n and '..' not in pathlib.PurePosixPath(n).parts for n in z.namelist())
 manifest=json.loads(z.read('MANIFEST.json'))
 for entry in manifest['files']:
  data=z.read(entry['path']); assert len(data)==entry['bytes']
  assert hashlib.sha256(data).hexdigest()==entry['sha256']
 spec=json.loads(z.read('BROWSER-OPENAPI.json'))
 def refs(v):
  if isinstance(v,dict):
   if '$ref' in v: assert v['$ref'].split('/')[-1] in spec['components']['schemas']
   for x in v.values(): refs(x)
  elif isinstance(v,list):
   for x in v: refs(x)
 refs(spec)
 assert len(json.loads(z.read('BROWSER-CHECKS.json'))['checks'])==6
 print(json.dumps({'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'zipEntries':len(z.namelist()),'crcPassed':True,'entryHashesPassed':True,'schemaReferencesPassed':True}))
`;
const result = JSON.parse(
  execFileSync(python, ["-c", code, stage, archive], {
    encoding: "utf8",
    windowsHide: true,
  }),
);
const receipt = {
  file: archive,
  ...result,
  verifiedSourceFiles: checked,
  scanPassed: true,
  payloadScope:
    "Documentation/contracts/evidence only; requires updated backend/frontend checkouts",
};
const receiptPath = join(
  root,
  "Docs",
  `browser-session-package-${Date.now()}.json`,
);
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", {
  flag: "wx",
});
console.log(JSON.stringify({ ...receipt, receiptPath }));
