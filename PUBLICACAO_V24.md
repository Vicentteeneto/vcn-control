# VCN Control v24 — Online/Offline contínuo

A presença deixa de depender de um acionamento ou de uma contagem de 30 segundos. O servidor observa as consultas autenticadas que o ESP32 já faz continuamente. Enquanto elas chegam, o aplicativo permanece **Arduino: Online**. Quando param, passa a **Arduino: Offline**, normalmente em cerca de 5–7 segundos. A volta da comunicação atualiza Online automaticamente.

O estado representa a comunicação com o serviço do VCN. O simples fato de o cabo USB estar conectado não comprova que a placa está comunicando. Falha de internet do navegador ou impossibilidade de verificar o servidor também resulta em Offline; o motivo fica no texto de ajuda do indicador.

## Compatibilidade e segurança

Foi instalada uma função pre-request do PostgREST. Somente a identidade registrada e ativa do dispositivo, ainda aprovada, renova um marcador efêmero de presença. Pessoas, visitantes e consultas do próprio indicador não renovam esse marcador.

As consultas GET do firmware são READ ONLY. Por isso o marcador usa um advisory lock compartilhado em memória, com chave derivada da identidade e segundo do servidor. A função usa aquisição sem espera, conserva no máximo um marcador por dispositivo/conexão e libera o marcador anterior ao renovar. Uma segunda consulta no mesmo segundo não acumula aquisições. O marcador não é utilizado para bloquear tabelas, comandos ou outras operações.

A leitura considera somente marcadores do banco atual e dispositivos ativos/aprovados associados ao portão principal. A API devolve apenas o estado e a idade do sinal, para usuários aprovados. O código que acessa os metadados é privado; as funções públicas usam SECURITY INVOKER. Nenhuma conta ganha acesso ao histórico ou às tabelas privadas.

A instalação verifica que não há pre-request anterior a substituir. A configuração original foi salva no backup e há reversão em `supabase/seguranca_opcional/06_reverter_presenca.sql`. Este mecanismo depende da continuidade das consultas do firmware e das conexões PostgREST com o mesmo banco. Se o backend reiniciar, a próxima consulta real da placa restabelece a presença.

Não houve nova gravação do ESP32, alteração do pulso, criação de comandos, reinicialização, alteração de Wi-Fi ou gravação em linhas do histórico. As políticas anteriores de dados não foram alteradas. A instalação usa o firmware já existente.

## Aplicativo

O aplicativo consulta o estado a cada 2 segundos enquanto visível e com rede, sem sobrepor requisições. Em falhas, usa recuo de 5 segundos. O prazo do sinal é calculado com relógio monotônico, descontando idade e tempo da consulta: uma resposta atrasada não mantém Online indefinidamente. Sair ou trocar de conta cancela o monitor e descarta respostas antigas. Comandos continuam com as proteções e prazos anteriores.

O prazo de aproximadamente 5 segundos é usado para detectar a perda da comunicação e é renovado continuamente pelas consultas da placa. Ele não limita a duração do estado Online enquanto a placa permanece comunicando.

## Validação

Passaram 46 testes JavaScript e 36 verificações PostgreSQL locais. Incluem presença em transação READ ONLY, impossibilidade de usuários simularem a presença, validade, não acumulação de marcadores, reversão, ausência de reenvio, expiração local mesmo com rede pendente e Online contínuo por minutos sem nenhum comando.

O servidor real mostrou Online com sinal renovado em observações separadas por mais de 30 segundos, a partir de consultas reais da placa. A interface local passou por Online → Offline → Online usando respostas simuladas, sem nenhum acionamento. O teste físico de retirar/recolocar o cabo depende da participação do usuário e não é afirmado como realizado sem essa confirmação.

Referências dos recursos utilizados: [pre-request PostgREST](https://docs.postgrest.org/en/stable/references/transactions.html#pre-request), [transações de leitura](https://docs.postgrest.org/en/stable/references/transactions.html#access-mode) e [advisory locks PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS). O uso desses recursos como marcador efêmero é uma implementação específica do VCN.
