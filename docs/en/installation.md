# Go.Data installation manual

[Português](../pt-BR/instalacao.md) · [Configuration](configuration.md) · [Backup](backup.md) · [Upgrade](upgrade.md)

## Disclaimer

- This distribution is a fork of Go.Data as published by WHO. It is not a WHO release and WHO does not endorse it.
- The software is provided as is, without warranty, under the GPL-3.0 license.
- A backup is mandatory. Migrations change the database and cannot be undone automatically.
- Whenever possible, upgrade a test copy first and plan a maintenance window.
- The operator of each installation is responsible for its data, access control and compliance with data protection
  law.
- Report problems in the issues of the API repository.

## What you will need

- A dedicated 64-bit (amd64) server, virtual or physical, with internet access during the installation.
- Ubuntu Server 22.04 LTS or 24.04 LTS, depending on the path:

| Path | Ubuntu 22.04 | Ubuntu 24.04 |
| --- | --- | --- |
| A, pm2 (MongoDB and Go.Data installed on the server) | Yes | No: MongoDB 7.0 has no packages for 24.04 |
| B, Docker (MongoDB and Go.Data in containers) | Yes | Yes |

- A processor with the AVX instructions, which MongoDB 7.0 requires. On a virtual machine, the processor type must
  pass the instructions of the physical processor through (for example, the `host` type). Without AVX, MongoDB does
  not start and the installation cannot go on: ask the infrastructure team to change the processor type of the
  virtual machine or to provide another server.
- At least 4 GB of memory and 20 GB of free disk space, plus the space for the data, the dumps and the backups.
- An Ubuntu user other than `root` that can use `sudo`. Every step runs as that user.
- An address (a DNS name) through which the users will open the system, for HTTPS.

To check the processor before choosing the server:

```bash
grep -m1 -wo avx /proc/cpuinfo
```

Expected result: `avx`. If nothing is printed, the processor has no AVX.

Path A follows the model of the current pm2 installations. Path B needs neither MongoDB nor Node.js installed on the
server, and an upgrade comes down to changing the image version. Follow only one of the two paths, then the sections
**First access**, **HTTPS with nginx** and **Final check**.

## Path A: pm2

### A1. Set the variables

Adjust the values to your installation and run them in the same terminal you will use for every step. If the
terminal is closed, run this block again.

```bash
export GODATA_VERSION=2026.10.0
export GODATA_DIR=/opt/godata
export GODATA_DB=go-data
export GODATA_PORT=3000
export GODATA_PM2=godata
```

- `GODATA_VERSION`: the version to install, without the leading `v`, as on the releases page of the API repository.
- `GODATA_DIR`: the installation folder. It does not exist yet or is empty.
- `GODATA_DB`: the database name in MongoDB.
- `GODATA_PORT`: the port Go.Data listens on, on the server.
- `GODATA_PM2`: the process name in pm2.

On a server with two installations (for example, production and test), the second one uses other values, for
example `/opt/godata-teste`, `go-data-teste`, `3001` and `godata-teste`. It uses the same MongoDB and the same
Node.js: skip steps A4 and A6 and, in the first block of step A5, replace the user `godata` with another name, for
example `godata-teste`.

### A2. Check the server

The block checks the processor, the Ubuntu version and the installation folder. It changes nothing on the server.

```bash
if ! grep -m1 -wo avx /proc/cpuinfo; then
  echo "stop: this CPU has no AVX instructions, MongoDB 7.0 does not run on it" >&2
  false
elif ! grep -qx 'VERSION_ID="22.04"' /etc/os-release; then
  echo "stop: the pm2 path needs Ubuntu 22.04, this server runs $(. /etc/os-release && echo "$PRETTY_NAME")" >&2
  false
elif sudo test -e "$GODATA_DIR" && [ -n "$(sudo ls -A "$GODATA_DIR")" ]; then
  echo "stop: $GODATA_DIR already exists and is not empty" >&2
  false
else
  echo "ok: $(. /etc/os-release && echo "$PRETTY_NAME"), $GODATA_DIR is free"
fi
```

Expected result: `avx` and a line that starts with `ok:`. If a line that starts with `stop:` appears, do not go on.
Without AVX, see **What you will need**. With another Ubuntu version, use path B. If the folder already exists and is
not empty, choose another folder in `GODATA_DIR` (step A1) or check what is in it: this manual does not install over
an existing installation.

### A3. Create the installation folder

```bash
sudo install -d -o "$USER" -g "$USER" -m 750 "$GODATA_DIR"
mkdir -p "$GODATA_DIR/versions" "$GODATA_DIR/storage/files" "$GODATA_DIR/storage/icons" "$GODATA_DIR/backups" "$GODATA_DIR/dumps"
install -d -m 700 "$GODATA_DIR/config"
ls -l "$GODATA_DIR"
```

Expected result: the folders `backups`, `config`, `dumps`, `storage` and `versions`, owned by your user.

| Folder | Content |
| --- | --- |
| `versions/` | The downloaded packages and one folder per installed version |
| `atual` | Link to the folder of the version in use, created in step A7 |
| `config/` | The values specific to the installation (see the [configuration manual](configuration.md)) |
| `storage/` | Attachments and icons, used by every version |
| `backups/` | System backups |
| `dumps/` | Database dumps written by the backup script |

### A4. Install MongoDB 7.0

MongoDB comes from MongoDB's official repository, in the 7.0 series. The last command of the first block keeps `apt`
from changing the MongoDB version during an Ubuntu upgrade.

```bash
sudo apt-get update
sudo apt-get install -y gnupg curl
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg --dearmor --yes -o /usr/share/keyrings/mongodb-server-7.0.gpg
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
sudo apt-mark hold mongodb-org mongodb-org-database mongodb-org-server mongodb-org-mongos mongodb-org-tools mongodb-mongosh
mongod --version | head -n 1
```

Expected result: the installed packages, the lines `mongodb-org set on hold.` and similar, and `db version v7.0.`
followed by the version number.

The next block writes the MongoDB configuration: it listens only on the server itself (`127.0.0.1`) and requires a
user and a password. It then starts MongoDB and keeps it enabled for the next boots of the server.

```bash
sudo tee /etc/mongod.conf > /dev/null <<'EOF'
storage:
  dbPath: /var/lib/mongodb
systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log
net:
  port: 27017
  bindIp: 127.0.0.1
processManagement:
  timeZoneInfo: /usr/share/zoneinfo
security:
  authorization: enabled
EOF
sudo systemctl enable --now mongod
timeout 120 sh -c 'until mongosh --quiet --eval "db.adminCommand({ ping: 1 })" > /dev/null 2>&1; do sleep 2; done'
systemctl is-active mongod
```

Expected result: `active`. If the command ends without that line, see the reason in
`sudo tail -n 50 /var/log/mongodb/mongod.log`.

### A5. Create the MongoDB users

There are two users, both in the MongoDB `admin` database:

- `admin`, the MongoDB administrator, with the `root` role. Its password is in the file `/root/mongodb-admin.txt`,
  which only `root` can read. Keep a copy in the institution's password vault as well.
- `godata`, used by Go.Data, with the `readWrite` and `dbAdmin` roles on the Go.Data database only. Its password is in
  `config/datasources.json`, which only your user can read.

The passwords are generated by `openssl` and appear neither on the screen nor in the commands. The first block
generates the administrator password, when its file does not exist yet, and creates `config/datasources.json` with the
Go.Data connection.

```bash
sudo sh -c 'umask 077 && test -s /root/mongodb-admin.txt || openssl rand -hex 24 > /root/mongodb-admin.txt'
install -m 600 /dev/null "$GODATA_DIR/config/datasources.json"
cat > "$GODATA_DIR/config/datasources.json" <<EOF
{
  "mongoDb": {
    "host": "127.0.0.1",
    "port": 27017,
    "database": "$GODATA_DB",
    "user": "godata",
    "password": "$(openssl rand -hex 24)",
    "authSource": "admin"
  }
}
EOF
```

Expected result: no output.

The second block creates both users, reading the passwords from the files. While MongoDB has no user, it accepts the
creation of the first one from the server itself: the block creates the administrator, when it does not exist yet,
logs in with it and creates the Go.Data user.

```bash
sudo GODATA_DATASOURCES="$GODATA_DIR/config/datasources.json" mongosh --quiet --nodb --eval '
const fs = require("fs");
const adminPassword = fs.readFileSync("/root/mongodb-admin.txt", "utf8").trim();
const app = JSON.parse(fs.readFileSync(process.env.GODATA_DATASOURCES, "utf8")).mongoDb;
const admin = new Mongo("mongodb://127.0.0.1:27017").getDB("admin");
try {
  admin.auth("admin", adminPassword);
} catch (err) {
  admin.createUser({ user: "admin", pwd: adminPassword, roles: ["root"] });
  admin.auth("admin", adminPassword);
}
admin.createUser({ user: app.user, pwd: app.password, roles: [{ role: "readWrite", db: app.database }, { role: "dbAdmin", db: app.database }] });
print("users: " + admin.getUsers().users.map(u => u.user).join(", "));
'
```

Expected result: `users: admin, godata`.

The third block checks the Go.Data user: it reaches the Go.Data database and cannot read the `admin` database.

```bash
mongosh --quiet --nodb --eval '
const app = JSON.parse(require("fs").readFileSync(process.env.GODATA_DIR + "/config/datasources.json", "utf8")).mongoDb;
const conn = new Mongo("mongodb://" + app.user + ":" + app.password + "@" + app.host + ":" + app.port + "/?authSource=" + app.authSource);
print(app.database + ": " + conn.getDB(app.database).getCollectionNames().length + " collections");
try {
  conn.getDB("admin").getCollectionNames();
  print("admin: readable, check the roles of the user");
} catch (err) {
  print("admin: " + err.codeName);
}
'
```

Expected result: `go-data: 0 collections` and `admin: Unauthorized`.

### A6. Install Node.js 22 and pm2

Node.js is installed by nvm, in your user's home folder. nvm is also loaded in the next terminals.

```bash
sudo apt-get install -y build-essential
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 22
npm install -g pm2@7
node -v
pm2 -v
```

Expected result: the Node.js version, which starts with `v22.`, and the pm2 version, which starts with `7.`.

### A7. Download and install the package

The version package holds the API and the compiled interface. The first block downloads the package and checks its
checksum.

```bash
cd "$GODATA_DIR/versions"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_VERSION/godata-$GODATA_VERSION.tar.gz"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_VERSION/godata-$GODATA_VERSION.tar.gz.sha256"
sha256sum -c "godata-$GODATA_VERSION.tar.gz.sha256"
```

Expected result: `godata-2026.10.0.tar.gz: OK`. If `FAILED` appears, the file is corrupt: delete both files and
download them again.

The second block extracts the package into `versions/`, installs the dependencies, links `server/storage` to the
`storage/` folder of the installation and points `atual` to the new version.

```bash
mkdir "$GODATA_DIR/versions/$GODATA_VERSION"
tar -xzf "$GODATA_DIR/versions/godata-$GODATA_VERSION.tar.gz" -C "$GODATA_DIR/versions/$GODATA_VERSION" --strip-components=1
cd "$GODATA_DIR/versions/$GODATA_VERSION"
npm ci --omit=dev --no-audit --no-fund
rm -rf server/storage
ln -s "$GODATA_DIR/storage" server/storage
ln -sfn "versions/$GODATA_VERSION" "$GODATA_DIR/atual"
ls -l "$GODATA_DIR/atual" "$GODATA_DIR/atual/server/storage"
```

Expected result: `npm ci` ends without an error (`npm warn` lines may appear) and the last two lines show
`atual -> versions/2026.10.0` and `storage -> /opt/godata/storage`.

### A8. Configure

The block writes the port into `config/config.json`.

```bash
node -e '
const fs = require("fs");
const file = process.argv[1];
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
Object.assign(data, JSON.parse(fs.readFileSync(0, "utf8")));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
' "$GODATA_DIR/config/config.json" <<EOF
{
  "port": $GODATA_PORT
}
EOF
```

Expected result: no output.

Then, in the same terminal, follow steps 2.1 (public address, time zone and dates) and 3.1 (mail server) of the
[configuration manual](configuration.md). The MongoDB connection is already in `config/datasources.json` (step A5).
The other steps of the configuration manual are optional and can be done later.

### A9. Apply the configuration

```bash
node "$GODATA_DIR/atual/deploy/lib/merge-config.js" --defaults "$GODATA_DIR/atual/deploy/defaults" --overrides "$GODATA_DIR/config" --server-dir "$GODATA_DIR/atual/server"
node -p 'const c = require(process.argv[1]); ({ port: c.port, public: c.public })' "$GODATA_DIR/atual/server/config.json"
```

Expected result: the first command prints nothing and the second prints the port and the public address, for
example `{ port: 3000, public: { host: 'godata.exemplo.gov.br', protocol: 'https', port: '' } }`. If a file in
`config/` has a syntax error, the first command gives the file, the line and the column.

### A10. Initialise the database

`init-database` creates the collections, the Go.Data administrator user and the reference data. It erases everything
in the database, so the block runs it only on an empty database.

```bash
cd "$GODATA_DIR/atual"
if [ "$(node deploy/lib/db-state.js db-empty --datasources server/datasources.json)" = yes ]; then
  npm run init-database
else
  echo "stop: the database $GODATA_DB is not empty, init-database would erase it" >&2
  false
fi
```

Expected result: the command takes a few minutes and ends without an error. If
`stop: the database go-data is not empty` appears, the database already has data: check `GODATA_DB` (step A1) and do
not go on.

### A11. Start with pm2

```bash
cd "$GODATA_DIR/atual"
pm2 start npm --name "$GODATA_PM2" --time -- start
pm2 save
timeout 300 sh -c "until curl -fsS http://127.0.0.1:$GODATA_PORT/status 2> /dev/null; do sleep 5; done"
echo
pm2 list
```

Expected result: a line such as `{"started":"2026-11-18T12:00:00.000Z","uptime":12.3}` and the `godata` process as
`online` in `pm2 list`. `pm2 save` writes the process list, which pm2 restores when it starts. If the
`{"started":...}` line does not appear within 5 minutes, see the reason in `pm2 logs godata --lines 100 --nostream`.

### A12. Start at boot and log rotation

The `pm2 startup` command prints a command to run with `sudo`, which creates the pm2 service in systemd. The first
command of the block is that command. After every change to the pm2 process list, run `pm2 save` again.

```bash
sudo env PATH="$PATH" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME"
pm2 install pm2-logrotate
pm2 save
systemctl is-enabled "pm2-$USER"
```

Expected result: the line `[PM2] [v] Command successfully executed.`, the `pm2-logrotate` module as `online` and
`enabled` on the last line. From now on, Go.Data comes back on its own after a restart of the server.
`pm2-logrotate` rotates the logs at 10 MB and keeps the last 30.

### A13. If the process does not come back: pm2 resurrect

This step is not part of the installation. Use it when `pm2 list` does not show the Go.Data process, for example
after a `pm2 kill` or a pm2 error. It restores the list written by the last `pm2 save`.

```bash
pm2 resurrect
pm2 list
```

Expected result: the `godata` process as `online`. If it does not appear, start it again as in step A11.

### A14. System backups folder

Go.Data writes the system backups to a folder set in the database. The installation leaves that folder inside the
version folder, which changes at every upgrade. The block moves it to the `backups/` folder of the installation.
Repeat this step after every upgrade. The same setting appears in **System > Backups > Quick actions > Automatic
backup settings** (see the [backup manual](backup.md)).

```bash
node "$GODATA_DIR/atual/deploy/lib/db-state.js" set-backup-location "$GODATA_DIR/backups" --datasources "$GODATA_DIR/atual/server/datasources.json"
```

Expected result: `changed /opt/godata/versions/2026.10.0/backups -> /opt/godata/backups`. On a second run, the line
is `unchanged /opt/godata/backups`.

### A15. Schedule the daily dump

Follow steps 3.1 (database dump) and 4.1 (daily schedule) of the [backup manual](backup.md), in the same terminal.
The script is `/opt/godata/atual/deploy/scripts/godata-backup.sh`. Then follow step 5 of the same manual to copy the
backups outside the server.

## Path B: Docker

### B1. Set the variables

Adjust the values to your installation and run them in the same terminal you will use for every step. If the
terminal is closed, run this block again.

```bash
export GODATA_VERSION=2026.10.0
export GODATA_DIR=/opt/godata
export GODATA_DB=go-data
export GODATA_PORT=3000
```

- `GODATA_VERSION`: the version to install, without the leading `v`, as on the releases page of the API repository.
- `GODATA_DIR`: the installation folder. It does not exist yet or is empty.
- `GODATA_DB`: the database name in MongoDB.
- `GODATA_PORT`: the port Go.Data listens on, on the server.

The last three values go into the `.env` file in step B6, which is in force from then on. After the installation, do
not export these variables in a new terminal: `docker compose` uses the terminal value instead of `.env` (see the
[configuration manual](configuration.md)). On a server with two installations, the second one uses another folder
and another port, for example `/opt/godata-teste` and `3001`, and has its own MongoDB.

### B2. Check the server

The block checks the processor, the Ubuntu version and the installation folder. It changes nothing on the server.

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
else
  echo "ok: $(. /etc/os-release && echo "$PRETTY_NAME"), $GODATA_DIR is free"
fi
```

Expected result: `avx` and a line that starts with `ok:`. If a line that starts with `stop:` appears, do not go on.
Without AVX, see **What you will need**. If the folder already exists and is not empty, choose another folder in
`GODATA_DIR` (step B1) or check what is in it: this manual does not install over an existing installation.

### B3. Install Docker

Docker Engine and the Compose plugin come from Docker's official repository. If the server already has Docker
installed from the official repository, skip the first block.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version --format '{{.Server.Version}}'
docker compose version
```

Expected result: the Docker version and the line `Docker Compose version` followed by the version of the Compose
plugin.

The other steps run `docker` without `sudo`. The next block adds your user to the `docker` group.

```bash
sudo usermod -aG docker "$USER"
```

Expected result: no output. The group applies only to a new session: log out of the server, log in again and run the
block of step B1 once more. The `docker` group gives the user the same power as `root` over the server: add to it
only the people who administer Go.Data.

### B4. Create the installation folder

```bash
docker info --format '{{.ServerVersion}}'
sudo install -d -o "$USER" -g "$USER" -m 750 "$GODATA_DIR"
mkdir -p "$GODATA_DIR/versions" "$GODATA_DIR/config" "$GODATA_DIR/data/mongo" "$GODATA_DIR/data/storage" "$GODATA_DIR/data/backups" "$GODATA_DIR/data/state" "$GODATA_DIR/dumps"
ls -l "$GODATA_DIR"
```

Expected result: the Docker version, with no permission error, and the folders `config`, `data`, `dumps` and
`versions`. If the first command prints `permission denied`, the session does not have the `docker` group yet: see
the end of step B3.

| Folder or file | Content |
| --- | --- |
| `docker-compose.yml` | The `mongo` and `godata` services, copied from the package in step B5 |
| `.env` | Version, port, database and MongoDB passwords, created in step B6 |
| `config/` | The values specific to the installation (see the [configuration manual](configuration.md)) |
| `data/mongo/` | The MongoDB files |
| `data/storage/` | Attachments and icons |
| `data/backups/` | System backups |
| `data/state/` | State of the Go.Data container between starts |
| `dumps/` | Database dumps written by the backup script |
| `mongo-init/` | Script that creates the Go.Data user in MongoDB, at the first start |
| `deploy/scripts/` | The backup script |
| `versions/` | The downloaded packages |

### B5. Download the package and copy the Docker files

The version package carries `docker-compose.yml`, the `.env` template, the script that creates the MongoDB user and
the backup script. The block downloads the package, checks its checksum and copies these files into the installation
folder.

```bash
cd "$GODATA_DIR/versions"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_VERSION/godata-$GODATA_VERSION.tar.gz"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_VERSION/godata-$GODATA_VERSION.tar.gz.sha256"
sha256sum -c "godata-$GODATA_VERSION.tar.gz.sha256"
tar -xzf "godata-$GODATA_VERSION.tar.gz" -C "$GODATA_DIR" --strip-components=3 "godata-$GODATA_VERSION/deploy/docker/docker-compose.yml" "godata-$GODATA_VERSION/deploy/docker/.env.example" "godata-$GODATA_VERSION/deploy/docker/mongo-init"
tar -xzf "godata-$GODATA_VERSION.tar.gz" -C "$GODATA_DIR" --strip-components=1 "godata-$GODATA_VERSION/deploy/scripts/godata-backup.sh"
ls -l "$GODATA_DIR/docker-compose.yml" "$GODATA_DIR/mongo-init" "$GODATA_DIR/deploy/scripts"
```

Expected result: `godata-2026.10.0.tar.gz: OK` and the files `docker-compose.yml`, `mongo-init/01-godata-user.js` and
`deploy/scripts/godata-backup.sh`. If `FAILED` appears, the file is corrupt: delete both downloaded files and run the
block again.

### B6. Create the .env file

The block creates `.env` with the keys of `.env.example` and two passwords generated by `openssl`: the one of the
MongoDB `root` user and the one of the `godata` user, which Go.Data uses. Only your user can read the file. The
passwords do not appear on the screen.

```bash
cd "$GODATA_DIR"
install -m 600 /dev/null .env
cat > .env <<EOF
GODATA_VERSION=$GODATA_VERSION
GODATA_BIND=0.0.0.0
GODATA_PORT=$GODATA_PORT
GODATA_DB=$GODATA_DB
MONGO_ROOT_PASSWORD=$(openssl rand -hex 24)
GODATA_MONGO_PASSWORD=$(openssl rand -hex 24)
EOF
grep -v PASSWORD .env
ls -l .env
```

Expected result: the four lines without a password and the file with mode `-rw-------`. MongoDB creates the users
with these passwords at the first start. After it, do not change the passwords or `GODATA_DB` in `.env`. `.env` goes
into the configuration archive that the backup script writes with every dump.

### B7. Download the image

```bash
cd "$GODATA_DIR"
docker compose pull
docker image ls ghcr.io/eei-opas-bra/godata
```

Expected result: the `mongo` and `godata` images downloaded and the `ghcr.io/eei-opas-bra/godata` image with the tag
`2026.10.0`.

#### Without access to ghcr.io

If the server cannot download the image from `ghcr.io`, download the image file from the release page and load it.
The file can also be downloaded on another machine and copied to the `versions/` folder of the installation,
together with the `.sha256` file. In that case, skip the two `curl` lines.

```bash
cd "$GODATA_DIR/versions"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_VERSION/godata-image-$GODATA_VERSION.tar.gz"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_VERSION/godata-image-$GODATA_VERSION.tar.gz.sha256"
sha256sum -c "godata-image-$GODATA_VERSION.tar.gz.sha256"
docker load -i "godata-image-$GODATA_VERSION.tar.gz"
cd "$GODATA_DIR"
docker compose pull mongo
```

Expected result: `godata-image-2026.10.0.tar.gz: OK`, `Loaded image: ghcr.io/eei-opas-bra/godata:2026.10.0` and the
`mongo` image downloaded.

### B8. Configure

In the same terminal, follow steps 2.2 (public address, time zone and dates) and 3.2 (mail server) of the
[configuration manual](configuration.md). They use the image of step B7. The MongoDB connection comes from `.env` and
needs no configuration. The other steps of the configuration manual are optional and can be done later.

### B9. Start

At the first start, MongoDB creates the users and the Go.Data container runs `init-database` on the empty database,
which takes a few minutes. The command waits until both services are healthy.

```bash
cd "$GODATA_DIR"
docker compose up -d --wait --wait-timeout 900
docker compose ps
docker compose logs godata | grep godata-entrypoint
```

Expected result: both containers as `Healthy` and, in the log, the lines `database is empty`,
`running init-database`, `init-database finished`, `backup location:` with `/opt/godata/backups` and
`starting Go.Data 2026.10.0`. The
containers have the `restart: unless-stopped` policy: they come back on their own after a restart of the server.

### B10. Schedule the daily dump

Follow steps 3.2 (database dump) and 4.2 (daily schedule) of the [backup manual](backup.md), in the same terminal.
The script is `/opt/godata/deploy/scripts/godata-backup.sh`. Then follow step 5 of the same manual to copy the backups
outside the server.

## First access

Open `http://<server address>:3000` in the browser (replace `3000` with the value of `GODATA_PORT`). Until the
section **HTTPS with nginx**, the access is not encrypted: if the network to the server is not trusted, do the HTTPS
section first, or open the system through an SSH tunnel, with `ssh -L 3000:127.0.0.1:3000 user@server` and the
address `http://localhost:3000`.

1. The login screen shows the version `2.51.0 - build 2026.10.0`.
2. Log in with the email `admin@who.int` and the password `admin`.
3. The system asks for a new password. Enter the current password (`admin`) and a new, strong password used only by
   this user.
4. The system then offers to register the security questions, used to recover the password without email. Register
   them.
5. To use the system in Portuguese, open the user menu and choose the language **Português**.

Then create named users for the teams. Do not share the `admin@who.int` user.

## HTTPS with nginx

nginx receives the HTTPS connections (port 443) and passes them to Go.Data, which from then on listens only on the
server itself. The firewall (`ufw`) leaves open only the ports for SSH (22), HTTP (80, which redirects to HTTPS) and
HTTPS (443). The public address of step 2 of the [configuration manual](configuration.md) must be the same name the
certificate covers, with `"protocol": "https"`.

In every block of this section, replace `godata.exemplo.gov.br` with the DNS name of the system. If `GODATA_PORT` is
not `3000`, also replace `127.0.0.1:3000` with the port of the installation.

### H1. Install nginx

```bash
sudo apt-get update
sudo apt-get install -y nginx
sudo rm -f /etc/nginx/sites-enabled/default
systemctl is-active nginx
```

Expected result: `active`.

### H2. Keep Go.Data on the local address only

#### H2.1. On pm2

By default, the API listens on every address of the server (`0.0.0.0`). The block keeps it on `127.0.0.1` only, where
nginx reaches it, and applies the configuration.

```bash
node -e '
const fs = require("fs");
const file = process.argv[1];
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
Object.assign(data, JSON.parse(fs.readFileSync(0, "utf8")));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
' "$GODATA_DIR/config/config.json" <<'EOF'
{
  "host": "127.0.0.1"
}
EOF
node "$GODATA_DIR/atual/deploy/lib/merge-config.js" --defaults "$GODATA_DIR/atual/deploy/defaults" --overrides "$GODATA_DIR/config" --server-dir "$GODATA_DIR/atual/server"
pm2 restart "$GODATA_PM2"
timeout 300 sh -c "until curl -fsS http://127.0.0.1:$GODATA_PORT/status 2> /dev/null; do sleep 5; done"
echo
```

Expected result: the process restarted and the `{"started":...}` line of Go.Data.

#### H2.2. On Docker

Docker opens the published ports outside `ufw`: the firewall does not close them. So the Go.Data port is published on
`127.0.0.1` only from now on (`GODATA_BIND` in `.env`).

```bash
cd "$GODATA_DIR"
sed -i 's/^GODATA_BIND=.*/GODATA_BIND=127.0.0.1/' .env
docker compose up -d --wait --wait-timeout 900
docker compose port godata 3000
```

Expected result: the `godata` container recreated, `Healthy`, and the line `127.0.0.1:3000`.

### H3. nginx site with a Let's Encrypt certificate

Use this step when the system name is public and the server receives connections from the internet on port 80.
certbot obtains the certificate, sets up HTTPS on the site and renews the certificate on its own. If the institution
provides the certificate, go to step H4. Also replace `ti@exemplo.gov.br` with the email that receives the
certificate notices.

```bash
sudo tee /etc/nginx/sites-available/godata > /dev/null <<'EOF'
server {
    listen 80;
    server_name godata.exemplo.gov.br;
    client_max_body_size 4096m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
sudo ln -sfn /etc/nginx/sites-available/godata /etc/nginx/sites-enabled/godata
sudo nginx -t
sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d godata.exemplo.gov.br --non-interactive --agree-tos -m ti@exemplo.gov.br --redirect
```

Expected result: `syntax is ok` and `test is successful` from `nginx -t` and, at the end, `Successfully deployed
certificate` and `Congratulations! You have successfully enabled HTTPS`. The `client_max_body_size` of 4096 MB
follows the Go.Data import limit (`jobSettings.importResources.maxFileSize`).

### H4. nginx site with the institution's certificate

Use this step when the institution provides the certificate. There are two files in PEM format: the certificate, with
the full chain (the server certificate followed by the intermediates), and the private key. Copy them to the server
and replace `/caminho/do/certificado.crt` and `/caminho/da/chave.key` with their paths.

```bash
sudo install -m 644 /caminho/do/certificado.crt /etc/ssl/certs/godata.crt
sudo install -m 600 /caminho/da/chave.key /etc/ssl/private/godata.key
sudo tee /etc/nginx/sites-available/godata > /dev/null <<'EOF'
server {
    listen 80;
    server_name godata.exemplo.gov.br;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name godata.exemplo.gov.br;
    ssl_certificate /etc/ssl/certs/godata.crt;
    ssl_certificate_key /etc/ssl/private/godata.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 4096m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
sudo ln -sfn /etc/nginx/sites-available/godata /etc/nginx/sites-enabled/godata
sudo nginx -t
sudo systemctl reload nginx
```

Expected result: `syntax is ok` and `test is successful`. When the certificate expires, copy the new files to the
same paths and run `sudo systemctl reload nginx`. The `client_max_body_size` of 4096 MB follows the Go.Data import
limit (`jobSettings.importResources.maxFileSize`).

### H5. Firewall

If the server's SSH uses another port, replace `22` before running the block: with the wrong port, the SSH session
drops and does not come back.

```bash
sudo apt-get install -y ufw
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

Expected result: `Status: active` and the ports 22, 80 and 443 as `ALLOW`. Open `https://godata.exemplo.gov.br` in the
browser: the login screen appears, with the secure connection padlock.

## Hardening an existing MongoDB

This section is for a path A server whose MongoDB accepts connections without a user and a password, as in older
installations. It creates an administrator and the Go.Data user, moves the Go.Data connection to the user, turns
authentication on and keeps MongoDB on the local address only. Do it outside an upgrade window, with a recent dump
(step 3.1 of the [backup manual](backup.md)). Go.Data is down for a few seconds, when MongoDB restarts in step E4.

Before starting, check whether other systems use the same MongoDB. With authentication on, they can no longer
connect until they have their own users and passwords: create those users and adjust those systems before step E4.

### E1. Set the variables and check MongoDB

Adjust the values to the installation, as in step A1, and run them in the same terminal you will use for the next
steps.

```bash
export GODATA_DIR=/opt/godata
export GODATA_PORT=3000
export GODATA_PM2=godata
mongod --version | head -n 1
mongosh --quiet --eval 'const p = db.adminCommand({ getCmdLineOpts: 1 }).parsed; printjson({ net: p.net, security: p.security }); print("users: " + db.getSiblingDB("admin").getUsers().users.length)'
node -p 'require(process.argv[1]).mongoDb' "$GODATA_DIR/config/datasources.json"
```

Expected result: the MongoDB version, the network settings (`bindIp`), an empty `security` (`undefined`) and
`users: 0`, and the current Go.Data connection, without `user` or `password`. If `security` shows
`authorization: 'enabled'`, authentication is already on and this section does not apply. If `users` is not `0`,
users already exist: check with whoever administers MongoDB before going on.

### E2. Create the users

The first block generates the password of the MongoDB administrator, when its file does not exist yet
(`/root/mongodb-admin.txt`, which only `root` can read), and adds to the Go.Data connection, in
`config/datasources.json`, the user `godata` with a generated password. The rest of the file, such as the mail
server, does not change.

```bash
sudo sh -c 'umask 077 && test -s /root/mongodb-admin.txt || openssl rand -hex 24 > /root/mongodb-admin.txt'
node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
data.mongoDb = Object.assign({}, data.mongoDb, { user: "godata", password: require("crypto").randomBytes(24).toString("hex"), authSource: "admin" });
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
' "$GODATA_DIR/config/datasources.json"
chmod 600 "$GODATA_DIR/config/datasources.json"
```

Expected result: no output.

The second block creates the administrator (`admin`, `root` role) and the Go.Data user (`godata`, `readWrite` and
`dbAdmin` roles on the Go.Data database only), reading the passwords from the files.

```bash
sudo GODATA_DATASOURCES="$GODATA_DIR/config/datasources.json" mongosh --quiet --nodb --eval '
const fs = require("fs");
const adminPassword = fs.readFileSync("/root/mongodb-admin.txt", "utf8").trim();
const app = JSON.parse(fs.readFileSync(process.env.GODATA_DATASOURCES, "utf8")).mongoDb;
const admin = new Mongo("mongodb://127.0.0.1:" + (app.port || 27017)).getDB("admin");
admin.createUser({ user: "admin", pwd: adminPassword, roles: ["root"] });
admin.createUser({ user: app.user, pwd: app.password, roles: [{ role: "readWrite", db: app.database }, { role: "dbAdmin", db: app.database }] });
print("users: " + admin.getUsers().users.map(u => u.user).join(", "));
'
```

Expected result: `users: admin, godata`.

### E3. Move Go.Data to the user

MongoDB still accepts connections without a password, so Go.Data keeps working while it starts logging in with the
`godata` user.

```bash
node "$GODATA_DIR/atual/deploy/lib/merge-config.js" --defaults "$GODATA_DIR/atual/deploy/defaults" --overrides "$GODATA_DIR/config" --server-dir "$GODATA_DIR/atual/server"
pm2 restart "$GODATA_PM2"
timeout 300 sh -c "until curl -fsS http://127.0.0.1:$GODATA_PORT/status 2> /dev/null; do sleep 5; done"
echo
```

Expected result: the process restarted and the `{"started":...}` line of Go.Data.

### E4. Turn authentication on

The block keeps a copy of the current MongoDB configuration in `/etc/mongod.conf.antes-da-autenticacao`, keeps MongoDB
on `127.0.0.1` only, turns authentication on and restarts MongoDB and Go.Data. If the file already has a `security`
section or uses `bindIpAll`, the block stops without changing anything: in that case, edit the file with whoever
administers MongoDB.

```bash
if sudo grep -qE '^security:|bindIpAll' /etc/mongod.conf; then
  echo "stop: /etc/mongod.conf has a security section or bindIpAll, edit it by hand" >&2
  false
else
  sudo cp -a /etc/mongod.conf /etc/mongod.conf.antes-da-autenticacao
  sudo sed -i 's/^\([[:space:]]*bindIp:\).*/\1 127.0.0.1/' /etc/mongod.conf
  printf 'security:\n  authorization: enabled\n' | sudo tee -a /etc/mongod.conf > /dev/null
  sudo systemctl restart mongod
  timeout 120 sh -c 'until mongosh --quiet --eval "db.adminCommand({ ping: 1 })" > /dev/null 2>&1; do sleep 2; done'
  pm2 restart "$GODATA_PM2"
fi
```

Expected result: the Go.Data process restarted, with no error.

The last block checks: without a user, MongoDB refuses to list the databases; with the `godata` user, Go.Data
answers.

```bash
mongosh --quiet --eval 'db.adminCommand({ listDatabases: 1 })' || true
sudo ss -ltn 'sport = :27017'
timeout 300 sh -c "until curl -fsS http://127.0.0.1:$GODATA_PORT/status 2> /dev/null; do sleep 5; done"
echo
pm2 logs "$GODATA_PM2" --lines 20 --nostream
```

Expected result: an error `MongoServerError: Command listDatabases requires authentication`, MongoDB listening only
on `127.0.0.1:27017`, the `{"started":...}` line of Go.Data and a log with no connection errors. If something fails,
the previous MongoDB configuration is in `/etc/mongod.conf.antes-da-autenticacao`.

## Final check

### F1. On pm2

```bash
pm2 list
systemctl is-enabled "pm2-$USER"
curl -fsS "http://127.0.0.1:$GODATA_PORT/api/system-settings/version" -H "api-key: $(node -p 'require(process.argv[1]).apiKey' "$GODATA_DIR/atual/client/dist/assets/runtime-config.json")" | cut -c 1-80
ps -o user=,args= -C node
sudo ss -ltn 'sport = :27017'
crontab -l
```

Expected result:

- The `godata` process as `online` and the pm2 service as `enabled`.
- A line that starts with `{"platform":"-","version":"2.51.0","build":"2026.10.0"`.
- The `node` processes with your user, never with `root`.
- MongoDB listening only on `127.0.0.1:27017`.
- The daily dump line in the crontab.

### F2. On Docker

```bash
cd "$GODATA_DIR"
docker compose ps
curl -fsS "http://127.0.0.1:$GODATA_PORT/api/system-settings/version" -H "api-key: $(curl -fsS "http://127.0.0.1:$GODATA_PORT/assets/runtime-config.json" | sed -n 's/.*"apiKey": *"\([^"]*\)".*/\1/p')" | cut -c 1-80
ps -o uid=,args= -C node
docker compose port mongo 27017 || true
crontab -l
```

Expected result:

- The `mongo` and `godata` containers as `Up` and `(healthy)`.
- A line that starts with `{"platform":"-","version":"2.51.0","build":"2026.10.0"`.
- The `node` processes of the `godata` container with UID `1000` (the `node` user of the container), never with UID
  `0` (`root`).
- No published port for MongoDB: the last command before the crontab prints an error or nothing.
- The daily dump line in the crontab.

Also check in the browser the login, the version on the login screen and, in **System > Backups**, the backup
**Location** (`/opt/godata/backups` on both paths).
