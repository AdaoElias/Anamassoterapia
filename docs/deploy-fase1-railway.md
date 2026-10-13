# Fase 1 -- Primeiro ambiente na nuvem (Railway)

Runbook para subir o primeiro ambiente real: API (container a partir do
`Dockerfile`) + Postgres gerenciado, no **Railway**, deploy a partir do
repositorio do **GitHub**, dominio no **subdominio do provedor**.

Escrito no padrao do repositorio: sem acentos.
Contexto e plano geral: `docs/deploy-nuvem.md`.

**Premissas**

- Codigo ja esta num repositorio no GitHub.
- Conta no Railway (https://railway.com).
- O `Dockerfile`, `.dockerignore` e `railway.json` estao na raiz do repositorio
  (Fase 0).

---

## 0. Como o app foi desenhado para a nuvem

Nada disto precisa de mudanca -- so confirme que continua valendo:

- **Mesma origem**: em producao a API serve o SPA e a API de negocio fica sob
  `/api`. Nao ha CORS em jogo e o cookie de refresh e same-site.
- **Porta via `PORT`**: o Railway injeta a porta em `PORT` e o `env.ts` a
  respeita (`API_PORT` explicito venceria, mas o `Dockerfile` nao fixa a porta).
- **Migrations no start**: o `docker/entrypoint.sh` roda `prisma migrate deploy`
  quando `RUN_MIGRATIONS=on` (default).
- **Healthcheck**: `/health/ready` responde 200 quando o banco esta acessivel.
- **Cookie `Secure`**: ligado em producao; so funciona sob HTTPS -- o Railway da
  HTTPS no dominio gerado.
- **`trustProxy`** ja ligado: o IP real atras do proxy e lido do `X-Forwarded-For`
  (usado pelo rate limit).

---

## 1. Criar o projeto e o Postgres

1. No Railway: **New Project** -> **Deploy from GitHub repo** -> escolha o
   repositorio. O Railway detecta o `Dockerfile` (ver `railway.json`).
2. No mesmo projeto: **New** -> **Database** -> **Add PostgreSQL**.

Nao copie a URL do banco a mao: o proximo passo usa a **referencia** para o
Postgres, que aponta para a rede interna (sem SSL, sem egress).

---

## 2. Variaveis de ambiente do servico da API

No servico da API -> **Variables**, adicione:

| Variavel | Valor | Observacao |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | referencia ao plugin; use o nome exato do servico Postgres |
| `JWT_ACCESS_SECRET` | (gerado, >= 32 chars) | passo 3 |
| `JWT_REFRESH_SECRET` | (gerado, >= 32 chars, **diferente** do access) | passo 3 |
| `ANAMNESIS_ENCRYPTION_KEY` | (64 caracteres hex) | passo 3 -- **nao trocar depois** |
| `API_PUBLIC_URL` | `https://SEU-DOMINIO.up.railway.app` | so log/OpenAPI; ajuste apos o passo 4 |
| `WEB_PUBLIC_URL` | `https://SEU-DOMINIO.up.railway.app` | idem |
| `CORS_ORIGINS` | `https://SEU-DOMINIO.up.railway.app` | mesma origem: nao usado, mas coerente |
| `RUN_MIGRATIONS` | `on` | default; em varias replicas, `off` exceto na de release |
| `NOTIFIER_DRIVER` | `log` | trocar por `evolution` quando houver WhatsApp |
| `EMAIL_PROVIDER` | `log` | trocar por `smtp` quando houver e-mail real |

Nao e preciso definir `NODE_ENV`, `API_HOST`, `API_PORT` ou `WEB_DIST_DIR`: o
`Dockerfile` ja fixa `NODE_ENV=production`, `API_HOST=0.0.0.0` e
`WEB_DIST_DIR=/app/apps/web/dist`; a porta vem do `PORT` do Railway.

---

## 3. Gerar os segredos

Rode localmente e cole o resultado nas variaveis do passo 2. **Cada execucao
gera um valor diferente** -- os dois JWT tem de ser distintos.

```powershell
# JWT_ACCESS_SECRET e JWT_REFRESH_SECRET (um por linha; rode 2x)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# ANAMNESIS_ENCRYPTION_KEY (64 hex = 32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **`ANAMNESIS_ENCRYPTION_KEY` e definitiva.** Trocar a chave torna ilegivel
> toda anamnese ja cifrada (AES-256-GCM). Guarde num cofre de segredos com
> backup; nao regenere "para limpar".

---

## 4. Gerar o dominio

No servico da API -> **Settings** -> **Networking** -> **Generate Domain**.
Anote a URL (ex.: `https://massoterapia-production.up.railway.app`) e cole nos
tres campos do passo 2 (`API_PUBLIC_URL`, `WEB_PUBLIC_URL`, `CORS_ORIGINS`).
O Railway reinicia o servico ao salvar as variaveis.

---

## 5. Deploy e migrations

- Cada `git push` no branch conectado dispara um novo build+deploy.
- No start, o `entrypoint.sh` roda `prisma migrate deploy` (8 migrations) e
  depois sobe a API. O healthcheck (`/health/ready`) da 120s de tolerancia.
- Acompanhe em **Deploy Logs**. Linhas esperadas:
  - `[entrypoint] aplicando migrations...`
  - `All migrations have been successfully applied.`
  - `API no ar em https://...`

---

## 6. Smoke test (aceite da Fase 1)

Com o servico no ar, troque `<DOMINIO>`:

| Checagem | Esperado |
| --- | --- |
| `GET https://<DOMINIO>/health` | 200 `{"status":"ok"}` |
| `GET https://<DOMINIO>/health/ready` | 200 com `"database":"up"` |
| `GET https://<DOMINIO>/` | 200 HTML (o SPA carrega no navegador) |
| `GET https://<DOMINIO>/clientes` | 200 HTML (F5 numa rota do app nao da 404) |
| `GET https://<DOMINIO>/api/nao-existe` | 404 JSON |

Pelo navegador: abrir o dominio, fazer login, navegar. Conferir em
DevTools -> Application -> Cookies que `mt_refresh` esta com `Secure`,
`HttpOnly`, `SameSite=Lax` e `Path=/api/auth`.

### Dados para o login (provisorio)

O login exige um `User` + `Clinic`/`ClinicMembership`, que **hoje nascem no
seed**. Para o aceite da Fase 1 (tras HTTPS e proxy) e aceitavel rodar o seed
**uma vez**, consciente de que e dado de demonstracao:

```bash
# Via Railway: abra um shell do servico da API (ou um one-off command)
pnpm --filter @massoterapia/api db:seed
```

Depois do aceite, **nao deixe o seed de demonstracao** no ambiente real: a
criacao de clinica/admin de verdade e a **Fase 2**.

---

## 7. Observacoes e armadilhas (Railway)

- **URL do banco**: use a referencia `${{Postgres.DATABASE_URL}}` (rede interna,
  sem SSL). A URL publica (`...proxy.rlwy.net`) exige SSL e nao e necessaria
  para servicos do mesmo projeto.
- **Uma replica**: comece com 1. Ao escalar, mantenha `RUN_MIGRATIONS=on` em
  **uma** instancia e `off` nas demais (SQLite do Prisma nao existe aqui, mas
  migrations concorrentes ainda brigam pelo catalogo).
- **Pool de conexoes**: hoje `max: 10` por instancia. Com varias replicas,
  considere o pooler do provedor de banco.
- **Build**: o `Dockerfile` faz `pnpm install --frozen-lockfile`; se o
  `pnpm-lock.yaml` estiver desatualizado com algum `package.json`, o build
  falha (rode `pnpm install` local e commite o lockfile).
- **Segredos**: nunca commitar `.env` (ja esta no `.gitignore` e no
  `.dockerignore`). No Railway, tudo vem de **Variables**.
- **Rollback**: o Railway permite redeploy de um deploy anterior; como as
  migrations sao versionadas e para frente, um rollback de codigo pode exigir
  atencao se houver migration nova -- evite "desfazer" uma migration em producao.

---

## 8. Checklist de aceite

- [ ] Postgres criado e `DATABASE_URL` referenciando `${{Postgres.DATABASE_URL}}`.
- [ ] Segredos gerados e distintos (JWT x2) e `ANAMNESIS_ENCRYPTION_KEY` guardada.
- [ ] Dominio gerado e refletido em `API_PUBLIC_URL`/`WEB_PUBLIC_URL`/`CORS_ORIGINS`.
- [ ] Deploy verde nos logs; migrations aplicadas.
- [ ] `/health` e `/health/ready` = 200.
- [ ] SPA abre no dominio e navega (F5 em rota interna nao da 404).
- [ ] Login funciona com cookie `Secure`/`HttpOnly`/`SameSite=Lax`.
- [ ] Decidir sobre o seed de demonstracao (remover antes do uso real).

---

## 9. Depois deste aceite

- **Fase 2**: provisionamento real (clinica + admin + membership) e convite de
  usuario, substituindo o seed (`docs/deploy-nuvem.md`, secao 5 e Fase 2).
- **Fase 3**: login do profissional + RBAC.
- **Fase 4**: CI/CD (build -> migrate -> release -> smoke), observabilidade,
  backups testados, LGPD.
