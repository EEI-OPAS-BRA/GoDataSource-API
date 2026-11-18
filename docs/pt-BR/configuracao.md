# Manual de configuração do Go.Data

[English](../en/configuration.md) · [Instalação](instalacao.md) · [Atualização](atualizacao.md) · [Backup](backup.md)

## Aviso

- Esta distribuição é uma derivação (fork) do Go.Data publicado pela OMS. Não é uma versão da OMS e não tem o seu
  endosso.
- O software é fornecido no estado em que se encontra, sem garantias, sob a licença GPL-3.0.
- O backup é obrigatório. As migrações alteram o banco de dados e não têm desfazer automático.
- Sempre que possível, atualize primeiro uma cópia de teste e reserve uma janela de manutenção.
- Quem opera cada instalação é responsável pelos seus dados, pelo controle de acesso e pelo cumprimento da legislação
  de proteção de dados.
- Problemas devem ser relatados nas issues do repositório da API.

## Como a configuração funciona

O Go.Data lê dois arquivos da pasta `server/`: `config.json`, com as opções da aplicação, e `datasources.json`, com
a conexão com o MongoDB e o servidor de e-mail. Cada versão traz os valores padrão desses dois arquivos.

Os valores próprios da instalação ficam na pasta `config/` da instalação, em dois arquivos com os mesmos nomes. Eles
têm só as chaves que mudam e as atualizações não mexem neles. A configuração em uso é a junção dos padrões da versão
com esses arquivos:

- No pm2, o comando do passo 4 grava `server/config.json` e `server/datasources.json`, e o pm2 reinicia o sistema.
- No Docker, o contêiner faz a junção a cada início. Basta reiniciá-lo.

Regras:

- Mantenha a sintaxe JSON válida: aspas duplas, vírgula entre os itens e nenhuma vírgula depois do último. Um erro
  impede que a configuração seja aplicada, e a mensagem indica o arquivo, a linha e a coluna.
- Objetos são combinados chave a chave. Por exemplo, `"passwordReset": {"from": "..."}` muda só o remetente e mantém
  as outras chaves de `passwordReset`.
- Listas substituem a lista padrão inteira. Em `email.transports`, escreva o servidor de e-mail completo.
- Não edite `server/config.json` nem `server/datasources.json`. Eles são regravados a cada aplicação no pm2, a cada
  início no Docker e a cada atualização.
- Numa atualização, nunca substitua os arquivos novos pelos antigos: a nova versão pode ter chaves que a anterior não
  tinha. A pasta `config/` continua valendo e é aplicada sobre os padrões da nova versão.
- No Docker, a conexão com o MongoDB vem do `.env`, e `host` e `port` são fixos (`0.0.0.0` e `3000` dentro do
  contêiner).

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

Execute os passos com o usuário que opera o Go.Data, sem `sudo`. No Docker, esse usuário precisa usar o `docker` sem
`sudo` (grupo `docker`). Num servidor com duas instalações, execute os passos uma vez para cada uma, com os valores
dela.

## 2. Endereço público, fuso horário e datas

Troque `godata.exemplo.gov.br` pelo endereço que os usuários abrem no navegador e `nao-responda@exemplo.gov.br` pelo
remetente dos e-mails do sistema.

- `public` é o endereço que entra nos links dos e-mails, como o de troca de senha. Com `"port": ""`, vale a porta
  padrão do protocolo (443 em `https`). Se o acesso usa outra porta, informe o número, por exemplo `"port": 8443`.
- `"enableConfigRewrite": false` impede que o Go.Data troque esse endereço. Com `true`, o padrão da OMS, ele regrava
  `public` a cada início com o endereço interno do servidor (no Docker, o IP do contêiner) e depois com o endereço de
  quem acessa pelo navegador. Os links dos e-mails podem sair então com um endereço que os usuários não alcançam.
- `timezone` é o fuso horário das datas. Defina o fuso antes de cadastrar dados: mudá-lo depois pode deslocar datas já
  registradas.
- `dateDisplayFormat` e `dateTimeDisplayFormat` são os formatos de data e de data e hora na interface.
- `session.secret` recebe um valor aleatório, usado pelo captcha (passo 5).

Os blocos dos passos 2, 3, 5, 6 e 7 gravam só as chaves do passo e mantêm as outras chaves do arquivo. Eles podem ser
executados de novo para mudar um valor. Cada execução deste passo sorteia um novo `session.secret`, o que só invalida
os captchas abertos naquele momento.

### 2.1. No pm2

O bloco usa o `node` do servidor e cria o arquivo com leitura só para o dono.

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

Resultado esperado: nenhuma saída. A mudança vale depois do passo 4.

### 2.2. No Docker

O servidor não precisa de Node.js: o bloco roda o `node` da imagem do Go.Data num contêiner temporário, com o seu
usuário e o grupo 1000, que é o grupo do usuário `node` do contêiner. Um arquivo novo fica legível só para o seu
usuário e para o contêiner (permissão `640`, grupo 1000).

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

Resultado esperado: as linhas do `docker compose` sobre o contêiner temporário e nenhum erro. A mudança vale depois do
passo 4.

## 3. Servidor de e-mail

O Go.Data envia por SMTP os e-mails de troca de senha, de alteração de usuário e do código de verificação em duas
etapas. Troque `smtp.exemplo.gov.br`, `usuario-smtp` e `senha-smtp` pelos dados do servidor de e-mail.

- `"port": 465` com `"secure": true` usa TLS desde o início da conexão. Para a porta 587 (STARTTLS), use
  `"port": 587` e `"secure": false`.
- Se o servidor de e-mail não pede autenticação, retire o bloco `auth` e a vírgula antes dele.
- `transports` é uma lista: ela substitui por inteiro o servidor de e-mail padrão.

O bloco grava a chave `email` em `config/datasources.json` e mantém o resto do arquivo. No pm2, o arquivo também
guarda a conexão com o MongoDB, criada na instalação. No Docker, ele só precisa da chave `email`: a conexão com o
MongoDB vem do `.env`.

### 3.1. No pm2

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

Resultado esperado: nenhuma saída. A mudança vale depois do passo 4.

### 3.2. No Docker

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

Resultado esperado: as linhas do `docker compose` sobre o contêiner temporário e nenhum erro. A mudança vale depois do
passo 4.

## 4. Aplique a configuração

### 4.1. No pm2

Execute com o mesmo usuário do pm2, sem `sudo`: os arquivos gerados só podem ser lidos pelo dono.

```bash
node "$GODATA_DIR/atual/deploy/lib/merge-config.js" --defaults "$GODATA_DIR/atual/deploy/defaults" --overrides "$GODATA_DIR/config" --server-dir "$GODATA_DIR/atual/server"
node -p 'require(process.argv[1]).public' "$GODATA_DIR/atual/server/config.json"
pm2 restart "$GODATA_PM2"
pm2 logs "$GODATA_PM2" --lines 50 --nostream
```

Resultado esperado: o primeiro comando não mostra nada e o segundo mostra o endereço público, por exemplo
`{ host: 'godata.exemplo.gov.br', protocol: 'https', port: '' }`. O processo aparece como `online` em `pm2 list` e
o log não mostra erros. Se um arquivo de `config/` tiver erro de sintaxe, o primeiro comando mostra, por exemplo,
`invalid JSON in /opt/godata/config/config.json at line 4 column 5` e não altera nada. Corrija o arquivo e execute o
bloco de novo.

### 4.2. No Docker

```bash
cd "$GODATA_DIR"
docker compose restart godata
sleep 10
docker compose logs --since 1m godata | grep godata-entrypoint
docker compose exec -T -u node godata node -p 'require("/opt/godata/server/config.json").public'
```

Resultado esperado: o log mostra a linha `configuration: server/config.json and server/datasources.json built from
the image defaults and /opt/godata/config` e o último comando mostra o endereço público. Se um arquivo de `config/`
tiver erro de sintaxe, o log mostra, por exemplo, `error: configuration failed: invalid JSON in
/opt/godata/config/config.json at line 4 column 5` e o contêiner reinicia em ciclo até o arquivo ser corrigido. Nessa
mensagem, `/opt/godata/config` é a pasta `config/` da instalação vista de dentro do contêiner. Corrija o arquivo e
execute o bloco de novo.

## 5. Captcha (opcional)

O captcha aparece na tela de login, em **Esqueceu a senha** e nas perguntas de segurança. Ele vem desligado. O bloco
grava a chave `captcha` em `config/config.json` e liga o captcha nas três telas. Para ligar só em algumas, troque
`true` por `false` nas outras antes de executar. Para desligar, execute o bloco com as três em `false`. Em seguida,
aplique (passo 4).

O captcha guarda o texto esperado numa sessão, assinada com `session.secret`. O passo 2 já grava um valor aleatório
nessa chave. Com `session.secret` vazio, cada processo da API sorteia um segredo próprio ao iniciar. Como a API roda
vários processos (um por núcleo do processador), um processo não reconhece a sessão criada por outro e o captcha deixa
de ser conferido em parte dos acessos.

### 5.1. No pm2

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

Resultado esperado: nenhuma saída. Aplique como no passo 4.1.

### 5.2. No Docker

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

Resultado esperado: as linhas do `docker compose` sobre o contêiner temporário e nenhum erro. Aplique como no passo
4.2.

## 6. Chave da API (opcional)

`apiKey` precisa ser igual à chave `apiKey` de `client/dist/assets/runtime-config.json`. A interface lê esse arquivo e
envia a chave ao pedir a versão, o fuso horário e os formatos de data. Com chaves diferentes, a API recusa o pedido e
a interface fica parada na tela de carregamento, sem mostrar a tela de login. O arquivo é público: qualquer navegador
pode lê-lo, então a chave não protege nada.
Ela também entra no QR code de configuração do aplicativo móvel, que não é usado no Brasil.

Os dois arquivos trazem o valor padrão `your_api_key_here`, que pode ser mantido. Para trocar a chave, o primeiro
bloco grava em `config/config.json` um valor aleatório. O valor em si não importa: ele só precisa ser igual nos dois
arquivos, e o segundo bloco cuida disso.

### 6.1. No pm2

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

Resultado esperado: nenhuma saída.

O comando de aplicar recebe também `--runtime-config`, que grava a mesma chave em
`atual/client/dist/assets/runtime-config.json`. Cada atualização traz um `runtime-config.json` novo, com a chave
padrão: depois de cada atualização, execute de novo só este segundo bloco.

```bash
node "$GODATA_DIR/atual/deploy/lib/merge-config.js" --defaults "$GODATA_DIR/atual/deploy/defaults" --overrides "$GODATA_DIR/config" --server-dir "$GODATA_DIR/atual/server" --runtime-config "$GODATA_DIR/atual/client/dist/assets/runtime-config.json"
pm2 restart "$GODATA_PM2"
```

Resultado esperado: `runtime config: changed` na primeira vez e `runtime config: unchanged` nas seguintes. Depois de
recarregar a página no navegador, a tela de login mostra a versão do sistema.

### 6.2. No Docker

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

Resultado esperado: as linhas do `docker compose` sobre o contêiner temporário e nenhum erro.

O contêiner copia a chave para `runtime-config.json` a cada início, inclusive depois das atualizações. Basta
reiniciá-lo:

```bash
cd "$GODATA_DIR"
docker compose restart godata
sleep 10
docker compose logs --since 1m godata | grep godata-entrypoint
```

Resultado esperado: o log mostra `runtime config: changed` na primeira vez e `runtime config: unchanged` nos inícios
seguintes. Depois de recarregar a página no navegador, a tela de login mostra a versão do sistema.

## 7. Origens permitidas (opcional)

Com `cors.enabled` em `false`, o padrão, a API aceita chamadas de navegador vindas de qualquer site. Com `true`, ela
aceita só as chamadas vindas do endereço público (`public`, passo 2), das origens listadas em `whitelist` e as
chamadas sem origem, feitas por outros servidores. O endereço público precisa estar correto: com `true` e um `public`
errado, a própria interface deixa de funcionar.

O bloco grava a chave `cors` em `config/config.json`. Para aceitar outras origens, escreva-as na lista antes de
executar, cada uma com o protocolo e sem barra no fim, por exemplo `"whitelist": ["https://painel.exemplo.gov.br"]`.
A lista substitui a padrão por inteiro. Para desligar, execute o bloco com `"enabled": false`. Em seguida, aplique
(passo 4).

### 7.1. No pm2

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

Resultado esperado: nenhuma saída. Aplique como no passo 4.1.

### 7.2. No Docker

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

Resultado esperado: as linhas do `docker compose` sobre o contêiner temporário e nenhum erro. Aplique como no passo
4.2.

## Conexão com o MongoDB

No pm2, a conexão fica na chave `mongoDb` de `config/datasources.json`, criada na instalação:

| Chave | Valor |
| --- | --- |
| `host`, `port` | Servidor e porta do MongoDB, por exemplo `127.0.0.1` e `27017` |
| `database` | Nome do banco, por exemplo `go-data` |
| `user`, `password` | Usuário e senha do Go.Data no MongoDB |
| `authSource` | Banco em que o usuário foi criado, normalmente `admin` |

A senha pode ter qualquer caractere: o comando do passo 4 monta o endereço de conexão (`mongoDb.url`) com os
caracteres especiais codificados. Não preencha `mongoDb.url` à mão.

No Docker, a conexão vem do `.env`:

| Variável | Para que serve |
| --- | --- |
| `GODATA_VERSION` | Versão da imagem, sem o `v` inicial (por exemplo `2026.10.0`) |
| `GODATA_BIND` | Interface do servidor em que a porta fica aberta. Use `127.0.0.1` quando o nginx do mesmo servidor atende o Go.Data |
| `GODATA_PORT` | Porta do servidor que leva ao Go.Data (padrão `3000`) |
| `GODATA_DB` | Nome do banco (padrão `go-data`) |
| `MONGO_ROOT_PASSWORD`, `GODATA_MONGO_PASSWORD` | Senhas dos usuários `root` e `godata` do MongoDB, geradas na instalação |

- Mudanças no `.env` valem com `docker compose up -d`. O `docker compose restart` não relê o `.env`.
- Depois da primeira inicialização, não mude `GODATA_DB` nem as senhas. O MongoDB cria os usuários uma única vez, com
  a pasta `data/mongo` vazia, e o Go.Data deixaria de se conectar.
- Não defina no terminal variáveis com esses nomes: o `docker compose` usa o valor do terminal no lugar do `.env`.

## Chaves de config.json

| Chave | Para que serve |
| --- | --- |
| `host`, `port` | Endereço e porta em que a API escuta (padrão `0.0.0.0` e `3000`). No pm2, use uma porta para cada instância do servidor e `"host": "127.0.0.1"` quando só o nginx do próprio servidor acessa a API. No Docker, são fixos: use `GODATA_BIND` e `GODATA_PORT` no `.env` |
| `public.protocol`, `public.host`, `public.port` | Endereço que os usuários abrem, usado nos links dos e-mails. Veja o passo 2 |
| `enableConfigRewrite` | Com `true` (padrão), o Go.Data regrava `public` sozinho. Use `false` com `public` preenchido |
| `timezone` | Fuso horário, por exemplo `America/Sao_Paulo` |
| `dateDisplayFormat`, `dateTimeDisplayFormat` | Formatos de data e de data e hora, por exemplo `DD/MM/YYYY` e `DD/MM/YYYY HH:mm` |
| `passwordReset.from` | Remetente dos e-mails do sistema |
| `apiKey` | Opcional. Precisa ser igual à chave de `client/dist/assets/runtime-config.json`. Veja o passo 6 |
| `captcha` | Captcha no login, em **Esqueceu a senha** e nas perguntas de segurança. Veja o passo 5 |
| `cors` | Origens de onde um navegador pode chamar a API. Veja o passo 7 |
| `session.secret` | Segredo da sessão do captcha. Vazio, cada processo da API sorteia um valor ao iniciar. Veja o passo 5 |
| `backUp.password` | Senha que cifra os backups do sistema. Vazia, os backups não são cifrados. Um backup cifrado só é restaurado por uma instalação com a mesma senha |

## Chaves de datasources.json

| Chave | Para que serve |
| --- | --- |
| `mongoDb` | Conexão com o MongoDB: `host`, `port`, `database`, `user`, `password`, `authSource`. No Docker, vem do `.env` |
| `email.transports` | Servidor SMTP: `host`, `port`, `secure`, `auth.user`, `auth.pass`. Veja o passo 3 |
