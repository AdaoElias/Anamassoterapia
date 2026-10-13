/**
 * Provisionamento interno de uma clinica + usuario administrador.
 *
 * Substitui o seed em producao: o seed cria a clinica de demonstracao e esta
 * bloqueado fora de dev/test (`assertNotProduction`). Em producao o tenant
 * precisa nascer por um caminho explicito, executado por quem opera o
 * servidor -- nunca por uma tela publica. Onboarding self-signup fica para
 * depois, porque exige captcha, rate limit e talvez verificacao de e-mail.
 *
 *   pnpm --filter @massoterapia/api provision -- \
 *     --name "Clinica Wave" --email admin@clinicawave.com.br
 *
 * A senha vem da variavel `PROVISION_ADMIN_PASSWORD`, que nao aparece na
 * lista de processos (`ps`) nem no historico do shell. `--senha` tambem
 * funciona, mas e menos seguro e por isso avisa.
 *
 * Clinica, usuario e membership nascem na mesma transacao: clinica sem admin
 * e inacessivel, e admin sem clinica e credencial sem destino.
 */
import { config as loadDotenv } from 'dotenv';
import type { ZodType } from 'zod';

// Antes de qualquer modulo que leia `env`: o `../../.env` e a raiz do monorepo
// (o script roda com cwd em apps/api). `override: false` para uma variavel ja
// injetada pelo provedor de deploy vencer um `.env` esquecido no servidor.
loadDotenv({ path: ['../../.env', '.env'], override: false, quiet: true });

const { z } = await import('zod');
const { slugify } = await import('@massoterapia/shared');
const { env } = await import('../src/config/env.js');
const { prisma, disconnectPrisma } = await import('../src/lib/prisma.js');
const { hashPassword } = await import('../src/lib/password.js');
const { ehConflitoUnico } = await import('../src/lib/cadastros.js');

/** Erro de uso: a mensagem e para o operador, sem stack trace. */
class ErroDeUso extends Error {}

const AJUDA = `Provisiona uma clinica e o usuario ADMIN dela.

Uso:
  pnpm --filter @massoterapia/api provision -- --name "Nome" --email admin@exemplo.com

Obrigatorios:
  --name          Nome da clinica.
  --email         E-mail de login do administrador.

Senha (uma das duas formas):
  PROVISION_ADMIN_PASSWORD=<senha>   (recomendado; nao fica visivel no shell)
  --senha <senha>                    (avisa: fica no historico do shell)

Opcionais:
  --slug          Slug da clinica (default: derivado do nome). Seletor do link publico.
  --admin-name    Nome do administrador (default: o nome da clinica).
  --timezone      IANA, ex.: America/Sao_Paulo (default: America/Sao_Paulo).
  --legal-name    Razao social.
  --cnpj          14 digitos (pontuacao e ignorada).
  --clinic-email  E-mail de contato da clinica (distinto do login).
  --phone         Telefone da clinica.
  --admin-phone   Telefone do administrador.
  --help          Mostra esta ajuda.
`;

function analisarArgumentos(argv: readonly string[]): {
  flags: Map<string, string>;
  posicionais: string[];
} {
  const flags = new Map<string, string>();
  const posicionais: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? '';
    if (!token.startsWith('--')) {
      posicionais.push(token);
      continue;
    }

    const igual = token.indexOf('=');
    if (igual !== -1) {
      flags.set(token.slice(2, igual), token.slice(igual + 1));
      continue;
    }

    const chave = token.slice(2);
    const proximo = argv[i + 1];
    // Sem valor (ou seguido de outra flag), a flag vale "true": e assim que o
    // `--help` funciona.
    if (proximo === undefined || proximo.startsWith('--')) {
      flags.set(chave, 'true');
    } else {
      flags.set(chave, proximo);
      i += 1;
    }
  }

  return { flags, posicionais };
}

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use apenas letras minusculas, numeros e hifens')
  .max(60, 'No maximo 60 caracteres');

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'E-mail muito longo')
  .pipe(z.email('Informe um e-mail valido'));

const senhaSchema = z
  .string()
  .min(8, 'A senha precisa de ao menos 8 caracteres')
  .max(200, 'A senha pode ter no maximo 200 caracteres');

function timezoneValida(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function exigir(flags: Map<string, string>, chave: string): string {
  const valor = flags.get(chave);
  if (valor === undefined || valor === '' || valor === 'true') {
    throw new ErroDeUso(`Falta --${chave}. Veja --help.`);
  }
  return valor;
}

/** Valida um campo com Zod e traduz o erro para uma mensagem de uso. */
function validar<T>(schema: ZodType<T>, valor: string, campo: string): T {
  const resultado = schema.safeParse(valor);
  if (!resultado.success) {
    const primeiro = resultado.error.issues[0];
    throw new ErroDeUso(`${campo}: ${primeiro?.message ?? 'valor invalido'}.`);
  }
  return resultado.data;
}

async function main(): Promise<void> {
  const { flags, posicionais } = analisarArgumentos(process.argv.slice(2));

  if (flags.has('help') || flags.has('ajuda')) {
    process.stdout.write(AJUDA);
    return;
  }
  if (posicionais.length > 0) {
    throw new ErroDeUso(
      `Argumento inesperado: "${posicionais[0]}". Use --chave valor. Veja --help.`,
    );
  }

  const nome = exigir(flags, 'name');
  const email = validar(emailSchema, exigir(flags, 'email'), 'E-mail do administrador');

  const slugBruto = flags.get('slug') ?? slugify(nome);
  const slug = validar(slugSchema, slugBruto, 'Slug');

  const adminNome = flags.get('admin-name') ?? nome;
  const timezone = flags.get('timezone') ?? 'America/Sao_Paulo';
  if (!timezoneValida(timezone)) {
    throw new ErroDeUso(`Timezone IANA invalida: "${timezone}". Ex.: America/Sao_Paulo.`);
  }

  const senhaArg = flags.get('senha');
  const senha = senhaArg ?? process.env['PROVISION_ADMIN_PASSWORD'];
  if (senha === undefined || senha === '') {
    throw new ErroDeUso(
      'Informe a senha em PROVISION_ADMIN_PASSWORD (recomendado) ou em --senha. Veja --help.',
    );
  }
  if (senhaArg !== undefined) {
    process.stderr.write(
      'Aviso: --senha fica visivel no historico do shell e na lista de processos. ' +
        'Prefira PROVISION_ADMIN_PASSWORD.\n',
    );
  }
  validar(senhaSchema, senha, 'Senha');

  let cnpj: string | undefined = flags.get('cnpj');
  if (cnpj !== undefined) {
    cnpj = cnpj.replace(/\D/g, '');
    if (cnpj.length !== 14) throw new ErroDeUso('CNPJ precisa ter 14 digitos.');
  }

  // Checagem amigavel antes da transacao: o erro cru do Postgres
  // (`P2002`) diz "unique constraint" e nao qual campo ja existe.
  const [clinicaExistente, usuarioExistente] = await Promise.all([
    prisma.clinic.findUnique({ where: { slug }, select: { name: true } }),
    prisma.user.findUnique({ where: { email }, select: { name: true } }),
  ]);
  if (clinicaExistente) {
    throw new ErroDeUso(
      `Ja existe uma clinica com o slug "${slug}" (${clinicaExistente.name}). Use --slug para escolher outro.`,
    );
  }
  if (usuarioExistente) {
    throw new ErroDeUso(
      `Ja existe um usuario com o e-mail "${email}" (${usuarioExistente.name}). ` +
        'Reaproveitar usuario existente ainda nao e suportado; use outro e-mail.',
    );
  }

  const passwordHash = await hashPassword(senha);

  try {
    const { clinica, usuario, membership } = await prisma.$transaction(async (tx) => {
      const clinica = await tx.clinic.create({
        data: {
          slug,
          name: nome,
          timezone,
          legalName: flags.get('legal-name') ?? null,
          cnpj: cnpj ?? null,
          email: flags.get('clinic-email') ?? null,
          phone: flags.get('phone') ?? null,
        },
        select: { id: true, name: true, slug: true, timezone: true },
      });

      const usuario = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: adminNome,
          phone: flags.get('admin-phone') ?? null,
        },
        select: { id: true, email: true, name: true },
      });

      const membership = await tx.clinicMembership.create({
        data: { clinicId: clinica.id, userId: usuario.id, role: 'ADMIN' },
        select: { id: true, role: true },
      });

      return { clinica, usuario, membership };
    });

    process.stdout.write(
      [
        '',
        'Clinica provisionada.',
        `  clinica      ${clinica.name} (slug: ${clinica.slug}, tz: ${clinica.timezone})`,
        `  clinica id   ${clinica.id}`,
        `  admin        ${usuario.name} <${usuario.email}>`,
        `  usuario id   ${usuario.id}`,
        `  membership   ${membership.id} (${membership.role})`,
        '',
        `Entre em ${env.WEB_PUBLIC_URL}/login e troque a senha no primeiro acesso.`,
        '',
      ].join('\n'),
    );
  } catch (error) {
    // Corrida entre a checagem e o insert (ou outra instancia): o banco ainda
    // e a fonte de verdade.
    if (ehConflitoUnico(error)) {
      throw new ErroDeUso('Slug ou e-mail ja cadastrado. Nada foi criado.');
    }
    throw error;
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ErroDeUso) {
    process.stderr.write(`\n${error.message}\n`);
  } else {
    process.stderr.write('\nProvisionamento falhou:\n');
    console.error(error);
  }
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
