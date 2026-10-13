import { Leaf } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { CaixaErro, Panel } from '@/components/ui/panel';
import { ApiError } from '@/lib/api';
import { redefinirSenha } from '@/lib/auth';

/**
 * Definicao de senha a partir do link de convite ou de recuperacao.
 *
 * Rota publica: fica fora de `RotaProtegida` porque a pessoa chega aqui sem
 * sessao -- o token do link e a credencial. O mesmo formulario serve ao convite
 * (usuario novo) e a redefinicao (usuario que esqueceu a senha): os dois fluxos
 * compartilham a tabela de token.
 */
export function RedefinirSenhaPage() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    if (token === null) return;

    if (senha !== confirma) {
      setErro('As duas senhas precisam ser iguais.');
      return;
    }

    setEnviando(true);
    setErro(null);
    try {
      await redefinirSenha(token, senha);
      setConcluido(true);
    } catch (error) {
      setErro(
        error instanceof ApiError
          ? error.message
          : 'Nao foi possivel definir a senha. Tente novamente.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-slate-50 p-6">
      <div className="flex flex-col items-center gap-2">
        <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-clay-400 text-white shadow-glow">
          <Leaf size={24} strokeWidth={2.2} />
        </span>
        <p className="text-xl font-bold tracking-tight text-slate-900">Clinica Wave</p>
      </div>

      <div className="w-full max-w-sm">
        <Panel className="space-y-5">
          {token === null ? (
            <div className="space-y-3 text-center">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Link invalido</h1>
              <p className="text-sm text-slate-600">
                Este link nao existe ou esta incompleto. Peca um novo convite a administracao da
                clinica.
              </p>
              <Link to="/login" className="inline-block text-sm text-brand-700 underline">
                Ir para o login
              </Link>
            </div>
          ) : concluido ? (
            <div className="space-y-3 text-center">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Senha definida</h1>
              <p className="text-sm text-slate-600">
                Pronto! Agora voce ja pode entrar com o seu e-mail e a senha que acabou de criar.
              </p>
              <Link to="/login">
                <Button type="button" className="w-full">
                  Ir para o login
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={(evento) => void enviar(evento)} className="space-y-5">
              <header className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Definir senha</h1>
                <p className="text-sm text-slate-500">
                  Escolha uma senha com ao menos 8 caracteres, combinando letras e numeros.
                </p>
              </header>

              <TextField
                label="Nova senha"
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                value={senha}
                onChange={(evento) => setSenha(evento.target.value)}
              />
              <TextField
                label="Confirmar senha"
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                value={confirma}
                onChange={(evento) => setConfirma(evento.target.value)}
              />

              {erro !== null ? <CaixaErro mensagem={erro} /> : null}

              <Button type="submit" disabled={enviando} className="w-full" tamanho="md">
                {enviando ? 'Salvando...' : 'Definir senha'}
              </Button>
            </form>
          )}
        </Panel>
      </div>
    </main>
  );
}
