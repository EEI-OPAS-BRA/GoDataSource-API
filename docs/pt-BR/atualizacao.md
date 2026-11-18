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
| Ubuntu 20.04 ou anterior, ou Windows, com qualquer forma de instalação | 2, para um servidor novo com Ubuntu 22.04 ou 24.04 e Docker |
| Ubuntu 22.04 ou posterior, pm2 e MongoDB 7.0 | 1, pm2 para pm2 |
| Ubuntu 22.04 ou posterior, pm2 e MongoDB abaixo da 7.0 (5.0, 6.0) | 2, pm2 para Docker no mesmo servidor |
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
- Reserve uma janela de manutenção e avise os usuários. O sistema fica fora do ar do passo 1.6 (caso 1) ou 3.3
  (caso 3) até a **Conferência**.
- Confira o espaço livre em disco: pelo menos duas vezes o tamanho do banco, mais 3 GB.
- A instalação anterior fica intacta até a conferência terminar: no pm2, a pasta da versão anterior e o Node.js
  anterior; no Docker, a imagem anterior. Guarde-as por alguns dias de uso da versão nova.
- Execute todos os passos com o usuário que opera o Go.Data, sem `sudo`, no mesmo terminal. Os comandos que precisam
  de `sudo` já o trazem. No Docker, esse usuário precisa usar o `docker` sem `sudo` (grupo `docker`).

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
- `GODATA_PM2`: só no pm2. Nome do processo do Go.Data no pm2 (`pm2 list`).
- `GODATA_OLD_API`: só no pm2. Pasta da API em uso, a que contém `server/config.json`. É o valor `exec cwd` de
  `pm2 describe godata` (troque `godata` pelo nome do processo). Exemplos: `/opt/godata/2026.10.0/api` (guia de
  atualização da versão 2026.10.0), `/godata/v2.49.0/go-data/build` (instalador da OMS) e
  `/opt/godata/versions/2026.10.0` (manual de instalação). O passo 1.1 confere esse valor.
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
relacionamentos (`relationship`). O aviso `DeprecationWarning` do `punycode` pode aparecer e não afeta a contagem.

### C3. Contagens no Docker

O `mongosh` roda dentro do contêiner `mongo`, com o usuário `root` do MongoDB e a senha que o próprio contêiner
conhece.

```bash
cd "$GODATA_DIR"
docker compose exec -T mongo sh -c 'mongosh --quiet --nodb --eval "db = new Mongo(\"mongodb://127.0.0.1:27017\").getDB(\"admin\"); db.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD); void 0" --file /dev/stdin' < "$GODATA_BACKUP/counts.js" > "$GODATA_BACKUP/counts-$(date -u +%Y%m%dT%H%M%SZ).txt"
cat "$(ls -1 "$GODATA_BACKUP"/counts-2*.txt | tail -n 1)"
```

Resultado esperado: o total de casos, contatos e eventos não excluídos (`person`, por tipo) e o total de
relacionamentos (`relationship`).

### C4. Compare com a primeira contagem

```bash
diff "$(ls -1 "$GODATA_BACKUP"/counts-2*.txt | head -n 1)" "$(ls -1 "$GODATA_BACKUP"/counts-2*.txt | tail -n 1)" && echo "counts: equal to the first count"
```

Resultado esperado: `counts: equal to the first count`. Se aparecerem diferenças, não libere o sistema para os
usuários: confira o que mudou e, se for o caso, volte à versão anterior.

## Backup

O dump anterior à atualização fica em `GODATA_BACKUP`, fora da limpeza automática dos dumps. Ele é feito com o
Go.Data parado, logo depois da primeira contagem, para que nada registrado depois dele se perca. Os casos indicam
quando fazer este passo. Se o dump falhar, não continue a atualização: inicie de novo a versão anterior e resolva a
causa.

### D1. Dump no pm2

O bloco usa o `db-state.js` da versão nova para montar a conexão, que vai num arquivo temporário que só o dono lê,
apagado no fim. Guarda também a configuração da versão anterior e a pasta `config/`.

```bash
cd "$GODATA_DIR/versions/$GODATA_NEW_VERSION"
GODATA_MONGO_CFG="$(mktemp)"
printf "uri: '%s'\n" "$(node deploy/lib/db-state.js print-uri --datasources server/datasources.json | sed "s/'/''/g")" > "$GODATA_MONGO_CFG"
mongodump --config "$GODATA_MONGO_CFG" --db "$(node -p 'require("./server/datasources.json").mongoDb.database')" --archive="$GODATA_BACKUP/$(node -p 'require("./server/datasources.json").mongoDb.database').archive.gz" --gzip
rm -f "$GODATA_MONGO_CFG"
tar -czf "$GODATA_BACKUP/config-antes.tar.gz" -C "$GODATA_OLD_API" server/config.json server/datasources.json -C "$GODATA_DIR" config
ls -lh "$GODATA_BACKUP"
```

Resultado esperado: linhas `done dumping` do `mongodump` e, em `GODATA_BACKUP`, o arquivo do banco
(`go-data.archive.gz`, por exemplo) e `config-antes.tar.gz`, com tamanho maior que zero.

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

```bash
[ -d "$GODATA_DIR" ] || sudo install -d -o "$USER" -g "$USER" -m 750 "$GODATA_DIR"
mkdir -p "$GODATA_DIR/versions" "$GODATA_DIR/storage/files" "$GODATA_DIR/storage/icons" "$GODATA_DIR/backups"
install -d -m 700 "$GODATA_DIR/config" "$GODATA_DIR/dumps"
ls -l "$GODATA_DIR"
```

Resultado esperado: as pastas `backups`, `config`, `dumps`, `storage` e `versions`, do seu usuário, além do que já
existia na pasta. Numa instalação que já segue o manual de instalação, nada muda.

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
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
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
console.log("review: " + (review.join(", ") || "none"));
' "$GODATA_OLD_API/server" "$GODATA_DIR/config" "$GODATA_DIR/versions/$GODATA_NEW_VERSION/deploy/defaults"
```

Resultado esperado: três linhas, por exemplo `config.json: port, public, enableConfigRewrite, timezone`,
`datasources.json: mongoDb (host, port, database, authSource), email` e `review: none`. A linha `review` lista as
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

Resultado esperado: o processo como `stopped` em `pm2 list`.

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

Resultado esperado: o comando termina sem erro. A migração pode levar vários minutos e é mais demorada em instalações
anteriores à 2.50. Se ela falhar ou for interrompida, não execute de novo: siga **Voltar à versão anterior** ou
**Recuperar de uma migração com falha**.

### 1.9. Inicie a nova versão

O pm2 guarda a pasta real da versão do processo, e não o atalho `atual`. Por isso o processo antigo é apagado e um novo
é criado a partir de `atual`. A lista gravada do pm2 é atualizada logo depois de apagar o processo: sem isso, o
`pm2 update`, que reinicia o pm2 com a versão instalada no passo 1.3, restauraria também o processo antigo. Os outros
processos do pm2, se houver, são restaurados.

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

Este caso, para servidores com Ubuntu 20.04 ou anterior, Windows ou MongoDB abaixo da 7.0, será publicado numa próxima
versão deste manual.

## Caso 3: Docker para Docker

A atualização troca a versão da imagem do Go.Data no `.env`. No início, o contêiner migra o banco e grava a pasta dos
backups do sistema. O contêiner `mongo` e os dados em `data/` não mudam.

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

A volta restaura o banco do dump anterior à atualização: tudo o que foi registrado depois dele se perde. O dump de
segurança do manual de backup guarda antes o estado atual.

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
iniciado de outra forma, use o comando registrado em `pm2-antes.txt`, em `GODATA_BACKUP`.

Em seguida, faça de novo o passo A12 do [manual de instalação](instalacao.md), que recria o serviço do pm2 com o
Node.js anterior. O dump diário continua com o Node.js 22, que fica instalado. Por fim, faça as contagens (passo C2) e
compare com a primeira (passo C4). A tela de login deve mostrar a versão anterior.

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
sed -i "s/^GODATA_VERSION=.*/$(cat "$GODATA_BACKUP/versao-antes.txt")/" .env
grep '^GODATA_VERSION=' .env
sudo rm -f data/state/migration-failed data/state/db-command-running
docker compose up -d --wait --wait-timeout 900
docker compose images godata
docker compose logs godata | grep godata-entrypoint
```

Resultado esperado: a versão anterior no `.env` e na coluna `TAG`, os contêineres como `Healthy` e, no log,
`database has users`, `migrate-database finished` e `starting Go.Data` seguida da versão anterior. Por fim, faça as
contagens (passo C3) e compare com a primeira (passo C4).

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
contêiner e o conteúdo do marcador: a hora, a versão da imagem, o motivo (`reason:`) e as últimas linhas do comando
que falhou.

### R2. Volte ao dump anterior à atualização

Siga **Voltar à versão anterior** do seu caso. No Docker, o passo V3.3 apaga o marcador depois da restauração. Para
tentar a versão nova de novo depois de corrigir a causa, restaure o dump (passos V3.1 e V3.2), apague o marcador
(passo R3) e inicie com o passo 3.4.

### R3. Apague o marcador no Docker

Só depois de restaurar o dump ou de corrigir a causa. O contêiner volta a executar a migração no início seguinte.

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

Resultado esperado, nos dois: uma linha com `matchedCount: 1` e `modifiedCount: 1`. Em seguida, no pm2, repita o passo
1.8; no Docker, faça o passo R3.

### R5. Primeira instalação interrompida no Docker

Se a primeira inicialização (passo B9 do [manual de instalação](instalacao.md)) foi interrompida, o banco fica com
parte das coleções e sem usuários, e o contêiner recusa o `init-database`. Numa instalação nova, sem nenhum dado
registrado, apague o banco e inicie de novo. Nunca faça isto numa instalação com dados.

```bash
cd "$GODATA_DIR"
docker compose stop godata
docker compose exec -T mongo sh -c 'mongosh --quiet --nodb --eval "db = new Mongo(\"mongodb://127.0.0.1:27017\").getDB(\"admin\"); db.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD); printjson(db.getSiblingDB(process.env.GODATA_DB).dropDatabase())"'
sudo rm -f data/state/migration-failed data/state/db-command-running
docker compose up -d --wait --wait-timeout 900
docker compose logs godata | grep godata-entrypoint
```

Resultado esperado: `{ ok: 1, dropped: 'go-data' }`, os contêineres como `Healthy` e, no log, `database is empty`,
`running init-database` e `init-database finished`.

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
