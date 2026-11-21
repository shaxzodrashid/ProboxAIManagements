const [origin, expectedVersion] = process.argv.slice(2);

try {
  const base = new URL(origin);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
  if (
    base.href !== `${base.origin}/` ||
    !(base.protocol === "https:" || (loopback && base.protocol === "http:"))
  ) {
    throw new Error("Use an HTTPS or loopback HTTP origin without a path.");
  }

  const request = (path, method = "GET") =>
    fetch(new URL(`/api/v1${path}`, base), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  const openapi = await request("/docs-json");
  if (!openapi.ok) throw new Error(`OpenAPI returned HTTP ${openapi.status}.`);
  const doc = await openapi.json();
  if (expectedVersion && doc.info?.version !== expectedVersion)
    throw new Error(
      `Expected backend ${expectedVersion}; got ${doc.info?.version}.`,
    );
  if (
    doc.components?.schemas?.BrowserSessionResponseDto?.properties
      ?.canManageModelCatalog?.type !== "boolean"
  ) {
    throw new Error("Browser session schema is missing canManageModelCatalog.");
  }

  const models = "/browser/api/admin/model-catalog/providers/openai/models";
  const probes = [
    ["GET", models, 401],
    // Mutations lack an allowed Origin, session cookie and CSRF token.
    ["POST", models, 403],
    ["PATCH", `${models}/gateway-smoke`, 403],
    [
      "PUT",
      "/browser/api/sessions/00000000-0000-4000-8000-000000000000/model-selection",
      403,
    ],
  ];
  await Promise.all(
    probes.map(async ([method, path, expected]) => {
      const response = await request(path, method);
      await response.body?.cancel();
      if (response.status !== expected)
        throw new Error(
          `${method} ${path} returned ${response.status}; expected ${expected}.`,
        );
    }),
  );
  console.log(
    `Browser catalog gateway verified on backend ${doc.info?.version}.`,
  );
} catch (error) {
  console.error(`Browser catalog gateway check failed: ${error.message}`);
  process.exitCode = 1;
}
