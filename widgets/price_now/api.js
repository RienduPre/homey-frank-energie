'use strict';

module.exports = {
  /** Price payload for the device picked in the widget's settings (`key`). */
  async getData({ homey, query }) {
    return homey.app.getWidgetData(query && query.key ? String(query.key) : null);
  },
};
