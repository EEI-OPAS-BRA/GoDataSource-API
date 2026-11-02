# Guia de atualização para o Go.Data 2026.10.0

[English](../en/upgrade.md) · [Notas de versão](notas-de-versao.md)

## Aviso

- Esta distribuição é uma derivação (fork) do Go.Data publicado pela OMS. Não é uma versão da OMS e não tem o seu
  endosso.
- O software é fornecido no estado em que se encontra, sem garantias, sob a licença GPL-3.0.
- O backup é obrigatório. As migrações alteram o banco de dados e não têm desfazer automático.
- Sempre que possível, atualize primeiro uma cópia de teste e reserve uma janela de manutenção.
- Quem opera cada instalação é responsável pelos seus dados, pelo controle de acesso e pelo cumprimento da legislação
  de proteção de dados.
- Problemas devem ser relatados nas issues do repositório da API.

## A quem se aplica

Instalações do Go.Data 2.x instaladas pelo código-fonte em Linux e executadas com pm2. O procedimento monta a nova
versão numa pasta ao lado da atual, que fica intacta e serve para voltar à versão anterior.

## Antes de começar

Confira no servidor:

- Node.js 22 LTS (`node -v`), npm e pm2.
- Ferramentas do MongoDB: `mongodump`, `mongorestore` e `mongosh`.
- Espaço livre em disco de pelo menos duas vezes o tamanho do banco, mais 3 GB.
- Cerca de 4 GB de memória livre para compilar a interface. Se o servidor não tiver essa memória, compile a interface
  em outra máquina com Node.js 22 (passo 5) e copie a pasta gerada para o servidor.

Planeje também:

- Uma janela de manutenção, com os usuários avisados. O sistema fica fora do ar entre os passos 7 e 9.
- Os textos em português dos termos do sistema são regravados na atualização. Traduções personalizadas por importação
  de planilha nesses termos serão substituídas.
- O endereço de residência habitual passa a ser obrigatório para casos e contatos, exceto em surtos configurados com
  endereço opcional. Combine com as equipes como tratar os registros antigos sem endereço.

## 1. Defina as variáveis

Ajuste os valores à sua instalação e execute no mesmo terminal em que fará todos os passos. Se o terminal for
fechado, execute este bloco de novo.

```bash
export GODATA_TAG=v2026.10.0
export GODATA_ATUAL=/opt/godata/atual
export GODATA_NOVA=/opt/godata/2026.10.0
export GODATA_BACKUP=/opt/godata/backup-2026.10.0
export GODATA_PM2=godata
export GODATA_DB=go-data
export GODATA_MONGO_URI=mongodb://127.0.0.1:27017
```

- `GODATA_ATUAL`: pasta da API em uso, a que contém `server/config.json`.
- `GODATA_NOVA` e `GODATA_BACKUP`: pastas novas, que ainda não existem.
- `GODATA_PM2`: nome do processo no pm2 (`pm2 list`).
- `GODATA_DB` e `GODATA_MONGO_URI`: banco e endereço do MongoDB, conforme `server/datasources.json`. Se o MongoDB
  exigir autenticação, inclua usuário, senha e `authSource` no endereço.
- Para testar uma versão candidata, use a tag dela em `GODATA_TAG`, por exemplo `v2026.10.0-rc.2`.

## 2. Registre o estado atual

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

Resultado esperado: o total de casos, contatos e eventos não excluídos e o total de relacionamentos. Esses números
são comparados no passo 10.

## 3. Faça o backup

```bash
mongodump --uri="$GODATA_MONGO_URI" --db="$GODATA_DB" --archive="$GODATA_BACKUP/$GODATA_DB.archive.gz" --gzip
cp -a "$GODATA_ATUAL/server/config.json" "$GODATA_ATUAL/server/datasources.json" "$GODATA_BACKUP/"
tar -C "$GODATA_ATUAL" -czf "$GODATA_BACKUP/storage-backups.tar.gz" server/storage backups
ls -lh "$GODATA_BACKUP"
```

Resultado esperado: o arquivo do banco, os dois arquivos de configuração e o pacote com os anexos e os backups do
sistema, todos com tamanho maior que zero. Guarde uma cópia do backup fora do servidor. Não apague a pasta
`GODATA_ATUAL`: ela é o caminho de volta.

## 4. Baixe a nova versão

```bash
mkdir -p "$GODATA_NOVA/api" "$GODATA_NOVA/frontend"
cd "$GODATA_NOVA"
curl -fL -o api.tar.gz "https://github.com/EEI-OPAS-BRA/GoDataSource-API/archive/refs/tags/$GODATA_TAG.tar.gz"
curl -fL -o frontend.tar.gz "https://github.com/EEI-OPAS-BRA/GoDataSource-FrontEnd/archive/refs/tags/$GODATA_TAG.tar.gz"
tar -xzf api.tar.gz -C api --strip-components=1
tar -xzf frontend.tar.gz -C frontend --strip-components=1
```

Resultado esperado: as pastas `api` e `frontend` com o código da versão.

## 5. Instale as dependências e compile a interface

```bash
cd "$GODATA_NOVA/api"
npm ci --no-audit --no-fund
cd "$GODATA_NOVA/frontend"
npm ci --no-audit --no-fund
npm run build
rm -rf "$GODATA_NOVA/api/client/dist"
cp -a "$GODATA_NOVA/frontend/dist" "$GODATA_NOVA/api/client/dist"
```

Resultado esperado: os comandos terminam sem erro e `api/client/dist` contém `index.html`. A compilação da
interface leva alguns minutos. Se ela for feita em outra máquina, copie a pasta `frontend/dist` gerada lá para
`api/client/dist` no servidor.

## 6. Leve a configuração da instalação atual

Compare os arquivos de configuração. Não substitua os arquivos novos pelos antigos: a nova versão pode ter chaves que
a anterior não tinha.

```bash
diff "$GODATA_ATUAL/server/config.json" "$GODATA_NOVA/api/server/config.json"
diff "$GODATA_ATUAL/server/datasources.json" "$GODATA_NOVA/api/server/datasources.json"
```

Copie para os arquivos em `GODATA_NOVA/api/server/` os valores próprios da sua instalação:

- `datasources.json`: conexão com o MongoDB (servidor, porta, banco, usuário, senha, `authSource`) e configuração de
  e-mail.
- `config.json`: porta, endereço público pelo qual os usuários acessam o sistema, configuração de backup e qualquer
  outro valor alterado localmente.

Em seguida, leve os anexos e os backups do sistema:

```bash
rm -rf "$GODATA_NOVA/api/server/storage" "$GODATA_NOVA/api/backups"
cp -a "$GODATA_ATUAL/server/storage" "$GODATA_NOVA/api/server/storage"
cp -a "$GODATA_ATUAL/backups" "$GODATA_NOVA/api/backups"
```

## 7. Pare a instância atual

A partir deste passo o sistema fica fora do ar.

```bash
pm2 stop "$GODATA_PM2"
pm2 delete "$GODATA_PM2"
```

A configuração anterior do processo ficou registrada em `pm2-before.txt` no passo 2.

## 8. Migre o banco de dados

```bash
cd "$GODATA_NOVA/api"
npm run migrate-database
```

Resultado esperado: o comando termina sem erro. A migração pode levar vários minutos e é mais demorada em
instalações anteriores à 2.50. Se ela falhar, não execute de novo: siga [Voltar à versão anterior](#voltar-à-versão-anterior).

## 9. Inicie a nova versão

```bash
cd "$GODATA_NOVA/api"
pm2 start npm --name "$GODATA_PM2" --time -- start
pm2 save
pm2 logs "$GODATA_PM2" --lines 50 --nostream
```

Resultado esperado: o processo aparece como `online` em `pm2 list` e o log não mostra erros.

## 10. Confira

```bash
mongosh "$GODATA_MONGO_URI" --quiet --file "$GODATA_BACKUP/counts.js" > "$GODATA_BACKUP/counts-after.txt"
diff "$GODATA_BACKUP/counts-before.txt" "$GODATA_BACKUP/counts-after.txt"
```

Resultado esperado: nenhuma diferença. Depois confira no navegador:

- A tela de login mostra a versão `2.51.0 - build 2026.10.0`.
- Um administrador e um usuário com restrição geográfica entram no sistema e veem as listas de casos, contatos e
  relacionamentos esperadas para cada um.
- Uma cadeia de transmissão é gerada.
- Nas configurações de cada surto, revise as novas opções de visibilidade geográfica, criação em outro município,
  endereço opcional, bloqueio de exclusão de endereço, edição em massa de questionário e os campos de endereço e de
  documentos.

## Voltar à versão anterior

Se a falha ocorreu antes do passo 7, a instância anterior não foi alterada: basta não continuar. A partir do passo 7,
pare a nova versão e restaure o banco do backup:

```bash
pm2 stop "$GODATA_PM2"
pm2 delete "$GODATA_PM2"
mongorestore --uri="$GODATA_MONGO_URI" --nsInclude="$GODATA_DB.*" --archive="$GODATA_BACKUP/$GODATA_DB.archive.gz" --gzip --drop
cd "$GODATA_ATUAL"
pm2 start npm --name "$GODATA_PM2" --time -- start
pm2 save
```

Se a falha foi na migração, os dois primeiros comandos avisam que o processo não existe, o que é esperado. Se o
processo anterior era iniciado de outra forma, use o comando e a pasta registrados em `pm2-before.txt`. Por fim,
repita a conferência do passo 10: as contagens devem ser iguais às de `counts-before.txt` e a tela de login deve
mostrar a versão anterior.
