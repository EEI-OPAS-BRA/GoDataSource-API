# Ambiente local — MongoDB

```
local/
├── docker-compose.yaml       # serviço "mongo"
├── godatabckp/go-data/       # dump a ser restaurado
└── init/restore-dump.sh      # restore automático (docker-entrypoint-initdb.d)
```

## Subir o banco (primeira vez)

```bash
cd local
docker compose up -d
docker compose logs -f mongo
```

Restore roda automático só quando o volume `mongo-data` está vazio (comportamento padrão do
`docker-entrypoint-initdb.d`).

## Reaplicar o backup (volume já existe)

**Opção A — reset do volume** (apaga dados atuais, dispara restore automático de novo):
```bash
cd local
docker compose down
docker volume ls | grep mongo   # confirme o nome, ex: init_mongo-data
docker volume rm <nome-do-volume>
docker compose up -d
```

**Opção B — mongorestore manual** (sem apagar o volume):
```bash
docker exec -it godata-mongo mongorestore --drop /dump
```

## Conferir conexão

```bash
docker exec -it godata-mongo mongosh --eval "db.getMongo().getDBNames()"
```
Porta: `localhost:27017`, sem autenticação.

## Parar / remover

```bash
docker compose down       # mantém volume/dados
docker compose down -v    # remove volume/dados
```
