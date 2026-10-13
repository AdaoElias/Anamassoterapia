# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Imagem unica de build + run.
#
# O monorepo usa pnpm: os node_modules sao pontes simbolicas com caminhos
# relativos entre si. Copiar "so o que roda" para um segundo estagio quebraria
# esses links; um estagio unico mantem tudo intacto e e o caminho confiavel
# para o primeiro deploy. A reducao de tamanho (pnpm deploy/prune, estagio de
# runtime separado) fica como proximo passo -- ver docs/deploy-nuvem.md.
#
# Node 24 para casar com o .nvmrc do repositorio.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim

# HUSKY=0: nao ha .git no contexto de build, e o hook de prepare nao tem o que
# instalar. Sem isto o `pnpm install` pode falhar.
ENV HUSKY=0 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

# corepack habilita a versao de pnpm fixada em packageManager (12.6.0).
RUN corepack enable

WORKDIR /app

# 1) Apenas os manifestos: o cache de camada do Docker reaproveita o install
#    enquanto o lockfile nao mudar. Todos os projetos do workspace precisam
#    estar presentes, senao o --frozen-lockfile acusa workspace inconsistente.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

# Sem `--mount=type=cache`: o Railway exige que o `id` do cache mount siga o
# formato `s/<service-id>-...`; um id arbitrario faz o build falhar com
# "missing the cacheKey prefix". Abrir mao do cache mount mantem o Dockerfile
# valido em qualquer builder; a camada de install ainda e cacheada pelo Docker.
RUN pnpm install --frozen-lockfile

# 2) Codigo-fonte. Mudar codigo nao invalida a camada de install acima.
COPY . .

# 3) Prisma Client + build de todos os pacotes.
#    O DATABASE_URL abaixo e so um placeholder: `prisma generate` nao abre
#    conexao, mas o prisma.config.ts exige a variavel definida. Passado inline
#    para nao vazar para o runtime.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
    pnpm --filter @massoterapia/api db:generate \
 && pnpm --filter @massoterapia/shared build \
 && pnpm --filter @massoterapia/api build \
 && pnpm --filter @massoterapia/web build

# 4) Runtime: em producao a API serve o SPA na mesma origem (prefixo /api) e
#    escuta em todas as interfaces do container. NAO fixamos API_PORT: o
#    provedor (Railway/Render) injeta a porta em PORT e o env.ts a respeita;
#    sem PORT, o default e 3333.
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    WEB_DIST_DIR=/app/apps/web/dist

EXPOSE 3333

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/api/dist/index.js"]
