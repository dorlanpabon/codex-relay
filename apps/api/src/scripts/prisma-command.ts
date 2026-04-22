import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";

import { loadEnvFiles, resolveApiPath } from "../env/load-env.js";

loadEnvFiles();
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:54329/codex_relay?schema=public";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: prisma-command <args>");
  process.exit(1);
}

const shouldCaptureOutput = args[0] === "generate";
const result =
  process.platform === "win32"
    ? spawnSync(
        `pnpm exec prisma ${args.map((arg) => `"${arg.replace(/"/g, '\\"')}"`).join(" ")}`,
        {
          cwd: resolveApiPath(),
          stdio: shouldCaptureOutput ? "pipe" : "inherit",
          env: process.env,
          encoding: shouldCaptureOutput ? "utf8" : undefined,
          shell: true,
        },
      )
    : spawnSync("pnpm", ["exec", "prisma", ...args], {
        cwd: resolveApiPath(),
        stdio: shouldCaptureOutput ? "pipe" : "inherit",
        env: process.env,
        encoding: shouldCaptureOutput ? "utf8" : undefined,
      });

if (shouldCaptureOutput) {
  if (typeof result.stdout === "string" && result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (typeof result.stderr === "string" && result.stderr) {
    process.stderr.write(result.stderr);
  }
}

const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const generatedClientRoot = path.dirname(require.resolve("@prisma/client/package.json"));
const hasGeneratedClient =
  existsSync(path.join(generatedClientRoot, "index.js")) &&
  existsSync(path.join(generatedClientRoot, "..", "..", ".prisma", "client", "index.js"));

if (
  shouldCaptureOutput &&
  process.platform === "win32" &&
  result.status &&
  /EPERM: operation not permitted, rename .*query_engine-windows\.dll\.node/i.test(
    combinedOutput,
  ) &&
  hasGeneratedClient
) {
  console.warn(
    "Prisma generate hit a locked Windows engine file; reusing the existing generated client.",
  );
  process.exit(0);
}

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
