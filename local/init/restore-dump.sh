#!/usr/bin/env bash
# Executado automaticamente pelo entrypoint oficial do mongo (docker-entrypoint-initdb.d)
# SOMENTE na primeira inicialização, quando o volume mongo-data ainda está vazio.
set -euo pipefail

DUMP_DIR="/dump"

if [ -d "${DUMP_DIR}/go-data" ]; then
  echo ">> Restaurando dump de ${DUMP_DIR}/go-data ..."
  mongorestore --drop "${DUMP_DIR}"
  echo ">> Restauração concluída."
else
  echo ">> Nenhum dump encontrado em ${DUMP_DIR}/go-data, pulando restauração."
fi
