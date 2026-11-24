# VCN Control v26 — Dispositivo protegido no painel e topo no iPhone

## Dispositivos
A conta do ESP32 (`esp32@vcn.local`) deixa de aparecer em "Usuários ativos" com o botão **Revogar**. Ela passa a ter uma seção própria, **Dispositivos**, com o selo DISPOSITIVO e nenhuma ação de revogar: revogá-la desligaria o portão, porque o acesso do dispositivo exige a conta aprovada. Se a conta aparecer desativada, o cartão destaca o problema em laranja e oferece **Reativar**.

A identificação usa o mesmo e-mail que a migração `20261105225941_identidade_restrita_esp32.sql` usa para registrar o dispositivo. É uma proteção da interface contra toque acidental; as permissões do banco não mudaram.

## Topo no iPhone
Com a barra de status translúcida, o conteúdo rolado passava por baixo do relógio e da bateria. Uma faixa fixa na cor do fundo, com a altura da área segura (`env(safe-area-inset-top)`), passa a cobrir essa região.

## Validação
48 testes JavaScript passaram, incluindo um novo garantindo que a conta do dispositivo nunca recebe "Revogar" e recebe "Reativar" quando desativada. A tela do painel foi conferida no navegador com dados simulados. A faixa da área segura depende do iPhone e deve ser conferida no aparelho.
