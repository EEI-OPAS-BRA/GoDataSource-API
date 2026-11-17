'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['config.json', 'datasources.json'];

class InvalidJsonError extends Error {}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return structuredClone(override);
  }
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ?
      deepMerge(result[key], value) :
      structuredClone(value);
  }
  return result;
}

function applyMongoEnv(datasources, env) {
  const result = structuredClone(datasources);
  result.mongoDb = Object.assign({}, result.mongoDb, {
    host: env.GODATA_MONGO_HOST || 'mongo',
    port: Number(env.GODATA_MONGO_PORT || 27017),
    database: env.GODATA_DB || 'go-data',
    user: env.GODATA_MONGO_USER || 'godata',
    password: env.GODATA_MONGO_PASSWORD,
    authSource: env.GODATA_MONGO_AUTH_SOURCE || 'admin'
  });
  return result;
}

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new InvalidJsonError(`invalid JSON in ${file}: ${err.message}`);
  }
}

function readJsonObject(file) {
  const data = readJson(file);
  if (!isPlainObject(data)) {
    throw new InvalidJsonError(`invalid JSON in ${file}: top-level value must be an object`);
  }
  return data;
}

function writeJsonAtomic(file, data, mode = 0o600) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    try {
      fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function syncRuntimeApiKey(apiKey, runtimeConfigPath) {
  let current = {};
  if (fs.existsSync(runtimeConfigPath)) {
    current = readJsonObject(runtimeConfigPath);
    if (current.apiKey === apiKey) {
      return false;
    }
  }
  writeJsonAtomic(runtimeConfigPath, Object.assign({}, current, { apiKey }), 0o644);
  return true;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--defaults': opts.defaults = argv[++i]; break;
      case '--overrides': opts.overrides = argv[++i]; break;
      case '--server-dir': opts.serverDir = argv[++i]; break;
      case '--runtime-config': opts.runtimeConfig = argv[++i]; break;
      case '--mongo-env': opts.mongoEnv = true; break;
      default: throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  if (!opts.defaults || !opts.overrides || !opts.serverDir) {
    throw new Error('usage: merge-config.js --defaults <dir> --overrides <dir> --server-dir <dir> [--mongo-env] [--runtime-config <file>]');
  }
  return opts;
}

function main(argv, env) {
  const opts = parseArgs(argv);
  if (opts.mongoEnv && !env.GODATA_MONGO_PASSWORD) {
    console.error('GODATA_MONGO_PASSWORD is required with --mongo-env');
    return 3;
  }

  const merged = {};
  for (const name of FILES) {
    const defaultsFile = path.join(opts.defaults, name);
    if (!fs.existsSync(defaultsFile)) {
      console.error(`missing defaults file ${defaultsFile}`);
      return 1;
    }
    merged[name] = readJsonObject(defaultsFile);
    const overrideFile = path.join(opts.overrides, name);
    if (fs.existsSync(overrideFile)) {
      merged[name] = deepMerge(merged[name], readJsonObject(overrideFile));
    }
  }

  if (opts.mongoEnv) {
    merged['datasources.json'] = applyMongoEnv(merged['datasources.json'], env);
  }
  for (const name of FILES) {
    writeJsonAtomic(path.join(opts.serverDir, name), merged[name]);
  }

  if (opts.runtimeConfig && Object.prototype.hasOwnProperty.call(merged['config.json'], 'apiKey')) {
    const changed = syncRuntimeApiKey(merged['config.json'].apiKey, opts.runtimeConfig);
    console.log(changed ? 'runtime config: changed' : 'runtime config: unchanged');
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(err.message);
    process.exitCode = err instanceof InvalidJsonError ? 2 : 1;
  }
}

module.exports = { deepMerge, applyMongoEnv, syncRuntimeApiKey };
