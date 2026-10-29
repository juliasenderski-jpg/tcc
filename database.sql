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


-- Contas individuais para acesso ao painel administrativo.
CREATE TABLE IF NOT EXISTS funcionarios (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  usuario VARCHAR(30) NOT NULL UNIQUE,
  senha_hash VARCHAR(200) NOT NULL,
  papel ENUM('gerente','funcionario') NOT NULL DEFAULT 'funcionario',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- Registro de auditoria das ações importantes do sistema.
CREATE TABLE IF NOT EXISTS auditoria (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  funcionario_id BIGINT UNSIGNED NULL,
  funcionario_nome VARCHAR(100) NOT NULL,
  acao VARCHAR(60) NOT NULL,
  entidade VARCHAR(40) NOT NULL,
  entidade_id BIGINT UNSIGNED NULL,
  detalhes JSON NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  criada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auditoria_data (criada_em),
  INDEX idx_auditoria_funcionario (funcionario_id),
  CONSTRAINT fk_auditoria_funcionario FOREIGN KEY (funcionario_id)
    REFERENCES funcionarios(id) ON DELETE SET NULL
);
