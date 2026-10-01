// Runs one source end to end against the live site and prints what comes back:
//   bun scripts/try.ts <extension folder> <source id> [series id] [search text]
import { SourceHost, importExtension } from "@storm-sources/host";

const [folder, sourceId, mangaArg, searchText] = process.argv.slice(2);
if (!folder || !sourceId) {
  console.log("usage: bun scripts/try.ts <extension folder> <source id> [series id] [search text]");
  process.exit(1);
}

const ext = await importExtension(`${folder}/src/index.ts`);
const host = new SourceHost({
  onCall: (e) => console.log(`  · ${e.op} ${Math.round(e.ms)}ms${e.cached ? " (cached)" : ""}${e.ok ? "" : ` ✗ ${e.error?.kind}: ${e.error?.message}`}`),
});
host.register(ext);
const info = host.sources().find((s) => s.id === sourceId)!;
console.log(`${info.name} (${info.id}) — ${info.listings.map((l) => l.id).join(", ")}`);

const filters = await host.filters(sourceId);
console.log(`filters: ${filters.map((f) => `${f.id}${"options" in f ? `(${f.options.length})` : ""}`).join(", ")}`);
if (filters.find((f) => f.id === "tags" || f.id === "genres")) {
  const g = filters.find((f) => f.id === "tags" || f.id === "genres") as { options: { genre?: string }[] };
  console.log(`  genres mapped to storm: ${g.options.filter((o) => o.genre).length}/${g.options.length}`);
}

for (const l of info.listings) {
  const p = await host.list(sourceId, l.id, 1);
  console.log(`${l.id}: ${p.items.length} items, next=${p.hasNext} — ${p.items.slice(0, 3).map((m) => m.title).join(" | ")}`);
}

if (searchText) {
  const s = await host.search(sourceId, searchText);
  console.log(`search "${searchText}": ${s.items.slice(0, 5).map((m) => `${m.title} [${m.id}]`).join(" | ")}`);
}

const first = (await host.list(sourceId, info.listings[0].id, 1)).items;
for (const candidate of mangaArg ? [mangaArg] : first.map((m) => m.id)) {
  const m = await host.manga(sourceId, candidate);
  const chapters = await host.chapters(sourceId, candidate);
  const readable = chapters.find((c) => !c.external);
  console.log(`\n${m.title} [${m.id}] ${m.type} ${m.status} ${m.year ?? ""}`);
  console.log(`  by ${m.authors.join(", ")} · genres: ${m.genres.map((g) => `${g.name}${g.key ? "" : "?"}`).join(", ")}`);
  console.log(`  ${chapters.length} chapters (${chapters.filter((c) => c.external).length} external), newest: ${chapters[0]?.number} ${chapters[0]?.date ?? ""}`);
  if (!readable) continue;
  const pages = await host.pages(sourceId, candidate, readable.id);
  console.log(`  chapter ${readable.number} has ${pages.length} pages, first: ${pages[0].url}`);
  const img = await host.image(sourceId, pages[0].url);
  console.log(`  first page: ${img.status} ${img.headers.get("content-type")} ${(await img.arrayBuffer()).byteLength} bytes`);
  break;
}
