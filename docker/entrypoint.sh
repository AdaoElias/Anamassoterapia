#!/bin/sh
# Entrypoint da imagem de producao.
#
# Roda as migrations do Prisma antes de subir a API e depois executa o CMD.
# Em deploy com varias replicas, migrations concorrentes brigam pelo mesmo
# advisory lock/catalogo: deixe RUN_MIGRATIONS=on em UMA unica instancia (job
# de release) e desligue nas demais.
set -e

if [ "${RUN_MIGRATIONS:-on}" = "on" ]; then
  echo "[entrypoint] aplicando migrations (prisma migrate deploy)..."
  pnpm --filter @massoterapia/api db:migrate:deploy
else
  echo "[entrypoint] RUN_MIGRATIONS!=on: pulando migrations."
fi

exec "$@"
