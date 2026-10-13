# Memoria

Registro do que foi feito, pedido por pedido, com a solucao aplicada e como
foi verificada. Escrito no mesmo padrao do resto do repositorio: sem acentos,
porque o resto do projeto segue ASCII (ver `docs/arquitetura.md`).

**Data da sessao:** 6 de outubro de 2026
**Escopo:** identidade visual premium do painel web (redesign completo)
**Estado:** commitado e pushado (`7cfc8b2`). `main` sincronizada com `origin/main`.

---

## 1. Solicitacoes e solucoes

### 1.1 "Rodar as migrations e deixar o schema pronto"

**Solicitacao.** Deixar a persistencia utilizavel: schema multi-tenant, migrations
aplicadas e cliente Prisma gerado.

**Solucao.** Schema com 29 tabelas, `clinicId` em tudo, dinheiro em centavos e
agenda em UTC. Migracoes aplicadas com `migrate deploy` (o `migrate dev
--create-only` exige TTY neste ambiente e trava sem interacao).

Client Prisma gerado em `apps/api/src/generated/prisma`, com `@prisma/adapter-pg`
e `pg` porque o Prisma 7 nao abre conexao sozinho: a string de conexao saiu do
bloco `datasource` e foi para `apps/api/prisma.config.ts`.

**Arquivos.** `apps/api/prisma/schema.prisma`, `apps/api/prisma.config.ts`,
`apps/api/src/lib/prisma.ts`

**Verificacao.** `prisma migrate status` -> "Database schema is up to date!"

### 1.2 "Separar liveness de readiness"

**Solicitacao.** Ter dois endpoints de saude, porque misturar os dois cria loop de
restart quando o Postgres reinicia.

**Solucao.** `GET /health` nao toca no banco. `GET /health/ready` consulta o
servidor, com timeout de 3s e resposta 503 generica. A string de erro do driver
(carrega host, porta, usuario e senha) fica no log, nunca na resposta.

**Verificacao.** `{"status":"ready","database":"up","databaseVersion":"16.15"}`
contra o banco real.

### 1.3 "Cifrar a anamnese"

**Solicitacao.** Guardar dado de saude sem texto legivel no banco.

**Solucao.** AES-256-GCM em `apps/api/src/lib/anamnesis-crypto.ts`, payload
`v1:<iv>:<tag>:<ciphertext>`. GCM em vez de CBC porque traz autenticacao: alterar
um byte faz a decifragem falhar em vez de devolver lixo. IV sorteado a cada
cifragem, porque reusar IV expoe a relacao entre dois textos. `templateId` fica
dentro da cifra, para dar para saber com qual formulario um registro antigo foi
respondido. `contentHash` (SHA-256) detecta adulteracao sem decifrar.

**Verificacao.** 15 testes em `tests/anamnesis-crypto.test.ts`.

### 1.4 "Deixar o M:N de terapia e contraindicacao explicito"

**Solicitacao.** O vinculo era M:N implicito e nao tinha onde guardar override.

**Solucao.** Virou a tabela `therapy_contraindications`, com `clinicId`,
`severity` e `requiresMedicalClearance` sobrescrevendo o catalogo global. M:N
implicito nao aceita coluna; descobrir isso depois custaria migrar e reescrever
queries.

**Verificacao.** Migration `20260927211833_therapy_contraindication_join`.

### 1.5 "Impedir duplicata financeira, de pacote e de comissao"

**Solicitacao.** O gateway reenvia webhook, o cliente clica duas vezes, o balcao
digita o mesmo nome de pacote.

**Solucao.** Tres chaves unicas: `FinancialEntry (clinicId, idempotencyKey)`,
`Package (clinicId, clientId, name)` e `Commission (appointmentId, professionalId)`.
Todas com coluna anulavel de proposito: no PostgreSQL `NULL` nunca conflita num
indice unico, que e exatamente o efeito desejado para lancamento sem chave.

**Verificacao.** Migration `20260927213000_finance_idempotency` + 4 testes.

### 1.6 "Fechar o bug do bloqueio de dia inteiro duplicado"

**Solicitacao.** O balcao clica "bloquear o dia" e nasce outra linha.

**Solucao.** O unique de 4 colunas nao protegia esse caso: dia inteiro e gravado
com `startMinute = NULL`, e `NULL` nunca conflita. Pior, o `upsert` do Prisma vira
`start_minute = NULL`, que nunca e verdadeiro, entao o seed criava linha nova a
cada execucao. As colunas continuam anulaveis ("janela ausente" e "dia inteiro"
sao estados diferentes, e o CHECK `availability_exceptions_extra_has_window`
depende disso); a chave que fecha a brecha e um indice unico parcial.

**Verificacao.** Migration `20260927220000_availability_all_day_unique` + 2 testes.

### 1.7 "Escrever o seed de demonstracao"

**Solicitacao.** Seed confiavel e repetivel, sem `as never` nem assercao nao nula.

**Solucao.** Reescrito com mapas e helpers que falham alto, validacao de
CPF/CNPJ/telefone, e `upsert` em tudo. Clinic Wave, 6 usuarios, 6 terapias,
2 profissionais, 15 regras de disponibilidade, 3 clientes, 2 anamneses cifradas,
1 pacote, 6 agendamentos, 6 lancamentos.

Dois bugs seus foram corrigidos no caminho:
- usava id de `Professional` onde a FK exigia `User`
- o offset de `America/Sao_Paulo` era aplicado duas vezes, deslocando a agenda em
  tres horas (agenda exibia seg 10:00, ter 15:00 e qui 09:00 em vez do esperado)

**Verificacao.** Duas execucoes consecutivas, contagens de 29 tabelas
**byte-identicas** antes e depois.

### 1.8 "Como testar o app?" (pergunta feita no fim da sessao)

**Resposta curta.** Ver secao 3.

---

## 2. Bugs encontrados nos testes (o mais importante da sessao)

### 2.1 A suite escrevia no banco de dev

**Sintoma.** `tests/setup.ts` tinha o comentario "a suite roda contra
massoterapia_test, nunca contra o banco de dev" e nao fazia a troca.
`TEST_DATABASE_URL` existia no `.env` e nunca era lido.

**Por que importa.** Um teste que grava escreve no banco de trabalho, e o registro
fantasma aparece semanas depois. Pior: o seed compartilha o mesmo banco de dev,
entao o estrago sobrevive a um `migrate reset`.

**Solucao.** `setup.ts` troca `DATABASE_URL` por `TEST_DATABASE_URL` e **recusa a
rodar** se o banco nao terminar em `_test`. Falhar no bootstrap e o unico momento
em que o engano ainda e barato.

### 2.2 Doze testes passavam sem verificar nada

**Sintoma.** O helper `emTransacao` chamava `await fn(client)` e **descartava** o
valor de retorno. Os 12 testes de recusa recebiam `undefined` e comparavam com um
SQLSTATE, entao "passavam". Inclusive "excecao EXTRA sem janela de horario" e
"sobreposicao de profissional rejeitada" davam verde sem a constraint de verdade
estar ativa.

**Por que importa.** E o oposto do que o teste existe para provar. Um teste que
passa sem exercitar a garantia e pior que teste ausente: ele documenta uma
promessa que nao existe.

**Solucao.** `emTransacao<T>` virou generico e propaga o retorno do callback.
E, para nao confiar no meu proprio conserto, fiz um **controle negativo**: inverti
uma expectativa de `23505` para `23514` e confirmei que o teste falha com
`expected '23505' to be '23514'`. Depois reverti.

**Reflexao que virou regra no doc.** `await expect(...).rejects.toThrow()` sem
codigo passa com qualquer erro, inclusive erro de digitacao no proprio SQL. As
constraints sao testadas pelo SQLSTATE (`23P01` exclusao, `23514` check, `23505`
unico), porque e desse codigo que a API deriva 409 e 422. Isso foi para
`docs/arquitetura.md`, secao "Verificacao".

### 2.3 O CI nunca migrava o banco

**Sintoma.** O workflow tinha um servico Postgres e um passo de "preparar
extensoes", mas nunca rodava `prisma generate` nem `migrate deploy`.

**Por que importa.** Em banco limpo, `typecheck` falha por modulo inexistente
(`src/generated/prisma`) e nao por erro de codigo. O passo de extensoes era
redundante: a migration `20260927000001_extensions` ja cria `btree_gist` e
`pgcrypto` com `IF NOT EXISTS`.

**Solucao.** Reescrito o pipeline: generate, migrate deploy, format, lint,
typecheck, seed, testes, `db:verify`, build. Env no nivel do job, porque o `.env`
e gitignored.

### 2.4 Override do ESLint nunca casou

**Sintoma.** O override era `files: ['**/*.config.{js,ts}', 'scripts/**/*.{js,ts}']`
com a intencao de liberar `console` em scripts de CLI.

**Por que importa.** No flat config, `files` casa caminhos relativos a **raiz do
config**, nao ao pacote. `scripts/**` nunca alcança `apps/api/scripts/`. A regra
ficava inativa e o `console.log` do runner acusava 4 warnings.

**Solucao.** `**/scripts/**/*.{js,ts}`.

### 2.5 Cache do Turbo nao via a chave de criptografia

**Sintoma.** `globalEnv` so tinha `NODE_ENV` e `DATABASE_URL`.

**Por que importa.** Cache de teste reusado com outra `ANAMNESIS_ENCRYPTION_KEY`
ou outro `TEST_DATABASE_URL` daria verde sem ter testado nada.

**Solucao.** Adicionados `TEST_DATABASE_URL`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET` e `ANAMNESIS_ENCRYPTION_KEY`.

### 2.6 `buildApp` nao permitia testar o caminho de falha

**Solucao.** `BuildAppOptions.readyProbe`, injetavel. Derrubar o Postgres de
verdade em teste seria lento e nao deterministico; o que importa e a resposta
HTTP, nao a queda do servidor.

### 2.7 Task `test` do Turbo declarava output inexistente

**Sintoma.** `outputs: ["coverage/**"]`, mas sem `--coverage` nada e gerado, e
todo `pnpm test` imprimia "no output files found". Mudado para `[]`, que e o
comportamento efetivo de antes.

---

## 3. Como testar o app

### 3.1 Subir tudo

```bash
pnpm dev
```

Sobe a API e o web juntos. Ja existe `.env` na raiz e o banco `massoterapia_dev`
esta migrado e semeado, entao nao ha passo previo.

### 3.2 O que conferir

| Endereco | O que e | Resultado esperado |
| --- | --- | --- |
| http://127.0.0.1:3333/health | liveness, nao toca no banco | `200 {"status":"ok"}` |
| http://127.0.0.1:3333/health/ready | readiness, consulta o banco | `200 {"status":"ready","databaseVersion":"16.15"}` |
| http://127.0.0.1:3333/docs | Swagger UI | abre a documentacao OpenAPI |
| http://127.0.0.1:5173 | portal web | porta do Vite |

`/docs` so existe fora de producao. Para ver o contrato em JSON, `/docs/json`.

### 3.3 Porta ocupada

A API leva alguns segundos para subir (`tsx` + Fastify + Prisma). Se
`pnpm dev:api` reclamar de EADDRINUSE, ja existe uma instancia rodando. Nesta
sessao havia um processo antigo (PID 24488, iniciado as 22:44) segurando a 3333,
e ele respondia 200 normalmente. Para achar e encerrar:

```powershell
Get-NetTCPConnection -LocalPort 3333 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### 3.4 Testes automatizados

```bash
pnpm test                  # 61 testes (42 da API + 19 do shared)
pnpm --filter @massoterapia/api test   # so a API
```

### 3.5 Verificar as garantias do banco

```bash
pnpm --filter @massoterapia/api db:verify
```

Roda as 15 verificacoes de `prisma/verify/constraints.sql` dentro de uma
transacao com `ROLLBACK`, entao nao deixa residuo. Sem isso, uma constraint
removida por engano passa: a suite TypeScript fixa SQLSTATE, mas `db:verify` e o
unico que cobre as 15 de uma vez.

O script imprime o resultado em `RAISE NOTICE`, e `NOTICE` nao afeta exit code.
O runner (`apps/api/scripts/verify-constraints.ts`) captura o evento `notice` do
driver `pg` e converte a excecao final do bloco `DO` em exit code diferente de
zero. Sem esse passo, o CI passaria com "FALHOU" scrollsando no meio do log.

### 3.6 Banco

```bash
pnpm --filter @massoterapia/api db:studio   # abrir o Prisma Studio
pnpm --filter @massoterapia/api db:seed     # rodar o seed (idempotente)
```

Login do seed: `admin@clinicawave.com.br`, senha `Wave@2026` para todos os 6
usuarios. Link publico: `/agendar/clinica-wave`.

### 3.7 Antes de abrir um PR

```bash
pnpm check    # format:check + lint + typecheck + test + build
```

---

## 4. Verificacao final

| Item | Resultado |
| --- | --- |
| Migrations no `massoterapia_test` | 6 de 6 aplicadas |
| `db:verify` | 15/15 |
| Testes da API | 42/42 |
| Testes do shared | 19/19 |
| Testes novos nesta sessao | 39 (15 cripto + 6 readiness + 18 constraints) |
| `pnpm check` | exit 0 |
| Idempotencia do seed | 29 tabelas byte-identicas em 2 execucoes |
| Banco de dev | PostgreSQL 16.15 |

Testes novos por arquivo:

- `tests/anamnesis-crypto.test.ts` - round-trip, IV unico, adulteracao de byte e
  de tag, chave errada, chave de tamanho errado, payload malformado, versao
  desconhecida, conteudo que nao e JSON, JSON sem `templateId`, JSON sem
  `answers`
- `tests/ready.test.ts` - 200, 503 por falha, 503 por timeout de 3s, probe real
  no banco, liveness de pe com readiness caido, e a resposta sem vazar detalhe de
  conexao
- `tests/db-constraints.test.ts` - 7 de agenda, 3 de anamnese, 4 de financeiro,
  4 de disponibilidade

---

## 5. Estado do repositorio

Nada foi commitado. ultimo commit: `20b2a74 chore: funda o projeto (Etapa 0)`.

Arquivos alterados: `.github/workflows/ci.yml`, `.gitignore`,
`apps/api/package.json`, `apps/api/src/app.ts`, `apps/api/tests/setup.ts`,
`apps/api/tsconfig.json`, `docs/arquitetura.md`, `eslint.config.js`,
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`.

Arquivos novos: `apps/api/prisma.config.ts`, `apps/api/prisma/`,
`apps/api/scripts/`, `apps/api/src/lib/`, `apps/api/src/routes/ready.ts`,
`apps/api/tests/anamnesis-crypto.test.ts`, `apps/api/tests/db-constraints.test.ts`,
`apps/api/tests/ready.test.ts`, `iniciar.bat`, `parar.bat`, `scripts/`,
`memoria.md`.

### Pendencias conhecidas

- **E-mail do git ainda `Elias <elias@localhost>`.** Corrigir antes de qualquer
  push, senao a autoria fica errada no historico.
- **`prisma migrate reset --force` nao foi executado.** O Prisma bloqueia o
  comando para agentes de IA, e o usuario decidiu nao autorizar. O banco de teste
  foi atualizado com `migrate deploy`, que e aditivo. O reset em banco vazio
  acontece sozinho no CI, em todo push.
- **Autenticacao entregue na Etapa 2.** A Etapa 1 entregou `/health` e
  `/health/ready`; a Etapa 2 somou `/auth/*` (login, refresh, logout, `/me`,
  recuperacao e redefinicao). Profissionais, clientes, agenda e financeiro vem
  nas proximas etapas.

---

## 6. Inicializador de duplo clique

O usuario pediu um inicializador: um atalho ou script que ele clica duas vezes e o
app abre. A escolha foi um `.bat` na raiz, sem instalar atalho no menu iniciar nem
exigir algum ferramenta nova.

### Arquivos

- `iniciar.bat` - faz abootstrap completo e sobe o app.
- `parar.bat` - encerra o que ocupa 3333 e 5173.
- `scripts/criar-env.mjs` - cria o `.env` com segredos aleatorios.

### Por que `scripts/criar-env.mjs` e nao `node -e` dentro do `.bat`

Tres motivos, todos descobertos tentando fazer funcionar dentro do batch:

1. **Copiar `.env.example` nao sobe o app.** O placeholder de
   `ANAMNESIS_ENCRYPTION_KEY` no exemplo nao e hexadecimal, e o `env.ts` rejeita no
   bootstrap. Sem gerar segredo, o primeiro duplo clique morre com um erro de
   configuracao que parece nao ter relacao com a causa.
2. **`node -e "..."` dentro de `for /f '...'` quebra o quoting.** O codigo do
   Node usa aspas simples, que sao o delimitador do `for /f`.
3. **`pnpm exec tsx` nao serve aqui**, porque o `.bat` roda o script antes do
   `pnpm install` -- `tsx` ainda nao esta instalado. Da o `.mjs`: JS puro, zero
   build, roda com `node` em qualquer maquina.

O script substitui as tres linhas no `.env` copiado em vez de anexar, para nao
deixar chave duplicada com o placeholder antigo ainda visivel ao lado do segredo.

### Por que labels em vez de blocos `if (...)`

Dentro de um bloco entre parenteses, todo `%VAR%` e expandido quando o bloco e
lido, nao quando a linha executa. `for /f` atribuindo uma variavel e usando ela na
linha seguinte do mesmo bloco devolve vazio, sem erro nenhum. A primeira versao do
`iniciar.bat` tinha exatamente esse bug nos segredos do `.env`. O fluxo inteiro usa
`goto`, que nao sofre com isso.

### Por que duas janelas

API e web sao servicos separados, com logs separados. Um terminal so esconde qual
dos dois quebrou - e `turbo run dev --parallel` ainda sequestra o teclado quando
chamado de batch. Um `.bat` precisa devolver o controle, entao cada servico ganha
uma janela propria, e o `.bat` so espera e abre o navegador.

### Defeito encontrado no teste end-to-end

A primeira versao esperava **so** a API antes de abrir o navegador. No teste real
a API sobe em ~1s e o Vite leva ~2.5s para servir a primeira pagina, entao o
navegador abriu numa pagina morta. Agora o launcher espera 3333 **e** 5173, e cada
espera tem mensagem de erro propria.

Os dois servicos usam porta fixa (`strictPort`), entao falha por porta ocupada e
uma mensagem util, nao um portal silenciosamente em outra porta quebrando o proxy
de `/api`.

### Uso

```
iniciar.bat    duplo clique: sobe API + web e abre http://127.0.0.1:5173
parar.bat      duplo clique: encerra o que estiver em 3333 e 5173
```

### Verificacao feita

| Item | Resultado |
| --- | --- |
| `criar-env.mjs` gera segredos | 64 hex em cada uma das 3 chaves |
| `.env` gerado passa no Zod | `env validado OK` |
| Chaves duplicadas apos o script | 0 |
| `iniciar.bat` end-to-end | 6 migrations, banco atualizado, `API respondendo` e `Portal respondendo` |
| App completo | 3333 `/health` `/health/ready` `/docs` = 200; 5173 raiz e `/api/health` via proxy = 200 |
| Labels x `goto`/`call` | 17 destinos, todos resolvidos |
| Finais de linha dos `.bat` | CRLF, 0 LF solto |
| `pnpm check` | exit 0 |

O `.env` real foi preservado: o teste rodou sobre uma copia e o arquivo foi
restaurado com SHA-256 identico.

### Lacunas de tooling encontradas e corrigidas

`scripts/criar-env.mjs` estava **fora de todos os gates**, e o gate passant dava
falsa seguranca:

- `format` e `format:check` usavam glob sem `mjs`, entao o arquivo nunca era
  checado. Incluido.
- `lint` da raiz era so `turbo run lint`, que alcanca apenas `apps/*`.
  `scripts/` da raiz nunca foi lintado. Agora a raiz roda `eslint scripts` antes.
- Sem `tsconfig.json` na raiz, o `projectService` do typescript-eslint rejeitava o
  `.mjs` com "not found by the project service". Resolvido com
  `allowDefaultProject`.
- O override de `no-console` para scripts cobria `.{js,ts}` e nao `.mjs`, o que
  teria forbidding o `console.log` de um script de CLI. Incluido `mjs,cjs`.

Depois disso apareceram 2 erros de tipagem reais no script (parametro e `catch` sem
tipo, ambos `any` pela ausencia de tsconfig), corrigidos com JSDoc.

---

## 7. Autenticacao (Etapa 2)

Objetivo: fechar a autenticacao full-stack -- API com Argon2id, access JWT
curto, refresh opaco rotativo, recuperacao de senha e uma tela minima de login
no web.

### 7.1 O que foi entregue

- `apps/api/src/lib/jwt.ts` - JWT HS256 com `node:crypto`, `alg` fixo e
  `timingSafeEqual`. Sem dependencia nova.
- `apps/api/src/lib/password.ts` - Argon2id; o seed passou a usar o mesmo
  modulo.
- `apps/api/src/lib/refresh-tokens.ts` - emissao, rotacao com CAS, revogacao
  de familia e `replacedById`.
- `apps/api/src/plugins/auth.ts` - `request.auth`, `requireAuth`,
  `requireRole` e o cookie do refresh.
- `apps/api/src/routes/auth.ts` - login, refresh, logout, `/me`, recuperacao e
  redefinicao.
- Migration 7 `20260928010000_refresh_token_membership` - `refresh_tokens`
  ganhou `membership_id`.
- Web: `lib/token.ts` (token em memoria), `lib/auth.ts`, `AuthProvider`,
  `LoginPage`, rotas `/login` e `RotaProtegida`, e o `apiFetch` com Bearer e
  retry unico pos-refresh.

### 7.2 Bugs encontrados (o mais importante da etapa)

**O error handler era registrado depois das rotas.** `setErrorHandler` e
`setNotFoundHandler` tem que vir **antes** do registro das rotas:
`fastify/lib/route.js` copia `server[kErrorHandler]` no instante em que cada
rota e definida. Definido depois, o handler existe mas nenhuma rota o enxerga,
e 422/500/404 caem no default do Fastify em silencio.

**`hasZodFastifySchemaValidationErrors` nunca dava `true`.** A lib marca cada
issue com um simbolo, mas o `defaultSchemaErrorFormatter` do Fastify reconstroi
o array `validation` e perde o simbolo. A deteccao passou a ser
`Array.isArray(error.validation) && error.validation.length > 0`.

**`replacedById` estava invertido.** O campo vive no token **substituido** e
aponta para o sucessor. A primeira versao gravava o id do antigo no novo, o que
inverte a cadeia e mente em auditoria.

**Rotacao e reset sem atomicidade.** `update` por id permitia que duas
requisicoes simultaneas rotacionassem o mesmo token. Trocado por CAS
(`updateMany` com `revokedAt: null` / `usedAt: null` + `count === 1`).

**O web chamava `/api/auth/refresh`.** Como `VITE_API_URL` ja e `/api`, o
caminho virava `/api/api/auth/refresh`. O fix foi `/auth/refresh`.

**E-mail era validado antes de normalizar.** `Ana@X.com ` e `ana@x.com `
viravam contas diferentes. O schema passou a `trim().toLowerCase()` antes do
formato.

**Fixture de teste vazava.** O `afterEach` nao apagava os usuarios criados; o
banco `massoterapia_test` acumulou 176 users / 190 clinics. Agora um array
`criadas` e drenado no `afterEach` (deleta users -> cascade, depois clinics).

### 7.3 Verificacao final

| Item | Resultado |
| --- | --- |
| Migrations no `massoterapia_test` | 7 de 7 aplicadas |
| Testes da API | 104/104 (7 arquivos) |
| Testes do shared | 19/19 |
| Testes novos nesta etapa | 62 (35 auth + 21 jwt + 6 password) |
| `pnpm check` (format, lint, typecheck, test, build) | exit 0 |
| Fluxo HTTP real (login -> refresh -> /me -> logout -> 401) | OK |
| Cookie | `HttpOnly; SameSite=Lax; Path=/api/auth` (sem `Secure` no dev) |

O smoke test rodou contra a API de dev ativa em `127.0.0.1:3333`: login 200,
refresh 200 com cookie rotacionado, `/me` 200, logout 204 e o refresh seguinte
devolvendo 401.

O teste no navegador (tela de login, escolha de clinica e F5) ainda nao foi
feito porque o dev server do web nao estava de pe; o contrato da API foi
verificado direto.

---

## 8. Cadastros (Etapa 3)

Objetivo: CRUD de clinica/salas, terapias, profissionais e clientes na API, com
as telas de administracao no painel web. O escopo foi confirmado com o usuario:
API **e** telas; a "clinica" e o perfil da unica clinica atual mais as salas
(sem onboarding multi-tenant); profissionais so cadastro, sem login.

### 8.1 O que foi entregue

- **Shared** (`packages/shared/src/schemas/`): `clinic.ts`, `room.ts`,
  `therapy.ts`, `professional.ts`, `client.ts` e `utils/slug.ts`. `common.ts`
  ganhou os `clearable*` (e-mail, telefone, CPF, CNPJ, CEP), `hexColorSchema`,
  `booleanQuerySchema` e `pageMetaSchema`.
- **API**: `src/lib/cadastros.ts` (`limpar`, `dataDeNascimento`, `paraDataISO`,
  `ehConflitoUnico`, `mensagemConflito`) e as rotas `clinics.ts`, `therapies.ts`,
  `professionals.ts`, `clients.ts`, registradas em `app.ts` (tag `clinic`).
  Leitura pede `requireAuth`; escrita pede `requireRole('ADMIN')`.
- **Web**: primitivos de UI (`button`, `field`, `panel`, `modal`, `badge`),
  `lib/cadastros.ts` (cliente de dados), `lib/format.ts` e as telas
  `TerapiasPage`, `ProfissionaisPage`, `ClientesPage`, `ClinicaPage`, sob um
  `AppLayout` com navegacao; `HomePage` virou painel com atalhos e estado da API.

### 8.2 Decisoes

- **PATCH com ausente x vazio** (detalhado em `docs/arquitetura.md`): `limpar`
  distingue "nao mexe" de "limpa".
- **Desativacao logica**: o `DELETE` grava `active: false`.
- **Terapias do profissional** substituidas por inteiro, com os ids validados
  contra a clinica (400 `INVALID_THERAPY_IDS`).
- **Slug da terapia** derivado do nome na criacao e **nao** reescrito ao editar o
  nome.
- **Comissao em basis points** no banco; o formulario converte `%` <-> basis
  points.
- **Sem react-hook-form/zodResolver no web**: estado local + `useMutation`,
  seguindo o padrao ja usado no `LoginPage`. Os tipos do payload vem do shared.

### 8.3 Bugs encontrados e corrigidos

- **`z.coerce.boolean()` mente.** `Boolean('false') === true`, entao
  `?includeInactive=false` ligava o filtro. Trocado por `booleanQuerySchema`
  (enum `true/false/1/0` + `transform`).
- **`clinicUpdateSchema` recusava string vazia** em `legalName`, endereco e
  termos, embora a rota ja usasse `limpar` (que interpreta `''` como limpar).
  Campos passaram a aceitar `''` (`clearableText`), alinhando schema e rota.
- **Erro de unicidade sem `instanceof`.** A deteccao passou a ser pelo `code`
  `P2002` (`ehConflitoUnico`), sem acoplar a versao do client gerado.

### 8.4 Verificacao final

| Item | Resultado |
| --- | --- |
| Testes da API | 119/119 (8 arquivos) |
| Testes novos nesta etapa | 15 (`cadastros.test.ts`) |
| `pnpm check` (format, lint, typecheck, test, build) | exit 0 |
| Build do web | 271 modulos, OK |

O smoke test no navegador das telas de cadastro ainda nao foi feito nesta sessao;
o contrato foi coberto pelos testes de API e o web passou typecheck, lint e
build.

### 8.5 Pendencia para a proxima etapa

Os profissionais nao tem login; o cadastro preve `userId` nulo. Ao implementar a
agenda (Etapa 4), revisar se algum fluxo ja precisa do acesso do profissional ao
proprio painel.

---

## 9. Financeiro (Etapa 7)

Objetivo: fechar o financeiro full-stack, com escopo confirmado com o usuario --
**completo** (recebido x a receber, pacotes de sessoes, comissoes e resumo do
periodo) e **um unico item "Financeiro" no menu** com abas internas. O schema
Prisma ja tinha todos os modelos (`FinancialEntry`, `Package`,
`PackageSession`, `Commission`), entao nao houve migration nova.

### 9.1 O que foi entregue

- **Shared**: `domain/financial.ts` ganhou status e labels de pacote, sessao e
  comissao; `schemas/financial.ts` (lancamentos, pacotes, comissoes, resumo,
  `dateQuerySchema`) exportado no `index.ts`.
- **API**: `lib/financeiro.ts` (`dataColuna`, `diaSeguinte`, `hojeCivil` e os
  mapeadores de resposta) e `routes/financeiro.ts`, registrado em `app.ts` com
  prefixo `/finance` (tag `finance`). Leitura com `requireAuth`; escrita com
  `requireRole('ADMIN')`.
- **Web**: `lib/financeiro.ts` (cliente de dados) e `FinanceiroPage` com as abas
  Lancamentos / Pacotes / Comissoes / Resumo, rota `/financeiro` e item no menu.
- **Testes**: `tests/financeiro.test.ts`, 13 casos.

### 9.2 Decisoes

- **Status implicito na criacao**: `method` presente => PAGO (pago na hora);
  ausente => PENDENTE (a receber). `paidAt` so entra junto com `method`.
- **Pacote em `$transaction`**: pacote + N sessoes + receita da venda, com a
  regra de pagamento acima; saldo sempre derivado do count das sessoes.
- **Sessao**: `usar` so de `DISPONIVEL`; `disponibilizar` devolve ao saldo apenas
  `UTILIZADA` sem `appointmentId` (a agenda e quem cuida da sessao vinculada).
- **Comissao**: `PREVISTA -> APROVADA -> PAGA`; cancelar so de PREVISTA/APROVADA.
- **Resumo**: intervalo `[de, ate+1dia)`; por padrao o mes corrente; recebido pelo
  `paidAt`, a receber pelo `dueDate`, vencido como o subconjunto a receber com
  vencimento antes de hoje, comissao "a pagar" como PREVISTA+APROVADA.
- **Idempotencia**: `(clinicId, idempotencyKey)` unico -> 409; pacote unico
  `(clinicId, clientId, name)` -> 409. O formulario web gera a chave com
  `crypto.randomUUID()`.
- **Web**: sem banco de tabs proprio; ABAS + estado local, mesmo padrao de
  estado+`useMutation`/`useQuery` do resto do painel.

### 9.3 Bugs encontrados

- **`as const` em `status: { in: [...] }` quebrava o `where` do Prisma** (tupla
  readonly nao cabe no `EnumFinancialEntryStatusFilter`). Resolvido anotando os
  objetos de filtro como `Prisma.FinancialEntryWhereInput`.
- **`_sum` dos aggregates e opcional**: acesso via `_sum?.amountCents ?? 0`.
- **`detalhe?.sessions` perdia o narrowing do react-query**: a renderizacao passou
  a guardar `detalhe === undefined` antes de mapear.
- **`useAuth()` chamado duas vezes no mesmo componente** quebrava o narrowing do
  `estado`; uma unica chamada resolve.
- **Primeira chamada `intl`/first test timeout de 5s**: friagem de cold start da
  suite, nao bug de contrato (na segunda execucao, 13/13).
- **Lint `simple-import-sort`**: os importes novos foram ordenados via
  `lint:fix`.

### 9.4 Verificacao final

| Item | Resultado |
| --- | --- |
| Testes novos nesta etapa | 13 (`financeiro.test.ts`) |
| Suite completa da API | 241/241 (15 arquivos) |
| `typecheck` shared / api / web | OK |
| `lint` shared / api / web | OK |
| `prettier --write` nos arquivos da etapa | OK |
| `pnpm check` (format + lint + typecheck + test + build) | exit 0 (gate final da etapa) |

---

## 10. Identidade visual premium (Etapa 10)

Objetivo: o usuario pediu uma "janela profissionais" para o app, dizendo que o
painel parecia "programa antigo" e que queria algo que as pessoas gostem de
usar. Perguntado, o escopo virou o redesign completo do painel, na direcao
"bem-estar premium" (aprovada). A Etapa 8 (testes E2E, LGPD, PWA, deploy)
continua adiada a pedido do usuario.

### 10.1 O que foi entregue

- **`index.css`**: `@theme` reescrito -- paleta primaria **salvia** (`brand`
  50-950 em oklch), acento **argila/terracota** (`clay` 50-900), **neutros
  quentes** (`slate` 50-950 sobrescrito com tom de areia), `--font-sans`
  (Manrope), `--font-display` (Fraunces), `--shadow-panel`, `--shadow-lift` e
  animacoes `fade-in`/`panel-up`. `@font-face` para as duas fontes em variavel,
  subset latin, sem CDN no runtime.
- **Fontes self-hosted**: `apps/web/public/fonts/fraunces-var.woff2` (67 KB) e
  `manrope-var.woff2` (25 KB), copiadas para o `dist` pelo Vite.
- **`index.html`**: `theme-color` atualizado para `#24382a` (pinho).
- **Componentes**: `button` (pilula, primaria com gradiente brand-600->700,
  `active:scale`), `badge` (tons quentes com ring), `panel` (`PageHeader` serif,
  `Panel` rounded-2xl + `--shadow-panel`, novo `CardMetrica` com chip icone +
  tom `brand`/`clay`/`neutral`, `EstadoVazio`, `Carregando`, `CaixaErro`),
  `field` (rounded-xl, ring foco brand), `modal` (rounded-3xl, overlay com blur,
  `animate-panel-up`), novo `Avatar` (iniciais com gradiente).
- **`AppLayout`**: trocou o top-nav por sidebar fixa 264px verde-pinheiro
  (`bg-brand-950`) com brilhos radiais, marca serif + icone `Waves`, navegacao
  em grupos (Inicio / Atendimento / Gestao) com icones `lucide-react`, rodape
  com avatar do usuario + papel + botao Sair; mobile vira gaveta deslizante com
  barra superior.
- **`HomePage`**: virou dashboard -- saudacao por horario + data por extenso,
  4 KPIs ao vivo (sessoes hoje, concluidas hoje, clientes, terapias via
  `listarAgendamentos`/`listarClientes`/`listarTerapias`), painel "Hoje na
  clinica" (proximas sessoes com hora, avatar, preco, badge de status), "Acesso
  rapido" com bento de atalhos, e pill discreta do status da API (`/health`,
  refetch 30s).
- **`LoginPage`**: layout dividido em duas colunas -- painel da marca com
  gradiente, beneficios e copy serif; formulario com inputs arredondados. O
  fluxo de dois passos (escolha de clinica) foi preservado.

### 10.2 Decisoes

- **`lucide-react` passa a ser usado** (era dependencia do catalogo que nunca
  entrou em nenhum componente) para todos os icones.
- **`slate-*` sobrescrito no `@theme`**: todos os cinzas existentes herdam o
  tom quente sem editar uma unica classe de pagina.
- **Componentes mantem a API publica** (props `variante`, `tamanho`, `tone`,
  `CardMetrica` novo): nenhuma pagina existente precisou de mudanca de
  contrato, o redesign passou so por tema + componentes + layout.
- **Fontes self-hosted** em vez de CDN do Google Fonts: funciona offline e
  prepara o caminho do PWA que a Etapa 8 deve trazer.
- **KPI da Home com queries ao vivo** no padrao do painel (react-query), sem
  estado local.

### 10.3 Peculiaridades

- **`neutral` nao existia no tipo de Badge de status**: o mapa `TOM_POR_STATUS`
  da Home recebeu a uniao que inclui `neutral`; o typecheck pegou o literal
  faltante (`CANCELADO: 'neutral'`).
- **Botao usado no login**: a API do `Button` e a nativa (`disabled`, nao
  `bloqueado`); a primeira versao do LoginPage usava `bloqueado` e foi corrigida
  no typecheck.
- **Importes**: `eslint --fix` reorder imports de forma diferente do `prettier
  --write`; o ciclo format check preciso deprettier depois de eslint para fechar
  -- o contrato dos dois passos e rodar os dois ate ambos darem verde.

### 10.4 Verificacao final

| Item | Resultado |
| --- | --- |
| `prettier --check` nos arquivos da etapa | OK |
| `lint` do web (`eslint . --fix` + `eslint .`) | OK |
| `typecheck` do web (`tsc -p tsconfig.json`) | OK |
| `vite build` | OK (2165 modulos; fontes no `dist/fonts`) |
| Git | `7cfc8b2` commitado e pushado; arvore limpa, `main` == `origin/main` |

---

## 11. Direcao visual "Arrojado" e diagnostico do login (sessao de 13 de outubro de 2026)

**Data da sessao:** 13 de outubro de 2026
**Escopo:** nova identidade visual do painel (direcao "Arrojado") + investigacao
da falha de login relatada pelo usuario.
**Estado:** tudo na arvore de trabalho, **nada commitado** nesta sessao. O unico
commit de referencia continua sendo `7cfc8b2`.

Esta sessao tem duas partes independentes: um redesign (o que o usuario pediu
primeiro) e um diagnostico de login (o que ele reportou depois). A conclusao
importante e que **o redesign nao tem relacao com a falha de login**: o login
quebrava porque o PostgreSQL nao estava instalado na maquina.

### 11.1 Pedido 1 -- "o app parece modo texto; quero cara de software profissional"

O usuario disse que o app parecia estar em "modo texto" (sem estilo) e pediu uma
aparencia de software profissional. Foi oferecida uma escolha entre direcoes
visuais (arquivo `docs/mockups/ui-direcoes.html`, criado nesta sessao):

- **Direcao A -- Classico azul:** sobria, azul corporativo.
- **Direcao B -- Arrojado:** shell escuro, gradiente indigo->magenta.

O usuario escolheu a **Direcao B**, aplicada ao **app inteiro** (nao so ao
painel), e decidiu que o **portal publico e a anamnese seguem a mesma
identidade**.

### 11.2 Causa raiz do "modo texto"

`apps/web/src/index.css` (onde vive todo o Tailwind 4 e o `@theme`) **nunca era
importado**. O `apps/web/src/main.tsx` nao tinha `import './index.css'`. Sem esse
import, o Tailwind nao era injetado e sobrava o HTML cru -- o tal "modo texto".

**Correcao:** adicionado `import './index.css'` no topo de `main.tsx`. Depois
disso o build passou a emitir `dist/assets/index-*.css` (~41,75 kB) com os tokens
dentro.

Observacao: a secao 10 (commitada) descreve um redesign "salvia/argila". Nesta
sessao o usuario pediu para mudar a identidade; o trabalho abaixo **substitui**
aquela paleta na arvore de trabalho (o commit `7cfc8b2` permanece intacto ate
alguem commitar o novo).

### 11.3 O que foi entregue (redesign "Arrojado")

- **`apps/web/src/index.css`**: `@theme` reescrito --
  - `brand` = indigo/violeta (escala 50-950);
  - `clay` = magenta/fucsia;
  - escala `slate` **invertida** (valores baixos = superficies escuras, altos =
    texto claro), o que faz todo `slate-*` ja existente herdar o tema escuro sem
    editar pagina por pagina;
  - novo `--color-surface: #141b30` (superficie de cartao no tema escuro);
  - `--shadow-glow`; `--font-display` = Manrope; `color-scheme: dark`.
- **`bg-white` -> `bg-surface`** em todo `apps/web/src/**/*.tsx`, com a regex
  `bg-white(?![0-9a-zA-Z/])` (as ocorrencias com opacidade, `bg-white/xx`, foram
  mantidas de proposito).
- **Componentes base ajustados**: `button.tsx` (primario com gradiente
  `from-brand-600 to-clay-400` + `shadow-glow`; variante `perigo` em rosa),
  `badge.tsx` (tons translucidos emerald/amber/rose/brand), `field.tsx` (foco
  `brand-500/25`, erro rosa), `panel.tsx` (`CaixaErro` translucido), `modal.tsx`,
  `AppErrorBoundary.tsx`.
- **`AppLayout.tsx`** redesenhado: sidebar escura (`bg-brand-950`), brilhos
  radiais, item ativo em pill de gradiente, gaveta no mobile.
- **`LoginPage.tsx`** reescrito: painel de marca escuro + formulario dark, com
  `CONTROLE` local. **A logica de login nao foi tocada** (ver 11.5).
- Ajustes semanticos de cor (emerald/rose/amber) em `ClinicaPage.tsx`,
  `ProntuarioPage.tsx`, `FinanceiroPage.tsx`, `NotificacoesPage.tsx`,
  `PortalPage.tsx`, `HomePage.tsx`.
- **`apps/web/index.html`**: `theme-color` = `#0b0f1c`.
- **`docs/mockups/ui-direcoes.html`** (novo, nao commitado): comparacao visual
  das direcoes A e B usada para a decisao.

### 11.4 Verificacao do redesign

Passaram no pacote `@massoterapia/web` (via `pnpm --filter @massoterapia/web <script>`):

| Item | Resultado |
| --- | --- |
| `typecheck` | OK |
| `lint` | OK |
| `prettier --check` | OK |
| `build` (vite) | OK, com `dist/assets/index-*.css` contendo `--color-surface`, `.bg-surface`, `--color-brand-600`, `from-brand-600`, `shadow-glow`, `to-clay-400` |

Nada foi commitado; revisar no navegador (`pnpm dev`) antes de fechar.

### 11.5 Pedido 2 -- "nao acessou com minhas senha, verifica o que mudou"

O usuario tentou o login de administracao e recebeu **"Erro interno. Tente
novamente."**. Investigacao, passo a passo:

1. **A logica de auth nao mudou.** `git diff` de
   `apps/web/src/components/auth/AuthProvider.tsx`, `apps/web/src/lib/auth.ts` e
   `apps/web/src/lib/api.ts` = **vazio**. O diff do `LoginPage.tsx` so tem
   mudanca de `className`/estrutura visual.
2. **Hash de senha OK.** Teste direto do Argon2 (`@node-rs/argon2`) na pasta da
   API: `hash` e `verify` retornaram OK. Portanto nao e o hashing de senha.
3. **A origem da mensagem.** "Erro interno. Tente novamente." e o texto generico
   que a API devolve para **qualquer** status >= 500, em
   `apps/api/src/app.ts:199`. Ou seja, o frontend esta apenas repetindo um erro
   5xx da API.
4. **A API esta viva, mas o banco esta fora.**
   - `POST /auth/login` -> **HTTP 500**.
   - `GET /health` -> `200 {"status":"ok",...}` (liveness, nao toca no banco).
   - `GET /health/ready` -> **503** (readiness, consulta o banco).
   - Conexao direta com `pg` para `localhost:5432` -> **`ECONNREFUSED`**.
5. **Nao havia PostgreSQL na maquina.** Confirmado por: nenhum servico
   `postgre*`, nenhuma entrada no registro (Uninstall / Services), nenhum
   `postgres.exe` em `C:\`, nenhuma pasta `C:\Program Files\PostgreSQL`, sem
   Docker, WSL sem distro instalada.

**Causa raiz:** o app exige PostgreSQL 16 (README, secao "Pre-requisitos") e o
`.env` aponta para `localhost:5432`, que nao existia. Sem banco, o login falha
com 500 e a tela mostra o erro generico. **O redesign nao causou isso** -- o
banco simplesmente nunca esteve instalado nesta maquina.

### 11.6 Instalacao do PostgreSQL 16 (nesta sessao)

Ferramenta disponivel: **Chocolatey** (`C:\ProgramData\chocolatey\bin\choco.exe`).
Sem `winget`.

- **1a tentativa** (`choco install postgresql16 --params "/Password:postgres"`)
  -> **falhou** resolvendo a dependencia `kb2919442` / `KB2919355` (sao updates
  do Windows 8.1, irrelevantes no Windows atual).
- **2a tentativa** com `--ignore-dependencies` -> **sucesso**:
  `postgresql16 16.15.5`, instalado em `C:\Program Files\PostgreSQL\16`.

Estado confirmado apos a instalacao:

| Item | Resultado |
| --- | --- |
| Servico | `postgresql-x64-16` -- **Running**, Automatic |
| Binario | `C:\Program Files\PostgreSQL\16\bin\psql.exe` existe |
| Porta 5432 | **escuta** (`Test-NetConnection` -> True) |
| Senha do superusuario `postgres` | `postgres` (via `--params "/Password:postgres"`) |
| PATH | o Chocolatey adicionou `C:\Program Files\PostgreSQL\16\bin` (reabrir o shell / `refreshenv`) |

A instalacao foi disparada de forma elevada (`Start-Process -Verb RunAs`), com
UAC confirmado pelo usuario. O log ficou em
`%TEMP%\opencode\pg_install.log`. O script de instalacao esta em
`%TEMP%\opencode\pg_install.cmd` (temporario).

### 11.7 O que falta (proximos passos) -- continuar daqui

O banco foi instalado, mas **ainda nao foi preparado**. O `.env` espera:

```
postgresql://massoterapia:massoterapia_dev@localhost:5432/massoterapia_dev
postgresql://massoterapia:massoterapia_dev@localhost:5432/massoterapia_test
```

Passos, em ordem (usar `psql` de `C:\Program Files\PostgreSQL\16\bin`, ou
`refreshenv` antes):

1. **Criar o papel e os bancos** (conforme README, secao "Banco de dados"),
   logando como superusuario `postgres`:
   ```sql
   CREATE ROLE massoterapia WITH LOGIN PASSWORD 'massoterapia_dev' CREATEDB;
   CREATE DATABASE massoterapia_dev OWNER massoterapia;
   CREATE DATABASE massoterapia_test OWNER massoterapia;
   ```
2. **Extensoes por banco** (necessarias para a constraint anti-duplo-agendamento
   e para `uuid`), em `massoterapia_dev` **e** `massoterapia_test`:
   ```sql
   CREATE EXTENSION IF NOT EXISTS btree_gist;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   ```
   Obs.: a migration `20260927000001_extensions` tambem cria as duas com
   `IF NOT EXISTS`, mas criar agora evita surpresa.
3. **Prisma e dados**, a partir da raiz do repositorio:
   ```bash
   pnpm --filter @massoterapia/api db:generate
   pnpm --filter @massoterapia/api db:migrate:deploy
   pnpm --filter @massoterapia/api db:seed
   ```
4. **Reiniciar a API** se ela estiver rodando (a janela "Massoterapia API"), ou
   usar `parar.bat` e `iniciar.bat`, para o pool do Prisma reconectar.
5. **Conferir** que o login volta:
   - `GET /health/ready` -> `200 {"status":"ready",...}`;
   - Login `admin@clinicawave.com.br` / `Wave@2026` (credenciais do seed,
     tambem impressas pelo `iniciar.bat`).

**STATUS: os passos acima foram EXECUTADOS nesta mesma sessao e o login voltou.**

| Item | Resultado |
| --- | --- |
| Papel + bancos | criados (`massoterapia`, `massoterapia_dev`, `massoterapia_test`) |
| Extensoes | `btree_gist` e `pgcrypto` presentes nos dois bancos |
| `db:generate` | Prisma Client 7.10.0 gerado em `apps/api/src/generated/prisma` |
| `db:migrate:deploy` | **8 de 8** migrations aplicadas |
| `db:seed` | OK (6 usuarios, 6 terapias, 2 profissionais, 3 clientes, 6 agendamentos, financeiro) |
| `GET /health/ready` | `200 {"status":"ready","database":"up","databaseVersion":"16.15"}` |
| `POST /auth/login` (admin) | `200` com `accessToken` e perfil `ADMIN` da Clinica Wave |

Nao foi preciso reiniciar a API: o `tsx watch` estava de pe e o pool do Prisma
reconectou sozinho assim que o banco subiu.

### 11.8 Estado do repositorio nesta sessao

Branch `main`; ultimo commit `7cfc8b2`. **Nada commitado.**

Arquivos modificados (18):

```
apps/web/index.html
apps/web/src/components/AppErrorBoundary.tsx
apps/web/src/components/layout/AppLayout.tsx
apps/web/src/components/ui/badge.tsx
apps/web/src/components/ui/button.tsx
apps/web/src/components/ui/field.tsx
apps/web/src/components/ui/modal.tsx
apps/web/src/components/ui/panel.tsx
apps/web/src/index.css
apps/web/src/main.tsx
apps/web/src/pages/ClinicaPage.tsx
apps/web/src/pages/FinanceiroPage.tsx
apps/web/src/pages/HomePage.tsx
apps/web/src/pages/LoginPage.tsx
apps/web/src/pages/NotificacoesPage.tsx
apps/web/src/pages/PortalPage.tsx
apps/web/src/pages/ProntuarioPage.tsx
memoria.md
```

Nao rastreados: `docs/mockups/`.

### 11.9 Pendencias e observacoes

- **Login testado ponta a ponta e funcionando** (11.7): `/health/ready` 200 e
  login admin 200 com token. O usuario pode entrar no app normalmente.
- **Redesign nao commitado.** Revisar visualmente no navegador antes de commitar.
- **`refreshenv` / reabrir o terminal:** o PATH so passou a ter o `bin` do
  PostgreSQL depois da instalacao; shells ja abertos nao o enxergam.
- **Instalacao via Chocolatey com `--ignore-dependencies`:** as dependencias
  ignoradas (`kb2919442`, `KB2919355`) sao updates de Windows 8.1 e nao afetam
  este sistema. Registrado aqui para quem for reproduzir.
- **Sem Docker e sem WSL:** o caminho suportado nesta maquina e o PostgreSQL
  instalado nativamente pelo Chocolatey.

---

## 12. Fase 0 do deploy na nuvem -- empacotamento (API serve o SPA, prefixo /api)

### 12.1 Objetivo

Levar o app de "roda na minha maquina" para **web na nuvem e multiusuario**.
O estudo/plano completo esta em `docs/deploy-nuvem.md` (fases 0 a 4). Esta sessao
implementou a **Fase 0**: empacotar para deploy com a topologia escolhida pelo
usuario.

### 12.2 Decisao de topologia

Pergunta feita ao usuario e **escolhida a opcao recomendada**: **"API serve o SPA,
`/api` fixo"**. Ou seja:

- a API Fastify serve os arquivos do SPA (`apps/web/dist`) em producao;
- web e API na **mesma origem** -> sem CORS e cookie same-site;
- a API de negocio vive sob o prefixo **`/api`** nos dois ambientes;
- `VITE_API_URL=/api` e o `path` do cookie `/api/auth` valem sempre.

Alternativas descartadas: reverse proxy (Caddy/Nginx) e dois dominios.

### 12.3 Dependencia nova: `@fastify/static`

- Adicionada ao catalogo (`pnpm-workspace.yaml`) e a `apps/api/package.json`.
- O catalogo foi fixado em **10.1.5** (o resolver do pnpm resolveu 10.1.5 a partir
  do pin 10.1.6; alinhar o catalogo ao resolvido evita `ERR_PNPM_OUTDATED_LOCKFILE`
  em `--frozen-lockfile`). Ambas as linhas 8.x e 10.x suportam Fastify 5.

**Perrengue do `pnpm install`:** a instalacao falhava repetidamente com
`failed to rename staging directory "...\esbuild@0.28.2\...esbuild": Acesso negado
(os error 5)`. Causa: os servidores de dev (API/web) estavam de pe segurando
arquivos do `esbuild`; o estado do `node_modules` ficou inconsistente. Solucao:
parar os processos das portas 3333/5173, remover **todos** os `node_modules` e
rodar `pnpm install` limpo (reaproveita o store) -> `+435` pacotes, OK.

### 12.4 Banco de teste: migrations que faltavam

A suite de testes roda contra `TEST_DATABASE_URL` (`massoterapia_test`). Esse banco
existia (com extensoes) mas **nunca tinha recebido as migrations** -- so o banco de
dev tinha. Resultado inicial: `Test Files 9 failed ... The table does not exist`.
Correcao (aplicar as migrations no banco de teste):

```powershell
$env:DATABASE_URL="postgresql://massoterapia:massoterapia_dev@localhost:5432/massoterapia_test?schema=public"
pnpm --filter @massoterapia/api db:migrate:deploy
```

Depois disso: **241 testes, 15 arquivos, todos passando.**

### 12.5 Mudancas de codigo

- `apps/api/src/config/env.ts`: novas variaveis
  - `API_PREFIX` (opcional; default `/api` em producao, vazio em dev/test),
    exposta como `env.apiPrefix` (barra final removida);
  - `WEB_DIST_DIR` (opcional), exposta em `env.WEB_DIST_DIR`.
- `apps/api/src/app.ts`:
  - as rotas de negocio agora sao registradas dentro de um contexto filho com
    `prefix: env.apiPrefix` (uma vez so, sem tocar em cada arquivo de rota);
  - `@fastify/static` serve `apps/web/dist` **so em producao** (se `index.html`
    existir); cache: `index.html` = `no-cache`, `/assets` = imutavel (1 ano),
    resto = 1h;
  - `setNotFoundHandler`: em producao devolve `index.html` para GET que **nao**
    seja `/api`, `/health` ou `/docs` (fallback de SPA); fora disso, JSON 404.
- `apps/api/src/plugins/auth.ts`: `COOKIE_PATH` fixado em **`/api/auth`** (antes
  `/auth` em producao). Comentarios atualizados.
- `Dockerfile` (estagio unico, node:24-bookworm-slim), `.dockerignore`,
  `docker/entrypoint.sh` (roda `prisma migrate deploy` conforme
  `RUN_MIGRATIONS`, default `on`), `docker-compose.yml` (api + postgres, porta
  do host 5433 para nao colidir com o Postgres local).
- `.env.example`: documenta `API_PREFIX` e `WEB_DIST_DIR`.
- `docs/deploy-nuvem.md`: status, secao 3.3, Fase 0, tabela de variaveis e
  checklist atualizados.

### 12.6 Verificacao (modo producao, local)

Build de `shared`, `api` e `web` OK. Subindo
`NODE_ENV=production node apps/api/dist/index.js` e testando:

| Checagem | Resultado |
| --- | --- |
| `GET /health` | 200 JSON |
| `GET /health/ready` | 200 (database up) |
| `GET /` | 200 `text/html` (index.html) |
| `GET /clientes` | 200 `text/html` (fallback SPA) |
| `GET /api/nao-existe` | 404 JSON (nao cai no SPA) |
| `GET /docs` | 404 (Swagger desligado em producao) |
| `GET /assets/index-*.js` | 200 JS |
| `POST /api/auth/login` (campo **`senha`**) | status `autenticado`, `accessToken`, Clinica Wave / ADMIN |
| `GET /api/clients` com Bearer | 200 |
| `GET /api/clients` sem token | 401 |
| Cookie | `mt_refresh=...; Path=/api/auth; HttpOnly; Secure; SameSite=Lax` |

Obs.: o login usa o campo **`senha`** (nao `password`) -- um primeiro teste deu 422
por isso.

### 12.7 Pendencias e observacoes

- **Docker nao esta instalado nesta maquina** -> a imagem nao foi construida nem
  subida. O `Dockerfile`/compose foram escritos e revisados, mas o `docker build`
  fica pendente de uma maquina com Docker (validar na Fase 1).
- Fase 0 validada em modo producao **sem** container (mais importante: o
  comportamento do app e o mesmo).
- **Nada commitado.** O redesign visual (secao 11) tambem continua sem commit.
- Proximo passo natural: **Fase 1** (subir um ambiente na nuvem: Postgres
  gerenciado + deploy + TLS + dominio) -- ver `docs/deploy-nuvem.md`.

---

## 13. Fase 1 -- preparo do deploy na nuvem (Railway)

### 13.1 Decisoes tomadas (perguntadas ao usuario)

- **Provedor:** Railway (API como container + Postgres gerenciado no mesmo
  projeto). Alternativas descartadas nesta rodada: Render+Neon, Fly.io+Neon, VPS.
- **Repositorio:** ja existe no GitHub (deploy por Git).
- **Dominio:** subdominio do provedor (`*.up.railway.app`), sem dominio proprio.

Ferramentas conferidas na maquina: **sem Docker, sem CLIs** (fly/railway/render/
gh); so `vercel` instalado (nao usado). Portanto o deploy sera pelo fluxo web do
Railway a partir do GitHub.

### 13.2 Ajustes de codigo para o provedor

- `apps/api/src/config/env.ts`: `API_PORT` agora usa um **default ciente do
  provedor** -- cai para a variavel `PORT` quando ela existe (Railway/Render/
  Heroku), senao 3333. `API_PORT` explicito continua vencendo.
- `Dockerfile`: **removido o `API_PORT=3333`** do `ENV` (ele anulava o `PORT` do
  provedor). Ficaram so `NODE_ENV=production`, `API_HOST=0.0.0.0` e
  `WEB_DIST_DIR=/app/apps/web/dist`.
- Typecheck e lint da API OK apos a mudanca.

### 13.3 Arquivos novos

- `railway.json` (raiz): builder `DOCKERFILE`, healthcheck `/health/ready`
  (timeout 120s), restart `ON_FAILURE` (5 tentativas).
- `docs/deploy-fase1-railway.md`: runbook passo a passo (criar projeto + Postgres,
  variaveis, gerar segredos, gerar dominio, deploy/migrations, smoke test,
  armadilhas, checklist).
- `docs/deploy-nuvem.md`: secao Fase 1 atualizada apontando para o runbook.

### 13.4 Como funciona no Railway (resumo)

- Mesma origem: a API serve o SPA e a API de negocio sob `/api`; sem CORS e cookie
  same-site. HTTPS do provedor deixa o cookie `Secure` valido.
- `DATABASE_URL` referencia `${{Postgres.DATABASE_URL}}` (rede interna, sem SSL).
- No start, o `entrypoint.sh` roda `prisma migrate deploy` (8 migrations) e sobe a
  API; healthcheck `/health/ready`.
- Login de aceite exige `User`+`Clinic`+`Membership`, que hoje nascem no seed:
  rodar o seed **uma vez** para o aceite e **remover antes do uso real** (a Fase 2
  cria o provisionamento de verdade).

### 13.5 Pendencias (dependem do usuario)

- Executar os passos do runbook no Railway (criar projeto, adicionar Postgres,
  definir variaveis, gerar dominio). Requer a conta/conta GitHub do usuario.
- Gerar e guardar os segredos (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
  distintos; `ANAMNESIS_ENCRYPTION_KEY` de 64 hex, **definitiva**).
- Construir/subir a imagem segue sem validacao local (Docker ausente); o Railway
  faz o build no deploy.
- **Nada commitado ainda** (redesign + Fase 0 + preparo da Fase 1).

---

## 14. Fase 2 -- CLI de provisionamento (5.1)

### 14.1 O que foi feito

Recorte 5.1 da Fase 2 (provisionamento interno), preferido a self-signup publico.
Novo script `apps/api/scripts/provision.ts` e script npm `provision` em
`apps/api/package.json` (`tsx scripts/provision.ts`).

```
pnpm --filter @massoterapia/api provision -- --name "Clinica Wave" \
  --email admin@exemplo.com
```

- Senha via `PROVISION_ADMIN_PASSWORD` (recomendado: nao aparece no `ps` nem no
  historico do shell) ou `--senha` (imprime aviso de inseguranca).
- Cria `Clinic` + `User` admin + `ClinicMembership` `ADMIN` numa unica
  `$transaction` (clinica sem admin e inacessivel; admin sem clinica e credencial
  sem destino).
- Opcionais: `--slug`, `--admin-name`, `--timezone`, `--legal-name`, `--cnpj`,
  `--clinic-email`, `--phone`, `--admin-phone`, `--help`.
- Reusa o que ja existia: `hashPassword` (Argon2id) de `src/lib/password.ts`,
  `slugify` de `@massoterapia/shared`, `prisma`/`disconnectPrisma`, e
  `ehConflitoUnico` (`P2002`) de `src/lib/cadastros.ts`.

### 14.2 Decisoes

- **Sem migracao nova.** O convite de senha (5.2) vai reusar `PasswordResetToken`:
  `User.passwordHash` e nao-nulo, entao o convidado nasce com hash aleatorio e
  recebe token para definir a propria senha -- mesmo padrao ja usado no reset.
- **Falha explicita em conflito.** Pre-checa slug (unico) e e-mail (unico) com
  mensagem clara; `P2002` na gravacao (corrida) tambem vira mensagem amigavel.
  Nada e criado parcialmente (transacao).
- **Sem `assertNotProduction`.** Ao contrario do seed, este e o caminho oficial de
  producao.
- **`override: false`** ao carregar o `.env`: variavel injetada pelo provedor
  vence um `.env` esquecido no servidor.

### 14.3 Verificacao

- `typecheck` e `lint` da API OK; prettier aplicado.
- Smoke contra `massoterapia_test` (DATABASE_URL sobrescrita): criacao devolveu
  clinica/usuario/membership; reexecucao com o mesmo slug e com o mesmo e-mail
  falhou com mensagem clara e exit 1, sem duplicar. Linhas de teste removidas via
  `psql` (0|0 ao fim).

### 14.4 Pendencias da Fase 2

- 5.2: implementada na rodada seguinte (ver secao 15).
- 5.3 (Fase 3): login do profissional + RBAC revisado.
- **Nada commitado ainda.**


---

## 15. Fase 2 -- Gestao de usuarios (5.2)

### 15.1 O que foi feito

Recorte 5.2 da Fase 2: o ADMIN da clinica gerencia quem tem acesso, pelo painel.
Nenhuma migracao nova -- o convite reusa `PasswordResetToken`.

**Backend**

- `packages/shared/src/schemas/user.ts`: `membershipSchema`,
  `membershipListQuerySchema`, `membershipListResponseSchema`,
  `membershipInviteSchema` (`role` default `PROFISSIONAL`; papeis de equipe sao so
  `ADMIN`/`PROFISSIONAL`, cliente do portal nao faz login), `membershipUpdateSchema`,
  `membershipInviteResponseSchema`. Exportado no `index.ts`.
- `apps/api/src/routes/users.ts` (`userRoutes`, todas
  `preHandler: [requireAuth, requireRole('ADMIN')]`):
  - `GET /users` -- lista paginada por tenant (`clinicId` da sessao), ordem por
    nome, filtro `search`/`includeInactive`.
  - `POST /users/invites` -- cria ou reaproveita o `User` (busca por e-mail), cria
    a membership e emite `PasswordResetToken` (TTL 7 dias) numa `$transaction`. O
    `User` novo nasce com hash de senha aleatorio (`hashPassword(randomBytes(32))`)
    -- ninguem sabe a senha; o link e que define. 409 em duplicado (`P2002`).
  - `PATCH /users/:id` -- muda `role`/`active`/`jobTitle`; bloqueia rebaixar/
    desativar o ultimo ADMIN ativo (`LAST_ADMIN`, 409); revoga os refresh tokens
    da membership quando o papel muda ou e desativada.
  - `DELETE /users/:id` -- desativacao logica (`active: false`) + revoga sessoes;
    responde 204 (`response: {}`, sem schema).
- `apps/api/src/app.ts`: registra `userRoutes` com prefixo `/users` + tag
  swagger `users`.

**Frontend**

- `apps/web/src/lib/usuarios.ts`: `listarUsuarios`, `convidarUsuario`,
  `atualizarUsuario`, `desativarUsuario` (tipos vem do shared).
- `apps/web/src/lib/auth.ts`: `redefinirSenha(token, senha)`.
- `apps/web/src/pages/UsuariosPage.tsx`: lista com busca/inativos, badge de status
  (`Ativo` / `Inativo` / `Convite pendente` quando `lastLoginAt` e nulo), modal de
  convite (que exibe o link copiavel quando `inviteLink` volta) e modal de edicao.
- `apps/web/src/pages/RedefinirSenhaPage.tsx`: rota publica `/redefinir-senha`,
  atende convite e recuperacao de senha; valida confirmacao no cliente.
- `apps/web/src/router.tsx`: rota `usuarios` sob uma guarda `RotaAdmin` (papel) e
  rota publica `/redefinir-senha`.
- `apps/web/src/components/layout/AppLayout.tsx`: item `Usuarios` no grupo Gestao,
  marcado `somenteAdmin` (filtrado pelo papel da sessao).

### 15.2 Decisoes

- **Sem tabela nova.** O convite reusa `PasswordResetToken`; `inviteLink` so vem na
  resposta quando `NOTIFIER_DRIVER=log` (repasse manual). Com e-mail ligado, o link
  so vai por e-mail.
- **Guarda do ultimo ADMIN.** Sem isso o unico admin se rebaixa/desativa e ninguem
  entra para reverter. A contagem ignora o proprio membro (permite editar quando ha
  um segundo admin).
- **Revogacao de sessao no papel/atividade.** O access token carrega o papel; mudar
  o papel sem derrubar o refresh deixaria a pessoa com o papel antigo ate expirar.
- **`RotaAdmin` no web.** A API ja responde 403; a guarda evita a tela inutil e o
  item de menu some para nao-ADMIN.
- **Id manipulado e o da membership**, nao o do `User`: e a membership que concede
  acesso a clinica.

### 15.3 Verificacao

- `packages/shared` e `apps/api`: typecheck + lint OK.
- `apps/api/tests/users.test.ts`: 9 testes (listagem, 403 de PROFISSIONAL, convite
  cria user+membership+token, reuso de `User` existente, 409 em duplicado, promocao
  de papel, guarda do ultimo admin, isolamento de tenant 404, desativacao some da
  lista padrao). Suite completa da API: 250 testes passando.
- `apps/web`: typecheck + lint + `vite build` OK.

### 15.4 Pendencias

- 5.3 (Fase 3): login do profissional + RBAC revisado.
- Envio real de e-mail do convite (hoje so `NOTIFIER_DRIVER=log`).
- **Nada commitado ainda.**


