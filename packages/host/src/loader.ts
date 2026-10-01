import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppKind, ContentRating, Extension } from "@storm-sources/sdk";

export interface RepoEntry {
  pkg: string;
  name: string;
  version: string;
  app: AppKind;
  /** path of the bundle, relative to the index */
  file: string;
  sha256: string;
  size: number;
  sources: { id: string; name: string; lang: string; icon?: string; rating?: ContentRating }[];
  changelog?: string;
}

export interface RepoIndex {
  format: 1;
  sdk: number;
  generatedAt: string;
  extensions: RepoEntry[];
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sha256(data: Uint8Array | string) {
  return createHash("sha256").update(data).digest("hex");
}

/** Checks the index was signed by the repo's private key. */
export async function verifyIndex(indexText: string, signatureB64: string, publicKeyB64: string) {
  const key = await crypto.subtle.importKey("raw", b64(publicKeyB64), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, b64(signatureB64.trim()), new TextEncoder().encode(indexText));
}

/** Loads a bundled extension from disk. */
export async function importExtension(path: string): Promise<Extension> {
  // the query busts the module cache so a new version on the same path loads fresh
  const mod = await import(`${pathToFileURL(path).href}?v=${Date.now()}`);
  const ext = mod.default as Extension;
  if (!ext || typeof ext !== "object" || typeof ext.pkg !== "string" || !Array.isArray(ext.sources)) {
    throw new Error(`${path} is not a storm extension`);
  }
  return ext;
}

export interface SyncOptions {
  /** e.g. https://raw.githubusercontent.com/<owner>/storm-sources/repo/index.json */
  indexUrl: string;
  publicKey: string;
  dir: string;
  fetch?: typeof fetch;
}

/**
 * Downloads the signed index and every bundle it lists into `dir`, checking the
 * signature and each file's hash. Nothing unsigned or altered is ever written.
 */
export async function syncRepo({ indexUrl, publicKey, dir, fetch: f = fetch }: SyncOptions) {
  const get = async (url: string) => {
    const res = await f(url, { signal: AbortSignal.timeout(30_000), headers: { "Cache-Control": "no-cache" } });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const indexBytes = await get(indexUrl);
  const indexText = new TextDecoder().decode(indexBytes);
  const signature = new TextDecoder().decode(await get(`${indexUrl}.sig`));
  if (!(await verifyIndex(indexText, signature, publicKey))) throw new Error("The repo index signature does not match the trusted key");
  const index = JSON.parse(indexText) as RepoIndex;

  const files: Record<string, string> = {};
  for (const e of index.extensions) {
    const local = join(dir, e.file);
    let bytes: Uint8Array | null = null;
    try {
      bytes = new Uint8Array(await readFile(local));
      if ((await sha256(bytes)) !== e.sha256) bytes = null;
    } catch {
      bytes = null;
    }
    if (!bytes) {
      bytes = await get(new URL(e.file, indexUrl).toString());
      if ((await sha256(bytes)) !== e.sha256) throw new Error(`${e.pkg} ${e.version}: download does not match its hash`);
      await mkdir(dirname(local), { recursive: true });
      await writeFile(local, bytes);
    }
    files[e.pkg] = local;
  }
  await writeFile(join(dir, "index.json"), indexText);
  return { index, files };
}
