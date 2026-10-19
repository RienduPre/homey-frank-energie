'use strict';

/**
 * GraphQL client for the Frank Energie API.
 *
 * Ported from python-frank-energie (Apache-2.0) as used by the
 * Home Assistant Frank Energie integration (MIT, HiDiHo01).
 */

const DATA_URL = 'https://frank-graphql-prod.graphcdn.app/';
const TOKEN_RENEWAL_MARGIN_MS = 5 * 60 * 1000;

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'x-graphql-client-version': '4.13.3',
  'x-graphql-client-name': 'frank-app',
  'x-graphql-client-os': 'ios/26.0.1',
  'skip-graphcdn': '1',
};

const PRICE_FIELDS = `
  from
  till
  resolution
  marketPrice
  marketPriceTax
  sourcingMarkupPrice
  energyTaxPrice
  marketPricePlus
  allInPrice
  perUnit
`;

const MARKET_PRICES_QUERY = `
query MarketPrices($date: String!, $resolution: PriceResolution!) {
  marketPrices(date: $date, resolution: $resolution) {
    averageElectricityPrices {
      averageMarketPrice
      averageMarketPricePlus
      averageAllInPrice
      perUnit
      isWeighted
    }
    electricityPrices { ${PRICE_FIELDS} }
    gasPrices { ${PRICE_FIELDS} }
  }
}`;

const CUSTOMER_PRICES_QUERY = `
query MarketPrices($date: String!, $siteReference: String!) {
  customerMarketPrices(date: $date, siteReference: $siteReference) {
    averageElectricityPrices {
      averageMarketPrice
      averageMarketPricePlus
      averageAllInPrice
      perUnit
      isWeighted
    }
    electricityPrices {
      from
      till
      resolution
      marketPrice
      marketPricePlus
      marketPriceTax
      sourcingMarkupPrice: consumptionSourcingMarkupPrice
      energyTaxPrice: energyTax
      allInPrice
      perUnit
    }
    gasPrices {
      from
      till
      resolution
      marketPrice
      marketPricePlus
      marketPriceTax
      sourcingMarkupPrice: consumptionSourcingMarkupPrice
      energyTaxPrice: energyTax
      perUnit
    }
  }
}`;

const LOGIN_MUTATION = `
mutation Login($email: String!, $password: String!) {
  login(email: $email, password: $password) {
    authToken
    refreshToken
  }
}`;

const RENEW_MUTATION = `
mutation RenewToken($authToken: String!, $refreshToken: String!) {
  renewToken(authToken: $authToken, refreshToken: $refreshToken) {
    authToken
    refreshToken
  }
}`;

const USER_SITES_QUERY = `
query UserSites {
  userSites {
    address { addressFormatted }
    deliveryStartDate
    deliveryEndDate
    firstMeterReadingDate
    lastMeterReadingDate
    propositionType
    reference
    segments
    status
  }
}`;

const MONTH_SUMMARY_QUERY = `
query MonthSummary($siteReference: String!) {
  monthSummary(siteReference: $siteReference) {
    actualCostsUntilLastMeterReadingDate
    expectedCostsUntilLastMeterReadingDate
    expectedCosts
    lastMeterReadingDate
    meterReadingDayCompleteness
    gasExcluded
  }
}`;

const USAGE_FIELDS = `
  usageTotal
  costsTotal
  unit
`;

const PERIOD_USAGE_QUERY = `
query PeriodUsageAndCosts($date: String!, $siteReference: String!) {
  periodUsageAndCosts(date: $date, siteReference: $siteReference) {
    gas { ${USAGE_FIELDS} }
    electricity { ${USAGE_FIELDS} }
    feedIn { ${USAGE_FIELDS} }
  }
}`;

const INVOICES_QUERY = `
query Invoices($siteReference: String!) {
  invoices(siteReference: $siteReference) {
    previousPeriodInvoice { startDate periodDescription totalAmount }
    currentPeriodInvoice { startDate periodDescription totalAmount }
    upcomingPeriodInvoice { startDate periodDescription totalAmount }
  }
}`;

/** GraphQL messages that are expected "no data" situations, not failures. */
const IGNORABLE_MESSAGES = [
  /^No marketprices found for segment/,
  /^No reading dates found for user/,
  /^user-error:smart-feed-in-not-enabled$/,
  /^'Base' niet aanwezig in prijzen verzameling$/,
];

class FrankEnergieError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'error';
  }
}

class FrankEnergieAuthError extends FrankEnergieError {
  constructor(message, code = 'auth') {
    super(message, code);
  }
}

/** Decode the `exp` claim of a JWT (no signature check). Returns ms epoch or null. */
function jwtExpiry(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const exp = JSON.parse(json).exp;
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch (err) {
    return null;
  }
}

class FrankEnergieApi {
  /**
   * @param {object} [options]
   * @param {Function} [options.fetch] fetch implementation (defaults to global fetch)
   * @param {number} [options.timeout] request timeout in ms
   * @param {{authToken: string, refreshToken: string}} [options.tokens] stored tokens
   * @param {Function} [options.onTokens] called with new tokens after login/renewal
   */
  constructor({
    fetch: fetchImpl, timeout = 30000, tokens = null, onTokens = null,
  } = {}) {
    this._fetch = fetchImpl || globalThis.fetch;
    this._timeout = timeout;
    this._tokens = tokens && tokens.authToken ? tokens : null;
    this._onTokens = onTokens;
    this._renewing = null;
  }

  get isAuthenticated() {
    return !!this._tokens;
  }

  get tokens() {
    return this._tokens;
  }

  tokenNeedsRenewal(now = Date.now()) {
    if (!this._tokens) return false;
    const exp = jwtExpiry(this._tokens.authToken);
    return exp === null || exp - TOKEN_RENEWAL_MARGIN_MS <= now;
  }

  async _raw(operationName, query, variables, { auth = true, extraHeaders = {} } = {}) {
    const headers = { ...DEFAULT_HEADERS, ...extraHeaders };
    if (auth && this._tokens) headers.Authorization = `Bearer ${this._tokens.authToken}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeout);
    let res;
    try {
      res = await this._fetch(DATA_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ operationName, query, variables }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new FrankEnergieError(`Network error: ${err.message}`, 'network');
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) throw new FrankEnergieAuthError('Authentication required', 'auth-required');
    if (res.status === 403) throw new FrankEnergieAuthError('Not authorised', 'auth-not-authorised');
    if (!res.ok) throw new FrankEnergieError(`HTTP ${res.status} from Frank Energie API`, 'http');

    const json = await res.json();
    FrankEnergieApi.checkErrors(json);
    return json && json.data ? json.data : {};
  }

  static checkErrors(json) {
    if (!json || !Array.isArray(json.errors) || !json.errors.length) return;
    for (const e of json.errors) {
      const msg = (e && typeof e.message === 'string') ? e.message : '';
      if (IGNORABLE_MESSAGES.some((re) => re.test(msg))) continue;
      if (msg === 'user-error:password-invalid') throw new FrankEnergieAuthError('Invalid e-mail or password', 'password-invalid');
      if (msg === 'user-error:auth-not-authorised') throw new FrankEnergieAuthError('Not authorised', 'auth-not-authorised');
      if (msg === 'user-error:auth-required') throw new FrankEnergieAuthError('Authentication required', 'auth-required');
      throw new FrankEnergieError(`API error: ${msg || 'unknown'}`, msg || 'api');
    }
  }

  /** Authenticated query with automatic token renewal (once on auth failure). */
  async query(operationName, query, variables = {}, options = {}) {
    if (options.auth === false || !this._tokens) {
      return this._raw(operationName, query, variables, options);
    }
    if (this.tokenNeedsRenewal()) await this.renew();
    try {
      return await this._raw(operationName, query, variables, options);
    } catch (err) {
      if (!(err instanceof FrankEnergieAuthError) || err.code === 'password-invalid') throw err;
      await this.renew();
      return this._raw(operationName, query, variables, options);
    }
  }

  // ---------------------------------------------------------------- auth

  async login(email, password) {
    if (!email || !password) throw new FrankEnergieAuthError('E-mail and password are required', 'password-invalid');
    const data = await this._raw('Login', LOGIN_MUTATION, { email, password }, { auth: false });
    const t = data.login;
    if (!t || !t.authToken || !t.refreshToken) throw new FrankEnergieAuthError('Login failed', 'login-failed');
    this._setTokens({ authToken: t.authToken, refreshToken: t.refreshToken });
    return this._tokens;
  }

  async renew() {
    if (!this._tokens) throw new FrankEnergieAuthError('Not logged in', 'auth-required');
    if (this._renewing) return this._renewing;
    this._renewing = (async () => {
      try {
        const data = await this._raw('RenewToken', RENEW_MUTATION, {
          authToken: this._tokens.authToken,
          refreshToken: this._tokens.refreshToken,
        }, { auth: false });
        const t = data.renewToken;
        if (!t || !t.authToken) throw new FrankEnergieAuthError('Token renewal failed', 'renew-failed');
        this._setTokens({ authToken: t.authToken, refreshToken: t.refreshToken || this._tokens.refreshToken });
        return this._tokens;
      } catch (err) {
        if (err instanceof FrankEnergieAuthError) throw err;
        if (err.code === 'network' || err.code === 'http') throw err;
        throw new FrankEnergieAuthError(`Token renewal failed: ${err.message}`, 'renew-failed');
      } finally {
        this._renewing = null;
      }
    })();
    return this._renewing;
  }

  _setTokens(tokens) {
    this._tokens = tokens;
    if (typeof this._onTokens === 'function') {
      try {
        this._onTokens(tokens);
      } catch (err) {
        // ignore listener errors
      }
    }
  }

  // ------------------------------------------------------------ queries

  /**
   * Public market prices for one (local) date. No account needed.
   *
   * @param {string} date YYYY-MM-DD in Europe/Amsterdam
   * @param {'PT15M'|'PT60M'} resolution
   * @returns {Promise<{electricity: object[], gas: object[], average: object|null}>}
   */
  async marketPrices(date, resolution = 'PT15M') {
    const data = await this._raw('MarketPrices', MARKET_PRICES_QUERY, { date, resolution }, { auth: false });
    return FrankEnergieApi._prices(data.marketPrices);
  }

  /** Customer prices for a delivery site (contract resolution, own markup). */
  async customerPrices(date, siteReference) {
    const data = await this.query('MarketPrices', CUSTOMER_PRICES_QUERY, { date, siteReference });
    return FrankEnergieApi._prices(data.customerMarketPrices);
  }

  static _prices(mp) {
    const p = mp || {};
    return {
      electricity: Array.isArray(p.electricityPrices) ? p.electricityPrices : [],
      gas: Array.isArray(p.gasPrices) ? p.gasPrices : [],
      average: p.averageElectricityPrices || null,
    };
  }

  async userSites() {
    const data = await this.query('UserSites', USER_SITES_QUERY, {});
    return Array.isArray(data.userSites) ? data.userSites : [];
  }

  async monthSummary(siteReference) {
    const data = await this.query('MonthSummary', MONTH_SUMMARY_QUERY, { siteReference });
    return data.monthSummary || null;
  }

  /** Usage and costs for one local date (YYYY-MM-DD). */
  async periodUsageAndCosts(siteReference, date) {
    const data = await this.query('PeriodUsageAndCosts', PERIOD_USAGE_QUERY, { siteReference, date });
    return data.periodUsageAndCosts || null;
  }

  async invoices(siteReference) {
    const data = await this.query('Invoices', INVOICES_QUERY, { siteReference });
    return data.invoices || null;
  }
}

module.exports = {
  FrankEnergieApi,
  FrankEnergieError,
  FrankEnergieAuthError,
  jwtExpiry,
  DATA_URL,
};
