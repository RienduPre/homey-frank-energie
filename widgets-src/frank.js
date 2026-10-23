/*
 * Shared client code for the Frank Energie dashboard widgets.
 * Source: widgets-src/frank.js, copied into each widget by `npm run widgets`.
 *
 * FE.start(Homey, { render }) fetches the payload from the widget's API,
 * re-renders when the app reports new prices (realtime event) and every
 * 30 seconds so "now" moves along, and refetches every 5 minutes as a fallback.
 */

/* eslint-disable no-unused-vars */
(function (global) {
  'use strict';

  const RERENDER_MS = 30 * 1000;
  const REFETCH_MS = 5 * 60 * 1000;
  const LEVEL_KEYS = ['very_cheap', 'cheap', 'normal', 'expensive', 'very_expensive'];

  const FE = {
    Homey: null,
    settings: {},
    data: null,
    locale: 'nl-NL',
  };

  // ------------------------------------------------------------ translation

  FE.t = function t(key, tokens) {
    if (!FE.Homey) return key;
    let s = FE.Homey.__(`widget.${key}`, tokens);
    if (s === undefined || s === null || s === `widget.${key}`) s = key;
    // Homey replaces __token__; do it here too in case a host does not.
    if (tokens) {
      for (const [k, v] of Object.entries(tokens)) s = String(s).split(`__${k}__`).join(v);
    }
    return s;
  };

  FE.levelName = (lvl) => FE.t(`level.${LEVEL_KEYS[lvl] || 'normal'}`);
  FE.levelColor = (lvl) => `var(--fe-l${lvl === undefined || lvl === null ? 2 : lvl})`;

  // -------------------------------------------------------------- formatting

  function nf(decimals) {
    return new Intl.NumberFormat(FE.locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  /** Price in the unit chosen in the settings: cents or euros. */
  FE.price = function price(v, opts = {}) {
    if (v === null || v === undefined || Number.isNaN(v)) return '–';
    const cents = FE.settings.unit !== 'eur';
    if (cents) {
      const d = opts.short ? (Math.abs(v * 100) >= 100 ? 0 : 1) : 1;
      return nf(d).format(v * 100);
    }
    const d = opts.short ? 2 : 3;
    return nf(d).format(v);
  };

  /** Price with unit, e.g. "25,3 ct" or "€ 0,253". */
  FE.priceUnit = function priceUnit(v, opts = {}) {
    if (FE.settings.unit !== 'eur') return `${FE.price(v, opts)} ct`;
    return `€ ${FE.price(v, opts)}`;
  };

  FE.unitLabel = function unitLabel(energy = 'electricity') {
    if (energy === 'gas') return '€/m³';
    return FE.settings.unit !== 'eur' ? 'ct/kWh' : '€/kWh';
  };

  FE.pct = function pct(v, signed = true) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '';
    const n = Math.round(v * 100);
    const sign = signed && n > 0 ? '+' : n < 0 ? '−' : '';
    return `${sign}${Math.abs(n)} %`;
  };

  FE.time = function time(ms) {
    return new Intl.DateTimeFormat(FE.locale, {
      timeZone: FE.data ? FE.data.tz : undefined,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ms));
  };

  FE.hour = (ms) => FE.time(ms).slice(0, 2);

  FE.weekday = function weekday(ms) {
    return new Intl.DateTimeFormat(FE.locale, {
      timeZone: FE.data ? FE.data.tz : undefined,
      weekday: 'long',
    }).format(new Date(ms));
  };

  /** "in 3 h" / "in 25 min" */
  FE.inTime = function inTime(ms) {
    const min = Math.max(0, Math.round((ms - Date.now()) / 60000));
    if (min < 60) return FE.t('in_min', { n: min });
    const h = Math.round(min / 60);
    return FE.t('in_hours', { n: h });
  };

  /** Day index (0 today, 1 tomorrow) of a time. */
  FE.dayOf = function dayOf(ms) {
    const days = FE.data ? FE.data.days : [];
    if (days[1] && ms >= days[1].from) return 1;
    return 0;
  };

  /** "13:15" or "morgen 01:45" */
  FE.when = function when(ms) {
    const prefix = FE.dayOf(ms) === 1 && FE.dayOf(Date.now()) === 0 ? `${FE.t('tomorrow_lower')} ` : '';
    return `${prefix}${FE.time(ms)}`;
  };

  // ------------------------------------------------------------- data helpers

  /** Slot running now (by the clock, so it stays right between fetches). */
  FE.currentSlot = function currentSlot() {
    if (!FE.data) return null;
    const t = Date.now();
    return FE.data.slots.find((s) => s.from <= t && t < s.till) || null;
  };

  FE.periodAt = function periodAt(t) {
    if (!FE.data) return null;
    return FE.data.periods.find((p) => p.from <= t && t < p.till) || null;
  };

  FE.nextPeriod = function nextPeriod(type, t = Date.now()) {
    if (!FE.data) return null;
    return FE.data.periods.find((p) => p.type === type && p.from > t) || null;
  };

  FE.dayStats = (i) => (FE.data ? FE.data.days[i] : null);

  /** Hour aggregates from now on (the running hour included). */
  FE.hoursFromNow = function hoursFromNow() {
    if (!FE.data) return [];
    const t = Date.now();
    return FE.data.hours.filter((h) => h.till > t);
  };

  /**
   * One line on what to make of the price now, plus the box style:
   * {type: 'best'|'peak'|'', title, lines: []}.
   */
  FE.verdict = function verdict() {
    const t = Date.now();
    const cur = FE.currentSlot();
    if (!cur) return { type: '', title: FE.t('no_current'), lines: [] };
    const per = FE.periodAt(t);
    const nextBest = FE.nextPeriod('best', t);
    const nextPeak = FE.nextPeriod('peak', t);
    if (per && per.type === 'best') {
      const lines = [FE.t('until', { time: FE.when(per.till) })];
      if (nextPeak && nextPeak.from - t < 3 * 3600000) lines.push(FE.t('peak_from', { time: FE.when(nextPeak.from) }));
      return { type: 'best', title: FE.t('best_running'), lines, short: FE.t('best_until_short', { time: FE.when(per.till) }) };
    }
    if (per && per.type === 'peak') {
      const lines = [FE.t('until', { time: FE.when(per.till) })];
      if (nextBest) lines.push(FE.t('best_from', { time: FE.when(nextBest.from), in: FE.inTime(nextBest.from) }));
      return { type: 'peak', title: FE.t('peak_running'), lines, short: FE.t('peak_until_short', { time: FE.when(per.till) }) };
    }
    const lines = [];
    let short = '';
    if (nextBest) {
      lines.push(FE.t('best_from', { time: FE.when(nextBest.from), in: FE.inTime(nextBest.from) }));
      short = FE.t('best_in_short', { in: FE.inTime(nextBest.from) });
    }
    if (nextPeak && nextPeak.from - t < 3 * 3600000) {
      lines.push(FE.t('peak_from', { time: FE.when(nextPeak.from) }));
      if (!short) short = FE.t('peak_in_short', { in: FE.inTime(nextPeak.from) });
    }
    if (!lines.length) lines.push(FE.t('no_periods_ahead'));
    return { type: '', title: FE.t('no_period_now'), lines, short };
  };

  // ---------------------------------------------------------------- svg/html

  FE.esc = function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  };

  FE.trendIcon = function trendIcon(trend) {
    const paths = {
      rising: 'M3 15l5-5 4 4 7-7M14 7h5v5',
      falling: 'M3 7l5 5 4-4 7 7M14 15h5v-5',
      stable: 'M3 11h16M15 7l4 4-4 4',
    };
    const d = paths[trend] || paths.stable;
    return `<svg class="fe-trend" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="${FE.esc(FE.t(`trend.${trend || 'stable'}`))}"><path d="${d}"/></svg>`;
  };

  /** Point on a circle; angle in degrees, 0 = top, clockwise. */
  FE.polar = function polar(cx, cy, r, deg) {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  FE.arc = function arc(cx, cy, r, a0, a1) {
    const [x0, y0] = FE.polar(cx, cy, r, a0);
    const [x1, y1] = FE.polar(cx, cy, r, a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  // ------------------------------------------------------------------- start

  let renderFn = null;
  let lastHeight = null;

  FE.fitHeight = function fitHeight(extra = 0) {
    if (!FE.Homey) return;
    const h = Math.ceil(document.body.scrollHeight + extra);
    if (h && h !== lastHeight) {
      lastHeight = h;
      const r = FE.Homey.setHeight(h);
      if (r && r.catch) r.catch(() => {});
    }
  };

  FE.render = function render() {
    if (!renderFn) return;
    try {
      renderFn(FE.data);
    } catch (err) {
      FE.showMessage(FE.t('error'));
      // eslint-disable-next-line no-console
      console.error(err);
    }
  };

  FE.showMessage = function showMessage(text) {
    const root = document.getElementById('root');
    if (root) root.innerHTML = `<div class="fe-message fe-s">${FE.esc(text)}</div>`;
    FE.fitHeight();
  };

  FE.fetch = async function fetchData() {
    const key = FE.settings.device && FE.settings.device.key ? FE.settings.device.key : '';
    try {
      FE.data = await FE.Homey.api('GET', `/?key=${encodeURIComponent(key)}`);
      FE.render();
    } catch (err) {
      FE.data = null;
      const msg = err && err.message ? err.message : String(err);
      FE.showMessage(msg || FE.t('error'));
    }
  };

  FE.start = function start(Homey, opts) {
    FE.Homey = Homey;
    FE.settings = Homey.getSettings() || {};
    FE.locale = FE.t('locale');
    if (FE.locale === 'locale') FE.locale = 'nl-NL';
    renderFn = opts.render;

    let readyDone = false;
    const ready = () => {
      if (readyDone) return;
      readyDone = true;
      Homey.ready({ height: Math.ceil(document.body.scrollHeight) || opts.height || 120 });
      lastHeight = Math.ceil(document.body.scrollHeight);
    };

    FE.fetch().finally(ready);

    Homey.on('frank_prices_updated', (payload) => {
      const key = FE.settings.device && FE.settings.device.key;
      if (!key || !payload || !payload.key || payload.key === key || (FE.data && FE.data.key === payload.key)) {
        FE.fetch();
      }
    });

    setInterval(FE.render, RERENDER_MS);
    setInterval(FE.fetch, REFETCH_MS);
    window.addEventListener('resize', () => FE.render());
  };

  global.FE = FE;
}(window));
