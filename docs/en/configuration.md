# Go.Data configuration manual

[Português](../pt-BR/configuracao.md) · [Installation](installation.md) · [Upgrade](upgrade.md) · [Backup](backup.md)

## Disclaimer

- This distribution is a fork of Go.Data as published by WHO. It is not a WHO release and WHO does not endorse it.
- The software is provided as is, without warranty, under the GPL-3.0 license.
- A backup is mandatory. Migrations change the database and cannot be undone automatically.
- Whenever possible, upgrade a test copy first and plan a maintenance window.
- The operator of each installation is responsible for its data, access control and compliance with data protection
  law.
- Report problems in the issues of the API repository.

## How the configuration works

Go.Data reads two files from the `server/` folder: `config.json`, with the application options, and
`datasources.json`, with the MongoDB connection and the mail server. Each version ships the default values of both
files.

The values specific to the installation live in the `config/` folder of the installation, in two files with the same
names. They hold only the keys that change, and upgrades do not touch them. The configuration in use is the defaults
of the version merged with these files:

- On pm2, the command of step 4 writes `server/config.json` and `server/datasources.json`, and pm2 restarts the
  system.
- On Docker, the container merges them at every start. Restarting it is enough.

Rules:

- Keep the JSON syntax valid: double quotes, a comma between items and no comma after the last one. An error stops
  the configuration from being applied, and the message gives the file, the line and the column.
- Objects are merged key by key. For example, `"passwordReset": {"from": "..."}` changes only the sender and keeps the
  other keys of `passwordReset`.
- Lists replace the whole default list. In `email.transports`, write the complete mail server.
- Do not edit `server/config.json` or `server/datasources.json`. They are rewritten at every merge on pm2, at every
  start on Docker and at every upgrade.
- On an upgrade, never replace the new files with the old ones: the new version may have keys the previous one did
  not. The `config/` folder stays in force and is applied on top of the defaults of the new version.
- On Docker, the MongoDB connection comes from `.env`, and `host` and `port` are fixed (`0.0.0.0` and `3000` inside
  the container).

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

Run the steps as the user that operates Go.Data, without `sudo`. On Docker, that user must be able to run `docker`
without `sudo` (`docker` group). On a server with two installations, run the steps once for each of them, with its
own values.

## 2. Public address, time zone and dates

Replace `godata.exemplo.gov.br` with the address users open in the browser and `nao-responda@exemplo.gov.br` with the
sender of the system e-mails.

- `public` is the address that goes into the links of the e-mails, such as the password reset link. With
  `"port": ""`, the default port of the protocol applies (443 for `https`). If users reach the system on another
  port, give the number, for example `"port": 8443`.
- `"enableConfigRewrite": false` stops Go.Data from changing this address. With `true`, the WHO default, it rewrites
  `public` at every start with the internal address of the server (on Docker, the container IP) and later with the
  address of whoever opens the system in a browser. The e-mail links may then carry an address users cannot reach.
- `timezone` is the time zone of the dates. Set it before entering data: changing it later may shift dates already
  recorded.
- `dateDisplayFormat` and `dateTimeDisplayFormat` are the date and date-time formats in the user interface.
- `session.secret` gets a random value, used by the captcha (step 5).

The blocks of steps 2, 3, 5, 6 and 7 write only the keys of the step and keep the other keys of the file. They can be
run again to change a value. Each run of this step draws a new `session.secret`, which only invalidates the captchas
open at that moment.

### 2.1. On pm2

The block uses the server's `node` and creates the file readable by its owner only.

```bash
mkdir -p "$GODATA_DIR/config"
node -e '
const fs = require("fs");
const file = process.argv[1];
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
Object.assign(data, JSON.parse(fs.readFileSync(0, "utf8")));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
' "$GODATA_DIR/config/config.json" <<EOF
{
  "public": {
    "protocol": "https",
    "host": "godata.exemplo.gov.br",
    "port": ""
  },
  "enableConfigRewrite": false,
  "timezone": "America/Sao_Paulo",
  "dateDisplayFormat": "DD/MM/YYYY",
  "dateTimeDisplayFormat": "DD/MM/YYYY HH:mm",
  "passwordReset": {
    "from": "nao-responda@exemplo.gov.br"
  },
  "session": {
    "secret": "$(openssl rand -hex 32)"
  }
}
EOF
```

Expected result: no output. The change applies after step 4.

### 2.2. On Docker

The server does not need Node.js: the block runs the `node` of the Go.Data image in a temporary container, with your
user and group 1000, the group of the container's `node` user. A new file is readable only by your user and by the
container (permissions `640`, group 1000).

```bash
mkdir -p "$GODATA_DIR/config"
cd "$GODATA_DIR"
docker compose run --rm --no-deps -T -u "$(id -u):1000" -v "$GODATA_DIR/config:/config" --entrypoint node godata -e '
const fs = require("fs");
const file = process.argv[1];
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
Object.assign(data, JSON.parse(fs.readFileSync(0, "utf8")));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o640 });
' /config/config.json <<EOF
{
  "public": {
    "protocol": "https",
    "host": "godata.exemplo.gov.br",
    "port": ""
  },
  "enableConfigRewrite": false,
  "timezone": "America/Sao_Paulo",
  "dateDisplayFormat": "DD/MM/YYYY",
  "dateTimeDisplayFormat": "DD/MM/YYYY HH:mm",
  "passwordReset": {
    "from": "nao-responda@exemplo.gov.br"
  },
  "session": {
    "secret": "$(openssl rand -hex 32)"
  }
}
EOF
```

Expected result: the `docker compose` lines about the temporary container and no error. The change applies after
step 4.

## 3. Mail server

Go.Data sends over SMTP the password reset, user change and two-step verification code e-mails. Replace
`smtp.exemplo.gov.br`, `usuario-smtp` and `senha-smtp` with the details of the mail server.

- `"port": 465` with `"secure": true` uses TLS from the start of the connection. For port 587 (STARTTLS), use
  `"port": 587` and `"secure": false`.
- If the mail server does not require authentication, remove the `auth` block and the comma before it.
- `transports` is a list: it replaces the default mail server as a whole.

The block writes the `email` key into `config/datasources.json` and keeps the rest of the file. On pm2, the file also
holds the MongoDB connection, created during the installation. On Docker, it only needs the `email` key: the MongoDB
connection comes from `.env`.

### 3.1. On pm2

```bash
node -e '
const fs = require("fs");
const file = process.argv[1];
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
Object.assign(data, JSON.parse(fs.readFileSync(0, "utf8")));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
' "$GODATA_DIR/config/datasources.json" <<'EOF'
{
  "email": {
    "transports": [
      {
        "type": "SMTP",
        "host": "smtp.exemplo.gov.br",
        "port": 465,
        "secure": true,
        "auth": {
          "user": "usuario-smtp",
          "pass": "senha-smtp"
        }
      }
    ]
  }
}
EOF
```

Expected result: no output. The change applies after step 4.

### 3.2. On Docker

```bash
cd "$GODATA_DIR"
docker compose run --rm --no-deps -T -u "$(id -u):1000" -v "$GODATA_DIR/config:/config" --entrypoint node godata -e '
const fs = require("fs");
const file = process.argv[1];
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
Object.assign(data, JSON.parse(fs.readFileSync(0, "utf8")));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o640 });
' /config/datasources.json <<'EOF'
{
  "email": {
    "transports": [
      {
        "type": "SMTP",
        "host": "smtp.exemplo.gov.br",
        "port": 465,
        "secure": true,
        "auth": {
          "user": "usuario-smtp",
          "pass": "senha-smtp"
        }
      }
    ]
  }
}
EOF
```

Expected result: the `docker compose` lines about the temporary container and no error. The change applies after
step 4.

## 4. Apply the configuration

### 4.1. On pm2

Run it as the pm2 user, without `sudo`: only the owner can read the generated files.

```bash
node "$GODATA_DIR/atual/deploy/lib/merge-config.js" --defaults "$GODATA_DIR/atual/deploy/defaults" --overrides "$GODATA_DIR/config" --server-dir "$GODATA_DIR/atual/server"
node -p 'require(process.argv[1]).public' "$GODATA_DIR/atual/server/config.json"
pm2 restart "$GODATA_PM2"
pm2 logs "$GODATA_PM2" --lines 50 --nostream
```

Expected result: the first command prints nothing and the second prints the public address, for example
`{ host: 'godata.exemplo.gov.br', protocol: 'https', port: '' }`. The process shows as `online` in `pm2 list` and the
log shows no errors. If a file in `config/` has a syntax error, the first command prints, for example,
`invalid JSON in /opt/godata/config/config.json at line 4 column 5` and changes nothing. Fix the file and run the
block again.

### 4.2. On Docker

```bash
cd "$GODATA_DIR"
docker compose restart godata
sleep 10
docker compose logs --since 1m godata | grep godata-entrypoint
docker compose exec -T -u node godata node -p 'require("/opt/godata/server/config.json").public'
```

Expected result: the log shows the line `configuration: server/config.json and server/datasources.json built from
the image defaults and /opt/godata/config` and the last command prints the public address. If a file in `config/`
has a syntax error, the log shows, for example, `error: configuration failed: invalid JSON in
/opt/godata/config/config.json at line 4 column 5` and the container restarts in a loop until the file is fixed. In
that message, `/opt/godata/config` is the `config/` folder of the installation as seen from inside the container. Fix
the file and run the block again.

## 5. Captcha (optional)

The captcha shows on the login page, in **Forgot password** and in the security questions. It is off by default. The
block writes the `captcha` key into `config/config.json` and turns the captcha on in all three places. To turn it on
in only some of them, change `true` to `false` in the others before running it. To turn it off, run the block with all
three set to `false`. Then apply it (step 4).

The captcha keeps the expected text in a session, signed with `session.secret`. Step 2 already writes a random value
into that key. With an empty `session.secret`, each API process draws its own secret when it starts. Since the API
runs several processes (one per processor core), a process does not recognise the session created by another one,
and the captcha is no longer checked on part of the requests.

### 5.1. On pm2

```bash
node -e '
const fs = require("fs");
const file = process.argv[1];
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
Object.assign(data, JSON.parse(fs.readFileSync(0, "utf8")));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
' "$GODATA_DIR/config/config.json" <<'EOF'
{
  "captcha": {
    "login": true,
    "forgotPassword": true,
    "resetPasswordQuestions": true
  }
}
EOF
```

Expected result: no output. Apply it as in step 4.1.

### 5.2. On Docker

```bash
cd "$GODATA_DIR"
docker compose run --rm --no-deps -T -u "$(id -u):1000" -v "$GODATA_DIR/config:/config" --entrypoint node godata -e '
const fs = require("fs");
const file = process.argv[1];
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
Object.assign(data, JSON.parse(fs.readFileSync(0, "utf8")));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o640 });
' /config/config.json <<'EOF'
{
  "captcha": {
    "login": true,
    "forgotPassword": true,
    "resetPasswordQuestions": true
  }
}
EOF
```

Expected result: the `docker compose` lines about the temporary container and no error. Apply it as in step 4.2.

## 6. API key (optional)

`apiKey` must be equal to the `apiKey` key of `client/dist/assets/runtime-config.json`. The user interface reads that
file and sends the key when it asks for the version, the time zone and the date formats. With different keys, the API
refuses the request and the user interface stays on the loading screen, without showing the login page. The file is
public: any browser can read it, so the key protects nothing. It also goes into the configuration QR code of the mobile app, which is not used in Brazil.

Both files ship with the default value `your_api_key_here`, which can be kept. To change the key, the first block
writes a random value into `config/config.json`. The value itself does not matter: it only has to be the same in both
files, and the second block takes care of that.

### 6.1. On pm2

```bash
node -e '
const fs = require("fs");
const file = process.argv[1];
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
Object.assign(data, JSON.parse(fs.readFileSync(0, "utf8")));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
' "$GODATA_DIR/config/config.json" <<EOF
{
  "apiKey": "$(openssl rand -hex 16)"
}
EOF
```

Expected result: no output.

The merge command also gets `--runtime-config`, which writes the same key into
`atual/client/dist/assets/runtime-config.json`. Every upgrade brings a new `runtime-config.json`, with the default
key: after each upgrade, run only this second block again.

```bash
node "$GODATA_DIR/atual/deploy/lib/merge-config.js" --defaults "$GODATA_DIR/atual/deploy/defaults" --overrides "$GODATA_DIR/config" --server-dir "$GODATA_DIR/atual/server" --runtime-config "$GODATA_DIR/atual/client/dist/assets/runtime-config.json"
pm2 restart "$GODATA_PM2"
```

Expected result: `runtime config: changed` the first time and `runtime config: unchanged` after that. After reloading
the page in the browser, the login page shows the system version.

### 6.2. On Docker

```bash
cd "$GODATA_DIR"
docker compose run --rm --no-deps -T -u "$(id -u):1000" -v "$GODATA_DIR/config:/config" --entrypoint node godata -e '
const fs = require("fs");
const file = process.argv[1];
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
Object.assign(data, JSON.parse(fs.readFileSync(0, "utf8")));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o640 });
' /config/config.json <<EOF
{
  "apiKey": "$(openssl rand -hex 16)"
}
EOF
```

Expected result: the `docker compose` lines about the temporary container and no error.

The container copies the key into `runtime-config.json` at every start, upgrades included. Restarting it is enough:

```bash
cd "$GODATA_DIR"
docker compose restart godata
sleep 10
docker compose logs --since 1m godata | grep godata-entrypoint
```

Expected result: the log shows `runtime config: changed` the first time and `runtime config: unchanged` on later
starts. After reloading the page in the browser, the login page shows the system version.

## 7. Allowed origins (optional)

With `cors.enabled` set to `false`, the default, the API accepts browser calls from any site. With `true`, it accepts
only calls from the public address (`public`, step 2), from the origins listed in `whitelist`, and calls without an
origin, made by other servers. The public address must be right: with `true` and a wrong `public`, the user interface
itself stops working.

The block writes the `cors` key into `config/config.json`. To accept other origins, write them in the list before
running it, each with the protocol and without a trailing slash, for example
`"whitelist": ["https://painel.exemplo.gov.br"]`. The list replaces the default one as a whole. To turn it off, run
the block with `"enabled": false`. Then apply it (step 4).

### 7.1. On pm2

```bash
node -e '
const fs = require("fs");
const file = process.argv[1];
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
Object.assign(data, JSON.parse(fs.readFileSync(0, "utf8")));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
' "$GODATA_DIR/config/config.json" <<'EOF'
{
  "cors": {
    "enabled": true,
    "whitelist": []
  }
}
EOF
```

Expected result: no output. Apply it as in step 4.1.

### 7.2. On Docker

```bash
cd "$GODATA_DIR"
docker compose run --rm --no-deps -T -u "$(id -u):1000" -v "$GODATA_DIR/config:/config" --entrypoint node godata -e '
const fs = require("fs");
const file = process.argv[1];
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
Object.assign(data, JSON.parse(fs.readFileSync(0, "utf8")));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o640 });
' /config/config.json <<'EOF'
{
  "cors": {
    "enabled": true,
    "whitelist": []
  }
}
EOF
```

Expected result: the `docker compose` lines about the temporary container and no error. Apply it as in step 4.2.

## MongoDB connection

On pm2, the connection lives in the `mongoDb` key of `config/datasources.json`, created during the installation:

| Key | Value |
| --- | --- |
| `host`, `port` | MongoDB server and port, for example `127.0.0.1` and `27017` |
| `database` | Database name, for example `go-data` |
| `user`, `password` | Go.Data user and password in MongoDB |
| `authSource` | Database where the user was created, usually `admin` |

The password may contain any character: the command of step 4 builds the connection address (`mongoDb.url`) with the
special characters encoded. Do not fill in `mongoDb.url` by hand.

On Docker, the connection comes from `.env`:

| Variable | What it does |
| --- | --- |
| `GODATA_VERSION` | Image version, without the leading `v` (for example `2026.10.0`) |
| `GODATA_BIND` | Address the port listens on (default `0.0.0.0`) |
| `GODATA_PORT` | Server port that leads to Go.Data (default `3000`) |
| `GODATA_DB` | Database name (default `go-data`) |
| `MONGO_ROOT_PASSWORD`, `GODATA_MONGO_PASSWORD` | Passwords of the MongoDB `root` and `godata` users, generated during the installation |

- Changes to `.env` apply with `docker compose up -d`. `docker compose restart` does not read `.env` again.
- After the first start, do not change `GODATA_DB` or the passwords. MongoDB creates the users only once, with an
  empty `data/mongo` folder, and Go.Data would no longer connect.
- Do not set variables with these names in the terminal: `docker compose` uses the terminal value instead of `.env`.

## config.json keys

| Key | What it does |
| --- | --- |
| `host`, `port` | Address and port the API listens on (default `0.0.0.0` and `3000`). On pm2, use one port per instance on the server. On Docker, they are fixed: use `GODATA_BIND` and `GODATA_PORT` in `.env` |
| `public.protocol`, `public.host`, `public.port` | Address users open, used in the links of the e-mails. See step 2 |
| `enableConfigRewrite` | With `true` (default), Go.Data rewrites `public` by itself. Use `false` with `public` filled in |
| `timezone` | Time zone, for example `America/Sao_Paulo` |
| `dateDisplayFormat`, `dateTimeDisplayFormat` | Date and date-time formats, for example `DD/MM/YYYY` and `DD/MM/YYYY HH:mm` |
| `passwordReset.from` | Sender of the system e-mails |
| `apiKey` | Optional. Must be equal to the key in `client/dist/assets/runtime-config.json`. See step 6 |
| `captcha` | Captcha on login, in **Forgot password** and in the security questions. See step 5 |
| `cors` | Origins from which a browser may call the API. See step 7 |
| `session.secret` | Secret of the captcha session. When empty, each API process draws a value when it starts. See step 5 |
| `backUp.password` | Password that encrypts the system backups. When empty, backups are not encrypted. An encrypted backup can only be restored by an installation with the same password |

## datasources.json keys

| Key | What it does |
| --- | --- |
| `mongoDb` | MongoDB connection: `host`, `port`, `database`, `user`, `password`, `authSource`. On Docker, it comes from `.env` |
| `email.transports` | SMTP server: `host`, `port`, `secure`, `auth.user`, `auth.pass`. See step 3 |
