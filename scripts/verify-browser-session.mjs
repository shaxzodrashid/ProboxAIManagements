// Real browser, real local HTTP/guards/database; controlled runner only. No stored credentials.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
require("ts-node").register({ transpileOnly: true });
const {
  createFrontendSessionHarness,
  requireFixtureDatabase,
} = require("../test/support/frontend-session-harness.ts");
const { chromium } = createRequire(
  resolve("../ProboxAI_Frontend/package.json"),
)("playwright");
const origin = "http://127.0.0.1:5173";
const fixture = await createFrontendSessionHarness(
  requireFixtureDatabase(process.env.PROFILE_TEST_DATABASE_URL),
  3050,
  origin,
);
let browser;
const checks = [];
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  const errors = [];
  const failedHttp = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      failedHttp.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  let bearerSeen = false;
  page.on("request", (request) => {
    if (request.headers().authorization) bearerSeen = true;
  });
  await page.goto(origin + "/setup");
  await page.waitForURL("**/auth/sign-in").catch(async (error) => {
    console.error(
      JSON.stringify({
        stage: "anonymous navigation",
        errors,
        failedHttp,
        body: (await page.locator("body").innerText()).slice(0, 800),
      }),
    );
    throw error;
  });
  checks.push("anonymous protected navigation redirects to sign-in");
  await page.getByLabel(/^Username/).fill(fixture.manifest.username);
  await page.getByLabel(/^Password/).fill(fixture.manifest.password);
  const loginResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/browser/login") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const login = await loginResponse;
  assert.equal(login.status(), 200);
  assert.doesNotMatch(
    JSON.stringify(await login.json()),
    /accessToken|refreshToken|passwordHash/,
  );
  await page.waitForURL("**/setup");
  await page.getByRole("heading", { name: "Session setup" }).waitFor();
  await page.getByLabel(/^Project/).selectOption(fixture.manifest.projectId);
  await page.getByLabel(/^Task/).selectOption(fixture.manifest.taskId);
  await page.getByLabel(/^Model/).selectOption("openai::gpt-6-sol");
  await page
    .getByLabel("Initial prompt", { exact: true })
    .fill("Controlled local browser journey only");
  const acceptedResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/browser/api/sessions") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  const accepted = await acceptedResponse;
  assert.equal(accepted.status(), 201);
  const codingSessionId = (await accepted.json()).id;
  await page.getByRole("heading", { name: "Session accepted" }).waitFor();
  checks.push(
    "real sign-in through project/task/catalog/preflight to controlled session acceptance",
  );
  const streamResult = await page.evaluate(async (id) => {
    const response = await fetch(
      `/api/v1/browser/api/sessions/${id}/events/stream?after=0`,
      { credentials: "same-origin", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) throw Error("Stream rejected");
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      last = 0,
      output = false;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) throw Error("EOF is not completion");
        buffer += decoder
          .decode(chunk.value, { stream: true })
          .replace(/\r\n/g, "\n");
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = frame
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!data) continue;
          const event = JSON.parse(data.slice(6));
          if (event.sequence <= last) throw Error("Non-monotonic sequence");
          last = event.sequence;
          if (
            event.type === "item.completed" &&
            event.data?.item?.text?.includes("Controlled local fixture")
          )
            output = true;
          if (
            event.type === "session.state" &&
            event.data.sessionStatus === "COMPLETED"
          )
            return { events: last, output };
        }
      }
    } finally {
      await reader.cancel();
    }
  }, codingSessionId);
  assert.equal(streamResult.output, true);
  assert(streamResult.events > 0);
  await page.getByRole("button", { name: "Check persisted status" }).click();
  await page.getByText("COMPLETED", { exact: true }).waitFor();
  checks.push(
    "cookie fetch SSE receives sequenced controlled output and authoritative completion; REST agrees",
  );
  assert.equal(bearerSeen, false);
  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) => c.name === "probox_dev_sid");
  assert(sessionCookie?.httpOnly);
  assert.equal(sessionCookie.sameSite, "Lax");
  assert.equal(
    await page.evaluate(() =>
      globalThis.document.cookie.includes("probox_dev_sid"),
    ),
    false,
  );
  assert.deepEqual(
    await page.evaluate(() => [
      globalThis.localStorage.length,
      globalThis.sessionStorage.length,
    ]),
    [0, 0],
  );
  checks.push(
    "HttpOnly local development cookie; no browser bearer header or persistent credentials",
  );
  const tab = await context.newPage();
  await tab.goto(origin + "/setup");
  await tab.getByRole("heading", { name: "Session setup" }).waitFor();
  await tab.getByRole("button", { name: "Sign out" }).waitFor();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/auth/sign-in");
  await tab.waitForURL("**/auth/sign-in");
  const protectedAfter = await context.request.get(
    origin + "/api/v1/browser/api/users/me",
  );
  assert.equal(protectedAfter.status(), 401);
  checks.push(
    "browser logout removes protected access and clears the other tab",
  );
  assert.deepEqual(errors, []);
  assert.equal(fixture.runner.starts.length, 1);
  await context.close();
  const {
    BrowserSessionService,
  } = require("../src/browser-sessions/browser-session.service.ts");
  const config = fixture.app.get(BrowserSessionService).config;
  const previousIdle = config.idleMs;
  config.idleMs = 5000;
  const expiringContext = await browser.newContext({ locale: "en-US" });
  try {
    const expiringPage = await expiringContext.newPage();
    expiringPage.on("pageerror", (error) => errors.push(error.message));
    await expiringPage.goto(origin + "/auth/sign-in");
    await expiringPage.getByLabel(/^Username/).fill(fixture.manifest.username);
    await expiringPage.getByLabel(/^Password/).fill(fixture.manifest.password);
    await expiringPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expiringPage.waitForURL("**/setup");
    await expiringPage.getByLabel(/^Project/).waitFor();
    await expiringPage.waitForURL("**/auth/sign-in", { timeout: 12_000 });
    assert.equal(
      (
        await expiringContext.request.get(
          origin + "/api/v1/browser/api/users/me",
        )
      ).status(),
      401,
    );
    checks.push(
      "server idle expiry removes protected UI and denies subsequent cookie access",
    );
  } finally {
    config.idleMs = previousIdle;
    await expiringContext.close();
  }
  assert.deepEqual(errors, []);
  await mkdir("dist/browser-session-verification", { recursive: true });
  await writeFile(
    "dist/browser-session-verification/browser-result.json",
    JSON.stringify(
      {
        mode: "CONTROLLED_LOCAL_FIXTURE_ONLY",
        checks,
        events: streamResult.events,
        runnerStarts: 1,
        providerCalls: 0,
        browserErrors: errors.length,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ passed: checks.length, checks, providerCalls: 0 }),
  );
} finally {
  await browser?.close();
  await fixture.close();
}
