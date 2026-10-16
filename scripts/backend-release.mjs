import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { format } from "prettier";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) =>
  readFileSync(resolve(root, file), "utf8").replace(/\r\n/g, "\n");
const pkg = JSON.parse(read("package.json"));
const catalog = JSON.parse(read("Docs/backend-release-catalog.json"));
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.(0|[1-9]\d*))?$/;
assert(
  semver.test(pkg.version),
  "package.json requires a semantic release version",
);
assert(
  /^[a-f0-9]{40}$/.test(catalog.baseline.commit),
  "Baseline needs a real immutable commit",
);
if (process.argv.includes("--artifact")) {
  assert(
    !process.argv.includes("--published"),
    "Artifact checks do not prove local/remote tag publication",
  );
  assert(
    /^[a-f0-9]{40}$/.test(read(".deployment-commit").trim()),
    "Artifact requires its verified producer's commit manifest",
  );
} else {
  execFileSync(
    "git",
    ["cat-file", "-e", `${catalog.baseline.commit}^{commit}`],
    { cwd: root, stdio: "pipe" },
  );
}
const releases = new Map();
for (const release of catalog.releases) {
  assert(semver.test(release.version), "Invalid catalog version");
  assert(!releases.has(release.version), "Duplicate release");
  assert.equal(release.gitRef, `refs/tags/v${release.version}`);
  assert.equal(
    release.channel,
    release.version.includes("-") ? "dev" : "production",
  );
  assert(
    ["not-deployed", "deployment-unverified"].includes(release.deployment),
    "Git releases alone must not claim deployment",
  );
  releases.set(release.version, release);
}
assert(
  releases.has(pkg.version),
  "Current package version must be in the release catalog",
);
assert(
  read("CHANGELOG.md").includes(`## ${pkg.version}`),
  "Current release requires a changelog section",
);
const ids = new Set();
for (const feature of catalog.features) {
  assert(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature.id) && !ids.has(feature.id),
    "Unique stable feature IDs required",
  );
  ids.add(feature.id);
  assert(
    releases.has(feature.since),
    `Unknown introduction release: ${feature.id}`,
  );
  assert(["supported", "foundation"].includes(feature.state));
  const path = resolve(root, feature.contract);
  assert(
    feature.contract.startsWith("Docs/") &&
      !relative(root, path).startsWith("..") &&
      existsSync(path),
    `Missing local feature evidence: ${feature.id}`,
  );
  assert(typeof feature.title === "string" && !/[|\r\n]/.test(feature.title));
}
const rows = [...catalog.features]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(
    (feature) =>
      `| ${feature.title} | ${feature.since} | ${feature.state} | [Contract](../${feature.contract}) |`,
  );
const markdown = [
  "# Backend feature availability",
  "",
  "Generated from package.json and backend-release-catalog.json. Run `pnpm release:docs` to update; `pnpm release:check` verifies consistency.",
  "",
  `Current package release: **${pkg.version}**. Dev prereleases are progress snapshots, not production deployments. URL compatibility remains **/api/v1**.`,
  "",
  `Baseline package snapshot: ${catalog.baseline.packageVersion} at commit \`${catalog.baseline.commit}\`. ${catalog.baseline.provenance}`,
  "",
  "Available since refers to the first tracked Git release containing this bounded backend contract. A foundation does not close its larger checklist feature. Each release tag resolves to the actual implementation commit; no historical introduction version is inferred.",
  "",
  "| Feature / bounded contract | Available since | Scope | Evidence |",
  "| --- | --- | --- | --- |",
  ...rows,
  "",
  "## Release references",
  "",
  ...catalog.releases.map(
    (release) =>
      `- **${release.version}**: \`${release.gitRef}\`, ${release.channel}, ${release.deployment}.`,
  ),
  "",
].join("\n");
const formatted = await format(markdown, { parser: "markdown" });
if (process.argv.includes("--write"))
  writeFileSync(
    resolve(root, "Docs/backend-feature-availability.md"),
    formatted,
  );
assert.equal(
  read("Docs/backend-feature-availability.md"),
  formatted,
  "Generated availability documentation is stale; run pnpm release:docs",
);
if (process.argv.includes("--published")) {
  for (const release of releases.values())
    execFileSync(
      "git",
      ["rev-parse", "--verify", `${release.gitRef}^{commit}`],
      { cwd: root, stdio: "pipe" },
    );
  const tagged = execFileSync(
    "git",
    ["rev-parse", `${releases.get(pkg.version).gitRef}^{commit}`],
    { cwd: root, encoding: "utf8" },
  ).trim();
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  assert.equal(
    tagged,
    head,
    "Current release tag must identify the actual release commit",
  );
}
console.log(
  `Release ${pkg.version}: ${catalog.features.length} bounded feature contracts verified${process.argv.includes("--published") ? " with Git commit provenance" : ""}.`,
);
