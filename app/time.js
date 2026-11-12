// R5 / SCHED-4514: an incident time in the viewer's local time zone.
// Order of day, month and year comes from the viewer's locale ("their own order"), joined with "/".
// EU locales always get day before month (dd/mm), as the plan says, even where the locale is year-first (sv, hu, lt).
const EU = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR IE IT LV LT LU MT NL PL PT RO SK SI ES SE HU'.split(' '));

function region(locale) {
  try { return new Intl.Locale(locale).maximize().region ?? ''; } catch { return ''; }
}

export function formatLocal(iso, locale = navigator.language, timeZone = undefined) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  // 24-hour locales read 04:11; 12-hour locales read 4:11 pm.
  const h12 = new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone }).resolvedOptions().hour12;
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', timeZone };
  const parts = new Intl.DateTimeFormat(locale, opts).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  const order = EU.has(region(locale)) ? ['day', 'month', 'year'] : parts.map((p) => p.type).filter((t) => t === 'day' || t === 'month' || t === 'year');
  const date = order.map(get).join('/');
  const period = get('dayPeriod');
  const time = `${get('hour')}:${get('minute')}${period ? ' ' + period : ''}`;
  return `${date} ${time}`;
}
