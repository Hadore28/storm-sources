export {};

// Fetches a URL the way a browser would and prints a short view of the answer —
// for working out how a site is put together before writing its extension.
//   bun scripts/probe.ts <url> [--keys] [--find <text>] [--raw <chars>]
const args = process.argv.slice(2);
const url = args[0];
const flag = (name: string) => args.includes(name);
const value = (name: string) => args[args.indexOf(name) + 1];

const res = await fetch(url, {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en;q=0.8",
    ...(args.includes("--referer") ? { Referer: value("--referer") } : {}),
  },
});
const text = await res.text();
console.log(`${res.status} ${res.headers.get("content-type")} ${text.length} chars  ${res.url}`);

function shape(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `…${v.length}`] : [];
  if (v && typeof v === "object") {
    if (depth > 3) return "{…}";
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  return typeof v === "string" ? (v.length > 60 ? v.slice(0, 60) + "…" : v) : v;
}

if (flag("--keys")) {
  try {
    console.log(JSON.stringify(shape(JSON.parse(text)), null, 1));
  } catch {
    console.log("not JSON");
  }
}
if (flag("--find")) {
  const needle = value("--find");
  let at = text.indexOf(needle);
  let n = 0;
  while (at >= 0 && n++ < 8) {
    console.log(`… ${text.slice(Math.max(0, at - 200), at + 300).replace(/\s+/g, " ")} …\n`);
    at = text.indexOf(needle, at + needle.length);
  }
}
if (flag("--raw")) console.log(text.slice(0, Number(value("--raw"))));
