-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PROFISSIONAL', 'CLIENTE');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('AGENDADO_PENDENTE', 'CONFIRMADO', 'EM_ATENDIMENTO', 'CONCLUIDO', 'CANCELADO', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('PORTAL_CLIENTE', 'ADMIN', 'PROFISSIONAL', 'IMPORTADO');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('CLIENTE_DESISTIU', 'CLIENTE_REAGENDOU', 'FALTA_DO_PROFISSIONAL', 'CONDICAO_CLINICA', 'FORCA_MAIOR', 'NAO_INFORMADO');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'DINHEIRO', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'BOLETO', 'TRANSFERENCIA', 'ASSINATURA', 'PACOTE', 'OUTRO');

-- CreateEnum
CREATE TYPE "FinancialEntryStatus" AS ENUM ('PENDENTE', 'PAGO', 'CANCELADO', 'INADIMPENTE');

-- CreateEnum
CREATE TYPE "FinancialEntryKind" AS ENUM ('RECEITA', 'DESPESA', 'COMISSAO');

-- CreateEnum
CREATE TYPE "AvailabilityExceptionType" AS ENUM ('BLOQUEIO', 'EXTRA');

-- CreateEnum
CREATE TYPE "AnamnesisStatus" AS ENUM ('RASCUNHO', 'ENVIADA', 'APROVADA', 'REJEITADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('BAIXA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "AlertDecision" AS ENUM ('PENDENTE', 'ACEITO', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('ATIVO', 'CONCLUIDO', 'CANCELADO', 'EXPIRADO');

-- CreateEnum
CREATE TYPE "PackageSessionStatus" AS ENUM ('DISPONIVEL', 'UTILIZADA', 'CANCELADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PREVISTA', 'APROVADA', 'PAGA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CONFIRMACAO_AGENDAMENTO', 'LEMBRETE', 'LEMBRETE_ANAMNESE', 'ANAMNESE_PENDENTE', 'CANCELAMENTO', 'REAGENDAMENTO', 'PAGAMENTO_PENDENTE', 'PAGAMENTO_RECEBIDO', 'NOVO_AGENDAMENTO', 'ALERTA_CONTRAINDICACAO');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDENTE', 'ENVIANDO', 'ENVIADO', 'ERRO', 'CANCELADO');

-- CreateTable
CREATE TABLE "clinics" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "legal_name" VARCHAR(160),
    "cnpj" VARCHAR(14),
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "address_line1" VARCHAR(160),
    "address_line2" VARCHAR(160),
    "address_city" VARCHAR(80),
    "address_state" CHAR(2),
    "address_zip" VARCHAR(9),
    "booking_terms" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20),
    "consent_flags" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "email_verified_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "token_epoch" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_memberships" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "job_title" VARCHAR(80),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clinic_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_id" UUID,
    "user_agent" VARCHAR(300),
    "ip" VARCHAR(45),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professionals" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "user_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "registration_number" VARCHAR(40),
    "registration_type" VARCHAR(20),
    "bio" VARCHAR(600),
    "color" VARCHAR(7),
    "search_text" VARCHAR(180),
    "default_commission_basis_points" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "user_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "cpf" VARCHAR(11),
    "birth_date" DATE,
    "gender" VARCHAR(40),
    "address_line1" VARCHAR(160),
    "address_city" VARCHAR(80),
    "address_state" CHAR(2),
    "address_zip" VARCHAR(9),
    "notes" VARCHAR(1000),
    "search_text" VARCHAR(180),
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapies" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "description" VARCHAR(1200),
    "category" VARCHAR(60),
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "price_cents" INTEGER NOT NULL,
    "color" VARCHAR(7),
    "image_url" VARCHAR(300),
    "requires_anamnesis" BOOLEAN NOT NULL DEFAULT true,
    "requires_medical_clearance" BOOLEAN NOT NULL DEFAULT false,
    "min_notice_minutes" INTEGER NOT NULL DEFAULT 0,
    "min_age" INTEGER,
    "max_age" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "therapies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_professionals" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "therapy_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "custom_duration_minutes" INTEGER,
    "custom_price_cents" INTEGER,
    "custom_buffer_minutes" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "therapy_professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_rules" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "slot_granularity_minutes" INTEGER NOT NULL DEFAULT 15,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_exceptions" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "type" "AvailabilityExceptionType" NOT NULL,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "reason" VARCHAR(200),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "availability_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_holidays" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "therapy_id" UUID NOT NULL,
    "room_id" UUID,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'AGENDADO_PENDENTE',
    "source" "AppointmentSource" NOT NULL DEFAULT 'PORTAL_CLIENTE',
    "price_cents" INTEGER NOT NULL,
    "notes" VARCHAR(1000),
    "session_notes" VARCHAR(2000),
    "cancellation_reason" "CancellationReason",
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "idempotency_key" VARCHAR(80),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_status_history" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "from_status" "AppointmentStatus",
    "to_status" "AppointmentStatus" NOT NULL,
    "reason" VARCHAR(300),
    "changed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anamnesis_templates" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(600),
    "version" INTEGER NOT NULL DEFAULT 1,
    "schema" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "anamnesis_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_anamnesis_templates" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "therapy_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapy_anamnesis_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anamneses" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "template_id" UUID,
    "version" INTEGER NOT NULL,
    "status" "AnamnesisStatus" NOT NULL DEFAULT 'RASCUNHO',
    "answers_encrypted" TEXT,
    "content_hash" CHAR(64),
    "signed_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anamneses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_anamneses" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "anamnesis_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_anamneses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contraindications" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(600),
    "severity" "AlertSeverity" NOT NULL DEFAULT 'MEDIA',
    "requires_medical_clearance" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contraindications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_contraindications" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "contraindication_id" UUID,
    "code" VARCHAR(40) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(600),
    "severity" "AlertSeverity" NOT NULL DEFAULT 'MEDIA',
    "requires_medical_clearance" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(200),
    "diagnosed_at" DATE,
    "resolved_at" DATE,
    "notes" VARCHAR(1000),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_contraindications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contraindication_alerts" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "client_contraindication_id" UUID,
    "contraindication_id" UUID,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'MEDIA',
    "message" VARCHAR(600) NOT NULL,
    "decision" "AlertDecision" NOT NULL DEFAULT 'PENDENTE',
    "decision_notes" VARCHAR(1000),
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contraindication_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "total_sessions" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'ATIVO',
    "notes" VARCHAR(600),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_sessions" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "appointment_id" UUID,
    "status" "PackageSessionStatus" NOT NULL DEFAULT 'DISPONIVEL',
    "consumed_at" TIMESTAMPTZ(6),
    "expires_at" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "package_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_entries" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "kind" "FinancialEntryKind" NOT NULL,
    "status" "FinancialEntryStatus" NOT NULL DEFAULT 'PENDENTE',
    "method" "PaymentMethod",
    "client_id" UUID,
    "appointment_id" UUID,
    "package_id" UUID,
    "amount_cents" INTEGER NOT NULL,
    "due_date" DATE,
    "paid_at" TIMESTAMPTZ(6),
    "fee_cents" INTEGER,
    "description" VARCHAR(300),
    "notes" VARCHAR(1000),
    "external_id" VARCHAR(120),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "financial_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "appointment_id" UUID,
    "financial_entry_id" UUID,
    "base_amount_cents" INTEGER NOT NULL,
    "percent_basis_points" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PREVISTA',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "notes" VARCHAR(600),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "client_id" UUID,
    "appointment_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "type" "NotificationType" NOT NULL,
    "recipient" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDENTE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(600),
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "external_id" VARCHAR(160),
    "dedupe_key" VARCHAR(160),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "clinic_id" UUID,
    "actor_user_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity" VARCHAR(80) NOT NULL,
    "entity_id" VARCHAR(80),
    "metadata" JSONB,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ContraindicationToTherapy" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_ContraindicationToTherapy_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinics_slug_key" ON "clinics"("slug");

-- CreateIndex
CREATE INDEX "clinics_active_idx" ON "clinics"("active");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "clinic_memberships_user_id_idx" ON "clinic_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_memberships_clinic_id_user_id_role_key" ON "clinic_memberships"("clinic_id", "user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_id_key" ON "refresh_tokens"("replaced_by_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_family_id_idx" ON "refresh_tokens"("user_id", "family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "professionals_clinic_id_active_idx" ON "professionals"("clinic_id", "active");

-- CreateIndex
CREATE INDEX "professionals_clinic_id_search_text_idx" ON "professionals"("clinic_id", "search_text");

-- CreateIndex
CREATE UNIQUE INDEX "professionals_clinic_id_user_id_key" ON "professionals"("clinic_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "professionals_clinic_id_registration_number_key" ON "professionals"("clinic_id", "registration_number");

-- CreateIndex
CREATE INDEX "clients_clinic_id_active_idx" ON "clients"("clinic_id", "active");

-- CreateIndex
CREATE INDEX "clients_clinic_id_search_text_idx" ON "clients"("clinic_id", "search_text");

-- CreateIndex
CREATE INDEX "clients_clinic_id_phone_idx" ON "clients"("clinic_id", "phone");

-- CreateIndex
CREATE INDEX "clients_clinic_id_email_idx" ON "clients"("clinic_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "clients_clinic_id_user_id_key" ON "clients"("clinic_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_clinic_id_cpf_key" ON "clients"("clinic_id", "cpf");

-- CreateIndex
CREATE INDEX "therapies_clinic_id_active_position_idx" ON "therapies"("clinic_id", "active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "therapies_clinic_id_slug_key" ON "therapies"("clinic_id", "slug");

-- CreateIndex
CREATE INDEX "therapy_professionals_professional_id_idx" ON "therapy_professionals"("professional_id");

-- CreateIndex
CREATE UNIQUE INDEX "therapy_professionals_therapy_id_professional_id_key" ON "therapy_professionals"("therapy_id", "professional_id");

-- CreateIndex
CREATE INDEX "rooms_clinic_id_active_idx" ON "rooms"("clinic_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_clinic_id_name_key" ON "rooms"("clinic_id", "name");

-- CreateIndex
CREATE INDEX "availability_rules_clinic_id_professional_id_weekday_effect_idx" ON "availability_rules"("clinic_id", "professional_id", "weekday", "effective_from");

-- CreateIndex
CREATE INDEX "availability_exceptions_clinic_id_date_idx" ON "availability_exceptions"("clinic_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "availability_exceptions_professional_id_date_type_start_min_key" ON "availability_exceptions"("professional_id", "date", "type", "start_minute");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_holidays_clinic_id_date_key" ON "clinic_holidays"("clinic_id", "date");

-- CreateIndex
CREATE INDEX "appointments_clinic_id_start_at_idx" ON "appointments"("clinic_id", "start_at");

-- CreateIndex
CREATE INDEX "appointments_professional_id_start_at_idx" ON "appointments"("professional_id", "start_at");

-- CreateIndex
CREATE INDEX "appointments_client_id_start_at_idx" ON "appointments"("client_id", "start_at");

-- CreateIndex
CREATE INDEX "appointments_clinic_id_status_start_at_idx" ON "appointments"("clinic_id", "status", "start_at");

-- CreateIndex
CREATE INDEX "appointments_room_id_start_at_idx" ON "appointments"("room_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_clinic_id_idempotency_key_key" ON "appointments"("clinic_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "appointment_status_history_appointment_id_created_at_idx" ON "appointment_status_history"("appointment_id", "created_at");

-- CreateIndex
CREATE INDEX "anamnesis_templates_clinic_id_is_active_idx" ON "anamnesis_templates"("clinic_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "anamnesis_templates_clinic_id_name_version_key" ON "anamnesis_templates"("clinic_id", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "therapy_anamnesis_templates_therapy_id_template_id_key" ON "therapy_anamnesis_templates"("therapy_id", "template_id");

-- CreateIndex
CREATE INDEX "anamneses_clinic_id_status_idx" ON "anamneses"("clinic_id", "status");

-- CreateIndex
CREATE INDEX "anamneses_client_id_version_idx" ON "anamneses"("client_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "anamneses_clinic_id_client_id_version_key" ON "anamneses"("clinic_id", "client_id", "version");

-- CreateIndex
CREATE INDEX "appointment_anamneses_anamnesis_id_idx" ON "appointment_anamneses"("anamnesis_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_anamneses_appointment_id_key" ON "appointment_anamneses"("appointment_id");

-- CreateIndex
CREATE INDEX "contraindications_clinic_id_active_idx" ON "contraindications"("clinic_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "contraindications_clinic_id_code_key" ON "contraindications"("clinic_id", "code");

-- CreateIndex
CREATE INDEX "client_contraindications_clinic_id_client_id_resolved_at_idx" ON "client_contraindications"("clinic_id", "client_id", "resolved_at");

-- CreateIndex
CREATE INDEX "contraindication_alerts_appointment_id_idx" ON "contraindication_alerts"("appointment_id");

-- CreateIndex
CREATE INDEX "contraindication_alerts_clinic_id_decision_idx" ON "contraindication_alerts"("clinic_id", "decision");

-- CreateIndex
CREATE INDEX "packages_clinic_id_client_id_status_idx" ON "packages"("clinic_id", "client_id", "status");

-- CreateIndex
CREATE INDEX "packages_clinic_id_valid_until_idx" ON "packages"("clinic_id", "valid_until");

-- CreateIndex
CREATE UNIQUE INDEX "package_sessions_appointment_id_key" ON "package_sessions"("appointment_id");

-- CreateIndex
CREATE INDEX "package_sessions_package_id_status_idx" ON "package_sessions"("package_id", "status");

-- CreateIndex
CREATE INDEX "financial_entries_clinic_id_kind_status_idx" ON "financial_entries"("clinic_id", "kind", "status");

-- CreateIndex
CREATE INDEX "financial_entries_clinic_id_due_date_idx" ON "financial_entries"("clinic_id", "due_date");

-- CreateIndex
CREATE INDEX "financial_entries_client_id_status_idx" ON "financial_entries"("client_id", "status");

-- CreateIndex
CREATE INDEX "commissions_clinic_id_professional_id_period_start_idx" ON "commissions"("clinic_id", "professional_id", "period_start");

-- CreateIndex
CREATE INDEX "commissions_status_idx" ON "commissions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_status_scheduled_for_idx" ON "notifications"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "notifications_clinic_id_type_created_at_idx" ON "notifications"("clinic_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "notifications_appointment_id_idx" ON "notifications"("appointment_id");

-- CreateIndex
CREATE INDEX "audit_logs_clinic_id_created_at_idx" ON "audit_logs"("clinic_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "_ContraindicationToTherapy_B_index" ON "_ContraindicationToTherapy"("B");

-- AddForeignKey
ALTER TABLE "clinic_memberships" ADD CONSTRAINT "clinic_memberships_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_memberships" ADD CONSTRAINT "clinic_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapies" ADD CONSTRAINT "therapies_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_professionals" ADD CONSTRAINT "therapy_professionals_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_professionals" ADD CONSTRAINT "therapy_professionals_therapy_id_fkey" FOREIGN KEY ("therapy_id") REFERENCES "therapies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_professionals" ADD CONSTRAINT "therapy_professionals_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_holidays" ADD CONSTRAINT "clinic_holidays_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_therapy_id_fkey" FOREIGN KEY ("therapy_id") REFERENCES "therapies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamnesis_templates" ADD CONSTRAINT "anamnesis_templates_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_anamnesis_templates" ADD CONSTRAINT "therapy_anamnesis_templates_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_anamnesis_templates" ADD CONSTRAINT "therapy_anamnesis_templates_therapy_id_fkey" FOREIGN KEY ("therapy_id") REFERENCES "therapies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_anamnesis_templates" ADD CONSTRAINT "therapy_anamnesis_templates_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "anamnesis_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "anamnesis_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_anamneses" ADD CONSTRAINT "appointment_anamneses_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_anamneses" ADD CONSTRAINT "appointment_anamneses_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_anamneses" ADD CONSTRAINT "appointment_anamneses_anamnesis_id_fkey" FOREIGN KEY ("anamnesis_id") REFERENCES "anamneses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contraindications" ADD CONSTRAINT "contraindications_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contraindications" ADD CONSTRAINT "client_contraindications_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contraindications" ADD CONSTRAINT "client_contraindications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contraindications" ADD CONSTRAINT "client_contraindications_contraindication_id_fkey" FOREIGN KEY ("contraindication_id") REFERENCES "contraindications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contraindications" ADD CONSTRAINT "client_contraindications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contraindication_alerts" ADD CONSTRAINT "contraindication_alerts_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contraindication_alerts" ADD CONSTRAINT "contraindication_alerts_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contraindication_alerts" ADD CONSTRAINT "contraindication_alerts_client_contraindication_id_fkey" FOREIGN KEY ("client_contraindication_id") REFERENCES "client_contraindications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contraindication_alerts" ADD CONSTRAINT "contraindication_alerts_contraindication_id_fkey" FOREIGN KEY ("contraindication_id") REFERENCES "contraindications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contraindication_alerts" ADD CONSTRAINT "contraindication_alerts_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_sessions" ADD CONSTRAINT "package_sessions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_financial_entry_id_fkey" FOREIGN KEY ("financial_entry_id") REFERENCES "financial_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContraindicationToTherapy" ADD CONSTRAINT "_ContraindicationToTherapy_A_fkey" FOREIGN KEY ("A") REFERENCES "contraindications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContraindicationToTherapy" ADD CONSTRAINT "_ContraindicationToTherapy_B_fkey" FOREIGN KEY ("B") REFERENCES "therapies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
