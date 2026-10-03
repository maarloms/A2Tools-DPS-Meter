import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {eventState,countdown} from "../public/fork/schedule.js";
const data=JSON.parse(readFileSync(new URL("../public/fork/events.json", import.meta.url)));
const rift=data.events.find(e=>e.id==="rift");
const at=s=>Date.parse(s);
test("confirmed 22:29 CEST observation counts down to 23:00",()=>{
  const state=eventState(rift,at("2026-10-02T22:29:00+02:00"));
  assert.equal(state.start,at("2026-10-02T23:00:00+02:00"));
  assert.equal(countdown(state.remaining),"31:00");
  assert.equal(state.active,false);
});
test("portal opens exactly at start and closes at ten minutes",()=>{
  const start=at("2026-10-02T23:00:00+02:00");
  assert.equal(eventState(rift,start).active,true);
  assert.equal(countdown(eventState(rift,start).remaining),"10:00");
  assert.equal(eventState(rift,start+599999).active,true);
  const closed=eventState(rift,start+600000);
  assert.equal(closed.active,false);
  assert.equal(closed.next,at("2026-10-03T02:00:00+02:00"));
});
test("midnight rolls over to the next calendar day",()=>{
  assert.equal(eventState(rift,at("2026-10-02T23:59:00+02:00")).next,at("2026-10-03T02:00:00+02:00"));
});
// The Global client schedules EU events on the region clock (Europe/Berlin),
// so after the autumn change the rift stays at 02/05/… German time.
test("region-clock schedule follows the German autumn clock change",()=>{
  // 02:00 happens twice that night (CEST, then CET); both are shown.
  const before=eventState(rift,at("2026-10-25T00:10:00Z"));
  assert.equal(before.next,at("2026-10-25T01:00:00Z"));
  assert.equal(eventState(rift,at("2026-10-25T01:10:00Z")).next,at("2026-10-25T04:00:00Z"));
  const after=eventState(rift,at("2026-10-25T04:00:00Z"));
  assert.equal(after.active,true);
  assert.equal(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Berlin",hour:"2-digit",hourCycle:"h23"}).format(after.start),"05");
});
test("weekly sieges and bosses land on their German weekdays",()=>{
  const ev=id=>data.events.find(e=>e.id===id);
  // Sat 03.10.2026 18:00 CEST: siege tonight, Nahma on Sunday.
  const now=at("2026-10-03T18:00:00+02:00");
  assert.equal(eventState(ev("artifact"),now).next,at("2026-10-03T21:00:00+02:00"));
  for (const id of ["executor-tamasa","executor-agro","executor-kaira","dhramos","ducal","maraka"])
    assert.equal(eventState(ev(id),now).next,at("2026-10-03T21:30:00+02:00"));
  assert.equal(eventState(ev("nahma"),now).next,at("2026-10-04T21:00:00+02:00"));
  // After Saturday's siege the next one is Monday.
  assert.equal(eventState(ev("artifact"),at("2026-10-03T22:00:00+02:00")).next,at("2026-10-05T21:00:00+02:00"));
});
test("resets run on Korean time: 09:00 German summer time, 08:00 winter time",()=>{
  const daily=data.events.find(e=>e.id==="reset-daily");
  const weekly=data.events.find(e=>e.id==="reset-weekly");
  assert.equal(eventState(daily,at("2026-10-03T08:00:00+02:00")).next,at("2026-10-03T09:00:00+02:00"));
  assert.equal(eventState(daily,at("2026-10-27T07:00:00+01:00")).next,at("2026-10-27T08:00:00+01:00"));
  assert.equal(eventState(weekly,at("2026-10-03T12:00:00+02:00")).next,at("2026-10-07T09:00:00+02:00"));
});
test("arena windows report when they close",()=>{
  const arena=data.events.find(e=>e.id==="arena-evening");
  const state=eventState(arena,at("2026-10-03T20:00:00+02:00"));
  assert.equal(state.active,true);
  assert.equal(state.end,at("2026-10-03T21:00:00+02:00"));
});
test("manual correction shifts starts and open interval together",()=>{
  const shifted=eventState(rift,at("2026-10-02T23:00:00+02:00"),60);
  assert.equal(shifted.active,false);
  assert.equal(shifted.next,at("2026-10-03T00:00:00+02:00"));
});
test("weekly schedule finds the next week",()=>{
  const event={...rift,timeZone:"Asia/Tokyo",hours:[21],weekdays:[1]};
  assert.equal(eventState(event,at("2026-10-05T13:00:00Z")).next,at("2026-10-12T12:00:00Z"));
});
test("zero duration events immediately show their next start",()=>{
  const event={...rift,durationMinutes:0};
  assert.equal(eventState(event,at("2026-10-02T21:00:00Z")).active,false);
  assert.equal(eventState(event,at("2026-10-02T21:00:00Z")).next,at("2026-10-03T00:00:00Z"));
});
test("German spring missing hour is skipped; autumn hour has two occurrences",()=>{
  const event={...rift,timeZone:"Europe/Berlin",hours:[2],durationMinutes:0};
  assert.equal(eventState(event,at("2026-03-28T23:00:00Z")).next,at("2026-03-30T00:00:00Z"));
  assert.equal(eventState(event,at("2026-10-24T23:00:00Z")).next,at("2026-10-25T00:00:00Z"));
  assert.equal(eventState(event,at("2026-10-25T00:30:00Z")).next,at("2026-10-25T01:00:00Z"));
});
test("countdown rounds partial seconds up and supports hours",()=>{
  assert.equal(countdown(1),"00:01");
  assert.equal(countdown(-1),"00:00");
  assert.equal(countdown(3600000),"1:00:00");
  assert.equal(countdown((2*86400+3*3600+12*60)*1000),"2T 03:12");
});
test("Global activities share hourly slots rather than independent minigame timers",()=>{
  const festa=data.events.find(e=>e.id==="shugofesta");
  const invasion=data.events.find(e=>e.id==="invasion");
  const now=at("2026-10-02T22:29:00+02:00");
  assert.equal(eventState(festa,now).next,at("2026-10-02T23:00:00+02:00"));
  assert.equal(eventState(invasion,now).next,at("2026-10-02T22:30:00+02:00"));
  assert.equal(data.events.filter(e=>["track","nyerk","beritra"].includes(e.id)).length,0);
});