-- ===================================================================
-- Convite de anamnese por link (6B)
-- ===================================================================
-- O cliente responde a anamnese sem login: a clinica gera um link, envia por
-- WhatsApp ou e-mail, e o cliente responde por ele. Sem isso a Etapa 6B teria
-- tela de prontuario que so o proprio profissional preenche -- o formulario
-- do cliente nao existiria.
--
-- O token em claro NUNCA entra no banco: a coluna guarda o SHA-256, e a rota
-- publica procura por ele. Um dump do banco nao entrega convite nenhum, o que
-- importa porque quem tem o link consegue responder a anamnese em nome do
-- cliente.
--
-- `used_at` marca o consumo do link, e nao a primeira abertura: enquanto for
-- nulo o convite continua abrivel, para o cliente fechar o link no celular e
-- voltar pelo mesmo endereco. "Uso unico" aqui significa "vale uma anamnese",
-- nao "abre uma vez".
--
-- `anamnesis_id` faz o rascunho nascer junto com a primeira abertura em vez de
-- uma tabela de respostas paralela. Duas fontes de dados para a mesma resposta
-- divergem, e a divergencia apareceria como "o cliente preencheu mas o painel
-- nao mostra" -- o pior tipo de bug em prontuario.
--
-- `template_id` e obrigatorio e nao opcional: o link aponta para uma versao
-- concreta do formulario. Aclinica escolhe o formulario antes de gerar, porque
-- "qualquer um" nao e resposta para quem precisa conferir o que o cliente
-- affirmou sobre dor, gestacao e alergia.
--
-- `onDelete: cascade` nos quatro lados: remover a clinica, o cliente ou o
-- template tem que matar o convite junto. Convite orfao e uma credencial
-- publica para dado que a clinica ja decidiu que nao existe mais.
-- ===================================================================

CREATE TABLE "anamnesis_invites" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "template_id" uuid NOT NULL,
  "token_hash" char(64) NOT NULL,
  "expires_at" timestamptz(6) NOT NULL,
  "anamnesis_id" uuid,
  "used_at" timestamptz(6),
  "created_by_user_id" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "anamnesis_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "anamnesis_invites_token_hash_key"
  ON "anamnesis_invites" ("token_hash");

CREATE UNIQUE INDEX "anamnesis_invites_anamnesis_id_key"
  ON "anamnesis_invites" ("anamnesis_id");

CREATE INDEX "anamnesis_invites_client_id_used_at_idx"
  ON "anamnesis_invites" ("client_id", "used_at");

CREATE INDEX "anamnesis_invites_clinic_id_expires_at_idx"
  ON "anamnesis_invites" ("clinic_id", "expires_at");

ALTER TABLE "anamnesis_invites"
  ADD CONSTRAINT "anamnesis_invites_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "anamnesis_invites"
  ADD CONSTRAINT "anamnesis_invites_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "anamnesis_invites"
  ADD CONSTRAINT "anamnesis_invites_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "anamnesis_templates" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "anamnesis_invites"
  ADD CONSTRAINT "anamnesis_invites_anamnesis_id_fkey"
  FOREIGN KEY ("anamnesis_id") REFERENCES "anamneses" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "anamnesis_invites"
  ADD CONSTRAINT "anamnesis_invites_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;