# Go.Data upgrade manual

[Português](../pt-BR/atualizacao.md) · [Installation](installation.md) · [Configuration](configuration.md) ·
[Backup](backup.md) · [Release notes](release-notes.md)

## Disclaimer

- This distribution is a fork of Go.Data as published by WHO. It is not a WHO release and WHO does not endorse it.
- The software is provided as is, without warranty, under the GPL-3.0 license.
- A backup is mandatory. Migrations change the database and cannot be undone automatically.
- Whenever possible, upgrade a test copy first and plan a maintenance window.
- The operator of each installation is responsible for its data, access control and compliance with data protection
  law.
- Report problems in the issues of the API repository.

## Which case is yours

The upgrade path depends on the server's system, on how Go.Data runs and on the MongoDB version. The block shows all
three. Run it as the user who operates Go.Data, in a terminal where the `pm2` or `docker` commands already work.

```bash
. /etc/os-release && echo "$PRETTY_NAME"
if command -v mongod > /dev/null; then mongod --version | head -n 1; else echo "mongod: not installed on this server"; fi
if command -v pm2 > /dev/null; then pm2 list; else echo "pm2: not found"; fi
if command -v docker > /dev/null; then docker compose ls; else echo "docker: not found"; fi
```

Expected result: the Ubuntu version, the MongoDB version (`db version v7.0.` followed by the number, for example), the
pm2 process list or the list of Docker Compose installations, with the folder of each. If MongoDB runs on another
server, `mongosh --quiet --eval 'db.version()'` run there shows its version.

| The server has | Case |
| --- | --- |
| Ubuntu 20.04 or older, or Windows, with pm2, as a service or as a node process | 2, onto a new server with Ubuntu 22.04 or 24.04 and Docker. The API is stopped the way it runs today, as in step 2.17 |
| Ubuntu 22.04, pm2 and MongoDB 7.0 | 1, pm2 to pm2 |
| Ubuntu 22.04 with pm2 and MongoDB below 7.0 (5.0, 6.0), or Ubuntu 24.04 with pm2 | 2, pm2 to Docker on the same server |
| Docker, installed with the [installation manual](installation.md) | 3, Docker to Docker |

Case 1 covers three starting points, all with pm2 and MongoDB 7.0 on the server itself:

- a source installation made with the upgrade guide of version 2026.10.0 (the API in `/opt/godata/2026.10.0/api`, for
  example);
- an installation made with the WHO installer (the API in `/godata/v<version>/go-data/build`);
- an installation made with path A of the [installation manual](installation.md) (the API in
  `/opt/godata/versions/<version>`).

For the first two, the upgrade also moves the installation to the folder layout of the installation manual, in
`/opt/godata`, without changing the old folder, which stays as the way back.

## Before you start

- Read the [release notes](release-notes.md) of the new version.
- Plan a maintenance window and warn the users. The system is down from step 1.6 (case 1), 2.6, 2.12 or 2.17
  (case 2) or 3.3 (case 3) until the **Final check**.
- Check the free disk space: at least twice the size of the database, plus 3 GB.
- The previous installation stays untouched until the check is done: on pm2, the folder of the previous version and
  the previous Node.js; on Docker, the previous image; in case 2, the old pm2 process, stopped, and the old MongoDB.
  Keep them for a few days of use of the new version. Only remove the old installation (step 2.10) after those days.
- Run every step as the user who operates Go.Data, without `sudo`, in the same terminal. The commands that need
  `sudo` already have it. On Docker, this user must be able to use `docker` without `sudo` (`docker` group).
- Open that terminal in a `tmux` session (`sudo apt-get install -y tmux`, then `tmux new -s godata`). If the SSH
  connection drops, the session keeps running with its commands and variables: log in again and return to it with
  `tmux attach -t godata`.

When moving from a 2.x version to 2026.10.0:

- The Portuguese texts of the system terms are rewritten during the upgrade. Custom translations of those terms
  imported from a spreadsheet will be replaced.
- The usual place of residence address becomes mandatory for cases and contacts, except in outbreaks configured with
  an optional address. Agree with the teams on how to handle older records without an address.

## Variables

Adjust the values to your installation and run them in the same terminal you will use for every step. If the terminal
is closed, run this block again.

```bash
export GODATA_DIR=/opt/godata
export GODATA_NEW_VERSION=2026.10.0
export GODATA_PM2=godata
export GODATA_OLD_API=/opt/godata/2026.10.0/api
export GODATA_BACKUP="$GODATA_DIR/dumps/antes-de-$GODATA_NEW_VERSION"
```

Expected result: no output.

- `GODATA_DIR`: installation folder. On pm2, the one that holds or will hold `atual`, `config/` and `versions/`. On
  Docker, the one that holds `docker-compose.yml` and `.env`.
- `GODATA_NEW_VERSION`: the new version, without the leading `v`, as on the releases page of the API repository.
- `GODATA_PM2`: pm2 and case 2 only. Name of the Go.Data process in pm2 (`pm2 list`).
- `GODATA_OLD_API`: pm2 and case 2 only. The API folder in use, the one that holds `server/config.json`. It is the
  `exec cwd` value of `pm2 describe godata` (replace `godata` with the process name). Examples:
  `/opt/godata/2026.10.0/api` (upgrade guide of version 2026.10.0), `/godata/v2.49.0/go-data/build` (WHO installer)
  and `/opt/godata/versions/2026.10.0` (installation manual). Steps 1.1 and 2.1 check this value.
- `GODATA_BACKUP`: folder that keeps the counts, the pre-upgrade dump and what the way back needs.

Do not export `GODATA_VERSION`, `GODATA_PORT` or `GODATA_DB` in this terminal: on Docker, `docker compose` would use
those values instead of the ones in `.env`.

## Counts

The counts of cases, contacts, events and relationships that are not deleted are taken before the upgrade, after it
and after a return to the previous version, and must give the same result. Each count goes to a file in
`GODATA_BACKUP` with the date and time in its name. The cases say when to run each step of this section.

### C1. Create the counts script

```bash
mkdir -p -m 700 "$GODATA_BACKUP"
cat > "$GODATA_BACKUP/counts.js" <<'EOF'
const d = db.getSiblingDB(process.env.GODATA_DB);
printjson({
  person: d.person.aggregate([
    { $match: { deleted: { $ne: true } } },
    { $group: { _id: '$type', total: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray(),
  relationship: d.relationship.countDocuments({ deleted: { $ne: true } })
});
EOF
ls -l "$GODATA_BACKUP"
```

Expected result: the `counts.js` file.

### C2. Counts on pm2

The MongoDB connection comes from `server/datasources.json` of the new version, already configured in step 1.5. It
reaches `mongosh` in an environment variable, never on the command line.

```bash
cd "$GODATA_DIR/versions/$GODATA_NEW_VERSION"
GODATA_MONGO_URI="$(node deploy/lib/db-state.js print-uri --datasources server/datasources.json)" mongosh --quiet --nodb --eval 'process.env.GODATA_DB = JSON.parse(fs.readFileSync("server/datasources.json", "utf8")).mongoDb.database; db = new Mongo(process.env.GODATA_MONGO_URI).getDB("admin"); void 0' --file "$GODATA_BACKUP/counts.js" > "$GODATA_BACKUP/counts-$(date -u +%Y%m%dT%H%M%SZ).txt"
cat "$(ls -1 "$GODATA_BACKUP"/counts-2*.txt | tail -n 1)"
```

Expected result: the totals of cases, contacts and events that are not deleted (`person`, by type) and the total of
relationships (`relationship`), above zero on an installation in use. The `punycode` `DeprecationWarning` may appear
and does not affect the count. If the `person` list is empty, the connection points to another database: check
`database` in `config/datasources.json` (step 1.5) and do not go on.

### C3. Counts on Docker

`mongosh` runs inside the `mongo` container, with the MongoDB `root` user and the password the container itself
knows.

```bash
cd "$GODATA_DIR"
docker compose exec -T mongo sh -c 'mongosh --quiet --nodb --eval "db = new Mongo(\"mongodb://127.0.0.1:27017\").getDB(\"admin\"); db.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD); void 0" --file /dev/stdin' < "$GODATA_BACKUP/counts.js" > "$GODATA_BACKUP/counts-$(date -u +%Y%m%dT%H%M%SZ).txt"
cat "$(ls -1 "$GODATA_BACKUP"/counts-2*.txt | tail -n 1)"
```

Expected result: the totals of cases, contacts and events that are not deleted (`person`, by type) and the total of
relationships (`relationship`), above zero on an installation in use. If the `person` list is empty, the count read
another database: check `GODATA_DB` in `.env` and do not go on.

### C4. Compare with the first count

```bash
diff "$(ls -1 "$GODATA_BACKUP"/counts-2*.txt | head -n 1)" "$(ls -1 "$GODATA_BACKUP"/counts-2*.txt | tail -n 1)" && echo "counts: equal to the first count"
```

Expected result: `counts: equal to the first count`. The comparison only holds with totals above zero (steps C2 and
C3): two empty counts of a wrong database are equal too. If differences appear, do not release the system to the
users: check what changed and, if needed, go back to the previous version.

## Backup

The pre-upgrade dump goes to `GODATA_BACKUP`, out of reach of the automatic cleanup of the dumps. It is taken with
Go.Data stopped, right after the first count, so it holds everything recorded before the upgrade. The cases say when
to run this step. If the dump fails, do not go on with the upgrade: start the previous version again and solve the
cause.

### D1. Dump on pm2

The block uses `db-state.js` of the new version to build the connection, which goes into a temporary file only the
owner can read, deleted at the end. It also keeps the configuration of the previous version and the `config/` folder.

```bash
cd "$GODATA_DIR/versions/$GODATA_NEW_VERSION"
GODATA_MONGO_CFG="$(mktemp)"
printf "uri: '%s'\n" "$(node deploy/lib/db-state.js print-uri --datasources server/datasources.json | sed "s/'/''/g")" > "$GODATA_MONGO_CFG"
if mongodump --config "$GODATA_MONGO_CFG" --db "$(node -p 'require("./server/datasources.json").mongoDb.database')" --archive="$GODATA_BACKUP/$(node -p 'require("./server/datasources.json").mongoDb.database').archive.gz" --gzip && tar -czf "$GODATA_BACKUP/config-antes.tar.gz" -C "$GODATA_OLD_API" server/config.json server/datasources.json -C "$GODATA_DIR" config; then
  rm -f "$GODATA_MONGO_CFG"
  chmod 600 "$GODATA_BACKUP"/*.archive.gz "$GODATA_BACKUP/config-antes.tar.gz"
  ls -lh "$GODATA_BACKUP"
else
  rm -f "$GODATA_MONGO_CFG" "$GODATA_BACKUP/$(node -p 'require("./server/datasources.json").mongoDb.database').archive.gz" "$GODATA_BACKUP/config-antes.tar.gz"
  echo "dump failed: do not go on with the update" >&2
  false
fi
```

Expected result: `done dumping` lines from `mongodump` and, in `GODATA_BACKUP`, the database file (`go-data.archive.gz`,
for example) and `config-antes.tar.gz`, both larger than zero and with mode `-rw-------`. If `dump failed` appears, the
block deletes what it wrote in part: do not go on to step 1.7, start the process again with `pm2 start godata`
(replace `godata` with the process name) and solve the cause.

### D2. Dump on Docker

The block runs the backup script and moves the dump and the configuration archive into `GODATA_BACKUP`.

```bash
if "$GODATA_DIR/deploy/scripts/godata-backup.sh" "$GODATA_DIR"; then
  mv "$(ls -1 "$GODATA_DIR"/dumps/*.archive.gz | tail -n 1)" "$(ls -1 "$GODATA_DIR"/dumps/config-*.tar.gz | tail -n 1)" "$GODATA_BACKUP/"
  ls -l "$GODATA_BACKUP"
else
  echo "dump failed: do not go on with the update" >&2
  false
fi
```

Expected result: the `backup ok` line and, in `GODATA_BACKUP`, the database file (`go-data-<date>.archive.gz`) and the
`config-<date>.tar.gz` archive.

## Case 1: pm2 to pm2

The new version is installed from the release package, with the interface already built, in its own folder under
`versions/`. Attachments, system backups and configuration stay outside the version folders, as in path A of the
[installation manual](installation.md). Node.js 22 and pm2 are installed with nvm next to the previous Node.js, which
stays available for the way back. Case 1 does not change the MongoDB authentication.

### 1.1. Check the server and the installation

If a previous attempt stopped before step 1.6, continue from the step where it stopped instead of starting over.

The block checks the processor, the Ubuntu version, the MongoDB version, the API folder in use and the installation
folder. It changes nothing on the server.

```bash
GODATA_OLD_MONGOD="$(mongod --version 2> /dev/null | head -n 1 || true)"
GODATA_OLD_CWD="$(pm2 jlist | node -e 'const p = JSON.parse(require("fs").readFileSync(0, "utf8")).find(x => x.name === process.argv[1]); console.log(p ? p.pm2_env.pm_cwd : "")' "$GODATA_PM2")"
if ! grep -m1 -wo avx /proc/cpuinfo; then
  echo "stop: this CPU has no AVX instructions, MongoDB 7.0 does not run on it" >&2
  false
elif ! grep -qx 'VERSION_ID="22.04"' /etc/os-release; then
  echo "stop: case 1 needs Ubuntu 22.04, this server runs $(. /etc/os-release && echo "$PRETTY_NAME")" >&2
  false
elif [ "${GODATA_OLD_MONGOD#db version v7.0.}" = "$GODATA_OLD_MONGOD" ]; then
  echo "stop: case 1 needs MongoDB 7.0 on this server, found: '$GODATA_OLD_MONGOD'" >&2
  false
elif [ "$GODATA_OLD_CWD" != "$GODATA_OLD_API" ]; then
  echo "stop: the pm2 process $GODATA_PM2 runs from '$GODATA_OLD_CWD', set GODATA_OLD_API to that folder" >&2
  false
elif [ ! -f "$GODATA_OLD_API/server/config.json" ] || [ ! -f "$GODATA_OLD_API/server/datasources.json" ]; then
  echo "stop: no server/config.json or server/datasources.json in $GODATA_OLD_API" >&2
  false
elif [ -e "$GODATA_DIR/versions/$GODATA_NEW_VERSION" ]; then
  echo "stop: $GODATA_DIR/versions/$GODATA_NEW_VERSION already exists" >&2
  false
elif [ -d "$GODATA_DIR" ] && [ ! -w "$GODATA_DIR" ]; then
  echo "stop: $GODATA_DIR is not writable by $USER" >&2
  false
elif [ -L "$GODATA_DIR/atual" ] && [ -f "$GODATA_DIR/config/datasources.json" ]; then
  echo "ok: update inside the layout of the installation manual, from $GODATA_OLD_API"
elif [ -e "$GODATA_DIR/versions" ] || [ -e "$GODATA_DIR/config" ] || [ -e "$GODATA_DIR/storage" ] || [ -e "$GODATA_DIR/backups" ] || [ -e "$GODATA_DIR/dumps" ]; then
  echo "stop: $GODATA_DIR has part of the layout of the installation manual, check it by hand" >&2
  false
elif [ -d "$GODATA_DIR/atual" ] && [ ! -L "$GODATA_DIR/atual" ] && [ -e "$GODATA_DIR/anterior" ]; then
  echo "stop: $GODATA_DIR/atual is a folder and $GODATA_DIR/anterior already exists" >&2
  false
else
  echo "ok: first move to the layout of the installation manual, from $GODATA_OLD_API"
fi
```

Expected result: `avx` and a line that starts with `ok:`:

- `ok: update inside the layout of the installation manual`: the installation already follows the installation
  manual.
- `ok: first move to the layout of the installation manual`: the installation comes from the earlier guide or from the
  WHO installer and now moves to the folder layout of the installation manual.

If a line that starts with `stop:` appears, do not go on. With another Ubuntu or another MongoDB, see
**Which case is yours**. If the process runs from another folder, set `GODATA_OLD_API` to the folder shown and run
the **Variables** block and this block again.

On the first move, if `/opt/godata/atual` already exists as a folder (and not as a link), it is renamed to
`/opt/godata/anterior` in step 1.7, after the dump, with no change to its content. The installation manual uses the
name `atual` for the link to the version in use.

### 1.2. Create the folders

The block also installs `rsync`, which step 1.7 uses, if the server does not have it yet.

```bash
sudo apt-get install -y rsync
[ -d "$GODATA_DIR" ] || sudo install -d -o "$USER" -g "$USER" -m 750 "$GODATA_DIR"
mkdir -p "$GODATA_DIR/versions" "$GODATA_DIR/storage/files" "$GODATA_DIR/storage/icons" "$GODATA_DIR/backups"
install -d -m 700 "$GODATA_DIR/config" "$GODATA_DIR/dumps"
ls -l "$GODATA_DIR"
```

Expected result: `rsync is already the newest version` or the package installed, and the `backups`, `config`,
`dumps`, `storage` and `versions` folders, owned by your user, besides what the folder already held. On an
installation that already follows the installation manual, the folders do not change.

Then run step C1 (counts script).

### 1.3. Install Node.js 22 and pm2

The block keeps in `GODATA_BACKUP` the path and the version of the Node.js in use, for the way back, and installs with
nvm the latest Node.js 22 and pm2, which become the defaults of the next terminals. The previous Node.js stays
installed. The Go.Data process keeps running.

```bash
[ -s "$GODATA_BACKUP/node-antes.txt" ] || { command -v node; node -v; } > "$GODATA_BACKUP/node-antes.txt"
sudo apt-get install -y build-essential
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 22
nvm alias default 22
npm install -g pm2@7
cat "$GODATA_BACKUP/node-antes.txt"
node -v
pm2 -v
```

Expected result: the path and the version of the previous Node.js, the new Node.js version, which starts with `v22.`,
and the pm2 version, which starts with `7.`. If the running pm2 is another version, the warning
`In-memory PM2 is out-of-date` also appears: step 1.9 solves it.

### 1.4. Download and install the package

The first block downloads the release package and checks its checksum.

```bash
cd "$GODATA_DIR/versions"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_NEW_VERSION/godata-$GODATA_NEW_VERSION.tar.gz"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_NEW_VERSION/godata-$GODATA_NEW_VERSION.tar.gz.sha256"
sha256sum -c "godata-$GODATA_NEW_VERSION.tar.gz.sha256"
```

Expected result: `godata-2026.10.0.tar.gz: OK`. If `FAILED` appears, the file is corrupt: delete both files and
download them again.

The second block extracts the package under `versions/`, installs the dependencies and links `server/storage` to the
`storage/` folder of the installation. The `atual` link does not change yet.

```bash
mkdir "$GODATA_DIR/versions/$GODATA_NEW_VERSION"
tar -xzf "$GODATA_DIR/versions/godata-$GODATA_NEW_VERSION.tar.gz" -C "$GODATA_DIR/versions/$GODATA_NEW_VERSION" --strip-components=1
cd "$GODATA_DIR/versions/$GODATA_NEW_VERSION"
npm ci --omit=dev --no-audit --no-fund
rm -rf server/storage
ln -s "$GODATA_DIR/storage" server/storage
ls -l server/storage
```

Expected result: `npm ci` ends without error (`npm warn` messages may appear) and the last line shows
`storage -> /opt/godata/storage`.

### 1.5. Configure

On the first move only, the first block creates `config/config.json` and `config/datasources.json` with the
installation's own values, read from `server/config.json` and `server/datasources.json` of the old folder: the keys of
the `config.json` table of the [configuration manual](configuration.md) that differ from the default of the new
version, the MongoDB connection and the mail server. It shows only the key names, never the values, and lists the
other keys that differ from the default. If `config/` already has these files, the block stops without changing
anything. On an installation that already follows the installation manual, skip the first block.

```bash
node -e '
const fs = require("fs");
const [oldServer, configDir, defaultsDir] = process.argv.slice(1);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const diff = (value, base) => {
  if (isObject(value) && isObject(base)) {
    const out = {};
    for (const key of Object.keys(value)) {
      const changed = diff(value[key], base[key]);
      if (changed !== undefined) out[key] = changed;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(value) === JSON.stringify(base) ? undefined : value;
};
const paths = (value, prefix) => isObject(value) ? Object.keys(value).flatMap(key => paths(value[key], prefix + "." + key)) : [prefix];
if (fs.existsSync(configDir + "/config.json") || fs.existsSync(configDir + "/datasources.json")) {
  console.error("stop: " + configDir + " already has config.json or datasources.json");
  process.exit(1);
}
const oldConfig = read(oldServer + "/config.json");
const baseConfig = read(defaultsDir + "/config.json");
const own = ["host", "port", "public", "enableConfigRewrite", "timezone", "dateDisplayFormat", "dateTimeDisplayFormat", "passwordReset", "apiKey", "captcha", "cors", "session", "backUp"];
const config = {};
const review = [];
for (const key of Object.keys(oldConfig)) {
  const changed = diff(oldConfig[key], baseConfig[key]);
  if (changed === undefined) continue;
  if (own.includes(key)) config[key] = changed;
  else review.push(...paths(changed, "config.json:" + key));
}
const oldSources = read(oldServer + "/datasources.json");
const baseSources = read(defaultsDir + "/datasources.json");
const mongo = oldSources.mongoDb || {};
const mongoDb = {};
for (const key of ["host", "port", "database", "authSource", "url"]) {
  if (mongo[key] !== undefined && mongo[key] !== "") mongoDb[key] = mongo[key];
}
if (mongo.user && mongo.password) Object.assign(mongoDb, { user: mongo.user, password: mongo.password });
const sources = { mongoDb };
const email = diff(oldSources.email, baseSources.email);
if (email !== undefined) sources.email = email;
fs.writeFileSync(configDir + "/config.json", JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
fs.writeFileSync(configDir + "/datasources.json", JSON.stringify(sources, null, 2) + "\n", { mode: 0o600 });
console.log("config.json: " + (Object.keys(config).join(", ") || "none"));
console.log("datasources.json: mongoDb (" + Object.keys(mongoDb).join(", ") + ")" + (sources.email ? ", email" : ""));
console.log("database: " + (mongoDb.database || "go-data (default)"));
console.log("review: " + (review.join(", ") || "none"));
' "$GODATA_OLD_API/server" "$GODATA_DIR/config" "$GODATA_DIR/versions/$GODATA_NEW_VERSION/deploy/defaults"
```

Expected result: four lines, for example `config.json: port, public, enableConfigRewrite, timezone`,
`datasources.json: mongoDb (host, port, database, authSource), email`, `database: go-data` and `review: none`. The
database shown must be the one of the old installation: the counts of step C2 read it. The `review` line lists the
other keys where the old configuration differs from the default of the new version. For each one, decide whether it
is a choice of the installation or an old default: a choice of the installation goes into `config/config.json` as in
the blocks of the [configuration manual](configuration.md); an old default stays out. Both files hold passwords: only
your user can read them.

The second block applies the configuration to the new version and also writes the API key (`apiKey`) into the
interface, as in step 6.1 of the configuration manual.

```bash
cd "$GODATA_DIR/versions/$GODATA_NEW_VERSION"
node deploy/lib/merge-config.js --defaults deploy/defaults --overrides "$GODATA_DIR/config" --server-dir server --runtime-config client/dist/assets/runtime-config.json
node -p 'const c = require("./server/config.json"); ({ port: c.port, public: c.public })'
```

Expected result: `runtime config: changed` or `runtime config: unchanged` and the port and public address of the
installation, for example `{ port: 3000, public: { protocol: 'https', host: 'godata.exemplo.gov.br', port: '' } }`. If
a file in `config/` has a syntax error, the first command names the file, the line and the column.

### 1.6. Stop Go.Data, count and dump

From this step on the system is down. The block keeps the description of the process in pm2 and stops it.

```bash
pm2 describe "$GODATA_PM2" > "$GODATA_BACKUP/pm2-antes.txt"
pm2 stop "$GODATA_PM2"
pm2 list
```

Expected result: the process as `stopped` in `pm2 list`. The `In-memory PM2 is out-of-date` warning of step 1.3 may
appear again. If `pm2 list` shows other processes besides Go.Data and `pm2-logrotate`, for example another Go.Data
installation, read step 1.9 before going on: it restarts them.

Then run steps C2 (counts on pm2) and D1 (dump on pm2).

### 1.7. Switch to the new version

The block points the `atual` link to the new version. On the first move, it also:

- renames `atual` to `anterior`, if `atual` is a folder (and not a link), and moves `GODATA_OLD_API` to the new name,
  if the API in use was in it;
- copies the attachments (`server/storage`) and the system backups (`backups/`) from the old folder to `storage/` and
  `backups/` of the installation. The old folder does not change.

```bash
if [ -d "$GODATA_DIR/atual" ] && [ ! -L "$GODATA_DIR/atual" ]; then
  mv "$GODATA_DIR/atual" "$GODATA_DIR/anterior"
  case "$GODATA_OLD_API" in
    "$GODATA_DIR/atual") export GODATA_OLD_API="$GODATA_DIR/anterior" ;;
    "$GODATA_DIR/atual/"*) export GODATA_OLD_API="$GODATA_DIR/anterior/${GODATA_OLD_API#"$GODATA_DIR/atual/"}" ;;
  esac
fi
case "$GODATA_OLD_API" in
  "$GODATA_DIR"/versions/*) ;;
  *)
    rsync -a "$GODATA_OLD_API/server/storage/" "$GODATA_DIR/storage/"
    if [ -d "$GODATA_OLD_API/backups" ]; then rsync -a "$GODATA_OLD_API/backups/" "$GODATA_DIR/backups/"; fi
    ;;
esac
ln -sfn "versions/$GODATA_NEW_VERSION" "$GODATA_DIR/atual"
echo "GODATA_OLD_API=$GODATA_OLD_API"
ls -l "$GODATA_DIR/atual" "$GODATA_DIR/atual/server/storage"
```

Expected result: the `GODATA_OLD_API=` line with the folder of the previous version, `atual -> versions/2026.10.0` and
`storage -> /opt/godata/storage`. If the terminal is closed after this step, set `GODATA_OLD_API` to that folder when
running the **Variables** block again.

### 1.8. Migrate the database

```bash
cd "$GODATA_DIR/atual"
npm run migrate-database
```

Run this step inside the `tmux` session opened in **Before you start** (`sudo apt-get install -y tmux` and
`tmux new -s godata`): an SSH drop in the middle of the migration would interrupt it.

Expected result: the command ends without error, with a line that starts with `Portuguese translations:`. Warnings
such as `DeprecationWarning` and `MaxListenersExceededWarning` appear with `"level":"error"` and are expected. The
migration may take several minutes, and longer on installations older than 2.50. If it fails or is interrupted, do
not run it again: follow **Go back to the previous version** or **Recover from a failed migration**.

### 1.9. Start the new version

pm2 stores the real folder of the version as the process folder, not the `atual` link. That is why the old process is
deleted and a new one is created from `atual`. The saved pm2 list is updated right after deleting the process:
otherwise `pm2 update`, which restarts pm2 with the version installed in step 1.3, would also restore the old process.

`pm2 update` restarts every pm2 process on the server: they are down for a few seconds and come back with the new pm2
and with Node.js 22, the default since step 1.3 (`nvm alias default 22`). If the server has other applications in
pm2, for example another Go.Data installation, agree the window with their users too, check that an older Go.Data
version works with Node.js 22 (or upgrade it with this same manual) and, after this step, check in `pm2 list` that they
came back as `online`.

```bash
cd "$GODATA_DIR/atual"
pm2 delete "$GODATA_PM2"
pm2 save --force
pm2 update
pm2 start npm --name "$GODATA_PM2" --time -- start
pm2 save
timeout 300 sh -c "until curl -fsS http://127.0.0.1:$(node -p 'require("./server/config.json").port')/status 2> /dev/null; do sleep 5; done"
echo
pm2 list
```

Expected result: a line such as `{"started":"2026-11-18T12:00:00.000Z","uptime":12.3}` and the process as `online` in
`pm2 list`, only once. If the `{"started":...}` line does not appear within 5 minutes, see the reason with
`pm2 logs godata --lines 100 --nostream` (replace `godata` with the process name).

### 1.10. Start at boot, system backups and daily dump

The Node.js switch changes the paths that the pm2 service and the crontab use. In the same terminal, run:

- step A12 of the [installation manual](installation.md), which recreates the pm2 service with the new Node.js;
- step A14 of the installation manual, which moves the system backups folder to `/opt/godata/backups`. On the first
  move, the line shows the old folder, for example `changed /opt/godata/2026.10.0/api/backups -> /opt/godata/backups`.
  If the old folder is not `backups/` inside `GODATA_OLD_API`, also copy its files to `/opt/godata/backups`;
- step 4.1 of the [backup manual](backup.md), which writes the daily dump into the crontab with the new paths.

### 1.11. Check the MongoDB authentication

Case 1 does not change the MongoDB authentication. The block shows whether MongoDB accepts connections without a user
and password.

```bash
GODATA_MONGO_TEST="$(mongosh --quiet "mongodb://$(node -p 'const m = require(process.argv[1]).mongoDb; (m.host || "127.0.0.1") + ":" + (m.port || 27017)' "$GODATA_DIR/atual/server/datasources.json")" --eval 'db.adminCommand({ listDatabases: 1 }).ok' 2>&1 || true)"
case "$GODATA_MONGO_TEST" in
  1) echo "authorization: off, MongoDB answers without a user and password" ;;
  *"requires authentication"*|*Unauthorized*) echo "authorization: on" ;;
  *) echo "authorization: unknown: $GODATA_MONGO_TEST" ;;
esac
```

Expected result: `authorization: on` or `authorization: off, MongoDB answers without a user and password`. With
`off`, after the check and outside this window, follow the **Hardening an existing MongoDB** section of the
[installation manual](installation.md), which creates the users and turns authentication on.

Then follow **Final check**.

## Case 2: pm2 to Docker

The installation moves to path B of the [installation manual](installation.md): MongoDB 7.0 and Go.Data in
containers, in a new folder. The database comes from a dump of the old MongoDB, restored in the `mongo` container. The
attachments, the system backups and the installation's own values come from the old API folder. The Go.Data
container migrates the database at its first start.

The old installation does not change: the Go.Data process in pm2 is only stopped, never deleted before the check, and
the old MongoDB is only read by the dump. Until the check is done, going back means stopping Docker and starting the
old process again (**Go back to the previous version**).

The case has three variants:

- **On the same server**: Ubuntu 22.04 or 24.04, with pm2 and a MongoDB below 7.0 on the server itself.
- **To a new server**: the old server runs Ubuntu 20.04 or older. The new server runs Ubuntu 22.04 or 24.04 and
  receives the files of the old server.
- **Old server on Windows**: like the previous one, with the old server part in PowerShell.

In the **Variables** block, in this case:

- `GODATA_DIR` is the new folder of the Docker installation, which does not exist yet or is empty. The default is
  `/opt/godata`. If `/opt/godata` already exists and is not empty, for example on an installation made with the
  upgrade guide of version 2026.10.0 (with `/opt/godata/atual` and `/opt/godata/2026.10.0`), use `/opt/godata-docker`.
  The blocks of this manual and of the other manuals use `GODATA_DIR`; the paths inside the containers, such as
  `/opt/godata/backups`, do not change.
- `GODATA_OLD_API` is the old API folder, and `GODATA_PM2` the name of the old process in pm2.
- `GODATA_BACKUP` sits inside the new folder and keeps the dump of the old database and the counts.

### On the same server

#### 2.1. Check the server and the installation

The block checks the CPU, the Ubuntu version, the API folder in use, `mongodump` and the new folder. It changes
nothing on the server.

```bash
GODATA_OLD_CWD="$(pm2 jlist | node -e 'const p = JSON.parse(require("fs").readFileSync(0, "utf8")).find(x => x.name === process.argv[1]); console.log(p ? p.pm2_env.pm_cwd : "")' "$GODATA_PM2")"
GODATA_DUMP_VERSION="$(mongodump --version 2> /dev/null | head -n 1 || true)"
if ! grep -m1 -wo avx /proc/cpuinfo; then
  echo "stop: this CPU has no AVX instructions, MongoDB 7.0 does not run on it" >&2
  false
elif ! grep -qxE 'VERSION_ID="(22|24)\.04"' /etc/os-release; then
  echo "stop: Docker needs Ubuntu 22.04 or 24.04, this server runs $(. /etc/os-release && echo "$PRETTY_NAME"), move to a new server" >&2
  false
elif [ "$GODATA_OLD_CWD" != "$GODATA_OLD_API" ]; then
  echo "stop: the pm2 process $GODATA_PM2 runs from '$GODATA_OLD_CWD', set GODATA_OLD_API to that folder" >&2
  false
elif [ ! -f "$GODATA_OLD_API/server/config.json" ] || [ ! -f "$GODATA_OLD_API/server/datasources.json" ]; then
  echo "stop: no server/config.json or server/datasources.json in $GODATA_OLD_API" >&2
  false
elif [ "${GODATA_DUMP_VERSION#mongodump version: 100.}" = "$GODATA_DUMP_VERSION" ]; then
  echo "stop: mongodump is not from the MongoDB Database Tools 100, found: '$GODATA_DUMP_VERSION'" >&2
  false
elif echo "$GODATA_DUMP_VERSION" | grep -Eq '^mongodump version: 100\.[0-2]\.'; then
  echo "stop: mongodump is older than the Database Tools 100.3, which has no --config, found: '$GODATA_DUMP_VERSION'" >&2
  false
elif sudo test -e "$GODATA_DIR" && [ -n "$(sudo ls -A "$GODATA_DIR")" ]; then
  echo "stop: $GODATA_DIR already exists and is not empty, use another folder in GODATA_DIR, for example /opt/godata-docker" >&2
  false
else
  echo "ok: $GODATA_DUMP_VERSION, move from $GODATA_OLD_API to Docker in $GODATA_DIR"
fi
```

Expected result: `avx` and a line that starts with `ok:`, with the `mongodump` version (100.3 or later, such as
`mongodump version: 100.10.0`). If a line that starts with `stop:` appears, do not go on:

- On Ubuntu 20.04 or older, follow **To a new server**.
- If the process runs from another folder, set `GODATA_OLD_API` to the folder shown.
- If `mongodump` is not from the 100 series, or is older than 100.3, see step 2.11.
- If the new folder already exists and is not empty, set `GODATA_DIR` to `/opt/godata-docker` (or another empty
  folder). This manual does not install over a folder with files.

After the fix, run the **Variables** block and this block again.

#### 2.2. Install Docker

Follow the two blocks of step B3 of the [installation manual](installation.md), in the same terminal. They install
Docker Engine and the Compose plugin from Docker's official repository and add your user to the `docker` group. The
old Go.Data keeps running.

The `docker` group only applies to a new session: close the `tmux` session with `exit`, log out of the server, log in
again, open another `tmux` session (`tmux new -s godata`) and run the **Variables** block again.

#### 2.3. Create the installation folder

The first block creates the new folder with the folders of path B of the installation manual (the table of step B4
describes each one), downloads the release package, checks its checksum and copies the Docker files from the package.

```bash
docker info --format '{{.ServerVersion}}'
sudo install -d -o "$USER" -g "$USER" -m 750 "$GODATA_DIR"
mkdir -p "$GODATA_DIR/versions" "$GODATA_DIR/config" "$GODATA_DIR/data/mongo" "$GODATA_DIR/data/storage" "$GODATA_DIR/data/backups" "$GODATA_DIR/data/state" "$GODATA_DIR/dumps"
cd "$GODATA_DIR/versions"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_NEW_VERSION/godata-$GODATA_NEW_VERSION.tar.gz"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_NEW_VERSION/godata-$GODATA_NEW_VERSION.tar.gz.sha256"
sha256sum -c "godata-$GODATA_NEW_VERSION.tar.gz.sha256"
tar -xzf "godata-$GODATA_NEW_VERSION.tar.gz" -C "$GODATA_DIR" --strip-components=3 "godata-$GODATA_NEW_VERSION/deploy/docker/docker-compose.yml" "godata-$GODATA_NEW_VERSION/deploy/docker/.env.example" "godata-$GODATA_NEW_VERSION/deploy/docker/mongo-init"
tar -xzf "godata-$GODATA_NEW_VERSION.tar.gz" -C "$GODATA_DIR" --strip-components=1 "godata-$GODATA_NEW_VERSION/deploy/scripts/godata-backup.sh"
ls -l "$GODATA_DIR/docker-compose.yml" "$GODATA_DIR/mongo-init" "$GODATA_DIR/deploy/scripts"
```

Expected result: the Docker version, `godata-2026.10.0.tar.gz: OK` and the files `docker-compose.yml`,
`mongo-init/01-godata-user.js` and `deploy/scripts/godata-backup.sh`. If the first command shows `permission denied`,
the session does not have the `docker` group yet: see step 2.2. If `FAILED` appears, the file is corrupt: delete both
downloaded files and run the block again.

The second block creates `.env` with two passwords drawn by `openssl`, as in step B6 of the installation manual. Only
your user can read the file and the passwords are not shown.

```bash
cd "$GODATA_DIR"
if [ -e .env ]; then
  echo "stop: $GODATA_DIR/.env already exists, new passwords would no longer match MongoDB" >&2
  false
else
  install -m 600 /dev/null .env
  cat > .env <<EOF
GODATA_VERSION=$GODATA_NEW_VERSION
GODATA_BIND=0.0.0.0
GODATA_PORT=3000
GODATA_DB=go-data
MONGO_ROOT_PASSWORD=$(openssl rand -hex 24)
GODATA_MONGO_PASSWORD=$(openssl rand -hex 24)
EOF
  grep -v PASSWORD .env
  ls -l .env
fi
```

Expected result: the four lines without passwords and the file with mode `-rw-------`. Step 2.5 replaces
`GODATA_BIND`, `GODATA_PORT` and `GODATA_DB` with the values of the old installation.

Then run step C1 (counts script).

#### 2.4. Download the images

```bash
cd "$GODATA_DIR"
docker compose pull
docker image ls ghcr.io/eei-opas-bra/godata
```

Expected result: the `mongo` and `godata` images downloaded and the `ghcr.io/eei-opas-bra/godata` image with the tag
of the new version. If the server cannot download the image from `ghcr.io`, use the block of **Without access to
ghcr.io** of step 3.2 and then run `docker compose pull mongo` in the installation folder.

#### 2.5. Configure

The block creates `config/config.json` and `config/datasources.json` with the installation's own values, read from
`server/config.json` and `server/datasources.json` of the old folder, as in step 1.5: the keys of the `config.json`
table of the [configuration manual](configuration.md) that differ from the new version's default (the public address,
the time zone, the date formats, the sender, the API key, among others) and the mail server. The MongoDB connection
does not go into these files: on Docker, it comes from `.env`.

The block also writes to `.env` the database name (`GODATA_DB`), the port (`GODATA_PORT`) and the interface the old
API listened on (`GODATA_BIND`: `127.0.0.1` if it listened on the server itself only, `0.0.0.0` otherwise), so the
system keeps the same address. It runs the image's `node` in a temporary container, with your user and group 1000,
and shows only the key names, never the values. If `config/` already has these files, the block stops without
changing anything.

```bash
cd "$GODATA_DIR"
docker compose run --rm --no-deps -T -u "$(id -u):1000" -v "$GODATA_DIR/config:/config" -v "$GODATA_DIR/.env:/env" -v "$GODATA_OLD_API/server:/antigo:ro" --entrypoint node godata -e '
const fs = require("fs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const diff = (value, base) => {
  if (isObject(value) && isObject(base)) {
    const out = {};
    for (const key of Object.keys(value)) {
      const changed = diff(value[key], base[key]);
      if (changed !== undefined) out[key] = changed;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(value) === JSON.stringify(base) ? undefined : value;
};
const paths = (value, prefix) => isObject(value) ? Object.keys(value).flatMap(key => paths(value[key], prefix + "." + key)) : [prefix];
if (fs.existsSync("/config/config.json") || fs.existsSync("/config/datasources.json")) {
  console.error("stop: config/ already has config.json or datasources.json");
  process.exit(1);
}
const oldConfig = read("/antigo/config.json");
const baseConfig = read("/opt/godata/deploy/defaults/config.json");
const own = ["public", "enableConfigRewrite", "timezone", "dateDisplayFormat", "dateTimeDisplayFormat", "passwordReset", "apiKey", "captcha", "cors", "session", "backUp"];
const config = {};
const review = [];
for (const key of Object.keys(oldConfig)) {
  const changed = diff(oldConfig[key], baseConfig[key]);
  if (changed === undefined || key === "host" || key === "port") continue;
  if (own.includes(key)) config[key] = changed;
  else review.push(...paths(changed, "config.json:" + key));
}
const oldSources = read("/antigo/datasources.json");
const sources = {};
const email = diff(oldSources.email, read("/opt/godata/deploy/defaults/datasources.json").email);
if (email !== undefined) sources.email = email;
const env = {
  GODATA_BIND: ["127.0.0.1", "localhost"].includes(oldConfig.host) ? "127.0.0.1" : "0.0.0.0",
  GODATA_PORT: String(oldConfig.port || 3000),
  GODATA_DB: (oldSources.mongoDb && oldSources.mongoDb.database) || "go-data"
};
const lines = fs.readFileSync("/env", "utf8").split("\n").map(line => {
  const key = line.split("=")[0];
  return Object.hasOwn(env, key) ? key + "=" + env[key] : line;
});
fs.writeFileSync("/config/config.json", JSON.stringify(config, null, 2) + "\n", { mode: 0o640 });
fs.writeFileSync("/config/datasources.json", JSON.stringify(sources, null, 2) + "\n", { mode: 0o640 });
fs.writeFileSync("/env", lines.join("\n"));
console.log("config.json: " + (Object.keys(config).join(", ") || "none"));
console.log("datasources.json: " + (sources.email ? "email" : "none"));
console.log(".env: " + Object.keys(env).map(key => key + "=" + env[key]).join(", "));
console.log("review: " + (review.join(", ") || "none"));
'
grep -v PASSWORD .env
```

Expected result: four lines, for example `config.json: public, enableConfigRewrite, timezone`,
`datasources.json: email`, `.env: GODATA_BIND=0.0.0.0, GODATA_PORT=3000, GODATA_DB=go-data` and `review: none`,
followed by the `.env` lines without passwords. The database shown must be the one of the old installation: step 2.7
restores the dump into it. The `review` line lists the other keys where the old configuration differs from the new
version's default. For each one, decide whether it is a choice of the installation or an old default: a choice of the
installation goes into `config/config.json` as in the **On Docker** blocks of the configuration manual; an old default
stays out. Both files may hold the mail password: only your user and the container can read them. On the same server,
the port becomes free when the old process stops, in step 2.6.

#### 2.6. Stop Go.Data and dump

From this step on the system is down. The first block saves the description of the process in pm2, stops it and saves
the pm2 list with the process stopped: without this, a restart of the server would start the old Go.Data again. The
process is not deleted: it is the way back. The other pm2 processes do not change.

```bash
pm2 describe "$GODATA_PM2" > "$GODATA_BACKUP/pm2-antes.txt"
pm2 stop "$GODATA_PM2"
pm2 save
pm2 list
```

Expected result: the process as `stopped` in `pm2 list`.

The second block dumps the old database, with Go.Data stopped. The connection comes from `server/datasources.json` of
the old folder and goes into a temporary file that only the owner can read, deleted at the end: with or without a
user and password on MongoDB, the password never shows on the command line.

```bash
GODATA_OLD_DB="$(node -p 'require(process.argv[1]).mongoDb.database || "go-data"' "$GODATA_OLD_API/server/datasources.json")"
GODATA_MONGO_CFG="$(mktemp)"
node -e '
const m = require(process.argv[1]).mongoDb;
const auth = m.user && m.password ? encodeURIComponent(m.user) + ":" + encodeURIComponent(m.password) + "@" : "";
const query = auth && m.authSource ? "?authSource=" + encodeURIComponent(m.authSource) : "";
const uri = m.url || "mongodb://" + auth + (m.host || "127.0.0.1") + ":" + (m.port || 27017) + "/" + query;
console.log("uri: \x27" + uri.replace(/\x27/g, "\x27\x27") + "\x27");
' "$GODATA_OLD_API/server/datasources.json" > "$GODATA_MONGO_CFG"
if mongodump --config "$GODATA_MONGO_CFG" --db "$GODATA_OLD_DB" --archive="$GODATA_BACKUP/banco-antigo.archive.gz" --gzip; then
  rm -f "$GODATA_MONGO_CFG"
  chmod 600 "$GODATA_BACKUP/banco-antigo.archive.gz"
  ls -lh "$GODATA_BACKUP"
else
  rm -f "$GODATA_MONGO_CFG" "$GODATA_BACKUP/banco-antigo.archive.gz"
  echo "dump failed: do not go on with the move" >&2
  false
fi
```

Expected result: `done dumping` lines from `mongodump` and, in `GODATA_BACKUP`, the file `banco-antigo.archive.gz`,
larger than zero and with mode `-rw-------`. If `dump failed` appears, the block deletes whatever it wrote in part: do
not go on, start the old process again with `pm2 start godata` and `pm2 save` (replace `godata` with the process
name) and fix the cause.

#### 2.7. Restore the database on Docker

The block starts only the `mongo` container, which creates the MongoDB users at its first start, and restores the dump
of step 2.6 into it. `mongorestore` runs inside the container, with the MongoDB `root` user and the password the
container itself knows, as in step 6.2 of the [backup manual](backup.md).

```bash
cd "$GODATA_DIR"
docker compose up -d --wait --wait-timeout 300 mongo
docker compose exec -T mongo sh -c "$(cat <<'EOF'
umask 077
d="$(mktemp -d)"
trap 'rm -rf "$d"' EXIT
printf "password: '%s'\n" "$(printf '%s' "$MONGO_INITDB_ROOT_PASSWORD" | sed "s/'/''/g")" > "$d/mongorestore.yml"
mongorestore --config "$d/mongorestore.yml" --username "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --nsInclude="$GODATA_DB.*" --archive --gzip --drop
EOF
)" < "$GODATA_BACKUP/banco-antigo.archive.gz"
docker compose ps
```

Expected result: at the end of `mongorestore`, a line like `125000 document(s) restored successfully. 0 document(s)
failed to restore.` and the `mongo` container as `Up` and `(healthy)`. If `mongorestore` shows an error, do not go on:
follow **Go back to the previous version**.

Then run step C3 (counts on Docker). It is the first count: the old Go.Data is stopped since the dump and the Go.Data
container has not started nor migrated the database yet.

#### 2.8. Copy the attachments and the system backups

The block copies `server/storage` and `backups/` of the old folder to `data/storage` and `data/backups`. The old
folder does not change.

```bash
cp -a "$GODATA_OLD_API/server/storage/." "$GODATA_DIR/data/storage/"
if [ -d "$GODATA_OLD_API/backups" ]; then cp -a "$GODATA_OLD_API/backups/." "$GODATA_DIR/data/backups/"; fi
echo "storage: $(find "$GODATA_OLD_API/server/storage/" -type f | wc -l) files in the old folder, $(find "$GODATA_DIR/data/storage" -type f | wc -l) in data/storage"
ls -l "$GODATA_DIR/data/backups"
```

Expected result: the `storage:` line with the same number of files in both folders and the list of the system
backups.

#### 2.9. Start

The Go.Data container migrates the restored database before it starts the system and moves the system backups folder
to `/opt/godata/backups` (the `data/backups` folder seen from inside the container). The migration from a 2.x version
can take several minutes: run this step inside the `tmux` session.

```bash
cd "$GODATA_DIR"
docker compose up -d --wait --wait-timeout 900
docker compose ps
docker compose logs godata | grep godata-entrypoint
```

Expected result: both containers as `Healthy` and, in the log, the lines `database has users`,
`running migrate-database`, `migrate-database finished`, `backup location: changed` followed by the old folder and
`/opt/godata/backups`, and `starting Go.Data` followed by the new version. On the same server, if the old folder of
that line is not `backups/` inside `GODATA_OLD_API`, also copy its files with
`sudo cp -a <old folder>/. "$GODATA_DIR/data/backups/"`.

While the command waits, `docker compose logs -f godata`, in another terminal, shows the progress. If the log shows
`migration failed` or `refusing to start`, the command only ends with an error after up to 10 minutes: follow
**Go back to the previous version**.

Then run steps C3 (counts on Docker) and C4 (comparison) and follow **Final check**. With everything checked, run step
B10 of the installation manual (daily dump) and, only after a few days of use of the new version, on the same server,
step 2.10.

#### 2.10. Remove the old installation

Only after the check and after a few days of use of the new version. The first block deletes the old process from pm2 and saves the pm2 list without it. The other
pm2 processes do not change.

```bash
pm2 delete "$GODATA_PM2"
pm2 save --force
pm2 list
```

Expected result: `pm2 list` without the old process.

The second block turns off the old MongoDB, which Go.Data no longer uses. It first checks the open connections to that
MongoDB: if a program is connected, another system uses it, and the block stops without turning anything off.

```bash
GODATA_OLD_MONGO_PORT="$(node -p 'require(process.argv[1]).mongoDb.port || 27017' "$GODATA_OLD_API/server/datasources.json")"
if [ -n "$(sudo ss -Htn state established "( sport = :$GODATA_OLD_MONGO_PORT )")" ]; then
  sudo ss -Htnp state established "( sport = :$GODATA_OLD_MONGO_PORT or dport = :$GODATA_OLD_MONGO_PORT )"
  echo "stop: programs are connected to the MongoDB on port $GODATA_OLD_MONGO_PORT, keep it running" >&2
  false
else
  sudo systemctl disable --now mongod
  echo "mongod: $(systemctl is-active mongod || true), $(systemctl is-enabled mongod || true)"
fi
```

Expected result: `mongod: inactive, disabled`. If `stop:` appears, the previous lines show the connections: the
address of each client and, for the programs of the server itself, the process name. Check with the people who run
them before turning MongoDB off. The block only sees the connections of this moment: also confirm that no other
system uses that MongoDB from time to time, such as a nightly job. The data of the old MongoDB stays on disk. If the
crontab has the daily dump line of the old installation (`crontab -l`), delete it.

### To a new server

The old server stops Go.Data and prepares three files: the database dump, a package with the configuration, the
attachments and the system backups, and the description of the process in pm2. They go to the new server, which
makes the Docker installation with the steps of **On the same server**. The old server does not change beyond the
stop of the process: going back means starting it again there. After the check, the people who run the network point
the system address (the DNS name) to the new server.

#### On the old server

##### 2.11. Set the variables and check

Run the blocks of this step and of steps 2.12 and 2.13 on the old server, as the user who operates Go.Data, in a
`tmux` session.

```bash
export GODATA_PM2=godata
export GODATA_OLD_API=/godata/v2.49.0/go-data/build
export GODATA_TRANSFER="$HOME/godata-mudanca"
```

Expected result: no output.

- `GODATA_PM2`: name of the Go.Data process in pm2 (`pm2 list`).
- `GODATA_OLD_API`: the API folder in use, the one that holds `server/config.json`. It is the `exec cwd` value of
  `pm2 describe godata` (replace `godata` with the process name). On the WHO installer, it is
  `/godata/v<version>/go-data/build`.
- `GODATA_TRANSFER`: new folder, which does not exist yet, for the files that go to the new server.

The next block checks the API folder, `mongodump` and the folder for the files. It changes nothing on the server.

```bash
GODATA_OLD_CWD="$(pm2 jlist | node -e 'const p = JSON.parse(require("fs").readFileSync(0, "utf8")).find(x => x.name === process.argv[1]); console.log(p ? p.pm2_env.pm_cwd : "")' "$GODATA_PM2")"
GODATA_DUMP_VERSION="$(mongodump --version 2> /dev/null | head -n 1 || true)"
if [ "$GODATA_OLD_CWD" != "$GODATA_OLD_API" ]; then
  echo "stop: the pm2 process $GODATA_PM2 runs from '$GODATA_OLD_CWD', set GODATA_OLD_API to that folder" >&2
  false
elif [ ! -f "$GODATA_OLD_API/server/config.json" ] || [ ! -f "$GODATA_OLD_API/server/datasources.json" ]; then
  echo "stop: no server/config.json or server/datasources.json in $GODATA_OLD_API" >&2
  false
elif [ "${GODATA_DUMP_VERSION#mongodump version: 100.}" = "$GODATA_DUMP_VERSION" ]; then
  echo "stop: mongodump is not from the MongoDB Database Tools 100, found: '$GODATA_DUMP_VERSION'" >&2
  false
elif echo "$GODATA_DUMP_VERSION" | grep -Eq '^mongodump version: 100\.[0-2]\.'; then
  echo "stop: mongodump is older than the Database Tools 100.3, which has no --config, found: '$GODATA_DUMP_VERSION'" >&2
  false
elif [ -e "$GODATA_TRANSFER" ]; then
  echo "stop: $GODATA_TRANSFER already exists" >&2
  false
else
  echo "ok: $GODATA_DUMP_VERSION, database $(node -p 'require(process.argv[1]).mongoDb.database || "go-data"' "$GODATA_OLD_API/server/datasources.json")"
fi
du -sh "$GODATA_OLD_API/server/storage/" "$GODATA_OLD_API/backups"
df -h "$HOME"
```

Expected result: a line that starts with `ok:`, with the `mongodump` version (100.3 or later, such as
`mongodump version: 100.10.0`) and the database name, the size of the attachments and of the system backups and the free space. The
folder for the files needs room for the dump and for those two sizes. If a line that starts with `stop:` appears, do
not go on.

MongoDB 4.4 and later ship `mongodump` from the 100 series (MongoDB Database Tools), but the `--config` option that
step 2.12 uses exists only since 100.3. Older tools, from MongoDB 4.2 or older (a version that starts with `r`) or
from the 100 series below 100.3, do not read the connection file. In that case,
download the MongoDB Database Tools for the server's system as a `.tgz` file, from the MongoDB downloads page, extract
it into a folder of your user and put its `bin` folder at the start of the `PATH` of this terminal, with
`export PATH="<folder>/bin:$PATH"`. Nothing is installed on the system. Then run this block again.

##### 2.12. Stop Go.Data and make the dump and the package

From this step on the system is down. The first block creates the folder for the files, saves the description of the
process in pm2, stops it and saves the pm2 list with the process stopped, as in step 2.6.

```bash
mkdir -m 700 "$GODATA_TRANSFER"
pm2 describe "$GODATA_PM2" > "$GODATA_TRANSFER/pm2-antes.txt"
pm2 stop "$GODATA_PM2"
pm2 save
pm2 list
```

Expected result: the process as `stopped` in `pm2 list`.

The second block makes the database dump, as in step 2.6, and the package `arquivos-antigos.tar.gz` with
`server/config.json`, `server/datasources.json`, `server/storage` and `backups/` of the API folder.

```bash
GODATA_OLD_DB="$(node -p 'require(process.argv[1]).mongoDb.database || "go-data"' "$GODATA_OLD_API/server/datasources.json")"
GODATA_MONGO_CFG="$(mktemp)"
node -e '
const m = require(process.argv[1]).mongoDb;
const auth = m.user && m.password ? encodeURIComponent(m.user) + ":" + encodeURIComponent(m.password) + "@" : "";
const query = auth && m.authSource ? "?authSource=" + encodeURIComponent(m.authSource) : "";
const uri = m.url || "mongodb://" + auth + (m.host || "127.0.0.1") + ":" + (m.port || 27017) + "/" + query;
console.log("uri: \x27" + uri.replace(/\x27/g, "\x27\x27") + "\x27");
' "$GODATA_OLD_API/server/datasources.json" > "$GODATA_MONGO_CFG"
if mongodump --config "$GODATA_MONGO_CFG" --db "$GODATA_OLD_DB" --archive="$GODATA_TRANSFER/banco-antigo.archive.gz" --gzip && tar -czhf "$GODATA_TRANSFER/arquivos-antigos.tar.gz" -C "$GODATA_OLD_API" server/config.json server/datasources.json server/storage backups; then
  rm -f "$GODATA_MONGO_CFG"
  chmod 600 "$GODATA_TRANSFER/banco-antigo.archive.gz" "$GODATA_TRANSFER/arquivos-antigos.tar.gz"
  ls -lh "$GODATA_TRANSFER"
else
  rm -f "$GODATA_MONGO_CFG" "$GODATA_TRANSFER/banco-antigo.archive.gz" "$GODATA_TRANSFER/arquivos-antigos.tar.gz"
  echo "dump failed: do not go on with the move" >&2
  false
fi
```

Expected result: `done dumping` lines from `mongodump` and, in `GODATA_TRANSFER`, the files
`arquivos-antigos.tar.gz`, `banco-antigo.archive.gz` and `pm2-antes.txt`, the first two larger than zero and with mode
`-rw-------`. If `dump failed` appears, the block deletes whatever it wrote in part: do not go on, start the process
again with `pm2 start godata` and `pm2 save` (replace `godata` with the process name) and fix the cause. If the system
backups folder is not `backups/` inside `GODATA_OLD_API` (**System configuration > Backups > Quick actions >
Automatic backup settings**, **Location** field), also take its files to the new server and copy them later to
`data/backups`.

##### 2.13. Copy the files to the new server

The block copies the folder with the files to the home folder of the user on the new server, over SSH, keeping the
modes. Replace `usuario@servidor-novo` with the user and the address of the new server.

```bash
scp -rp "$GODATA_TRANSFER" usuario@servidor-novo:
```

Expected result: a line with `100%` for each file. On the new server, the files land in `godata-mudanca`, in the
user's home folder. If the two servers cannot reach each other over SSH, take the folder by other means to the same
place on the new server. From here on, the old server does not change: it is the way back.

#### On the new server

##### 2.14. Check the new server

Run the **Variables** block on the new server, as the user who received the files, in a `tmux` session. The next block
checks the CPU, the Ubuntu version, the new folder and the files of the old server. It changes nothing on the server.

```bash
if ! grep -m1 -wo avx /proc/cpuinfo; then
  echo "stop: this CPU has no AVX instructions, MongoDB 7.0 does not run on it" >&2
  false
elif ! grep -qxE 'VERSION_ID="(22|24)\.04"' /etc/os-release; then
  echo "stop: the Docker path needs Ubuntu 22.04 or 24.04, this server runs $(. /etc/os-release && echo "$PRETTY_NAME")" >&2
  false
elif sudo test -e "$GODATA_DIR" && [ -n "$(sudo ls -A "$GODATA_DIR")" ]; then
  echo "stop: $GODATA_DIR already exists and is not empty" >&2
  false
elif [ ! -s "$HOME/godata-mudanca/banco-antigo.archive.gz" ] || [ ! -s "$HOME/godata-mudanca/arquivos-antigos.tar.gz" ]; then
  echo "stop: the files of the old server are not in $HOME/godata-mudanca" >&2
  false
else
  echo "ok: $(. /etc/os-release && echo "$PRETTY_NAME"), $GODATA_DIR is free, files of the old server in $HOME/godata-mudanca"
fi
```

Expected result: `avx` and a line that starts with `ok:`. If a line that starts with `stop:` appears, do not go on.

Then run steps 2.2 (Docker) and 2.3 (installation folder) and step C1 (counts script).

##### 2.15. Move the files into the installation folder

The block moves the files of the old server to `GODATA_BACKUP`, extracts the package into `GODATA_BACKUP/antigo` and
sets `GODATA_OLD_API` to that folder, which the next steps read as the old API folder.

```bash
mkdir -p -m 700 "$GODATA_BACKUP"
mv "$HOME/godata-mudanca"/* "$GODATA_BACKUP/"
rmdir "$HOME/godata-mudanca"
chmod 600 "$GODATA_BACKUP/banco-antigo.archive.gz" "$GODATA_BACKUP/arquivos-antigos.tar.gz"
mkdir -m 700 "$GODATA_BACKUP/antigo"
tar -xzf "$GODATA_BACKUP/arquivos-antigos.tar.gz" -C "$GODATA_BACKUP/antigo"
export GODATA_OLD_API="$GODATA_BACKUP/antigo"
echo "GODATA_OLD_API=$GODATA_OLD_API"
ls -l "$GODATA_BACKUP" "$GODATA_OLD_API/server"
```

Expected result: the `GODATA_OLD_API=` line with the `antigo` folder and, in the lists, the files of the old server
and the folders and files `config.json`, `datasources.json` and `storage`. If the terminal is closed after this step,
set `GODATA_OLD_API` to that folder when running the **Variables** block again.

Then run steps 2.4, 2.5, 2.7 (with count C3), 2.8 and 2.9 of **On the same server**. Step 2.6 was already done on the
old server (step 2.12) and step 2.10 does not apply: the old server keeps Go.Data stopped, as the way back, until the
decision to turn it off. After the check, the `GODATA_BACKUP/antigo` folder can be deleted: the package
`arquivos-antigos.tar.gz` stays in `GODATA_BACKUP`.

### Old server on Windows

The old server part runs in PowerShell, as the user who administers Go.Data on Windows, and prepares the same files
as step 2.12. The dump uses `mongodump.exe` from the MongoDB Database Tools for Windows: download the `.zip` file from
the MongoDB downloads page and extract it into a folder, without installing anything. `tar.exe` and `scp.exe` come
with Windows 10, Windows 11 and Windows Server 2019 or later, and `New-TemporaryFile` comes with PowerShell 5 or
later; step 2.16 checks all three. Windows versions older than Windows 10 1803 or Windows Server 2019, or with
PowerShell below 5, are not covered by this procedure. The new server part is the one of
**On the new server**.

#### 2.16. Set the variables and check

```powershell
$GoDataApi = 'C:\GoData\go-data\build'
$GoDataTools = 'C:\mongodb-database-tools\bin'
$GoDataTransfer = "$env:USERPROFILE\godata-mudanca"
```

Expected result: no output.

- `$GoDataApi`: the Go.Data API folder, the one that holds `server\config.json`.
- `$GoDataTools`: the `bin` folder of the extracted MongoDB Database Tools, the one that holds `mongodump.exe`.
- `$GoDataTransfer`: new folder, which does not exist yet, for the files that go to the new server.

The next block checks the configuration files, `mongodump.exe` and the folder for the files. It changes nothing on the
server.

```powershell
if ((Get-Command tar.exe, scp.exe, New-TemporaryFile -ErrorAction SilentlyContinue | Measure-Object).Count -ne 3) {
  Write-Error "stop: tar.exe, scp.exe or New-TemporaryFile is missing on this Windows"
} elseif (-not (Test-Path "$GoDataTools\mongodump.exe")) {
  Write-Error "stop: no mongodump.exe in $GoDataTools"
} elseif ((& "$GoDataTools\mongodump.exe" --version 2>&1 | Select-Object -First 1) -notmatch '^mongodump version: 100\.([3-9]|[1-9][0-9]+)\.') {
  Write-Error "stop: mongodump.exe is not from the MongoDB Database Tools 100.3 or later"
} elseif (-not (Test-Path "$GoDataApi\server\config.json") -or -not (Test-Path "$GoDataApi\server\datasources.json")) {
  Write-Error "stop: no server\config.json or server\datasources.json in $GoDataApi"
} elseif (Test-Path $GoDataTransfer) {
  Write-Error "stop: $GoDataTransfer already exists"
} else {
  & "$GoDataTools\mongodump.exe" --version
  $GoDataSources = Get-Content -Raw "$GoDataApi\server\datasources.json" | ConvertFrom-Json
  "ok: database $($GoDataSources.mongoDb.database), MongoDB on $($GoDataSources.mongoDb.host):$($GoDataSources.mongoDb.port)"
}
```

Expected result: the `mongodump` version (100.3 or later, such as `mongodump version: 100.10.0`) and a line that
starts with `ok:`, with the database name and the MongoDB address. If an error with `stop:` appears, do not go on.

#### 2.17. Stop Go.Data and make the dump and the package

From this step on the system is down. Stop the Go.Data API and keep MongoDB running: on a pm2 process, `pm2 stop` and
`pm2 save`, as in step 2.12; on a Windows service, `Stop-Service` followed by the name of the API service. If the
API does not run as a service or on pm2, stop only the API's `node.exe`, from Task Manager or with `Stop-Process` on
the API process, and leave `mongod` running. Anything recorded after the dump would not reach the new server.

The block makes the database dump, with the connection of `server\datasources.json` in a temporary file of the user's
folder, deleted at the end, and the package `arquivos-antigos.tar.gz` with the same files as step 2.12. If something
fails, it deletes the folder for the files.

```powershell
$GoDataSources = Get-Content -Raw "$GoDataApi\server\datasources.json" | ConvertFrom-Json
$m = $GoDataSources.mongoDb
$GoDataDb = if ($m.database) { $m.database } else { 'go-data' }
$GoDataAuth = if ($m.user -and $m.password) { [uri]::EscapeDataString($m.user) + ':' + [uri]::EscapeDataString($m.password) + '@' } else { '' }
$GoDataQuery = if ($GoDataAuth -and $m.authSource) { '?authSource=' + [uri]::EscapeDataString($m.authSource) } else { '' }
$GoDataUri = if ($m.url) { $m.url } else { 'mongodb://' + $GoDataAuth + $(if ($m.host) { $m.host } else { '127.0.0.1' }) + ':' + $(if ($m.port) { $m.port } else { 27017 }) + '/' + $GoDataQuery }
New-Item -ItemType Directory -Path $GoDataTransfer | Out-Null
$GoDataCfg = (New-TemporaryFile).FullName
Set-Content -Encoding ASCII -Path $GoDataCfg -Value ("uri: '" + $GoDataUri.Replace("'", "''") + "'")
& "$GoDataTools\mongodump.exe" --config $GoDataCfg --db $GoDataDb "--archive=$GoDataTransfer\banco-antigo.archive.gz" --gzip
$GoDataDumpExit = $LASTEXITCODE
Remove-Item $GoDataCfg
if ($GoDataDumpExit -eq 0) { tar.exe -czf "$GoDataTransfer\arquivos-antigos.tar.gz" -C $GoDataApi server/config.json server/datasources.json server/storage backups }
if ($GoDataDumpExit -eq 0 -and $LASTEXITCODE -eq 0) {
  Get-ChildItem $GoDataTransfer
} else {
  Remove-Item -Recurse -Force $GoDataTransfer
  Write-Error 'dump failed: do not go on with the move'
}
```

Expected result: `done dumping` lines from `mongodump` and, in the list, the files `arquivos-antigos.tar.gz` and
`banco-antigo.archive.gz`, larger than zero. If `dump failed` appears, do not go on: start the Go.Data API again and
fix the cause. The folder sits inside the user's folder, which only that user and the Windows administrators can
read.

#### 2.18. Copy the files to the new server

The block enters the folder that holds the folder with the files, so that `scp` does not take the drive letter for a
server name, and copies the folder to the home folder of the user on the new server. Replace `usuario@servidor-novo`
with the user and the address of the new server.

```powershell
Set-Location (Split-Path $GoDataTransfer)
scp -r (Split-Path -Leaf $GoDataTransfer) usuario@servidor-novo:
```

Expected result: a line with `100%` for each file. On the new server, the files land in `godata-mudanca`, in the
user's home folder. Then follow **On the new server** (steps 2.14 and 2.15). From here on, the old server does not
change: it is the way back.

## Case 3: Docker to Docker

The upgrade changes the version of the Go.Data image in `.env`. At start, the new `godata` container migrates the
database and writes the system backups folder. The `mongo` container stays the same.

### 3.1. Check the installation

```bash
cd "$GODATA_DIR"
docker compose ps
docker compose images godata
grep '^GODATA_VERSION=' .env
if sudo test -e data/state/migration-failed; then
  echo "stop: data/state/migration-failed exists, see the recovery section of the update manual" >&2
  false
else
  echo "ok: no failed migration marker"
fi
```

Expected result: the `mongo` and `godata` containers as `Up` and `(healthy)`, the version in use in the `TAG` column
and in `.env`, and `ok: no failed migration marker`. If `stop:` appears, follow **Recover from a failed migration**
before upgrading.

Then run step C1 (counts script).

### 3.2. Download the new image

The system keeps running. The command downloads the image of the new version without changing `.env`: the variable
applies to this command only.

```bash
cd "$GODATA_DIR"
GODATA_VERSION="$GODATA_NEW_VERSION" docker compose pull godata
docker image ls ghcr.io/eei-opas-bra/godata
```

Expected result: the image downloaded and, in the list, the tag of the new version next to the tag of the version in
use.

#### Without access to ghcr.io

If the server cannot download the image from `ghcr.io`, download the image file from the release page and load it.
The file can also be downloaded on another machine and copied to the `versions/` folder of the installation, together
with the `.sha256` file. In that case, skip the two `curl` lines.

```bash
cd "$GODATA_DIR/versions"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_NEW_VERSION/godata-image-$GODATA_NEW_VERSION.tar.gz"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_NEW_VERSION/godata-image-$GODATA_NEW_VERSION.tar.gz.sha256"
sha256sum -c "godata-image-$GODATA_NEW_VERSION.tar.gz.sha256"
docker load -i "godata-image-$GODATA_NEW_VERSION.tar.gz"
```

Expected result: `godata-image-2026.10.0.tar.gz: OK` and `Loaded image: ghcr.io/eei-opas-bra/godata:2026.10.0`.

### 3.3. Stop Go.Data, count and dump

From this step on the system is down. The block keeps the version in use and stops only the `godata` container:
`mongo` keeps running for the count and the dump.

```bash
cd "$GODATA_DIR"
grep '^GODATA_VERSION=' .env > "$GODATA_BACKUP/versao-antes.txt"
docker compose stop godata
docker compose ps
```

Expected result: only the `mongo` container in `docker compose ps`.

Then run steps C3 (counts on Docker) and D2 (dump on Docker).

### 3.4. Change the version and start

The new container migrates the database before starting Go.Data. The command waits until the services are healthy,
which may take several minutes.

```bash
cd "$GODATA_DIR"
sed -i "s/^GODATA_VERSION=.*/GODATA_VERSION=$GODATA_NEW_VERSION/" .env
grep '^GODATA_VERSION=' .env
docker compose up -d --wait --wait-timeout 900
docker compose ps
docker compose logs godata | grep godata-entrypoint
```

Expected result: the new version in `.env`, both containers as `Healthy` and, in the log, the lines
`database has users`, `running migrate-database`, `migrate-database finished`,
`backup location: unchanged /opt/godata/backups` and `starting Go.Data` followed by the new version.

While the command waits, `docker compose logs -f godata`, in another terminal, shows the progress. If the log shows
`migration failed` or `refusing to start`, the command only ends with an error after up to 10 minutes: follow
**Recover from a failed migration**.

Then follow **Final check**.

## Final check

Take the counts again (step C2 on pm2, C3 on Docker) and compare them with the first one (step C4). Then check the
version in use. The login screen shows `2.51.0 - build 2026.10.0` on every release candidate of 2026.10.0: the exact
version shows in the package folder (pm2) or in the image tag (Docker).

### F1. On pm2

```bash
pm2 describe "$GODATA_PM2" | grep -E 'status|exec cwd|node.js version'
readlink "$GODATA_DIR/atual"
curl -fsS "http://127.0.0.1:$(node -p 'require(process.argv[1]).port' "$GODATA_DIR/atual/server/config.json")/api/system-settings/version" -H "api-key: $(node -p 'require(process.argv[1]).apiKey' "$GODATA_DIR/atual/client/dist/assets/runtime-config.json")" | cut -c 1-80
echo
systemctl is-enabled "pm2-$USER"
grep -o 'versions/node/v[0-9.]*' "/etc/systemd/system/pm2-$USER.service" | sort -u
crontab -l | grep godata-backup
```

Expected result:

- The process as `online`, with `exec cwd` in `/opt/godata/versions/` followed by the new version, and Node.js 22.
- `versions/` followed by the new version, where `atual` points.
- A line that starts with `{"platform":"-","version":"2.51.0","build":"2026.10.0"`.
- The pm2 service as `enabled`, with the path of the new Node.js.
- The daily dump line in the crontab.

### F2. On Docker

```bash
cd "$GODATA_DIR"
docker compose ps
docker compose images godata
grep '^GODATA_VERSION=' .env
curl -fsS "http://127.0.0.1:$(docker compose port godata 3000 | sed 's/.*://')/api/system-settings/version" -H "api-key: $(docker compose exec -T -u node godata node -p 'require("/opt/godata/client/dist/assets/runtime-config.json").apiKey')" | cut -c 1-80
echo
```

Expected result:

- The `mongo` and `godata` containers as `Up` and `(healthy)`.
- The new version in the `TAG` column and in `.env`.
- A line that starts with `{"platform":"-","version":"2.51.0","build":"2026.10.0"`.

Also check in the browser:

- An administrator and a geographically restricted user log in and see the lists of cases, contacts and
  relationships expected for each of them.
- A transmission chain is generated.
- A backup created in **System > Backups** ends with the status **Success** and the file appears in the system
  backups folder: `/opt/godata/backups` on pm2 and `data/backups` on Docker.
- When upgrading to 2026.10.0, in the settings of each outbreak, review the new options for geographic visibility,
  creation in another municipality, optional address, blocking address deletion, bulk questionnaire editing and the
  address and document fields.

If something fails, follow **Go back to the previous version**. With everything checked, release the system to the
users.

## Go back to the previous version

In cases 1 and 3, the way back restores the database from the pre-upgrade dump: everything recorded after it is
lost. The safety dump of the backup manual keeps the current state first.

### Case 1

Before step 1.6, Go.Data keeps running on the previous version and there is nothing to undo. If the failure happened
before step 1.8 (migration), the database did not change: skip steps V1.1 and V1.2.

#### V1.1. Choose the dump

```bash
export GODATA_DUMP="$(ls -1 "$GODATA_BACKUP"/*.archive.gz | head -n 1)"
ls -l "$GODATA_DUMP"
```

Expected result: the dump taken in step D1, with its date and size.

#### V1.2. Restore the database

Follow the three blocks of step 6.1 of the [backup manual](backup.md), in the same terminal. The third block stops
the new version and restores the dump chosen in step V1.1.

#### V1.3. Start the previous version

The block deletes the process of the new version, switches back to the previous Node.js and pm2 and starts the
process from the folder of the previous version. On an installation that already followed the installation manual,
it also points `atual` back to the previous version. On the first move, `atual` keeps pointing to the new version,
which the daily dump uses.

```bash
pm2 delete "$GODATA_PM2"
pm2 save --force
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
case "$(sed -n 1p "$GODATA_BACKUP/node-antes.txt")" in
  "$NVM_DIR"/*) nvm use "$(sed -n 2p "$GODATA_BACKUP/node-antes.txt")" && nvm alias default "$(sed -n 2p "$GODATA_BACKUP/node-antes.txt")" ;;
  *) nvm use system && nvm alias default system ;;
esac
pm2 update
cd "$GODATA_OLD_API"
pm2 start npm --name "$GODATA_PM2" --time -- start
pm2 save
case "$GODATA_OLD_API" in
  "$GODATA_DIR"/versions/*) ln -sfn "versions/${GODATA_OLD_API##*/}" "$GODATA_DIR/atual" ;;
esac
node -v
pm2 list
```

Expected result: the version of the previous Node.js and the process as `online` in `pm2 list`. If the previous
process was started in another way, use the command recorded in `pm2-antes.txt`, in `GODATA_BACKUP`. As in step 1.9,
`pm2 update` restarts every pm2 process on the server, which come back with the previous pm2 and Node.js: check in
`pm2 list` that the other applications came back as `online`.

Then run step A12 of the [installation manual](installation.md) again, which recreates the pm2 service with the
previous Node.js. The daily dump keeps using Node.js 22, which stays installed. Finally, take the counts (step C2) and
compare them with the first one (step C4). The login screen must show the previous version.

### Case 2

The old database is not restored: the old MongoDB was only read and still has everything recorded up to the dump.
Going back means stopping Docker and starting the old process again. What is recorded on Docker after the move does
not go back to the old database.

#### V2.1. On the same server

The block stops and removes the containers, without deleting the folders of `data/`, turns the old MongoDB on again,
if step 2.10 turned it off, and starts the old process.

```bash
cd "$GODATA_DIR"
docker compose down
sudo systemctl enable --now mongod
pm2 start "$GODATA_PM2"
pm2 save
pm2 list
```

Expected result: the containers removed and the old process as `online` in `pm2 list`. If step 2.10 already deleted
the process, create it again in the `GODATA_OLD_API` folder with the command recorded in `pm2-antes.txt`, in
`GODATA_BACKUP` (`script path` and `exec cwd`), and save the list with `pm2 save`. To try the move again, delete the
`GODATA_DIR` folder with the block below and start over from step 2.1. First, check that `GODATA_DIR` is the Docker
folder of this case, not the old installation.

```bash
if [ -f "$GODATA_DIR/docker-compose.yml" ]; then
  (cd "$GODATA_DIR" && docker compose down) && sudo rm -rf "$GODATA_DIR"
else
  echo "stop: $GODATA_DIR is not a Docker install folder" >&2
  false
fi
```

Expected result: the containers removed and no error output. If `stop:` appears, the folder has no
`docker-compose.yml` and nothing was deleted: fix `GODATA_DIR`.

#### V2.2. New server

On the new server, stop the containers:

```bash
cd "$GODATA_DIR"
docker compose down
```

Expected result: the containers removed.

On the old server, run the variables block of step 2.11 and start the old process:

```bash
pm2 start "$GODATA_PM2"
pm2 save
pm2 list
```

Expected result: the process as `online` in `pm2 list`. On an old server on Windows, start the Go.Data API again the
same way it was stopped in step 2.17. If the system address already points to the new server, point it back to the
old server.

### Case 3

#### V3.1. Choose the dump

```bash
export GODATA_DUMP="$(ls -1 "$GODATA_BACKUP"/*.archive.gz | head -n 1)"
ls -l "$GODATA_DUMP"
```

Expected result: the dump taken in step D2, with its date and size.

#### V3.2. Restore the database

Follow the three blocks of step 6.2 of the [backup manual](backup.md), in the same terminal. The third block stops the
`godata` container and restores the dump chosen in step V3.1.

#### V3.3. Start the previous version

The block sets `.env` back to the previous version and starts Go.Data. It also deletes the failed migration marker,
if there is one: with the database restored from the pre-upgrade dump, its cause is gone.

```bash
cd "$GODATA_DIR"
if grep -qx 'GODATA_VERSION=[0-9A-Za-z][0-9A-Za-z._-]*' "$GODATA_BACKUP/versao-antes.txt" 2> /dev/null; then
  sed -i "s/^GODATA_VERSION=.*/$(cat "$GODATA_BACKUP/versao-antes.txt")/" .env
  grep '^GODATA_VERSION=' .env
  sudo rm -f data/state/migration-failed data/state/db-command-running
  docker compose up -d --wait --wait-timeout 900
  docker compose images godata
  docker compose logs godata | grep godata-entrypoint
else
  echo "stop: no previous version in $GODATA_BACKUP/versao-antes.txt, write GODATA_VERSION=<previous version> in it and run this block again" >&2
  false
fi
```

Expected result: the previous version in `.env` and in the `TAG` column, the containers as `Healthy` and, in the log,
`database has users`, `migrate-database finished` and `starting Go.Data` followed by the previous version. If `stop:`
appears, the file of step 3.3 is empty or missing and nothing changed: write in it the line `GODATA_VERSION=` followed
by the previous version, which is in the `.env` of the `config-<date>.tar.gz` archive in `GODATA_BACKUP`, and run the
block again. Finally, take the counts (step C3) and compare them with the first one (step C4).

## Recover from a failed migration

On Docker, the `godata` container never repeats by itself a database command that failed or was interrupted. It writes
the `data/state/migration-failed` marker, does not start Go.Data and stays stopped until someone solves it. A
`docker compose restart` does not change that. The health status stays `starting` for up to 10 minutes and then
becomes `unhealthy`, but the log shows the reason at once:

| Log line (`docker compose logs godata`) | What happened |
| --- | --- |
| `migration failed, see /opt/godata/state/migration-failed` | `migrate-database` ended with an error or without completing. The database may be partly migrated |
| `a database command did not finish` | The container stopped in the middle of a database command, for example on a `docker compose stop` or a server restart during the migration. The marker is written at the next start |
| `a migration was left in progress (status Started in migrationLog), not migrating` | The database has a migration marked as in progress, left by an interrupted run |
| `refusing to run init-database: the database has documents but no users` | The database has data but no users, as after an incomplete restore or an interrupted first installation. `init-database` would erase everything and is not run |
| `database initialisation failed` | `init-database` of the first installation failed |
| `refusing to start: a previous database command failed or was interrupted` | Shows at each later start, while the marker exists |

None of these situations erases data. Do not use `docker compose run godata` to run `init-database` or
`migrate-database` by hand: that command skips the protections of the container and may repeat the migration on a
partly migrated database or erase a database with data.

On pm2 there is no marker: `npm run migrate-database` in step 1.8 shows the error and ends. After an interruption, it
refuses new runs with `A migration is already in progress`.

The safe path is going back to the pre-upgrade dump (**Go back to the previous version**). Delete the marker or mark the
migration as `Failed` only after understanding and fixing the cause.

### R1. See the reason on Docker

```bash
cd "$GODATA_DIR"
docker compose ps godata
docker compose logs --tail 40 godata | grep godata-entrypoint
sudo cat data/state/migration-failed 2> /dev/null || echo "no marker"
```

Expected result: the `godata` container as `Up` and `(health: starting)` or `(unhealthy)`, the last lines of the
container and the content of the marker: the time, the image version, the reason (`reason:`) and the last lines of the
last database command that ran. When the container refused before running any command, those lines come from an
earlier run: the reason is only in the `reason:` line.

### R2. Go back to the pre-upgrade dump

Follow **Go back to the previous version** for your case. On Docker, step V3.3 deletes the marker after the restore.
To try the new version again after fixing the cause, restore the dump (steps V3.1 and V3.2) and delete the marker
(step R3), which starts the container and migrates the database.

### R3. Delete the marker on Docker

Only after restoring the dump or fixing the cause. The container runs the migration again at the next start. Without
a restore, the migration starts again on a database that may be half migrated: read step R4 first.

```bash
cd "$GODATA_DIR"
sudo rm -f data/state/migration-failed data/state/db-command-running
docker compose restart godata
docker compose up -d --wait --wait-timeout 900
docker compose logs --since 15m godata | grep godata-entrypoint
```

Expected result: the `godata` container as `Healthy` and, in the log, `running migrate-database`,
`migrate-database finished` and `starting Go.Data`. If the reason was a migration left in progress and the database
was not restored, the container writes the marker again: run step R4 first.

### R4. Mark a migration left in progress as Failed

Use this step after an interrupted migration, when the choice is to repeat the migration without restoring the dump.
The next migration resumes from the actions already completed. The password never goes on the command line.

On pm2:

```bash
cd "$GODATA_DIR/atual"
GODATA_MONGO_URI="$(node deploy/lib/db-state.js print-uri --datasources server/datasources.json)" mongosh --quiet --nodb --eval 'const d = new Mongo(process.env.GODATA_MONGO_URI).getDB(JSON.parse(fs.readFileSync("server/datasources.json", "utf8")).mongoDb.database); printjson(d.migrationLog.updateMany({ status: "Started" }, { $set: { status: "Failed", endDate: new Date() } }))'
```

On Docker:

```bash
cd "$GODATA_DIR"
docker compose exec -T mongo sh -c 'mongosh --quiet --nodb --eval "db = new Mongo(\"mongodb://127.0.0.1:27017\").getDB(\"admin\"); db.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD); printjson(db.getSiblingDB(process.env.GODATA_DB).migrationLog.updateMany({ status: \"Started\" }, { \$set: { status: \"Failed\", endDate: new Date() } }))"'
```

Expected result, in both: the output shows `matchedCount: 1` and `modifiedCount: 1`. Then, on pm2, repeat step 1.8; on
Docker, run step R3.

### R5. Interrupted first installation on Docker

If the first start (step B9 of the [installation manual](installation.md)) was interrupted, the database holds part
of the collections and no users, and the container refuses `init-database`. This step drops the database and starts
again, only on a new installation that never had data. The block first takes a dump with the backup script and counts
the persons (cases, contacts and events), the outbreaks and the users in the database: if there is any, it stops
without dropping anything. An incomplete restore also leaves the database without users; in that case, restore the
dump again with step 6.2 of the [backup manual](backup.md).

```bash
cd "$GODATA_DIR"
docker compose stop godata
if "$GODATA_DIR/deploy/scripts/godata-backup.sh" "$GODATA_DIR"; then
  GODATA_RECORDS="$(docker compose exec -T mongo sh -c 'mongosh --quiet --nodb --eval "db = new Mongo(\"mongodb://127.0.0.1:27017\").getDB(\"admin\"); db.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD); const d = db.getSiblingDB(process.env.GODATA_DB); print(d.person.countDocuments({}) + d.outbreak.countDocuments({}) + d.user.countDocuments({}))"')"
  if [ "$GODATA_RECORDS" = 0 ]; then
    docker compose exec -T mongo sh -c 'mongosh --quiet --nodb --eval "db = new Mongo(\"mongodb://127.0.0.1:27017\").getDB(\"admin\"); db.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD); printjson(db.getSiblingDB(process.env.GODATA_DB).dropDatabase())"'
    sudo rm -f data/state/migration-failed data/state/db-command-running
    docker compose up -d --wait --wait-timeout 900
    docker compose logs godata | grep godata-entrypoint
  else
    echo "stop: the database has $GODATA_RECORDS persons, outbreaks or users, it is not an interrupted first installation" >&2
    false
  fi
else
  echo "dump failed: nothing was dropped" >&2
  false
fi
```

Expected result: the `backup ok` line of the dump, which stays in `dumps/`, the output with `ok: 1` and
`dropped: 'go-data'`, the containers as `Healthy` and, in the log, `database is empty`, `running init-database` and
`init-database finished`. If `stop:` appears, the database has data and nothing was dropped: follow
**Go back to the previous version** or restore the right dump with step 6.2 of the backup manual.

## MongoDB 7.0 patch upgrade

On pm2, the MongoDB packages are held (`apt-mark hold`), so that an Ubuntu upgrade does not change the version. To
apply a patch of the 7.0 series (7.0.x), in a maintenance window and after a dump (step 3.1 of the
[backup manual](backup.md)), release the hold, upgrade and hold again. Go.Data is down while MongoDB restarts.

```bash
sudo apt-mark unhold mongodb-org mongodb-org-database mongodb-org-server mongodb-org-mongos mongodb-org-tools mongodb-mongosh
sudo apt-get update
sudo apt-get install -y --only-upgrade mongodb-org mongodb-org-database mongodb-org-server mongodb-org-mongos mongodb-org-tools mongodb-mongosh
sudo apt-mark hold mongodb-org mongodb-org-database mongodb-org-server mongodb-org-mongos mongodb-org-tools mongodb-mongosh
sudo systemctl restart mongod
timeout 120 sh -c 'until mongosh --quiet --eval "db.adminCommand({ ping: 1 })" > /dev/null 2>&1; do sleep 2; done'
pm2 restart "$GODATA_PM2"
mongod --version | head -n 1
systemctl is-active mongod
```

Expected result: the `Canceled hold on` and `set on hold.` lines for each package, the Go.Data process restarted, the
MongoDB version, which starts with `db version v7.0.`, and `active`. Run the **Variables** block first, which sets
`GODATA_PM2`. The repository configured at installation only delivers the 7.0 series. On Docker, the MongoDB version
is the one of the `mongo` image in the `docker-compose.yml` of each Go.Data version.
