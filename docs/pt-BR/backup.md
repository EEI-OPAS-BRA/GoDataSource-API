# Manual de backup do Go.Data

[English](../en/backup.md) · [Instalação](instalacao.md) · [Configuração](configuracao.md) · [Atualização](atualizacao.md)

## Aviso

- Esta distribuição é uma derivação (fork) do Go.Data publicado pela OMS. Não é uma versão da OMS e não tem o seu
  endosso.
- O software é fornecido no estado em que se encontra, sem garantias, sob a licença GPL-3.0.
- O backup é obrigatório. As migrações alteram o banco de dados e não têm desfazer automático.
- Sempre que possível, atualize primeiro uma cópia de teste e reserve uma janela de manutenção.
- Quem opera cada instalação é responsável pelos seus dados, pelo controle de acesso e pelo cumprimento da legislação
  de proteção de dados.
- Problemas devem ser relatados nas issues do repositório da API.

## O que guardar

| O quê | pm2 | Docker | Como é copiado |
| --- | --- | --- | --- |
| Banco de dados | MongoDB do servidor | `data/mongo/` | Dump diário em `dumps/` (passos 3 e 4) |
| Configuração | `config/` | `config/` e `.env` | Junto com o dump, em `dumps/config-<data>.tar.gz` |
| Anexos e ícones | `storage/` | `data/storage/` | Cópia para fora do servidor (passo 5) |
| Backups do sistema | `backups/` | `data/backups/` | Backup automático do Go.Data (passo 2) e cópia para fora do servidor (passo 5) |

As pastas ficam dentro da pasta da instalação (`/opt/godata`). Tudo fica no mesmo disco do banco até o passo 5, que
leva as cópias para outro lugar. No Docker, não copie `data/mongo` com o sistema no ar: a cópia do banco é o dump.

## 1. Defina as variáveis

Ajuste os valores à sua instalação e execute no mesmo terminal em que fará todos os passos. Se o terminal for
fechado, execute este bloco de novo.

```bash
export GODATA_DIR=/opt/godata
export GODATA_PM2=godata
```

- `GODATA_DIR`: pasta da instalação. No pm2, é a que contém `atual/` e `config/`. No Docker, é a que contém
  `docker-compose.yml` e `.env`.
- `GODATA_PM2`: nome do processo no pm2 (`pm2 list`). O Docker não usa esta variável.

Execute os passos com o usuário que opera o Go.Data, sem `sudo`. Os comandos que precisam de `sudo` já o trazem. No
Docker, `data/storage` e `data/backups` pertencem ao usuário do contêiner (uid 1000), por isso os comandos que leem
essas pastas usam `sudo`. Num servidor com duas instalações, execute os passos uma vez para cada uma, com os valores
dela.

## 2. Backups do sistema

O Go.Data faz backups próprios: arquivos `.zip` com os dados, a configuração do sistema e os arquivos anexados,
gravados na pasta de backups do sistema. Eles ficam no mesmo servidor até a cópia do passo 5. Se a chave
`backUp.password` estiver definida (veja o [manual de configuração](configuracao.md)), os backups são cifrados e só
uma instalação com a mesma senha consegue restaurá-los.

### 2.1. Configurações do backup automático

Em **Sistema > Backups**, abra **Ações rápidas > Configurações de backup automático**:

- **Local**: pasta onde os arquivos ficam. No pm2, use a pasta `backups` da instalação (`/opt/godata/backups`), fora
  da pasta da versão. No Docker, o valor é sempre `/opt/godata/backups`, a pasta `data/backups` vista de dentro do
  contêiner: o contêiner grava esse valor a cada início.
- **Tipo de intervalo**: **N horas**, com o **Intervalo de backup (horas)**, ou **Diariamente em um horário**, com o
  **Horário**. O backup só acontece se o sistema estiver no ar nesse momento.
- **Intervalo de retenção (dias)**: os backups mais antigos que isso são apagados. Cada backup é uma cópia completa:
  ajuste a retenção ao espaço em disco.
- **Módulos**: mantenha **Configuração do sistema** e **Dados**.
- **Desativado**: desliga o backup automático e a limpeza dos backups antigos.

Clique em **Salvar**. Uma instalação nova faz um backup a cada 24 horas, guarda 90 dias e inclui os dois módulos.

### 2.2. Criar um backup

Em **Sistema > Backups**, abra **Ações rápidas > Criar backup**, escolha os módulos e clique em **Criar backup**. O
backup aparece na lista e, quando termina, fica com o status **Sucesso**.

### 2.3. Restaurar pela interface

A restauração volta todos os dados ao momento do backup e remove o que foi registrado depois. Avise os usuários antes.
Na linha de um backup com status **Sucesso**, clique em **Restaurar backup**. A confirmação oferece **Criar backup e
restaurar**, que guarda antes o estado atual, e **Restaurar**. A janela mostra o andamento até o fim.

Quando a interface não abre, restaure o arquivo pelo terminal (passo 7).

## 3. Faça um dump do banco

O script `godata-backup.sh` grava um dump do banco (`mongodump --archive --gzip`) e um pacote de `config/` (mais o
`.env` no Docker) em `dumps/`, com a mesma data e hora em UTC no nome. Só o dono lê os arquivos. O script não pede
senha: no pm2, usa a conexão de `atual/server/datasources.json`; no Docker, executa o `mongodump` dentro do contêiner
`mongo`. Ele apaga os dumps com mais de 14 dias. Para outro prazo, acrescente `--keep-days` e o número de dias depois
da pasta da instalação.

### 3.1. No pm2

O script precisa de `node` e `mongodump` no `PATH`.

```bash
"$GODATA_DIR/atual/deploy/scripts/godata-backup.sh" "$GODATA_DIR"
ls -l "$GODATA_DIR/dumps"
```

Resultado esperado: uma linha como `backup ok /opt/godata/dumps/go-data-20261118T023000Z.archive.gz 25MB` e, na
pasta, os arquivos `go-data-<data>.archive.gz` e `config-<data>.tar.gz`, com permissão `-rw-------`. Numa falha, o
script mostra `backup failed:` seguido do motivo e termina com erro. Se outro backup estiver em andamento, o motivo é
`another backup is running`.

### 3.2. No Docker

O sistema precisa estar no ar (`docker compose ps` mostra o contêiner `mongo` em execução).

```bash
"$GODATA_DIR/deploy/scripts/godata-backup.sh" "$GODATA_DIR"
ls -l "$GODATA_DIR/dumps"
```

Resultado esperado: uma linha como `backup ok /opt/godata/dumps/go-data-20261118T023000Z.archive.gz 25MB` e, na
pasta, os arquivos `go-data-<data>.archive.gz` e `config-<data>.tar.gz`, com permissão `-rw-------`. Numa falha, o
script mostra `backup failed:` seguido do motivo e termina com erro. Se outro backup estiver em andamento, o motivo é
`another backup is running`.

## 4. Agende o dump diário

O bloco põe o script no crontab do usuário, todo dia às 2h30 no horário do servidor, com a saída em
`dumps/backup.log`. Ele troca a linha anterior desta instalação, se houver, e mantém as outras linhas do crontab. Para
outro horário, troque `30 2` (minuto e hora) no bloco antes de executar.

### 4.1. No pm2

O cron não carrega o nvm. O bloco grava na linha o `PATH` com a pasta do Node.js em uso. Depois de trocar a versão do
Node.js, execute o bloco de novo.

```bash
command -v node
command -v mongodump
GODATA_CRON="30 2 * * * PATH=$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin $GODATA_DIR/atual/deploy/scripts/godata-backup.sh $GODATA_DIR >> $GODATA_DIR/dumps/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -vF " $GODATA_DIR/dumps/backup.log" || true; echo "$GODATA_CRON") | crontab -
crontab -l
```

Resultado esperado: os caminhos de `node` e `mongodump` e o crontab com uma linha como esta:

```text
30 2 * * * PATH=/home/usuario/.nvm/versions/node/v22.12.0/bin:/usr/local/bin:/usr/bin:/bin /opt/godata/atual/deploy/scripts/godata-backup.sh /opt/godata >> /opt/godata/dumps/backup.log 2>&1
```

### 4.2. No Docker

O usuário precisa usar o `docker` sem `sudo` (grupo `docker`), como nos outros comandos.

```bash
GODATA_CRON="30 2 * * * $GODATA_DIR/deploy/scripts/godata-backup.sh $GODATA_DIR >> $GODATA_DIR/dumps/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -vF " $GODATA_DIR/dumps/backup.log" || true; echo "$GODATA_CRON") | crontab -
crontab -l
```

Resultado esperado: o crontab com esta linha:

```text
30 2 * * * /opt/godata/deploy/scripts/godata-backup.sh /opt/godata >> /opt/godata/dumps/backup.log 2>&1
```

No dia seguinte, `tail -n 5 "$GODATA_DIR/dumps/backup.log"` mostra `backup ok` com o arquivo do dia. Uma falha deixa
no log `backup failed:` seguido do motivo. Confira o log com frequência.

## 5. Copie os backups para fora do servidor

Os dumps, os anexos e os backups do sistema ficam no mesmo disco do banco. Copie-os para outro lugar: uma pasta de
outro servidor montada neste (compartilhamento de rede) ou outro servidor por SSH. Troque `/caminho/do/backup` pelo
destino. Por SSH, use `usuario@servidor:/caminho/do/backup`, com uma chave SSH sem senha para o cron. Use um destino
para cada instalação.

O bloco copia uma vez e agenda a cópia diária às 4h30, depois do dump. A cópia não apaga nada no destino: apague lá
os arquivos antigos conforme a política local.

### 5.1. No pm2

```bash
rsync -a --exclude='*.partial' "$GODATA_DIR/dumps" "$GODATA_DIR/storage" "$GODATA_DIR/backups" /caminho/do/backup/
GODATA_CRON="30 4 * * * rsync -a --exclude='*.partial' $GODATA_DIR/dumps $GODATA_DIR/storage $GODATA_DIR/backups /caminho/do/backup/"
(crontab -l 2>/dev/null | grep -vF " $GODATA_DIR/dumps " || true; echo "$GODATA_CRON") | crontab -
crontab -l
```

Resultado esperado: o `rsync` termina sem erro, o destino passa a ter as pastas `dumps`, `storage` e `backups`, e o
crontab mostra a linha da cópia, além da linha do dump.

### 5.2. No Docker

No Docker, a cópia roda como `root`, que lê as pastas do contêiner.

```bash
sudo rsync -a --exclude='*.partial' "$GODATA_DIR/dumps" "$GODATA_DIR/data/storage" "$GODATA_DIR/data/backups" /caminho/do/backup/
GODATA_CRON="30 4 * * * rsync -a --exclude='*.partial' $GODATA_DIR/dumps $GODATA_DIR/data/storage $GODATA_DIR/data/backups /caminho/do/backup/"
(sudo crontab -l 2>/dev/null | grep -vF " $GODATA_DIR/dumps " || true; echo "$GODATA_CRON") | sudo crontab -
sudo crontab -l
```

Resultado esperado: o `rsync` termina sem erro, o destino passa a ter as pastas `dumps`, `storage` e `backups`, e o
crontab do `root` mostra a linha da cópia.

## 6. Restaure o banco a partir de um dump

A restauração troca o banco pelo conteúdo do dump: tudo o que foi registrado depois dele se perde. O sistema fica fora
do ar do segundo bloco deste passo até o passo 8. Use um dump da versão em uso. Para voltar à versão anterior depois
de uma atualização, siga o [manual de atualização](atualizacao.md).

O primeiro bloco mostra o dump que será restaurado: o mais recente de `dumps/`. Para restaurar outro, por exemplo um
trazido do destino do passo 5, execute `export GODATA_DUMP=` seguido do caminho completo do arquivo e repita o
primeiro bloco.

### 6.1. No pm2

```bash
ls -l "${GODATA_DUMP:-$(ls -1 "$GODATA_DIR"/dumps/*.archive.gz | tail -n 1)}"
```

Resultado esperado: o arquivo do dump, com data e tamanho.

```bash
GODATA_DUMP="${GODATA_DUMP:-$(ls -1 "$GODATA_DIR"/dumps/*.archive.gz | tail -n 1)}"
GODATA_DB="$(node -p 'require(process.argv[1]).mongoDb.database' "$GODATA_DIR/atual/server/datasources.json")"
pm2 stop "$GODATA_PM2"
GODATA_MONGO_CFG="$(mktemp)"
printf "uri: '%s'\n" "$(node "$GODATA_DIR/atual/deploy/lib/db-state.js" print-uri --datasources "$GODATA_DIR/atual/server/datasources.json" | sed "s/'/''/g")" > "$GODATA_MONGO_CFG"
mongorestore --config "$GODATA_MONGO_CFG" --nsInclude="$GODATA_DB.*" --archive="$GODATA_DUMP" --gzip --drop
rm -f "$GODATA_MONGO_CFG"
```

Resultado esperado: o processo parado no pm2 e, no fim, uma linha como `125000 document(s) restored successfully. 0
document(s) failed to restore.` O aviso `The --db and --collection flags are deprecated for this use-case` também
pode aparecer e não afeta a restauração. A conexão com o MongoDB vai num arquivo temporário que só o dono lê, apagado
no fim. Se o `mongorestore` mostrar erro, não inicie o sistema: corrija a causa e execute o bloco de novo. Em seguida,
siga o passo 8.

### 6.2. No Docker

O `mongorestore` roda dentro do contêiner `mongo`, com o usuário `root` do MongoDB e a senha que o próprio contêiner
conhece.

```bash
ls -l "${GODATA_DUMP:-$(ls -1 "$GODATA_DIR"/dumps/*.archive.gz | tail -n 1)}"
```

Resultado esperado: o arquivo do dump, com data e tamanho.

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

Resultado esperado: o contêiner `godata` parado e, no fim, uma linha como `125000 document(s) restored successfully.
0 document(s) failed to restore.` Se o `mongorestore` mostrar erro, não inicie o sistema: corrija a causa e execute o
bloco de novo. Em seguida, siga o passo 8.

## 7. Restaure um backup do sistema a partir do arquivo

Use este passo quando a interface não abre ou para restaurar um backup do sistema trazido de outro lugar. O arquivo
precisa estar na pasta de backups do sistema: `backups/` no pm2, `data/backups/` no Docker. A restauração volta todos
os dados ao momento do backup e remove o que foi registrado depois. O sistema fica fora do ar do segundo bloco deste
passo até o passo 8.

O primeiro bloco mostra o backup que será restaurado: o mais recente da pasta (os nomes começam com `snapshot_` e a
data). Para restaurar outro, execute `export GODATA_SNAPSHOT=` seguido do nome do arquivo, sem a pasta, e repita o
primeiro bloco.

Na saída da restauração, avisos como `DeprecationWarning` e `MaxListenersExceededWarning` aparecem com `"level":
"error"` e são esperados.

### 7.1. No pm2

```bash
ls -l "$GODATA_DIR/backups/${GODATA_SNAPSHOT:-$(ls -1 "$GODATA_DIR/backups" | grep '^snapshot_.*\.zip$' | tail -n 1)}"
```

Resultado esperado: o arquivo do backup, com data e tamanho.

```bash
GODATA_SNAPSHOT="${GODATA_SNAPSHOT:-$(ls -1 "$GODATA_DIR/backups" | grep '^snapshot_.*\.zip$' | tail -n 1)}"
pm2 stop "$GODATA_PM2"
cd "$GODATA_DIR/atual"
npm run restore-backup -- --file="$GODATA_DIR/backups/$GODATA_SNAPSHOT"
```

Resultado esperado: o processo parado no pm2 e, no fim, a linha `Successfully restored backup:` seguida do caminho do
arquivo. Se aparecer `Failed to restore backup`, não inicie o sistema: corrija a causa e execute o bloco de novo. Em
seguida, siga o passo 8.

### 7.2. No Docker

O comando roda num contêiner temporário, com a mesma imagem, a mesma configuração e as mesmas pastas do sistema, que
é apagado no fim.

```bash
sudo ls -l "$GODATA_DIR/data/backups/${GODATA_SNAPSHOT:-$(sudo ls -1 "$GODATA_DIR/data/backups" | grep '^snapshot_.*\.zip$' | tail -n 1)}"
```

Resultado esperado: o arquivo do backup, com data e tamanho.

```bash
cd "$GODATA_DIR"
GODATA_SNAPSHOT="${GODATA_SNAPSHOT:-$(sudo ls -1 "$GODATA_DIR/data/backups" | grep '^snapshot_.*\.zip$' | tail -n 1)}"
docker compose stop godata
docker compose run --rm -T godata npm run restore-backup -- --file="/opt/godata/backups/$GODATA_SNAPSHOT"
```

Resultado esperado: o contêiner `godata` parado e, no fim, a linha `Successfully restored backup:` seguida do caminho
do arquivo dentro do contêiner. Se aparecer `Failed to restore backup`, não inicie o sistema: corrija a causa e
execute o bloco de novo. Em seguida, siga o passo 8.

## 8. Inicie o sistema e confira

Depois de iniciar o sistema, confira no navegador:

- Um administrador entra no sistema e as listas de casos e contatos mostram os dados da data do backup.
- Em **Sistema > Backups > Ações rápidas > Configurações de backup automático**, o **Local** é a pasta de backups da
  instalação. A restauração traz as configurações do sistema gravadas no backup.

### 8.1. No pm2

```bash
pm2 start "$GODATA_PM2"
pm2 logs "$GODATA_PM2" --lines 50 --nostream
```

Resultado esperado: o processo aparece como `online` em `pm2 list` e o log não mostra erros.

### 8.2. No Docker

```bash
cd "$GODATA_DIR"
docker compose start godata
sleep 60
docker compose logs --since 2m godata | grep godata-entrypoint
```

Resultado esperado: as linhas `MongoDB is reachable`, `database has users`, `migrate-database finished` e `starting
Go.Data` seguida da versão. Se `starting Go.Data` ainda não aparecer, aguarde e execute de novo o último comando.

## 9. Teste a restauração

Um backup só vale se puder ser restaurado. De tempos em tempos (por exemplo, a cada três meses), restaure numa cópia
de teste, nunca no servidor em uso:

- Instale a mesma versão num servidor de teste, pelo [manual de instalação](instalacao.md).
- Traga do destino do passo 5 um dump, um backup do sistema e as pastas `storage` e `backups`.
- Siga os passos 6 e 8 com o dump e, em outro momento, os passos 7 e 8 com o backup do sistema.
- Confira o login, o total de casos e contatos e a abertura de alguns anexos.

O mesmo roteiro reconstrói a instalação num servidor novo. Nesse caso, recoloque antes `config/` e, no Docker, o
`.env`, que estão no arquivo `config-<data>.tar.gz` do dump. No Docker, o `.env` precisa estar no lugar antes da
primeira inicialização, porque o MongoDB cria os usuários com as senhas dele.
