import { describe, expect, test } from "bun:test";
import { decodeEntities, htmlToBlocks, textToBlocks } from "../src/text";
import { animeType, minutes, seasonNumber, year } from "../src/utils";

describe("htmlToBlocks", () => {
  test("paragraphs, headings, quotes, breaks and images", () => {
    const html = `<div><h3>الفصل 1</h3><p>سطر&nbsp;أول<br>سطر ثاني</p><script>alert(1)</script><blockquote><p>اقتباس</p></blockquote><hr><img src="/a.jpg" alt="صورة"><p></p><p>&#1575;&amp; done</p></div>`;
    expect(htmlToBlocks(html, "https://x.com/n/1")).toEqual([
      { type: "heading", text: "الفصل 1" },
      { type: "p", text: "سطر أول" },
      { type: "p", text: "سطر ثاني" },
      { type: "quote", text: "اقتباس" },
      { type: "break" },
      { type: "image", src: "https://x.com/a.jpg", alt: "صورة" },
      { type: "p", text: "ا& done" },
    ]);
  });

  test("drops scripts, styles, forms and ad frames", () => {
    const html = `<p>keep</p><style>p{}</style><form><input value="x">no</form><iframe src="ad"></iframe><ins>ad</ins>`;
    expect(htmlToBlocks(html)).toEqual([{ type: "p", text: "keep" }]);
  });

  test("never ends on a break", () => {
    expect(htmlToBlocks("<p>a</p><hr><hr>")).toEqual([{ type: "p", text: "a" }]);
  });
});

test("decodeEntities", () => {
  expect(decodeEntities("&laquo;&#1575;&#x627;&raquo; &amp;&nbsp;&unknown;")).toBe("«اا» & &unknown;");
});

test("textToBlocks", () => {
  expect(textToBlocks("one\n\n  two  \r\nthree")).toEqual([
    { type: "p", text: "one" },
    { type: "p", text: "two" },
    { type: "p", text: "three" },
  ]);
});

describe("minutes", () => {
  test.each([
    ["2h 46m", 166],
    ["166 min", 166],
    ["120 دقيقة", 120],
    ["ساعة و 30 دقيقة", 90],
    ["2 ساعة 5 دقائق", 125],
    ["1h30m", 90],
    ["95", 95],
    ["", undefined],
  ])("%s", (text, expected) => expect(minutes(text)).toBe(expected));
});

describe("seasonNumber", () => {
  test.each([
    ["مسلسل FBI الموسم التاسع مترجم كامل", 9],
    ["مسلسل Family Guy الموسم 25 مترجم كامل", 25],
    ["مسلسل Breaking Bad الموسم الثانى مترجم", 2],
    ["مسلسل X الموسم الأول", 1],
    ["مسلسل X الموسم الحادي عشر", 11],
    ["fbi-s09", 9],
    ["Season 3", 3],
    ["مسلسل بلا موسم", undefined],
  ])("%s", (text, expected) => expect(seasonNumber(text)).toBe(expected));
});

test("year and animeType", () => {
  expect(year("Dune (2024)")).toBe(2024);
  expect(year("٢٠١٩")).toBe(2019);
  expect(year("no year")).toBeUndefined();
  expect(animeType("TV")).toBe("tv");
  expect(animeType("فيلم")).toBe("movie");
  expect(animeType("OVA")).toBe("ova");
});
