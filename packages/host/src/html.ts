import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { absUrl, clean, type Doc, type El } from "@storm-sources/sdk";

// Extensions see this small interface, not cheerio itself, so the parser can
// change without breaking them.
function wrap($: CheerioAPI, sel: Cheerio<AnyNode>, url: string): El {
  return {
    one(selector) {
      const found = sel.find(selector).first();
      return found.length ? wrap($, found, url) : null;
    },
    all(selector) {
      return sel
        .find(selector)
        .toArray()
        .map((n) => wrap($, $(n), url));
    },
    text: () => clean(sel.text()),
    attr: (name) => sel.attr(name)?.trim() ?? null,
    href(name) {
      const v = name ? sel.attr(name) : (sel.attr("href") ?? sel.attr("data-src") ?? sel.attr("data-lazy-src") ?? sel.attr("src"));
      return v?.trim() ? absUrl(url, v.trim()) : null;
    },
    html: () => sel.html() ?? "",
    without(...selectors) {
      const copy = sel.clone();
      if (selectors.length) copy.find(selectors.join(",")).remove();
      return wrap($, copy, url);
    },
  };
}

export function parseHtml(text: string, url: string): Doc {
  const $ = load(text);
  return { ...wrap($, $.root(), url), url };
}
