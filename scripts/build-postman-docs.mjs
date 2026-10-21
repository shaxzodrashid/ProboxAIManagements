import { readFileSync, writeFileSync } from "node:fs";
import { format } from "prettier";
const root = new URL("../Docs/api/", import.meta.url);
const spec = JSON.parse(readFileSync(new URL("openapi.json", root), "utf8"));
const resolveSchema = (schema) =>
  schema?.$ref
    ? spec.components.schemas[schema.$ref.split("/").at(-1)]
    : schema;
function fields(schema, depth = 0) {
  schema = resolveSchema(schema);
  if (!schema || depth > 3) return [];
  if (schema.allOf) return schema.allOf.flatMap((s) => fields(s, depth));
  if (schema.type === "array") return fields(schema.items, depth + 1);
  return Object.entries(schema.properties ?? {}).map(([name, value]) => {
    const resolved = resolveSchema(value);
    return {
      field: name,
      required: (schema.required ?? []).includes(name),
      type: value.$ref?.split("/").at(-1) ?? resolved.type ?? "object",
      nullable: value.nullable ?? resolved.nullable ?? false,
      enum: resolved.enum,
      minimum: resolved.minimum,
      maximum: resolved.maximum,
      minLength: resolved.minLength,
      maxLength: resolved.maxLength,
      maxItems: resolved.maxItems,
      format: resolved.format,
      description: resolved.description,
      ...(depth < 2 && resolved.type === "object"
        ? { fields: fields(resolved, depth + 1) }
        : {}),
    };
  });
}
function template(schema, property = "value", depth = 0) {
  schema = resolveSchema(schema);
  if (!schema || depth > 4) return null;
  if (schema.allOf)
    return Object.assign(
      {},
      ...schema.allOf.map((s) => template(s, property, depth + 1)),
    );
  if (schema.enum) return schema.enum[0];
  if (schema.type === "object" || schema.properties)
    return Object.fromEntries(
      (schema.required ?? []).map((name) => [
        name,
        template(schema.properties[name], name, depth + 1),
      ]),
    );
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return false;
  if (["integer", "number"].includes(schema.type))
    return `__POSTMAN_NUMBER_${property}__`;
  return `{{${property}}}`;
}
function group(path) {
  if (path.startsWith("/auth/")) return "Auth";
  if (path.startsWith("/browser/")) return "Auth";
  if (path.startsWith("/authorization/")) return "Authorization";
  if (path.startsWith("/configuration-templates"))
    return "Configuration Templates";
  if (path.startsWith("/departments")) return "Departments";
  if (path.startsWith("/health")) return "Health";
  if (path.startsWith("/telegram")) return "Telegram";
  if (path.startsWith("/sessions")) return "Sessions";
  if (
    path.startsWith("/tasks") ||
    /^\/projects\/[^/]+\/(tasks|task-board|shared-tasks)(\/|$)/.test(path)
  )
    return "Tasks";
  if (/^\/(users|profiles|chat-groups)(\/|$)/.test(path)) return "Users";
  if (path.startsWith("/direct-conversations")) return "Users";
  if (/^\/(projects|settings)(\/|$)/.test(path)) return "Projects";
  throw new Error("Unmapped runtime route: " + path);
}
const operations = [];
for (const [fullPath, methods] of Object.entries(spec.paths)) {
  const path = fullPath.replace(/^\/api\/v1/, "");
  for (const [method, op] of Object.entries(methods)) {
    if (
      !["get", "put", "post", "patch", "delete", "options", "head"].includes(
        method,
      )
    )
      continue;
    const json = op.requestBody?.content?.["application/json"]?.schema;
    const media = Object.keys(op.requestBody?.content ?? {});
    const responses = Object.fromEntries(
      Object.entries(op.responses).map(([code, response]) => [
        code,
        {
          description: response.description,
          content: Object.fromEntries(
            Object.entries(response.content ?? {}).map(([kind, entry]) => [
              kind,
              {
                schema: entry.schema,
                fields: Number(code) < 400 ? fields(entry.schema) : undefined,
              },
            ]),
          ),
        },
      ]),
    );
    const contract = {
      operationId: op.operationId,
      method: method.toUpperCase(),
      path: fullPath,
      permissions: op["x-required-permissions"] ?? [],
      security: op.security ?? [],
      parameters: op.parameters ?? [],
      request: {
        required: op.requestBody?.required ?? false,
        media,
        schema: json ?? op.requestBody?.content?.[media[0]]?.schema,
        fields: fields(json ?? op.requestBody?.content?.[media[0]]?.schema),
      },
      responses,
    };
    // Include the exact referenced definitions, once each. A request description
    // must be useful without a separate OpenAPI file, including nested arrays.
    const components = {};
    const collect = (value) => {
      if (!value || typeof value !== "object") return;
      if (value.$ref?.startsWith("#/components/schemas/")) {
        const name = value.$ref.split("/").at(-1);
        if (!(name in components)) {
          components[name] = spec.components.schemas[name];
          collect(components[name]);
        }
      }
      for (const child of Object.values(value)) collect(child);
    };
    collect(contract);
    contract.components = { schemas: components };
    const verifyRefs = (value) => {
      if (!value || typeof value !== "object") return;
      if (value.$ref?.startsWith("#/")) {
        const resolved = value.$ref
          .slice(2)
          .split("/")
          .reduce((object, key) => object?.[key], contract);
        if (!resolved)
          throw new Error("Unresolved embedded reference: " + value.$ref);
      }
      for (const child of Object.values(value)) verifyRefs(child);
    };
    verifyRefs(contract);
    const description = [
      `# ${op.summary ?? op.operationId}`,
      `Source-derived contract from the locally tested ${spec.info.version} development patch. Deployment is unverified; set base_url (including /api/v1) only after checking the target release. No agent-runtime endpoints are included.`,
      op.description ?? "",
      "Authorization uses current effective permission keys plus resource scope and lifecycle checks. Role labels do not replace these checks.",
      "This is a request template, not a captured successful execution. Replace placeholders and read conditional field rules before sending. Do not run a whole collection against live data: mutations may change files, credentials or execution state. No requests were executed as part of this documentation update.",
      "Missing fields/defaults are not invented. Optional request fields are omitted in the starter body; the full field contract is below. Preserve UUID and original revision for documented idempotent retries. Confirm actual outcomes before generating a new command.",
      "## Source-derived request and response contract",
      "```json",
      JSON.stringify(contract, null, 2),
      "```",
    ]
      .filter(Boolean)
      .join("\n\n");
    const auth = (op.security ?? []).some((entry) => "access-token" in entry)
      ? {
          type: "bearer",
          bearer: [{ key: "token", value: "{{access_token}}", type: "string" }],
        }
      : (op.security ?? []).some((entry) => "temporary-token" in entry)
        ? {
            type: "bearer",
            bearer: [
              { key: "token", value: "{{temporary_token}}", type: "string" },
            ],
          }
        : { type: "noauth" };
    const request = {
      method: method.toUpperCase(),
      url: "{{base_url}}" + path.replace(/\{([^}]+)\}/g, "{{$1}}"),
      description,
      auth,
      header: (op.parameters ?? [])
        .filter((p) => p.in === "header")
        .map((p) => ({
          key: p.name,
          value:
            p.name.toLowerCase() === "if-match"
              ? '"{{revision}}"'
              : `{{${p.name.replaceAll("-", "_")}}}`,
          description: p.description ?? "",
          disabled: !p.required,
        })),
    };
    const query = (op.parameters ?? [])
      .filter((p) => p.in === "query")
      .map((p) => ({
        key: p.name,
        value: `{{${p.name}}}`,
        description: p.description ?? "",
        disabled: !p.required,
      }));
    if (query.length)
      request.url = {
        raw: request.url,
        host: ["{{base_url}}"],
        path: path
          .slice(1)
          .replace(/\{([^}]+)\}/g, "{{$1}}")
          .split("/"),
        query,
      };
    if (json) {
      request.header.push({ key: "Content-Type", value: "application/json" });
      request.body = {
        mode: "raw",
        raw: JSON.stringify(template(json), null, 2).replace(
          /"__POSTMAN_NUMBER_(\w+)__"/g,
          "{{$1}}",
        ),
        options: { raw: { language: "json" } },
      };
    } else if (media.includes("multipart/form-data")) {
      const schema = resolveSchema(
        op.requestBody.content["multipart/form-data"].schema,
      );
      request.body = {
        mode: "formdata",
        formdata: Object.entries(schema.properties ?? {}).map(([key, value]) =>
          value.format === "binary"
            ? {
                key,
                type: "file",
                src: [],
                disabled: !(schema.required ?? []).includes(key),
                description:
                  value.description ?? "Choose a local file explicitly",
              }
            : {
                key,
                type: "text",
                value: `{{${key}}}`,
                disabled: !(schema.required ?? []).includes(key),
                description: value.description ?? "",
              },
        ),
      };
    }
    operations.push({
      collection: group(path),
      folder: op.tags?.at(-1) ?? "Runtime API",
      key: method.toUpperCase() + " " + fullPath.replace(/\{[^}]+\}/g, "{}"),
      name: op.summary ?? `${method.toUpperCase()} ${path}`,
      request,
    });
  }
}
if (process.argv[2] === "--chunk") {
  const offset = Number(process.argv[3]);
  const count = Number(process.argv[4] ?? 2);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 10
  )
    throw new Error(
      "Chunk offset must be nonnegative and count must be 1 through 10",
    );
  process.stdout.write(
    JSON.stringify(operations.slice(offset, offset + count)),
  );
} else {
  writeFileSync(
    new URL("postman-operation-docs.json", root),
    await format(JSON.stringify(operations), { parser: "json" }),
  );
  console.log(
    `Prepared ${operations.length} source-derived request documentation entries; no network calls.`,
  );
}
