import { genreKey } from "./utils";
import type { GenreKey, Option, Text } from "./types";

/** How storm names each genre, in both site languages. */
export const GENRE_LABELS: Record<GenreKey, { en: string; ar: string }> = {
  action: { en: "Action", ar: "أكشن" },
  adventure: { en: "Adventure", ar: "مغامرة" },
  comedy: { en: "Comedy", ar: "كوميدي" },
  drama: { en: "Drama", ar: "دراما" },
  fantasy: { en: "Fantasy", ar: "فانتازيا" },
  horror: { en: "Horror", ar: "رعب" },
  mystery: { en: "Mystery", ar: "غموض" },
  romance: { en: "Romance", ar: "رومانسي" },
  scifi: { en: "Sci-fi", ar: "خيال علمي" },
  sliceOfLife: { en: "Slice of life", ar: "شريحة من الحياة" },
  sports: { en: "Sports", ar: "رياضة" },
  supernatural: { en: "Supernatural", ar: "خارق للطبيعة" },
  thriller: { en: "Thriller", ar: "إثارة" },
  tragedy: { en: "Tragedy", ar: "مأساة" },
  psychological: { en: "Psychological", ar: "نفسي" },
  historical: { en: "Historical", ar: "تاريخي" },
  isekai: { en: "Isekai", ar: "إيسيكاي" },
  darkFantasy: { en: "Dark fantasy", ar: "فانتازيا مظلمة" },
  martialArts: { en: "Martial arts", ar: "فنون قتالية" },
  murim: { en: "Murim", ar: "موريم" },
  cultivation: { en: "Cultivation", ar: "زراعة الطاقة" },
  school: { en: "School life", ar: "حياة مدرسية" },
  mecha: { en: "Mecha", ar: "ميكا" },
  music: { en: "Music", ar: "موسيقى" },
  cooking: { en: "Cooking", ar: "طبخ" },
  medical: { en: "Medical", ar: "طبي" },
  military: { en: "Military", ar: "عسكري" },
  crime: { en: "Crime", ar: "جريمة" },
  magic: { en: "Magic", ar: "سحر" },
  reincarnation: { en: "Reincarnation", ar: "تناسخ" },
  timeTravel: { en: "Time travel", ar: "سفر عبر الزمن" },
  villainess: { en: "Villainess", ar: "الشريرة" },
  gameWorld: { en: "Game world", ar: "عالم الألعاب" },
  superhero: { en: "Superhero", ar: "أبطال خارقون" },
  survival: { en: "Survival", ar: "نجاة" },
  apocalypse: { en: "Apocalypse", ar: "نهاية العالم" },
  monsters: { en: "Monsters", ar: "وحوش" },
  vampires: { en: "Vampires", ar: "مصاصو دماء" },
  demons: { en: "Demons and gods", ar: "شياطين وآلهة" },
  zombies: { en: "Zombies", ar: "زومبي" },
  harem: { en: "Harem", ar: "حريم" },
  reverseHarem: { en: "Reverse harem", ar: "حريم عكسي" },
  boysLove: { en: "Boys' love", ar: "حب الفتيان" },
  girlsLove: { en: "Girls' love", ar: "حب الفتيات" },
  gender: { en: "Gender bender", ar: "تبادل الجنس" },
  office: { en: "Office", ar: "مكتب" },
  family: { en: "Family", ar: "عائلي" },
  revenge: { en: "Revenge", ar: "انتقام" },
  workplace: { en: "Workplace", ar: "عمل" },
  ecchi: { en: "Ecchi", ar: "إيتشي" },
  mature: { en: "Mature", ar: "للبالغين" },
  gore: { en: "Gore", ar: "دموي" },
};

/**
 * Turns a site's own genre list into one tidy filter: every genre that matches a
 * storm genre appears once, under storm's name, and its value carries all the
 * site ids it stands for (joined with `join`). Genres storm doesn't know are
 * left out of the filter, so they can't clutter it.
 */
export function genreOptions(list: { id: string | number; name: string }[], join = ","): Option[] {
  const byKey = new Map<GenreKey, string[]>();
  for (const g of list) {
    const key = genreKey(g.name);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), String(g.id)]);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => GENRE_LABELS[a].en.localeCompare(GENRE_LABELS[b].en))
    .map(([key, ids]) => ({ value: ids.join(join), label: GENRE_LABELS[key] as Text, genre: key }));
}

/** Splits a value made by genreOptions back into site ids. */
export const genreIds = (values: string[] | undefined, join = ",") => (values ?? []).flatMap((v) => v.split(join)).filter(Boolean);
