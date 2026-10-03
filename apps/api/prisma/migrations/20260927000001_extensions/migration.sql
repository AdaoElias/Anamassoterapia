-- Extensoes exigidas pelo modelo.
--
-- btree_gist: permite combinar "=" (uuid) com "&&" (tstzrange) na mesma
-- constraint de exclusao da agenda. Sem ela, um profissional e uma sala
-- nao podem ser garantidos contra conflito pelo banco.
--
-- pgcrypto: gen_random_uuid() para ids gerados no proprio SQL (seed,
-- scripts de manutencao). O Prisma gera os ids da aplicacao, mas o
-- banco tambem precisa saber gerar.
--
-- IF NOT EXISTS para a migration ser idempotente em ambiente novo,
-- ja provisionado e no shadow database usado pelo migrate dev.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
