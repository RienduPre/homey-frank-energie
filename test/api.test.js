'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FrankEnergieApi, FrankEnergieAuthError, jwtExpiry } = require('../lib/FrankEnergieApi');

function jwt(expSeconds) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ exp: expSeconds })}.sig`;
}

/** Fake fetch that answers by operation name and records calls. */
function fakeFetch(handlers) {
  const calls = [];
  const fn = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ op: body.operationName, auth: opts.headers.Authorization || null, vars: body.variables });
    const h = handlers[body.operationName];
    const out = typeof h === 'function' ? h(body, opts, calls) : h;
    const status = out && out.status ? out.status : 200;
    return { ok: status < 400, status, json: async () => out.body || out };
  };
  fn.calls = calls;
  return fn;
}

test('jwtExpiry decodes exp claim', () => {
  assert.equal(jwtExpiry(jwt(1800000000)), 1800000000 * 1000);
  assert.equal(jwtExpiry('not-a-jwt'), null);
});

test('login stores tokens and reports them', async () => {
  let saved = null;
  const fetch = fakeFetch({ Login: { data: { login: { authToken: jwt(9999999999), refreshToken: 'r1' } } } });
  const api = new FrankEnergieApi({ fetch, onTokens: (t) => { saved = t; } });
  await api.login('a@b.nl', 'pw');
  assert.equal(api.isAuthenticated, true);
  assert.equal(saved.refreshToken, 'r1');
  assert.equal(fetch.calls[0].auth, null); // login itself is unauthenticated
});

test('invalid password raises auth error', async () => {
  const fetch = fakeFetch({ Login: { errors: [{ message: 'user-error:password-invalid' }] } });
  const api = new FrankEnergieApi({ fetch });
  await assert.rejects(api.login('a@b.nl', 'x'), (e) => e instanceof FrankEnergieAuthError && e.code === 'password-invalid');
});

test('expired token is renewed before the query', async () => {
  const fresh = jwt(9999999999);
  const fetch = fakeFetch({
    RenewToken: { data: { renewToken: { authToken: fresh, refreshToken: 'r2' } } },
    UserSites: { data: { userSites: [{ reference: 'S1' }] } },
  });
  const api = new FrankEnergieApi({ fetch, tokens: { authToken: jwt(1000), refreshToken: 'r1' } });
  const sites = await api.userSites();
  assert.deepEqual(fetch.calls.map((c) => c.op), ['RenewToken', 'UserSites']);
  assert.equal(fetch.calls[1].auth, `Bearer ${fresh}`);
  assert.equal(sites[0].reference, 'S1');
  assert.equal(api.tokens.refreshToken, 'r2');
});

test('auth error on query triggers one renewal and retry', async () => {
  let first = true;
  const fetch = fakeFetch({
    RenewToken: { data: { renewToken: { authToken: jwt(9999999999), refreshToken: 'r2' } } },
    MonthSummary: () => {
      if (first) { first = false; return { errors: [{ message: 'user-error:auth-required' }] }; }
      return { data: { monthSummary: { expectedCosts: 120.5 } } };
    },
  });
  const api = new FrankEnergieApi({ fetch, tokens: { authToken: jwt(9999999999), refreshToken: 'r1' } });
  const ms = await api.monthSummary('S1');
  assert.equal(ms.expectedCosts, 120.5);
  assert.deepEqual(fetch.calls.map((c) => c.op), ['MonthSummary', 'RenewToken', 'MonthSummary']);
});

test('failed renewal surfaces as auth error', async () => {
  const fetch = fakeFetch({ RenewToken: { errors: [{ message: 'user-error:auth-not-authorised' }] } });
  const api = new FrankEnergieApi({ fetch, tokens: { authToken: jwt(1000), refreshToken: 'r1' } });
  await assert.rejects(api.invoices('S1'), (e) => e instanceof FrankEnergieAuthError);
});

test('ignorable "no data" errors do not throw', async () => {
  const fetch = fakeFetch({ MarketPrices: { data: { marketPrices: null }, errors: [{ message: 'No marketprices found for segment ELECTRICITY' }] } });
  const api = new FrankEnergieApi({ fetch });
  const p = await api.marketPrices('2026-10-21');
  assert.deepEqual(p.electricity, []);
});

test('feature not enabled gives an empty list', async () => {
  const fetch = fakeFetch({ SmartBatteries: { errors: [{ message: 'user-error:smart-trading-not-enabled' }] } });
  const api = new FrankEnergieApi({ fetch, tokens: { authToken: jwt(9999999999), refreshToken: 'r1' } });
  assert.deepEqual(await api.smartBatteries(), []);
});

test('smart charging update sends all charge settings', async () => {
  const fetch = fakeFetch({ EnodeUpdateVehicleChargeSettings: { data: { enodeUpdateVehicleChargeSettings: true } } });
  const api = new FrankEnergieApi({ fetch, tokens: { authToken: jwt(9999999999), refreshToken: 'r1' } });
  const settings = {
    id: 'cs1', deadline: null, isSmartChargingEnabled: false, isSolarChargingEnabled: false,
    minChargeLimit: 20, maxChargeLimit: 80, calculatedDeadline: '2026-10-20T07:00:00Z',
    hourMonday: 420, hourTuesday: 420, hourWednesday: 420, hourThursday: 420,
    hourFriday: 420, hourSaturday: 600, hourSunday: 600,
  };
  await api.updateChargeSettings('vehicle', settings, { isSmartChargingEnabled: true });
  const input = fetch.calls[0].vars.input;
  assert.equal(input.vehicleId, 'cs1');
  assert.equal(input.isSmartChargingEnabled, true);
  assert.equal(input.maxChargeLimit, 80);
  assert.equal(input.hourSaturday, 600);
  assert.equal(input.calculatedDeadline, undefined); // read-only field not sent
  assert.equal(input.id, undefined);
  assert.equal(Object.keys(input).length, 13);
});

test('Belgian prices use the x-country header and the reduced query', async () => {
  let headers = null;
  let query = '';
  const fetch = async (url, opts) => {
    headers = opts.headers;
    query = JSON.parse(opts.body).query;
    return { ok: true, status: 200, json: async () => ({ data: { marketPrices: { electricityPrices: [{ marketPrice: 0.1 }], gasPrices: [] } } }) };
  };
  const api = new FrankEnergieApi({ fetch });
  const p = await api.marketPrices('2026-10-21', 'PT15M', 'BE');
  assert.equal(headers['x-country'], 'BE');
  assert.equal(query.includes('allInPrice'), false);
  assert.equal(p.electricity.length, 1);
});

test('battery settings mutation sends device id and settings', async () => {
  const fetch = fakeFetch({ SmartBatteryUpdateSettings: { data: { smartBatteryUpdateSettings: { batteryMode: 'TRADING' } } } });
  const api = new FrankEnergieApi({ fetch, tokens: { authToken: jwt(9999999999), refreshToken: 'r1' } });
  const r = await api.updateBatterySettings('bat1', { batteryMode: 'TRADING' });
  assert.equal(r.batteryMode, 'TRADING');
  assert.deepEqual(fetch.calls[0].vars, { deviceId: 'bat1', settings: { batteryMode: 'TRADING' } });
});
