import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { extractRepoContext } from "../../packages/core/src/context/repo";

test("repo context: extracts key source files from monorepo apps/* and packages/* roots", () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipyard-repo-context-"));

  try {
    fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "demo-monorepo", version: "1.0.0" }, null, 2));

    fs.mkdirSync(path.join(repoDir, "apps/server/src"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "apps/web/src"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "packages/core/src"), { recursive: true });

    fs.writeFileSync(
      path.join(repoDir, "apps/server/src/index.ts"),
      'export function startServer(port: number): string { return `:${port}`; }\n'
    );
    fs.writeFileSync(
      path.join(repoDir, "apps/web/src/App.tsx"),
      'export function App(): string { return "ui"; }\n'
    );
    fs.writeFileSync(
      path.join(repoDir, "packages/core/src/shipyard.ts"),
      'export function runShipyard(): boolean { return true; }\n'
    );

    const ctx = extractRepoContext(repoDir, 10);

    assert.ok(ctx.keyFiles["apps/server/src/index.ts"], "should capture apps/server/src/index.ts");
    assert.ok(ctx.keyFiles["apps/web/src/App.tsx"], "should capture apps/web/src/App.tsx");
    assert.ok(ctx.keyFiles["packages/core/src/shipyard.ts"], "should capture packages/core/src/shipyard.ts");

    assert.match(ctx.summary, /apps\/server\/src\/index\.ts/);
    assert.match(ctx.summary, /packages\/core\/src\/shipyard\.ts/);
    assert.match(ctx.summary, /export function startServer/);
    assert.doesNotMatch(ctx.summary, /return `:.*port.*`;/, "summary should prefer exported signatures over full bodies");
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
