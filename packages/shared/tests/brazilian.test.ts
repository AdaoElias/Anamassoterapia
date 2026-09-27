import { describe, expect, it } from 'vitest';

import {
  isValidCnpj,
  isValidCpf,
  normalizeBrazilianPhone,
  normalizeCep,
  normalizeSearchText,
} from '../src/index.js';

describe('CPF', () => {
  it('aceita CPF valido e normaliza para 11 digitos', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });

  it('rejeita CPF com digito verificador errado', () => {
    expect(isValidCpf('529.982.247-26')).toBe(false);
  });

  it('rejeita CPF de digitos repetidos', () => {
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('00000000000')).toBe(false);
  });

  it('rejeita tamanho invalido', () => {
    expect(isValidCpf('1234567890')).toBe(false);
    expect(isValidCpf('529982247250')).toBe(false);
  });
});

describe('CNPJ', () => {
  it('aceita CNPJ valido e normaliza para 14 digitos', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
  });

  it('rejeita CNPJ invalido', () => {
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
  });
});

describe('telefone', () => {
  it('converte celular de 11 digitos para E.164 com DDI', () => {
    expect(normalizeBrazilianPhone('(11) 98765-4321')).toBe('5511987654321');
  });

  it('aceita celular sem pontuacao', () => {
    expect(normalizeBrazilianPhone('11987654321')).toBe('5511987654321');
  });

  it('remove o DDI informado', () => {
    expect(normalizeBrazilianPhone('+55 11 98765-4321')).toBe('5511987654321');
  });

  it('remove o DDI tambem em telefone fixo', () => {
    expect(normalizeBrazilianPhone('+55 11 3456-7890')).toBe('551134567890');
  });

  it('mantem telefone fixo de 10 digitos sem inserir nono digito', () => {
    expect(normalizeBrazilianPhone('11 3456-7890')).toBe('551134567890');
  });

  it('rejeita celular de 11 digitos sem o nono na posicao correta', () => {
    // 11 digitos = DDD 11 + 8 87654321. Celular exige o 9 em index 2.
    expect(normalizeBrazilianPhone('11 88765-4321')).toBeNull();
  });

  it('rejeita DDD invalido ou comecando com zero', () => {
    expect(normalizeBrazilianPhone('01 98765-4321')).toBeNull();
    expect(normalizeBrazilianPhone('10 98765-4321')).toBeNull();
  });

  it('idempotente quando ja esta em E.164', () => {
    expect(normalizeBrazilianPhone('5511987654321')).toBe('5511987654321');
    expect(normalizeBrazilianPhone('5511987654321')).toBe(normalizeBrazilianPhone('5511987654321'));
  });

  it('rejeita entrada nao numerica', () => {
    expect(normalizeBrazilianPhone('nao e telefone')).toBeNull();
  });
});

describe('cep', () => {
  it('normaliza para 8 digitos', () => {
    expect(normalizeCep('01310-100')).toBe('01310100');
  });

  it('rejeita tamanho invalido', () => {
    expect(normalizeCep('1310100')).toBeNull();
  });
});

describe('busca', () => {
  it('remove acento, caixa e espacos redundantes', () => {
    expect(normalizeSearchText('  João  Ábaco ')).toBe('JOAO ABACO');
  });

  it('colapsa espacos internos e tabulacoes', () => {
    expect(normalizeSearchText('dor\t\n cervical')).toBe('DOR CERVICAL');
  });
});
