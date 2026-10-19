'use strict';

/**
 * Minimal GraphQL client for the Frank Energie API.
 *
 * Ported from python-frank-energie (Apache-2.0) as used by the
 * Home Assistant Frank Energie integration (MIT, HiDiHo01).
 */

const DATA_URL = 'https://frank-graphql-prod.graphcdn.app/';

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

class FrankEnergieError extends Error {}

class FrankEnergieApi {
  /**
   * @param {object} [options]
   * @param {Function} [options.fetch] fetch implementation (defaults to global fetch)
   * @param {number} [options.timeout] request timeout in ms
   */
  constructor({ fetch: fetchImpl, timeout = 30000 } = {}) {
    this._fetch = fetchImpl || globalThis.fetch;
    this._timeout = timeout;
  }

  async query(operationName, query, variables = {}, extraHeaders = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeout);
    let res;
    try {
      res = await this._fetch(DATA_URL, {
        method: 'POST',
        headers: { ...DEFAULT_HEADERS, ...extraHeaders },
        body: JSON.stringify({ operationName, query, variables }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new FrankEnergieError(`Network error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new FrankEnergieError(`HTTP ${res.status} from Frank Energie API`);
    }

    const json = await res.json();
    if (json && Array.isArray(json.errors) && json.errors.length) {
      const msg = json.errors.map((e) => e.message).join('; ');
      throw new FrankEnergieError(`API error: ${msg}`);
    }
    return json && json.data ? json.data : {};
  }

  /**
   * Public market prices for one (local) date. No account needed.
   *
   * @param {string} date YYYY-MM-DD in Europe/Amsterdam
   * @param {'PT15M'|'PT60M'} resolution
   * @returns {Promise<{electricity: object[], gas: object[], average: object|null}>}
   */
  async marketPrices(date, resolution = 'PT15M') {
    const data = await this.query('MarketPrices', MARKET_PRICES_QUERY, { date, resolution });
    const mp = data.marketPrices || {};
    return {
      electricity: Array.isArray(mp.electricityPrices) ? mp.electricityPrices : [],
      gas: Array.isArray(mp.gasPrices) ? mp.gasPrices : [],
      average: mp.averageElectricityPrices || null,
    };
  }
}

module.exports = { FrankEnergieApi, FrankEnergieError, DATA_URL };
