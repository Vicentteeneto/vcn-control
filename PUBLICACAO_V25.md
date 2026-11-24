# VCN Control v25 — Retorno imediato ao acionar

Ao tocar em **Abrir** ou **Fechar**, o botão tocado responde na hora: vibração curta (onde o aparelho permite), anel aceso pulsando e o texto "Enviando…" e, em seguida, "Aguardando portão…". Quando o ESP32 confirma a execução, o botão mostra **Acionado ✓** por 2 segundos, com vibração dupla, e volta ao normal. Falha ou expiração mantêm os avisos anteriores e não mostram "Acionado".

Antes, o único retorno em caso de sucesso era os botões ficarem apagados até a confirmação, o que dava a sensação de atraso mesmo com o app já acompanhando o pedido a cada 250 ms.

## O que não mudou

O fluxo do pedido, o UUID, as proteções contra duplicação, os prazos e o pulso do relé continuam iguais. Não houve migração, gravação do firmware ou comando real durante os testes.

## Onde está o tempo restante

O intervalo entre o toque e o movimento do portão (cerca de 1 a 3 s nas medições de setembro) é dominado pelo firmware do ESP32, que consulta a fila cerca de uma vez por segundo e confirma depois do pulso. Reduzir esse tempo exige atualizar o firmware (conexão HTTPS persistente com consultas mais frequentes, ou notificação em tempo real).

## Validação

47 testes JavaScript passaram, incluindo um novo para o retorno visual. No navegador, com respostas simuladas, o botão mudou de estado no próprio toque e mostrou "Acionado ✓" assim que a confirmação simulada chegou.
