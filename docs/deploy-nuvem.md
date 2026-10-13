# Deploy na nuvem e multiusuario

Estudo de como levar o Massoterapia de "roda na minha maquina" para um app web
hospedado, usado por varias pessoas e varias clinicas. Escrito no mesmo padrao do
resto do repositorio: sem acentos.

**Data:** 13 de outubro de 2026
**Status:** estudo / plano. **Fase 0 (empacotamento) implementada** -- ver secao 6.
Codigo da Fase 0 validado em modo producao local (login, SPA na mesma origem,
prefixo `/api`); a imagem Docker ainda nao foi construida (Docker ausente na
maquina de desenvolvimento).

---

## 1. Objetivo

1. O app estar **na nuvem**, acessivel por qualquer pessoa de qualquer lugar.
2. Ser **multiusuario de verdade**: varias clinicas (tenants) e varios usuarios
   por clinica, com papeis.
3. Nao reescrever o que ja funciona: o modelo multi-tenant ja existe no banco.

O ponto de partida importante: **este app ja e web**. E um SPA (React + Vite) que
fala com uma API HTTP (Fastify) e um Postgres. O que falta nao e "virar web", e
**hospedar** e **transformar o modelo multi-tenant em operacao real**.

---

## 2. Estado atual: o que ja ajuda

Varias decisoes de arquitetura ja apontam para a nuvem. Conferido no codigo:

- **Multi-tenant no schema.** `clinicId` em toda tabela de negocio
  (`docs/arquitetura.md`, secao "Multi-tenant com clinicId em tudo"). Isolamento
  garantido nas queries (`updateMany({ where: { id, clinicId } })`).
- **Identidade global + papeis por clinica.** `User` (login, e-mail unico) e
  `ClinicMembership` (role por clinica) em `apps/api/prisma/schema.prisma:227` e
  `:264`. O e-mail e global; o papel e do vinculo.
- **Login com escolha de clinica.** `escolha_de_clinica` quando o usuario tem
  mais de uma membership; o refresh carrega `membershipId` (a sessao sabe *de
  qual* clinica ela e).
- **API stateless.** Access JWT (15 min) + refresh opaco rotativo. Nao ha estado
  em memoria por sessao, entao varias replicas atendem sem "sticky session".
- **`trustProxy: true`** (`apps/api/src/app.ts:102`): o IP real atras de proxy e
  lido de `X-Forwarded-For`, o que o rate limit usa.
- **Health checks separados** (`/health` e `/health/ready`), com timeout de 3s no
  readiness -- contrato pronto para load balancer/orquestrador.
- **Config por ambiente validada com Zod** (`apps/api/src/config/env.ts`): em
  producao le do ambiente; sem `.env` obrigatorio.
- **SSL automatico no Postgres** fora de localhost
  (`apps/api/src/lib/prisma.ts:31`) -- serve Neon/Supabase/RDS sem mudar codigo.
- **Cookie desenhado para producao**: `httpOnly`, `SameSite=Lax`, `Secure` so em
  producao (`apps/api/src/plugins/auth.ts:126`).
- **Sem Redis**: a fila (`pg-boss`) roda no proprio Postgres
  (`docs/arquitetura.md`, "PostgreSQL como unico armazenamento"). Menos um
  servico para hospedar.
- **Helmet com CSP restritiva** (`connectSrc: 'self'`), HSTS em producao.

**Conclusao:** a base esta pronta. O trabalho e de empacotamento, hospedagem e
provisionamento -- nao de reescrita.

---

## 3. Decisao central: servir tudo na mesma origem

Em desenvolvimento o Vite faz proxy de `/api` para `127.0.0.1:3333`
(`apps/web/vite.config.ts:22`). Isso remove CORS e deixa o cookie de refresh
same-site. **Em producao esse proxy nao existe** -- e o jeito como o web alcanca
a API define o resto (cookie, CORS, CSP).

### 3.1 Opcao recomendada -- mesma origem, API na frente

Web e API no **mesmo dominio**. O navegador so fala com um host; a API atende
tanto `/auth`, `/clients`, etc. quanto serve os arquivos estaticos do SPA.

Duas maneiras de montar isso:

- **(a) A API serve o SPA.** Adicionar `@fastify/static` na API, apontando para
  `apps/web/dist`, com fallback de SPA (qualquer GET que nao seja rota de API
  devolve `index.html`). Um unico processo para hospedar; CI/CD simples.
- **(b) Reverse proxy (Caddy/Nginx) na frente.** O proxy manda `/api/*` (ou os
  prefixos da API) para o backend e o resto para os arquivos do SPA. A API nao
  carrega responsabilidade de servir HTML.

Vantagens (nas duas): cookie same-site (sem `SameSite=None`), **sem CORS**,
CSP `connectSrc: 'self'` continua valida. E a configuracao que ja vale em dev,
entao nao ha divergencia dev x producao -- que o proprio repo diz ser a origem
classica de bug que so aparece no deploy.

### 3.2 Opcao descartada -- dois dominios

`app.dominio.com` (web) e `api.dominio.com` (API). Exige:

- `CORS_ORIGINS` com a origem do web + `credentials: true`;
- cookie `SameSite=None` + `Secure` (e a discussao de cookie de terceiros nos
  navegadores);
- CSP `connectSrc` com a origem da API;
- `VITE_API_URL` absoluto no build.

Mais pecas moveis e mais fragil. So vale se houver motivo forte (ex.: CDN de
borda separado).

### 3.3 Sobre o prefixo `/api`

Hoje ha uma divergencia sutil, registrada em `docs/arquitetura.md` (secao
"Cookie"): o `path` do cookie e `/api/auth` em dev (porque o proxy remove `/api`)
e `/auth` em producao. Ou seja, hoje o web em dev chama `/api/...` e em producao
chamaria a API direto na raiz.

Recomendacao: **fixar um unico prefixo** para a API, igual nos dois ambientes.
Duas saidas:

- **Servir a API sob `/api` tambem em producao** (proxy ou `prefix: '/api'` no
  registro das rotas). Entao `VITE_API_URL=/api` e o path do cookie `/api/auth`
  valem sempre. E a opcao mais previsivel.
- Ou **API na raiz** (`VITE_API_URL=''`), como o doc atual sugere. Funciona, mas
  colide o namespace do SPA com o da API (uma rota de SPA chamada `/clients`
  viraria chamada de API).

Preferencia adotada: **prefixo `/api` em todos os ambientes.** Elimina a classe
inteira de bug "funciona em dev, quebra no deploy".

> Decidido e implementado na Fase 0: as rotas de negocio sao registradas sob
> `env.apiPrefix` (`/api` em producao, vazio em dev/test -- onde o proxy do Vite
> remove o `/api`). `VITE_API_URL=/api` e o `path` do cookie `/api/auth` valem
> nos dois ambientes. Ver secao 6 e `apps/api/src/config/env.ts`.

---

## 4. Arquitetura alvo (opcao recomendada)

```
                    Internet
                       |
                 [ TLS / dominio ]
                       |
          +------------+-------------+
          |                          |
   (a) API serve o SPA        (b) Caddy/Nginx
   [ container Node ]               |
     /            \          +------+------+
  /api/*        resto        |             |
     |            |        /api/*        resto (estaticos)
     |            |          |             |
     +-----+------+----------+-------------+
           |
     [ API Fastify ]  (1+ replicas)
           |    \
           |     +-- worker pg-boss (no processo; escala na Fase 4)
           |
     [ Postgres gerenciado ]  (SSL, backup automatico)
```

- **Postgres gerenciado**: Neon, Supabase, Railway, RDS, etc. Requer SSL (o
  codigo ja ativa fora de localhost) e backup.
- **API**: um container Node (Render, Railway, Fly.io, VPS). Stateless, entao
  pode escalar horizontalmente.
- **Web**: build estatico (`pnpm --filter @massoterapia/web build`) servido pela
  propria API (a) ou por CDN (b).
- **Migrations**: rodar `prisma migrate deploy` **uma vez** por release (job de
  release / init container), nunca em cada replica ao mesmo tempo.

---

## 5. Multiusuario de verdade

O modelo ja suporta N clinicas e N usuarios por clinica. O que falta e **como os
tenants e usuarios passam a existir** sem ser pelo seed.

Hoje: o tenant "nasce no seed" (comentario em `apps/api/src/routes/clients.ts`) e
ja existe `.env` apontando para a clinica de demonstracao. Para producao real:

### 5.1 Provisionamento de clinica

Fluxo a criar (substitui o seed em producao):

1. **Criar a clinica**: `Clinic` com `slug` unico (o slug e o seletor de tenant do
   portal publico), `name`, `timezone`.
2. **Criar o usuario administrador**: `User` (e-mail unico, `passwordHash` via
   Argon2id) + `ClinicMembership` com `role = ADMIN`.
3. Tudo numa `$transaction`: clinica sem admin e inacessivel; admin sem clinica
   e credencial sem destino.

Duas formas de expor isso:

- **Onboarding publico (self-signup)**: uma tela `/criar-conta` que cria a
  clinica e o admin. Precisa de protecao antiabuso (captcha, rate limit, talvez
  verificacao de e-mail).
- **Provisionamento interno**: um endpoint de superadmin ou um script de CLI
  (`pnpm provision`) que cria a clinica sob demanda. Mais simples e mais seguro
  para comecar.

Preferencia inicial: **provisionamento interno** (script/endpoint), self-signup
depois.

_Implementado:_ CLI `pnpm --filter @massoterapia/api provision` (ver Fase 2).

### 5.2 Gestao de usuarios e memberships

Endpoints e telas para o ADMIN da clinica:

- listar/convidar/desativar usuarios da clinica (`ClinicMembership.active`);
- definir o `role` de cada um (`ADMIN`, `PROFESSIONAL`, ...);
- convite gera um token (mesmo padrao ja usado em anamnese/reset de senha) para a
  pessoa **definir a propria senha** -- nunca trafegar senha em claro por e-mail.

_Implementado:_ rotas `GET/POST/PATCH/DELETE /users` (todas `ADMIN`) em
`apps/api/src/routes/users.ts` e a tela `Usuarios` (`apps/web/src/pages/
UsuariosPage.tsx`, rota `/usuarios`, visivel so para ADMIN). O convite reusa
`PasswordResetToken` (sem migracao nova): cria ou reaproveita o `User`, cria a
membership e emite o link `/redefinir-senha?token=...`. Com `NOTIFIER_DRIVER=log`
o link volta na resposta para repasse manual; com e-mail ligado ele so vai por
e-mail (`inviteLink: null`). A clinica nao pode ficar sem ADMIN ativo
(`LAST_ADMIN`, 409). A tela publica `/redefinir-senha` (`RedefinirSenhaPage.tsx`)
atende convite e recuperacao.

### 5.3 Login do profissional

Pendencia conhecida (Etapa 3, `docs/arquitetura.md` e `memoria.md`): hoje o
profissional nao tem `User` (`userId` nulo) e, portanto, **nao faz login**. Para
multiusuario real:

- ao criar/convidar um profissional, opcionalmente criar o `User` + membership
  `PROFESSIONAL`;
- revisar o RBAC por rota: profissional acessa o proprio painel, agenda e
  prontuario, mas **nao** o financeiro nem a gestao de usuarios.

### 5.4 Cliente

O cliente do portal **nao faz login** hoje (token no link / slug). Recomendacao:
**manter assim**. E menos atrito e ja tem o padrao "token como credencial"
(anamnese). Area logada do cliente so se houver demanda real (esta nas decisoes
adiadas do doc de arquitetura).

### 5.5 Isolamento e RBAC

- Manter **toda** escrita por `clinicId` (regra ja existente). Um bug de
  isolamento em SaaS multi-tenant e vazamento de dado de outra clinica.
- Revisar cada rota: leitura x escrita x papel minimo.

---

## 6. Fases

### Fase 0 -- Empacotar para deploy (implementada)

Topologia decidida: **a API serve o SPA na mesma origem** (secao 3.1a), com o
prefixo `/api` fixo.

Mudancas de codigo:

- `apps/api/src/config/env.ts`: novas variaveis `API_PREFIX` (default `/api` em
  producao, vazio fora) e `WEB_DIST_DIR`; expostos como `env.apiPrefix`.
- `apps/api/src/app.ts`: as rotas de negocio sao registradas dentro de um
  contexto filho com `prefix: env.apiPrefix`; `@fastify/static` serve
  `apps/web/dist` em producao e o `notFoundHandler` devolve `index.html` para
  navegacao do SPA (mas mantem JSON 404 para `/api`, `/health` e `/docs`).
- `apps/api/src/plugins/auth.ts`: `path` do cookie de refresh fixado em
  `/api/auth` nos dois ambientes.
- `pnpm-workspace.yaml` / `apps/api/package.json`: dependencia `@fastify/static`.
- `Dockerfile`, `.dockerignore`, `docker/entrypoint.sh`, `docker-compose.yml`.
- `.env.example`: documenta `API_PREFIX` e `WEB_DIST_DIR`.

Como rodar:

```bash
# Build local (shared -> api -> web)
pnpm --filter @massoterapia/shared build
pnpm --filter @massoterapia/api build
pnpm --filter @massoterapia/web build

# Subir em modo producao (a API serve o SPA em http://localhost:3333)
NODE_ENV=production node apps/api/dist/index.js
```

```bash
# Container local (API + Postgres) sem depender do Postgres da maquina
docker compose up --build
# app: http://localhost:3333     API: http://localhost:3333/api
```

Release (uma vez por versao; com varias replicas, em um unico job):

```bash
pnpm --filter @massoterapia/api db:migrate:deploy
```

Verificado em modo producao local: `/health` e `/health/ready` = 200; `/` e
`/clientes` devolvem `index.html`; `/api/*` devolve JSON (404/401); assets com
200; login devolve `accessToken` e o cookie `mt_refresh` com
`Path=/api/auth; HttpOnly; Secure; SameSite=Lax`. Suite da API: 241 testes.

Pendente desta fase: construir e subir a imagem Docker (Docker nao esta
instalado na maquina de desenvolvimento).

### Fase 1 -- Subir um ambiente na nuvem

Provedor escolhido: **Railway** (API container + Postgres gerenciado), deploy a
partir do repositorio do GitHub, dominio no subdominio do provedor. Runbook
completo e passo a passo: **`docs/deploy-fase1-railway.md`**. O repositorio ja
traz `railway.json` (builder Dockerfile + healthcheck `/health/ready`).

- Postgres gerenciado + backup.
- Deploy da API (container) + web (mesma origem) + TLS + dominio.
- Segredos no provedor (JWT, `ANAMNESIS_ENCRYPTION_KEY`).
- `CORS_ORIGINS`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL` do ambiente.
- Smoke test: `/health/ready`, login, portal publico, envio de anamnese.

> Ajuste de codigo feito para o provedor: `API_PORT` agora cai para a variavel
> `PORT` quando ela existe (Railway/Render), e o `Dockerfile` nao fixa mais a
> porta. Ver `apps/api/src/config/env.ts`.

### Fase 2 -- Provisionamento real

- **CLI de provisionamento (5.1) -- implementado.**
  `pnpm --filter @massoterapia/api provision -- --name "Clinica Wave" --email
  admin@exemplo.com`, com a senha em `PROVISION_ADMIN_PASSWORD` (recomendado:
  nao aparece no `ps` nem no historico) ou `--senha` (avisa que e inseguro).
  Cria `Clinic` + `User` admin + `ClinicMembership` `ADMIN` numa transacao.
  Opcionais: `--slug`, `--admin-name`, `--timezone`, `--legal-name`, `--cnpj`,
  `--clinic-email`, `--phone`, `--admin-phone`. Falha com mensagem clara se o
  slug ou o e-mail ja existem (nada e criado). Fonte:
  `apps/api/scripts/provision.ts`.
- **Gestao de usuarios e memberships (5.2) -- implementado.**
  Rotas `GET /users`, `POST /users/invites`, `PATCH /users/:id`, `DELETE
  /users/:id` (todas `ADMIN`), schemas em `packages/shared/src/schemas/user.ts`,
  testes em `apps/api/tests/users.test.ts`. No web, tela `Usuarios`
  (`/usuarios`, ADMIN) para listar/convidar/editar/desativar e pagina publica
  `/redefinir-senha`. O convite reusa `PasswordResetToken` (sem migracao nova).
  Com `NOTIFIER_DRIVER=log` o link de definicao de senha volta na resposta;
  ligado o e-mail, vai so por e-mail.
- Seed de demonstracao: **ja bloqueado** em producao por `assertNotProduction`
  (`apps/api/prisma/seed.ts`).

### Fase 3 -- Multiusuario operacional

- Login do profissional + RBAC revisado (secao 5.3).
- Tela de gestao de usuarios/memberships.

### Fase 4 -- Hardening

- CI/CD de deploy (build -> migrate -> release -> smoke).
- Observabilidade: agregacao de logs (pino), uptime, alerta no readiness.
- Rate limit de borda (proxy/WAF).
- PWA (manifest + service worker) -- ja na Etapa 8 do roadmap.
- LGPD: consentimento, exportacao e exclusao de dados, retencao, DPO.
- Backups testados (restore, nao so dump).
- Worker de fila separado, se a escala exigir.

---

## 7. Variaveis de ambiente por ambiente

Base em `.env.example`. Em producao, todas vem do provedor (sem `.env`).

| Variavel | Dev | Producao |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` |
| `DATABASE_URL` | Postgres local | Postgres gerenciado (SSL) |
| `API_HOST` | `127.0.0.1` | `0.0.0.0` (container) |
| `API_PORT` | `3333` | a do provedor |
| `API_PREFIX` | vazio (proxy remove `/api`) | `/api` (default) |
| `WEB_DIST_DIR` | vazio (nao usado) | `apps/web/dist` (a imagem define o caminho) |
| `API_PUBLIC_URL` | `http://localhost:3333` | `https://api.dominio...` ou mesma origem |
| `WEB_PUBLIC_URL` | `http://localhost:5173` | `https://dominio...` |
| `CORS_ORIGINS` | `http://localhost:5173` | origem do web (ou vazio, se mesma origem) |
| `JWT_*`, `ANAMNESIS_ENCRYPTION_KEY` | `.env` | segredos do provedor (fixos!) |
| `NOTIFIER_DRIVER` | `log` | `evolution` (WhatsApp) ou `email` |
| `EMAIL_PROVIDER` | `log` | `smtp` |
| `VITE_API_URL` | `/api` | `/api` (mesma origem) |

---

## 8. Checklist de producao

- [x] Prefixo da API fixado (`/api`) e cookie coerente (Fase 0).
- [ ] TLS + dominio; HSTS ativo (ja em producao via Helmet).
- [ ] Segredos fora do repositorio e **estaveis** (trocar
      `ANAMNESIS_ENCRYPTION_KEY` torna anamnese antiga ilegivel).
- [ ] `prisma migrate deploy` no release (uma vez).
- [ ] Seed de demonstracao **desligado** em producao.
- [ ] Postgres com backup automatico e restore testado.
- [ ] Pool de conexoes adequado (com varias replicas, usar o pooler do provedor
      -- hoje o pool e `max: 10` por instancia).
- [ ] Observabilidade: logs agregados, alerta de readiness.
- [ ] Rate limit considerando o proxy (`trustProxy` ja ligado).
- [ ] LGPD: consentimento, exportacao/exclusao, retencao.

---

## 9. Riscos e armadilhas

- **CSP `connectSrc: 'self'`**: se web e API ficarem em origens diferentes sem
  ajuste, todas as chamadas de API quebram no navegador.
- **`ANAMNESIS_ENCRYPTION_KEY`**: perder a chave = perder a anamnese (dado de
  saude cifrado em AES-256-GCM). Guardar em cofre de segredos, com backup.
- **Migrations concorrentes**: nunca rodar `migrate deploy` em varias replicas ao
  mesmo tempo; isolar em um job.
- **Worker pg-boss in-process**: ok com uma instancia; ao escalar, o locking do
  pg-boss cobre, mas considerar worker dedicado (Fase 4).
- **Pool por instancia**: muitas replicas x `max: 10` podem estourar o limite de
  conexoes do Postgres gerenciado -- usar pooler/PgBouncer.
- **Divergencia dev x prod no caminho da API**: resolver na Fase 0 (prefixo
  unico). E a origem classica de bug que so aparece no deploy.

---

## 10. Provedores de exemplo (nao prescritivo)

| Camada | Opcoes |
| --- | --- |
| Postgres gerenciado | Neon, Supabase, Railway, AWS RDS |
| API (container) | Render, Railway, Fly.io, VPS com Docker |
| Web estatico | mesma origem (API) ou Vercel/Netlify/CDN |
| WhatsApp | Evolution API (auto-hospedada) -- ja previsto no codigo |
| E-mail | SMTP (Resend, Postmark, SES, Mailgun) |
| Segredos | variaveis do provedor / Doppler / SSM |

---

## Pendencias deste estudo

- Confirmar/ajustar a topologia (secao 3) -- decisao de produto/deploy
  (Fase 0 adotou API servindo o SPA sob `/api`).
- Fase 0 implementada; falta construir e subir a imagem Docker e validar no
  provedor (Fase 1).
- Detalhar o plano tecnico de multiusuario (secao 5) quando a Fase 2 comecar.
