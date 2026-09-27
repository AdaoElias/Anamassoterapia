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

Argon2id para senha, JWT curto (15 min) + refresh em cookie httpOnly. O access
token vai no header; o refresh nunca e legivel por JavaScript, o que mitiga
XSS.

Rate limit global e mais apertado em login, recuperacao de senha e refresh.

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

- **Pagamento online**: o plano trata de "recebido x a receber" e sinal. Integrar
  gateway de pagamento e da Etapa 8, com decisao sobre o provedor.
- **IA de recomendacao**: existe nos concorrentes, mas depende de historico de
  sessoes consolidado. So faz sentido depois da Etapa 6.
- **Marketplace / perfil publico**: e o que o Trinks faz bem. Depende de demanda
  real, nao de arquitectura.
