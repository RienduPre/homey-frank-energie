'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../lib/prices');
const d = require('../lib/dashboard');

const TZ = 'Europe/Amsterdam';

/** Normalized quarter-hour entries for a local date; price(i) gives slot i's price. */
function day(ymd, price) {
  const start = p.startOfLocalDay(new Date(`${ymd}T12:00:00Z`), TZ);
  const out = [];
  for (let i = 0; i < 96; i++) {
    const from = new Date(start.getTime() + i * 15 * 60000);
    out.push({ from, till: new Date(from.getTime() + 15 * 60000), price: price(i) });
  }
  return out;
}

// Cheap around 13:00 (slot 52), expensive around 18:00 (slot 72).
const curve = (i) => 0.25 - 0.08 * Math.exp(-((i - 52) ** 2) / 40) + 0.1 * Math.exp(-((i - 72) ** 2) / 30);

test('levelOf uses deviation from the average', () => {
  assert.equal(d.levelOf(0.21, 0.25), 1);
  assert.equal(d.levelOf(0.19, 0.25), 0);
  assert.equal(d.levelOf(0.25, 0.25), 2);
  assert.equal(d.levelOf(0.28, 0.25), 3);
  assert.equal(d.levelOf(0.31, 0.25), 4);
  assert.equal(d.levelOf(-0.01, 0.05), 0);
});

test('runs drops runs shorter than the minimum and splits on gaps', () => {
  const entries = day('2026-10-23', (i) => (i >= 10 && i < 12) || i === 20 ? 0 : 1)
    .map((e) => ({ ...e }));
  const r = d.runs(entries, (e) => e.price === 0, 30);
  assert.equal(r.length, 1);
  assert.equal(r[0].entries.length, 2);
});

test('build: levels, periods, hours, parts and days', () => {
  const now = new Date('2026-10-23T11:05:00Z'); // 13:05 local
  const elec = [...day('2026-10-23', curve), ...day('2026-10-24', (i) => curve(i) + 0.02)];
  const out = d.build({ elec, now, tz: TZ, meta: { name: 'Test' } });

  assert.equal(out.slots.length, 192);
  assert.equal(out.hours.length, 48);
  assert.equal(out.parts.length, 8);
  assert.equal(out.days.length, 2);
  assert.ok(out.days[1].available);
  assert.ok(out.days[1].vsToday > 0);

  // Now is in the cheap dip, inside a best price period.
  assert.ok(out.current);
  assert.ok(out.current.level <= 1);
  assert.equal(out.current.period.type, 'best');
  assert.equal(out.current.trend, 'rising');

  // A peak period around 18:00 local exists today.
  const peak = out.periods.find((x) => x.type === 'peak' && x.from < out.days[0].till);
  assert.ok(peak);
  assert.equal(p.localTime(new Date(peak.from), TZ) <= '18:00', true);
  assert.equal(p.localTime(new Date(peak.till), TZ) > '18:00', true);
  assert.ok(out.current.nextPeak);

  // Parts: afternoon of today holds the minimum.
  const afternoon = out.parts.find((x) => x.day === 0 && x.id === 'afternoon');
  assert.ok(Math.abs(afternoon.min - out.days[0].min) < 1e-9);

  // JSON-safe
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(out)));
});

test('build: a flat day still gets a best period (cheapest hour)', () => {
  const now = new Date('2026-10-23T08:00:00Z');
  const elec = day('2026-10-23', (i) => 0.25 + (i === 40 ? -0.001 : 0));
  const out = d.build({ elec, now, tz: TZ });
  const best = out.periods.filter((x) => x.type === 'best');
  assert.equal(best.length, 1);
  assert.equal(best[0].till - best[0].from, 3600000);
  assert.equal(out.periods.filter((x) => x.type === 'peak').length, 0);
  assert.equal(out.days[1].available, false);
});

test('build: hourly resolution', () => {
  const start = p.startOfLocalDay(new Date('2026-10-23T12:00:00Z'), TZ);
  const elec = [];
  for (let h = 0; h < 24; h++) {
    const from = new Date(start.getTime() + h * 3600000);
    elec.push({ from, till: new Date(from.getTime() + 3600000), price: 0.2 + h / 100 });
  }
  const out = d.build({ elec, now: new Date('2026-10-23T09:30:00Z'), tz: TZ });
  assert.equal(out.hours.length, 24);
  assert.equal(out.hours[0].slots.length, 1);
  assert.ok(out.current.next);
});

test('build: DST day (25 hours) keeps all hours', () => {
  const ymd = '2026-10-25'; // clocks go back in Europe/Amsterdam
  const start = p.startOfLocalDay(new Date(`${ymd}T12:00:00Z`), TZ);
  const end = p.startOfLocalDay(new Date(start.getTime() + 36 * 3600000), TZ);
  const elec = [];
  for (let t = start.getTime(); t < end.getTime(); t += 900000) {
    elec.push({ from: new Date(t), till: new Date(t + 900000), price: 0.25 });
  }
  const out = d.build({ elec, now: new Date('2026-10-25T10:00:00Z'), tz: TZ });
  assert.equal(out.slots.length, 100);
  assert.equal(out.hours.length, 25);
});

test('runs bridges a single short gap when asked', () => {
  const entries = day('2026-10-23', (i) => ((i >= 10 && i < 12) || (i >= 13 && i < 15) ? 0 : 1));
  assert.equal(d.runs(entries, (e) => e.price === 0, 30).length, 2);
  const joined = d.runs(entries, (e) => e.price === 0, 30, 15);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].entries.length, 5);
});
