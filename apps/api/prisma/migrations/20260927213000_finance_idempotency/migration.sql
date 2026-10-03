-- ===================================================================
-- Idempotencia nas escritas financeiras
-- ===================================================================
-- Tres chaves naturais que o dominio ja exigia e que so o seed ou a
-- migracao de dados iam discovers na marra:
--
--  1. financial_entries.idempotency_key -- gateway reenvia webhook e
--     cliente clica duas vezes. Sem chave, um atendimento vira dois
--     lancamentos e o caixa nao fecha. Mesmo padrao ja adotado em
--     appointments.idempotency_key.
--  2. packages (clinic_id, client_id, name) -- dois pacotes com o mesmo
--     nome para o mesmo cliente sao o mesmo pacote.
--  3. commissions (appointment_id, professional_id) -- um profissional
--     tem uma comissao por sessao. `appointment_id` nulo (adiantamento)
--     nao colide: no Postgres NULL nao conflita em indice unico.
-- ===================================================================

-- AlterTable
ALTER TABLE "financial_entries" ADD COLUMN "idempotency_key" VARCHAR(80);

-- CreateIndex
CREATE UNIQUE INDEX "financial_entries_clinic_id_idempotency_key_key" ON "financial_entries"("clinic_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "packages_clinic_id_client_id_name_key" ON "packages"("clinic_id", "client_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_appointment_id_professional_id_key" ON "commissions"("appointment_id", "professional_id");
