const test = require('node:test');
const assert = require('node:assert/strict');
const { CAPACIDADE_DIARIA, MAX_POR_RESERVA, quantidadeValida, capacidadeDisponivel, cpfPodeReservar } = require('../lib/regras-negocio');

test('capacidade diária configurada em 48 pessoas', () => assert.equal(CAPACIDADE_DIARIA, 48));
test('limite por reserva configurado em 30 pessoas', () => assert.equal(MAX_POR_RESERVA, 30));
test('aceita quantidade entre 1 e 30', () => {
  for (const n of [1, 2, 15, 30, '12']) assert.equal(quantidadeValida(n), true);
});
test('rejeita quantidade fora do limite ou fracionária', () => {
  for (const n of [0, -1, 31, 1.5, 'abc', NaN]) assert.equal(quantidadeValida(n), false);
});
test('aceita reserva que completa exatamente 48 lugares', () => assert.equal(capacidadeDisponivel(18, 30), true));
test('rejeita reserva que ultrapassa 48 lugares', () => assert.equal(capacidadeDisponivel(19, 30), false));
test('aceita primeira reserva quando CPF não tem reserva ativa', () => assert.equal(cpfPodeReservar(0), true));
test('rejeita nova reserva quando CPF já tem reserva ativa', () => assert.equal(cpfPodeReservar(1), false));
test('rejeita contagem inválida de reservas ativas', () => assert.equal(cpfPodeReservar(-1), false));
test('capacidade rejeita totais e quantidades inválidas', () => {
  assert.equal(capacidadeDisponivel(-1, 2), false);
  assert.equal(capacidadeDisponivel(10, 0), false);
  assert.equal(capacidadeDisponivel('x', 2), false);
});
