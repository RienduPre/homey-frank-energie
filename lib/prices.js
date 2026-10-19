'use strict';

/**
 * Pure price helpers. No Homey dependencies, so they can be unit tested.
 */

const PRICE_TYPES = ['allInPrice', 'marketPricePlus', 'marketPrice'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pick the requested price from an API entry, with sensible fallbacks
 * (the same composition the Home Assistant integration uses).
 */
function pickPrice(entry, priceType = 'allInPrice') {
  const market = num(entry.marketPrice);
  const tax = num(entry.marketPriceTax) || 0;
  const markup = num(entry.sourcingMarkupPrice) || 0;
  const energyTax = num(entry.energyTaxPrice) || 0;

  if (priceType === 'marketPrice') return market;

  if (priceType === 'marketPricePlus') {
    const plus = num(entry.marketPricePlus);
    if (plus !== null) return plus;
    return market === null ? null : market + tax + markup;
  }

  const allIn = num(entry.allInPrice);
  if (allIn !== null) return allIn;
  return market === null ? null : market + tax + markup + energyTax;
}

/**
 * Convert raw API entries into sorted {from, till, price} objects.
 */
function normalize(entries, priceType = 'allInPrice') {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const e of entries) {
    if (!e || !e.from || !e.till) continue;
    const from = new Date(e.from);
    const till = new Date(e.till);
    const price = pickPrice(e, priceType);
    if (Number.isNaN(from.getTime()) || Number.isNaN(till.getTime()) || price === null) continue;
    out.push({ from, till, price });
  }
  out.sort((a, b) => a.from - b.from);
  // de-duplicate on start time (today/tomorrow fetches can overlap)
  return out.filter((e, i) => i === 0 || e.from.getTime() !== out[i - 1].from.getTime());
}

function currentEntry(entries, now = new Date()) {
  const t = now.getTime();
  return entries.find((e) => e.from.getTime() <= t && t < e.till.getTime()) || null;
}

function nextEntry(entries, now = new Date()) {
  const cur = currentEntry(entries, now);
  if (!cur) return null;
  return entries.find((e) => e.from.getTime() === cur.till.getTime()) || null;
}

/** Entries whose start falls in [start, end). */
function between(entries, start, end) {
  const s = start.getTime();
  const en = end.getTime();
  return entries.filter((e) => e.from.getTime() >= s && e.from.getTime() < en);
}

function stats(entries) {
  if (!entries.length) return null;
  let min = entries[0];
  let max = entries[0];
  let sum = 0;
  let weight = 0;
  for (const e of entries) {
    if (e.price < min.price) min = e;
    if (e.price > max.price) max = e;
    const minutes = (e.till - e.from) / 60000;
    sum += e.price * minutes;
    weight += minutes;
  }
  return { min, max, avg: weight ? sum / weight : null, count: entries.length };
}

/**
 * Cheapest contiguous block of `durationMinutes` within `entries`
 * (entries must be contiguous and sorted). Returns {from, till, avg} or null.
 */
function cheapestBlock(entries, durationMinutes) {
  if (!entries.length || durationMinutes <= 0) return null;
  let best = null;
  for (let i = 0; i < entries.length; i++) {
    let covered = 0;
    let sum = 0;
    let j = i;
    while (j < entries.length && covered < durationMinutes) {
      if (j > i && entries[j].from.getTime() !== entries[j - 1].till.getTime()) break; // gap
      const minutes = (entries[j].till - entries[j].from) / 60000;
      const use = Math.min(minutes, durationMinutes - covered);
      sum += entries[j].price * use;
      covered += use;
      j++;
    }
    if (covered < durationMinutes) continue;
    const avg = sum / durationMinutes;
    if (!best || avg < best.avg) {
      best = { from: entries[i].from, till: new Date(entries[i].from.getTime() + durationMinutes * 60000), avg };
    }
  }
  return best;
}

/** True if the current slot is among the `hours` cheapest hours of `dayEntries`. */
function isAmongCheapest(dayEntries, now, hours) {
  const cur = currentEntry(dayEntries, now);
  if (!cur || !dayEntries.length) return false;
  const slotMinutes = (cur.till - cur.from) / 60000;
  const slots = Math.max(1, Math.round((hours * 60) / slotMinutes));
  const sorted = [...dayEntries].sort((a, b) => a.price - b.price);
  return sorted.slice(0, slots).includes(cur);
}

function isAmongMostExpensive(dayEntries, now, hours) {
  const cur = currentEntry(dayEntries, now);
  if (!cur || !dayEntries.length) return false;
  const slotMinutes = (cur.till - cur.from) / 60000;
  const slots = Math.max(1, Math.round((hours * 60) / slotMinutes));
  const sorted = [...dayEntries].sort((a, b) => b.price - a.price);
  return sorted.slice(0, slots).includes(cur);
}

/** YYYY-MM-DD for `date` in time zone `tz`. */
function localDate(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** HH:MM for `date` in time zone `tz`. */
function localTime(date, tz) {
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

/** UTC instant of local midnight for the local date of `date` in `tz`. */
function startOfLocalDay(date, tz) {
  const ymd = localDate(date, tz);
  // Find the offset of tz at that date by formatting a UTC guess.
  const guess = new Date(`${ymd}T00:00:00Z`);
  const offsetMin = tzOffsetMinutes(guess, tz);
  const start = new Date(guess.getTime() - offsetMin * 60000);
  // Correct across DST edges.
  const off2 = tzOffsetMinutes(start, tz);
  return off2 === offsetMin ? start : new Date(guess.getTime() - off2 * 60000);
}

function tzOffsetMinutes(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - date.getTime()) / 60000);
}

function addDays(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  PRICE_TYPES,
  pickPrice,
  normalize,
  currentEntry,
  nextEntry,
  between,
  stats,
  cheapestBlock,
  isAmongCheapest,
  isAmongMostExpensive,
  localDate,
  localTime,
  startOfLocalDay,
  addDays,
};
