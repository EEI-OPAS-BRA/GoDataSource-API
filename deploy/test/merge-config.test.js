'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { deepMerge, applyMongoEnv } = require('../lib/merge-config');

const CLI = path.join(__dirname, '..', 'lib', 'merge-config.js');

function setup(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-config-'));
  for (const dir of ['defaults', 'overrides', 'server']) {
    fs.mkdirSync(path.join(root, dir));
  }
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

function runCli(root, extra = [], env = {}) {
  return spawnSync(process.execPath, [
    CLI,
    '--defaults', path.join(root, 'defaults'),
    '--overrides', path.join(root, 'overrides'),
    '--server-dir', path.join(root, 'server'),
    ...extra
  ], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
}

test('deepMerge merges nested objects', () => {
  assert.deepEqual(
    deepMerge({ public: { host: 'localhost', port: 3000 } }, { public: { host: 'x.gov.br' } }),
    { public: { host: 'x.gov.br', port: 3000 } }
  );
});

test('deepMerge replaces arrays as a whole', () => {
  const base = { email: { transports: [{ host: 'a' }, { host: 'b' }] } };
  const result = deepMerge(base, { email: { transports: [{ host: 'c' }] } });
  assert.deepEqual(result.email.transports, [{ host: 'c' }]);
});

test('deepMerge keeps keys the override does not mention', () => {
  assert.deepEqual(deepMerge({ a: 1, b: { c: 2 } }, { b: { d: 3 } }), { a: 1, b: { c: 2, d: 3 } });
});

test('deepMerge replaces with null and scalars', () => {
  assert.deepEqual(deepMerge({ a: { b: 1 }, c: 1 }, { a: null, c: 'x' }), { a: null, c: 'x' });
});

test('deepMerge does not mutate its inputs', () => {
  const base = { a: { b: 1 }, l: [1] };
  const override = { a: { c: 2 }, l: [2] };
  const baseCopy = structuredClone(base);
  const overrideCopy = structuredClone(override);
  const result = deepMerge(base, override);
  result.a.b = 99;
  result.l.push(3);
  assert.deepEqual(base, baseCopy);
  assert.deepEqual(override, overrideCopy);
});

test('applyMongoEnv sets every key and defaults', () => {
  const result = applyMongoEnv({ mongoDb: { name: 'mongoDb' } }, { GODATA_MONGO_PASSWORD: 'p@ss:w/rd%#' });
  assert.equal(result.mongoDb.host, 'mongo');
  assert.equal(result.mongoDb.port, 27017);
  assert.equal(result.mongoDb.database, 'go-data');
  assert.equal(result.mongoDb.user, 'godata');
  assert.equal(result.mongoDb.password, 'p@ss:w/rd%#');
  assert.equal(result.mongoDb.authSource, 'admin');
  assert.equal(result.mongoDb.name, 'mongoDb');
});

test('applyMongoEnv converts a custom port to a number', () => {
  const result = applyMongoEnv({ mongoDb: {} }, { GODATA_MONGO_PASSWORD: 'x', GODATA_MONGO_PORT: '27018' });
  assert.equal(result.mongoDb.port, 27018);
});

test('CLI exits 2 naming the broken override', () => {
  const root = setup({ 'defaults/config.json': '{"port":3000}', 'defaults/datasources.json': '{}' });
  const file = path.join(root, 'overrides', 'config.json');
  fs.writeFileSync(file, '{"port": }');
  const res = runCli(root);
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes(file));
  assert.ok(res.stderr.includes('invalid JSON in'));
});

test('CLI merges overrides into the server dir', () => {
  const root = setup({
    'defaults/config.json': '{"public":{"host":"localhost","port":3000}}',
    'defaults/datasources.json': '{"mongoDb":{"host":"h"}}',
    'overrides/config.json': '{"public":{"host":"x.gov.br"}}'
  });
  const res = runCli(root);
  assert.equal(res.status, 0, res.stderr);
  const raw = fs.readFileSync(path.join(root, 'server', 'config.json'), 'utf8');
  assert.deepEqual(JSON.parse(raw), { public: { host: 'x.gov.br', port: 3000 } });
  assert.ok(raw.endsWith('}\n'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'server', 'datasources.json'), 'utf8')), { mongoDb: { host: 'h' } });
});

test('CLI fails when a defaults file is missing', () => {
  const root = setup({ 'defaults/config.json': '{}' });
  const res = runCli(root);
  assert.equal(res.status, 1);
  assert.ok(res.stderr.includes('datasources.json'));
});

test('CLI exits 3 when --mongo-env has no password', () => {
  const root = setup({ 'defaults/config.json': '{}', 'defaults/datasources.json': '{"mongoDb":{}}' });
  assert.equal(runCli(root, ['--mongo-env'], { GODATA_MONGO_PASSWORD: '' }).status, 3);
});

test('CLI applies mongo env to datasources', () => {
  const root = setup({ 'defaults/config.json': '{}', 'defaults/datasources.json': '{"mongoDb":{"name":"mongoDb"}}' });
  const res = runCli(root, ['--mongo-env'], { GODATA_MONGO_PASSWORD: 'secret', GODATA_MONGO_HOST: 'db' });
  assert.equal(res.status, 0, res.stderr);
  const ds = JSON.parse(fs.readFileSync(path.join(root, 'server', 'datasources.json'), 'utf8'));
  assert.equal(ds.mongoDb.host, 'db');
  assert.equal(ds.mongoDb.password, 'secret');
});

test('CLI syncs the runtime apiKey only when set', () => {
  const root = setup({
    'defaults/config.json': '{"port":3000}',
    'defaults/datasources.json': '{}',
    'overrides/config.json': '{"apiKey":"k1"}'
  });
  const runtime = path.join(root, 'runtime-config.json');
  const first = runCli(root, ['--runtime-config', runtime]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^runtime config: changed$/m);
  assert.equal(JSON.parse(fs.readFileSync(runtime, 'utf8')).apiKey, 'k1');
  const second = runCli(root, ['--runtime-config', runtime]);
  assert.match(second.stdout, /^runtime config: unchanged$/m);
});

test('CLI leaves the runtime config alone without an apiKey', () => {
  const root = setup({ 'defaults/config.json': '{"port":3000}', 'defaults/datasources.json': '{}' });
  const runtime = path.join(root, 'runtime-config.json');
  const res = runCli(root, ['--runtime-config', runtime]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.existsSync(runtime), false);
});

test('syncRuntimeApiKey keeps other keys', () => {
  const { syncRuntimeApiKey } = require('../lib/merge-config');
  const root = setup({ 'runtime-config.json': '{"other":1}' });
  const runtime = path.join(root, 'runtime-config.json');
  assert.equal(syncRuntimeApiKey('k', runtime), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(runtime, 'utf8')), { other: 1, apiKey: 'k' });
  assert.equal(syncRuntimeApiKey('k', runtime), false);
});

for (const [label, content] of [['null', 'null'], ['array', '[]']]) {
  test(`CLI exits 2 for a ${label} override`, () => {
    const root = setup({ 'defaults/config.json': '{"port":3000}', 'defaults/datasources.json': '{}' });
    const file = path.join(root, 'overrides', 'config.json');
    fs.writeFileSync(file, content);
    const res = runCli(root);
    assert.equal(res.status, 2);
    assert.ok(res.stderr.includes(file));
  });
}

test('CLI writes config files owner-only', () => {
  const root = setup({ 'defaults/config.json': '{}', 'defaults/datasources.json': '{}' });
  assert.equal(runCli(root).status, 0);
  for (const name of ['config.json', 'datasources.json']) {
    assert.equal(fs.statSync(path.join(root, 'server', name)).mode & 0o777, 0o600);
  }
});

test('CLI leaves no temp file after a failed write', () => {
  const root = setup({ 'defaults/config.json': '{}', 'defaults/datasources.json': '{}' });
  fs.mkdirSync(path.join(root, 'server', 'datasources.json'));
  const res = runCli(root);
  assert.notEqual(res.status, 0);
  assert.deepEqual(fs.readdirSync(path.join(root, 'server')).filter((f) => f.endsWith('.tmp')), []);
});

test('CLI ignores stale temp files in the server dir', () => {
  const root = setup({ 'defaults/config.json': '{}', 'defaults/datasources.json': '{}' });
  for (const name of ['config.json', 'datasources.json']) {
    fs.writeFileSync(path.join(root, 'server', `${name}.1.stale.tmp`), 'junk');
  }
  const res = runCli(root);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'server', 'config.json'), 'utf8')), {});
});
