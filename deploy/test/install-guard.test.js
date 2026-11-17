'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, '..', 'lib', 'install-guard.js');

function run(relative, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-guard-'));
  const script = path.join(root, relative);
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, body);
  try {
    return spawnSync(process.execPath, ['--require', GUARD, script], { encoding: 'utf8' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('an install script that drains the event loop exits non-zero', () => {
  const res = run('server/install/install.js', 'setTimeout(() => {}, 10);\n');
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /install script ended without completing/);
  assert.doesNotMatch(res.stderr, /install script completed/);
});

test('an install script that calls process.exit() reports completion', () => {
  const res = run('server/install/install.js', 'setTimeout(() => process.exit(), 10);\n');
  assert.equal(res.status, 0);
  assert.match(res.stderr, /^install script completed$/m);
});

test('an install script that exits 1 keeps its code and reports nothing', () => {
  const res = run('server/install/install.js', 'setTimeout(() => process.exit(1), 10);\n');
  assert.equal(res.status, 1);
  assert.equal(res.stderr, '');
});

test('other scripts are left alone', () => {
  const res = run('components/worker.js', 'setTimeout(() => {}, 10);\n');
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
});
