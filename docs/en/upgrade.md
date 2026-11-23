# Upgrade guide for Go.Data 2026.10.0

[Português](../pt-BR/atualizacao.md) · [Release notes](release-notes.md)

## Disclaimer

- This distribution is a fork of Go.Data as published by WHO. It is not a WHO release and WHO does not endorse it.
- The software is provided as is, without warranty, under the GPL-3.0 license.
- A backup is mandatory. Migrations change the database and cannot be undone automatically.
- Whenever possible, upgrade a test copy first and plan a maintenance window.
- The operator of each installation is responsible for its data, access control and compliance with data protection
  law.
- Report problems in the issues of the API repository.

## Who this applies to

Go.Data 2.x installations installed from source on Linux and run with pm2. The procedure builds the new version in a
folder next to the current one, which is left untouched and is the way back to the previous version.

## Before you start

Check on the server:

- Node.js 22 LTS (`node -v`), npm and pm2.
- MongoDB tools: `mongodump`, `mongorestore` and `mongosh`.
- Free disk space of at least twice the database size, plus 3 GB.
- About 4 GB of free memory to build the user interface. If the server does not have it, build the interface on
  another machine with Node.js 22 (step 5) and copy the resulting folder to the server.

Also plan for:

- A maintenance window, with users informed. The system is offline from step 7 to step 9.
- The Portuguese texts of system terms are rewritten during the upgrade. Translations of those terms customized
  through spreadsheet import will be replaced.
- The usual place of residence becomes required for cases and contacts, except in outbreaks configured with optional
  addresses. Agree with the teams on how to handle older records without an address.

## 1. Set the variables

Adjust the values to your installation and run them in the same terminal you will use for every step. If the
terminal is closed, run this block again.

```bash
export GODATA_TAG=v2026.10.0
export GODATA_ATUAL=/opt/godata/atual
export GODATA_NOVA=/opt/godata/2026.10.0
export GODATA_BACKUP=/opt/godata/backup-2026.10.0
export GODATA_PM2=godata
export GODATA_DB=go-data
export GODATA_MONGO_URI=mongodb://127.0.0.1:27017
```

- `GODATA_ATUAL`: the API folder currently in use, the one that contains `server/config.json`.
- `GODATA_NOVA` and `GODATA_BACKUP`: new folders that do not exist yet.
- `GODATA_PM2`: the process name in pm2 (`pm2 list`).
- `GODATA_DB` and `GODATA_MONGO_URI`: MongoDB database and address, as in `server/datasources.json`. If MongoDB
  requires authentication, include user, password and `authSource` in the address.
- To test a release candidate, set its tag in `GODATA_TAG`, for example `v2026.10.0-rc.2`.

## 2. Record the current state

```bash
mkdir -p "$GODATA_BACKUP"
pm2 describe "$GODATA_PM2" > "$GODATA_BACKUP/pm2-before.txt"
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
mongosh "$GODATA_MONGO_URI" --quiet --file "$GODATA_BACKUP/counts.js" > "$GODATA_BACKUP/counts-before.txt"
cat "$GODATA_BACKUP/counts-before.txt"
```

Expected result: the number of non-deleted cases, contacts and events, and the number of relationships. These
numbers are compared in step 10.

## 3. Back up

```bash
mongodump --uri="$GODATA_MONGO_URI" --db="$GODATA_DB" --archive="$GODATA_BACKUP/$GODATA_DB.archive.gz" --gzip
cp -a "$GODATA_ATUAL/server/config.json" "$GODATA_ATUAL/server/datasources.json" "$GODATA_BACKUP/"
tar -C "$GODATA_ATUAL" -czf "$GODATA_BACKUP/storage-backups.tar.gz" server/storage backups
ls -lh "$GODATA_BACKUP"
```

Expected result: the database archive, both configuration files and the package with attachments and system
backups, all larger than zero. Keep a copy of the backup outside the server. Do not delete the `GODATA_ATUAL`
folder: it is the way back.

## 4. Download the new version

```bash
mkdir -p "$GODATA_NOVA/api" "$GODATA_NOVA/frontend"
cd "$GODATA_NOVA"
curl -fL -o api.tar.gz "https://github.com/EEI-OPAS-BRA/GoDataSource-API/archive/refs/tags/$GODATA_TAG.tar.gz"
curl -fL -o frontend.tar.gz "https://github.com/EEI-OPAS-BRA/GoDataSource-FrontEnd/archive/refs/tags/$GODATA_TAG.tar.gz"
tar -xzf api.tar.gz -C api --strip-components=1
tar -xzf frontend.tar.gz -C frontend --strip-components=1
```

Expected result: the `api` and `frontend` folders with the code of the version.

## 5. Install dependencies and build the user interface

```bash
cd "$GODATA_NOVA/api"
npm ci --no-audit --no-fund
cd "$GODATA_NOVA/frontend"
npm ci --no-audit --no-fund
npm run build
rm -rf "$GODATA_NOVA/api/client/dist"
cp -a "$GODATA_NOVA/frontend/dist" "$GODATA_NOVA/api/client/dist"
```

Expected result: the commands finish without errors and `api/client/dist` contains `index.html`. Building the
interface takes a few minutes. If it is built on another machine, copy the `frontend/dist` folder produced there to
`api/client/dist` on the server.

## 6. Carry over the current configuration

Compare the configuration files. Do not replace the new files with the old ones: the new version may have keys the
previous one did not.

```bash
diff "$GODATA_ATUAL/server/config.json" "$GODATA_NOVA/api/server/config.json"
diff "$GODATA_ATUAL/server/datasources.json" "$GODATA_NOVA/api/server/datasources.json"
```

Copy the values specific to your installation into the files under `GODATA_NOVA/api/server/`:

- `datasources.json`: MongoDB connection (host, port, database, user, password, `authSource`) and e-mail settings.
- `config.json`: port, the public address users open, backup settings and any other value changed locally.

Then carry over attachments and system backups:

```bash
rm -rf "$GODATA_NOVA/api/server/storage" "$GODATA_NOVA/api/backups"
cp -a "$GODATA_ATUAL/server/storage" "$GODATA_NOVA/api/server/storage"
cp -a "$GODATA_ATUAL/backups" "$GODATA_NOVA/api/backups"
```

## 7. Stop the current instance

From this step on the system is offline.

```bash
pm2 stop "$GODATA_PM2"
pm2 delete "$GODATA_PM2"
```

The previous process configuration was recorded in `pm2-before.txt` in step 2.

## 8. Migrate the database

```bash
cd "$GODATA_NOVA/api"
npm run migrate-database
```

Expected result: the command finishes without errors. The migration may take several minutes, and longer on
installations older than 2.50. If it fails, do not run it again: follow
[Rolling back to the previous version](#rolling-back-to-the-previous-version).

## 9. Start the new version

```bash
cd "$GODATA_NOVA/api"
pm2 start npm --name "$GODATA_PM2" --time -- start
pm2 save
pm2 logs "$GODATA_PM2" --lines 50 --nostream
```

Expected result: the process shows as `online` in `pm2 list` and the log shows no errors.

## 10. Check

```bash
mongosh "$GODATA_MONGO_URI" --quiet --file "$GODATA_BACKUP/counts.js" > "$GODATA_BACKUP/counts-after.txt"
diff "$GODATA_BACKUP/counts-before.txt" "$GODATA_BACKUP/counts-after.txt"
```

Expected result: no difference. Then check in the browser:

- The login page shows version `2.51.0 - build 2026.10.0`.
- An administrator and a user with a geographic restriction log in and see the expected case, contact and
  relationship lists for each of them.
- A transmission chain is generated.
- In the settings of each outbreak, review the new options for geographic visibility, creation in another
  municipality, optional address, address deletion lock, questionnaire bulk edit, and the address and document
  fields.

## Rolling back to the previous version

If the failure happened before step 7, the previous instance was not changed: simply stop there. From step 7 on,
stop the new version and restore the database from the backup:

```bash
pm2 stop "$GODATA_PM2"
pm2 delete "$GODATA_PM2"
mongorestore --uri="$GODATA_MONGO_URI" --nsInclude="$GODATA_DB.*" --archive="$GODATA_BACKUP/$GODATA_DB.archive.gz" --gzip --drop
cd "$GODATA_ATUAL"
pm2 start npm --name "$GODATA_PM2" --time -- start
pm2 save
```

If the failure was in the migration, the first two commands report that the process does not exist, which is
expected. If the previous process was started in a different way, use the command and folder recorded in
`pm2-before.txt`. Finally, repeat the check of step 10: the counts must match `counts-before.txt` and the login page
must show the previous version.
