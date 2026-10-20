# Reino do Dragão — Sistema integrado de reservas

## Requisitos
- Node.js 18 ou superior
- MySQL 8 ou compatível

## Instalação
1. Abra o MySQL Workbench e execute `database.sql`.
2. Edite `.env`: informe a senha do MySQL, defina um usuário e uma senha exclusivos para funcionários e configure `SESSION_SECRET` com uma chave aleatória de pelo menos 32 caracteres.
3. No terminal do VS Code, dentro desta pasta, execute `npm install`.
4. Execute `npm run check` para verificar a sintaxe dos scripts.
5. Inicie o sistema com `npm start`.
6. Abra `http://localhost:3000` para a página do cliente.
7. Acesse `http://localhost:3000/login-funcionarios` para o painel.
8. Acesse `http://localhost:3000/api/health` para conferir se o banco está conectado.

## Regras de negócio
- Uma reserva ativa por CPF.
- Máximo de 30 pessoas por reserva.
- Capacidade máxima de 48 pessoas por data.
- Cancelamento permitido a qualquer momento.
- Ao cancelar, a capacidade é liberada e uma notificação é registrada.
- Reservas e notificações são armazenadas no MySQL.

## Proteções adicionadas
- Painel e consultas administrativas exigem sessão de funcionário.
- Senha e segredo devem ser configurados no `.env`; o servidor recusa login se forem deixados os valores de exemplo.
- Limite de 8 tentativas de login por IP em uma janela de 15 minutos.
- Cookie de sessão `HttpOnly` e `SameSite=Strict`; em `NODE_ENV=production`, também usa `Secure` (exige HTTPS).
- Cabeçalhos básicos de segurança e CORS amplo removido, pois as páginas são servidas pelo próprio Express.
- Locks nomeados no MySQL ajudam a impedir reservas concorrentes que ultrapassem o limite diário ou dupliquem reservas ativas do mesmo CPF.

## Rotas principais
- `GET /api/health`
- `POST /api/reservas`
- `GET /api/reservas/cliente/:cpf`
- `DELETE /api/reservas/:id` com JSON `{ "cpf": "12345678901" }`
- `POST /api/funcionarios/login` e `POST /api/funcionarios/logout`
- `GET /api/reservas` (somente funcionário autenticado)
- `GET /api/notificacoes` (somente funcionário autenticado)
- `GET /api/relatorios/resumo?inicio=AAAA-MM-DD&fim=AAAA-MM-DD` (somente funcionário autenticado; resumo e totais por data)
- `GET /api/notificacoes?cpf=12345678901` (consulta do cliente)

## Roteiro de testes manuais
1. Faça uma reserva com CPF válido e 1 pessoa; confira se ela aparece no painel.
2. Tente fazer outra reserva ativa com o mesmo CPF: deve ser recusada.
3. Tente reservar 31 pessoas: deve ser recusada.
4. Faça reservas que somem 48 pessoas para uma data; uma nova pessoa nessa data deve ser recusada.
5. Cancele uma reserva e confirme que a capacidade é liberada e a notificação aparece.
6. Use o mesmo CPF para fazer outra reserva depois do cancelamento.
7. Abra `/painel-funcionarios` sem login: deve redirecionar para a tela de login.
8. Faça várias tentativas de senha incorreta: após 8 tentativas, deve aplicar bloqueio temporário.

## Limitações
`npm run check` verifica sintaxe; não executa operações no banco. O teste real exige MySQL instalado e configurado. Este projeto foi feito para desenvolvimento local e demonstração escolar. Antes de publicar na internet, revise a autenticação, adote HTTPS, gestão de sessão apropriada, backups e testes de segurança.


## Testes automatizados

Antes de iniciar o servidor, você pode executar os testes das validações básicas:

```bash
npm test
npm run check
```

Os testes verificam a validação do CPF, datas reais e a formatação da data retornada pelo MySQL. Eles não substituem o teste de integração com o MySQL ligado.


## Relatório administrativo

No painel dos funcionários, a seção **Relatório administrativo** permite escolher uma data inicial e final. O relatório mostra reservas confirmadas, pessoas previstas, reservas canceladas e vagas restantes por dia. Use **Exportar CSV** para abrir os dados em programas de planilha. O relatório inclui apenas datas em que há registros; dias sem reservas não aparecem na tabela.
