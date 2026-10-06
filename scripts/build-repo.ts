// Builds the extension repo the storm site downloads from:
//   dist/repo/index.json        every extension, its version, sources and file hash
//   dist/repo/index.json.sig    Ed25519 signature of index.json (STORM_SIGNING_KEY)
//   dist/repo/extensions/*.js   one self-contained bundle per extension version
//
// When dist/repo already holds the published repo (CI checks out the `repo`
// branch there), a changed extension that kept its version number is refused.

import { Glob } from "bun";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SDK_VERSION, type Extension } from "@storm-sources/sdk";
import { sha256, type RepoEntry, type RepoIndex } from "@storm-sources/host";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "dist", "repo");
const VERSION = /^\d+\.\d+\.\d+$/;

const previous: RepoIndex | null = existsSync(join(OUT, "index.json")) ? JSON.parse(readFileSync(join(OUT, "index.json"), "utf8")) : null;
const changelog = (dir: string) => {
  const file = join(dir, "CHANGELOG.md");
  return existsSync(file) ? readFileSync(file, "utf8").split(/\n## /)[1]?.split("\n").slice(1).join("\n").trim() : undefined;
};

const entries: RepoEntry[] = [];
const pkgs = new Set<string>();
const sourceIds = new Set<string>();

for (const entry of [...new Glob("extensions/*/*/src/index.ts").scanSync(ROOT)].sort()) {
  const dir = join(ROOT, dirname(dirname(entry)));
  const ext = (await import(join(ROOT, entry))).default as Extension;
  const where = entry.replace(/\\/g, "/");

  if (ext.sdk !== SDK_VERSION) throw new Error(`${where}: built for sdk ${ext.sdk}, this repo is on ${SDK_VERSION}`);
  if (where.split("/")[1] !== ext.app) throw new Error(`${where}: a ${ext.app} extension must live in extensions/${ext.app}/`);
  if (!VERSION.test(ext.version)) throw new Error(`${where}: version "${ext.version}" must look like 1.2.3`);
  if (pkgs.has(ext.pkg)) throw new Error(`${where}: package ${ext.pkg} is defined twice`);
  pkgs.add(ext.pkg);
  for (const s of ext.sources) {
    if (sourceIds.has(s.id)) throw new Error(`${where}: source id ${s.id} is used twice`);
    sourceIds.add(s.id);
  }

  // Bundled for the browser target so an extension can't reach Node APIs; the
  // host hands it everything it may use.
  const built = await Bun.build({ entrypoints: [join(ROOT, entry)], target: "browser", format: "esm", minify: { whitespace: true, syntax: true, identifiers: false } });
  if (!built.success) throw new AggregateError(built.logs, `${where}: bundle failed`);
  const code = await built.outputs[0].text();
  const hash = await sha256(code);
  const file = `extensions/${ext.pkg}-${ext.version}.js`;

  const before = previous?.extensions.find((e) => e.pkg === ext.pkg);
  if (before && before.version === ext.version && before.sha256 !== hash) {
    throw new Error(`${where}: the code changed but the version is still ${ext.version} — bump it so sites pick up the update`);
  }

  mkdirSync(join(OUT, "extensions"), { recursive: true });
  writeFileSync(join(OUT, file), code);
  entries.push({
    pkg: ext.pkg,
    name: ext.name,
    version: ext.version,
    app: ext.app,
    file,
    sha256: hash,
    size: code.length,
    sources: ext.sources.map((s) => ({ id: s.id, name: s.name, lang: s.lang, icon: s.icon, rating: s.rating })),
    changelog: changelog(dir),
  });
  console.log(`  ${ext.pkg} ${ext.version}  ${(code.length / 1024).toFixed(1)} KB  ${ext.sources.map((s) => s.id).join(", ")}`);
}

// Bundles the previous index listed stay for one more publish: GitHub's CDN can
// serve that index for a few minutes after this one replaces it.
const keep = new Set([...entries, ...(previous?.extensions ?? [])].map((e) => e.file.split("/")[1]));
for (const f of existsSync(join(OUT, "extensions")) ? readdirSync(join(OUT, "extensions")) : []) {
  if (!keep.has(f)) rmSync(join(OUT, "extensions", f));
}

const index: RepoIndex = { format: 1, sdk: SDK_VERSION, generatedAt: new Date().toISOString(), extensions: entries };
const text = JSON.stringify(index, null, 2);
writeFileSync(join(OUT, "index.json"), text);

const secret = process.env.STORM_SIGNING_KEY?.trim();
if (secret) {
  const pkcs8 = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(text)));
  writeFileSync(join(OUT, "index.json.sig"), btoa(String.fromCharCode(...sig)));
  console.log(`signed ${entries.length} extensions`);
} else {
  rmSync(join(OUT, "index.json.sig"), { force: true });
  console.log(`built ${entries.length} extensions — unsigned (set STORM_SIGNING_KEY to sign)`);
}
