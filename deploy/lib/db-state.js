'use strict';

const fs = require('node:fs');
const { MongoClient } = require('mongodb');

const SERVER_SELECTION_TIMEOUT_MS = 10000;

// Defaults are the same as applyMongoEnv in merge-config.js
function buildUri(env) {
  const host = env.GODATA_MONGO_HOST || 'mongo';
  const port = env.GODATA_MONGO_PORT || 27017;
  const user = env.GODATA_MONGO_USER || 'godata';
  const authSource = env.GODATA_MONGO_AUTH_SOURCE || 'admin';
  if (!env.GODATA_MONGO_PASSWORD) {
    throw new Error('GODATA_MONGO_PASSWORD is required');
  }
  const credentials = `${encodeURIComponent(user)}:${encodeURIComponent(env.GODATA_MONGO_PASSWORD)}@`;
  return `mongodb://${credentials}${host}:${port}/?authSource=${encodeURIComponent(authSource)}`;
}

function buildUriFromDatasources(datasources) {
  const cfg = (datasources && datasources.mongoDb) || {};
  if (cfg.url) {
    return cfg.url;
  }
  const credentials = cfg.user ?
    `${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.password || '')}@` :
    '';
  const query = cfg.user && cfg.authSource ? `?authSource=${encodeURIComponent(cfg.authSource)}` : '';
  return `mongodb://${credentials}${cfg.host || '127.0.0.1'}:${cfg.port || 27017}/${query}`;
}

async function withDb({ uri, dbName }, fn) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS });
  await client.connect();
  try {
    return await fn(client.db(dbName));
  } finally {
    await client.close();
  }
}

function hasUsers(conn) {
  return withDb(conn, async db => (await db.collection('user').findOne({}, { projection: { _id: 1 } })) !== null);
}

// init-database drops every collection, so it may only run on a database without any document.
function dbEmpty(conn) {
  return withDb(conn, async db => {
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) {
      if (!name.startsWith('system.') && await db.collection(name).findOne({}, { projection: { _id: 1 } })) {
        return false;
      }
    }
    return true;
  });
}

function migrationInProgress(conn) {
  return withDb(conn, async db =>
    (await db.collection('migrationLog').findOne({ status: 'Started' }, { projection: { _id: 1 } })) !== null);
}

function setBackupLocation({ location, ...conn }) {
  return withDb(conn, async db => {
    const settings = db.collection('systemSettings');
    const doc = await settings.findOne({}, { projection: { 'dataBackup.location': 1 } });
    if (!doc) {
      throw new Error('no systemSettings document found');
    }
    const previous = doc.dataBackup ? doc.dataBackup.location : undefined;
    if (previous === location) {
      return { changed: false, previous };
    }
    await settings.updateOne({ _id: doc._id }, { $set: { 'dataBackup.location': location } });
    return { changed: true, previous };
  });
}

const USAGE = 'usage: db-state.js <has-users|db-empty|migration-in-progress|set-backup-location <path>> [--uri <uri>] [--db <name>]\n' +
  '       db-state.js print-uri --datasources <file>';

function parseArgs(argv) {
  const opts = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--uri': opts.uri = argv[++i]; break;
      case '--db': opts.db = argv[++i]; break;
      case '--datasources': opts.datasources = argv[++i]; break;
      default: opts.positional.push(argv[i]);
    }
  }
  return opts;
}

async function main(argv, env) {
  const opts = parseArgs(argv);
  const [command, arg] = opts.positional;

  if (command === 'print-uri') {
    if (!opts.datasources) {
      throw new Error(USAGE);
    }
    console.log(buildUriFromDatasources(JSON.parse(fs.readFileSync(opts.datasources, 'utf8'))));
    return 0;
  }

  if (!['has-users', 'db-empty', 'migration-in-progress', 'set-backup-location'].includes(command) ||
    (command === 'set-backup-location' && !arg)) {
    throw new Error(USAGE);
  }
  const conn = {
    uri: opts.uri || buildUri(env),
    dbName: opts.db || env.GODATA_DB || 'go-data'
  };

  if (command === 'has-users') {
    console.log(await hasUsers(conn) ? 'yes' : 'no');
  } else if (command === 'db-empty') {
    console.log(await dbEmpty(conn) ? 'yes' : 'no');
  } else if (command === 'migration-in-progress') {
    console.log(await migrationInProgress(conn) ? 'yes' : 'no');
  } else {
    const { changed, previous } = await setBackupLocation(Object.assign({ location: arg }, conn));
    console.log(changed ? `changed ${previous} -> ${arg}` : `unchanged ${arg}`);
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2), process.env).then(
    code => { process.exitCode = code; },
    err => {
      console.error(err.message);
      process.exitCode = 1;
    }
  );
}

module.exports = { hasUsers, dbEmpty, migrationInProgress, setBackupLocation, buildUri, buildUriFromDatasources };
