# VCN Control v22

O aplicativo deixa de repetir a leitura do perfil na restauração da sessão e da configuração na abertura. Configurações simultâneas compartilham somente a requisição em andamento: cada verificação posterior continua lendo os valores atuais do servidor. Histórico não bloqueia a abertura e aguarda o término de um pedido para não competir com sua confirmação.

A primeira consulta da confirmação passa a ser imediata após o aceite HTTP, com intervalos posteriores de 250, 500 e 1000 ms conforme o tempo de espera. Requisições não se sobrepõem. Erros mantêm recuo de 5 s; nenhum acionamento é reenviado automaticamente e cada tentativa explícita conserva o UUID.

A barra não exibe mais mensagens de pedido enviado ou confirmado. O firmware instalado não publica presença verificável; por isso a barra mostra **Arduino: sem verificação**. Online/Offline real ainda depende do firmware enviar presença com validade. Conectividade do navegador ou do Supabase não é usada como prova de presença do ESP32. Falhas de pedido são avisos breves; bloqueios e recuperação de envios incertos continuam funcionando.

## Banco e compatibilidade

- `20261105232215_fila_esp32_indexada.sql` preserva as colunas, prazos e `security_invoker` da fila, substituindo uma expressão redundante sobre `expirado`, que já é NOT NULL. O índice parcial existente passa a ser utilizado.
- `20261105232436_consultas_permissao_otimizadas.sql` calcula identidade e papel uma vez por consulta. Não altera os critérios, os papéis, as ações ou as permissões da placa e das pessoas.
- Scripts de reversão estão em `supabase/seguranca_opcional/04_*` e `05_*`; não são migrações automáticas.
- Nenhuma linha do histórico, usuário ou configuração é alterada pelas migrações de desempenho.

## Validação e limites

Testes JavaScript cobrem concorrência, recuo, recuperação, ausência de reenvio, configuração atual, inicialização e mensagens. Testes PostgreSQL usam somente identidades e dados fictícios, incluindo acesso permitido/negado, confirmação única e reversões.

Em amostras EXPLAIN reais da fila vazia, autenticadas como a placa, o tempo de execução foi de 3,675 ms antes e 1,223 ms após os dois ajustes. São amostras de banco, não uma medição do movimento do portão. O plano mudou de varredura do histórico para o índice de pendências.

Uma simulação determinística, com respostas de rede de 180 ms e confirmação entre 200 e 2000 ms, reduziu a espera média adicional de detecção de 1260 para cerca de 211 ms. Isso mede o acompanhamento no aplicativo, sem comandos reais. A frequência de consulta do firmware e o pulso de 400 ms foram preservados.

Não houve gravação do firmware, reinicialização ou comando de abertura/fechamento em produção durante estes testes. O código-fonte .ino não foi localizado; o backup original da flash permanece preservado.

Referências para os ajustes: [índices parciais PostgreSQL](https://www.postgresql.org/docs/current/indexes-partial.html), [security_invoker em views](https://www.postgresql.org/docs/current/sql-createview.html) e [cálculo de identidade por consulta no Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).
