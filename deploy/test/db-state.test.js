'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MongoClient } = require('mongodb');

const {
  hasUsers,
  dbEmpty,
  migrationInProgress,
  setBackupLocation,
  buildUri,
  buildUriFromDatasources
} = require('../lib/db-state');

const baseUri = process.env.GODATA_TEST_MONGO_URI;
const skip = baseUri ? false : 'GODATA_TEST_MONGO_URI is not set';
const dbName = `godata_sim_test_${crypto.randomBytes(4).toString('hex')}`;

async function withDb(fn, name = dbName) {
  const client = new MongoClient(baseUri);
  await client.connect();
  try {
    return await fn(client.db(name));
  } finally {
    await client.close();
  }
}

after(async () => {
  if (baseUri) {
    await withDb(db => db.dropDatabase());
    await withDb(db => db.dropDatabase(), `${dbName}_empty`);
  }
});

test('dbEmpty is true until any collection has a document', { skip }, async () => {
  const conn = { uri: baseUri, dbName: `${dbName}_empty` };
  assert.strictEqual(await dbEmpty(conn), true);
  await withDb(db => db.createCollection('location'), conn.dbName);
  assert.strictEqual(await dbEmpty(conn), true);
  await withDb(db => db.collection('location').insertOne({ name: 'x' }), conn.dbName);
  assert.strictEqual(await dbEmpty(conn), false);
});

test('hasUsers is false on an empty db and true after one insert in user', { skip }, async () => {
  assert.strictEqual(await hasUsers({ uri: baseUri, dbName }), false);
  await withDb(db => db.collection('user').insertOne({ email: 'a@b.c' }));
  assert.strictEqual(await hasUsers({ uri: baseUri, dbName }), true);
});

test('migrationInProgress is true only when a migrationLog document has status Started', { skip }, async () => {
  assert.strictEqual(await migrationInProgress({ uri: baseUri, dbName }), false);
  await withDb(db => db.collection('migrationLog').insertOne({ status: 'Success' }));
  assert.strictEqual(await migrationInProgress({ uri: baseUri, dbName }), false);
  await withDb(db => db.collection('migrationLog').insertOne({ status: 'Started' }));
  assert.strictEqual(await migrationInProgress({ uri: baseUri, dbName }), true);
});

test('setBackupLocation changes it once and then reports unchanged', { skip }, async () => {
  await withDb(db => db.collection('systemSettings').insertOne({ dataBackup: { location: '/old', enabled: true } }));
  assert.deepStrictEqual(
    await setBackupLocation({ uri: baseUri, dbName, location: '/data/backups' }),
    { changed: true, previous: '/old' }
  );
  assert.deepStrictEqual(
    await setBackupLocation({ uri: baseUri, dbName, location: '/data/backups' }),
    { changed: false, previous: '/data/backups' }
  );
  const doc = await withDb(db => db.collection('systemSettings').findOne({}));
  assert.strictEqual(doc.dataBackup.location, '/data/backups');
  assert.strictEqual(doc.dataBackup.enabled, true);
});

test('buildUri escapes special characters', () => {
  const password = 'p@ss:w/rd%#';
  const uri = buildUri({
    GODATA_MONGO_HOST: 'db.local',
    GODATA_MONGO_PORT: '27018',
    GODATA_MONGO_USER: 'us@er',
    GODATA_MONGO_PASSWORD: password
  });
  const parsed = new URL(uri);
  assert.strictEqual(decodeURIComponent(parsed.password), password);
  assert.strictEqual(decodeURIComponent(parsed.username), 'us@er');
  assert.strictEqual(parsed.host, 'db.local:27018');
  assert.strictEqual(parsed.searchParams.get('authSource'), 'admin');
});

test('buildUri uses the defaults', () => {
  assert.strictEqual(
    buildUri({ GODATA_MONGO_PASSWORD: 'x' }),
    'mongodb://godata:x@mongo:27017/?authSource=admin'
  );
});

test('print-uri round-trips a special-character password', () => {
  const password = 'p@ss:w/rd%#';
  const uri = buildUriFromDatasources({
    mongoDb: { host: 'h', port: 27017, database: 'd', user: 'u', password, authSource: 'admin' }
  });
  assert.strictEqual(decodeURIComponent(new URL(uri).password), password);
  assert.strictEqual(new URL(uri).searchParams.get('authSource'), 'admin');
});

test('print-uri without a user has no credentials', () => {
  assert.strictEqual(
    buildUriFromDatasources({ mongoDb: { host: 'h', port: 27017, database: 'd' } }),
    'mongodb://h:27017/'
  );
});

test('print-uri prefers a non-empty url as is', () => {
  const url = 'mongodb://u:p@x:1/db?replicaSet=r';
  assert.strictEqual(buildUriFromDatasources({ mongoDb: { url, host: 'h' } }), url);
});

test('CLI print-uri reads a datasources file', () => {
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbstate-'));
  try {
    const file = path.join(dir, 'datasources.json');
    fs.writeFileSync(file, JSON.stringify({ mongoDb: { host: 'h', port: 1, database: 'd' } }));
    const out = execFileSync(process.execPath, [path.join(__dirname, '../lib/db-state.js'), 'print-uri', '--datasources', file]);
    assert.strictEqual(out.toString(), 'mongodb://h:1/\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI print-uri never echoes a malformed datasources file', () => {
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbstate-'));
  try {
    const file = path.join(dir, 'datasources.json');
    fs.writeFileSync(file, '{\n  "mongoDb": {"user": "u", "password": s3cret-Mongo-Value}\n}\n');
    const res = spawnSync(process.execPath, [path.join(__dirname, '../lib/db-state.js'), 'print-uri', '--datasources', file],
      { encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0);
    assert.ok(res.stderr.includes(file), res.stderr);
    assert.match(res.stderr, /line 2 column 40/);
    assert.ok(!res.stderr.includes('s3cret'), res.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
