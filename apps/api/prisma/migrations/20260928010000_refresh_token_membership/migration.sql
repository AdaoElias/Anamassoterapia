-- ===================================================================
-- Membership no refresh token
-- ===================================================================
-- O refresh precisa reconstituir a sessao: access token novo claims `cid`,
-- `mid`, `role` e `epoch`. A unica forma de saber qual membership o token
-- representa e carrega-la no proprio refresh token -- o access token velho
-- ja expirou (e por isso esta sendo trocado) e nao vem na requisicao.
--
-- Sem esta coluna, refresh funciona para quem tem uma clinica so, que e o
-- caso comum e o que o seed monta, e quebra para quem trabalha em duas:
-- o backend teria de adivinhar a clinica, e adivinhar errado significa
-- servir os dados de outra clinica para um profissional legitimo.
--
-- A coluna e anulavel de proposito: os tokens ja emitidos recebem NULL e o
-- refresh deles cai para a unica membership ativa do usuario. Migracao
-- aditiva, sem backfill e sem downtime -- nada reescreve tabela com sessao
-- aberta no meio do dia.
--
-- `onDelete: cascade` e o que garante que remover a membership da clinica
-- mate os tokens daquele contexto. Sem isso o token sobrevive a demissao e
-- continua sendo uma credencial valida para um usuario que ja nao tem mais
-- acesso.
-- ===================================================================

ALTER TABLE "refresh_tokens"
  ADD COLUMN "membership_id" uuid;

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_membership_id_fkey"
  FOREIGN KEY ("membership_id")
  REFERENCES "clinic_memberships" ("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE INDEX "refresh_tokens_membership_id_idx"
  ON "refresh_tokens" ("membership_id");
