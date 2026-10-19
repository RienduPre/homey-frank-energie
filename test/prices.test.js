'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../lib/prices');

const TZ = 'Europe/Amsterdam';

// Build 96 quarter-hour entries for a local date with a V-shaped price curve.
function day(ymd, base = 0.2) {
  const start = p.startOfLocalDay(new Date(`${ymd}T12:00:00Z`), TZ);
  const out = [];
  for (let i = 0; i < 96; i++) {
    const from = new Date(start.getTime() + i * 15 * 60000);
    const till = new Date(from.getTime() + 15 * 60000);
    out.push({
      from: from.toISOString(),
      till: till.toISOString(),
      marketPrice: base + Math.abs(i - 52) / 1000, // cheapest at slot 52 = 13:00
      marketPriceTax: 0.01,
      sourcingMarkupPrice: 0.02,
      energyTaxPrice: 0.1,
    });
  }
  return out;
}

test('pickPrice composes all-in when allInPrice is missing', () => {
  const e = { marketPrice: 0.1, marketPriceTax: 0.02, sourcingMarkupPrice: 0.03, energyTaxPrice: 0.1 };
  assert.ok(Math.abs(p.pickPrice(e, 'allInPrice') - 0.25) < 1e-9);
  assert.ok(Math.abs(p.pickPrice(e, 'marketPricePlus') - 0.15) < 1e-9);
  assert.equal(p.pickPrice(e, 'marketPrice'), 0.1);
  assert.equal(p.pickPrice({ allInPrice: '0.3' }, 'allInPrice'), 0.3);
});

test('startOfLocalDay handles summer, winter and DST days', () => {
  assert.equal(p.startOfLocalDay(new Date('2026-07-01T12:00:00Z'), TZ).toISOString(), '2026-06-30T22:00:00.000Z');
  assert.equal(p.startOfLocalDay(new Date('2026-12-01T12:00:00Z'), TZ).toISOString(), '2026-11-30T23:00:00.000Z');
  assert.equal(p.startOfLocalDay(new Date('2026-10-25T12:00:00Z'), TZ).toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(p.startOfLocalDay(new Date('2026-03-29T12:00:00Z'), TZ).toISOString(), '2026-03-28T23:00:00.000Z');
});

test('current, next and stats', () => {
  const entries = p.normalize(day('2026-10-19'));
  assert.equal(entries.length, 96);
  const now = new Date('2026-10-19T11:07:00Z'); // 13:07 local
  const cur = p.currentEntry(entries, now);
  assert.equal(p.localTime(cur.from, TZ), '13:00');
  assert.equal(p.localTime(p.nextEntry(entries, now).from, TZ), '13:15');
  const s = p.stats(entries);
  assert.equal(p.localTime(s.min.from, TZ), '13:00');
  assert.equal(p.localTime(s.max.from, TZ), '00:00');
});

test('normalize de-duplicates overlapping fetches', () => {
  const d = day('2026-10-19');
  assert.equal(p.normalize([...d, ...d]).length, 96);
});

test('cheapest block and among-cheapest', () => {
  const entries = p.normalize(day('2026-10-19'));
  const b = p.cheapestBlock(entries, 60);
  assert.equal(p.localTime(b.from, TZ), '12:30');
  assert.equal(p.isAmongCheapest(entries, new Date('2026-10-19T11:07:00Z'), 1), true);
  assert.equal(p.isAmongCheapest(entries, new Date('2026-10-19T05:07:00Z'), 1), false);
  assert.equal(p.isAmongMostExpensive(entries, new Date('2026-10-18T22:05:00Z'), 1), true);
});

test('dates', () => {
  assert.equal(p.localDate(new Date('2026-10-19T22:30:00Z'), TZ), '2026-10-20');
  assert.equal(p.addDays('2026-10-31', 1), '2026-11-01');
});
