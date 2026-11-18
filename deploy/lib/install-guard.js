'use strict';

// Preloaded by the Docker entrypoint into `npm run init-database|migrate-database`. install.js ends with
// process.exit() only when its task chain completes. When the database is lost midway a promise can stay pending,
// the event loop drains and Node would exit 0 as if the command had succeeded.
const fs = require('node:fs');
const path = require('node:path');

const INSTALL_SCRIPT = path.join('server', 'install', 'install.js');

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.sep + INSTALL_SCRIPT)) {
  process.on('beforeExit', () => {
    fs.writeSync(2, 'install script ended without completing: the event loop drained before process.exit\n');
    process.exitCode = 70;
  });
  process.on('exit', code => {
    if (code === 0) {
      fs.writeSync(2, 'install script completed\n');
    }
  });
}
