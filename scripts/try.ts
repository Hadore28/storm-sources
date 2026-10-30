// Runs one source end to end against the live site and prints what comes back:
//   bun scripts/try.ts <extension folder> <source id> [item id] [search text]
import type { AnimeDetails, BookDetails, FilmDetails, MangaDetails, NovelDetails } from "@storm-sources/sdk";
import { SourceHost, importExtension } from "@storm-sources/host";

const [folder, sourceId, itemArg, searchText] = process.argv.slice(2);
if (!folder || !sourceId) {
  console.log("usage: bun scripts/try.ts <extension folder> <source id> [item id] [search text]");
  process.exit(1);
}

const ext = await importExtension(`${folder}/src/index.ts`);
const host = new SourceHost({
  onCall: (e) => console.log(`  · ${e.op} ${Math.round(e.ms)}ms${e.cached ? " (cached)" : ""}${e.ok ? "" : ` ✗ ${e.error?.kind}: ${e.error?.message}`}`),
});
host.register(ext);
const info = host.sources().find((s) => s.id === sourceId)!;
console.log(`${info.name} (${info.id}, ${info.app}) — ${info.listings.map((l) => l.id).join(", ")}`);

const filters = await host.filters(sourceId);
console.log(`filters: ${filters.map((f) => `${f.id}${"options" in f ? `(${f.options.length})` : ""}`).join(", ")}`);
const g = filters.find((f) => f.id === "tags" || f.id === "genres" || f.id === "genre") as { options: { genre?: string }[] } | undefined;
if (g) console.log(`  genres mapped to storm: ${g.options.filter((o) => o.genre).length}/${g.options.length}`);

type Item = { id: string; title: string; cover?: string };
for (const l of info.listings) {
  const p = await host.list<Item>(sourceId, l.id, 1);
  console.log(`${l.id}: ${p.items.length} items, next=${p.hasNext}, covers=${p.items.filter((m) => m.cover).length} — ${p.items.slice(0, 3).map((m) => `${m.title} [${m.id}]`).join(" | ")}`);
}

if (searchText) {
  const s = await host.search<Item>(sourceId, searchText);
  console.log(`search "${searchText}": ${s.items.slice(0, 5).map((m) => `${m.title} [${m.id}]`).join(" | ")}`);
}

const genres = (list: { name: string; key?: string }[]) => list.map((x) => `${x.name}${x.key ? "" : "?"}`).join(", ");
const first = (await host.list<Item>(sourceId, info.listings[0].id, 1)).items;

for (const candidate of itemArg ? [itemArg] : first.slice(0, 1).map((m) => m.id)) {
  if (info.app === "mangasto") {
    const m = await host.details<MangaDetails>(sourceId, candidate);
    const chapters = await host.chapters(sourceId, candidate);
    console.log(`\n${m.title} [${m.id}] ${m.type} ${m.status} ${m.year ?? ""}\n  by ${m.authors.join(", ")} · genres: ${genres(m.genres)}`);
    console.log(`  ${chapters.length} chapters, newest: ${chapters[0]?.number} ${chapters[0]?.date ?? ""}`);
    const readable = chapters.find((c) => !c.external);
    if (readable) {
      const pages = await host.pages(sourceId, candidate, readable.id);
      const img = await host.image(sourceId, pages[0].url);
      console.log(`  chapter ${readable.number}: ${pages.length} pages, first ${img.status} ${img.headers.get("content-type")}`);
    }
  }
  if (info.app === "anisto") {
    const a = await host.details<AnimeDetails>(sourceId, candidate);
    console.log(`\n${a.title} [${a.id}] ${a.type} ${a.status} ${a.year ?? ""} · ${a.studios.join(", ")}\n  genres: ${genres(a.genres)}\n  ${a.description?.slice(0, 120)}`);
    const eps = await host.episodes(sourceId, candidate);
    console.log(`  ${eps.length} episodes: ${eps.slice(0, 3).map((e) => `${e.number} [${e.id}]`).join(", ")} … ${eps.at(-1)?.number}`);
    if (eps[0]) {
      const servers = await host.servers(sourceId, candidate, eps[0].id);
      for (const s of servers) console.log(`    ${s.kind} ${s.name} ${s.quality ?? ""} ${s.download ? "(download)" : ""} ${s.url}`);
    }
  }
  if (info.app === "movisto") {
    const f = await host.details<FilmDetails>(sourceId, candidate);
    console.log(`\n${f.title} [${f.id}] ${f.kind} ${f.year ?? ""} ${f.duration ?? ""}min score=${f.score ?? ""}\n  genres: ${genres(f.genres)} · cast: ${f.cast.slice(0, 4).join(", ")}\n  ${f.description?.slice(0, 120)}`);
    console.log(`  seasons: ${f.seasons.map((s) => `${s.number ?? "?"} [${s.id}]`).join(", ") || "none"}`);
    let episodeId: string | undefined;
    if (f.seasons.length) {
      const eps = await host.episodes(sourceId, candidate, f.seasons[0].id);
      console.log(`  season ${f.seasons[0].number}: ${eps.length} episodes: ${eps.slice(0, 3).map((e) => `${e.number} [${e.id}]`).join(", ")}`);
      episodeId = eps[0]?.id;
    }
    const servers = await host.servers(sourceId, candidate, episodeId);
    for (const s of servers) console.log(`    ${s.kind} ${s.name} ${s.quality ?? ""} ${s.download ? "(download)" : ""} ${s.url}`);
  }
  if (info.app === "novelsto") {
    const n = await host.details<NovelDetails>(sourceId, candidate);
    console.log(`\n${n.title} [${n.id}] ${n.status} · by ${n.authors.join(", ")} · translated by ${n.translators.join(", ")}\n  genres: ${genres(n.genres)}\n  ${n.description?.slice(0, 120)}`);
    const chapters = await host.chapters(sourceId, candidate);
    console.log(`  ${chapters.length} chapters, newest: ${chapters[0]?.number} [${chapters[0]?.id}] ${chapters[0]?.title ?? ""}, oldest: ${chapters.at(-1)?.number} [${chapters.at(-1)?.id}]`);
    const text = await host.content(sourceId, candidate, chapters.at(-1)!.id);
    console.log(`  "${text.title}": ${text.blocks.length} blocks — ${text.blocks.slice(0, 2).map((b) => ("text" in b ? b.text.slice(0, 80) : b.type)).join(" / ")}`);
  }
  if (info.app === "booksto") {
    const b = await host.details<BookDetails>(sourceId, candidate);
    console.log(`\n${b.title} [${b.id}] by ${b.authors.join(", ")} ${b.year ?? ""} · ${b.pages ?? "?"} pages · readable=${b.readable}\n  genres: ${genres(b.genres)}\n  files: ${b.files.map((f) => `${f.format} ${f.size ?? ""} ${f.url}`).join(" | ")}`);
    if (b.readable) {
      const sections = await host.chapters(sourceId, candidate);
      console.log(`  ${sections.length} sections: ${sections.slice(0, 3).map((s) => s.title ?? s.id).join(" | ")}`);
      const text = await host.content(sourceId, candidate, sections[0].id);
      console.log(`  ${text.blocks.length} blocks — ${text.blocks.slice(0, 2).map((x) => ("text" in x ? x.text.slice(0, 80) : x.type)).join(" / ")}`);
    }
  }
}
