-- As funções STABLE dependem somente da sessão, sem argumentos da linha.
-- As mesmas permissões são calculadas uma vez por consulta em vez de por registro.
begin;
set local lock_timeout='3s';
alter policy comandos_select_own_or_admin on public.comandos
  using (usuario_id=(select auth.uid()) or (select public.is_admin()));
alter policy usuarios_select_own_or_admin on public.usuarios
  using (id=(select auth.uid()) or (select public.is_admin()));
commit;
