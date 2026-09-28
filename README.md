# VCN Control

Aplicativo PWA da **VCN Systems** para controle de acesso ao portão (ESP32 + Supabase).

## Acesso

https://vicentteeneto.github.io/vcn-control/

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | App completo (HTML, CSS com design tokens e JS) |
| `service-worker.js` | Cache offline — **aumente `CACHE_NAME` a cada publicação** |
| `manifest.json` | Instalação como app (ícones `any` e `maskable`) |
| `assets/vcn-logo.svg` | Logotipo oficial em vetor |
| `assets/favicon.svg`, `assets/icon-*.png`, `assets/apple-touch-icon.png` | Ícones |
| `assets/fonts/` | Space Grotesk e Inter auto-hospedadas (SIL OFL 1.1) |

## Identidade visual (VCN Brand System)

Tokens definidos em `:root` no `index.html`:

- **Principais:** Midnight `#061426` · Electric Blue `#0866FF` · Azure `#10A8FF` · Cyan `#18E1DF`
- **Neutras:** Graphite `#111722` · Slate `#667085` · Mist `#D9E2EC` · Cloud `#F5F7FA`
- **Destaques:** Signal Orange `#FF8A35` · Digital Violet `#6D5CFF`
- **Gradiente oficial:** `#18E1DF → #10A8FF → #0866FF → #173ED5`
- **Tipografia:** Space Grotesk (títulos) · Inter (textos)

## Segurança e privacidade

- Nenhuma senha é salva no aparelho; "manter conectado" guarda só o `refresh_token`.
- Token renovado automaticamente antes de expirar.
- Content-Security-Policy restringe conexões ao próprio site e ao Supabase.
- Fontes locais: nenhuma requisição a terceiros (LGPD).
- Diagnóstico técnico da tela "aguardando" só com `?debug=1`.

## Status

Projeto pessoal em desenvolvimento.
