const formatters = new Map();
function partsAt(ms, timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }));
  return Object.fromEntries(formatters.get(timeZone).formatToParts(new Date(ms))
    .filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
}
function wallEpoch(p) {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour || 0, p.minute || 0, p.second || 0);
}
// Resolve wall-clock dates using the zone's actual offsets. Checking both
// sides handles autumn's repeated hour; missing spring hours are skipped.
function wallInstants(p, timeZone) {
  const naive = wallEpoch(p);
  const offsets = new Set([-36, 0, 36].map(h => {
    const sample = naive + h * 3600000;
    return wallEpoch(partsAt(sample, timeZone)) - sample;
  }));
  return [...offsets].map(offset => naive - offset)
    .filter(ms => wallEpoch(partsAt(ms, timeZone)) === naive);
}
export function eventState(event, now = Date.now(), offsetMinutes = 0) {
  const adjusted = now - offsetMinutes * 60000;
  const today = partsAt(adjusted, event.timeZone);
  const starts = [];
  for (let day = -1; day <= 8; day++) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + day));
    if (event.weekdays && !event.weekdays.includes(d.getUTCDay())) continue;
    for (const hour of event.hours) {
      starts.push(...wallInstants({
        year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
        hour, minute: event.minute, second: 0,
      }, event.timeZone).map(ms => ms + offsetMinutes * 60000));
    }
  }
  starts.sort((a, b) => a - b);
  const previous = starts.filter(ms => ms <= now).at(-1);
  const end = previous == null ? null : previous + event.durationMinutes * 60000;
  const active = end != null && now < end;
  const next = starts.find(ms => ms > now);
  return { active, start: active ? previous : next, end: active ? end : null,
    remaining: (active ? end : next) - now, next };
}
export function countdown(ms) {
  if (!Number.isFinite(ms)) return "—";
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = seconds % 60;
  return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")
    : String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}