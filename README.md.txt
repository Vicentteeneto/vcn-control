VCN CONTROL - ATUALIZAÇÃO ADMIN

Arquivos para subir no GitHub:
- index.html
- service-worker.js
- manifest.json
- assets/icon-192.png
- assets/icon-512.png

Depois rode no Supabase:
- supabase_admin_configuracoes.sql

O que foi adicionado:
- Aba Admin > Usuários
- Aba Admin > Configurações
- Configuração de nome do dispositivo
- Configuração de tempo de pulso
- Configuração de expiração do comando
- Modo manutenção
- Botão para solicitar modo configuração Wi-Fi
- Botão para solicitar reinício do ESP32

Observação:
Os botões de Wi-Fi/reinício dependem do firmware do ESP32 reconhecer as ações:
- config_wifi
- reiniciar_esp32
