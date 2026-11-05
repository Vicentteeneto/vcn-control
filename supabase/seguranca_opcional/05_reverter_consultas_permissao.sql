begin;
set local lock_timeout='3s';
alter policy comandos_select_own_or_admin on public.comandos
  using (usuario_id=auth.uid() or public.is_admin());
alter policy usuarios_select_own_or_admin on public.usuarios
  using (id=auth.uid() or public.is_admin());
commit;
