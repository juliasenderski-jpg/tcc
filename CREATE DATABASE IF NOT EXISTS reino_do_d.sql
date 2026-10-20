CREATE DATABASE IF NOT EXISTS reino_do_dragao
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE reino_do_dragao;

CREATE TABLE IF NOT EXISTS clientes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  cpf CHAR(11) NOT NULL UNIQUE,
  telefone VARCHAR(20) NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reservas (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id BIGINT UNSIGNED NOT NULL,
  data_reserva DATE NOT NULL,
  quantidade_pessoas TINYINT UNSIGNED NOT NULL,
  status ENUM('Confirmada','Cancelada') NOT NULL DEFAULT 'Confirmada',
  criada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelada_em TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_reservas_clientes FOREIGN KEY (cliente_id)
    REFERENCES clientes(id),
  CONSTRAINT chk_quantidade CHECK (quantidade_pessoas BETWEEN 1 AND 30),
  INDEX idx_reservas_data_status (data_reserva, status),
  INDEX idx_reservas_cliente_status (cliente_id, status)
);

CREATE TABLE IF NOT EXISTS notificacoes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reserva_id BIGINT UNSIGNED NULL,
  cpf_cliente CHAR(11) NOT NULL,
  tipo ENUM('RESERVA','CANCELAMENTO') NOT NULL,
  mensagem VARCHAR(500) NOT NULL,
  criada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notificacoes_reservas FOREIGN KEY (reserva_id)
    REFERENCES reservas(id) ON DELETE SET NULL,
  INDEX idx_notificacoes_cpf (cpf_cliente)
);
