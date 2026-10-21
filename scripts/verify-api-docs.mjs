import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name) =>
  JSON.parse(
    readFileSync(new URL("../Docs/api/" + name, import.meta.url), "utf8"),
  );
const operations = read("postman-operation-docs.json");
const inventory = read("endpoints.json");
const spec = read("openapi.json");
// One verified bodyless success is intentional. Never invent a JSON schema for it.
const bodylessSuccesses = new Set(["POST /api/v1/telegram/webhook 200"]);
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    const operationIdentity = `${method.toUpperCase()} ${path}`;
    // Require the actual access-token guard's failure contracts, not 401s on
    // quiet API-key webhooks or public/optional authentication projections.
    if (operation.security?.some((security) => "access-token" in security)) {
      for (const status of ["401", "403", "503"])
        assert(
          operation.responses?.[status]?.content?.["application/json"]?.schema,
          `Missing access-token error schema: ${operationIdentity} ${status}`,
        );
    }
    for (const [, name] of path.matchAll(/\{([^}]+)\}/g))
      assert(
        operation.parameters?.some(
          (parameter) =>
            parameter.in === "path" &&
            parameter.name === name &&
            parameter.required === true,
        ),
        `Missing required path parameter: ${operationIdentity} ${name}`,
      );
    for (const [status, response] of Object.entries(
      operation.responses ?? {},
    )) {
      if (/^[45]\d\d$/.test(status))
        assert(
          response.content?.["application/json"]?.schema,
          `Missing JSON error schema: ${operationIdentity} ${status}`,
        );
      if (!/^20[012]$/.test(status)) continue;
      const identity = `${method.toUpperCase()} ${path} ${status}`;
      if (bodylessSuccesses.has(identity)) {
        assert.equal(response.content, undefined, identity);
        assert.match(response.description, /[Ee]mpty/);
      } else {
        const content = Object.values(response.content ?? {});
        assert(
          content.length && content.every((media) => media.schema),
          `Missing success schema: ${identity}`,
        );
      }
    }
  }
}
const key = (method, path) =>
  method.toUpperCase() + " " + path.replace(/\{[^}]+\}/g, "{}");
assert.equal(operations.length, inventory.length);
assert.equal(new Set(operations.map((o) => o.key)).size, inventory.length);
for (const row of inventory)
  assert(operations.some((o) => o.key === key(row.method, row.path)));
for (const op of operations) {
  assert(op.request.description.includes("Deployment is unverified"));
  assert(
    op.request.description.includes(`locally tested ${spec.info.version}`),
    `Stale documentation version: ${op.key}`,
  );
  const match = op.request.description.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  assert(match, op.key);
  const contract = JSON.parse(match[1]);
  const check = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.$ref?.startsWith("#/"))
      assert(
        value.$ref
          .slice(2)
          .split("/")
          .reduce((object, part) => object?.[part], contract),
        value.$ref,
      );
    for (const child of Object.values(value)) check(child);
  };
  check(contract);
  assert(spec.paths[contract.path]?.[contract.method.toLowerCase()]);
  const raw =
    typeof op.request.url === "string" ? op.request.url : op.request.url.raw;
  assert(raw.startsWith("{{base_url}}/"));
  for (const credential of op.request.auth.bearer ?? [])
    assert(/^\{\{[^}]+\}\}$/.test(credential.value));
  for (const header of op.request.header ?? []) {
    if (header.key.toLowerCase() === "if-match")
      assert.equal(header.value, '"{{revision}}"');
    if (/secret|authorization/i.test(header.key))
      assert(/\{\{[^}]+\}\}/.test(header.value));
  }
  if (op.request.body?.mode === "raw")
    JSON.parse(op.request.body.raw.replace(/\{\{[^}]+\}\}/g, "0"));
  if (op.request.body?.mode === "formdata") {
    const schema = contract.request.schema.$ref
      ? contract.components.schemas[
          contract.request.schema.$ref.split("/").at(-1)
        ]
      : contract.request.schema;
    for (const field of op.request.body.formdata)
      assert.equal(
        field.disabled,
        !(schema.required ?? []).includes(field.key),
      );
  }
}
console.log(
  `${operations.length} unique runtime operations documented; nonempty success schemas, access-token error schemas, required path parameters, verified bodyless webhook, embedded refs, credential placeholders, body syntax, quoted revisions and optional uploads verified. No application requests executed.`,
);
