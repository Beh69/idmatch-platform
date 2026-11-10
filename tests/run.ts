// Runs each test file in its OWN Node process so suites that seed the database
// (e2e, bulkData) cannot interfere with one another. Aggregates the result and
// exits non-zero if any file fails — suitable for the CI quality gate.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

let failed = 0;
for (const f of files) {
  console.log(`\n=== Running ${f} ===`);
  const res = spawnSync("node", ["--test", "--import", "tsx", join(here, f)], {
    stdio: "inherit",
    cwd: join(here, ".."),
  });
  if (res.status !== 0) failed++;
}

console.log(`\n=== Test run complete: ${files.length} file(s), ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
