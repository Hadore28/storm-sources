// Pure helpers extensions bundle with them. Each one understands English and
// Arabic, since most storm sources publish in one or the other.

import type { AnimeType, Demographic, GenreKey, MangaType, Status } from "./types";

/** "١٢٫٥" → "12.5" (Arabic-Indic and Persian digits) */
export function asciiDigits(text: string) {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

/** Collapses whitespace and trims. */
export function clean(text: string | null | undefined) {
  return (text ?? "").replace(/[\s ​-‏]+/g, " ").trim();
}

export function absUrl(base: string, href: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

const CHAPTER_WORDS = /(?:chapter|chap|ch\.?|ep(?:isode)?\.?|الفصل|فصل|الحلقة|#)\s*[:.\-]?\s*(\d+(?:[.,]\d+)?)/i;

/** "Chapter 12.5 - The end" → 12.5; "الفصل ٤٢" → 42 */
export function chapterNumber(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const s = asciiDigits(text);
  const m = s.match(CHAPTER_WORDS) ?? s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

// ---------- dates ----------

const UNIT_MS = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};
type Unit = keyof typeof UNIT_MS;

// Arabic has singular, dual and plural forms; the dual means two.
const AR_UNITS: [RegExp, Unit, number?][] = [
  [/ثانيتين/, "second", 2], [/ثوان|ثواني|ثانية/, "second"],
  [/دقيقتين/, "minute", 2], [/دقائق|دقيقة/, "minute"],
  [/ساعتين/, "hour", 2], [/ساعات|ساعة/, "hour"],
  [/يومين/, "day", 2], [/أيام|ايام|يوم/, "day"],
  [/أسبوعين|اسبوعين/, "week", 2], [/أسابيع|اسابيع|أسبوع|اسبوع/, "week"],
  [/شهرين/, "month", 2], [/أشهر|اشهر|شهور|شهر/, "month"],
  [/سنتين|عامين/, "year", 2], [/سنوات|سنين|سنة|أعوام|اعوام|عام/, "year"],
];

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  "يناير": 0, "فبراير": 1, "مارس": 2, "أبريل": 3, "ابريل": 3, "إبريل": 3, "مايو": 4, "يونيو": 5, "يونيه": 5,
  "يوليو": 6, "يوليه": 6, "أغسطس": 7, "اغسطس": 7, "سبتمبر": 8, "أكتوبر": 9, "اكتوبر": 9, "نوفمبر": 10, "ديسمبر": 11,
  "كانون الثاني": 0, "شباط": 1, "آذار": 2, "اذار": 2, "نيسان": 3, "أيار": 4, "ايار": 4, "حزيران": 5,
  "تموز": 6, "آب": 7, "أيلول": 8, "ايلول": 8, "تشرين الأول": 9, "تشرين الاول": 9, "تشرين الثاني": 10, "كانون الأول": 11, "كانون الاول": 11,
};

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Reads the dates sites print: ISO, "Oct 1, 2026", "01/10/2026", "3 days ago",
 * "منذ يومين", "أمس", "15 سبتمبر 2026". Returns an ISO string, or undefined.
 */
export function parseDate(text: string | null | undefined, now: number = Date.now()): string | undefined {
  if (!text) return undefined;
  const s = clean(asciiDigits(text)).toLowerCase();
  if (!s) return undefined;

  if (/^(just now|now|الآن|الان|للتو)$/.test(s)) return iso(now);
  if (/^(today|اليوم)$/.test(s)) return iso(now);
  if (/^(yesterday|أمس|امس|البارحة)$/.test(s)) return iso(now - UNIT_MS.day);

  const en = s.match(/(\d+|an?|one)\s*(second|sec|minute|min|hour|hr|day|week|wk|month|mo|year|yr)s?\.?\s*ago/);
  if (en) {
    const n = /^\d+$/.test(en[1]) ? Number(en[1]) : 1;
    const key = ({ sec: "second", min: "minute", hr: "hour", wk: "week", mo: "month", yr: "year" } as Record<string, Unit>)[en[2]] ?? (en[2] as Unit);
    return iso(now - n * UNIT_MS[key]);
  }

  if (/(منذ|قبل)/.test(s)) {
    for (const [re, unit, dual] of AR_UNITS) {
      if (!re.test(s)) continue;
      const num = s.match(/(\d+)/);
      return iso(now - (dual ?? (num ? Number(num[1]) : 1)) * UNIT_MS[unit]);
    }
  }

  // 2026-10-01, 2026/10/01
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // 01/10/2026 — sites in these languages write day first
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return iso(Date.UTC(+m[3], +m[2] - 1, +m[1]));

  // month names, either order: "15 سبتمبر 2026", "October 1, 2026", "1 Oct 2026"
  for (const [name, month] of Object.entries(MONTHS)) {
    const at = name.length === 3 ? s.search(new RegExp(`\\b${name}[a-z]*\\.?`)) : s.indexOf(name);
    if (at < 0) continue;
    const year = s.match(/(\d{4})/);
    const day = s.replace(year?.[1] ?? "", "").match(/(\d{1,2})/);
    if (year) return iso(Date.UTC(+year[1], month, day ? +day[1] : 1));
  }

  const t = Date.parse(text);
  return Number.isNaN(t) ? undefined : iso(t);
}

// ---------- labels ----------

export function status(text: string | null | undefined): Status {
  const s = clean(text).toLowerCase();
  if (!s) return "unknown";
  if (/(ongoing|publishing|releasing|مستمر|مستمرة|جاري|جارية|يصدر|قيد النشر)/.test(s)) return "ongoing";
  if (/(completed|complete|finished|ended|مكتمل|مكتملة|منتهي|منتهية|انتهت)/.test(s)) return "completed";
  if (/(hiatus|on hold|paused|متوقف|متوقفة|موقوف)/.test(s)) return "hiatus";
  if (/(cancel|dropped|ملغي|ملغاة|ملغية|متروك)/.test(s)) return "cancelled";
  return "unknown";
}

export function mangaType(text: string | null | undefined): MangaType | undefined {
  const s = clean(text).toLowerCase();
  if (!s) return undefined;
  if (/(manhwa|مانهوا|كوري|webtoon|ويب تون)/.test(s)) return "manhwa";
  if (/(manhua|مانها|صيني)/.test(s)) return "manhua";
  if (/(manga|مانجا|مانغا|ياباني)/.test(s)) return "manga";
  if (/(comic|كوميك)/.test(s)) return "comic";
  return "other";
}

/**
 * Folds the spellings Arabic sites mix freely: hamza forms, alef maqsura, taa
 * marbuta, tatweel, diacritics and the definite article. "الأكشن" and "اكشن"
 * both become "اكشن".
 */
export function foldArabic(text: string) {
  return clean(text)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .split(" ")
    .map((w) => (w.length > 4 && w.startsWith("ال") ? w.slice(2) : w))
    .join(" ");
}

// Each storm genre with the names sites give it, in English and Arabic.
const GENRE_NAMES: Record<GenreKey, string[]> = {
  action: ["action", "أكشن", "اكشن", "حركة", "قتال", "خيال اكشن"],
  adventure: ["adventure", "مغامرة", "مغامرات"],
  comedy: ["comedy", "كوميدي", "كوميديا", "كوميدا"],
  drama: ["drama", "دراما", "درما", "دراما شوجو", "دراما اجتماعية", "دراما حضرية"],
  fantasy: ["fantasy", "فانتازيا", "فنتازيا", "خيال", "خيالي", "خيال شرقي", "فانتزيا", "خيال حضري"],
  horror: ["horror", "رعب", "كوابيس"],
  mystery: ["mystery", "detective", "تحري", "غموض", "تحقيق", "تحقيقات", "بوليسي", "لغز", "غامض", "أسرار"],
  romance: ["romance", "رومانسي", "رومانسية", "رومنسي", "رومانس", "عاطفي", "حب", "علاقة عاطفية"],
  scifi: ["sci-fi", "scifi", "كتب الخيال العلمي", "كتب الخيال العلم", "science fiction", "خيال علمي", "كائنات فضائية", "كواكب"],
  sliceOfLife: ["slice of life", "شريحة حياة", "شريحة من الحياة", "حياة يومية", "الحياة اليومية"],
  sports: ["sports", "sport", "رياضة وتسالي", "رياضة", "رياضي", "رياضية"],
  supernatural: ["supernatural", "خارق للطبيعة", "خارق لطبيعية", "خارق للطبيعية", "خوارق", "ما وراء الطبيعة", "قوى خارقة", "قوة خارقة", "خارق", "أشباح", "الأرواح", "خيال خارق"],
  thriller: ["thriller", "إثارة", "تشويق", "suspense"],
  tragedy: ["tragedy", "تراجدي", "مأساة", "مأساوي", "تراجيدي", "تراجيديا", "بؤس"],
  psychological: ["psychological", "نفسي", "نفسية", "فلسفي", "هوس", "تشويق نفسي", "دراما نفسية", "غموض نفسي", "أكشن نفسي"],
  historical: ["historical", "تاريخ وجغرافيا", "تاريخ", "history", "تاريخي", "تاريخية", "تارخي", "عصور وسطى", "فيكتوري", "عصر فيكتوري", "عصر جوسون", "نبلاء"],
  isekai: ["isekai", "إيسيكاي", "ايسكاي", "ايسياكي", "عالم آخر", "عالم مختلف", "داخل اللعبة", "السفر عبر الأبعاد"],
  darkFantasy: ["dark fantasy", "مظلمة", "مظلم", "فانتازيا مظلمة", "عالم مظلم", "سوداوي"],
  martialArts: ["martial arts", "فنون قتالية", "فنون قتال", "فنون القتال", "ساموراي", "نينجا"],
  murim: ["murim", "موريم"],
  cultivation: ["cultivation", "wuxia", "xianxia", "xuanhuan", "شوانهوان", "زيانشيا", "ووشيا", "شيانشيا", "صقل", "زراعة"],
  school: ["school life", "school", "مدرسي", "مدرسية", "حياة مدرسية", "الحياة المدرسية", "أكاديمي", "أكاديمية", "حياة جامعية", "مدرسة ثانوية", "خيال مدرسي", "طالب"],
  mecha: ["mecha", "ميكا", "روبوتات", "آليات"],
  music: ["music", "musical", "موسيقى", "موسيقي", "ايدول"],
  cooking: ["cooking", "طبخ وطعام", "طبخ", "طهي"],
  medical: ["medical", "صحة وطب", "طب", "طبي", "طبية"],
  military: ["military", "war", "علوم عسكرية", "عسكري", "عسكرية", "حربي", "حرب", "حروب"],
  crime: ["crime", "جريمة", "جرائم", "مافيا"],
  magic: ["magic", "سحر", "مستحضر أرواح"],
  reincarnation: ["reincarnation", "regression", "returner", "تناسخ", "تناسخ الأرواح", "تجسد", "تجسيد", "إعادة تجسد", "إعادة إحياء", "عودة بالزمن", "تراجع بالزمن", "تراجع", "رجوع بالزمن", "العودة", "إحياء"],
  timeTravel: ["time travel", "السفر عبر الزمن", "سفر عبر الزمن", "تلاعب زمني", "زمكاني", "زمنكاني"],
  villainess: ["villainess", "الشريرة"],
  gameWorld: ["game", "games", "video games", "system", "ألعاب", "لعبة", "نظام", "زنزانات", "dungeons", "ألعاب فيديو", "نظام ألعاب", "عالم لعبة", "واقع افتراضي"],
  superhero: ["superhero", "أبطال خارقين", "بطل خارق"],
  survival: ["survival", "نجاة", "بقاء"],
  apocalypse: ["post-apocalyptic", "apocalypse", "نهاية العالم", "ما بعد الكارثة", "بعد الكارثة"],
  monsters: ["monsters", "monster", "وحوش", "تنانين"],
  vampires: ["vampires", "vampire", "مصاص دماء", "مصاصي دماء", "مصاصو دماء", "مصاصي الدماء"],
  demons: ["demons", "demon", "شياطين", "ملائكة", "آلهة", "اساطير"],
  zombies: ["zombies", "zombie", "زومبي"],
  harem: ["harem", "حريم"],
  reverseHarem: ["reverse harem", "حريم عكسي"],
  boysLove: ["boys' love", "boys love", "yaoi", "bl", "shounen ai", "ياوي"],
  girlsLove: ["girls' love", "girls love", "yuri", "gl", "shoujo ai", "يوري"],
  gender: ["gender bender", "genderswap", "جندر بندر", "تحول جنسي", "تبادل أجساد"],
  office: ["office workers", "office", "مكتب", "مكتبي", "موظفين"],
  family: ["family", "عائلي", "عائلة", "رعاية أطفال"],
  revenge: ["revenge", "انتقام", "ثأر"],
  workplace: ["workplace", "work life", "عمل"],
  ecchi: ["ecchi", "إيتشي", "اتشي", "ايشي"],
  mature: ["mature", "adult", "smut", "للكبار", "ناضج", "للبالغين", "بالغ", "بالغين", "راشد"],
  gore: ["gore", "دموي", "دماء", "عنف"],
  documentary: ["documentary", "وثائقي", "وثائقية", "افلام وثائقية"],
  animation: ["animation", "animated", "أنيميشن", "انميشن", "رسوم متحركة", "كرتون", "كارتون"],
  biography: ["biography", "بيوغرافيا ومذكرات", "biographies", "memoir", "سيرة ذاتية", "سيرة", "سير وتراجم", "تراجم", "مذكرات", "السيرة النبوية"],
  western: ["western", "ويسترن", "الغرب الأمريكي", "غرب امريكي"],
  kids: ["kids", "children", "كتب أطفال", "أطفال", "للأطفال", "كتب الأطفال", "قصص أطفال"],
  poetry: ["poetry", "poems", "شعر", "الشعر", "دواوين", "دواوين شعرية", "ديوان"],
  philosophy: ["philosophy", "كتب الفلسفة", "فلسفة", "الفلسفة", "فكر", "الفكر"],
  religion: ["religion", "religious", "كتب دينية", "علوم إسلامية", "islam", "islamic", "دين", "ديني", "دينية", "إسلامي", "إسلامية", "كتب إسلامية", "الأديان", "العقيدة", "الفقه", "التفسير", "الحديث"],
  science: ["science", "sciences", "العلوم والطبيعة", "علوم", "العلوم", "كتب علمية", "علم"],
  selfHelp: ["self-help", "self help", "كتب التنمية البشرية", "personal development", "تنمية بشرية", "التنمية البشرية", "تطوير الذات", "تنمية ذاتية", "علم النفس"],
  politics: ["politics", "political", "كتب سياسية", "سياسة", "سياسي", "السياسة", "كتب سياسية"],
  economics: ["economics", "business", "إقتصاد وأعمال", "اقتصاد وأعمال", "اقتصاد", "الاقتصاد", "إدارة أعمال", "ادارة", "المال والأعمال"],
  literature: ["literature", "fiction", "أدب مترجم", "novels", "أدب", "الأدب", "روايات", "رواية", "قصص", "أدب عربي", "الأدب العربي", "الأدب العالمي", "قصص قصيرة"],
};

const GENRE_LOOKUP = new Map<string, GenreKey>();
for (const [key, names] of Object.entries(GENRE_NAMES) as [GenreKey, string[]][]) {
  for (const n of names) GENRE_LOOKUP.set(foldArabic(n), key);
}

/** Maps a site's genre name to a storm genre, when one matches. */
export function genreKey(name: string): GenreKey | undefined {
  return GENRE_LOOKUP.get(foldArabic(name));
}

/** Reads a demographic label such as "Shounen" or "شونين". */
export function demographic(text: string | null | undefined): Demographic | undefined {
  const s = foldArabic(text ?? "");
  if (/(shounen|shonen|شونين)/.test(s)) return "shounen";
  if (/(shoujo|shojo|شوجو)/.test(s)) return "shoujo";
  if (/(seinen|سينين|شينين|سنين)/.test(s)) return "seinen";
  if (/(josei|جوسي|جوسين)/.test(s)) return "josei";
  return undefined;
}
export function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Reads an anime type such as "TV", "Movie", "OVA" or "فيلم". */
export function animeType(text: string | null | undefined): AnimeType | undefined {
  const s = foldArabic(text ?? "");
  if (!s) return undefined;
  if (/(ova|اوفا|او في اي)/.test(s)) return "ova";
  if (/(ona|اونا)/.test(s)) return "ona";
  if (/(special|خاصه|خاص|سبيشل)/.test(s)) return "special";
  if (/(movie|film|فيلم|افلام)/.test(s)) return "movie";
  if (/(\btv\b|series|مسلسل|تلفزيوني|تي في)/.test(s)) return "tv";
  return "other";
}

const ORDINALS: [RegExp, number][] = [
  [/حادي عشر|الحادي عشر/, 11], [/ثاني عشر|الثاني عشر|ثانى عشر/, 12], [/ثالث عشر/, 13], [/رابع عشر/, 14], [/خامس عشر/, 15],
  [/سادس عشر/, 16], [/سابع عشر/, 17], [/ثامن عشر/, 18], [/تاسع عشر/, 19], [/عشرون|العشرين/, 20],
  [/(?:^|\s)(?:ال)?[اأ]ول(?:ى)?(?:\s|$)/, 1], [/(?:^|\s)(?:ال)?ثان[يى](?:ة)?(?:\s|$)/, 2], [/(?:^|\s)(?:ال)?ثالث/, 3], [/(?:^|\s)(?:ال)?رابع/, 4],
  [/(?:^|\s)(?:ال)?خامس/, 5], [/(?:^|\s)(?:ال)?سادس/, 6], [/(?:^|\s)(?:ال)?سابع/, 7], [/(?:^|\s)(?:ال)?ثامن/, 8], [/(?:^|\s)(?:ال)?تاسع/, 9], [/(?:^|\s)(?:ال)?عاشر/, 10],
];

/** A season's number from "S02", "Season 2", "الموسم 25" or "الموسم الثاني". */
export function seasonNumber(text: string | null | undefined): number | undefined {
  const s = asciiDigits(clean(text));
  if (!s) return undefined;
  const latin = s.match(/(?:\bs|season\s*)(\d{1,3})\b/i);
  if (latin) return Number(latin[1]);
  const arabic = s.match(/(?:الموسم|موسم)\s+(.{1,20})/);
  if (!arabic) return undefined;
  const digits = arabic[1].match(/^(\d{1,3})/);
  if (digits) return Number(digits[1]);
  return ORDINALS.find(([re]) => re.test(` ${arabic[1]} `))?.[1];
}

/** The first plausible year in a text: "2024", "(2019)", "٢٠٢٣". */
export function year(text: string | null | undefined): number | undefined {
  const m = asciiDigits(text ?? "").match(/\b(19[0-9]{2}|20[0-9]{2})\b/);
  return m ? Number(m[1]) : undefined;
}

/** A running time in minutes: "2h 46m", "166 min", "120 دقيقة", "ساعة و 30 دقيقة". */
export function minutes(text: string | null | undefined): number | undefined {
  const s = asciiDigits(clean(text)).toLowerCase();
  if (!s) return undefined;
  const h = s.match(/(\d+)\s*(?:hours?|hrs?|h(?![a-z])|ساعات|ساعة|س(?![؀-ۿ]))/) ?? (/(^|\s)ساعة/.test(s) ? ["", "1"] : null);
  const m = s.match(/(\d+)\s*(?:minutes?|mins?|m(?![a-z])|دقائق|دقيقة|د(?![؀-ۿ]))/);
  if (h || m) return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0) || undefined;
  const bare = s.match(/^(\d{2,3})$/);
  return bare ? Number(bare[1]) : undefined;
}
