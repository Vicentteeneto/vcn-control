-- Registro da migração JÁ APLICADA no projeto Supabase "Portao" em 2026-09-29.
-- Visitantes sem login não precisam (nem devem) ver comandos pendentes.
-- O ESP32 lê autenticado com conta admin (coberto por comandos_select_own_or_admin).
drop policy if exists "leitura comandos pendentes" on public.comandos;
