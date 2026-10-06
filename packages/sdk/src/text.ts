// Turns a site's chapter HTML into plain text blocks, so the site never renders
// markup from a source.

import type { TextBlock } from "./types";

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", zwnj: "‌", zwj: "‍", shy: "",
};

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

// private-use markers that survive tag stripping
const H = "";
const Q = "";
const IMG = "";
const HR = "";
const SEP = "";

/**
 * Reads chapter HTML into paragraphs, headings, quotes and images. Line breaks
 * and block elements start new paragraphs; scripts, styles, forms and ads are
 * dropped. `base` makes image addresses absolute.
 */
export function htmlToBlocks(html: string, base?: string): TextBlock[] {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|iframe|ins|form|button|select|svg|template)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|ins)\b[^>]*\/?>/gi, "");

  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner: string) =>
    `\n${inner.replace(/<br\s*\/?>|<\/?(?:p|div)\b[^>]*>/gi, `\n${Q}`)}\n`.replace(/\n(?!)/g, `\n${Q}`),
  );
  s = s.replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, inner: string) => `\n${H}${inner.replace(/<br\s*\/?>/gi, " ")}\n`);
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\b(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/i)?.[1];
    const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    return src ? `\n${IMG}${src}${SEP}${alt}\n` : "";
  });
  s = s
    .replace(/<hr\b[^>]*>/gi, `\n${HR}\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|li|ul|ol|section|article|tr|table|center|pre)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  const out: TextBlock[] = [];
  for (const raw of decodeEntities(s).split("\n")) {
    const line = raw.replace(/[\s ​]+/g, " ").trim();
    if (!line) continue;
    if (line.startsWith(IMG)) {
      const [src, alt] = line.slice(1).split(SEP);
      let url = src.trim();
      try {
        url = new URL(url, base).toString();
      } catch {
        continue;
      }
      if (/^https?:\/\//.test(url)) out.push(alt?.trim() ? { type: "image", src: url, alt: alt.trim() } : { type: "image", src: url });
      continue;
    }
    if (line === HR) {
      if (out.length && out[out.length - 1].type !== "break") out.push({ type: "break" });
      continue;
    }
    const kind = line[0] === H ? "heading" : line[0] === Q ? "quote" : "p";
    const text = (kind === "p" ? line : line.slice(1)).replace(/[-]/g, "").trim();
    if (text) out.push({ type: kind, text });
  }
  while (out[out.length - 1]?.type === "break") out.pop();
  return out;
}

/** Splits plain text into paragraphs on blank lines or single line breaks. */
export function textToBlocks(text: string): TextBlock[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((t) => ({ type: "p", text: t }));
}
