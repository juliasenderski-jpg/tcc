const CAPACIDADE_DIARIA = 48;
const MAX_POR_RESERVA = 30;

function quantidadeValida(valor) {
  return Number.isInteger(Number(valor)) && Number(valor) >= 1 && Number(valor) <= MAX_POR_RESERVA;
}

function capacidadeDisponivel(totalConfirmado, novaReserva) {
  const total = Number(totalConfirmado);
  const nova = Number(novaReserva);
  if (!Number.isFinite(total) || !Number.isFinite(nova) || total < 0 || nova < 1) return false;
  return total + nova <= CAPACIDADE_DIARIA;
}

function cpfPodeReservar(quantidadeReservasAtivas) {
  return Number.isInteger(Number(quantidadeReservasAtivas)) && Number(quantidadeReservasAtivas) === 0;
}

module.exports = { CAPACIDADE_DIARIA, MAX_POR_RESERVA, quantidadeValida, capacidadeDisponivel, cpfPodeReservar };
