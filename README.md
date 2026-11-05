# VCN Control — v21

Revisão local da interface e das regras de integração, preservando o protocolo do ESP32 e a identidade visual. As migrações de compatibilidade e identidade foram aplicadas em 05/11/2026. O firmware foi preservado. Comunicação real verificada por GETs autenticados do ESP32, sem emitir acionamentos.

## Melhorias implementadas

- Pedido com UUID próprio, acompanhamento do registro correto e confirmação/expiração explícitas.
- Bloqueio de novos pedidos enquanto houver um resultado incerto. Nenhum reenvio automático após falha de rede.
- Opção explícita de tentar o mesmo pedido, conservando o UUID, quando a consulta não encontra o registro.
- Restauração de pedido pendente após recarregar a página, sem transmitir novamente.
- Timeout de rede, renovação de sessão compartilhada e proteção contra respostas antigas após sair da conta.
- Falha de configuração bloqueia novos pedidos. Disponibilidade do servidor não é apresentada como presença atual do ESP32.
- Histórico distingue erro de consulta de lista vazia e mantém dados conhecidos.
- Validação de duração/prazo na interface; regras equivalentes propostas no banco.
- Arquivos de navegador com hash e cache isolado do aplicativo, sem apagar caches de outros projetos.

## Banco: migrações aplicadas

1. `supabase/migrations/20261105225837_compatibilidade_e_validacao_vcn.sql`: acrescenta `wifi_setup_ssid` esperado pelo firmware, valida configurações e faz o servidor definir os estados iniciais dos pedidos. Mantém a conta e os endpoints atuais.
2. `supabase/migrations/20261105225941_identidade_restrita_esp32.sql`: separa a identidade do equipamento da administração humana. Mantém os GET/PATCH do firmware, permite confirmar uma única vez e impede alterações em usuário/ação/pulso pelo equipamento. A comunicação do ESP32 continuou respondendo HTTP 200 depois da aplicação.
3. `supabase/seguranca_opcional/03_reverter_identidade_restrita.sql`: reversão da etapa de identidade, testada sem apagar dados. Ela restaura os privilégios anteriores e deve ser usada apenas se uma reversão for necessária.

Os scripts não limpam histórico nem alteram senhas. O cadastro do dispositivo usa a conta já identificada no sistema, exige correspondência única e falha com segurança se os pré-requisitos não forem encontrados. Não execute migrações antigas de novo no servidor existente.

## Verificação local

Requisitos: Node.js e, para o teste SQL, PostgreSQL local com `psql`, `initdb` e `pg_ctl`. Não há bibliotecas npm adicionais.

```sh
npm test
npm run test:sql
```

O teste SQL cria um banco temporário isolado com dados fictícios e o encerra ao terminar. Não usa o Supabase. Para usar uma pasta específica de testes, defina `VCN_TEST_WORK_DIR` para um diretório de trabalho local.

O comando `npm test` gera os arquivos finais antes dos testes. Também é possível gerar diretamente:

```sh
npm run build
```

Edite `assets/app.js` e `assets/control.js`; as cópias com hash são geradas pelo build. O HTML aponta para essas cópias para manter a versão do código coerente com o cache. A prévia deve ser servida por HTTP local, a partir desta pasta, sem incluir a pasta superior que contém o backup da memória do ESP32.

## Limites da validação

Passaram 26 testes de JavaScript/cache e 24 verificações em PostgreSQL descartável. A interface foi conferida no navegador local, com comunicação simulada e largura móvel de 390 px. O fonte `.ino` continua ausente; não foi regravado ou acionado o ESP32. Compatibilidade com os pedidos GET/PATCH foi validada no contrato do banco, não como ensaio físico do relé.

Não foi criado heartbeat de firmware. O texto da interface informa essa ausência. A segurança de senha/sessionStorage/localStorage mantém a arquitetura de site estático e a preferência existente de manter a conta conectada; não foi criado um servidor de cookies HTTP-only.

Foram preservados 1.440 comandos, 13 usuários e o cadastro de configuração. O teste de comunicação não enviou comandos Abrir/Fechar, reinício ou configuração de Wi-Fi. A posição física do portão e os pulsos do relé não foram testados nesta publicação. O pacote não contém backup de flash, senhas do equipamento ou chaves secretas.
