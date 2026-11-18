# Manual de atualização do Go.Data

[English](../en/upgrade.md) · [Instalação](instalacao.md) · [Configuração](configuracao.md) · [Backup](backup.md) ·
[Notas de versão](notas-de-versao.md)

## Aviso

- Esta distribuição é uma derivação (fork) do Go.Data publicado pela OMS. Não é uma versão da OMS e não tem o seu
  endosso.
- O software é fornecido no estado em que se encontra, sem garantias, sob a licença GPL-3.0.
- O backup é obrigatório. As migrações alteram o banco de dados e não têm desfazer automático.
- Sempre que possível, atualize primeiro uma cópia de teste e reserve uma janela de manutenção.
- Quem opera cada instalação é responsável pelos seus dados, pelo controle de acesso e pelo cumprimento da legislação
  de proteção de dados.
- Problemas devem ser relatados nas issues do repositório da API.

## Qual é o seu caso

O caminho da atualização depende do sistema do servidor, da forma como o Go.Data roda e da versão do MongoDB. O bloco
mostra os três. Execute-o com o usuário que opera o Go.Data, num terminal em que os comandos `pm2` ou `docker` já
funcionam.

```bash
. /etc/os-release && echo "$PRETTY_NAME"
if command -v mongod > /dev/null; then mongod --version | head -n 1; else echo "mongod: not installed on this server"; fi
if command -v pm2 > /dev/null; then pm2 list; else echo "pm2: not found"; fi
if command -v docker > /dev/null; then docker compose ls; else echo "docker: not found"; fi
```

Resultado esperado: a versão do Ubuntu, a versão do MongoDB (`db version v7.0.` seguido do número, por exemplo), a
lista de processos do pm2 ou a lista de instalações do Docker Compose, com a pasta de cada uma. Se o MongoDB roda em
outro servidor, a versão aparece com `mongosh --quiet --eval 'db.version()'` executado lá.

| O servidor tem | Caso |
| --- | --- |
| Ubuntu 20.04 ou anterior, ou Windows, com pm2 | 2, para um servidor novo com Ubuntu 22.04 ou 24.04 e Docker |
| Ubuntu 22.04, pm2 e MongoDB 7.0 | 1, pm2 para pm2 |
| Ubuntu 22.04 com pm2 e MongoDB abaixo da 7.0 (5.0, 6.0), ou Ubuntu 24.04 com pm2 | 2, pm2 para Docker no mesmo servidor |
| Docker, instalado pelo [manual de instalação](instalacao.md) | 3, Docker para Docker |

O caso 1 vale para três pontos de partida, todos com pm2 e o MongoDB 7.0 no próprio servidor:

- uma instalação pelo código-fonte, feita com o guia de atualização da versão 2026.10.0 (a API em
  `/opt/godata/2026.10.0/api`, por exemplo);
- uma instalação feita pelo instalador da OMS (a API em `/godata/v<versão>/go-data/build`);
- uma instalação feita pelo caminho A do [manual de instalação](instalacao.md) (a API em
  `/opt/godata/versions/<versão>`).

Nos dois primeiros, a atualização também passa a instalação para a organização de pastas do manual de instalação, em
`/opt/godata`, sem alterar a pasta antiga, que continua sendo o caminho de volta.

## Antes de começar

- Leia as [notas de versão](notas-de-versao.md) da versão nova.
- Reserve uma janela de manutenção e avise os usuários. O sistema fica fora do ar do passo 1.6 (caso 1), 2.6, 2.12 ou
  2.17 (caso 2) ou 3.3 (caso 3) até a **Conferência**.
- Confira o espaço livre em disco: pelo menos duas vezes o tamanho do banco, mais 3 GB.
- A instalação anterior fica intacta até a conferência terminar: no pm2, a pasta da versão anterior e o Node.js
  anterior; no Docker, a imagem anterior; no caso 2, o processo antigo do pm2, parado, e o MongoDB antigo. Guarde-as
  por alguns dias de uso da versão nova. Só retire a instalação antiga (passo 2.10) depois desses dias.
- Execute todos os passos com o usuário que opera o Go.Data, sem `sudo`, no mesmo terminal. Os comandos que precisam
  de `sudo` já o trazem. No Docker, esse usuário precisa usar o `docker` sem `sudo` (grupo `docker`).
- Abra esse terminal numa sessão do `tmux` (`sudo apt-get install -y tmux`, depois `tmux new -s godata`). Se a conexão
  SSH cair, a sessão continua com os comandos e as variáveis: entre de novo no servidor e volte a ela com
  `tmux attach -t godata`.

Ao passar de uma versão 2.x para a 2026.10.0:

- Os textos em português dos termos do sistema são regravados na atualização. Traduções personalizadas por importação
  de planilha nesses termos serão substituídas.
- O endereço de residência habitual passa a ser obrigatório para casos e contatos, exceto em surtos configurados com
  endereço opcional. Combine com as equipes como tratar os registros antigos sem endereço.

## Variáveis

Ajuste os valores à sua instalação e execute no mesmo terminal em que fará todos os passos. Se o terminal for
fechado, execute este bloco de novo.

```bash
export GODATA_DIR=/opt/godata
export GODATA_NEW_VERSION=2026.10.0
export GODATA_PM2=godata
export GODATA_OLD_API=/opt/godata/2026.10.0/api
export GODATA_BACKUP="$GODATA_DIR/dumps/antes-de-$GODATA_NEW_VERSION"
```

Resultado esperado: nenhuma saída.

- `GODATA_DIR`: pasta da instalação. No pm2, é a que contém ou vai conter `atual`, `config/` e `versions/`. No
  Docker, é a que contém `docker-compose.yml` e `.env`.
- `GODATA_NEW_VERSION`: versão nova, sem o `v` inicial, conforme a página de versões do repositório da API.
- `GODATA_PM2`: só no pm2 e no caso 2. Nome do processo do Go.Data no pm2 (`pm2 list`).
- `GODATA_OLD_API`: só no pm2 e no caso 2. Pasta da API em uso, a que contém `server/config.json`. É o valor
  `exec cwd` de `pm2 describe godata` (troque `godata` pelo nome do processo). Exemplos: `/opt/godata/2026.10.0/api`
  (guia de atualização da versão 2026.10.0), `/godata/v2.49.0/go-data/build` (instalador da OMS) e
  `/opt/godata/versions/2026.10.0` (manual de instalação). Os passos 1.1 e 2.1 conferem esse valor.
- `GODATA_BACKUP`: pasta que guarda as contagens, o dump anterior à atualização e o que for preciso para voltar.

Não exporte neste terminal `GODATA_VERSION`, `GODATA_PORT` nem `GODATA_DB`: no Docker, o `docker compose` usaria
esses valores no lugar dos do `.env`.

## Contagens

As contagens de casos, contatos, eventos e relacionamentos não excluídos são feitas antes da atualização, depois dela
e depois de uma volta à versão anterior, e precisam dar o mesmo resultado. Cada contagem fica num arquivo de
`GODATA_BACKUP` com a data e a hora no nome. Os casos indicam quando fazer cada passo desta seção.

### C1. Crie o script das contagens

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

Resultado esperado: o arquivo `counts.js`.

### C2. Contagens no pm2

A conexão com o MongoDB vem de `server/datasources.json` da versão nova, já configurada no passo 1.5. Ela vai para o
`mongosh` numa variável de ambiente, nunca na linha de comando.

```bash
cd "$GODATA_DIR/versions/$GODATA_NEW_VERSION"
GODATA_MONGO_URI="$(node deploy/lib/db-state.js print-uri --datasources server/datasources.json)" mongosh --quiet --nodb --eval 'process.env.GODATA_DB = JSON.parse(fs.readFileSync("server/datasources.json", "utf8")).mongoDb.database; db = new Mongo(process.env.GODATA_MONGO_URI).getDB("admin"); void 0' --file "$GODATA_BACKUP/counts.js" > "$GODATA_BACKUP/counts-$(date -u +%Y%m%dT%H%M%SZ).txt"
cat "$(ls -1 "$GODATA_BACKUP"/counts-2*.txt | tail -n 1)"
```

Resultado esperado: o total de casos, contatos e eventos não excluídos (`person`, por tipo) e o total de
relacionamentos (`relationship`), maiores que zero numa instalação em uso. O aviso `DeprecationWarning` do `punycode`
pode aparecer e não afeta a contagem. Se a lista `person` vier vazia, a conexão aponta para outro banco: confira
`database` em `config/datasources.json` (passo 1.5) e não continue.

### C3. Contagens no Docker

O `mongosh` roda dentro do contêiner `mongo`, com o usuário `root` do MongoDB e a senha que o próprio contêiner
conhece.

```bash
cd "$GODATA_DIR"
docker compose exec -T mongo sh -c 'mongosh --quiet --nodb --eval "db = new Mongo(\"mongodb://127.0.0.1:27017\").getDB(\"admin\"); db.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD); void 0" --file /dev/stdin' < "$GODATA_BACKUP/counts.js" > "$GODATA_BACKUP/counts-$(date -u +%Y%m%dT%H%M%SZ).txt"
cat "$(ls -1 "$GODATA_BACKUP"/counts-2*.txt | tail -n 1)"
```

Resultado esperado: o total de casos, contatos e eventos não excluídos (`person`, por tipo) e o total de
relacionamentos (`relationship`), maiores que zero numa instalação em uso. Se a lista `person` vier vazia, a contagem
leu outro banco: confira `GODATA_DB` no `.env` e não continue.

### C4. Compare com a primeira contagem

```bash
diff "$(ls -1 "$GODATA_BACKUP"/counts-2*.txt | head -n 1)" "$(ls -1 "$GODATA_BACKUP"/counts-2*.txt | tail -n 1)" && echo "counts: equal to the first count"
```

Resultado esperado: `counts: equal to the first count`. A comparação só vale com totais maiores que zero (passos C2 e
C3): duas contagens vazias de um banco errado também são iguais. Se aparecerem diferenças, não libere o sistema para os
usuários: confira o que mudou e, se for o caso, volte à versão anterior.

## Backup

O dump anterior à atualização fica em `GODATA_BACKUP`, fora da limpeza automática dos dumps. Ele é feito com o
Go.Data parado, logo depois da primeira contagem, e por isso guarda tudo o que foi registrado antes da atualização. Os
casos indicam quando fazer este passo. Se o dump falhar, não continue a atualização: inicie de novo a versão anterior
e resolva a causa.

### D1. Dump no pm2

O bloco usa o `db-state.js` da versão nova para montar a conexão, que vai num arquivo temporário que só o dono lê,
apagado no fim. Guarda também a configuração da versão anterior e a pasta `config/`.

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

Resultado esperado: linhas `done dumping` do `mongodump` e, em `GODATA_BACKUP`, o arquivo do banco
(`go-data.archive.gz`, por exemplo) e `config-antes.tar.gz`, com tamanho maior que zero e permissão `-rw-------`. Se
aparecer `dump failed`, o bloco apaga o que tiver gravado em parte: não siga para o passo 1.7, inicie de novo o
processo com `pm2 start godata` (troque `godata` pelo nome do processo) e resolva a causa.

### D2. Dump no Docker

O bloco executa o script de backup e leva o dump e o pacote de configuração para `GODATA_BACKUP`.

```bash
if "$GODATA_DIR/deploy/scripts/godata-backup.sh" "$GODATA_DIR"; then
  mv "$(ls -1 "$GODATA_DIR"/dumps/*.archive.gz | tail -n 1)" "$(ls -1 "$GODATA_DIR"/dumps/config-*.tar.gz | tail -n 1)" "$GODATA_BACKUP/"
  ls -l "$GODATA_BACKUP"
else
  echo "dump failed: do not go on with the update" >&2
  false
fi
```

Resultado esperado: a linha `backup ok` e, em `GODATA_BACKUP`, o arquivo do banco (`go-data-<data>.archive.gz`) e o
pacote `config-<data>.tar.gz`.

## Caso 1: pm2 para pm2

A versão nova é instalada pelo pacote da versão, com a interface já compilada, numa pasta própria em `versions/`. Os
anexos, os backups do sistema e a configuração ficam fora das pastas das versões, como no caminho A do
[manual de instalação](instalacao.md). O Node.js 22 e o pm2 são instalados pelo nvm ao lado do Node.js anterior, que
continua disponível para a volta. O caso 1 não muda a autenticação do MongoDB.

### 1.1. Confira o servidor e a instalação

Se uma tentativa anterior parou antes do passo 1.6, continue do passo em que ela parou, em vez de começar de novo.

O bloco confere o processador, a versão do Ubuntu, a do MongoDB, a pasta da API em uso e a pasta da instalação. Ele
não altera nada no servidor.

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

Resultado esperado: `avx` e uma linha que começa com `ok:`:

- `ok: update inside the layout of the installation manual`: a instalação já segue o manual de instalação.
- `ok: first move to the layout of the installation manual`: a instalação vem do guia anterior ou do instalador da
  OMS e passa agora para a organização de pastas do manual de instalação.

Se aparecer uma linha que começa com `stop:`, não siga adiante. Com outro Ubuntu ou outro MongoDB, veja
**Qual é o seu caso**. Se o processo roda de outra pasta, use em `GODATA_OLD_API` a pasta mostrada e execute de novo o
bloco de **Variáveis** e este bloco.

Na primeira mudança, se `/opt/godata/atual` já existe como pasta (e não como atalho), ela é renomeada para
`/opt/godata/anterior` no passo 1.7, depois do dump, sem nenhuma alteração no conteúdo. O manual de instalação usa o
nome `atual` para o atalho da versão em uso.

### 1.2. Crie as pastas

O bloco também instala o `rsync`, que o passo 1.7 usa, se ele ainda não estiver no servidor.

```bash
sudo apt-get install -y rsync
[ -d "$GODATA_DIR" ] || sudo install -d -o "$USER" -g "$USER" -m 750 "$GODATA_DIR"
mkdir -p "$GODATA_DIR/versions" "$GODATA_DIR/storage/files" "$GODATA_DIR/storage/icons" "$GODATA_DIR/backups"
install -d -m 700 "$GODATA_DIR/config" "$GODATA_DIR/dumps"
ls -l "$GODATA_DIR"
```

Resultado esperado: `rsync is already the newest version` ou o pacote instalado, e as pastas `backups`, `config`,
`dumps`, `storage` e `versions`, do seu usuário, além do que já existia na pasta. Numa instalação que já segue o
manual de instalação, as pastas não mudam.

Em seguida, faça o passo C1 (script das contagens).

### 1.3. Instale o Node.js 22 e o pm2

O bloco guarda em `GODATA_BACKUP` o caminho e a versão do Node.js em uso, para a volta, e instala pelo nvm o Node.js 22
mais recente e o pm2, que passam a ser os padrões dos próximos terminais. O Node.js anterior continua instalado. O
processo do Go.Data continua no ar.

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

Resultado esperado: o caminho e a versão do Node.js anterior, a versão do Node.js nova, que começa com `v22.`, e a
versão do pm2, que começa com `7.`. Se o pm2 em execução for de outra versão, aparece também o aviso
`In-memory PM2 is out-of-date`: o passo 1.9 resolve.

### 1.4. Baixe e instale o pacote

O primeiro bloco baixa o pacote da versão e confere a soma de verificação.

```bash
cd "$GODATA_DIR/versions"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_NEW_VERSION/godata-$GODATA_NEW_VERSION.tar.gz"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_NEW_VERSION/godata-$GODATA_NEW_VERSION.tar.gz.sha256"
sha256sum -c "godata-$GODATA_NEW_VERSION.tar.gz.sha256"
```

Resultado esperado: `godata-2026.10.0.tar.gz: OK`. Se aparecer `FAILED`, o arquivo está corrompido: apague os dois
arquivos e baixe de novo.

O segundo bloco extrai o pacote em `versions/`, instala as dependências e liga `server/storage` à pasta `storage/` da
instalação. O atalho `atual` ainda não muda.

```bash
mkdir "$GODATA_DIR/versions/$GODATA_NEW_VERSION"
tar -xzf "$GODATA_DIR/versions/godata-$GODATA_NEW_VERSION.tar.gz" -C "$GODATA_DIR/versions/$GODATA_NEW_VERSION" --strip-components=1
cd "$GODATA_DIR/versions/$GODATA_NEW_VERSION"
npm ci --omit=dev --no-audit --no-fund
rm -rf server/storage
ln -s "$GODATA_DIR/storage" server/storage
ls -l server/storage
```

Resultado esperado: o `npm ci` termina sem erro (avisos `npm warn` podem aparecer) e a última linha mostra
`storage -> /opt/godata/storage`.

### 1.5. Configure

Só na primeira mudança, o primeiro bloco cria `config/config.json` e `config/datasources.json` com os valores próprios
da instalação, lidos de `server/config.json` e `server/datasources.json` da pasta antiga: as chaves da tabela de
`config.json` do [manual de configuração](configuracao.md) que diferem do padrão da versão nova, a conexão com o
MongoDB e o servidor de e-mail. Ele mostra só os nomes das chaves, nunca os valores, e lista as outras chaves que
diferem do padrão. Se `config/` já tem esses arquivos, o bloco para sem alterar nada. Numa instalação que já segue o
manual de instalação, pule o primeiro bloco.

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

Resultado esperado: quatro linhas, por exemplo `config.json: port, public, enableConfigRewrite, timezone`,
`datasources.json: mongoDb (host, port, database, authSource), email`, `database: go-data` e `review: none`. O banco
mostrado precisa ser o da instalação antiga: as contagens do passo C2 leem esse banco. A linha `review` lista as
outras chaves em que a configuração antiga difere do padrão da versão nova. Para cada uma, veja se é uma escolha da
instalação ou um padrão antigo: uma escolha da instalação vai para `config/config.json` como nos blocos do
[manual de configuração](configuracao.md); um padrão antigo fica de fora. Os dois arquivos têm senhas: só o seu usuário
os lê.

O segundo bloco aplica a configuração à versão nova e grava a chave da API (`apiKey`) também na interface, como no
passo 6.1 do manual de configuração.

```bash
cd "$GODATA_DIR/versions/$GODATA_NEW_VERSION"
node deploy/lib/merge-config.js --defaults deploy/defaults --overrides "$GODATA_DIR/config" --server-dir server --runtime-config client/dist/assets/runtime-config.json
node -p 'const c = require("./server/config.json"); ({ port: c.port, public: c.public })'
```

Resultado esperado: `runtime config: changed` ou `runtime config: unchanged` e a porta e o endereço público da
instalação, por exemplo `{ port: 3000, public: { protocol: 'https', host: 'godata.exemplo.gov.br', port: '' } }`. Se
um arquivo de `config/` tiver erro de sintaxe, o primeiro comando indica o arquivo, a linha e a coluna.

### 1.6. Pare o Go.Data, conte e faça o dump

A partir deste passo o sistema fica fora do ar. O bloco guarda a descrição do processo no pm2 e o para.

```bash
pm2 describe "$GODATA_PM2" > "$GODATA_BACKUP/pm2-antes.txt"
pm2 stop "$GODATA_PM2"
pm2 list
```

Resultado esperado: o processo como `stopped` em `pm2 list`. O aviso `In-memory PM2 is out-of-date` do passo 1.3 pode
aparecer de novo. Se `pm2 list` mostrar outros processos além do Go.Data e do `pm2-logrotate`, por exemplo outra
instalação do Go.Data, leia o passo 1.9 antes de seguir: ele os reinicia.

Em seguida, faça os passos C2 (contagens no pm2) e D1 (dump no pm2).

### 1.7. Passe para a nova versão

O bloco aponta o atalho `atual` para a versão nova. Na primeira mudança, ele também:

- renomeia `atual` para `anterior`, se `atual` é uma pasta (e não um atalho), e passa `GODATA_OLD_API` para o novo
  nome, se a API em uso estava nela;
- copia os anexos (`server/storage`) e os backups do sistema (`backups/`) da pasta antiga para `storage/` e
  `backups/` da instalação. A pasta antiga não muda.

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

Resultado esperado: a linha `GODATA_OLD_API=` com a pasta da versão anterior, `atual -> versions/2026.10.0` e
`storage -> /opt/godata/storage`. Se o terminal for fechado depois deste passo, use essa pasta em `GODATA_OLD_API` ao
executar de novo o bloco de **Variáveis**.

### 1.8. Migre o banco de dados

```bash
cd "$GODATA_DIR/atual"
npm run migrate-database
```

Execute este passo dentro da sessão do `tmux` aberta em **Antes de começar** (`sudo apt-get install -y tmux` e
`tmux new -s godata`): uma queda da conexão SSH no meio da migração a interromperia.

Resultado esperado: o comando termina sem erro, com uma linha que começa com `Portuguese translations:`. Avisos como
`DeprecationWarning` e `MaxListenersExceededWarning` aparecem com `"level":"error"` e são esperados. A migração pode
levar vários minutos e é mais demorada em instalações anteriores à 2.50. Se ela falhar ou for interrompida, não
execute de novo: siga **Voltar à versão anterior** ou **Recuperar de uma migração com falha**.

### 1.9. Inicie a nova versão

O pm2 guarda a pasta real da versão do processo, e não o atalho `atual`. Por isso o processo antigo é apagado e um novo
é criado a partir de `atual`. A lista gravada do pm2 é atualizada logo depois de apagar o processo: sem isso, o
`pm2 update`, que reinicia o pm2 com a versão instalada no passo 1.3, restauraria também o processo antigo.

O `pm2 update` reinicia todos os processos do pm2 do servidor: eles ficam fora do ar por alguns segundos e voltam com
o pm2 novo e com o Node.js 22, padrão desde o passo 1.3 (`nvm alias default 22`). Se o servidor tem outras aplicações
no pm2, por exemplo outra instalação do Go.Data, combine a janela também com os usuários delas, confira que uma versão
antiga do Go.Data funciona com o Node.js 22 (ou atualize-a pelo mesmo manual) e, depois deste passo, confira em
`pm2 list` que elas voltaram como `online`.

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

Resultado esperado: uma linha como `{"started":"2026-11-18T12:00:00.000Z","uptime":12.3}` e o processo como `online`
em `pm2 list`, uma única vez. Se a linha `{"started":...}` não aparecer em 5 minutos, veja o motivo em
`pm2 logs godata --lines 100 --nostream` (troque `godata` pelo nome do processo).

### 1.10. Início automático, backups do sistema e dump diário

A troca do Node.js muda os caminhos que o serviço do pm2 e o crontab usam. Faça, no mesmo terminal:

- o passo A12 do [manual de instalação](instalacao.md), que recria o serviço do pm2 com o Node.js novo;
- o passo A14 do manual de instalação, que passa a pasta dos backups do sistema para `/opt/godata/backups`. Na
  primeira mudança, a linha mostra a pasta antiga, por exemplo
  `changed /opt/godata/2026.10.0/api/backups -> /opt/godata/backups`. Se a pasta antiga não for `backups/` dentro de
  `GODATA_OLD_API`, copie também os arquivos dela para `/opt/godata/backups`;
- o passo 4.1 do [manual de backup](backup.md), que grava o dump diário no crontab com os caminhos novos.

### 1.11. Confira a autenticação do MongoDB

O caso 1 não muda a autenticação do MongoDB. O bloco mostra se o MongoDB aceita conexões sem usuário e senha.

```bash
GODATA_MONGO_TEST="$(mongosh --quiet "mongodb://$(node -p 'const m = require(process.argv[1]).mongoDb; (m.host || "127.0.0.1") + ":" + (m.port || 27017)' "$GODATA_DIR/atual/server/datasources.json")" --eval 'db.adminCommand({ listDatabases: 1 }).ok' 2>&1 || true)"
case "$GODATA_MONGO_TEST" in
  1) echo "authorization: off, MongoDB answers without a user and password" ;;
  *"requires authentication"*|*Unauthorized*) echo "authorization: on" ;;
  *) echo "authorization: unknown: $GODATA_MONGO_TEST" ;;
esac
```

Resultado esperado: `authorization: on` ou `authorization: off, MongoDB answers without a user and password`. Com
`off`, faça depois da conferência, fora desta janela, a seção **Endurecimento do MongoDB existente** do
[manual de instalação](instalacao.md), que cria os usuários e liga a autenticação.

Em seguida, siga **Conferência**.

## Caso 2: pm2 para Docker

A instalação passa a rodar pelo caminho B do [manual de instalação](instalacao.md): o MongoDB 7.0 e o Go.Data em
contêineres, numa pasta nova. O banco vem de um dump do MongoDB antigo, restaurado no contêiner `mongo`. Os anexos, os
backups do sistema e os valores próprios da instalação vêm da pasta da API antiga. O contêiner do Go.Data migra o
banco no primeiro início.

A instalação antiga não muda: o processo do Go.Data no pm2 é só parado, nunca apagado antes da conferência, e o
MongoDB antigo é só lido pelo dump. Até a conferência terminar, voltar é parar o Docker e iniciar de novo o processo
antigo (**Voltar à versão anterior**).

O caso tem três variantes:

- **No mesmo servidor**: Ubuntu 22.04 ou 24.04, com o pm2 e um MongoDB abaixo da 7.0 no próprio servidor.
- **Para um servidor novo**: o servidor antigo tem Ubuntu 20.04 ou anterior. O servidor novo tem Ubuntu 22.04 ou 24.04
  e recebe os arquivos do servidor antigo.
- **Servidor antigo com Windows**: como a anterior, com a parte do servidor antigo em PowerShell.

No bloco de **Variáveis**, neste caso:

- `GODATA_DIR` é a pasta nova da instalação Docker, que ainda não existe ou está vazia. O padrão é `/opt/godata`. Se
  `/opt/godata` já existe e não está vazia, por exemplo numa instalação feita pelo guia de atualização da versão
  2026.10.0 (com `/opt/godata/atual` e `/opt/godata/2026.10.0`), use `/opt/godata-docker`. Os blocos deste manual e
  dos outros manuais usam `GODATA_DIR`; os caminhos de dentro dos contêineres, como `/opt/godata/backups`, não mudam.
- `GODATA_OLD_API` é a pasta da API antiga, e `GODATA_PM2` o nome do processo antigo no pm2.
- `GODATA_BACKUP` fica dentro da pasta nova e guarda o dump do banco antigo e as contagens.

### No mesmo servidor

#### 2.1. Confira o servidor e a instalação

O bloco confere o processador, a versão do Ubuntu, a pasta da API em uso, o `mongodump` e a pasta nova. Ele não
altera nada no servidor.

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

Resultado esperado: `avx` e uma linha que começa com `ok:`, com a versão do `mongodump` (100.3 ou posterior, como
`mongodump version: 100.10.0`). Se aparecer uma linha que começa com `stop:`, não siga adiante:

- Com Ubuntu 20.04 ou anterior, siga **Para um servidor novo**.
- Se o processo roda de outra pasta, use em `GODATA_OLD_API` a pasta mostrada.
- Se o `mongodump` não é da série 100, ou é anterior à 100.3, veja o passo 2.11.
- Se a pasta nova já existe e não está vazia, use `/opt/godata-docker` em `GODATA_DIR` (ou outra pasta vazia). Este
  manual não instala sobre uma pasta com arquivos.

Depois de corrigir, execute de novo o bloco de **Variáveis** e este bloco.

#### 2.2. Instale o Docker

Siga os dois blocos do passo B3 do [manual de instalação](instalacao.md), no mesmo terminal. Eles instalam o Docker
Engine e o plugin Compose do repositório oficial do Docker e põem o seu usuário no grupo `docker`. O Go.Data antigo
continua no ar.

O grupo `docker` só vale numa sessão nova: feche a sessão do `tmux` com `exit`, saia do servidor, entre de novo, abra
outra sessão do `tmux` (`tmux new -s godata`) e execute de novo o bloco de **Variáveis**.

#### 2.3. Crie a pasta da instalação

O primeiro bloco cria a pasta nova com as pastas do caminho B do manual de instalação (a tabela do passo B4 descreve
cada uma), baixa o pacote da versão, confere a soma de verificação e copia do pacote os arquivos do Docker.

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

Resultado esperado: a versão do Docker, `godata-2026.10.0.tar.gz: OK` e os arquivos `docker-compose.yml`,
`mongo-init/01-godata-user.js` e `deploy/scripts/godata-backup.sh`. Se o primeiro comando mostrar `permission denied`,
a sessão ainda não tem o grupo `docker`: veja o passo 2.2. Se aparecer `FAILED`, o arquivo está corrompido: apague os
dois arquivos baixados e execute o bloco de novo.

O segundo bloco cria o `.env` com duas senhas sorteadas pelo `openssl`, como no passo B6 do manual de instalação. Só o
seu usuário lê o arquivo e as senhas não aparecem na tela.

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

Resultado esperado: as quatro linhas sem senha e o arquivo com permissão `-rw-------`. O passo 2.5 troca
`GODATA_BIND`, `GODATA_PORT` e `GODATA_DB` pelos valores da instalação antiga.

Em seguida, faça o passo C1 (script das contagens).

#### 2.4. Baixe as imagens

```bash
cd "$GODATA_DIR"
docker compose pull
docker image ls ghcr.io/eei-opas-bra/godata
```

Resultado esperado: as imagens `mongo` e `godata` baixadas e a imagem `ghcr.io/eei-opas-bra/godata` com a tag da versão
nova. Se o servidor não consegue baixar a imagem do `ghcr.io`, use o bloco de **Sem acesso ao ghcr.io** do passo 3.2
e, em seguida, execute `docker compose pull mongo` na pasta da instalação.

#### 2.5. Configure

O bloco cria `config/config.json` e `config/datasources.json` com os valores próprios da instalação, lidos de
`server/config.json` e `server/datasources.json` da pasta antiga, como no passo 1.5: as chaves da tabela de
`config.json` do [manual de configuração](configuracao.md) que diferem do padrão da versão nova (o endereço público,
o fuso horário, os formatos de data, o remetente, a chave da API, entre outras) e o servidor de e-mail. A conexão com o
MongoDB não vai para esses arquivos: no Docker, ela vem do `.env`.

O bloco também grava no `.env` o nome do banco (`GODATA_DB`), a porta (`GODATA_PORT`) e a interface em que a API
antiga atendia (`GODATA_BIND`: `127.0.0.1` se ela atendia só no próprio servidor, `0.0.0.0` nos outros casos), para
que o sistema continue no mesmo endereço. Ele roda o `node` da imagem num contêiner temporário, com o seu usuário e o
grupo 1000, e mostra só os nomes das chaves, nunca os valores. Se `config/` já tem esses arquivos, o bloco para sem
alterar nada.

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

Resultado esperado: quatro linhas, por exemplo `config.json: public, enableConfigRewrite, timezone`,
`datasources.json: email`, `.env: GODATA_BIND=0.0.0.0, GODATA_PORT=3000, GODATA_DB=go-data` e `review: none`,
seguidas das linhas do `.env` sem senha. O banco mostrado precisa ser o da instalação antiga: o passo 2.7 restaura o
dump nele. A linha `review` lista as outras chaves em que a configuração antiga difere do padrão da versão nova. Para
cada uma, veja se é uma escolha da instalação ou um padrão antigo: uma escolha da instalação vai para
`config/config.json` como nos blocos **No Docker** do manual de configuração; um padrão antigo fica de fora. Os dois
arquivos podem ter a senha do e-mail: só o seu usuário e o contêiner os leem. No mesmo servidor, a porta fica livre
quando o processo antigo para, no passo 2.6.

#### 2.6. Pare o Go.Data e faça o dump

A partir deste passo o sistema fica fora do ar. O primeiro bloco guarda a descrição do processo no pm2, o para e grava
a lista do pm2 com o processo parado: sem isso, um reinício do servidor iniciaria o Go.Data antigo de novo. O processo
não é apagado: ele é o caminho de volta. Os outros processos do pm2 não mudam.

```bash
pm2 describe "$GODATA_PM2" > "$GODATA_BACKUP/pm2-antes.txt"
pm2 stop "$GODATA_PM2"
pm2 save
pm2 list
```

Resultado esperado: o processo como `stopped` em `pm2 list`.

O segundo bloco faz o dump do banco antigo, com o Go.Data parado. A conexão vem de `server/datasources.json` da pasta
antiga e vai num arquivo temporário que só o dono lê, apagado no fim: com ou sem usuário e senha no MongoDB, a senha
nunca aparece na linha de comando.

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

Resultado esperado: linhas `done dumping` do `mongodump` e, em `GODATA_BACKUP`, o arquivo `banco-antigo.archive.gz`,
com tamanho maior que zero e permissão `-rw-------`. Se aparecer `dump failed`, o bloco apaga o que tiver gravado em
parte: não siga adiante, inicie de novo o processo antigo com `pm2 start godata` e `pm2 save` (troque `godata` pelo
nome do processo) e resolva a causa.

#### 2.7. Restaure o banco no Docker

O bloco inicia só o contêiner `mongo`, que cria os usuários do MongoDB no primeiro início, e restaura nele o dump do
passo 2.6. O `mongorestore` roda dentro do contêiner, com o usuário `root` do MongoDB e a senha que o próprio contêiner
conhece, como no passo 6.2 do [manual de backup](backup.md).

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

Resultado esperado: no fim do `mongorestore`, uma linha como `125000 document(s) restored successfully. 0 document(s)
failed to restore.` e o contêiner `mongo` como `Up` e `(healthy)`. Se o `mongorestore` mostrar erro, não siga
adiante: siga **Voltar à versão anterior**.

Em seguida, faça o passo C3 (contagens no Docker). Ela é a primeira contagem: o Go.Data antigo está parado desde o
dump e o contêiner do Go.Data ainda não iniciou nem migrou o banco.

#### 2.8. Copie os anexos e os backups do sistema

O bloco copia `server/storage` e `backups/` da pasta antiga para `data/storage` e `data/backups`. A pasta antiga não
muda.

```bash
cp -a "$GODATA_OLD_API/server/storage/." "$GODATA_DIR/data/storage/"
if [ -d "$GODATA_OLD_API/backups" ]; then cp -a "$GODATA_OLD_API/backups/." "$GODATA_DIR/data/backups/"; fi
echo "storage: $(find "$GODATA_OLD_API/server/storage/" -type f | wc -l) files in the old folder, $(find "$GODATA_DIR/data/storage" -type f | wc -l) in data/storage"
ls -l "$GODATA_DIR/data/backups"
```

Resultado esperado: a linha `storage:` com o mesmo número de arquivos nas duas pastas e a lista dos backups do
sistema.

#### 2.9. Inicie

O contêiner do Go.Data migra o banco restaurado antes de iniciar o sistema e passa a pasta dos backups do sistema para
`/opt/godata/backups` (a pasta `data/backups` vista de dentro do contêiner). A migração de uma versão 2.x pode levar
vários minutos: execute este passo dentro da sessão do `tmux`.

```bash
cd "$GODATA_DIR"
docker compose up -d --wait --wait-timeout 900
docker compose ps
docker compose logs godata | grep godata-entrypoint
```

Resultado esperado: os dois contêineres como `Healthy` e, no log, as linhas `database has users`,
`running migrate-database`, `migrate-database finished`, `backup location: changed` seguida da pasta antiga e de
`/opt/godata/backups`, e `starting Go.Data` seguida da versão nova. No mesmo servidor, se a pasta antiga dessa linha
não é `backups/` dentro de `GODATA_OLD_API`, copie também os arquivos dela com
`sudo cp -a <pasta antiga>/. "$GODATA_DIR/data/backups/"`.

Enquanto o comando espera, `docker compose logs -f godata`, em outro terminal, mostra o andamento. Se o log mostrar
`migration failed` ou `refusing to start`, o comando só termina com erro depois de até 10 minutos: siga
**Voltar à versão anterior**.

Em seguida, faça os passos C3 (contagens no Docker) e C4 (comparação) e siga **Conferência**. Com tudo conferido, faça
o passo B10 do manual de instalação (dump diário) e, no mesmo servidor, o passo 2.10.

#### 2.10. Retire a instalação antiga

Só depois da conferência e depois de alguns dias de uso da versão nova. O primeiro bloco apaga o processo antigo do pm2 e grava a lista do pm2 sem ele. Os outros
processos do pm2 não mudam.

```bash
pm2 delete "$GODATA_PM2"
pm2 save --force
pm2 list
```

Resultado esperado: `pm2 list` sem o processo antigo.

O segundo bloco desliga o MongoDB antigo, que o Go.Data deixou de usar. Antes, ele confere as conexões abertas com
esse MongoDB: se algum programa está conectado, outro sistema o usa, e o bloco para sem desligar nada.

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

Resultado esperado: `mongod: inactive, disabled`. Se aparecer `stop:`, as linhas anteriores mostram as conexões: o
endereço de cada cliente e, para os programas do próprio servidor, o nome do processo. Confira com quem os administra
antes de desligar o MongoDB. O bloco vê só as conexões deste momento: confirme também que nenhum outro sistema usa
esse MongoDB de vez em quando, como uma rotina noturna. Os dados do MongoDB antigo continuam no disco. Se o crontab
tem a linha do dump diário da instalação antiga (`crontab -l`), apague-a.

### Para um servidor novo

O servidor antigo para o Go.Data e prepara três arquivos: o dump do banco, um pacote com a configuração, os anexos e os
backups do sistema, e a descrição do processo no pm2. Eles vão para o servidor novo, que faz a instalação Docker com
os passos de **No mesmo servidor**. O servidor antigo não muda além da parada do processo: voltar é iniciá-lo de novo
lá. Depois da conferência, quem administra a rede passa o endereço do sistema (o nome no DNS) para o servidor novo.

#### No servidor antigo

##### 2.11. Defina as variáveis e confira

Execute os blocos deste passo e dos passos 2.12 e 2.13 no servidor antigo, com o usuário que opera o Go.Data, numa
sessão do `tmux`.

```bash
export GODATA_PM2=godata
export GODATA_OLD_API=/godata/v2.49.0/go-data/build
export GODATA_TRANSFER="$HOME/godata-mudanca"
```

Resultado esperado: nenhuma saída.

- `GODATA_PM2`: nome do processo do Go.Data no pm2 (`pm2 list`).
- `GODATA_OLD_API`: pasta da API em uso, a que contém `server/config.json`. É o valor `exec cwd` de
  `pm2 describe godata` (troque `godata` pelo nome do processo). No instalador da OMS, é
  `/godata/v<versão>/go-data/build`.
- `GODATA_TRANSFER`: pasta nova, que ainda não existe, para os arquivos que vão para o servidor novo.

O bloco seguinte confere a pasta da API, o `mongodump` e a pasta dos arquivos. Ele não altera nada no servidor.

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

Resultado esperado: uma linha que começa com `ok:`, com a versão do `mongodump` (100.3 ou posterior, como
`mongodump version: 100.10.0`) e o nome do banco, o tamanho dos anexos e dos backups do sistema e o espaço livre. A pasta dos arquivos
precisa de espaço para o dump e para esses dois tamanhos. Se aparecer uma linha que começa com `stop:`, não siga
adiante.

O MongoDB 4.4 e posteriores trazem o `mongodump` da série 100 (MongoDB Database Tools), mas a opção `--config`, que o
passo 2.12 usa, existe só a partir da 100.3. As ferramentas mais antigas, de um MongoDB 4.2 ou anterior (versão que
começa com `r`) ou da série 100 abaixo da 100.3, não leem o arquivo de conexão. Nesse caso, baixe as MongoDB Database Tools para o sistema do servidor em formato `.tgz`, na página de downloads do
MongoDB, extraia o arquivo numa pasta do seu usuário e ponha a pasta `bin` dela no início do `PATH` deste terminal,
com `export PATH="<pasta>/bin:$PATH"`. Nada é instalado no sistema. Depois, execute este bloco de novo.

##### 2.12. Pare o Go.Data e faça o dump e o pacote

A partir deste passo o sistema fica fora do ar. O primeiro bloco cria a pasta dos arquivos, guarda a descrição do
processo no pm2, o para e grava a lista do pm2 com o processo parado, como no passo 2.6.

```bash
mkdir -m 700 "$GODATA_TRANSFER"
pm2 describe "$GODATA_PM2" > "$GODATA_TRANSFER/pm2-antes.txt"
pm2 stop "$GODATA_PM2"
pm2 save
pm2 list
```

Resultado esperado: o processo como `stopped` em `pm2 list`.

O segundo bloco faz o dump do banco, como no passo 2.6, e o pacote `arquivos-antigos.tar.gz` com
`server/config.json`, `server/datasources.json`, `server/storage` e `backups/` da pasta da API.

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

Resultado esperado: linhas `done dumping` do `mongodump` e, em `GODATA_TRANSFER`, os arquivos
`arquivos-antigos.tar.gz`, `banco-antigo.archive.gz` e `pm2-antes.txt`, os dois primeiros com tamanho maior que zero e
permissão `-rw-------`. Se aparecer `dump failed`, o bloco apaga o que tiver gravado em parte: não siga adiante,
inicie de novo o processo com `pm2 start godata` e `pm2 save` (troque `godata` pelo nome do processo) e resolva a
causa. Se a pasta dos backups do sistema não é `backups/` dentro de `GODATA_OLD_API` (**Sistema > Backups > Ações
rápidas > Configurações de backup automático**, campo **Local**), leve também os arquivos dela para o servidor novo e
copie-os depois para `data/backups`.

##### 2.13. Copie os arquivos para o servidor novo

O bloco copia a pasta dos arquivos para a pasta pessoal do usuário no servidor novo, por SSH, mantendo as
permissões. Troque `usuario@servidor-novo` pelo usuário e pelo endereço do servidor novo.

```bash
scp -rp "$GODATA_TRANSFER" usuario@servidor-novo:
```

Resultado esperado: uma linha com `100%` para cada arquivo. No servidor novo, os arquivos ficam em
`godata-mudanca`, na pasta pessoal do usuário. Se os dois servidores não se alcançam por SSH, leve a pasta por outro
meio para o mesmo lugar no servidor novo. A partir daqui, o servidor antigo não muda: ele é o caminho de volta.

#### No servidor novo

##### 2.14. Confira o servidor novo

Execute o bloco de **Variáveis** no servidor novo, com o usuário que recebeu os arquivos, numa sessão do `tmux`. O
bloco seguinte confere o processador, a versão do Ubuntu, a pasta nova e os arquivos do servidor antigo. Ele não
altera nada no servidor.

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

Resultado esperado: `avx` e uma linha que começa com `ok:`. Se aparecer uma linha que começa com `stop:`, não siga
adiante.

Em seguida, faça os passos 2.2 (Docker) e 2.3 (pasta da instalação) e o passo C1 (script das contagens).

##### 2.15. Leve os arquivos para a pasta da instalação

O bloco move os arquivos do servidor antigo para `GODATA_BACKUP`, extrai o pacote em `GODATA_BACKUP/antigo` e passa
`GODATA_OLD_API` para essa pasta, que os passos seguintes leem como a pasta da API antiga.

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

Resultado esperado: a linha `GODATA_OLD_API=` com a pasta `antigo` e, nas listas, os arquivos do servidor antigo e as
pastas e arquivos `config.json`, `datasources.json` e `storage`. Se o terminal for fechado depois deste passo, use
essa pasta em `GODATA_OLD_API` ao executar de novo o bloco de **Variáveis**.

Em seguida, faça os passos 2.4, 2.5, 2.7 (com a contagem C3), 2.8 e 2.9 de **No mesmo servidor**. O passo 2.6 já foi
feito no servidor antigo (passo 2.12) e o passo 2.10 não se aplica: o servidor antigo fica com o Go.Data parado, como
caminho de volta, até a decisão de desligá-lo. Depois da conferência, a pasta `GODATA_BACKUP/antigo` pode ser apagada:
o pacote `arquivos-antigos.tar.gz` continua em `GODATA_BACKUP`.

### Servidor antigo com Windows

A parte do servidor antigo é feita no PowerShell, com o usuário que administra o Go.Data no Windows, e prepara os
mesmos arquivos do passo 2.12. O dump usa o `mongodump.exe` das MongoDB Database Tools para Windows: baixe o arquivo
`.zip` na página de downloads do MongoDB e extraia-o numa pasta, sem instalar nada. O `tar.exe` e o `scp.exe` já vêm
no Windows 10, no Windows 11 e no Windows Server 2019 ou posterior, e o `New-TemporaryFile` vem no PowerShell 5 ou
posterior; o passo 2.16 confere os três. Versões do Windows anteriores ao Windows 10 1803 ou ao Windows Server 2019, ou
com PowerShell abaixo do 5, não são cobertas por este procedimento. A parte do servidor novo é a de
**No servidor novo**.

#### 2.16. Defina as variáveis e confira

```powershell
$GoDataApi = 'C:\GoData\go-data\build'
$GoDataTools = 'C:\mongodb-database-tools\bin'
$GoDataTransfer = "$env:USERPROFILE\godata-mudanca"
```

Resultado esperado: nenhuma saída.

- `$GoDataApi`: pasta da API do Go.Data, a que contém `server\config.json`.
- `$GoDataTools`: pasta `bin` das MongoDB Database Tools extraídas, a que contém `mongodump.exe`.
- `$GoDataTransfer`: pasta nova, que ainda não existe, para os arquivos que vão para o servidor novo.

O bloco seguinte confere os arquivos de configuração, o `mongodump.exe` e a pasta dos arquivos. Ele não altera nada
no servidor.

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

Resultado esperado: a versão do `mongodump` (100.3 ou posterior, como `mongodump version: 100.10.0`) e uma linha que
começa com `ok:`, com o nome do banco e o endereço do MongoDB. Se aparecer um erro com `stop:`, não siga adiante.

#### 2.17. Pare o Go.Data e faça o dump e o pacote

A partir deste passo o sistema fica fora do ar. Pare a API do Go.Data e deixe o MongoDB no ar: num processo do pm2,
`pm2 stop` e `pm2 save`, como no passo 2.12; num serviço do Windows, `Stop-Service` seguido do nome do serviço da API.
Se a API não roda como serviço nem no pm2, pare só o `node.exe` da API, pelo Gerenciador de Tarefas ou com
`Stop-Process` no processo da API, e deixe o `mongod` rodando. Tudo o que for registrado depois do dump não chegaria
ao servidor novo.

O bloco faz o dump do banco, com a conexão de `server\datasources.json` num arquivo temporário da pasta do usuário,
apagado no fim, e o pacote `arquivos-antigos.tar.gz` com os mesmos arquivos do passo 2.12. Se algo falhar, ele apaga
a pasta dos arquivos.

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

Resultado esperado: linhas `done dumping` do `mongodump` e, na lista, os arquivos `arquivos-antigos.tar.gz` e
`banco-antigo.archive.gz`, com tamanho maior que zero. Se aparecer `dump failed`, não siga adiante: inicie de novo a
API do Go.Data e resolva a causa. A pasta fica dentro da pasta do usuário, que só ele e os administradores do Windows
leem.

#### 2.18. Copie os arquivos para o servidor novo

O bloco entra na pasta que contém a pasta dos arquivos, para que o `scp` não confunda a letra do disco com o nome de
um servidor, e copia a pasta para a pasta pessoal do usuário no servidor novo. Troque `usuario@servidor-novo` pelo
usuário e pelo endereço do servidor novo.

```powershell
Set-Location (Split-Path $GoDataTransfer)
scp -r (Split-Path -Leaf $GoDataTransfer) usuario@servidor-novo:
```

Resultado esperado: uma linha com `100%` para cada arquivo. No servidor novo, os arquivos ficam em `godata-mudanca`,
na pasta pessoal do usuário. Em seguida, siga **No servidor novo** (passos 2.14 e 2.15). A partir daqui, o servidor
antigo não muda: ele é o caminho de volta.

## Caso 3: Docker para Docker

A atualização troca a versão da imagem do Go.Data no `.env`. No início, o contêiner `godata` novo migra o banco e
grava a pasta dos backups do sistema. O contêiner `mongo` continua o mesmo.

### 3.1. Confira a instalação

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

Resultado esperado: os contêineres `mongo` e `godata` como `Up` e `(healthy)`, a versão em uso na coluna `TAG` e no
`.env`, e `ok: no failed migration marker`. Se aparecer `stop:`, siga **Recuperar de uma migração com falha** antes de
atualizar.

Em seguida, faça o passo C1 (script das contagens).

### 3.2. Baixe a nova imagem

O sistema continua no ar. O comando baixa a imagem da versão nova sem mudar o `.env`: a variável vale só para ele.

```bash
cd "$GODATA_DIR"
GODATA_VERSION="$GODATA_NEW_VERSION" docker compose pull godata
docker image ls ghcr.io/eei-opas-bra/godata
```

Resultado esperado: a imagem baixada e, na lista, a tag da versão nova ao lado da tag da versão em uso.

#### Sem acesso ao ghcr.io

Se o servidor não consegue baixar a imagem do `ghcr.io`, baixe o arquivo da imagem da página da versão e carregue-o.
O arquivo também pode ser baixado em outra máquina e copiado para a pasta `versions/` da instalação, junto com o
arquivo `.sha256`. Nesse caso, pule as duas linhas do `curl`.

```bash
cd "$GODATA_DIR/versions"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_NEW_VERSION/godata-image-$GODATA_NEW_VERSION.tar.gz"
curl -fLO "https://github.com/EEI-OPAS-BRA/GoDataSource-API/releases/download/v$GODATA_NEW_VERSION/godata-image-$GODATA_NEW_VERSION.tar.gz.sha256"
sha256sum -c "godata-image-$GODATA_NEW_VERSION.tar.gz.sha256"
docker load -i "godata-image-$GODATA_NEW_VERSION.tar.gz"
```

Resultado esperado: `godata-image-2026.10.0.tar.gz: OK` e `Loaded image: ghcr.io/eei-opas-bra/godata:2026.10.0`.

### 3.3. Pare o Go.Data, conte e faça o dump

A partir deste passo o sistema fica fora do ar. O bloco guarda a versão em uso e para só o contêiner `godata`: o
`mongo` continua no ar para a contagem e o dump.

```bash
cd "$GODATA_DIR"
grep '^GODATA_VERSION=' .env > "$GODATA_BACKUP/versao-antes.txt"
docker compose stop godata
docker compose ps
```

Resultado esperado: só o contêiner `mongo` em `docker compose ps`.

Em seguida, faça os passos C3 (contagens no Docker) e D2 (dump no Docker).

### 3.4. Troque a versão e inicie

O contêiner novo migra o banco antes de iniciar o Go.Data. O comando espera os serviços ficarem saudáveis, o que pode
levar vários minutos.

```bash
cd "$GODATA_DIR"
sed -i "s/^GODATA_VERSION=.*/GODATA_VERSION=$GODATA_NEW_VERSION/" .env
grep '^GODATA_VERSION=' .env
docker compose up -d --wait --wait-timeout 900
docker compose ps
docker compose logs godata | grep godata-entrypoint
```

Resultado esperado: a versão nova no `.env`, os dois contêineres como `Healthy` e, no log, as linhas
`database has users`, `running migrate-database`, `migrate-database finished`,
`backup location: unchanged /opt/godata/backups` e `starting Go.Data` seguida da versão nova.

Enquanto o comando espera, `docker compose logs -f godata`, em outro terminal, mostra o andamento. Se o log mostrar
`migration failed` ou `refusing to start`, o comando só termina com erro depois de até 10 minutos: siga
**Recuperar de uma migração com falha**.

Em seguida, siga **Conferência**.

## Conferência

Faça as contagens de novo (passo C2 no pm2, C3 no Docker) e compare com a primeira (passo C4). Depois, confira a
versão em uso. A tela de login mostra `2.51.0 - build 2026.10.0` em todas as versões candidatas da 2026.10.0: a versão
exata aparece na pasta do pacote (pm2) ou na tag da imagem (Docker).

### F1. No pm2

```bash
pm2 describe "$GODATA_PM2" | grep -E 'status|exec cwd|node.js version'
readlink "$GODATA_DIR/atual"
curl -fsS "http://127.0.0.1:$(node -p 'require(process.argv[1]).port' "$GODATA_DIR/atual/server/config.json")/api/system-settings/version" -H "api-key: $(node -p 'require(process.argv[1]).apiKey' "$GODATA_DIR/atual/client/dist/assets/runtime-config.json")" | cut -c 1-80
echo
systemctl is-enabled "pm2-$USER"
grep -o 'versions/node/v[0-9.]*' "/etc/systemd/system/pm2-$USER.service" | sort -u
crontab -l | grep godata-backup
```

Resultado esperado:

- O processo como `online`, com `exec cwd` em `/opt/godata/versions/` seguido da versão nova e o Node.js 22.
- `versions/` seguido da versão nova, para onde aponta `atual`.
- Uma linha que começa com `{"platform":"-","version":"2.51.0","build":"2026.10.0"`.
- O serviço do pm2 como `enabled`, com o caminho do Node.js novo.
- A linha do dump diário no crontab.

### F2. No Docker

```bash
cd "$GODATA_DIR"
docker compose ps
docker compose images godata
grep '^GODATA_VERSION=' .env
curl -fsS "http://127.0.0.1:$(docker compose port godata 3000 | sed 's/.*://')/api/system-settings/version" -H "api-key: $(docker compose exec -T -u node godata node -p 'require("/opt/godata/client/dist/assets/runtime-config.json").apiKey')" | cut -c 1-80
echo
```

Resultado esperado:

- Os contêineres `mongo` e `godata` como `Up` e `(healthy)`.
- A versão nova na coluna `TAG` e no `.env`.
- Uma linha que começa com `{"platform":"-","version":"2.51.0","build":"2026.10.0"`.

Confira também no navegador:

- Um administrador e um usuário com restrição geográfica entram no sistema e veem as listas de casos, contatos e
  relacionamentos esperadas para cada um.
- Uma cadeia de transmissão é gerada.
- Um backup criado em **Sistema > Backups** termina com o status **Sucesso** e o arquivo aparece na pasta dos backups
  do sistema: `/opt/godata/backups` no pm2 e `data/backups` no Docker.
- Na atualização para a 2026.10.0, nas configurações de cada surto, revise as novas opções de visibilidade
  geográfica, criação em outro município, endereço opcional, bloqueio de exclusão de endereço, edição em massa de
  questionário e os campos de endereço e de documentos.

Se algo falhar, siga **Voltar à versão anterior**. Com tudo conferido, libere o sistema para os usuários.

## Voltar à versão anterior

Nos casos 1 e 3, a volta restaura o banco do dump anterior à atualização: tudo o que foi registrado depois dele se
perde. O dump de segurança do manual de backup guarda antes o estado atual.

### Caso 1

Antes do passo 1.6, o Go.Data continua no ar na versão anterior e não há nada a voltar. Se a falha aconteceu antes do
passo 1.8 (migração), o banco não mudou: pule os passos V1.1 e V1.2.

#### V1.1. Escolha o dump

```bash
export GODATA_DUMP="$(ls -1 "$GODATA_BACKUP"/*.archive.gz | head -n 1)"
ls -l "$GODATA_DUMP"
```

Resultado esperado: o dump feito no passo D1, com data e tamanho.

#### V1.2. Restaure o banco

Siga os três blocos do passo 6.1 do [manual de backup](backup.md), no mesmo terminal. O terceiro bloco para a versão
nova e restaura o dump escolhido no passo V1.1.

#### V1.3. Inicie a versão anterior

O bloco apaga o processo da versão nova, volta ao Node.js e ao pm2 anteriores e inicia o processo a partir da pasta da
versão anterior. Numa instalação que já seguia o manual de instalação, ele também aponta `atual` de volta para a
versão anterior. Na primeira mudança, `atual` continua apontando para a versão nova, que o dump diário usa.

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

Resultado esperado: a versão do Node.js anterior e o processo como `online` em `pm2 list`. Se o processo anterior era
iniciado de outra forma, use o comando registrado em `pm2-antes.txt`, em `GODATA_BACKUP`. Como no passo 1.9, o
`pm2 update` reinicia todos os processos do pm2 do servidor, que voltam com o pm2 e o Node.js anteriores: confira em
`pm2 list` que as outras aplicações voltaram como `online`.

Em seguida, faça de novo o passo A12 do [manual de instalação](instalacao.md), que recria o serviço do pm2 com o
Node.js anterior. O dump diário continua com o Node.js 22, que fica instalado. Por fim, faça as contagens (passo C2) e
compare com a primeira (passo C4). A tela de login deve mostrar a versão anterior.

### Caso 2

O banco antigo não é restaurado: o MongoDB antigo foi só lido e continua com tudo o que foi registrado até o dump.
Voltar é parar o Docker e iniciar de novo o processo antigo. O que for registrado no Docker depois da mudança não
volta para o banco antigo.

#### V2.1. No mesmo servidor

O bloco para e remove os contêineres, sem apagar as pastas de `data/`, liga de novo o MongoDB antigo, se o passo 2.10
o desligou, e inicia o processo antigo.

```bash
cd "$GODATA_DIR"
docker compose down
sudo systemctl enable --now mongod
pm2 start "$GODATA_PM2"
pm2 save
pm2 list
```

Resultado esperado: os contêineres removidos e o processo antigo como `online` em `pm2 list`. Se o passo 2.10 já
apagou o processo, crie-o de novo na pasta `GODATA_OLD_API` com o comando registrado em `pm2-antes.txt`, em
`GODATA_BACKUP` (`script path` e `exec cwd`), e grave a lista com `pm2 save`. Para tentar a mudança de novo, apague
a pasta `GODATA_DIR` com o bloco abaixo e comece pelo passo 2.1. Antes, confira que `GODATA_DIR` é a pasta do Docker
deste caso, e não a da instalação antiga.

```bash
if [ -f "$GODATA_DIR/docker-compose.yml" ]; then
  (cd "$GODATA_DIR" && docker compose down) && sudo rm -rf "$GODATA_DIR"
else
  echo "stop: $GODATA_DIR is not a Docker install folder" >&2
  false
fi
```

Resultado esperado: os contêineres removidos e nenhuma saída de erro. Se aparecer `stop:`, a pasta não tem o
`docker-compose.yml` e nada foi apagado: corrija `GODATA_DIR`.

#### V2.2. Servidor novo

No servidor novo, pare os contêineres:

```bash
cd "$GODATA_DIR"
docker compose down
```

Resultado esperado: os contêineres removidos.

No servidor antigo, execute o bloco de variáveis do passo 2.11 e inicie o processo antigo:

```bash
pm2 start "$GODATA_PM2"
pm2 save
pm2 list
```

Resultado esperado: o processo como `online` em `pm2 list`. Num servidor antigo com Windows, inicie de novo a API do
Go.Data da mesma forma em que ela foi parada no passo 2.17. Se o endereço do sistema já aponta para o servidor novo,
volte-o para o servidor antigo.

### Caso 3

#### V3.1. Escolha o dump

```bash
export GODATA_DUMP="$(ls -1 "$GODATA_BACKUP"/*.archive.gz | head -n 1)"
ls -l "$GODATA_DUMP"
```

Resultado esperado: o dump feito no passo D2, com data e tamanho.

#### V3.2. Restaure o banco

Siga os três blocos do passo 6.2 do [manual de backup](backup.md), no mesmo terminal. O terceiro bloco para o
contêiner `godata` e restaura o dump escolhido no passo V3.1.

#### V3.3. Inicie a versão anterior

O bloco volta o `.env` à versão anterior e inicia o Go.Data. Ele também apaga o marcador de migração com falha, se
houver: com o banco restaurado do dump anterior à atualização, a causa dele deixou de existir.

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

Resultado esperado: a versão anterior no `.env` e na coluna `TAG`, os contêineres como `Healthy` e, no log,
`database has users`, `migrate-database finished` e `starting Go.Data` seguida da versão anterior. Se aparecer `stop:`,
o arquivo do passo 3.3 está vazio ou não existe e nada foi alterado: grave nele a linha `GODATA_VERSION=` seguida da
versão anterior, que está no `.env` do pacote `config-<data>.tar.gz` em `GODATA_BACKUP`, e execute o bloco de novo.
Por fim, faça as contagens (passo C3) e compare com a primeira (passo C4).

## Recuperar de uma migração com falha

No Docker, o contêiner `godata` nunca repete sozinho um comando de banco que falhou ou foi interrompido. Ele grava o
marcador `data/state/migration-failed`, não inicia o Go.Data e fica parado até alguém resolver. Um
`docker compose restart` não muda isso. O estado de saúde fica `starting` por até 10 minutos e depois passa a
`unhealthy`, mas o log mostra o motivo na hora:

| Linha do log (`docker compose logs godata`) | O que aconteceu |
| --- | --- |
| `migration failed, see /opt/godata/state/migration-failed` | O `migrate-database` terminou com erro ou sem concluir. O banco pode estar parcialmente migrado |
| `a database command did not finish` | O contêiner parou no meio de um comando de banco, por exemplo num `docker compose stop` ou num reinício do servidor durante a migração. O marcador é gravado no início seguinte |
| `a migration was left in progress (status Started in migrationLog), not migrating` | O banco tem uma migração marcada como em andamento, deixada por uma execução interrompida |
| `refusing to run init-database: the database has documents but no users` | O banco tem dados mas não tem usuários, como numa restauração incompleta ou numa primeira instalação interrompida. O `init-database` apagaria tudo e não é executado |
| `database initialisation failed` | O `init-database` da primeira instalação falhou |
| `refusing to start: a previous database command failed or was interrupted` | Aparece em cada início seguinte, enquanto o marcador existir |

Nenhuma dessas situações apaga dados. Não use `docker compose run godata` para executar `init-database` ou
`migrate-database` à mão: esse comando pula as proteções do contêiner e pode repetir a migração sobre um banco
parcialmente migrado ou apagar um banco com dados.

No pm2, não há marcador: o `npm run migrate-database` do passo 1.8 mostra o erro e termina. Depois de uma interrupção,
ele recusa novas execuções com `A migration is already in progress`.

O caminho seguro é voltar ao dump anterior à atualização (**Voltar à versão anterior**). Apague o marcador ou marque a
migração como `Failed` só depois de entender e corrigir a causa.

### R1. Veja o motivo no Docker

```bash
cd "$GODATA_DIR"
docker compose ps godata
docker compose logs --tail 40 godata | grep godata-entrypoint
sudo cat data/state/migration-failed 2> /dev/null || echo "no marker"
```

Resultado esperado: o contêiner `godata` como `Up` e `(health: starting)` ou `(unhealthy)`, as últimas linhas do
contêiner e o conteúdo do marcador: a hora, a versão da imagem, o motivo (`reason:`) e as últimas linhas do último
comando de banco executado. Quando o contêiner recusou antes de executar qualquer comando, essas linhas são de uma
execução anterior: o motivo está só na linha `reason:`.

### R2. Volte ao dump anterior à atualização

Siga **Voltar à versão anterior** do seu caso. No Docker, o passo V3.3 apaga o marcador depois da restauração. Para
tentar a versão nova de novo depois de corrigir a causa, restaure o dump (passos V3.1 e V3.2) e apague o marcador
(passo R3), que inicia o contêiner e migra o banco.

### R3. Apague o marcador no Docker

Só depois de restaurar o dump ou de corrigir a causa. O contêiner volta a executar a migração no início seguinte. Sem
restaurar o dump, a migração recomeça sobre um banco que pode ter ficado migrado pela metade: leia antes o passo R4.

```bash
cd "$GODATA_DIR"
sudo rm -f data/state/migration-failed data/state/db-command-running
docker compose restart godata
docker compose up -d --wait --wait-timeout 900
docker compose logs --since 15m godata | grep godata-entrypoint
```

Resultado esperado: o contêiner `godata` como `Healthy` e, no log, `running migrate-database`,
`migrate-database finished` e `starting Go.Data`. Se o motivo foi uma migração deixada em andamento e o banco não foi
restaurado, o contêiner grava o marcador de novo: faça antes o passo R4.

### R4. Marque como Failed uma migração deixada em andamento

Use este passo depois de uma migração interrompida, quando se decide repetir a migração sem restaurar o dump. A
migração seguinte retoma a partir das ações já concluídas. A senha nunca vai na linha de comando.

No pm2:

```bash
cd "$GODATA_DIR/atual"
GODATA_MONGO_URI="$(node deploy/lib/db-state.js print-uri --datasources server/datasources.json)" mongosh --quiet --nodb --eval 'const d = new Mongo(process.env.GODATA_MONGO_URI).getDB(JSON.parse(fs.readFileSync("server/datasources.json", "utf8")).mongoDb.database); printjson(d.migrationLog.updateMany({ status: "Started" }, { $set: { status: "Failed", endDate: new Date() } }))'
```

No Docker:

```bash
cd "$GODATA_DIR"
docker compose exec -T mongo sh -c 'mongosh --quiet --nodb --eval "db = new Mongo(\"mongodb://127.0.0.1:27017\").getDB(\"admin\"); db.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD); printjson(db.getSiblingDB(process.env.GODATA_DB).migrationLog.updateMany({ status: \"Started\" }, { \$set: { status: \"Failed\", endDate: new Date() } }))"'
```

Resultado esperado, nos dois: a saída mostra `matchedCount: 1` e `modifiedCount: 1`. Em seguida, no pm2, repita o passo
1.8; no Docker, faça o passo R3.

### R5. Primeira instalação interrompida no Docker

Se a primeira inicialização (passo B9 do [manual de instalação](instalacao.md)) foi interrompida, o banco fica com
parte das coleções e sem usuários, e o contêiner recusa o `init-database`. Este passo apaga o banco e inicia de novo,
só numa instalação nova que nunca teve dados. O bloco faz antes um dump com o script de backup e conta as pessoas
(casos, contatos e eventos), os surtos e os usuários do banco: se houver algum, ele para sem apagar nada. Uma
restauração incompleta também deixa o banco sem usuários; nesse caso, restaure de novo o dump pelo passo 6.2 do
[manual de backup](backup.md).

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

Resultado esperado: a linha `backup ok` do dump, que fica em `dumps/`, a saída com `ok: 1` e `dropped: 'go-data'`,
os contêineres como `Healthy` e, no log, `database is empty`, `running init-database` e `init-database finished`. Se
aparecer `stop:`, o banco tem dados e nada foi apagado: siga **Voltar à versão anterior** ou restaure o dump certo pelo
passo 6.2 do manual de backup.

## Atualização do MongoDB 7.0

Os pacotes do MongoDB ficam travados (`apt-mark hold`) no pm2, para que uma atualização do Ubuntu não troque a versão.
Para aplicar uma correção da série 7.0 (7.0.x), numa janela de manutenção e depois de um dump (passo 3.1 do
[manual de backup](backup.md)), destrave, atualize e trave de novo. O Go.Data fica fora do ar enquanto o MongoDB
reinicia.

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

Resultado esperado: as linhas `Canceled hold on` e `set on hold.` de cada pacote, o processo do Go.Data reiniciado, a
versão do MongoDB, que começa com `db version v7.0.`, e `active`. Execute antes o bloco de **Variáveis**, que define
`GODATA_PM2`. O repositório configurado na instalação entrega só a série 7.0. No Docker, a versão do MongoDB é a da
imagem `mongo` do `docker-compose.yml` de cada versão do Go.Data.
