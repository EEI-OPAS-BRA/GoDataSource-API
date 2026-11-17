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

// Same defaults and precedence as the LoopBack connector, with the credentials escaped: the connector puts them
// into its URL as they are, while the other app components read the raw fields, so both are kept.
function mongoUrl(cfg) {
  const protocol = cfg.protocol || 'mongodb';
  const host = cfg.hostname || cfg.host || '127.0.0.1';
  const port = protocol === 'mongodb+srv' ? '' : `:${cfg.port || 27017}`;
  const query = cfg.authSource ? `?authSource=${encodeURIComponent(cfg.authSource)}` : '';
  return `${protocol}://${encodeURIComponent(cfg.username || cfg.user)}:${encodeURIComponent(cfg.password)}@` +
    `${host}${port}/${encodeURIComponent(cfg.database || cfg.db || 'test')}${query}`;
}

function withMongoUrl(datasources) {
  const cfg = datasources.mongoDb;
  if (!isPlainObject(cfg) || cfg.url || !(cfg.username || cfg.user) || !cfg.password) {
    return datasources;
  }
  return Object.assign({}, datasources, { mongoDb: Object.assign({}, cfg, { url: mongoUrl(cfg) }) });
}

function applyMongoEnv(datasources, env) {
  const result = structuredClone(datasources);
  result.mongoDb = Object.assign({}, result.mongoDb, {
    host: env.GODATA_MONGO_HOST || 'mongo',
    port: Number(env.GODATA_MONGO_PORT || 27017),
    database: env.GODATA_DB || 'go-data',
    user: env.GODATA_MONGO_USER || 'godata',
    password: env.GODATA_MONGO_PASSWORD,
    authSource: env.GODATA_MONGO_AUTH_SOURCE || 'admin',
    url: ''
  });
  delete result.mongoDb.hostname;
  delete result.mongoDb.username;
  return withMongoUrl(result);
}

// Offset of the first syntax error, or -1. Used instead of the JSON.parse message, which quotes the file content
// (an SMTP password in a broken override would end up in the container log).
function syntaxErrorOffset(text) {
  let i = 0;
  const fail = () => {
    throw i;
  };
  const skipSpace = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const expect = char => {
    skipSpace();
    if (text[i] !== char) fail();
    i++;
  };
  const string = () => {
    expect('"');
    while (text[i] !== '"') {
      if (i >= text.length || text.charCodeAt(i) < 0x20) fail();
      if (text[i] === '\\') {
        i++;
        if (text[i] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail();
          i += 4;
        } else if (!'"\\/bfnrt'.includes(text[i]) || i >= text.length) {
          fail();
        }
      }
      i++;
    }
    i++;
  };
  const value = () => {
    skipSpace();
    const literal = ['true', 'false', 'null'].find(word => text.startsWith(word, i));
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (text[i] === '{' || text[i] === '[') {
      const close = text[i] === '{' ? '}' : ']';
      i++;
      skipSpace();
      if (text[i] === close) {
        i++;
        return;
      }
      for (;;) {
        if (close === '}') {
          string();
          expect(':');
        }
        value();
        skipSpace();
        if (text[i] === close) {
          i++;
          return;
        }
        expect(',');
      }
    } else if (text[i] === '"') {
      string();
    } else if (literal) {
      i += literal.length;
    } else if (number) {
      i += number[0].length;
    } else {
      fail();
    }
  };
  try {
    value();
    skipSpace();
    return i < text.length ? i : -1;
  } catch (offset) {
    if (typeof offset !== 'number') throw offset;
    return offset;
  }
}

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    const offset = syntaxErrorOffset(raw);
    if (offset < 0) {
      throw new InvalidJsonError(`invalid JSON in ${file}`);
    }
    const lines = raw.slice(0, offset).split('\n');
    throw new InvalidJsonError(`invalid JSON in ${file} at line ${lines.length} column ${lines[lines.length - 1].length + 1}`);
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
      case '--docker': opts.docker = true; break;
      default: throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  if (!opts.defaults || !opts.overrides || !opts.serverDir) {
    throw new Error('usage: merge-config.js --defaults <dir> --overrides <dir> --server-dir <dir> [--mongo-env] [--docker] [--runtime-config <file>]');
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

  merged['datasources.json'] = opts.mongoEnv ?
    applyMongoEnv(merged['datasources.json'], env) :
    withMongoUrl(merged['datasources.json']);
  if (opts.docker) {
    // The container contract: the app listens on 0.0.0.0:3000 whatever an override copied from a server says
    Object.assign(merged['config.json'], { host: '0.0.0.0', port: 3000 });
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

module.exports = { deepMerge, applyMongoEnv, withMongoUrl, syncRuntimeApiKey, syntaxErrorOffset };
