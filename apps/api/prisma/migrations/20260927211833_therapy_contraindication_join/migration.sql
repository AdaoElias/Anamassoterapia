-- ===================================================================
-- Join explicito Therapy <-> Contraindication
-- ===================================================================
-- O M:N implicito gerava a tabela `_ContraindicationToTherapy`, sem
-- `clinic_id`: o banco aceitava vincular uma terapia da clinica A a uma
-- contraindicacao da clinica B, furando o multi-tenant. O join
-- explicito carrega o tenant e ainda permite sobrescrever severidade e
-- exigencia de atestado por clinica.
--
-- NOTA: o `prisma migrate dev` Tambem emitiu
-- `ALTER TABLE ... ALTER COLUMN "updated_at" DROP DEFAULT` em 17
-- tabelas. Esses ALTERs foram removidos de proposito: o default
-- `now()` foi adicionado a mao na migration `constraints`, e o Prisma
-- nao o conhece -- entao ele propoe desfazer uma protecao que existe de
-- proposito (qualquer escrita fora do Prisma passa a marcar
-- `updated_at` em vez de receber NULL). Ver `20260927210000_constraints`.
-- ===================================================================

-- DropForeignKey
ALTER TABLE "_ContraindicationToTherapy" DROP CONSTRAINT "_ContraindicationToTherapy_A_fkey";

-- DropForeignKey
ALTER TABLE "_ContraindicationToTherapy" DROP CONSTRAINT "_ContraindicationToTherapy_B_fkey";

-- DropTable
DROP TABLE "_ContraindicationToTherapy";

-- CreateTable
CREATE TABLE "therapy_contraindications" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "therapy_id" UUID NOT NULL,
    "contraindication_id" UUID NOT NULL,
    -- Nulo = herda o catalogo da contraindicacao.
    "severity" "AlertSeverity",
    "requires_medical_clearance" BOOLEAN,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapy_contraindications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "therapy_contraindications_clinic_id_contraindication_id_idx" ON "therapy_contraindications"("clinic_id", "contraindication_id");

-- CreateIndex
CREATE UNIQUE INDEX "therapy_contraindications_therapy_id_contraindication_id_key" ON "therapy_contraindications"("therapy_id", "contraindication_id");

-- AddForeignKey
ALTER TABLE "therapy_contraindications" ADD CONSTRAINT "therapy_contraindications_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_contraindications" ADD CONSTRAINT "therapy_contraindications_therapy_id_fkey" FOREIGN KEY ("therapy_id") REFERENCES "therapies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_contraindications" ADD CONSTRAINT "therapy_contraindications_contraindication_id_fkey" FOREIGN KEY ("contraindication_id") REFERENCES "contraindications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
