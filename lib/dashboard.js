'use strict';

/**
 * Data for the dashboard widgets: price levels, best and peak price periods,
 * hours, parts of the day and day statistics. Pure functions without Homey
 * dependencies, so they can be unit tested.
 *
 * All times in the output are epoch milliseconds, so the payload is plain JSON.
 */

const P = require('./prices');

/** Price levels, cheapest first. Index is used in the payload. */
const LEVELS = ['very_cheap', 'cheap', 'normal', 'expensive', 'very_expensive'];

/** Parts of the day as [id, startHour, endHour) in local time. */
const DAY_PARTS = [
  ['night', 0, 6],
  ['morning', 6, 12],
  ['afternoon', 12, 18],
  ['evening', 18, 24],
];

const DEFAULTS = {
  cheap: 0.1, // 10 % below the day's average is cheap
  veryCheap: 0.2, // 20 % below is very cheap
  expensive: 0.1,
  veryExpensive: 0.2,
  minPeriodMinutes: 30, // shortest best or peak price period
  gapMinutes: 15, // a period may bridge one short gap (one quarter hour)
  fallbackBestMinutes: 60, // a day without cheap slots still gets its cheapest hour as best period
  trendMinutes: 120, // trend compares now with the coming two hours
  trendThreshold: 0.05,
  denominatorFloor: 0.05, // keeps percentages sane for market prices near zero
};

/**
 * Level index of `price` against `avg`. Deviation is taken relative to |avg|
 * (with a floor), so it also works for market prices around zero.
 */
function levelOf(price, avg, opts = DEFAULTS) {
  if (price === null || price === undefined || avg === null || avg === undefined) return 2;
  if (price < 0) return 0;
  const o = { ...DEFAULTS, ...opts };
  const dev = (price - avg) / Math.max(Math.abs(avg), o.denominatorFloor);
  if (dev <= -o.veryCheap) return 0;
  if (dev <= -o.cheap) return 1;
  if (dev >= o.veryExpensive) return 4;
  if (dev >= o.expensive) return 3;
  return 2;
}

/** How much prices swing within a day. */
function volatilityOf(stats, opts = DEFAULTS) {
  if (!stats) return null;
  const o = { ...DEFAULTS, ...opts };
  const spread = (stats.max.price - stats.min.price) / Math.max(Math.abs(stats.avg), o.denominatorFloor);
  if (spread < 0.3) return 'low';
  if (spread < 0.6) return 'moderate';
  if (spread < 1.0) return 'high';
  return 'very_high';
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function minutes(e) {
  return (e.till - e.from) / 60000;
}

/** Time-weighted aggregate of a list of entries. */
function aggregate(entries) {
  const s = P.stats(entries);
  if (!s) return null;
  return {
    from: entries[0].from.getTime(),
    till: entries[entries.length - 1].till.getTime(),
    avg: s.avg,
    min: s.min.price,
    max: s.max.price,
  };
}

/**
 * Contiguous runs of entries matching `pred`, at least `minMinutes` long.
 * Runs separated by at most `gapMinutes` of other entries are joined.
 * Returns [{from, till, entries}].
 */
function runs(entries, pred, minMinutes, gapMinutes = 0) {
  const out = [];
  let cur = null;
  for (const e of entries) {
    const contiguous = cur && cur.till.getTime() === e.from.getTime();
    if (pred(e)) {
      if (cur && contiguous) {
        cur.till = e.till;
        cur.entries.push(e);
      } else {
        if (cur) out.push(cur);
        cur = { from: e.from, till: e.till, entries: [e] };
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  const joined = [];
  for (const r of out) {
    const prev = joined[joined.length - 1];
    if (prev && gapMinutes > 0 && (r.from - prev.till) / 60000 <= gapMinutes) {
      const gap = entries.filter((e) => e.from >= prev.till && e.till <= r.from);
      prev.entries.push(...gap, ...r.entries);
      prev.till = r.till;
    } else {
      joined.push(r);
    }
  }
  return joined.filter((r) => (r.till - r.from) / 60000 >= minMinutes);
}

/**
 * Best and peak price periods for one day of entries, with each entry's level
 * already set as `e.level`.
 */
function dayPeriods(dayEntries, opts = DEFAULTS) {
  const o = { ...DEFAULTS, ...opts };
  if (!dayEntries.length) return [];
  let best = runs(dayEntries, (e) => e.level <= 1, o.minPeriodMinutes, o.gapMinutes);
  if (!best.length) {
    const block = P.cheapestBlock(dayEntries, o.fallbackBestMinutes);
    if (block) {
      const entries = dayEntries.filter((e) => e.from >= block.from && e.till <= block.till);
      if (entries.length) best = [{ from: entries[0].from, till: entries[entries.length - 1].till, entries }];
    }
  }
  const peak = runs(dayEntries, (e) => e.level >= 3, o.minPeriodMinutes, o.gapMinutes);
  const toPeriod = (type) => (r) => ({
    type,
    from: r.from.getTime(),
    till: r.till.getTime(),
    avg: P.stats(r.entries).avg,
    entries: r.entries,
  });
  return [...best.map(toPeriod('best')), ...peak.map(toPeriod('peak'))];
}

/** Join periods of the same type that touch (across midnight). */
function mergePeriods(periods) {
  const sorted = [...periods].sort((a, b) => a.from - b.from);
  const out = [];
  for (const p of sorted) {
    const prev = out.find((q) => q.type === p.type && q.till === p.from);
    if (prev) {
      prev.entries = [...prev.entries, ...p.entries];
      prev.till = p.till;
      prev.avg = P.stats(prev.entries).avg;
    } else {
      out.push({ ...p });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Share (0..1) of the time between from and till that lies in periods of `type`. */
function coverage(periods, type, from, till) {
  let covered = 0;
  for (const p of periods) {
    if (p.type !== type) continue;
    const s = Math.max(from, p.from);
    const e = Math.min(till, p.till);
    if (e > s) covered += e - s;
  }
  return till > from ? covered / (till - from) : 0;
}

/** Local hour (0-23) of a date. */
function localHour(date, tz) {
  return Number(P.localTime(date, tz).slice(0, 2));
}

/**
 * Build the widget payload.
 *
 * @param {object} input
 * @param {Array<{from: Date, till: Date, price: number}>} input.elec normalized electricity entries
 * @param {Array<{from: Date, till: Date, price: number}>} [input.gas] normalized gas entries
 * @param {Date} [input.now]
 * @param {string} input.tz IANA time zone
 * @param {object} [input.meta] extra fields copied into the payload (name, priceType, ...)
 * @param {object} [input.options] level and period thresholds
 */
function build({ elec, gas = [], now = new Date(), tz, meta = {}, options = {} }) {
  const o = { ...DEFAULTS, ...options };
  const todayStart = P.startOfLocalDay(now, tz);
  const dayStart = (offset) => P.startOfLocalDay(new Date(todayStart.getTime() + (offset * 24 + 12) * 3600000), tz);
  const bounds = [0, 1, 2].map(dayStart);

  const payload = {
    v: 1,
    generated: now.getTime(),
    now: now.getTime(),
    tz,
    ...meta,
    levels: LEVELS,
    current: null,
    slots: [],
    hours: [],
    parts: [],
    days: [],
    periods: [],
    gas: null,
  };

  // ---------------------------------------------------------------- days
  const dayEntries = [0, 1].map((i) => P.between(elec, bounds[i], bounds[i + 1])
    .map((e) => ({ ...e })));
  const dayStats = dayEntries.map((list) => P.stats(list));

  let periods = [];
  dayEntries.forEach((list, i) => {
    const s = dayStats[i];
    for (const e of list) e.level = levelOf(e.price, s ? s.avg : null, o);
    periods.push(...dayPeriods(list, o));
  });
  periods = mergePeriods(periods);

  const all = [...dayEntries[0], ...dayEntries[1]];
  const periodAt = (t) => periods.find((p) => p.from <= t && t < p.till) || null;

  payload.slots = all.map((e) => {
    const per = periodAt(e.from.getTime());
    return {
      from: e.from.getTime(),
      till: e.till.getTime(),
      price: e.price,
      level: e.level,
      period: per ? per.type : null,
    };
  });

  payload.periods = periods.map(({ type, from, till, avg }) => ({ type, from, till, avg }));

  // --------------------------------------------------------------- hours
  dayEntries.forEach((list, i) => {
    const s = dayStats[i];
    const byHour = new Map();
    for (const e of list) {
      const h = Math.floor(e.from.getTime() / 3600000); // UTC hour bucket = local hour (whole-hour offsets)
      if (!byHour.has(h)) byHour.set(h, []);
      byHour.get(h).push(e);
    }
    for (const entries of byHour.values()) {
      const a = aggregate(entries);
      payload.hours.push({
        ...a,
        day: i,
        level: levelOf(a.avg, s ? s.avg : null, o),
        best: coverage(periods, 'best', a.from, a.till),
        peak: coverage(periods, 'peak', a.from, a.till),
        slots: entries.map((e) => ({ from: e.from.getTime(), price: e.price, level: e.level })),
      });
    }
  });

  // --------------------------------------------------- parts of the day
  dayEntries.forEach((list, i) => {
    const s = dayStats[i];
    for (const [id, startH, endH] of DAY_PARTS) {
      const entries = list.filter((e) => {
        const h = localHour(e.from, tz);
        return h >= startH && h < endH;
      });
      if (!entries.length) continue;
      const a = aggregate(entries);
      const cheapest = entries.reduce((m, e) => (e.price < m.price ? e : m), entries[0]);
      const dearest = entries.reduce((m, e) => (e.price > m.price ? e : m), entries[0]);
      payload.parts.push({
        ...a,
        id,
        day: i,
        level: levelOf(a.avg, s ? s.avg : null, o),
        minAt: cheapest.from.getTime(),
        maxAt: dearest.from.getTime(),
        best: coverage(periods, 'best', a.from, a.till),
        peak: coverage(periods, 'peak', a.from, a.till),
      });
    }
  });

  // ---------------------------------------------------------- day stats
  dayEntries.forEach((list, i) => {
    const s = dayStats[i];
    const day = {
      key: i === 0 ? 'today' : 'tomorrow',
      date: P.localDate(bounds[i], tz),
      from: bounds[i].getTime(),
      till: bounds[i + 1].getTime(),
      available: !!s,
    };
    if (s) {
      const hours = payload.hours.filter((h) => h.day === i);
      const cheapestHour = hours.reduce((m, h) => (h.avg < m.avg ? h : m), hours[0]);
      Object.assign(day, {
        min: s.min.price,
        minAt: s.min.from.getTime(),
        max: s.max.price,
        maxAt: s.max.from.getTime(),
        avg: s.avg,
        median: median(list.map((e) => e.price)),
        volatility: volatilityOf(s, o),
        cheapestHour: cheapestHour ? { from: cheapestHour.from, avg: cheapestHour.avg } : null,
        best: periods.filter((p) => p.type === 'best' && p.from < day.till && p.till > day.from).length,
        peak: periods.filter((p) => p.type === 'peak' && p.from < day.till && p.till > day.from).length,
      });
    }
    payload.days.push(day);
  });
  const [today, tomorrow] = payload.days;
  if (today.available && tomorrow.available) {
    tomorrow.vsToday = (tomorrow.avg - today.avg) / Math.max(Math.abs(today.avg), o.denominatorFloor);
  }

  // ------------------------------------------------------------- current
  const t = now.getTime();
  const curIdx = payload.slots.findIndex((sl) => sl.from <= t && t < sl.till);
  if (curIdx >= 0) {
    const cur = payload.slots[curIdx];
    const next = payload.slots[curIdx + 1] && payload.slots[curIdx + 1].from === cur.till
      ? payload.slots[curIdx + 1] : null;
    const ahead = payload.slots.filter((sl) => sl.from >= cur.till && sl.from < cur.till + o.trendMinutes * 60000);
    const aheadAvg = ahead.length ? ahead.reduce((sum, sl) => sum + sl.price, 0) / ahead.length : null;
    let trend = 'stable';
    if (aheadAvg !== null) {
      const dev = (aheadAvg - cur.price) / Math.max(Math.abs(cur.price), o.denominatorFloor);
      if (dev > o.trendThreshold) trend = 'rising';
      else if (dev < -o.trendThreshold) trend = 'falling';
    }
    const curPeriod = periodAt(cur.from);
    const nextBest = periods.find((p) => p.type === 'best' && p.from > t) || null;
    const nextPeak = periods.find((p) => p.type === 'peak' && p.from > t) || null;
    const todayPrices = dayEntries[0].map((e) => e.price);
    const cheaperThan = todayPrices.length
      ? todayPrices.filter((p) => p > cur.price).length / todayPrices.length : null;
    payload.current = {
      ...cur,
      next,
      trend,
      aheadAvg,
      period: curPeriod ? { type: curPeriod.type, from: curPeriod.from, till: curPeriod.till, avg: curPeriod.avg } : null,
      nextBest: nextBest ? { from: nextBest.from, till: nextBest.till, avg: nextBest.avg } : null,
      nextPeak: nextPeak ? { from: nextPeak.from, till: nextPeak.till, avg: nextPeak.avg } : null,
      cheaperThan,
    };
  }

  // ----------------------------------------------------------------- gas
  const gasNow = P.currentEntry(gas, now);
  if (gasNow) {
    const gasTomorrow = P.between(gas, bounds[1], bounds[2]);
    payload.gas = {
      price: gasNow.price,
      from: gasNow.from.getTime(),
      till: gasNow.till.getTime(),
      tomorrow: gasTomorrow.length ? P.stats(gasTomorrow).avg : null,
    };
  }

  return payload;
}

module.exports = {
  LEVELS,
  DAY_PARTS,
  DEFAULTS,
  levelOf,
  volatilityOf,
  median,
  runs,
  dayPeriods,
  mergePeriods,
  coverage,
  build,
  minutes,
};
