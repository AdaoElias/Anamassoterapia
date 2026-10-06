# Memoria

Registro do que foi feito, pedido por pedido, com a solucao aplicada e como
foi verificada. Escrito no mesmo padrao do resto do repositorio: sem acentos,
porque o resto do projeto segue ASCII (ver `docs/arquitetura.md`).

**Data da sessao:** 3 de outubro de 2026
**Escopo:** Etapa 3 - cadastros de clinica/salas, terapias, profissionais e
clientes, na API e no painel web
**Estado:** verificado e sem commit. ultimo commit e `ad5f2ef` (Etapa 2)

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
| `pnpm check` (format + lint + typecheck + test + build) | a rodar como gate final |

