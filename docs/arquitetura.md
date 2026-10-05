# Arquitetura

Decisoes tecnicas e o porque de cada uma. Registrar o motivo evita refatoracao
"porque o dev anterior nao sabia" daqui a seis meses.

## Stack

### Monorepo com pnpm workspaces + Turborepo

`packages/shared` guarda o contrato entre API e frontend: enums do dominio e
schemas Zod. Um schema de anamnese definido la e validado pela API e tipado no
formulario do portal.

Alternativas descartadas: dois repositorios (perdemos o contrato compartilhado),
Nx (a curva de aprendizado nao se justifica no tamanho do projeto).

### TypeScript 5.9 e nao 7

`typescript-eslint@8` declara `typescript >=4.8.4 <6.1.0`. TypeScript 7 e o
compilador nativo em Go, mas adotar agora quebraria o lint com erros de tipo. Fica
para uma etapa futura, com upgrade consciente.

### ESLint 10 em flat config

Duas adaptacoes necessarias:

- `eslint-plugin-simple-import-sort@14` nao expoe mais flat config pronto. O
  objeto exportado e o *plugin* e precisa ser registrado em `plugins`, com as
  regras aplicadas na mao. Passar o objeto direto como config quebra com
  `Unexpected key "meta"`.
- `require-await` fica desligado em `apps/api/src/routes` e `apps/api/src/plugins`.
  Fastify aceita handler sincrono de proposito, e a regra atrapalha mais do que
  ajuda nesses dois diretorios. Em `services/` ela continua valendo, onde um
  `await` esquecido e bug real.

### Prettier depois do ESLint

`simple-import-sort` e o Prettier concordam, mas na ordem contraria eles se
desfazem. O script `format` roda `turbo run lint:fix` antes do Prettier para
ser idempotente.

## Banco de dados

### PostgreSQL como unico armazenamento

Nao existe Redis. A fila de notificacoes usa `pg-boss`, que roda sobre tabelas do
proprio Postgres. Menos um servico para instalar, monitorar e fazer backup.

Para uma clinica de pequeno porte, Postgres aguenta com folga agenda +
financeiro + fila.

### Prisma 7 (e nao 8)

`prisma@8` ainda esta em release candidate. Vamos para estavel.

### Validacao do `.env` com Zod, no bootstrap

`src/config/env.ts` valida todo o ambiente e falha imediatamente com uma lista
de erros legiveis. Falhar no start e melhor do que descobrir no meio de um
agendamento que `JWT_ACCESS_SECRET` esta vazio.

### Unicidade que o dominio exige, nao so a do `id`

O padrao "confia na aplicacao" aparece no primeiro bug de concorrencia ou no
primeiro duplo clique. Estas chaves existem para tornar a duplicata imposible:

- `FinancialEntry (clinicId, idempotencyKey)`: o gateway reenvia webhook e o
  cliente clica duas vezes. `idempotencyKey` e anulavel de proposito -- lancamento
  digitado no balcao nao tem chave, e no PostgreSQL `NULL` nunca conflita num
  indice unico.
- `Package (clinicId, clientId, name)`: dois pacotes com o mesmo nome para o mesmo
  cliente sao o mesmo pacote. Sem isso, "Pacote 5 Sessoes" nasce quantas vezes o
  balcao digitar o nome.
- `Commission (appointmentId, professionalId)`: um profissional tem uma comissao
  por sessao. `appointmentId` nulo (adiantamento) tambem nao conflita.

### Unicidade do bloqueio de dia inteiro exige indice parcial

`AvailabilityException` tem `@@unique([professionalId, date, type, startMinute])`
e mesmo assim nao impedia dois bloqueios de dia inteiro, porque esse caso e
gravado com `startMinute = NULL` e `NULL` nunca conflita num indice unico. O
`upsert` do Prisma tambem nao ajudava: ele vira `start_minute = NULL`, que nunca
e verdadeiro, e criava uma linha nova a cada execucao.

As colunas continuam anulaveis -- "janela ausente" e "dia inteiro" sao estados
diferentes, e o `CHECK availability_exceptions_extra_has_window` depende disso. A
chave que fecha a brecha e um indice unico parcial:

```sql
CREATE UNIQUE INDEX availability_exceptions_all_day_key
  ON availability_exceptions (professional_id, date, type)
  WHERE start_minute IS NULL;
```

Com janela, o indice de 4 colunas resolve; sem janela, este resolve.

### Join explicito quando a pacao carrega dado proprio

O vinculo terapia/contraindicacao nasceu como M:N implicito do Prisma. Ele virou a
tabela `therapy_contraindications` porque a pacao precisa carregar dado por
clinica: `severity` e `requiresMedicalClearance` sobrescrevem o catalogo global
(gestacao e `ALTA` para drenagem e `MEDIA` para shiatsu).

M:N implicito nao aceita coluna. Descobrir isso depois significa migrar a tabela
e reescrever as queries.

## Dominio

Decisoes que ja evitam retrabalho quando o negocio crescer.

### Multi-tenant com `clinicId` em tudo

Toda tabela de negocio tem `clinicId`. Comecar assim custa uma coluna a mais;
migrar depois custa reescrever todas as queries e o risco de vazar dado de uma
clinica para outra. Ainda que o sistema cuide de uma unica clinica, o modelo ja
nasce preparado.

### Dinheiro em centavos, inteiro

Nunca float. `100.10` em ponto flutuante acumulado ao longo de mil lancamentos
erra. Financeiro e a unica parte do sistema onde erro de arredondamento vira
prejuizo real.

### Anamnese imutavel e versionada

Responder a anamnese de novo cria uma versao nova. Nunca sobrescreve a anterior.

Motivo: prontuario que aceita sobrescrita perde a trilha do que o profissional
sabia no momento da sessao. Se houver processo judicial, a versao vigente e a
historica precisam ser provaveis. E um requisito de LGPD: dado de saude
nao pode ser alterado em silencio.

A imutabilidade das respostas e garantida por `CHECK` no banco: depois de
`ENVIADA`, um `UPDATE` em `answers_encrypted` e recusado, enquanto o status pode
avancar para `APROVADA` e o `RASCUNHO` continua editavel.

### Anamnese cifrada em AES-256-GCM

`answers_encrypted` guarda dado de saude (LGPD, art. 5 II e XI). Um dump do
banco vazado e um prontuario de centenas de pessoas na mao de quem nao tem por que
ver. O `SELECT` de metadados continua possivel -- status, versao, quem revisou,
quando. So a resposta some.

O valor persistido e `v1:<iv>:<tag>:<ciphertext>`, em base64, com prefixo de
versao para o algoritmo poder mudar sem adivinhar. Escolhas que nao sao
negociaveis:

- **GCM, nao CBC**: GCM traz autenticacao embutida. Alterar um byte do texto
  cifrado faz a decifragem falhar em vez de devolver lixo.
- **IV novo a cada cifragem**: reusar IV em GCM com a mesma chave expoe a relacao
  entre dois textos e quebra a autenticacao.
- **`templateId` dentro da cifra**: o JSON Schema do formulario pode mudar
  depois. Com o template amarrado a versao da resposta, da para decifrar um
  registro antigo e saber com qual formulario ele foi respondido.
- **`contentHash` (SHA-256 do texto cifrado)**: detecta adulteracao sem precisar
  decifrar.

A chave vem de `ANAMNESIS_ENCRYPTION_KEY`, validada no bootstrap: 64 caracteres
hexadecimais. Valor de exemplo em `.env.example`; em producao, gerado por
`crypto.randomBytes(32)`.

### Agenda sem conflito garantida pelo banco

```sql
EXCLUDE USING gist (professional_id WITH =, period WITH &&)
  WHERE (status IN ('AGENDADO_PENDENTE','CONFIRMADO','EM_ATENDIMENTO'))
```

Somente `PENDENTE`, `CONFIRMADO` e `EM_ATENDIMENTO` bloqueiam o horario. Os
demais liberam a agenda e o valor a receber.

Checar conflito na aplicacao e corrida: dois clientes clicam "agendar" no mesmo
segundo, os dois `SELECT` veem o horario livre, os dois `INSERT` passam. Com a
constraint, o segundo recebe violacao de exclusao e a API devolve 409. A
aplicacao trata a mensagem, o banco garante.

Requer a extensao `btree_gist`.

### Alerta de contraindicacao, nao bloqueio

O sistema **avisa** o profissional quando uma combinacao cliente/terapia tem
risco (gestante com drenagem profunda, por exemplo) e registra a decisao. Nao
bloqueia sozinho: quem pode avaliar a contraindicacao real e o profissional com o
cliente na mesa. Bloquear de forma automatica criaria falso positivo em caso
comum e tiraria o profissional do loop.

A justificativa fica registrada, o que serve tanto para protecao do profissional
quanto para o cliente.

## Autenticacao

### Senha: Argon2id, um unico caminho

`hashPassword` usa Argon2id com os parametros lidos do `.env`. O seed e a API
chamam o mesmo modulo: quando o seed gerava o hash por conta propria, o
parametro podia divergir e o login falhava sem ninguem saber por que.

### Access token: JWT HS256, 15 minutos

Assinado e verificado com `node:crypto`, sem dependencia nova. O header tem
`alg` fixo em HS256 e a comparacao da assinatura e `timingSafeEqual` -- fixar
o algoritmo e o que impede o ataque de trocar `alg` para `none`. O token
carrega `sub`, `membershipId`, `clinicId`, `role` e `epoch`.

`epoch` e o `users.tokenEpoch`. JWT nao tem lista de revogacao, entao e o que
faz um token ja emitido morrer depois de troca de senha: o `/auth/me` compara
o `epoch` do token com o do banco a cada request.

### Refresh: opaco, rotativo, com familia

O refresh e um valor aleatorio de 32 bytes, guardado apenas como SHA-256. Nao
e JWT de proposito: um refresh stateless nao pode ser revogado.

Cada refresh pertence a uma familia. Ao girar, o token antigo recebe
`replacedById` apontando para o novo. Se um token **ja rotacionado** voltar a
ser usado, e sinal de roubo: a familia inteira e revogada, inclusive o token
mais novo, que seria o do atacante.

A rotacao usa compare-and-swap (`updateMany` com `revokedAt: null` e
`count === 1`), nao `update` por id. Com dois requests simultaneos, sem CAS os
dois leem "ativo" e os dois giram -- o navegador fica com dois refreshs validos
e a rotacao vira decoracao.

### A sessao pertence a uma clinica

`refresh_tokens.membership_id` existe porque a mesma pessoa pode ter papeis em
clinicas diferentes. O refresh precisa carregar **qual** sessao, senao o access
token novo perde a escolha feita no login.

No login com mais de uma clinica a API responde `escolha_de_clinica` com a
lista e **nao** emite token: emitir para a clinica errada serviria dado errado.

### Cookie

`httpOnly`, `SameSite=Lax`, `Secure` so em producao. O `path` acompanha o
ambiente (`/api/auth` no dev, porque o proxy remove `/api`; `/auth` em
producao). `Secure` fica de fora no dev de proposito: sem TLS o navegador
descarta o cookie em silencio, e o sintoma e "refresh nao funciona" sem erro
no servidor.

O tempo de vida do refresh sai de `JWT_REFRESH_TTL_DAYS` (30 por padrao).

### Rate limit e anti-enumeracao

Login 5/min, recuperacao 3/5 min, refresh 30/min, redefinicao 5/5 min. Login e
recuperacao respondem igual exista a conta ou nao, para nao virarem enumerador
de e-mails.

### Web guarda o access token em memoria

Nada de `localStorage`/`sessionStorage`: um XSS que le `localStorage` rouba a
sessao. O token vive em memoria e, no F5, o bootstrap tenta um unico
`/auth/refresh` para reconstruir a sessao a partir do cookie httpOnly.


## Cadastros (clinica, salas, terapias, profissionais, clientes)

### Escrita multi-tenant sempre por `clinicId`

Um `update` por `id` so, mesmo com id valido, escreveria no tenant alheio. Toda
escrita usa `updateMany({ where: { id, clinicId } })` e trata `count === 0` como
404 -- nunca como sucesso silencioso. A leitura filtra `clinicId` e devolve 404
para id de outro tenant, e nao 403: negar a existencia vaza menos que confirmar
que o recurso existe.

### PATCH: ausente nao e vazio

Campo ausente significa "nao mexe" (`undefined`, o Prisma ignora); string vazia
significa "limpa" (`null`). O helper `limpar` preserva os dois sentidos, e os
schemas `clearable*` do shared fazem o mesmo na validacao. Sem essa distincao,
um formulario que envia só os campos alterados apagaria todo o resto.

### Desativacao logica, nao `DELETE`

Nao existe delete fisico de terapia, profissional, cliente ou sala: o `DELETE`
grava `active: false`. Historico de agenda, prontuario e financeiro aponta para
essas linhas; remover de verdade quebraria a referencia e a auditoria.

### Profissional sem login nesta etapa

O cadastro de profissional nao cria `User`: `userId` fica nulo e o convite de
acesso entra depois. Isso desacopla "quem atende" de "quem acessa o painel" e
evita que o cadastro de RH dependa de e-mail valido.

### Vinculo profissional x terapia e substituido por inteiro

No PATCH, quando `therapyIds` vem, o conjunto antigo e apagado e recriado. A
alternativa -- diff por item -- aceitaria id de terapia de outro tenant e
adicionaria uma linha cruzada em vez de recusar. Antes de gravar, a API confere
que todos os ids pertencem a clinica e responde 400 se algum nao pertencer.

### Slug derivado do nome, uma vez

A terapia ganha `slug` a partir do nome quando o campo nao e enviado. Editar o
nome depois **nao** reescreve o slug: o slug e a chave estavel de link publico, e
mudar conforme o nome quebraria links ja divulgados.

## Agenda e disponibilidade

### Fuso horario sem biblioteca de datas

`startAt`/`endAt` trafegam e sao gravados em UTC. O fuso da clinica
(`Clinic.timezone`) so entra na apresentacao e no calculo de slots. Como o
projeto nao carrega biblioteca de datas, `packages/shared/src/utils/datetime.ts`
converte com `Intl` -- que ja conhece o historico de horario de verao de cada
regiao -- montando os componentes locais como se fossem UTC, medindo o
deslocamento do fuso e subtraindo, com uma segunda passada para a virada de
horario de verao.

### Disponibilidade em tres camadas

`AvailabilityRule` e a grade semanal recorrente; `AvailabilityException` cobre
folga parcial/dia inteiro (`BLOQUEIO`) e janela extra (`EXTRA`); `ClinicHoliday`
fecha a clinica inteira. O motor de slots (`apps/api/src/lib/scheduling.ts`) e
puro e deterministico: recebe regras, excecoes, feriados, ocupacao e a duracao e
devolve uma lista, sem tocar no banco -- o que o torna testavel sem fixtures.

Horarios sao minutos desde a meia-noite no fuso da clinica (`540` = `09:00`); a
conversao para UTC acontece so no motor.

### Slots nao se sobrepoem entre si

Depois de aceitar um horario, o cursor avanca `duracao + buffer`, entao dois
slots sugeridos nunca colidem. A `granularity` (5 a 240 min) controla apenas o
passo ao pular um candidato rejeitado por conflito, nao o espacamento entre
slots. O buffer impede encostar uma sessao na outra; a ocupacao de um agendamento
existente usa `[startAt, endAt]` puro, sem buffer.

### Conflito de agenda tambem e 409, com codigo proprio

A constraint `EXCLUDE` (secao "Agenda sem conflito garantida pelo banco")
garante a exclusao; a API so precisa traduzir. O Prisma devolve `P2039`, com a
mensagem ja traduzida e o SQLSTATE em `meta.driverAdapterError.cause.originalCode`
(`23P01`). `ehConflitoAgenda` reconhece os dois formatos e a rota responde 409
`SCHEDULE_CONFLICT`.

### Transicoes de status validadas no dominio

`APPOINTMENT_TRANSITIONS` no shared e a unica fonte de transicoes permitidas.
`PATCH /appointments/:id/status` recusa qualquer outra com 422
`INVALID_TRANSITION` e carimba as datas do status (`confirmedAt`, `startedAt`,
`finishedAt`, `cancelledAt` + motivo). Cada mudanca grava uma linha em
`AppointmentStatusHistory` na mesma transacao, preservando a trilha de auditoria.

## Portal publico do cliente

### O slug e o unico seletor de tenant

O portal vive em `/agendar/:slug` e consome as rotas sob `/public`. Nenhuma rota
publica recebe `clinicId`: o slug da URL resolve a clinica, e so clinicas ativas
respondem. Um slug desconhecido devolve 404, sem revelar se ele existe em outra
clinica -- o mesmo criterio de isolamento do resto da API.

### Convidado, sem cadastro

O cliente do portal nao faz login. Nome e telefone sao obrigatorios; e-mail e
opcional. A API procura um `Client` pelo telefone normalizado (com DDI) na
clinica e, se encontrar, reaproveita o cadastro; se nao, cria um com `userId`
nulo e `searchText` derivado do nome. O e-mail so preenche um campo vazio e o
consentimento de marketing nunca e desligado por um novo agendamento.

### Agendamento nasce pendente

O `POST /public/clinics/:slug/appointments` refaz a checagem do horario pelo
mesmo motor de slots antes de gravar, para nao aceitar um horario fora da grade.
A criacao usa `source: PORTAL_CLIENTE`, status `AGENDADO_PENDENTE` e um
`AppointmentStatusHistory` na mesma transacao. Horario indisponivel responde 422
`SLOT_UNAVAILABLE`; uma corrida real cai na constraint de exclusao e vira 409
`SLOT_UNAVAILABLE`. A rota tem rate limit proprio (10/min).

### Motor de slots compartilhado entre admin e portal

A montagem dos parametros (terapia, profissional, fuso, disponibilidade e
ocupacao) que antes vivia dentro de `/appointments/slots` foi extraida para
`apps/api/src/lib/agenda-service.ts` (`calcularSlotsDaClinica` e `periodoUtc`).
Admin e portal chamam a mesma funcao, entao a lista de horarios e identica nos
dois caminhos. O web do portal tambem reusa o contrato de `slotSchema`, so
renderizando outra etapa de UI.

## Notificacoes

### A outbox e a fonte de verdade; a fila so acorda o processo

`Notification` e o registro de auditoria *e* a fila de reenvio. O `pg-boss` mora
no mesmo Postgres, em schema separado (`QUEUE_SCHEMA`), e serve para uma coisa so:
entregar o id da linha a ser processada. Isso resolve o caso em que o job foi
aceito e o processo morreu antes do envio -- a linha continua la, e o reenvio
manual (5b) ou a proxima passagem do worker pegam.

Por isso `enfileirar` nunca derruba a requisicao que criou a reserva: sem fila no
ar, o aviso fica `PENDENTE` e pronto. E `processarNotificacao` so muda a linha
com `updateMany` filtrando por status (`PENDENTE`, `ERRO`, `ENVIANDO`); quem
mover a linha primeiro ganha. `ENVIADO` e `CANCELADO` sao resposta definitiva e
`ENVIANDO` entra na disputa justamente porque um processo morto no meio do envio
deixaria a linha presa para sempre.

### Worker dentro do processo da API

`iniciarFila` roda no `index.ts`, nunca em `buildApp()`: um worker por arquivo de
teste seria uma conexao a mais no banco e um consumidor disputando as mesmas
linhas antes do `expect`. A suite verifica o estado real das linhas (`PENDENTE`)
depois que a rota grava, e exercita o envio chamando `processarNotificacao` com
canais falsos. O fechamento e pelo `onClose` de `app.ts`.

O preco de nao ter a fila na suite e que opcoes do pg-boss podem ser aceitas em
silencio -- foi assim que `work` sobe sem a fila existir e falha semanas depois, no
primeiro aviso. `scripts/fila-smoke.ts` cobre esse buraco: sobe a fila de verdade
contra `TEST_DATABASE_URL`, le a configuracao de volta (`getQueue`) e espera um
aviso sair enquanto outro espera a hora chegar.

Para uma clinica, dois processos so para mandar e-mail e WhatsApp e uma peca a
mais para operar. O preco assumido: escala e um problema da etapa 8.

### Notificar depois do commit, nunca dentro da transacao

Os gatilhos sao chamados depois que a transacao de status consolida, e o erro
deles e registrado sem virar 500. Se o aviso falhasse e devolvesse erro, o painel
mostraria "nao encontrado" para uma reserva que existe com horario travado.

### Consentimento e por canal, e a regra e assimétrica

Confirmacao e lembrete sao transacionais -- o cliente acabou de pedir o horario --
e por isso nao exigem aceite de marketing; so o WhatsApp depende do consentimento
(`Client.marketingOptIn` ou a flag `CONSENT_FLAG_WHATSAPP` do usuario
vinculado). O e-mail vai direto. Exigir aceite para confirmar o horario que o
proprio cliente marcou faria a agenda parecer quebrada.

O telefone da clinica nao passa por consentimento: e contato comercial, nao
mensagem de marketing. Por isso `NOVO_AGENDAMENTO` chega por WhatsApp mesmo sem
nenhum aceite registrado.

### Quem aciona o que

| Gatilho                  | Cliente                          | Clinica                      |
| ------------------------ | -------------------------------- | ---------------------------- |
| Reserva nova (portal)    | pedido + lembrete                | aviso de novo pedido         |
| Reserva nova (painel)    | pedido + lembrete                | nada (quem agenda ja sabe)   |
| Confirmacao              | confirmacao                      | nada                         |
| Cancelamento             | cancelamento; lembrete vira `CANCELADO` | nada                 |
| Reagendamento            | reagendamento; lembrete trocado  | nada                         |
| Volta para pendente      | rearmar lembrete                 | nada                         |

`dedupeKey` e a rede contra aviso repetido. Confirmacao e cancelamento usam
`TIPO:id:canal:marca` onde a marca e o proprio evento; o lembrete usa o
`startAt` em ISO, porque reagendar precisa de um lembrete *novo* para a data nova
-- e o antigo sai como `CANCELADO`, sem ser apagado.

### Transporte por ambiente, decisao de canal por clinica

Em dev nada sai do processo (`NOTIFIER_DRIVER=log`, `EMAIL_PROVIDER=log`). Em
producao o WhatsApp vai pela Evolution API -- a unica opcao que nao exige
credencial da Meta, o que importa para clinica de porte pequeno -- e o e-mail por
SMTP via `nodemailer`. `NOTIFIER_DRIVER=email` desliga o WhatsApp de proposito
(uso so de e-mail). Se a configuracao do transporte faltar em producao, o canal
cai para log em vez de virar erro 500 no meio de uma reserva.

### O painel le a linha; o reenvio reusa a linha

`GET /notifications` lista por clinica (o tenant vem da sessao, nunca da URL) com
filtro de situacao, canal e busca por destinatario ou nome do cliente. E `ADMIN` de
leitura: a resposta traz telefone, e-mail e o texto da mensagem, que e dado de
contato do cliente, nao dado de agenda que qualquer profissional precise ver.

`resumo` conta a clinica inteira e ignora os filtros. E o que responde "quantos
avisos falharam" -- se contasse so o filtro, um painel aberto em "com erro" nunca
mostraria que existem 12 falhas escondidas atras de um filtro restrito.

`POST /notifications/:id/reenviar` zera `attempts`, limpa `lastError`, `sentAt` e
`externalId` e reagenda a linha **para agora**. Duas decisoes:

- O texto enviado nao muda. A linha e a auditoria do aviso que a clinica pediu;
  reescrever o corpo na mao quebraria a leitura de "o que o cliente recebeu". Se a
  clinica errou o texto, a correcao e um aviso novo (reagendamento, cancelamento),
  nao uma edicao silenciosa do passado.
- `scheduledFor` vai para `agora` de proposito. Sem isso a linha voltaria a ser
  adiada para a data original e o botao pareceria nao fazer nada.

O reenvio usa `updateMany` filtrando `PENDENTE`, `ERRO` e `ENVIADO` -- a mesma
trava do worker. Se ele pegou a linha entre a leitura e a escrita, o count volta
zero e a resposta e 409 `NOTIFICATION_IN_FLIGHT`, em vez de duas mensagens para o
mesmo cliente. `CANCELADO` responde 409 para sempre: o lembrete foi substituido por
outro aviso, e reenviar seria mandar algo que ninguem pediu. Aviso de outra clinica
responde 404, e nao 403: o painel nem confirma que ele existe.

## Verificacao

### A suite nunca escreve no banco de dev

`tests/setup.ts` troca `DATABASE_URL` por `TEST_DATABASE_URL` e **recusa a rodar**
se o banco nao terminar em `_test`. Sem essa trava, um teste que grava escreve no
banco de trabalho e o registro fantasma aparece semanas depois -- e sobrevive a
um `migrate reset`, porque o seed compartilha o mesmo banco de dev.

Falhar no bootstrap e o unico momento em que o engano ainda e barato.

### As garantias do banco sao testadas pelo SQLSTATE, nao por `toThrow`

Constraint de Postgres vira `23P01` (exclusao), `23514` (check) ou `23505`
(unico). E desse codigo que a API deriva 409 e 422, entao e ele que o teste
precisa fixar:

```ts
expect(estado).toBe(EXCLUSION_VIOLATION);
```

`await expect(...).rejects.toThrow()` sem codigo passa com qualquer erro,
inclusive um erro de digitacao no SQL. Fica verde sem verificar nada.

A suite completa (15 verificacoes, cobrindo agenda, anamnese, historico,
financeiro e disponibilidade) vive em `apps/api/prisma/verify/constraints.sql` e
roda dentro de uma transacao com `ROLLBACK`, entao nao deixa residuo:

```bash
pnpm --filter @massoterapia/api db:verify
```

O script imprime o resultado em `RAISE NOTICE`, e `NOTICE` nao afeta exit code --
o CI passaria com "FALHOU" scrollsando no meio do log. O runner em
`apps/api/scripts/verify-constraints.ts` captura o evento `notice` do driver
`pg` e converte a excecao final do bloco `DO` em codigo de saida diferente de
zero. O mesmo vale no CI.

## Observabilidade

### Liveness e readiness separados

- `GET /health` responde "o processo esta vivo". Nao toca no banco.
- `GET /health/ready` responde "o processo consegue atender". Consulta o banco e
  devolve 503 quando ele nao responde.

A distincao importa no deploy: um liveness que depende do banco mata o container
quando o Postgres reinicia, e o orquestrador passa a reiniciar a aplicacao -- que
nao tem culpa nenhuma -- num loop.

O probe tem timeout de 3s. O pool pode esperar 10s por conexao, e um readiness
que espera 10s nao serve para nada: o load balancer ja desistiu.

A mensagem de 503 e generica de proposito. A string de erro do driver carrega
host, porta, usuario e senha; ela fica no log do servidor, nunca na resposta.

## Frontend

### PWA, nao app nativo

O cliente agenda por link, sem instalar nada. e o caminho de menor atrito para
conversao, e o mesmo bundle serve o portal publico, o painel do profissional e o
do administrador.

O profissional usa como app no celular (instalavel), que e 90% do caso dele.

### Proxy do Vite em dev

O dev usa `/api` com proxy para `127.0.0.1:3333`. Isso remove CORS e deixa o
cookie de refresh `same-site`, igual a producao. Divergencia entre dev e
producao em autenticacao e a origem classica de bug que so aparece no deploy.

## Decisoes adiadas de proposito

- **Painel de notificacoes**: entregue na 5b (tela de listagem e reenvio manual);
  o que fica adiado e o aviso por e-mail do resultado diario do worker.
- **Worker separado**: assumido dentro do processo da API (ver acima). Escala e
  problema da Etapa 8; a fila ja suporta varios consumidores.
- **Pagamento online**: o plano trata de "recebido x a receber" e sinal. Integrar
  gateway de pagamento e da Etapa 8, com decisao sobre o provedor.
- **IA de recomendacao**: existe nos concorrentes, mas depende de historico de
  sessoes consolidado. So faz sentido depois da Etapa 6.
- **Marketplace / perfil publico**: e o que o Trinks faz bem. Depende de demanda
  real, nao de arquitectura.
