-- ===================================================================
-- Unicidade do bloqueio de dia inteiro
-- ===================================================================
-- O indice unico `(professional_id, date, type, start_minute)` nao
-- protege o caso "dia inteiro", porque esse caso e gravado com
-- `start_minute IS NULL` e no PostgreSQL NULL nunca conflita num indice
-- unico. Resultado: quantas vezes o balcao clicasse "bloquear o dia",
-- nascia outra linha, e o profissional aparecia bloqueado duas vezes
-- no mesmo dia.
--
-- Alem disso o `upsert` do Prisma nao consegue casar `start_minute =
-- NULL` (vira `= NULL`, que nunca e verdadeiro), entao o seed criaria
-- uma linha nova a cada execucao.
--
-- A correcao mantem as colunas anulaveis -- "janela ausente" e
-- "dia inteiro" sao estados diferentes, e o CHECK
-- `availability_exceptions_extra_has_window` depende disso -- e
-- garante a unicidade dos dois casos:
--   - com janela: coberto pelo indice unico de 4 colunas;
--   - sem janela: coberto por este indice parcial.
-- ===================================================================

CREATE UNIQUE INDEX "availability_exceptions_all_day_key"
  ON "availability_exceptions" ("professional_id", "date", "type")
  WHERE "start_minute" IS NULL;
