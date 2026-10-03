// Kleines SVG-Liniendiagramm: eine y-Achse, Legende (zum Ein-/Ausblenden),
// Direktbeschriftung bei ≤ 4 Linien, Fadenkreuz-Tooltip.

import { $, esc, trunc } from "./core.js";

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/**
 * @param host     Container-Element
 * @param opts.series  [{ id, name, color, pts: [{x, y}] }]
 * @param opts.xMin/xMax, xFmt(x), yFmt(y), xTicks: [{x, label}] (optional)
 * @param opts.legend  Container für die Legende (optional)
 * @param opts.hidden  Set von ids ausgeblendeter Linien
 * @param opts.yMax    feste Obergrenze (optional), opts.skipFrac: Anteil am Anfang, der die Skala nicht bestimmt
 */
export function lineChart(host, opts) {
  if (!host) return;
  const { series, xFmt, yFmt, legend, hidden = new Set(), label = "Diagramm" } = opts;
  const W = Math.max(280, host.clientWidth || 600);
  const H = opts.height || (W < 500 ? 200 : 260);
  const visible = series.filter((s) => !hidden.has(s.id) && s.pts.length);
  const direct = visible.length > 0 && visible.length <= 4 && W >= 420;
  const pad = { l: 50, r: direct ? 96 : 14, t: 10, b: 24 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const allX = series.flatMap((s) => s.pts.map((p) => p.x));
  const xMin = opts.xMin ?? Math.min(...allX, 0);
  const xMax = Math.max(opts.xMax ?? Math.max(...allX, 1), xMin + 1);
  const skip = opts.skipFrac ? xMin + (xMax - xMin) * opts.skipFrac : -Infinity;
  const ys = visible.flatMap((s) => s.pts.filter((p) => p.x >= skip).map((p) => p.y));
  const rawMax = opts.yMax ?? Math.max(1, ...ys);
  const step = niceStep(rawMax / 4);
  const yMax = opts.yMax ?? Math.ceil(rawMax / step) * step;
  const x = (v) => pad.l + ((v - xMin) / (xMax - xMin)) * iw;
  const y = (v) => pad.t + ih - (Math.max(0, Math.min(v, yMax)) / yMax) * ih;

  const grid = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    grid.push(`<line x1="${pad.l}" x2="${pad.l + iw}" y1="${y(v)}" y2="${y(v)}"/>`);
    grid.push(`<text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${esc(yFmt(v))}</text>`);
  }
  let ticks = opts.xTicks;
  if (!ticks) {
    ticks = [];
    const n = W < 500 ? 4 : 6;
    for (let i = 0; i <= n; i++) {
      const v = xMin + ((xMax - xMin) * i) / n;
      ticks.push({ x: v, label: xFmt(v) });
    }
  }
  const xt = ticks.map((t) => `<text x="${x(t.x)}" y="${H - 6}" text-anchor="middle">${esc(t.label)}</text>`);
  const paths = visible
    .map((s) => {
      const d = s.pts.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
      const dots = s.pts.length <= 2 ? s.pts.map((p) => `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="4" fill="${s.color}"/>`).join("") : "";
      return `<path d="${d}" stroke="${s.color}"/>${dots}`;
    })
    .join("");
  let labels = "";
  if (direct) {
    const ends = visible.map((s) => ({ s, y: y(s.pts.at(-1).y) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
    labels = ends.map((e) => `<text x="${pad.l + iw + 6}" y="${e.y + 4}" class="dlabel">${esc(trunc(e.s.name, 13))}</text>`).join("");
  }
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      <g class="grid axis">${grid.join("")}</g><g class="axis">${xt.join("")}</g>
      <g class="series">${paths}</g>${labels}
      <line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" visibility="hidden"/>
      <rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg><div class="tip" hidden></div>`;

  if (legend) {
    legend.innerHTML = series
      .map(
        (s) => `<button type="button" class="${hidden.has(s.id) ? "off" : ""}" data-id="${esc(s.id)}" aria-pressed="${!hidden.has(s.id)}">
          <span class="sw" style="background:${s.color}"></span>${esc(s.name)}</button>`,
      )
      .join("");
    legend.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.id;
        hidden.has(id) ? hidden.delete(id) : hidden.add(id);
        lineChart(host, { ...opts, hidden });
      }),
    );
  }

  const hit = $(".hit", host);
  const cross = $(".cross", host);
  const tip = $(".tip", host);
  const move = (ev) => {
    const box = host.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const xv = xMin + ((px - pad.l) / iw) * (xMax - xMin);
    const rows = visible
      .map((s) => {
        let best = s.pts[0];
        for (const p of s.pts) if (Math.abs(p.x - xv) < Math.abs(best.x - xv)) best = p;
        return { s, p: best };
      })
      .filter((r) => Math.abs(r.p.x - xv) <= (xMax - xMin) / 20 + 1e-9)
      .sort((a, b) => b.p.y - a.p.y);
    if (!rows.length) return;
    const xs = rows[0].p.x;
    cross.setAttribute("x1", x(xs));
    cross.setAttribute("x2", x(xs));
    cross.setAttribute("visibility", "visible");
    tip.innerHTML =
      `<div class="t">${esc(xFmt(xs))}</div>` +
      rows
        .map((r) => `<div class="r"><span><span class="sw" style="background:${r.s.color}"></span> ${esc(trunc(r.s.name, 16))}</span><span>${esc(yFmt(r.p.y))}</span></div>`)
        .join("");
    tip.hidden = false;
    const left = (x(xs) / W) * box.width;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(box.width - w, left + 12 + w > box.width ? left - w - 12 : left + 12))}px`;
    tip.style.top = "8px";
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    tip.hidden = true;
  });
}
