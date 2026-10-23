'use strict';

/*
 * Copies the shared widget client (widgets-src/frank.js and frank.css) into
 * every widget's public folder. Homey only serves files from a widget's own
 * public folder, so each widget carries a copy. Run `npm run widgets` after
 * changing anything in widgets-src/.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'widgets-src');
const widgets = path.join(root, 'widgets');

for (const id of fs.readdirSync(widgets)) {
  const pub = path.join(widgets, id, 'public');
  if (!fs.existsSync(pub)) continue;
  for (const file of ['frank.js', 'frank.css']) {
    fs.copyFileSync(path.join(src, file), path.join(pub, file));
  }
  console.log(`widgets/${id}/public: frank.js, frank.css`);
}
