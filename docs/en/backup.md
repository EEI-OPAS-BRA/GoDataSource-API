# Go.Data backup manual

[Português](../pt-BR/backup.md) · [Installation](installation.md) · [Configuration](configuration.md) · [Upgrade](upgrade.md)

## Disclaimer

- This distribution is a fork of Go.Data as published by WHO. It is not a WHO release and WHO does not endorse it.
- The software is provided as is, without warranty, under the GPL-3.0 license.
- A backup is mandatory. Migrations change the database and cannot be undone automatically.
- Whenever possible, upgrade a test copy first and plan a maintenance window.
- The operator of each installation is responsible for its data, access control and compliance with data protection
  law.
- Report problems in the issues of the API repository.

## What to keep

| What | pm2 | Docker | How it is copied |
| --- | --- | --- | --- |
| Database | MongoDB on the server | `data/mongo/` | Daily dump in `dumps/` (steps 3 and 4) |
| Configuration | `config/` | `config/` and `.env` | Together with the dump, in `dumps/config-<date>.tar.gz` |
| Attachments and icons | `storage/` | `data/storage/` | Copy outside the server (step 5) |
| System backups | `backups/` | `data/backups/` | Go.Data automatic backup (step 2) and copy outside the server (step 5) |

The folders are inside the installation folder (`/opt/godata`). Everything stays on the same disk as the database
until step 5, which takes the copies somewhere else. On Docker, do not copy `data/mongo` while the system is running:
the copy of the database is the dump.

## 1. Set the variables

Adjust the values to your installation and run them in the same terminal you will use for every step. If the
terminal is closed, run this block again.

```bash
export GODATA_DIR=/opt/godata
export GODATA_PM2=godata
```

- `GODATA_DIR`: the installation folder. On pm2, the one that contains `atual/` and `config/`. On Docker, the one that
  contains `docker-compose.yml` and `.env`.
- `GODATA_PM2`: the process name in pm2 (`pm2 list`). Docker does not use this variable.

Run the steps as the user that operates Go.Data, without `sudo`. The commands that need `sudo` already include it. On
Docker, `data/storage` and `data/backups` belong to the container user (uid 1000), so the commands that read those
folders use `sudo`. On a server with two installations, run the steps once for each of them, with its own values.

## 2. System backups

Go.Data makes its own backups: `.zip` files with the data, the system configuration and the attached files, written to
the system backups folder. They stay on the same server until the copy of step 5. If the `backUp.password` key is
set (see the [configuration manual](configuration.md)), the backups are encrypted and only an installation with the
same password can restore them.

### 2.1. Automatic backup settings

In **System configuration > Backups**, open **Quick actions > Automatic backup settings**:

- **Location**: the folder that holds the files. On pm2, use the `backups` folder of the installation
  (`/opt/godata/backups`), outside the version folder. On Docker, the value is always `/opt/godata/backups`, the
  `data/backups` folder as seen from inside the container: the container writes this value at every start.
- **Interval type**: **N hours**, with the **Backup interval (hours)**, or **Daily at time**, with the **Time of
  day**. A backup only happens if the system is running at that moment.
- **Retention interval (days)**: backups older than this are deleted. Each backup is a full copy: adjust the
  retention to the disk space.
- **Modules**: keep **System Configuration** and **Data**.
- **Disabled**: turns off the automatic backup and the cleanup of old backups.

Click **Save**. A new installation makes a backup every 24 hours, keeps 90 days and includes both modules.

### 2.2. Create a backup

In **System configuration > Backups**, open **Quick actions > Create backup**, choose the modules and click **Create
backup**. The backup shows in the list and, when it finishes, its status becomes **Success**.

### 2.3. Restore from the user interface

A restore takes all the data back to the moment of the backup and removes what was recorded after it. Warn the users
first. On the row of a backup with status **Success**, click **Restore backup**. The confirmation offers **Create
backup and restore**, which first saves the current state, and **Restore**. The window shows the progress until the
end.

When the user interface does not open, restore the file from the terminal (step 7).

## 3. Dump the database

The `godata-backup.sh` script writes a database dump (`mongodump --archive --gzip`) and an archive of `config/` (plus
`.env` on Docker) to `dumps/`, with the same UTC date and time in the name. Only the owner can read the files. The
script does not ask for a password: on pm2, it uses the connection in `atual/server/datasources.json`; on Docker, it
runs `mongodump` inside the `mongo` container. It deletes dumps older than 14 days. For another period, add
`--keep-days` and the number of days after the installation folder.

### 3.1. On pm2

The script needs `node` and `mongodump` in the `PATH`.

```bash
"$GODATA_DIR/atual/deploy/scripts/godata-backup.sh" "$GODATA_DIR"
ls -l "$GODATA_DIR/dumps"
```

Expected result: a line such as `backup ok /opt/godata/dumps/go-data-20261118T023000Z.archive.gz 25MB` and, in the
folder, the files `go-data-<date>.archive.gz` and `config-<date>.tar.gz`, with permissions `-rw-------`. On a
failure, the script prints `backup failed:` followed by the reason and exits with an error. If another backup is
running, the reason is `another backup is running`.

### 3.2. On Docker

The system must be running (`docker compose ps` shows the `mongo` container running).

```bash
"$GODATA_DIR/deploy/scripts/godata-backup.sh" "$GODATA_DIR"
ls -l "$GODATA_DIR/dumps"
```

Expected result: a line such as `backup ok /opt/godata/dumps/go-data-20261118T023000Z.archive.gz 25MB` and, in the
folder, the files `go-data-<date>.archive.gz` and `config-<date>.tar.gz`, with permissions `-rw-------`. On a
failure, the script prints `backup failed:` followed by the reason and exits with an error. If another backup is
running, the reason is `another backup is running`.

## 4. Schedule the daily dump

The block puts the script in the user's crontab, every day at 2:30 server time, with the output in
`dumps/backup.log`. It replaces the previous line of this installation, if any, and keeps the other crontab lines.
For another time, change `30 2` (minute and hour) in the block before running it.

### 4.1. On pm2

Cron does not load nvm. The block writes into the line the `PATH` with the folder of the Node.js in use. After
changing the Node.js version, run the block again.

```bash
command -v node
command -v mongodump
GODATA_CRON="30 2 * * * PATH=$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin $GODATA_DIR/atual/deploy/scripts/godata-backup.sh $GODATA_DIR >> $GODATA_DIR/dumps/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -vF " $GODATA_DIR/dumps/backup.log" || true; echo "$GODATA_CRON") | crontab -
crontab -l
```

Expected result: the paths of `node` and `mongodump`, and the crontab with a line such as this one:

```text
30 2 * * * PATH=/home/usuario/.nvm/versions/node/v22.12.0/bin:/usr/local/bin:/usr/bin:/bin /opt/godata/atual/deploy/scripts/godata-backup.sh /opt/godata >> /opt/godata/dumps/backup.log 2>&1
```

### 4.2. On Docker

The user must be able to run `docker` without `sudo` (`docker` group), as in the other commands.

```bash
GODATA_CRON="30 2 * * * $GODATA_DIR/deploy/scripts/godata-backup.sh $GODATA_DIR >> $GODATA_DIR/dumps/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -vF " $GODATA_DIR/dumps/backup.log" || true; echo "$GODATA_CRON") | crontab -
crontab -l
```

Expected result: the crontab with this line:

```text
30 2 * * * /opt/godata/deploy/scripts/godata-backup.sh /opt/godata >> /opt/godata/dumps/backup.log 2>&1
```

The next day, `tail -n 5 "$GODATA_DIR/dumps/backup.log"` shows `backup ok` with the file of the day. A failure leaves
`backup failed:` followed by the reason in the log. Check the log often.

## 5. Copy the backups outside the server

The dumps, the attachments and the system backups are on the same disk as the database. Copy them somewhere else: a
folder of another server mounted on this one (network share) or another server over SSH. Replace
`/caminho/do/backup` with the destination. Over SSH, use `usuario@servidor:/caminho/do/backup`, with an SSH key
without a passphrase for cron. Use one destination per installation.

The block copies once and schedules the daily copy at 4:30, after the dump. The copy deletes nothing at the
destination: delete old files there according to the local policy.

### 5.1. On pm2

```bash
rsync -a --exclude='*.partial' "$GODATA_DIR/dumps" "$GODATA_DIR/storage" "$GODATA_DIR/backups" /caminho/do/backup/
GODATA_CRON="30 4 * * * rsync -a --exclude='*.partial' $GODATA_DIR/dumps $GODATA_DIR/storage $GODATA_DIR/backups /caminho/do/backup/"
(crontab -l 2>/dev/null | grep -vF " $GODATA_DIR/dumps " || true; echo "$GODATA_CRON") | crontab -
crontab -l
```

Expected result: `rsync` finishes without errors, the destination now has the `dumps`, `storage` and `backups`
folders, and the crontab shows the copy line in addition to the dump line.

### 5.2. On Docker

On Docker, the copy runs as `root`, which can read the container folders.

```bash
sudo rsync -a --exclude='*.partial' "$GODATA_DIR/dumps" "$GODATA_DIR/data/storage" "$GODATA_DIR/data/backups" /caminho/do/backup/
GODATA_CRON="30 4 * * * rsync -a --exclude='*.partial' $GODATA_DIR/dumps $GODATA_DIR/data/storage $GODATA_DIR/data/backups /caminho/do/backup/"
(sudo crontab -l 2>/dev/null | grep -vF " $GODATA_DIR/dumps " || true; echo "$GODATA_CRON") | sudo crontab -
sudo crontab -l
```

Expected result: `rsync` finishes without errors, the destination now has the `dumps`, `storage` and `backups`
folders, and the `root` crontab shows the copy line.

## 6. Restore the database from a dump

A restore replaces the database with the content of the dump: everything recorded after it is lost. The system is
offline from the second block of this step until step 8. Use a dump of the version in use. To go back to the previous
version after an upgrade, follow the [upgrade manual](upgrade.md).

The first block shows the dump that will be restored: the most recent one in `dumps/`. To restore another one, for
example one brought back from the destination of step 5, run `export GODATA_DUMP=` followed by the full path of the
file and repeat the first block.

### 6.1. On pm2

```bash
ls -l "${GODATA_DUMP:-$(ls -1 "$GODATA_DIR"/dumps/*.archive.gz | tail -n 1)}"
```

Expected result: the dump file, with its date and size.

```bash
GODATA_DUMP="${GODATA_DUMP:-$(ls -1 "$GODATA_DIR"/dumps/*.archive.gz | tail -n 1)}"
GODATA_DB="$(node -p 'require(process.argv[1]).mongoDb.database' "$GODATA_DIR/atual/server/datasources.json")"
pm2 stop "$GODATA_PM2"
GODATA_MONGO_CFG="$(mktemp)"
printf "uri: '%s'\n" "$(node "$GODATA_DIR/atual/deploy/lib/db-state.js" print-uri --datasources "$GODATA_DIR/atual/server/datasources.json" | sed "s/'/''/g")" > "$GODATA_MONGO_CFG"
mongorestore --config "$GODATA_MONGO_CFG" --nsInclude="$GODATA_DB.*" --archive="$GODATA_DUMP" --gzip --drop
rm -f "$GODATA_MONGO_CFG"
```

Expected result: the process stopped in pm2 and, at the end, a line such as `125000 document(s) restored
successfully. 0 document(s) failed to restore.` The warning `The --db and --collection flags are deprecated for this
use-case` may also show and does not affect the restore. The MongoDB connection goes into a temporary file that only
the owner can read, deleted at the end. If `mongorestore` shows an error, do not start the system: fix the cause and
run the block again. Then follow step 8.

### 6.2. On Docker

`mongorestore` runs inside the `mongo` container, with the MongoDB `root` user and the password the container itself
knows.

```bash
ls -l "${GODATA_DUMP:-$(ls -1 "$GODATA_DIR"/dumps/*.archive.gz | tail -n 1)}"
```

Expected result: the dump file, with its date and size.

```bash
cd "$GODATA_DIR"
GODATA_DUMP="${GODATA_DUMP:-$(ls -1 "$GODATA_DIR"/dumps/*.archive.gz | tail -n 1)}"
docker compose stop godata
docker compose exec -T mongo sh -c "$(cat <<'EOF'
umask 077
d="$(mktemp -d)"
trap 'rm -rf "$d"' EXIT
printf "password: '%s'\n" "$(printf '%s' "$MONGO_INITDB_ROOT_PASSWORD" | sed "s/'/''/g")" > "$d/mongorestore.yml"
mongorestore --config "$d/mongorestore.yml" --username "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin --nsInclude="$GODATA_DB.*" --archive --gzip --drop
EOF
)" < "$GODATA_DUMP"
```

Expected result: the `godata` container stopped and, at the end, a line such as `125000 document(s) restored
successfully. 0 document(s) failed to restore.` If `mongorestore` shows an error, do not start the system: fix the
cause and run the block again. Then follow step 8.

## 7. Restore a system backup from its file

Use this step when the user interface does not open, or to restore a system backup brought from somewhere else. The
file must be in the system backups folder: `backups/` on pm2, `data/backups/` on Docker. A restore takes all the data
back to the moment of the backup and removes what was recorded after it. The system is offline from the second block
of this step until step 8.

The first block shows the backup that will be restored: the most recent one in the folder (the names start with
`snapshot_` and the date). To restore another one, run `export GODATA_SNAPSHOT=` followed by the file name, without
the folder, and repeat the first block.

In the restore output, warnings such as `DeprecationWarning` and `MaxListenersExceededWarning` show with `"level":
"error"` and are expected.

### 7.1. On pm2

```bash
ls -l "$GODATA_DIR/backups/${GODATA_SNAPSHOT:-$(ls -1 "$GODATA_DIR/backups" | grep '^snapshot_.*\.zip$' | tail -n 1)}"
```

Expected result: the backup file, with its date and size.

```bash
GODATA_SNAPSHOT="${GODATA_SNAPSHOT:-$(ls -1 "$GODATA_DIR/backups" | grep '^snapshot_.*\.zip$' | tail -n 1)}"
pm2 stop "$GODATA_PM2"
cd "$GODATA_DIR/atual"
npm run restore-backup -- --file="$GODATA_DIR/backups/$GODATA_SNAPSHOT"
```

Expected result: the process stopped in pm2 and, at the end, the line `Successfully restored backup:` followed by the
path of the file. If `Failed to restore backup` shows, do not start the system: fix the cause and run the block
again. Then follow step 8.

### 7.2. On Docker

The command runs in a temporary container, with the same image, the same configuration and the same folders as the
system, deleted at the end.

```bash
sudo ls -l "$GODATA_DIR/data/backups/${GODATA_SNAPSHOT:-$(sudo ls -1 "$GODATA_DIR/data/backups" | grep '^snapshot_.*\.zip$' | tail -n 1)}"
```

Expected result: the backup file, with its date and size.

```bash
cd "$GODATA_DIR"
GODATA_SNAPSHOT="${GODATA_SNAPSHOT:-$(sudo ls -1 "$GODATA_DIR/data/backups" | grep '^snapshot_.*\.zip$' | tail -n 1)}"
docker compose stop godata
docker compose run --rm -T godata npm run restore-backup -- --file="/opt/godata/backups/$GODATA_SNAPSHOT"
```

Expected result: the `godata` container stopped and, at the end, the line `Successfully restored backup:` followed by
the path of the file inside the container. If `Failed to restore backup` shows, do not start the system: fix the
cause and run the block again. Then follow step 8.

## 8. Start the system and check

After starting the system, check in the browser:

- An administrator logs in and the case and contact lists show the data as of the backup date.
- In **System configuration > Backups > Quick actions > Automatic backup settings**, the **Location** is the backups
  folder of the installation. A restore brings back the system settings stored in the backup.

### 8.1. On pm2

```bash
pm2 start "$GODATA_PM2"
pm2 logs "$GODATA_PM2" --lines 50 --nostream
```

Expected result: the process shows as `online` in `pm2 list` and the log shows no errors.

### 8.2. On Docker

```bash
cd "$GODATA_DIR"
docker compose start godata
sleep 60
docker compose logs --since 2m godata | grep godata-entrypoint
```

Expected result: the lines `MongoDB is reachable`, `database has users`, `migrate-database finished` and `starting
Go.Data` followed by the version. If `starting Go.Data` does not show yet, wait and run the last command again.

## 9. Test the restore

A backup is only worth something if it can be restored. From time to time (for example, every three months), restore
into a test copy, never on the server in use:

- Install the same version on a test server, following the [installation manual](installation.md).
- Bring from the destination of step 5 a dump, a system backup and the `storage` and `backups` folders.
- Follow steps 6 and 8 with the dump and, at another time, steps 7 and 8 with the system backup.
- Check the login, the number of cases and contacts, and that a few attachments open.

The same route rebuilds the installation on a new server. In that case, first put back `config/` and, on Docker,
`.env`, which are in the `config-<date>.tar.gz` file of the dump. On Docker, `.env` must be in place before the first
start, because MongoDB creates the users with its passwords.
