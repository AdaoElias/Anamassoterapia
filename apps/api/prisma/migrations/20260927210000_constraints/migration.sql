-- ===================================================================
-- Garantias de dominio que o Prisma nao sabe expressar.
-- ===================================================================
-- Prisma modela chaves estrangeiras, unicos e indices. O que ele nao
-- modela e justamente o que protege o negocio: sobreposicao de horario,
-- invariantes de dinheiro e imutabilidade de dado clinico. Essas regras
-- vivem aqui, no banco, porque valem para toda rota de escrita --
-- API, script, migration ou psql -- e nao dependem de a aplicacao
-- lembrar de checar.
-- ===================================================================


-- -------------------------------------------------------------------
-- 1. Agenda sem conflito
-- -------------------------------------------------------------------
-- Checar conflito na aplicacao e corrida: dois clientes clicam "agendar"
-- no mesmo segundo, os dois SELECT veem o horario livre, os dois INSERT
-- passam. Aqui o segundo INSERT recebe violacao de exclusao (23P01) e a
-- API devolve 409. A aplicacao trata a mensagem; o banco garante.
--
-- tstzrange com '[)' trata sessao das 10:00 as 11:00 e das 11:00 as
-- 12:00 como adjacentes, e nao como sobrepostas. Sem isso, uma agenda
-- com sessoes coladas em sequencia seria rejeitada.
--
-- Somente PENDENTE, CONFIRMADO e EM_ATENDIMENTO bloqueiam o horario.
-- CONCLUIDO, CANCELADO e NO_SHOW liberam a agenda e o valor a receber.
--
-- DEFERRABLE INITIALLY IMMEDIATE: por padrao a conflito falha na hora,
-- que e o comportamento certo no agendamento. Reagendamento que precise
-- trocar duas sessoes de lugar dentro de uma transacao faz
-- SET CONSTRAINTS appointments_professional_no_overlap DEFERRED.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_professional_no_overlap
  EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status IN ('AGENDADO_PENDENTE', 'CONFIRMADO', 'EM_ATENDIMENTO'))
  DEFERRABLE INITIALLY IMMEDIATE;

-- A sala e recurso compartilhado: duas sessoes na mesma sala, ainda que
-- com profissionais diferentes, sao conflito.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_room_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (
    room_id IS NOT NULL
    AND status IN ('AGENDADO_PENDENTE', 'CONFIRMADO', 'EM_ATENDIMENTO')
  )
  DEFERRABLE INITIALLY IMMEDIATE;

-- O cliente nao esta em dois lugares ao mesmo tempo.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_client_no_overlap
  EXCLUDE USING gist (
    client_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status IN ('AGENDADO_PENDENTE', 'CONFIRMADO', 'EM_ATENDIMENTO'))
  DEFERRABLE INITIALLY IMMEDIATE;


-- -------------------------------------------------------------------
-- 2. Invariantes de agenda
-- -------------------------------------------------------------------
-- Sessao de data igual (duracao zero) nao e sessao.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_period_positive CHECK (end_at > start_at);

-- Preco congelado no ato. Negativo aqui e bug, nao desconto.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_price_nonnegative CHECK (price_cents >= 0);

-- Cancelado sem motivo nao passa: "por que cancelou" e a primeira
-- pergunta de qualquer dispute de horario.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_cancelled_has_reason CHECK (
    status <> 'CANCELADO' OR cancellation_reason IS NOT NULL
  );

-- Confirmar, iniciar e terminar sao carimbos de tempo reais.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_timestamps_consistent CHECK (
    (confirmed_at IS NULL OR start_at IS NOT NULL)
    AND (started_at IS NULL OR confirmed_at IS NULL OR started_at >= confirmed_at)
    AND (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
  );


-- -------------------------------------------------------------------
-- 3. Cardapio de terapias
-- -------------------------------------------------------------------
ALTER TABLE therapies
  ADD CONSTRAINT therapies_duration_range CHECK (duration_minutes BETWEEN 5 AND 480),
  ADD CONSTRAINT therapies_buffer_range CHECK (buffer_minutes BETWEEN 0 AND 120),
  ADD CONSTRAINT therapies_price_nonnegative CHECK (price_cents >= 0),
  ADD CONSTRAINT therapies_notice_nonnegative CHECK (min_notice_minutes >= 0),
  ADD CONSTRAINT therapies_age_range CHECK (
    (min_age IS NULL OR min_age BETWEEN 0 AND 120)
    AND (max_age IS NULL OR max_age BETWEEN 0 AND 120)
    AND (min_age IS NULL OR max_age IS NULL OR min_age <= max_age)
  ),
  ADD CONSTRAINT therapies_color_hex CHECK (
    color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'
  );

ALTER TABLE therapy_professionals
  ADD CONSTRAINT therapy_professionals_overrides_valid CHECK (
    (custom_duration_minutes IS NULL OR custom_duration_minutes BETWEEN 5 AND 480)
    AND (custom_buffer_minutes IS NULL OR custom_buffer_minutes BETWEEN 0 AND 120)
    AND (custom_price_cents IS NULL OR custom_price_cents >= 0)
  );


-- -------------------------------------------------------------------
-- 4. Disponibilidade
-- -------------------------------------------------------------------
-- start_minute/end_minute sao minutos desde a meia-noite no fuso da
-- clinica: 0..1439 para inicio, 1..1440 para fim (1440 = meia-noite do
-- dia seguinte, que e o "encerra as 24h" de quem trabalha ate tarde).
ALTER TABLE availability_rules
  ADD CONSTRAINT availability_rules_weekday_range CHECK (weekday BETWEEN 0 AND 6),
  ADD CONSTRAINT availability_rules_period_valid CHECK (
    start_minute BETWEEN 0 AND 1439
    AND end_minute BETWEEN 1 AND 1440
    AND end_minute > start_minute
  ),
  ADD CONSTRAINT availability_rules_granularity_range CHECK (
    slot_granularity_minutes BETWEEN 5 AND 240
  ),
  -- Regra retroativa muda o historico de disponibilidade e faz horario
  -- ja reservado virar invalido. vigencia sempre para frente.
  ADD CONSTRAINT availability_rules_effective_range CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  );

-- Nulos = dia inteiro, so faz sentido em BLOQUEIO. Em EXTRA a janela e
-- obrigatoria, senao a excecao nao diz nada.
ALTER TABLE availability_exceptions
  ADD CONSTRAINT availability_exceptions_period_valid CHECK (
    (start_minute IS NULL AND end_minute IS NULL)
    OR (
      start_minute BETWEEN 0 AND 1439
      AND end_minute BETWEEN 1 AND 1440
      AND end_minute > start_minute
    )
  ),
  ADD CONSTRAINT availability_exceptions_extra_has_window CHECK (
    type = 'BLOQUEIO' OR start_minute IS NOT NULL
  );


-- -------------------------------------------------------------------
-- 5. Anamnese imutavel
-- -------------------------------------------------------------------
ALTER TABLE anamneses
  ADD CONSTRAINT anamneses_version_positive CHECK (version > 0),
  ADD CONSTRAINT anamneses_content_hash_format CHECK (
    content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'
  ),
  -- Nada de RASCUNHO sem estar em rascunho: fora do rascunho, enviada.
  ADD CONSTRAINT anamneses_submitted_when_not_draft CHECK (
    status = 'RASCUNHO' OR submitted_at IS NOT NULL
  );


-- -------------------------------------------------------------------
-- 6. Pacotes e financeiro
-- -------------------------------------------------------------------
ALTER TABLE packages
  ADD CONSTRAINT packages_total_sessions_positive CHECK (total_sessions > 0),
  ADD CONSTRAINT packages_price_nonnegative CHECK (price_cents >= 0),
  ADD CONSTRAINT packages_validity_range CHECK (valid_until >= valid_from);

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_amount_nonnegative CHECK (amount_cents >= 0),
  ADD CONSTRAINT financial_entries_fee_nonnegative CHECK (
    fee_cents IS NULL OR fee_cents >= 0
  ),
  -- PAGO sempre tem data de recebimento; a aberta nunca tem. E o que
  -- impede "recebido" sem data no extrato.
  ADD CONSTRAINT financial_entries_paid_timestamp CHECK (
    (status = 'PAGO' AND paid_at IS NOT NULL)
    OR (status <> 'PAGO' AND paid_at IS NULL)
  );

-- Percentual em basis points: 10000 = 100%. Float aqui acumula erro de
-- arredondamento em cima de erro de arredondamento.
ALTER TABLE commissions
  ADD CONSTRAINT commissions_base_nonnegative CHECK (base_amount_cents >= 0),
  ADD CONSTRAINT commissions_percent_range CHECK (
    percent_basis_points BETWEEN 0 AND 10000
  ),
  ADD CONSTRAINT commissions_amount_nonnegative CHECK (amount_cents >= 0),
  ADD CONSTRAINT commissions_period_range CHECK (period_end >= period_start),
  ADD CONSTRAINT commissions_paid_timestamp CHECK (
    (status = 'PAGA' AND paid_at IS NOT NULL)
    OR (status <> 'PAGA' AND paid_at IS NULL)
  );


-- -------------------------------------------------------------------
-- 7. Pessoas
-- -------------------------------------------------------------------
ALTER TABLE professionals
  ADD CONSTRAINT professionals_commission_range CHECK (
    default_commission_basis_points BETWEEN 0 AND 10000
  ),
  ADD CONSTRAINT professionals_color_hex CHECK (
    color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'
  );

-- Nao ha CHECK para "digitos", porque "somente digitos" e a unica
-- invariancia real do CPF; a validacao de DV acontece no shared
-- (packages/shared/src/utils/brazilian) e o banco guarda normalizado.
-- Divergencia de formato e problema de entrada, nao de dado salvo.

ALTER TABLE users
  ADD CONSTRAINT users_consent_flags_nonnegative CHECK (consent_flags >= 0),
  ADD CONSTRAINT users_token_epoch_nonnegative CHECK (token_epoch >= 0);

ALTER TABLE refresh_tokens
  ADD CONSTRAINT refresh_tokens_expiry_after_creation CHECK (expires_at > created_at);

ALTER TABLE password_reset_tokens
  ADD CONSTRAINT password_reset_tokens_expiry_after_creation CHECK (
    expires_at > created_at
  );


-- -------------------------------------------------------------------
-- 8. Trilha de auditoria: imutavel de verdade
-- -------------------------------------------------------------------
-- Prontuario que aceita sobrescrita perde a trilha do que o profissional
-- sabia no momento da sessao. Corrigir "o status era 5, nao 6" e o que
-- quebra a prova num processo judicial. Bloquear UPDATE e o ponto.
--
-- DELETE fica permitido de proposito: ele existe para o cascade de
-- clinica/cliente. Quem protege a retencao em producao e o papel do
-- banco, nao trigger -- a aplicacao nao pode apagar historico, mas o
-- dump diario precisa poder limpar tenant encerrado.
CREATE OR REPLACE FUNCTION prevent_audit_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Tabela % e append-only: o registro % nao pode ser alterado',
    TG_TABLE_NAME, OLD.id
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appointment_status_history_append_only
  BEFORE UPDATE ON appointment_status_history
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_update();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_update();

-- Anamnese ja enviada congela o conteudo clinico, mas continua
-- permitindo a mudanca de status ENVIADA -> APROVADA/REJEITADA e o
-- preenchimento dos campos de revisao. O que nao volta atras e a
-- resposta do cliente.
CREATE OR REPLACE FUNCTION protect_anamnesis_content() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'RASCUNHO' AND (
       NEW.client_id         IS DISTINCT FROM OLD.client_id
    OR NEW.template_id       IS DISTINCT FROM OLD.template_id
    OR NEW.version           IS DISTINCT FROM OLD.version
    OR NEW.answers_encrypted IS DISTINCT FROM OLD.answers_encrypted
    OR NEW.content_hash      IS DISTINCT FROM OLD.content_hash
    OR NEW.submitted_at      IS DISTINCT FROM OLD.submitted_at
    OR NEW.signed_at         IS DISTINCT FROM OLD.signed_at
    OR NEW.created_at        IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION
      'Anamnese % (versao %) ja enviada e imutavel: crie a versao %',
      OLD.id, OLD.version, OLD.version + 1
      USING ERRCODE = '23514';
    END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER anamneses_content_immutable
  BEFORE UPDATE ON anamneses
  FOR EACH ROW EXECUTE FUNCTION protect_anamnesis_content();


-- -------------------------------------------------------------------
-- 9. Indices parciais
-- -------------------------------------------------------------------
-- O indice geral cobre consulta por clinica e periodo. Estes sao os que
-- a operacao consulta o dia inteiro, e o indice parcial mantem o indice
-- pequeno: em vez de millions de linhas, so as pendentes.
CREATE INDEX appointments_active_calendar_idx
  ON appointments (clinic_id, start_at)
  WHERE status IN ('AGENDADO_PENDENTE', 'CONFIRMADO', 'EM_ATENDIMENTO');

CREATE INDEX appointments_awaiting_confirmation_idx
  ON appointments (clinic_id, start_at)
  WHERE status = 'AGENDADO_PENDENTE';

-- Carteira a receber e o unico BI que o usuario abre todo dia.
CREATE INDEX financial_entries_open_idx
  ON financial_entries (clinic_id, due_date)
  WHERE status IN ('PENDENTE', 'INADIMPENTE');

-- Fila do pg-boss sempre pergunta "o que vence agora".
CREATE INDEX notifications_due_idx
  ON notifications (scheduled_for)
  WHERE status = 'PENDENTE';

-- "Anamnese aprovada deste cliente": versao mais recente primeiro.
CREATE INDEX anamneses_approved_per_client_idx
  ON anamneses (clinic_id, client_id, version DESC)
  WHERE status = 'APROVADA';

-- Alerta de contraindicacao ainda nao decidido, por profissional.
CREATE INDEX contraindication_alerts_pending_idx
  ON contraindication_alerts (clinic_id, decision, created_at DESC)
  WHERE decision = 'PENDENTE';


-- -------------------------------------------------------------------
-- 10. updated_at tem default no banco
-- -------------------------------------------------------------------
-- No schema, `updatedAt` e `@updatedAt`: o Prisma preenche no cliente.
-- Isso deixa qualquer escrita fora do Prisma -- script de manutencao,
-- psql, carga inicial, outro servico -- quebrar com NOT NULL.
--
-- O default nao substitui o @updatedAt: quando o Prisma envia o valor,
-- ele manda; o default so entra quando ninguem manda nada. Rede de
-- seguranca, nao fonte da verdade.
DO $defaults$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'clinics', 'users', 'clinic_memberships', 'professionals', 'clients',
    'therapies', 'therapy_professionals', 'rooms', 'availability_rules',
    'availability_exceptions', 'anamnesis_templates', 'contraindications',
    'client_contraindications', 'packages', 'package_sessions',
    'financial_entries', 'commissions', 'notifications', 'appointments'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN updated_at SET DEFAULT now()',
      v_table
    );
  END LOOP;
END
$defaults$;
