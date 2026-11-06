# VCN Control v23 — presença após resposta

A barra da v22 usava texto fixo e permanecia sem verificação mesmo depois de um pedido confirmado. Agora a confirmação recebida pelo fluxo do próprio usuário atualiza a barra para **Arduino: Online**, com ponto verde, por até 30 segundos a partir do horário da confirmação gravado pelo servidor.

Aceite HTTP, configuração do servidor, pedido pendente, registro antigo restaurado, data inválida ou identidade diferente não ativam Online. Consultas periódicas de configuração conservam a indicação enquanto válida. O sinal expira automaticamente e é apagado ao sair da conta.

Após o prazo, ou sem uma confirmação recente, a barra mostra **Arduino: sem sinal recente**. O firmware atual não envia presença em repouso; a ausência desse sinal não permite concluir Offline. Isso não impede acionar o portão quando o usuário tem acesso e as configurações permitem. A resposta também não confirma a posição física do portão.

O acompanhamento por UUID, as proteções, os prazos do comando e o pulso do relé continuam iguais. Não há nova consulta, migração, gravação do firmware ou comando automático para testar presença.

Os testes JavaScript cobrem a regressão da barra, validade, erros e troca de conta, além dos testes existentes de configuração, pedidos e cache. A prévia de navegador usa exclusivamente respostas simuladas, sem acessar a placa ou criar acionamentos no banco de produção.
