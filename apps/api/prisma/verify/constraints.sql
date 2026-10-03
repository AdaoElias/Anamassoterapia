-- ===================================================================
-- Verificacao das garantias de dominio no banco.
-- ===================================================================
-- Cada bloco tenta gravar algo que a constraint deve recusar, ou que
-- deve passar. Divergencia vira contagem de falha e, no fim, um erro
-- que derruba o processo -- assim o CI nao passa com "FALHOU" escondido
-- em NOTICE.
--
-- Roda dentro de uma transacao e desfaz tudo: nao deixa residuo.
--
--   psql "$DATABASE_URL" -f apps/api/prisma/verify/constraints.sql
--   pnpm --filter @massoterapia/api db:verify
-- ===================================================================

BEGIN;

DO $verify$
DECLARE
  v_clinic  uuid := '11111111-0000-0000-0000-000000000001';
  v_client  uuid := '22222222-0000-0000-0000-000000000001';
  v_client2 uuid := '22222222-0000-0000-0000-000000000002';
  v_prof    uuid := '33333333-0000-0000-0000-000000000001';
  v_prof2   uuid := '33333333-0000-0000-0000-000000000002';
  v_therapy uuid := '44444444-0000-0000-0000-000000000001';
  v_room    uuid := '55555555-0000-0000-0000-000000000001';
  v_base    timestamptz := '2026-10-05 13:00:00+00';
  v_failures integer := 0;
BEGIN
  ------------------------------------------------------------------
  -- Base
  ------------------------------------------------------------------
  INSERT INTO clinics (id, slug, name)
    VALUES (v_clinic, 'verificacao', 'Verificacao');

  INSERT INTO clients (id, clinic_id, name)
    VALUES (v_client, v_clinic, 'Cliente A'), (v_client2, v_clinic, 'Cliente B');

  INSERT INTO professionals (id, clinic_id, name)
    VALUES (v_prof, v_clinic, 'Prof'), (v_prof2, v_clinic, 'Prof 2');

  INSERT INTO therapies (id, clinic_id, name, slug, price_cents)
    VALUES (v_therapy, v_clinic, 'Relaxante', 'relaxante', 12000);

  INSERT INTO rooms (id, clinic_id, name) VALUES (v_room, v_clinic, 'Sala 1');

  INSERT INTO appointments (
    id, clinic_id, client_id, professional_id, therapy_id, room_id,
    start_at, end_at, status, price_cents
  ) VALUES (
    '66666666-0000-0000-0000-000000000001', v_clinic, v_client, v_prof, v_therapy, v_room,
    v_base, v_base + interval '60 min', 'CONFIRMADO', 12000
  );

  ------------------------------------------------------------------
  -- 1. Sobreposicao no mesmo profissional e recusada
  --    23P01 = exclusion_violation. E o que a API converte em 409.
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO appointments (
      id, clinic_id, client_id, professional_id, therapy_id, room_id,
      start_at, end_at, status, price_cents
    ) VALUES (
      '66666666-0000-0000-0000-000000000002', v_clinic, v_client2, v_prof, v_therapy, v_room,
      v_base + interval '30 min', v_base + interval '90 min', 'CONFIRMADO', 12000
    );
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 1: sobreposicao de profissional foi aceita';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'OK 1: sobreposicao de profissional rejeitada (%)', SQLSTATE;
  END;

  ------------------------------------------------------------------
  -- 2. Sessao encostada e aceita.
  --    tstzrange '[)' trata 13:00-14:00 e 14:00-15:00 como adjacentes.
  --    Com '[)' fechado, uma agenda com sessoes em sequencia seria
  --    rejeitada inteira.
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO appointments (
      id, clinic_id, client_id, professional_id, therapy_id, room_id,
      start_at, end_at, status, price_cents
    ) VALUES (
      '66666666-0000-0000-0000-000000000003', v_clinic, v_client2, v_prof, v_therapy, v_room,
      v_base + interval '60 min', v_base + interval '120 min', 'CONFIRMADO', 12000
    );
    RAISE NOTICE 'OK 2: sessao encostada aceita';
  EXCEPTION WHEN others THEN
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 2: encostado foi rejeitado (%)', SQLERRM;
  END;

  ------------------------------------------------------------------
  -- 3. CANCELADO libera a agenda: passa mesmo sobrepondo.
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO appointments (
      id, clinic_id, client_id, professional_id, therapy_id, room_id,
      start_at, end_at, status, price_cents, cancellation_reason
    ) VALUES (
      '66666666-0000-0000-0000-000000000004', v_clinic, v_client2, v_prof, v_therapy, v_room,
      v_base, v_base + interval '60 min', 'CANCELADO', 12000, 'CLIENTE_DESISTIU'
    );
    RAISE NOTICE 'OK 3: cancelado libera o horario';
  EXCEPTION WHEN others THEN
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 3: cancelado bloqueou a agenda (%)', SQLERRM;
  END;

  ------------------------------------------------------------------
  -- 4. Sala ocupada por outro profissional e recusada.
  --    Recurso compartilhado: dois profissionais, uma sala, um horario.
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO appointments (
      id, clinic_id, client_id, professional_id, therapy_id, room_id,
      start_at, end_at, status, price_cents
    ) VALUES (
      '66666666-0000-0000-0000-000000000005', v_clinic, v_client2, v_prof2, v_therapy, v_room,
      v_base + interval '15 min', v_base + interval '75 min', 'CONFIRMADO', 12000
    );
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 4: sala ocupada foi aceita';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'OK 4: sala ocupada rejeitada (%)', SQLSTATE;
  END;

  ------------------------------------------------------------------
  -- 5. O mesmo cliente em dois lugares e recusado.
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO appointments (
      id, clinic_id, client_id, professional_id, therapy_id,
      start_at, end_at, status, price_cents
    ) VALUES (
      '66666666-0000-0000-0000-000000000006', v_clinic, v_client, v_prof2, v_therapy,
      v_base + interval '30 min', v_base + interval '90 min', 'CONFIRMADO', 12000
    );
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 5: cliente em dois lugares foi aceito';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'OK 5: cliente em dois lugares rejeitado (%)', SQLSTATE;
  END;

  ------------------------------------------------------------------
  -- 6. Duracao zero e recusada.
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO appointments (
      id, clinic_id, client_id, professional_id, therapy_id,
      start_at, end_at, status, price_cents
    ) VALUES (
      '66666666-0000-0000-0000-000000000007', v_clinic, v_client2, v_prof, v_therapy,
      v_base, v_base, 'CONFIRMADO', 12000
    );
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 6: sessao de duracao zero foi aceita';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK 6: duracao zero rejeitada (%)', SQLSTATE;
  END;

  ------------------------------------------------------------------
  -- 7. Cancelamento sem motivo e recusado.
  --    "Por que cancelou" e a primeira pergunta de qualquer dispute.
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO appointments (
      id, clinic_id, client_id, professional_id, therapy_id,
      start_at, end_at, status, price_cents
    ) VALUES (
      '66666666-0000-0000-0000-000000000008', v_clinic, v_client2, v_prof, v_therapy,
      v_base + interval '300 min', v_base + interval '360 min', 'CANCELADO', 12000
    );
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 7: cancelamento sem motivo foi aceito';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK 7: cancelamento exige motivo registrado (%)', SQLSTATE;
  END;

  ------------------------------------------------------------------
  -- 8. Anamnese enviada: resposta imutavel, status pode avancar
  ------------------------------------------------------------------
  INSERT INTO anamneses (
    id, clinic_id, client_id, version, status, submitted_at, answers_encrypted
  ) VALUES (
    '77777777-0000-0000-0000-000000000001', v_clinic, v_client, 1, 'ENVIADA', now(), 'iv:tag:ct'
  );

  BEGIN
    UPDATE anamneses SET answers_encrypted = 'adulterado'
      WHERE id = '77777777-0000-0000-0000-000000000001';
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 8: resposta de anamnese enviada foi alterada';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK 8: resposta de anamnese enviada e imutavel';
  END;

  BEGIN
    UPDATE anamneses SET status = 'APROVADA', reviewed_at = now()
      WHERE id = '77777777-0000-0000-0000-000000000001';
    RAISE NOTICE 'OK 9: revisao ENVIADA -> APROVADA permitida';
  EXCEPTION WHEN others THEN
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 9: revisao da anamnese foi bloqueada (%)', SQLERRM;
  END;

  ------------------------------------------------------------------
  -- 10. Rascunho continua editavel
  ------------------------------------------------------------------
  INSERT INTO anamneses (
    id, clinic_id, client_id, version, status, answers_encrypted
  ) VALUES (
    '77777777-0000-0000-0000-000000000002', v_clinic, v_client, 2, 'RASCUNHO', 'rascunho:1'
  );

  BEGIN
    UPDATE anamneses SET answers_encrypted = 'rascunho:2'
      WHERE id = '77777777-0000-0000-0000-000000000002';
    RAISE NOTICE 'OK 10: rascunho continua editavel';
  EXCEPTION WHEN others THEN
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 10: rascunho travou (%)', SQLERRM;
  END;

  ------------------------------------------------------------------
  -- 11. Historico de status e append-only
  ------------------------------------------------------------------
  INSERT INTO appointment_status_history (
    id, clinic_id, appointment_id, from_status, to_status
  ) VALUES (
    '88888888-0000-0000-0000-000000000001', v_clinic,
    '66666666-0000-0000-0000-000000000001', 'AGENDADO_PENDENTE', 'CONFIRMADO'
  );

  BEGIN
    UPDATE appointment_status_history SET to_status = 'CONCLUIDO'
      WHERE id = '88888888-0000-0000-0000-000000000001';
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 11: historico de status foi alterado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK 11: historico de status e imutavel';
  END;

  ------------------------------------------------------------------
  -- 12. PAGO sem data de recebimento e recusado
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO financial_entries (id, clinic_id, kind, status, amount_cents)
      VALUES ('99999999-0000-0000-0000-000000000001', v_clinic, 'RECEITA', 'PAGO', 12000);
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 12: lancamento PAGO sem data foi aceito';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK 12: PAGO exige data de recebimento (%)', SQLSTATE;
  END;

  ------------------------------------------------------------------
  -- 13. Regra de disponibilidade invertida e recusada
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO availability_rules (
      id, clinic_id, professional_id, weekday, start_minute, end_minute, effective_from
    ) VALUES (
      'aaaaaaaa-0000-0000-0000-000000000001', v_clinic, v_prof, 1, 600, 540, current_date
    );
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 13: regra de disponibilidade invertida foi aceita';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK 13: disponibilidade exige fim depois do inicio (%)', SQLSTATE;
  END;

  ------------------------------------------------------------------
  -- 14. Excecao EXTRA sem janela e recusada
  --     Nao existe "horario extra" indefinido.
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO availability_exceptions (
      id, clinic_id, professional_id, date, type
    ) VALUES (
      'aaaaaaaa-0000-0000-0000-000000000002', v_clinic, v_prof, current_date, 'EXTRA'
    );
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 14: excecao EXTRA sem janela foi aceita';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK 14: excecao EXTRA exige janela de horario (%)', SQLSTATE;
  END;

  ------------------------------------------------------------------
  -- 15. updated_at tem default no banco
  --     O schema marca @updatedAt, que e client-side. Sem o default,
  --     qualquer escrita fora do Prisma quebra com NOT NULL.
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO therapies (id, clinic_id, name, slug, price_cents)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000001', v_clinic, 'Sem updated_at', 'sem-updated-at', 100);
    RAISE NOTICE 'OK 15: updated_at tem default no banco';
  EXCEPTION WHEN not_null_violation THEN
    v_failures := v_failures + 1;
    RAISE NOTICE 'FALHOU 15: updated_at sem default no banco';
  END;

  IF v_failures > 0 THEN
    RAISE EXCEPTION '% verificacao(oes) falharam', v_failures;
  END IF;

  RAISE NOTICE 'Todas as 15 verificacoes passaram.';
END
$verify$;

ROLLBACK;
