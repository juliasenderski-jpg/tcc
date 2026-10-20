const test = require('node:test');
const assert = require('node:assert/strict');
const { cpfSoDigitos, cpfValido, dataValida, formatarDataISO } = require('../lib/validacoes');

test('normaliza CPF removendo pontuação', () => {
  assert.equal(cpfSoDigitos('529.982.247-25'), '52998224725');
});

test('aceita CPF com dígitos verificadores válidos', () => {
  assert.equal(cpfValido('529.982.247-25'), true);
});

test('rejeita CPF repetido e CPF inválido', () => {
  assert.equal(cpfValido('111.111.111-11'), false);
  assert.equal(cpfValido('529.982.247-24'), false);
});

test('valida datas reais no formato ISO', () => {
  assert.equal(dataValida('2028-02-29'), true);
  assert.equal(dataValida('2027-02-29'), false);
  assert.equal(dataValida('20/10/2026'), false);
});

test('formata data do MySQL mesmo quando recebida como Date', () => {
  assert.equal(formatarDataISO('2026-10-20'), '20/10/2026');
  assert.equal(formatarDataISO(new Date(2026, 9, 20)), '20/10/2026');
});
