// Shared by sources that publish their lectures as one JSON feed per class year:
// { teachers: [{ name, subject, image, classes: [{ name, lectures: [{ title, url }] }] }] }

import {
  SourceError,
  clean,
  defineStudySource,
  subjectKey,
  type Context,
  type FilterDef,
  type LectureChapter,
  type StudySource,
  type TeacherDetails,
  type TeacherSummary,
  type Text,
  type VideoServer,
} from "@storm-sources/sdk";
import { withDirect } from "./hosts";

export interface FeedLecture {
  title?: string;
  url?: string;
  description?: string;
}
export interface FeedTeacher {
  name?: string;
  subject?: string;
  image?: string;
  classes?: { name?: string; lectures?: FeedLecture[] }[];
}
export interface Feed {
  teachers?: FeedTeacher[];
}

interface FeedSourceOptions {
  id: string;
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
  /** each class year's feed */
  years: Record<string, (ctx: Context) => Promise<Feed>>;
  locked: (url: string) => boolean;
  servers: (ctx: Context, url: string) => Promise<VideoServer[]>;
}

const L = (en: string, ar: string): Text => ({ en, ar });
const PER_PAGE = 24;

/** A teacher's name without the title, year or spelling variants, so one teacher is one id across years. */
export function teacherKey(name: string) {
  return displayName(name).replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ـ/g, "").replace(/\s+/g, "");
}
export function displayName(name: string) {
  return clean(name).replace(/^أ\s*\.\s*/, "").replace(/\b20\d\d\b/g, "").replace(/\s+/g, " ").trim();
}

const SUBJECT_OPTIONS = [
  ["math", L("Math", "الرياضيات")],
  ["physics", L("Physics", "الفيزياء")],
  ["chemistry", L("Chemistry", "الكيمياء")],
  ["biology", L("Biology", "الأحياء")],
  ["arabic", L("Arabic", "اللغة العربية")],
  ["english", L("English", "اللغة الإنكليزية")],
  ["islamic", L("Islamic studies", "التربية الإسلامية")],
] as const;

const lectureNumber = (title: string, index: number) => {
  const m = /(?:المحاضرة|محاضرة|lecture)\s*(\d+)|(\d+)\s*(?:المحاضرة|محاضرة)/i.exec(title);
  const n = Number(m?.[1] ?? m?.[2]);
  return Number.isFinite(n) && n > 0 ? n : index + 1;
};

export function feedSource(o: FeedSourceOptions): StudySource {
  const yearIds = Object.keys(o.years).sort().reverse();

  async function all(ctx: Context) {
    const out = new Map<string, { summary: TeacherSummary; byYear: Map<string, FeedTeacher> }>();
    for (const year of yearIds) {
      const feed = await o.years[year](ctx);
      for (const t of feed.teachers ?? []) {
        const key = teacherKey(t.name ?? "");
        if (!key) continue;
        let e = out.get(key);
        if (!e) {
          e = { summary: { id: key, title: displayName(t.name ?? ""), years: [], lectureCount: 0 }, byYear: new Map() };
          out.set(key, e);
        }
        const s = e.summary;
        s.cover ??= /^https?:\/\//.test(t.image ?? "") ? t.image : undefined;
        s.subject ??= subjectKey(t.subject);
        s.subjectName ??= clean(t.subject).replace(/^مدرس[ةه]?\s*مادة\s*/, "").replace(/\b20\d\d\b/g, "").trim() || undefined;
        s.years!.push(year);
        s.lectureCount! += (t.classes ?? []).reduce((n, c) => n + (c.lectures ?? []).filter((l) => l.url && !o.locked(l.url)).length, 0);
        e.byYear.set(year, t);
      }
    }
    return out;
  }

  async function teacher(ctx: Context, id: string) {
    const t = (await all(ctx)).get(id);
    if (!t) throw new SourceError("not-found", `${o.name} has no teacher ${id}`);
    return t;
  }

  const filters: FilterDef[] = [
    { id: "subject", type: "select", label: L("Subject", "المادة"), options: [{ value: "", label: L("All", "الكل") }, ...SUBJECT_OPTIONS.map(([value, label]) => ({ value, label }))], default: "" },
    { id: "year", type: "select", label: L("Class of", "الدفعة"), options: [{ value: "", label: L("All", "الكل") }, ...yearIds.map((y) => ({ value: y, label: y }))], default: "" },
  ];

  async function page(ctx: Context, pageNo: number, keep: (t: TeacherSummary) => boolean) {
    const items = [...(await all(ctx)).values()].map((e) => e.summary).filter(keep);
    const start = (pageNo - 1) * PER_PAGE;
    return { items: items.slice(start, start + PER_PAGE), hasNext: items.length > start + PER_PAGE };
  }

  return defineStudySource({
    id: o.id,
    name: o.name,
    lang: "ar",
    baseUrl: o.baseUrl,
    headers: o.headers,
    listings: [{ id: "teachers", label: L("Teachers", "المدرسون"), filters: true }],
    filters,
    searchFilters: true,

    list(ctx, { page: p, filters: f }) {
      const subject = typeof f.subject === "string" ? f.subject : "";
      const year = typeof f.year === "string" ? f.year : "";
      return page(ctx, p, (t) => (!subject || t.subject === subject) && (!year || !!t.years?.includes(year)));
    },

    search(ctx, { query, page: p }) {
      const q = teacherKey(query);
      return page(ctx, p, (t) => t.id.includes(q) || (t.subjectName ?? "").includes(query.trim()));
    },

    async details(ctx, id): Promise<TeacherDetails> {
      const { summary, byYear } = await teacher(ctx, id);
      return {
        ...summary,
        stage: "السادس الإعدادي",
        courses: [...byYear.entries()].map(([year, t]) => ({
          id: year,
          year,
          title: `دفعة ${year}`,
          lectureCount: (t.classes ?? []).reduce((n, c) => n + (c.lectures ?? []).length, 0),
        })),
      };
    },

    async lectures(ctx, id, year): Promise<LectureChapter[]> {
      const t = (await teacher(ctx, id)).byYear.get(year);
      if (!t) throw new SourceError("not-found", `${o.name}: ${id} has no class of ${year}`);
      return (t.classes ?? []).map((c, ci) => ({
        id: `${year}:${ci}`,
        title: clean(c.name) || `الفصل ${ci + 1}`,
        lectures: (c.lectures ?? []).map((l, li) => {
          const title = clean(l.title);
          return { id: `${year}:${ci}:${li}`, number: lectureNumber(title, li), title: title || undefined, locked: !l.url || o.locked(l.url.trim()) };
        }),
      }));
    },

    async servers(ctx, id, lectureId) {
      const [year, ci, li] = lectureId.split(":");
      const url = (await teacher(ctx, id)).byYear.get(year)?.classes?.[Number(ci)]?.lectures?.[Number(li)]?.url?.trim();
      if (!url) throw new SourceError("not-found", `${o.name} has no lecture ${lectureId}`);
      if (o.locked(url)) throw new SourceError("unsupported", "This lecture is paid on the site");
      return withDirect(ctx, await o.servers(ctx, url));
    },
  });
}

/** What a plain video address is: an HLS playlist, a file, or a player page. */
export function videoKind(url: string): VideoServer["kind"] {
  if (/\.m3u8(\?|$)|\/playlist\.m3u8|\.smil\//i.test(url)) return "hls";
  if (/\.(mp4|webm|mkv)(\?|$)/i.test(url) || /\/releases\/download\//.test(url)) return "mp4";
  return "embed";
}
