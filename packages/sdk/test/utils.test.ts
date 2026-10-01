import { describe, expect, test } from "bun:test";
import { asciiDigits, chapterNumber, genreKey, mangaType, parseDate, status } from "../src/utils";

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0); // 1 Oct 2026, noon
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("asciiDigits", () => {
  test("Arabic-Indic and Persian digits", () => {
    expect(asciiDigits("الفصل ١٢٫٥")).toBe("الفصل 12.5");
    expect(asciiDigits("۴۲")).toBe("42");
  });
});

describe("chapterNumber", () => {
  test.each([
    ["Chapter 12", 12],
    ["Chapter 12.5 - The end", 12.5],
    ["Ch. 3", 3],
    ["ch.120", 120],
    ["الفصل ٤٢", 42],
    ["الفصل 7 : العودة", 7],
    ["#88", 88],
    ["105", 105],
    ["Vol.2 Chapter 14", 14],
  ])("%s → %d", (text, n) => expect(chapterNumber(text)).toBe(n));
  test("no number", () => expect(chapterNumber("Prologue")).toBeUndefined());
});

describe("parseDate", () => {
  test("relative English", () => {
    expect(parseDate("3 days ago", NOW)).toBe(daysAgo(3));
    expect(parseDate("an hour ago", NOW)).toBe(new Date(NOW - 3_600_000).toISOString());
    expect(parseDate("yesterday", NOW)).toBe(daysAgo(1));
  });
  test("relative Arabic, including the dual", () => {
    expect(parseDate("منذ 3 أيام", NOW)).toBe(daysAgo(3));
    expect(parseDate("منذ يومين", NOW)).toBe(daysAgo(2));
    expect(parseDate("منذ يوم", NOW)).toBe(daysAgo(1));
    expect(parseDate("منذ ساعتين", NOW)).toBe(new Date(NOW - 7_200_000).toISOString());
    expect(parseDate("قبل أسبوعين", NOW)).toBe(daysAgo(14));
    expect(parseDate("منذ ٥ دقائق", NOW)).toBe(new Date(NOW - 300_000).toISOString());
    expect(parseDate("أمس", NOW)).toBe(daysAgo(1));
  });
  test("absolute dates", () => {
    expect(parseDate("2026-09-15", NOW)).toBe("2026-09-15T00:00:00.000Z");
    expect(parseDate("15/09/2026", NOW)).toBe("2026-09-15T00:00:00.000Z");
    expect(parseDate("September 15, 2026", NOW)).toBe("2026-09-15T00:00:00.000Z");
    expect(parseDate("15 سبتمبر 2026", NOW)).toBe("2026-09-15T00:00:00.000Z");
    expect(parseDate("15 أيلول 2026", NOW)).toBe("2026-09-15T00:00:00.000Z");
    expect(parseDate("٢٠٢٦/٠٩/١٥", NOW)).toBe("2026-09-15T00:00:00.000Z");
  });
  test("nonsense", () => expect(parseDate("soon", NOW)).toBeUndefined());
});

describe("labels", () => {
  test("status", () => {
    expect(status("Ongoing")).toBe("ongoing");
    expect(status("مستمرة")).toBe("ongoing");
    expect(status("مكتملة")).toBe("completed");
    expect(status("متوقف")).toBe("hiatus");
    expect(status("???")).toBe("unknown");
  });
  test("type", () => {
    expect(mangaType("Manhwa")).toBe("manhwa");
    expect(mangaType("مانهوا")).toBe("manhwa");
    expect(mangaType("مانجا")).toBe("manga");
    expect(mangaType("مانها")).toBe("manhua");
  });
  test("genres in both languages", () => {
    expect(genreKey("Action")).toBe("action");
    expect(genreKey("أكشن")).toBe("action");
    expect(genreKey("خيال علمي")).toBe("scifi");
    expect(genreKey("Slice of Life")).toBe("sliceOfLife");
    expect(genreKey("School Life")).toBe("school");
    expect(genreKey("Gyaru")).toBeUndefined();
  });
});
