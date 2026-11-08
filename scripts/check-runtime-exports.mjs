import { readdir, readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";

const packagesRoot = resolve("packages");
const packageDirs = await readdir(packagesRoot, { withFileTypes: true });
const failures = [];

for (const entry of packageDirs) {
  if (!entry.isDirectory()) continue;
  const packageDir = join(packagesRoot, entry.name);
  const manifestPath = join(packageDir, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    continue;
  }

  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    const runtimeTarget = typeof target === "string" ? target : target?.import;
    if (typeof runtimeTarget !== "string" || !runtimeTarget.startsWith("./dist/") || !runtimeTarget.endsWith(".js")) {
      failures.push(`${manifest.name} export ${subpath} must resolve to compiled dist JavaScript (received ${String(runtimeTarget)}).`);
      continue;
    }
    try {
      await access(resolve(packageDir, runtimeTarget));
    } catch {
      failures.push(`${manifest.name} export ${subpath} points to missing build output: ${runtimeTarget}.`);
    }
  }
}

if (failures.length) {
  console.error("Runtime workspace export validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Runtime workspace exports resolve to compiled JavaScript.");
}
