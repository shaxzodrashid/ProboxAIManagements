// Sandbox only: every Git/network/service/package-manager operation is mocked.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = fileURLToPath(new URL("../", import.meta.url));
const windows = process.platform === "win32";
const bash =
  process.env.PROBOX_TEST_BASH ??
  (windows ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash");
const unix = (path) =>
  windows
    ? path
        .replace(/\\/g, "/")
        .replace(/^([a-z]):/i, (_, drive) => "/" + drive.toLowerCase())
    : path;
const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
const syntax = spawnSync(bash, ["-n", "deploy.sh"], {
  cwd: repo,
  encoding: "utf8",
});
assert.equal(syntax.status, 0, syntax.stderr);
let passed = 0;
function scenario(name, command, expected, check, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "proboxai-deploy-test-"));
  const multiEnv = name.startsWith("multi-env");
  const environmentPaths = [
    join(root, "service.env"),
    ...(multiEnv
      ? ["database", "minio", "anthropic", "telegram"].map((layer) =>
          join(root, `${layer}.env`),
        )
      : []),
  ];
  const bin = join(root, "bin"),
    state = join(root, "state"),
    source = join(root, "source"),
    template = join(root, "template"),
    old = join(state, "releases", "old"),
    current = join(state, "current");
  try {
    for (const path of [bin, source, template, join(old, "dist")])
      mkdirSync(path, { recursive: true });
    writeFileSync(join(root, "scenario"), name);
    writeFileSync(join(root, "calls"), "");
    writeFileSync(
      join(root, "active"),
      name === "initial" || name === "stopped" || command === "resume"
        ? "0"
        : "1",
    );
    writeFileSync(join(root, "source-head"), "a".repeat(40));
    writeFileSync(
      join(root, "service.env"),
      name === "port-mismatch" || multiEnv
        ? "NODE_ENV=production\nPORT=4000\n"
        : "NODE_ENV=production\n",
      {
        mode: 0o600,
      },
    );
    for (const [index, path] of environmentPaths.entries()) {
      if (index === 0 || (name === "multi-env-missing" && index === 4))
        continue;
      writeFileSync(
        path,
        `DEPLOY_TEST_LAYER_${index}=fixture\nDEPLOY_TEST_LAST_LAYER=${index}\n${index === 4 ? "PORT=3000\n" : ""}`,
        { mode: 0o600 },
      );
    }
    writeFileSync(
      join(old, "dist", "main.js"),
      "// Known-good fixture; never executed\n",
    );
    writeFileSync(
      join(old, "package.json"),
      JSON.stringify({ version: "0.1.0" }),
    );
    writeFileSync(join(old, ".deployment-commit"), "a".repeat(40));
    writeFileSync(
      join(old, ".deployment-openapi-version"),
      name === "legacy" ? "v1" : "0.1.0",
    );
    if (name !== "initial")
      symlinkSync(old, current, windows ? "junction" : "dir");
    writeFileSync(
      join(template, "package.json"),
      JSON.stringify({
        version: name === "prerelease" ? "0.2.0-dev.1" : "0.2.0",
      }),
    );
    mkdirSync(join(template, "prisma", "migrations", "candidate_new"), {
      recursive: true,
    });
    writeFileSync(
      join(template, "prisma", "schema.prisma"),
      "// candidate schema\n",
    );
    writeFileSync(
      join(template, "prisma", "migrations", "candidate_new", "migration.sql"),
      "-- pending candidate migration\n",
    );
    const prefix = `#!/usr/bin/env bash\nset -eu\nroot=${quote(unix(root))}\nscenario=$(cat "$root/scenario")\nprintf '%s:%s\\n' "$(basename "$0")" "$*" >> "$root/calls"\n`;
    const mock = (name, body) =>
      writeFileSync(join(bin, name), prefix + body + "\n", { mode: 0o755 });
    mock(
      "git",
      `[[ "\${1:-}" != -C ]] || shift 2
case "$1" in
 branch) [[ "$scenario" != dev ]] && echo main || echo dev ;;
 status) [[ "$scenario" != dirty ]] || echo ' M retained-user-file' ;;
 rev-parse) [[ "$2" != HEAD ]] && printf '%s\\n' '${"b".repeat(40)}' || cat "$root/source-head" ;;
 fetch) [[ "$scenario" != fetch-fail ]] ;;
 merge-base) [[ "$scenario" != diverged ]] ;;
 archive) /usr/bin/tar -cf - -C "$root/template" . ;;
 merge) printf '%s' '${"b".repeat(40)}' > "$root/source-head" ;;
 *) exit 99 ;;
esac`,
    );
    mock(
      "systemctl",
      `case "$1" in
 show)
  case "$2" in
   --property=WorkingDirectory) [[ "$scenario" != bad-unit ]] && echo "$root/state/current" || echo /wrong ;;
   --property=User) id -un ;;
   --property=EnvironmentFiles)
    if [[ "$scenario" = multi-env* ]]; then
     files=(service database minio anthropic telegram)
     [[ "$scenario" != multi-env-order-mismatch ]] || files=(service minio database anthropic telegram)
     separator=$'\\n'
     [[ "$scenario" != multi-env-single-line ]] || separator=' '
     prefix=''
     for file in "\${files[@]}"; do printf '%s%s (ignore_errors=no)' "$prefix" "$root/$file.env"; prefix=$separator; done
     printf '\\n'
    else echo "$root/service.env (ignore_errors=no)"; fi ;;
   --property=ExecStart) echo "{ argv[]=$root/bin/node dist/main.js ; }" ;;
  esac ;;
 is-active) value=$(cat "$root/active"); [[ "\${2:-}" = --quiet ]] || { [[ "$value" = 1 ]] && echo active || echo inactive; }; [[ "$value" = 1 ]] ;;
 stop) [[ "$scenario" != stop-unconfirmed ]] || exit 0; echo 0 > "$root/active" ;;
 start)
  if [[ "$scenario" = start-fail && "$(readlink -f "$root/state/current")" != "$root/state/releases/old" ]]; then exit 1; fi
  echo 1 > "$root/active" ;;
 *) exit 99 ;;
esac`,
    );
    mock("flock", '[[ "$scenario" != lock-busy ]]');
    mock(
      "id",
      'if [[ "$1" = -u ]]; then [[ "$scenario" = root-user ]] && echo 0 || echo 1000; else echo proboxai; fi',
    );
    mock("shellcheck", "exit 0");
    mock(
      "stat",
      'if [[ "$scenario" = world-env || ( "$scenario" = multi-env-world && "${*: -1}" = */telegram.env ) ]]; then echo 644; else echo 600; fi',
    );
    mock(
      "sudo",
      '[[ "$1" = -n && "$2" = systemctl ]] || exit 99; shift 2; exec "$root/bin/systemctl" "$@"',
    );
    mock(
      "pnpm",
      `[[ "$scenario" != build-fail ]] || { [[ "$1" != build ]] || exit 1; }
[[ "\${PROFILE_TEST_DATABASE_URL:-}" = '' ]] || exit 91
[[ "\${COREPACK_ENABLE_DOWNLOAD_PROMPT:-}" = 0 && "\${COREPACK_DEFAULT_TO_LATEST:-}" = 0 && "\${COREPACK_ENABLE_AUTO_PIN:-}" = 0 ]] || exit 95
[[ "\${DEPLOY_TEST_LAYER_1:-}" = '' && "\${DEPLOY_TEST_LAYER_2:-}" = '' && "\${DEPLOY_TEST_LAYER_3:-}" = '' && "\${DEPLOY_TEST_LAYER_4:-}" = '' ]] || exit 94
[[ "\${DATABASE_URL:-}" = 'postgresql://build_only@127.0.0.1:1/build_only' ]] || exit 92
if [[ "$1" = build ]]; then mkdir -p dist node_modules/prisma/build; echo '// fixture' > dist/main.js; touch node_modules/prisma/build/index.js; fi`,
    );
    mock(
      "node",
      `env_args=()
while [[ "\${1:-}" = --env-file=* ]]; do env_args+=("$1"); shift; done
if (( \${#env_args[@]} > 0 )) && [[ "\${1:-}" != -p ]]; then
 [[ "$PWD" = "$root/state/releases/"* && "$2" = migrate && "$3" = status && "$4" = --schema && "$5" = "$PWD/prisma/schema.prisma" && -f "$5" ]] || exit 93
 if [[ "$scenario" = multi-env* ]]; then
  ${quote(unix(process.execPath))} "\${env_args[@]}" -e 'const a=require("node:assert/strict"); for(let i=1;i<=4;i++)a.equal(process.env["DEPLOY_TEST_LAYER_"+i],"fixture"); a.equal(process.env.DEPLOY_TEST_LAST_LAYER,"4"); a.equal(process.env.PORT,"3000")'
  echo environment-order-verified >> "$root/calls"
 fi
 printf 'candidate-migration-scope:%s\\n' "$PWD" >> "$root/calls"
 [[ "$scenario" != migration-pending && "$scenario" != candidate-new-migration-pending ]]; exit
fi
exec ${quote(unix(process.execPath))} "\${env_args[@]}" "$@"`,
    );
    mock(
      "curl",
      `target=$(readlink -f "$root/state/current")
[[ "$scenario" != health-fail || "$target" = "$root/state/releases/old" ]] || exit 22
url="\${*: -1}"
if [[ "$url" = */docs-json ]]; then
 version=$(cat "$root/state/current/.deployment-openapi-version")
 if [[ "$scenario" = version-mismatch && "$target" != "$root/state/releases/old" ]]; then version=0.0.0; fi
 printf '{"info":{"version":"%s"}}' "$version"
else printf '%s' '{"status":"ok","service":"proboxai","dependencies":{"postgres":"ok","minio":"ok"}}'; fi`,
    );
    mock("journalctl", "echo 'sandbox journal only'");
    // Windows lacks Linux symlink rename semantics; only these actuators are mocked.
    if (windows) {
      writeFileSync(
        join(root, "readlink.mjs"),
        'import {realpathSync} from "node:fs"; console.log(realpathSync(process.argv[2]).replace(/\\\\/g,"/").replace(/^([a-z]):/i,(_,d)=>"/"+d.toLowerCase()));\n',
      );
      mock(
        "readlink",
        `exec ${quote(unix(process.execPath))} "$root/readlink.mjs" "\${*: -1}"`,
      );
      mock(
        "ln",
        `exec ${quote(unix(process.execPath))} -e 'require("node:fs").symlinkSync(process.argv[1],process.argv[2],"junction")' "$3" "$4"`,
      );
      mock(
        "mv",
        `exec ${quote(unix(process.execPath))} -e 'const f=require("node:fs"),a=process.argv[1],b=process.argv[2];try{f.rmdirSync(b)}catch(e){if(e.code!=="ENOENT")throw e}f.renameSync(a,b)' "$3" "$4"`,
      );
    }
    const result = spawnSync(
      bash,
      [
        "--noprofile",
        "--norc",
        "-c",
        'export PATH="$1:/usr/bin:/bin"; exec bash "$2" "$3"',
        "_",
        unix(bin),
        unix(resolve(repo, "deploy.sh")),
        command,
      ],
      {
        cwd: repo,
        encoding: "utf8",
        timeout: 30000,
        env: {
          ...process.env,
          PROBOX_DEPLOY_REPO: unix(source),
          PROBOX_DEPLOY_STATE: unix(state),
          PROBOX_DEPLOY_ENV_FILE: multiEnv ? "" : unix(environmentPaths[0]),
          PROBOX_DEPLOY_ENV_FILES: multiEnv
            ? environmentPaths.map(unix).join("\n")
            : "",
          PROBOX_DEPLOY_NODE: unix(join(bin, "node")),
          PROBOX_DEPLOY_HEALTH_TIMEOUT: "1",
          PROFILE_TEST_DATABASE_URL: "must-not-reach-build",
          DATABASE_URL: "must-not-reach-build",
          ...overrides,
        },
      },
    );
    assert.equal(
      result.status,
      expected,
      `${name}/${command}: ${result.stdout}\n${result.stderr}\n${result.error ?? ""}`,
    );
    const calls = readFileSync(join(root, "calls"), "utf8");
    check?.({ root, calls, state, old, current, result });
    passed++;
    console.log(`PASS ${name}/${command}`);
  } finally {
    assert.equal(dirname(root), realpathSync(tmpdir()));
    assert(basename(root).startsWith("proboxai-deploy-test-"));
    rmSync(root, { recursive: true, force: true });
  }
}
const unchanged = ({ current, old, calls }) => {
  assert.equal(realpathSync(current), realpathSync(old));
  assert(
    !calls.includes("systemctl:stop") && !calls.includes("systemctl:start"),
  );
};
scenario("healthy", "help", 0, ({ calls }) => assert.equal(calls, ""));
scenario("healthy", "unknown", 2, ({ calls }) => assert.equal(calls, ""));
scenario("lock-busy", "restart", 75, unchanged);
scenario("root-user", "restart", 2, unchanged);
scenario(
  "candidate-new-migration-pending",
  "restart",
  1,
  ({ calls, ...fixture }) => {
    unchanged({ calls, ...fixture });
    assert(calls.includes("candidate-migration-scope:"));
  },
);
for (const name of [
  "dirty",
  "dev",
  "diverged",
  "bad-unit",
  "prerelease",
  "migration-pending",
])
  scenario(name, "restart", name === "migration-pending" ? 1 : 2, unchanged);
scenario("fetch-fail", "restart", 1, unchanged);
scenario("build-fail", "restart", 1, unchanged);
scenario("healthy", "stop", 0, ({ root, calls }) => {
  assert.equal(readFileSync(join(root, "active"), "utf8").trim(), "0");
  assert(!calls.includes("git:") && !calls.includes("pnpm:"));
});
scenario("healthy", "resume", 0, ({ root, calls }) => {
  assert.equal(readFileSync(join(root, "active"), "utf8").trim(), "1");
  assert(!calls.includes("git:") && !calls.includes("pnpm:"));
});
scenario("healthy", "status", 0);
scenario("legacy", "resume", 0);
scenario("stopped", "status", 3);
scenario("healthy", "logs", 0, ({ result }) =>
  assert(result.stdout.includes("sandbox journal")),
);
scenario("healthy", "restart", 0, ({ root, calls, current, old }) => {
  assert.notEqual(realpathSync(current), realpathSync(old));
  assert.equal(
    readFileSync(join(current, ".deployment-commit"), "utf8").trim(),
    "b".repeat(40),
  );
  assert(calls.indexOf("pnpm:build") < calls.indexOf("systemctl:stop"));
  assert(
    calls.indexOf("candidate-migration-scope:") <
      calls.indexOf("systemctl:stop"),
  );
  assert(calls.indexOf("node:--env-file=") < calls.indexOf("systemctl:stop"));
  assert.equal(readFileSync(join(root, "active"), "utf8").trim(), "1");
});
scenario("initial", "deploy", 0, ({ current }) =>
  assert.equal(
    JSON.parse(readFileSync(join(current, "package.json"))).version,
    "0.2.0",
  ),
);
for (const name of ["health-fail", "version-mismatch", "start-fail"])
  scenario(name, "restart", 1, ({ root, current, old }) => {
    assert.equal(realpathSync(current), realpathSync(old));
    assert.equal(readFileSync(join(root, "active"), "utf8").trim(), "1");
  });
scenario("stop-unconfirmed", "restart", 1, ({ current, old }) =>
  assert.equal(realpathSync(current), realpathSync(old)),
);
scenario("healthy", "restart", 2, unchanged, {
  PROBOX_DEPLOY_HEALTH_TIMEOUT: "9999",
});
scenario("world-env", "restart", 2, unchanged);
for (const name of ["multi-env", "multi-env-single-line"])
  scenario(name, "restart", 0, ({ calls, current, old }) => {
    assert.notEqual(realpathSync(current), realpathSync(old));
    assert(calls.includes("environment-order-verified"));
    assert(calls.includes("--env-file="));
  });
for (const name of [
  "multi-env-order-mismatch",
  "multi-env-missing",
  "multi-env-world",
])
  scenario(name, "restart", 2, unchanged);
scenario("healthy", "restart", 2, unchanged, {
  PROBOX_DEPLOY_ENV_FILES: "/another/file.env",
});
scenario("healthy", "restart", 2, unchanged, {
  PROBOX_DEPLOY_ENV_FILE: "relative.env",
});
scenario("port-mismatch", "restart", 2, unchanged);
scenario("healthy", "restart", 2, unchanged, {
  PROBOX_DEPLOY_HEALTH_URL: "http://127.0.0.1:65536/api/v1/health/ready",
});
scenario("healthy", "restart", 2, unchanged, {
  PROBOX_DEPLOY_HEALTH_URL: "https://external.invalid/health",
});
scenario(
  "healthy",
  "stop",
  0,
  ({ calls }) => assert(calls.includes("sudo:-n systemctl stop")),
  { PROBOX_DEPLOY_USE_SUDO: "1" },
);
console.log(
  `${passed} sandbox deployment scenarios passed; no real services, network update, production credentials or database migration used.`,
);
