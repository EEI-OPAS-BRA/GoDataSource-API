# Manual de instalação do Go.Data

[English](../en/installation.md) · [Configuração](configuracao.md) · [Backup](backup.md) · [Atualização](atualizacao.md)

## Aviso

- Esta distribuição é uma derivação (fork) do Go.Data publicado pela OMS. Não é uma versão da OMS e não tem o seu
  endosso.
- O software é fornecido no estado em que se encontra, sem garantias, sob a licença GPL-3.0.
- O backup é obrigatório. As migrações alteram o banco de dados e não têm desfazer automático.
- Sempre que possível, atualize primeiro uma cópia de teste e reserve uma janela de manutenção.
- Quem opera cada instalação é responsável pelos seus dados, pelo controle de acesso e pelo cumprimento da legislação
  de proteção de dados.
- Problemas devem ser relatados nas issues do repositório da API.

## O que você vai precisar

- Um servidor dedicado (máquina virtual ou física) de 64 bits (amd64), com acesso à internet durante a instalação.
- Ubuntu Server 22.04 LTS ou 24.04 LTS, conforme o caminho:

| Caminho | Ubuntu 22.04 | Ubuntu 24.04 |
| --- | --- | --- |
| A, pm2 (o MongoDB e o Go.Data instalados no servidor) | Sim | Não: o MongoDB 7.0 não tem pacotes para o 24.04 |
| B, Docker (o MongoDB e o Go.Data em contêineres) | Sim | Sim |

- Um processador com as instruções AVX, exigidas pelo MongoDB 7.0. Numa máquina virtual, o tipo de processador
  precisa repassar as instruções do processador físico (por exemplo, o tipo `host`). Sem AVX, o MongoDB não inicia e
  a instalação não pode seguir: peça à equipe de infraestrutura que ajuste o tipo de processador da máquina virtual
  ou que forneça outro servidor.
- Pelo menos 4 GB de memória e 20 GB livres em disco, além do espaço dos dados, dos dumps e dos backups.
- Um usuário do Ubuntu que não seja o `root` e que possa usar o `sudo`. Todos os passos são executados com esse
  usuário.
- Um endereço (nome no DNS) pelo qual os usuários vão abrir o sistema, para o HTTPS.

Para conferir o processador antes de escolher o servidor:

```bash
grep -m1 -wo avx /proc/cpuinfo
```

Resultado esperado: `avx`. Se nada aparecer, o processador não tem AVX.

O caminho A segue o modelo das instalações atuais com pm2. O caminho B não exige instalar o MongoDB nem o Node.js no
servidor, e a atualização se resume a trocar a versão da imagem. Faça só um dos dois caminhos e depois siga as seções
**Primeiro acesso**, **HTTPS com nginx** e **Conferência final**.

## Caminho A: pm2

### A1. Defina as variáveis

Ajuste os valores à sua instalação e execute no mesmo terminal em que fará todos os passos. Se o terminal for
fechado, execute este bloco de novo.

```bash
export GODATA_VERSION=2026.10.0
export GODATA_DIR=/opt/godata
export GODATA_DB=go-data
export GODATA_PORT=3000
export GODATA_PM2=godata
```

Resultado esperado: nenhuma saída.

- `GODATA_VERSION`: versão a instalar, sem o `v` inicial, conforme a página de versões do repositório da API.
- `GODATA_DIR`: pasta da instalação. Ela ainda não existe ou está vazia.
- `GODATA_DB`: nome do banco no MongoDB.
- `GODATA_PORT`: porta em que o Go.Data atende no servidor.
- `GODATA_PM2`: nome do processo no pm2.

Num servidor com duas instalações (por exemplo, produção e teste), a segunda usa outros valores, por exemplo
`/opt/godata-teste`, `go-data-teste`, `3001` e `godata-teste`. Ela usa o mesmo MongoDB e o mesmo Node.js: pule os
passos A4 e A6 e, no primeiro bloco do passo A5, troque o usuário `godata` por outro nome, por exemplo
`godata-teste`.

### A2. Confira o servidor

O bloco confere o processador, a versão do Ubuntu e a pasta da instalação. Ele não altera nada no servidor.

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

Resultado esperado: `avx` e uma linha que começa com `ok:`. Se aparecer uma linha que começa com `stop:`, não siga
adiante. Sem AVX, veja **O que você vai precisar**. Com outra versão do Ubuntu, use o caminho B. Se a pasta já existe e
não está vazia, escolha outra pasta em `GODATA_DIR` (passo A1) ou confira o que há nela: este manual não instala sobre
uma instalação existente.

### A3. Crie a pasta da instalação

```bash
sudo install -d -o "$USER" -g "$USER" -m 750 "$GODATA_DIR"
mkdir -p "$GODATA_DIR/versions" "$GODATA_DIR/storage/files" "$GODATA_DIR/storage/icons" "$GODATA_DIR/backups" "$GODATA_DIR/dumps"
install -d -m 700 "$GODATA_DIR/config"
ls -l "$GODATA_DIR"
```

Resultado esperado: as pastas `backups`, `config`, `dumps`, `storage` e `versions`, do seu usuário.

| Pasta | Conteúdo |
| --- | --- |
| `versions/` | Os pacotes baixados e uma pasta por versão instalada |
| `atual` | Atalho para a pasta da versão em uso, criado no passo A7 |
| `config/` | Os valores próprios da instalação (veja o [manual de configuração](configuracao.md)) |
| `storage/` | Anexos e ícones, usados por todas as versões |
| `backups/` | Backups do sistema |
| `dumps/` | Dumps do banco feitos pelo script de backup |

### A4. Instale o MongoDB 7.0

O MongoDB vem do repositório oficial da MongoDB, na série 7.0. O último comando do primeiro bloco impede que o `apt`
troque a versão do MongoDB numa atualização do Ubuntu.

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

Resultado esperado: os pacotes instalados, as linhas `mongodb-org set on hold.` e semelhantes, e
`db version v7.0.` seguido do número da versão.

O bloco seguinte grava a configuração do MongoDB: ele atende só no próprio servidor (`127.0.0.1`) e exige usuário e
senha. Em seguida, liga o MongoDB e o deixa ligado nos próximos inícios do servidor.

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

Resultado esperado: `active`. Se o comando terminar sem essa linha, veja o motivo em
`sudo tail -n 50 /var/log/mongodb/mongod.log`.

### A5. Crie os usuários do MongoDB

São dois usuários, ambos no banco `admin` do MongoDB:

- `admin`, o administrador do MongoDB, com o papel `root`. A senha fica no arquivo `/root/mongodb-admin.txt`, que só
  o `root` lê. Guarde também uma cópia no cofre de senhas da instituição.
- `godata`, usado pelo Go.Data, com os papéis `readWrite` e `dbAdmin` só no banco do Go.Data. A senha fica em
  `config/datasources.json`, que só o seu usuário lê.

As senhas são sorteadas pelo `openssl` e não aparecem na tela nem nos comandos. O primeiro bloco sorteia a senha do
administrador, se o arquivo dela ainda não existe, e cria `config/datasources.json` com a conexão do Go.Data.

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

Resultado esperado: nenhuma saída.

O segundo bloco cria os dois usuários, lendo as senhas dos arquivos. Enquanto o MongoDB não tem nenhum usuário, ele
aceita criar o primeiro a partir do próprio servidor: o bloco cria o administrador, se ele ainda não existe, entra com
ele e cria o usuário do Go.Data.

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

Resultado esperado: `users: admin, godata`.

O terceiro bloco confere o usuário do Go.Data: ele entra no banco do Go.Data e não consegue ler o banco `admin`.

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

Resultado esperado: `go-data: 0 collections` e `admin: Unauthorized`.

### A6. Instale o Node.js 22 e o pm2

O Node.js é instalado pelo nvm, na pasta do seu usuário. O nvm também é carregado nos próximos terminais.

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

Resultado esperado: a versão do Node.js, que começa com `v22.`, e a versão do pm2, que começa com `7.`.

### A7. Baixe e instale o pacote

O pacote da versão tem a API e a interface já compilada. O primeiro bloco baixa o pacote e confere a soma de
verificação.

```bash
cd "$GODATA_DIR/versions"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_VERSION/godata-$GODATA_VERSION.tar.gz"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_VERSION/godata-$GODATA_VERSION.tar.gz.sha256"
sha256sum -c "godata-$GODATA_VERSION.tar.gz.sha256"
```

Resultado esperado: `godata-2026.10.0.tar.gz: OK`. Se aparecer `FAILED`, o arquivo está corrompido: apague os dois
arquivos e baixe de novo.

O segundo bloco extrai o pacote em `versions/`, instala as dependências, liga `server/storage` à pasta `storage/` da
instalação e aponta `atual` para a nova versão.

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

Resultado esperado: o `npm ci` termina sem erro (avisos `npm warn` podem aparecer) e as duas últimas linhas mostram
`atual -> versions/2026.10.0` e `storage -> /opt/godata/storage`.

### A8. Configure

O bloco grava a porta em `config/config.json`.

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

Resultado esperado: nenhuma saída.

Em seguida, no mesmo terminal, faça os passos 2.1 (endereço público, fuso horário e datas) e 3.1 (servidor de
e-mail) do [manual de configuração](configuracao.md). A conexão com o MongoDB já está em `config/datasources.json`
(passo A5). Os outros passos do manual de configuração são opcionais e podem ser feitos depois.

### A9. Aplique a configuração

```bash
node "$GODATA_DIR/atual/deploy/lib/merge-config.js" --defaults "$GODATA_DIR/atual/deploy/defaults" --overrides "$GODATA_DIR/config" --server-dir "$GODATA_DIR/atual/server"
node -p 'const c = require(process.argv[1]); ({ port: c.port, public: c.public })' "$GODATA_DIR/atual/server/config.json"
```

Resultado esperado: o primeiro comando não mostra nada e o segundo mostra a porta e o endereço público, por exemplo
`{ port: 3000, public: { host: 'godata.exemplo.gov.br', protocol: 'https', port: '' } }`. Se um arquivo de
`config/` tiver erro de sintaxe, o primeiro comando indica o arquivo, a linha e a coluna.

### A10. Inicialize o banco de dados

O `init-database` cria as tabelas, o usuário administrador do Go.Data e os dados de referência. Ele apaga tudo o que
houver no banco, por isso o bloco só o executa num banco vazio.

```bash
cd "$GODATA_DIR/atual"
if [ "$(node deploy/lib/db-state.js db-empty --datasources server/datasources.json)" = yes ]; then
  npm run init-database
else
  echo "stop: the database $GODATA_DB is not empty, init-database would erase it" >&2
  false
fi
```

Resultado esperado: o comando leva alguns minutos e termina sem erro. Se aparecer
`stop: the database go-data is not empty`, o banco já tem dados: confira `GODATA_DB` (passo A1) e não continue.

### A11. Inicie com o pm2

```bash
cd "$GODATA_DIR/atual"
pm2 start npm --name "$GODATA_PM2" --time -- start
pm2 save
timeout 300 sh -c "until curl -fsS http://127.0.0.1:$GODATA_PORT/status 2> /dev/null; do sleep 5; done"
echo
pm2 list
```

Resultado esperado: uma linha como `{"started":"2026-11-18T12:00:00.000Z","uptime":12.3}` e o processo `godata` como
`online` em `pm2 list`. O `pm2 save` grava a lista de processos, que o pm2 restaura ao iniciar. Se a linha
`{"started":...}` não aparecer em 5 minutos, veja o motivo em `pm2 logs godata --lines 100 --nostream`.

### A12. Início automático e rotação dos logs

O comando `pm2 startup` mostra um comando para executar com `sudo`, que cria o serviço do pm2 no systemd. O primeiro
comando do bloco é esse comando. Depois de cada mudança na lista de processos do pm2, execute `pm2 save` de novo.

```bash
sudo env PATH="$PATH" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME"
pm2 install pm2-logrotate
pm2 save
systemctl is-enabled "pm2-$USER"
```

Resultado esperado: a linha `[PM2] [v] Command successfully executed.`, o módulo `pm2-logrotate` como `online` e
`enabled` na última linha. A partir daqui, o Go.Data volta sozinho depois de um reinício do servidor. O
`pm2-logrotate` gira os logs ao chegar a 10 MB e guarda os 30 últimos.

### A13. Se o processo não voltar: pm2 resurrect

Este passo não faz parte da instalação. Use-o quando `pm2 list` não mostrar o processo do Go.Data, por exemplo depois
de um `pm2 kill` ou de um erro do pm2. Ele restaura a lista gravada pelo último `pm2 save`.

```bash
pm2 resurrect
pm2 list
```

Resultado esperado: o processo `godata` como `online`. Se ele não aparecer, inicie de novo como no passo A11.

### A14. Pasta dos backups do sistema

O Go.Data grava os backups do sistema numa pasta definida no banco. A instalação deixa essa pasta dentro da pasta da
versão, que muda a cada atualização. O bloco a troca pela pasta `backups/` da instalação. Repita este passo depois de
cada atualização. A mesma configuração aparece em **Sistema > Backups > Ações rápidas > Configurações de backup
automático** (veja o [manual de backup](backup.md)).

```bash
node "$GODATA_DIR/atual/deploy/lib/db-state.js" set-backup-location "$GODATA_DIR/backups" --datasources "$GODATA_DIR/atual/server/datasources.json"
```

Resultado esperado: `changed /opt/godata/versions/2026.10.0/backups -> /opt/godata/backups`. Numa segunda execução, a
linha é `unchanged /opt/godata/backups`.

### A15. Agende o dump diário

Siga os passos 3.1 (dump do banco) e 4.1 (agendamento diário) do [manual de backup](backup.md), no mesmo terminal. O
script fica em `/opt/godata/atual/deploy/scripts/godata-backup.sh`. Depois, siga o passo 5 do mesmo manual para
copiar os backups para fora do servidor.

## Caminho B: Docker

### B1. Defina as variáveis

Ajuste os valores à sua instalação e execute no mesmo terminal em que fará todos os passos. Se o terminal for
fechado, execute este bloco de novo.

```bash
export GODATA_VERSION=2026.10.0
export GODATA_DIR=/opt/godata
export GODATA_DB=go-data
export GODATA_PORT=3000
```

Resultado esperado: nenhuma saída.

- `GODATA_VERSION`: versão a instalar, sem o `v` inicial, conforme a página de versões do repositório da API.
- `GODATA_DIR`: pasta da instalação. Ela ainda não existe ou está vazia.
- `GODATA_DB`: nome do banco no MongoDB.
- `GODATA_PORT`: porta em que o Go.Data atende no servidor.

Os três últimos valores vão para o arquivo `.env` no passo B6, que passa a valer daí em diante. Depois da instalação,
não exporte essas variáveis num terminal novo: o `docker compose` usa o valor do terminal no lugar do `.env` (veja o
[manual de configuração](configuracao.md)). Num servidor com duas instalações, a segunda usa outra pasta e outra
porta, por exemplo `/opt/godata-teste` e `3001`, e tem o seu próprio MongoDB.

### B2. Confira o servidor

O bloco confere o processador, a versão do Ubuntu e a pasta da instalação. Ele não altera nada no servidor.

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

Resultado esperado: `avx` e uma linha que começa com `ok:`. Se aparecer uma linha que começa com `stop:`, não siga
adiante. Sem AVX, veja **O que você vai precisar**. Se a pasta já existe e não está vazia, escolha outra pasta em
`GODATA_DIR` (passo B1) ou confira o que há nela: este manual não instala sobre uma instalação existente.

### B3. Instale o Docker

O Docker Engine e o plugin Compose vêm do repositório oficial do Docker. Se o servidor já tem o Docker instalado pelo
repositório oficial, pule o primeiro bloco.

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

Resultado esperado: a versão do Docker e a linha `Docker Compose version` seguida da versão do plugin Compose.

Os outros passos usam o `docker` sem `sudo`. O bloco seguinte põe o seu usuário no grupo `docker`.

```bash
sudo usermod -aG docker "$USER"
```

Resultado esperado: nenhuma saída. O grupo só vale numa sessão nova: saia do servidor, entre de novo e execute outra
vez o bloco do passo B1. O grupo `docker` dá ao usuário o mesmo poder do `root` sobre o servidor: inclua nele só quem
administra o Go.Data.

### B4. Crie a pasta da instalação

```bash
docker info --format '{{.ServerVersion}}'
sudo install -d -o "$USER" -g "$USER" -m 750 "$GODATA_DIR"
mkdir -p "$GODATA_DIR/versions" "$GODATA_DIR/config" "$GODATA_DIR/data/mongo" "$GODATA_DIR/data/storage" "$GODATA_DIR/data/backups" "$GODATA_DIR/data/state" "$GODATA_DIR/dumps"
ls -l "$GODATA_DIR"
```

Resultado esperado: a versão do Docker, sem erro de permissão, e as pastas `config`, `data`, `dumps` e `versions`. Se
o primeiro comando mostrar `permission denied`, a sessão ainda não tem o grupo `docker`: veja o fim do passo B3.

| Pasta ou arquivo | Conteúdo |
| --- | --- |
| `docker-compose.yml` | Os serviços `mongo` e `godata`, copiados do pacote no passo B5 |
| `.env` | Versão, porta, banco e senhas do MongoDB, criado no passo B6 |
| `config/` | Os valores próprios da instalação (veja o [manual de configuração](configuracao.md)) |
| `data/mongo/` | Os arquivos do MongoDB |
| `data/storage/` | Anexos e ícones |
| `data/backups/` | Backups do sistema |
| `data/state/` | Estado do contêiner do Go.Data entre um início e outro |
| `dumps/` | Dumps do banco feitos pelo script de backup |
| `mongo-init/` | Script que cria o usuário do Go.Data no MongoDB, no primeiro início |
| `deploy/scripts/` | O script de backup |
| `versions/` | Os pacotes baixados |

### B5. Baixe o pacote e copie os arquivos do Docker

O pacote da versão traz o `docker-compose.yml`, o modelo do `.env`, o script de criação do usuário do MongoDB e o
script de backup. O bloco baixa o pacote, confere a soma de verificação e copia esses arquivos para a pasta da
instalação.

```bash
cd "$GODATA_DIR/versions"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_VERSION/godata-$GODATA_VERSION.tar.gz"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_VERSION/godata-$GODATA_VERSION.tar.gz.sha256"
sha256sum -c "godata-$GODATA_VERSION.tar.gz.sha256"
tar -xzf "godata-$GODATA_VERSION.tar.gz" -C "$GODATA_DIR" --strip-components=3 "godata-$GODATA_VERSION/deploy/docker/docker-compose.yml" "godata-$GODATA_VERSION/deploy/docker/.env.example" "godata-$GODATA_VERSION/deploy/docker/mongo-init"
tar -xzf "godata-$GODATA_VERSION.tar.gz" -C "$GODATA_DIR" --strip-components=1 "godata-$GODATA_VERSION/deploy/scripts/godata-backup.sh"
ls -l "$GODATA_DIR/docker-compose.yml" "$GODATA_DIR/mongo-init" "$GODATA_DIR/deploy/scripts"
```

Resultado esperado: `godata-2026.10.0.tar.gz: OK` e os arquivos `docker-compose.yml`, `mongo-init/01-godata-user.js`
e `deploy/scripts/godata-backup.sh`. Se aparecer `FAILED`, o arquivo está corrompido: apague os dois arquivos baixados
e execute o bloco de novo.

### B6. Crie o arquivo .env

O bloco cria o `.env` com as chaves de `.env.example` e duas senhas sorteadas pelo `openssl`: a do usuário `root` do
MongoDB e a do usuário `godata`, que o Go.Data usa. Só o seu usuário lê o arquivo. As senhas não aparecem na tela.

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

Resultado esperado: as quatro linhas sem senha e o arquivo com permissão `-rw-------`. O MongoDB cria os usuários com
essas senhas no primeiro início. Depois dele, não mude as senhas nem `GODATA_DB` no `.env`. O `.env` entra no pacote de
configuração que o script de backup grava junto com cada dump.

### B7. Baixe a imagem

```bash
cd "$GODATA_DIR"
docker compose pull
docker image ls ghcr.io/eei-opas-bra/godata
```

Resultado esperado: as imagens `mongo` e `godata` baixadas e a imagem `ghcr.io/eei-opas-bra/godata` com a tag
`2026.10.0`.

#### Sem acesso ao ghcr.io

Se o servidor não consegue baixar a imagem do `ghcr.io`, baixe o arquivo da imagem da página da versão e carregue-o.
O arquivo também pode ser baixado em outra máquina e copiado para a pasta `versions/` da instalação, junto com o
arquivo `.sha256`. Nesse caso, pule as duas linhas do `curl`.

```bash
cd "$GODATA_DIR/versions"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_VERSION/godata-image-$GODATA_VERSION.tar.gz"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_VERSION/godata-image-$GODATA_VERSION.tar.gz.sha256"
sha256sum -c "godata-image-$GODATA_VERSION.tar.gz.sha256"
docker load -i "godata-image-$GODATA_VERSION.tar.gz"
cd "$GODATA_DIR"
docker compose pull mongo
```

Resultado esperado: `godata-image-2026.10.0.tar.gz: OK`, `Loaded image: ghcr.io/eei-opas-bra/godata:2026.10.0` e a
imagem `mongo` baixada.

### B8. Configure

No mesmo terminal, faça os passos 2.2 (endereço público, fuso horário e datas) e 3.2 (servidor de e-mail) do
[manual de configuração](configuracao.md). Eles usam a imagem do passo B7. A conexão com o MongoDB vem do `.env` e
não precisa de configuração. Os outros passos do manual de configuração são opcionais e podem ser feitos depois.

### B9. Inicie

No primeiro início, o MongoDB cria os usuários e o contêiner do Go.Data executa o `init-database` no banco vazio, o
que leva alguns minutos. O comando espera os dois serviços ficarem saudáveis.

```bash
cd "$GODATA_DIR"
docker compose up -d --wait --wait-timeout 900
docker compose ps
docker compose logs godata | grep godata-entrypoint
```

Resultado esperado: os dois contêineres como `Healthy` e, no log, as linhas `database is empty`,
`running init-database`, `init-database finished`, `backup location:` com `/opt/godata/backups` e
`starting Go.Data 2026.10.0`. Os
contêineres têm a política `restart: unless-stopped`: voltam sozinhos depois de um reinício do servidor.

### B10. Agende o dump diário

Siga os passos 3.2 (dump do banco) e 4.2 (agendamento diário) do [manual de backup](backup.md), no mesmo terminal. O
script fica em `/opt/godata/deploy/scripts/godata-backup.sh`. Depois, siga o passo 5 do mesmo manual para copiar os
backups para fora do servidor.

## Primeiro acesso

Abra no navegador `http://<endereço do servidor>:3000` (troque `3000` pelo valor de `GODATA_PORT`). Até a seção
**HTTPS com nginx**, o acesso não é cifrado: se a rede até o servidor não for confiável, faça antes a seção HTTPS, ou
abra o sistema por um túnel SSH, com `ssh -L 3000:127.0.0.1:3000 usuario@servidor` e o endereço
`http://localhost:3000`.

1. A tela de login mostra a versão `2.51.0 - build 2026.10.0`.
2. Entre com o e-mail `admin@who.int` e a senha `admin`.
3. O sistema pede a troca da senha. Informe a senha atual (`admin`) e uma senha nova, forte e só deste usuário.
4. Em seguida, o sistema oferece cadastrar as perguntas de segurança, usadas para recuperar a senha sem e-mail.
   Cadastre-as.
5. Para usar o sistema em português, abra o menu do usuário, no canto superior direito, clique em **Language** e
   escolha **Português**.

Crie depois os usuários nominais das equipes. Não compartilhe o usuário `admin@who.int`.

## HTTPS com nginx

O nginx recebe os acessos em HTTPS (porta 443) e os repassa ao Go.Data, que passa a atender só no próprio servidor.
O firewall (`ufw`) deixa abertas só as portas do SSH (22), do HTTP (80, que redireciona para o HTTPS) e do HTTPS
(443). O endereço público do passo 2 do [manual de configuração](configuracao.md) precisa ser o mesmo nome que o
certificado cobre, com `"protocol": "https"`.

Em todos os blocos desta seção, troque `godata.exemplo.gov.br` pelo nome do sistema no DNS. Se `GODATA_PORT` não é
`3000`, troque também `127.0.0.1:3000` pela porta da instalação.

### H1. Instale o nginx

```bash
sudo apt-get update
sudo apt-get install -y nginx
sudo rm -f /etc/nginx/sites-enabled/default
systemctl is-active nginx
```

Resultado esperado: `active`.

### H2. Deixe o Go.Data só no endereço local

#### H2.1. No pm2

Por padrão, a API atende em todos os endereços do servidor (`0.0.0.0`). O bloco a deixa só em `127.0.0.1`, de onde o
nginx a acessa, e aplica a configuração.

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

Resultado esperado: o processo reiniciado e a linha `{"started":...}` do Go.Data.

#### H2.2. No Docker

O Docker abre as portas publicadas por fora do `ufw`: o firewall não as fecha. Por isso, a porta do Go.Data passa a
ser publicada só em `127.0.0.1` (`GODATA_BIND` no `.env`).

```bash
cd "$GODATA_DIR"
sed -i 's/^GODATA_BIND=.*/GODATA_BIND=127.0.0.1/' .env
docker compose up -d --wait --wait-timeout 900
docker compose port godata 3000
```

Resultado esperado: o contêiner `godata` recriado, `Healthy`, e a linha `127.0.0.1:3000`.

### H3. Site do nginx com certificado do Let's Encrypt

Use este passo quando o nome do sistema é público e o servidor recebe acessos da internet na porta 80. O certbot
obtém o certificado, configura o HTTPS no site e renova o certificado sozinho. Se a instituição fornece o
certificado, pule para o passo H4. Troque também `ti@exemplo.gov.br` pelo e-mail que recebe os avisos do certificado.

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

Resultado esperado: `syntax is ok` e `test is successful` do `nginx -t` e, no fim, `Successfully deployed
certificate` e `Congratulations! You have successfully enabled HTTPS`. O `client_max_body_size` de 4096 MB acompanha o
limite de importação do Go.Data (`jobSettings.importResources.maxFileSize`).

### H4. Site do nginx com certificado da instituição

Use este passo quando a instituição fornece o certificado. São dois arquivos em formato PEM: o certificado, com a
cadeia completa (o certificado do servidor seguido dos intermediários), e a chave privada. Copie-os para o servidor e
troque `/caminho/do/certificado.crt` e `/caminho/da/chave.key` pelos caminhos deles.

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

Resultado esperado: `syntax is ok` e `test is successful`. Quando o certificado vencer, copie os novos arquivos para
os mesmos caminhos e execute `sudo systemctl reload nginx`. O `client_max_body_size` de 4096 MB acompanha o limite de
importação do Go.Data (`jobSettings.importResources.maxFileSize`).

### H5. Firewall

Se o SSH do servidor usa outra porta, troque `22` antes de executar: com a porta errada, a sessão SSH cai e não volta.

```bash
sudo apt-get install -y ufw
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

Resultado esperado: `Status: active` e as portas 22, 80 e 443 como `ALLOW`. Abra no navegador
`https://godata.exemplo.gov.br`: a tela de login aparece, com o cadeado de conexão segura.

## Endurecimento do MongoDB existente

Esta seção é para um servidor do caminho A cujo MongoDB aceita conexões sem usuário e senha, como em instalações mais
antigas. Ela cria um administrador e o usuário do Go.Data, passa a conexão do Go.Data a usar o usuário, liga a
autenticação e deixa o MongoDB só no endereço local. Faça-a fora da janela de uma atualização, com um dump recente
(passo 3.1 do [manual de backup](backup.md)). O Go.Data fica fora do ar por alguns segundos, quando o MongoDB reinicia
no passo E4.

Antes de começar, confira se outros sistemas usam o mesmo MongoDB. Depois do passo E4, os sistemas do mesmo servidor
só se conectam com usuário e senha próprios, e os de outros servidores deixam de alcançar o MongoDB. Crie esses
usuários e ajuste esses sistemas antes do passo E4.

### E1. Defina as variáveis e confira o MongoDB

Ajuste os valores à instalação, como no passo A1, e execute no mesmo terminal em que fará os passos seguintes.

```bash
export GODATA_DIR=/opt/godata
export GODATA_PORT=3000
export GODATA_PM2=godata
mongod --version | head -n 1
mongosh --quiet --eval 'const p = db.adminCommand({ getCmdLineOpts: 1 }).parsed; printjson({ net: p.net, security: p.security }); print("users: " + db.getSiblingDB("admin").getUsers().users.length)'
node -p 'require(process.argv[1]).mongoDb' "$GODATA_DIR/config/datasources.json"
```

Resultado esperado: a versão do MongoDB, a configuração de rede (`bindIp`), `security` vazio (`undefined`) e
`users: 0`, e a conexão atual do Go.Data, sem `user` nem `password`. Se `security` mostrar `authorization: 'enabled'`,
a autenticação já está ligada e esta seção não se aplica. Se `users` não for `0`, já existem usuários: confira com
quem administra o MongoDB antes de seguir.

### E2. Crie os usuários

O primeiro bloco sorteia a senha do administrador do MongoDB, se o arquivo dela ainda não existe
(`/root/mongodb-admin.txt`, que só o `root` lê), e acrescenta à conexão do Go.Data, em `config/datasources.json`, o
usuário `godata` com uma senha sorteada. O resto do arquivo, como o servidor de e-mail, não muda.

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

Resultado esperado: nenhuma saída.

O segundo bloco cria o administrador (`admin`, papel `root`) e o usuário do Go.Data (`godata`, papéis `readWrite` e
`dbAdmin` só no banco do Go.Data), lendo as senhas dos arquivos.

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

Resultado esperado: `users: admin, godata`.

### E3. Passe o Go.Data a usar o usuário

O MongoDB ainda aceita conexões sem senha, então o Go.Data continua funcionando enquanto passa a entrar com o usuário
`godata`.

```bash
node "$GODATA_DIR/atual/deploy/lib/merge-config.js" --defaults "$GODATA_DIR/atual/deploy/defaults" --overrides "$GODATA_DIR/config" --server-dir "$GODATA_DIR/atual/server"
pm2 restart "$GODATA_PM2"
timeout 300 sh -c "until curl -fsS http://127.0.0.1:$GODATA_PORT/status 2> /dev/null; do sleep 5; done"
echo
```

Resultado esperado: o processo reiniciado e a linha `{"started":...}` do Go.Data.

### E4. Ligue a autenticação

O bloco guarda uma cópia da configuração atual do MongoDB em `/etc/mongod.conf.antes-da-autenticacao`, deixa o
MongoDB só em `127.0.0.1`, liga a autenticação e reinicia o MongoDB e o Go.Data. Se o arquivo já tiver uma seção
`security` ou usar `bindIpAll`, o bloco para sem alterar nada: nesse caso, edite o arquivo com quem administra o
MongoDB.

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

Resultado esperado: o processo do Go.Data reiniciado, sem erro.

O último bloco confere: sem usuário, o MongoDB recusa a listagem dos bancos; com o usuário `godata`, o Go.Data
responde.

```bash
mongosh --quiet --eval 'db.adminCommand({ listDatabases: 1 })' || true
sudo ss -ltn 'sport = :27017'
timeout 300 sh -c "until curl -fsS http://127.0.0.1:$GODATA_PORT/status 2> /dev/null; do sleep 5; done"
echo
pm2 logs "$GODATA_PM2" --lines 20 --nostream
```

Resultado esperado: um erro `MongoServerError: Command listDatabases requires authentication`, o MongoDB escutando só
em `127.0.0.1:27017`, a linha `{"started":...}` do Go.Data e, no log, `Database connection initialized`, sem erros de
conexão. Avisos como `DeprecationWarning` e `MaxListenersExceededWarning` aparecem com `"level":"error"` e são
esperados. Se algo falhar, a configuração anterior do MongoDB está em `/etc/mongod.conf.antes-da-autenticacao`.

## Conferência final

### F1. No pm2

```bash
pm2 list
systemctl is-enabled "pm2-$USER"
curl -fsS "http://127.0.0.1:$GODATA_PORT/api/system-settings/version" -H "api-key: $(node -p 'require(process.argv[1]).apiKey' "$GODATA_DIR/atual/client/dist/assets/runtime-config.json")" | cut -c 1-80
ps -o user=,args= -C node
sudo ss -ltn 'sport = :27017'
crontab -l
```

Resultado esperado:

- O processo `godata` como `online` e o serviço do pm2 como `enabled`.
- Uma linha que começa com `{"platform":"-","version":"2.51.0","build":"2026.10.0"`.
- Os processos `node` com o seu usuário, nunca com `root`.
- O MongoDB escutando só em `127.0.0.1:27017`.
- A linha do dump diário no crontab.

### F2. No Docker

```bash
cd "$GODATA_DIR"
docker compose ps
curl -fsS "http://127.0.0.1:$GODATA_PORT/api/system-settings/version" -H "api-key: $(curl -fsS "http://127.0.0.1:$GODATA_PORT/assets/runtime-config.json" | sed -n 's/.*"apiKey": *"\([^"]*\)".*/\1/p')" | cut -c 1-80
ps -o uid=,args= -C node
docker compose port mongo 27017 || true
crontab -l
```

Resultado esperado:

- Os contêineres `mongo` e `godata` como `Up` e `(healthy)`.
- Uma linha que começa com `{"platform":"-","version":"2.51.0","build":"2026.10.0"`.
- Os processos `node` do contêiner `godata` com o UID `1000` (o usuário `node` do contêiner), nunca com o UID `0`
  (`root`).
- Nenhuma porta publicada para o MongoDB: `docker compose port mongo 27017` mostra `:0`, nada ou um erro, conforme a
  versão do Docker Compose.
- A linha do dump diário no crontab.

Confira também no navegador o login, a versão na tela de login e, em **Sistema > Backups**, o **Local** dos backups
(`/opt/godata/backups` nos dois caminhos).
