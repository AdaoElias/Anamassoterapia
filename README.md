# Massoterapia

Plataforma de gestao e agendamento online para clinicas de massoterapia.

- **Cliente** acessa um link publico, ve a agenda de cada profissional, escolhe
  terapia e horario, e recebe confirmacao por WhatsApp e e-mail.
- **Profissional** cadastra-se com registro profissional, declara as terapias que
  domina, define disponibilidade e acessa o **prontuario completo do cliente**
  (anamnese versionada e cifrada + contraindicacoes com alerta, sem bloqueio).
- **Administrador** mantem o cardapio de terapias, a equipe e o financeiro
  (recebido x a receber, pacotes e comissoes).

## Stack

| Camada      | Escolha                                                |
| ----------- | ------------------------------------------------------ |
| Monorepo    | pnpm workspaces + Turborepo                            |
| Frontend    | React 19, TypeScript, Vite 8, Tailwind 4, TanStack Query |
| Backend     | Fastify 5, TypeScript, Zod 4, OpenAPI 3.1              |
| Banco       | PostgreSQL 16 + Prisma 7                               |
| Fila        | pg-boss (fila no proprio Postgres, sem Redis)          |
| Auth        | Argon2id + JWT com refresh em cookie httpOnly           |
| Testes      | Vitest                                                  |

Decisoes e o porque de cada uma estao em `docs/arquitetura.md`.

## Pre-requisitos

- Node.js 22.13+ (`.nvmrc` fixa a 24)
- pnpm 12
- PostgreSQL 16

## Setup

```bash
pnpm install
cp .env.example .env      # gere segredos reais, veja abaixo
pnpm db:migrate
pnpm db:seed
pnpm dev                  # api em :3333, web em :5173
```

### Segredos do `.env`

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Gere um valor para `ANAMNESIS_ENCRYPTION_KEY` (64 hex). Os segredos de JWT podem
ser qualquer string com 32+ caracteres, mas diferentes entre si.

### Banco de dados

```sql
CREATE ROLE massoterapia WITH LOGIN PASSWORD 'sua-senha' CREATEDB;
CREATE DATABASE massoterapia_dev OWNER massoterapia;
CREATE DATABASE massoterapia_test OWNER massoterapia;
-- necessario para a constraint anti-duplo-agendamento e para uuid
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

## Comandos

| Comando                | O que faz                                            |
| ---------------------- | ---------------------------------------------------- |
| `pnpm dev`             | Sobe api e web em paralelo                          |
| `pnpm dev:api`         | So a API, com reload                                 |
| `pnpm dev:web`         | So o frontend                                        |
| `pnpm check`           | Formato + lint + tipos + testes + build (gate local) |
| `pnpm test`            | Testes                                               |
| `pnpm test:coverage`   | Testes com cobertura                                  |
| `pnpm build`           | Build de producao de todos os pacotes                |
| `pnpm db:migrate`      | Cria/aplica migration do Prisma                      |
| `pnpm db:seed`         | Dados de demonstracao                                 |
| `pnpm db:studio`       | Prisma Studio para inspecionar o banco               |

Verificacoes manuais, fora da suite (precisam do Postgres local):

| Script                                              | O que faz                                                  |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm --filter @massoterapia/api exec tsx scripts/verify-constraints.ts` | Confere as garantias do banco com SQL de verdade |
| `pnpm --filter @massoterapia/api exec tsx scripts/fila-smoke.ts`          | Sobe a fila do pg-boss e confirma que um aviso sai e outro espera a hora |

Documentacao interativa da API: <http://localhost:3333/docs>

## Estrutura

```
apps/
  api/        Fastify, Prisma, rotas
  web/        React, Vite, componentes
packages/
  shared/     Tipos, enums do dominio e schemas Zod usados por api e web
```

`packages/shared` e a unica fonte de verdade do contrato entre frontend e
backend. Um schema de anamnese cadastrado la aparece validado na API e tipado no
formulario do portal, sem divergencia.

## Qualidade

O `pre-commit` roda `lint-staged` (ESLint + Prettier nos arquivos alterados).
O `pre-push` roda typecheck e testes. O CI roda o gate completo em cada PR.

## Roadmap

| Etapa | Entrega                                                       | Estado |
| ----- | ------------------------------------------------------------- | ------ |
| 0     | Fundacao: monorepo, tooling, CI, banco                       | **OK**  |
| 1     | Schema Prisma, migrations, seed                               | **OK**  |
| 2     | Autenticacao e papeis (admin / profissional / cliente)        | **OK**  |
| 3     | Cadastros: clinica, profissional, cliente, cardapio de terapias | **OK**  |
| 4a    | Disponibilidade, motor de slots e agenda do admin            | **OK**  |
| 4b    | Portal publico do cliente: escolher terapia, profissional e horario | **OK**  |
| 5a    | Notificacoes no backend: outbox, fila, gatilhos e worker     | **OK**  |
| 5b    | Tela de notificacoes e reenvio manual no painel             | **OK**  |
| 6a    | Prontuario, anamnese versionada e alertas (API)               | **OK**  |
| 6b    | Tela de prontuario e formulario de anamnese do cliente        | **OK**  |
| 7     | Financeiro: recebido, a receber, pacotes, comissoes, relatorios | **OK**  |
| 8     | Testes ponta a ponta, LGPD, PWA, deploy                      |         |
