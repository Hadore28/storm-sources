// منارة ST (v.sea-novels.com), a Blogger site. Its pages feed carries every page in
// full: a teacher's page per class year holds `var TEACHER` with its chapters, and
// each chapter page holds `var SERIES` with each lecture's servers.

import {
  SourceError,
  clean,
  defineExtension,
  defineStudySource,
  subjectKey,
  type Context,
  type Subject,
  type TeacherSummary,
  type Text,
} from "@storm-sources/sdk";
import { displayName, teacherKey, videoKind } from "../../feed";
import { withDirect } from "../../hosts";

const SITE = "https://v.sea-novels.com";
const L = (en: string, ar: string): Text => ({ en, ar });
const PER_PAGE = 24;

interface Page {
  id: string;
  title: string;
  body: string;
}
interface TeacherPage {
  page: string;
  year: string;
  name: string;
  img?: string;
  title: string;
  chapters: { name: string; page: string }[];
}

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const pageId = (link: string) => /\/p\/([^/.]+)\.html/.exec(link)?.[1] ?? "";

/** The `var NAME = {…}` object literal in a page, by brace matching. */
function objectOf(body: string, name: string) {
  const at = body.indexOf(`var ${name}`);
  if (at < 0) return null;
  const start = body.indexOf("{", at);
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth === 0) return body.slice(start, i + 1);
  }
  return null;
}

// titles rarely name the subject; the chapters do
const CHAPTER_WORDS: [Subject, RegExp][] = [
  ["math", /الاعداد المركبة|القطوع|التفاضل|التكامل|الهندسة الفضائية|المعادلات التفاضلية/],
  ["chemistry", /الثرموداينمك|الاتزان|الكيمياء|الحوامض|المحاليل/],
  ["physics", /المتسعات|الحث|التيار المتناوب|الموجات|البصريات/],
  ["biology", /الخلية|التكاثر|الوراثة|المناعة/],
  ["arabic", /الادب|النحو|البلاغة|التعجب|النداء|النفي|التقديم والتاخير/],
  ["english", /unit|english|انكليزي/i],
];

const subjectOf = (title: string, chapters: string[]): Subject | undefined =>
  subjectKey(title) ?? CHAPTER_WORDS.find(([, re]) => chapters.some((c) => re.test(c)))?.[0];

async function pages(ctx: Context): Promise<Page[]> {
  type Entry = { title: { $t: string }; content: { $t: string }; link: { rel: string; href: string }[] };
  const out: Page[] = [];
  for (let start = 1; ; start += 500) {
    const res = await ctx.http.json<{ feed: { entry?: Entry[] } }>(`${SITE}/feeds/pages/default`, {
      query: { alt: "json", "max-results": 500, "start-index": start },
      cacheMs: 30 * 60_000,
    });
    const entries = res.feed.entry ?? [];
    for (const e of entries) {
      const link = e.link.find((l) => l.rel === "alternate")?.href ?? "";
      out.push({ id: pageId(link), title: clean(e.title.$t), body: e.content.$t });
    }
    if (entries.length < 500) return out;
  }
}

function teacherPages(all: Page[]): TeacherPage[] {
  return all.flatMap((p) => {
    const obj = objectOf(p.body, "TEACHER");
    if (!obj) return [];
    const name = decode(/name\s*:\s*"([^"]*)"/.exec(obj)?.[1] ?? "");
    const year = /\b(20\d\d)\b/.exec(p.title)?.[1] ?? "";
    const chapters = [...obj.matchAll(/\{\s*name\s*:\s*"([^"]*)"\s*,\s*link\s*:\s*"([^"]*)"/g)]
      .map((m) => ({ name: clean(decode(m[1])), page: pageId(m[2]) }))
      .filter((c) => c.page);
    if (!name || !year) return [];
    return [{ page: p.id, year, name, img: /img\s*:\s*"(https?:[^"]+)"/.exec(obj)?.[1], title: p.title, chapters }];
  });
}

async function teachers(ctx: Context) {
  const all = await pages(ctx);
  const byId = new Map(all.map((p) => [p.id, p]));
  const out = new Map<string, { summary: TeacherSummary; courses: TeacherPage[] }>();
  for (const t of teacherPages(all)) {
    const key = teacherKey(t.name);
    let e = out.get(key);
    if (!e) {
      e = { summary: { id: key, title: displayName(t.name), years: [], lectureCount: 0 }, courses: [] };
      out.set(key, e);
    }
    e.summary.cover ??= t.img;
    e.summary.subject ??= subjectOf(t.title, t.chapters.map((c) => c.name));
    if (!e.summary.years!.includes(t.year)) e.summary.years!.push(t.year);
    e.summary.lectureCount! += t.chapters.reduce((n, c) => n + episodesOf(byId.get(c.page)?.body ?? "").filter((ep) => ep.servers.length).length, 0);
    e.courses.push(t);
  }
  for (const e of out.values()) {
    e.summary.years!.sort().reverse();
    e.courses.sort((a, b) => b.year.localeCompare(a.year));
  }
  return out;
}

interface Episode {
  num: number;
  servers: { name: string; url: string }[];
}

function episodesOf(body: string): Episode[] {
  const obj = objectOf(body, "SERIES");
  if (!obj) return [];
  return [...obj.matchAll(/\{\s*num\s*:\s*(\d+)\s*,\s*servers\s*:\s*\[([\s\S]*?)\]\s*\}/g)].map((m) => ({
    num: Number(m[1]),
    servers: [...m[2].matchAll(/\{\s*name\s*:\s*"([^"]*)"\s*,\s*url\s*:\s*"([^"]*)"\s*\}/g)].map((s) => ({ name: decode(s[1]), url: decode(s[2]) })),
  }));
}

const lectureTitle = (n: number) => (n === 0 ? "المقدمة" : `المحاضرة ${n}`);

function paged(items: TeacherSummary[], page: number) {
  const start = (page - 1) * PER_PAGE;
  return { items: items.slice(start, start + PER_PAGE), hasNext: items.length > start + PER_PAGE };
}

const manara = defineStudySource({
  id: "manara-st",
  name: "منارة ST",
  lang: "ar",
  baseUrl: SITE,
  listings: [{ id: "teachers", label: L("Teachers", "المدرسون"), filters: true }],
  filters: [
    {
      id: "year",
      type: "select",
      label: L("Class of", "الدفعة"),
      options: [{ value: "", label: L("All", "الكل") }, ...["2027", "2026", "2025"].map((y) => ({ value: y, label: y }))],
      default: "",
    },
  ],
  searchFilters: true,

  async list(ctx, { page, filters }) {
    const year = typeof filters.year === "string" ? filters.year : "";
    return paged([...(await teachers(ctx)).values()].map((e) => e.summary).filter((t) => !year || t.years?.includes(year)), page);
  },

  async search(ctx, { query, page }) {
    const q = teacherKey(query);
    return paged([...(await teachers(ctx)).values()].map((e) => e.summary).filter((t) => t.id.includes(q)), page);
  },

  async details(ctx, id) {
    const t = (await teachers(ctx)).get(id);
    if (!t) throw new SourceError("not-found", `منارة ST has no teacher ${id}`);
    return {
      ...t.summary,
      stage: "السادس الإعدادي",
      courses: t.courses.map((c) => ({ id: c.page, year: c.year, title: clean(c.title.replace(/^(جميع\s+)?محاضرات\s+/, "")) })),
    };
  },

  async lectures(ctx, id, coursePage) {
    const all = await pages(ctx);
    const course = teacherPages(all).find((t) => t.page === coursePage && teacherKey(t.name) === id);
    if (!course) throw new SourceError("not-found", `منارة ST: ${id} has no course ${coursePage}`);
    const byId = new Map(all.map((p) => [p.id, p]));
    return course.chapters.map((c) => ({
      id: c.page,
      title: c.name,
      lectures: episodesOf(byId.get(c.page)?.body ?? "").map((e) => ({
        id: `${c.page}:${e.num}`,
        number: e.num,
        title: lectureTitle(e.num),
        locked: e.servers.length === 0,
      })),
    }));
  },

  async servers(ctx, _id, lectureId) {
    const [chapterPage, num] = lectureId.split(":");
    const page = (await pages(ctx)).find((p) => p.id === chapterPage);
    const ep = page && episodesOf(page.body).find((e) => String(e.num) === num);
    if (!ep) throw new SourceError("not-found", `منارة ST has no lecture ${lectureId}`);
    return withDirect(ctx, ep.servers.filter((s) => /^https?:\/\//.test(s.url)).map((s) => ({ name: s.name, url: s.url, kind: videoKind(s.url) })));
  },
});

export default defineExtension({
  pkg: "storm.studysto.manarast",
  name: "منارة ST",
  version: "1.0.5",
  app: "studysto",
  sources: [manara],
});
