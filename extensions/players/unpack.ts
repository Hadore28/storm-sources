// Undoes Dean Edwards' packer — eval(function(p,a,c,k,e,d){...}) — which many
// video hosts wrap their player setup in.

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function encode(n: number, radix: number): string {
  let s = "";
  do {
    s = DIGITS[n % radix] + s;
    n = Math.floor(n / radix);
  } while (n > 0);
  return s;
}

/** Every packed script in the page, unpacked, joined. Empty when there's none. */
export function unpackAll(html: string): string {
  const out: string[] = [];
  const re = /\}\('((?:[^'\\]|\\.)*)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
  for (const m of html.matchAll(re)) {
    const payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    const radix = Number(m[2]);
    const count = Number(m[3]);
    const words = m[4].split("|");
    const dict = new Map<string, string>();
    for (let i = 0; i < count; i++) dict.set(encode(i, radix), words[i] || encode(i, radix));
    out.push(payload.replace(/\b\w+\b/g, (w) => dict.get(w) ?? w));
  }
  return out.join("\n");
}
