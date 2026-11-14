// Chapter dates as theme sites print them, in the languages they come in.

import { parseDate } from "@storm-sources/sdk";

const UNITS: [RegExp, number][] = [
  [/year|año|ano|năm|yıl|anno|anni|an\b|ans\b|tahun|год|лет|年|سنة|سنوات/, 31_536_000_000],
  [/month|mes|mês|meses|tháng|\bay\b|mois|mese|mesi|bulan|месяц|月|شهر|أشهر|شهور/, 2_592_000_000],
  [/week|semana|tuần|hafta|semaine|settiman|minggu|недел|周|週|أسبوع|أسابيع/, 604_800_000],
  [/day|día|dia|jour|hari|gün|ngày|giorn|день|дня|дней|天|日|يوم|أيام/, 86_400_000],
  [/hour|hora|heure|jam|saat|giờ|\bore\b|\bora\b|час|小时|時間|ساعة|ساعات/, 3_600_000],
  [/minute|minuto|\bmin|menit|dakika|phút|минут|分|دقيقة|دقائق/, 60_000],
  [/second|segundo|\bsec|detik|saniye|giây|секунд|秒|ثانية|ثوان/, 1000],
];

const MONTHS: [RegExp, number][] = [
  [/\b(jan|ene|janv|gen|ock|ocak|januari|janeiro|tháng 1\b|tháng một)/, 0],
  [/\b(feb|fev|fév|şub|şubat|februari|fevereiro|febrero|févr|tháng 2\b)/, 1],
  [/\b(mar|mart|maret|março|marzo|mars|tháng 3\b)/, 2],
  [/\b(apr|abr|avr|nis|nisan|april|abril|aprile|avril|tháng 4\b)/, 3],
  [/\b(may|mai|mei|mag|mayıs|maio|mayo|maggio|tháng 5\b)/, 4],
  [/\b(jun|juin|giu|haz|haziran|juni|junho|junio|giugno|tháng 6\b)/, 5],
  [/\b(jul|juil|lug|tem|temmuz|juli|julho|julio|luglio|juillet|tháng 7\b)/, 6],
  [/\b(aug|ago|août|aou|ağu|ağustos|agustus|agosto|tháng 8\b)/, 7],
  [/\b(sep|set|sept|eyl|eylül|september|setembro|septiembre|settembre|tháng 9\b)/, 8],
  [/\b(oct|okt|out|ott|eki|ekim|oktober|outubro|octubre|ottobre|octobre|tháng 10\b)/, 9],
  [/\b(nov|kas|kasım|november|novembro|noviembre|novembre|tháng 11\b)/, 10],
  [/\b(dec|dic|déc|dez|des|ara|aralık|desember|dezembro|diciembre|dicembre|décembre|tháng 12\b)/, 11],
];

const iso = (ms: number) => new Date(ms).toISOString();

export function siteDate(text: string | null | undefined, now = Date.now()): string | undefined {
  const known = parseDate(text, now);
  if (known || !text) return known;
  const s = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^(hoy|hoje|aujourd|oggi|bugün|hôm nay|hari ini|сегодня|今天)/.test(s)) return iso(now);
  if (/^(ayer|ontem|hier|ieri|dün|hôm qua|kemarin|вчера|昨天)/.test(s)) return iso(now - 86_400_000);
  const n = /(\d+)/.exec(s);
  if (n && !/\d{4}/.test(s)) {
    for (const [re, ms] of UNITS) if (re.test(s)) return iso(now - Number(n[1]) * ms);
  }
  const year = /(\d{4})/.exec(s)?.[1];
  if (year) {
    for (const [re, month] of MONTHS) {
      if (!re.test(s)) continue;
      const day = s.replace(year, "").replace(/tháng \d+/, "").match(/(\d{1,2})/)?.[1];
      return iso(Date.UTC(Number(year), month, day ? Number(day) : 1));
    }
  }
  return undefined;
}
