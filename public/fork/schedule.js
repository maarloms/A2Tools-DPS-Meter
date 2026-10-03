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
  // Weekly events are days away; seconds are noise there.
  if (seconds >= 86400) {
    const d = Math.floor(seconds / 86400);
    return d + "T " + String(Math.floor(seconds % 86400 / 3600)).padStart(2, "0") + ":"
      + String(Math.floor(seconds % 3600 / 60)).padStart(2, "0");
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = seconds % 60;
  return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")
    : String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
// Field bosses respawn a while after they die. `timer` is what the meter
// knows (src-tauri/src/fork/bosses.rs). Status: "alive" (seen since the
// kill), "due" (respawn time passed), "waiting" (counting down), "killed"
// (interval still unknown) or "unknown".
export function respawnState(event, timer, now = Date.now()) {
  const killed = timer?.killedAt ?? null;
  const seen = timer?.seenAt ?? null;
  const interval = timer?.intervalMin ?? event.respawnMinutes ?? null;
  const respawn = timer?.respawnAt ?? (killed != null && interval ? killed + interval * 60000 : null);
  const base = { killed, seen, interval, respawn, by: timer?.by || "", next: respawn,
    end: null, estimated: timer?.respawnAt == null && respawn != null };
  if (seen != null && (killed == null || seen > killed))
    return { ...base, status: "alive", active: true, start: seen, remaining: 0 };
  if (respawn != null && now >= respawn)
    return { ...base, status: "due", active: true, start: respawn, remaining: 0 };
  if (respawn != null)
    return { ...base, status: "waiting", active: false, start: respawn, remaining: respawn - now };
  if (killed != null)
    return { ...base, status: "killed", active: false, start: killed, remaining: Infinity };
  return { ...base, status: "unknown", active: false, start: null, remaining: Infinity };
}
