/**
 * Reads a position from whatever people paste: "1.3018, 103.9128", a Google Maps link,
 * or degrees-minutes-seconds like 1°18'06.5"N 103°54'46.1"E.
 */
export function parseCoords(input: string): { lat: number; lon: number } | undefined {
  const text = input.trim();
  if (!text) return undefined;
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns = [
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`@${num},${num}`),
    new RegExp(`[?&](?:q|query|ll|center)=${num}(?:,|%2C)\\s*${num}`, 'i'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return check(Number(m[1]), Number(m[2]));
  }
  const dms =
    /(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|'')?\s*([NS])[\s,]*(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|'')?\s*([EW])/i;
  const d = text.match(dms);
  if (d) {
    const lat = (Number(d[1]) + Number(d[2]) / 60 + Number(d[3]) / 3600) * (/s/i.test(d[4]!) ? -1 : 1);
    const lon = (Number(d[5]) + Number(d[6]) / 60 + Number(d[7]) / 3600) * (/w/i.test(d[8]!) ? -1 : 1);
    return check(lat, lon);
  }
  const pair = text.match(new RegExp(`^${num}\\s*[,;\\s]\\s*${num}$`));
  if (pair) return check(Number(pair[1]), Number(pair[2]));
  return undefined;
}

function check(a: number, b: number): { lat: number; lon: number } | undefined {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  // "103.9, 1.3" is obviously lon, lat.
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a];
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return undefined;
  return { lat: a, lon: b };
}
