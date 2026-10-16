import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name) =>
  JSON.parse(
    readFileSync(new URL("../Docs/api/" + name, import.meta.url), "utf8"),
  );
const operations = read("postman-operation-docs.json");
const inventory = read("endpoints.json");
const spec = read("openapi.json");
const key = (method, path) =>
  method.toUpperCase() + " " + path.replace(/\{[^}]+\}/g, "{}");
assert.equal(operations.length, inventory.length);
assert.equal(new Set(operations.map((o) => o.key)).size, inventory.length);
for (const row of inventory)
  assert(operations.some((o) => o.key === key(row.method, row.path)));
for (const op of operations) {
  assert(op.request.description.includes("Deployment is unverified"));
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
  `${operations.length} unique runtime operations documented; embedded refs, credential placeholders, body syntax, quoted revisions and optional uploads verified. No application requests executed.`,
);
