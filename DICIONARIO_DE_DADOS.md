# Dicionário de dados — Reino do Dragão

Tipos resumidos conforme `database.sql`.

## clientes

| Campo | Tipo | Regra | Descrição |
|---|---|---|---|
| id | BIGINT UNSIGNED | PK, auto incremento | Identificador interno do cliente |
| nome | VARCHAR(120) | NOT NULL | Nome do cliente |
| cpf | CHAR(11) | NOT NULL, UNIQUE | CPF sem pontuação |
| telefone | VARCHAR(20) | NOT NULL | Telefone de contato |
| criado_em | TIMESTAMP | padrão CURRENT_TIMESTAMP | Data/hora do cadastro |

## reservas

| Campo | Tipo | Regra | Descrição |
|---|---|---|---|
| id | BIGINT UNSIGNED | PK, auto incremento | Identificador da reserva |
| cliente_id | BIGINT UNSIGNED | FK, NOT NULL | Referência a `clientes.id` |
| data_reserva | DATE | NOT NULL | Data da reserva |
| quantidade_pessoas | TINYINT UNSIGNED | 1 a 30, NOT NULL | Número de pessoas |
| status | ENUM | Confirmada/Cancelada | Situação da reserva |
| criada_em | TIMESTAMP | padrão CURRENT_TIMESTAMP | Data/hora de criação |
| cancelada_em | TIMESTAMP | aceita NULL | Data/hora do cancelamento |

## notificacoes

| Campo | Tipo | Regra | Descrição |
|---|---|---|---|
| id | BIGINT UNSIGNED | PK, auto incremento | Identificador da notificação |
| reserva_id | BIGINT UNSIGNED | FK, aceita NULL | Reserva relacionada |
| cpf_cliente | CHAR(11) | NOT NULL | CPF associado à notificação |
| tipo | ENUM | RESERVA/CANCELAMENTO | Tipo da notificação |
| mensagem | VARCHAR(500) | NOT NULL | Conteúdo da mensagem |
| criada_em | TIMESTAMP | padrão CURRENT_TIMESTAMP | Data/hora de criação |

## funcionarios

| Campo | Tipo | Regra | Descrição |
|---|---|---|---|
| id | BIGINT UNSIGNED | PK, auto incremento | Identificador do funcionário |
| nome | VARCHAR(100) | NOT NULL | Nome para identificação |
| usuario | VARCHAR(30) | UNIQUE, NOT NULL | Nome de usuário de acesso |
| senha_hash | VARCHAR(200) | NOT NULL | Hash da senha; não armazena senha em texto puro |
| papel | ENUM | gerente/funcionario | Nível de permissão |
| ativo | BOOLEAN | padrão TRUE | Indica se a conta está ativa |
| criado_em | TIMESTAMP | padrão CURRENT_TIMESTAMP | Data/hora de criação |

## auditoria

| Campo | Tipo | Regra | Descrição |
|---|---|---|---|
| id | BIGINT UNSIGNED | PK, auto incremento | Identificador do evento |
| funcionario_id | BIGINT UNSIGNED | FK, aceita NULL | Funcionário associado |
| funcionario_nome | VARCHAR(100) | NOT NULL | Nome registrado no momento do evento |
| acao | VARCHAR(60) | NOT NULL | Ação realizada |
| entidade | VARCHAR(40) | NOT NULL | Tipo de registro afetado |
| entidade_id | BIGINT UNSIGNED | aceita NULL | Identificador do registro afetado |
| detalhes | JSON | aceita NULL | Detalhes resumidos do evento |
| ip | VARCHAR(45) | aceita NULL | Endereço IP registrado |
| user_agent | VARCHAR(255) | aceita NULL | Identificação resumida do navegador |
| criada_em | TIMESTAMP | padrão CURRENT_TIMESTAMP | Data/hora do evento |
