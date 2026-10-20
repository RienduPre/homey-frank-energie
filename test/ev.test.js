'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// drivers/ev/device.js requires 'homey'; give it a minimal stand-in
const orig = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'homey') return { Device: class {}, Driver: class {} };
  return orig.call(this, request, ...rest);
};
const { nextLocalTime } = require('../drivers/ev/device');

const TZ = 'Europe/Amsterdam';
const local = (d) => d.toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16);

test('next ready-by time later today', () => {
  const now = new Date('2026-10-20T08:00:00Z'); // 10:00 local (CEST)
  assert.equal(local(nextLocalTime(17, 30, TZ, now)), '2026-10-20 17:30');
});

test('next ready-by time rolls over to tomorrow', () => {
  const now = new Date('2026-10-20T08:00:00Z');
  assert.equal(local(nextLocalTime(7, 0, TZ, now)), '2026-10-21 07:00');
});

test('ready-by time across the end of summer time', () => {
  const now = new Date('2026-10-24T20:00:00Z'); // 22:00 local, DST ends that night
  assert.equal(local(nextLocalTime(7, 0, TZ, now)), '2026-10-25 07:00');
});
