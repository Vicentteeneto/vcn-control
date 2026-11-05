-- Mesmas linhas, colunas, permissões e validade da fila; reaproveita o índice existente.
begin;
set local lock_timeout = '3s';
do $$ begin
  if not exists(select 1 from pg_attribute where attrelid='public.comandos'::regclass
    and attname='expirado' and attnotnull and not attisdropped) then
    raise exception 'expirado precisa continuar NOT NULL para preservar a semântica';
  end if;
end $$;
create or replace view public.comandos_pendentes_validos with (security_invoker=true) as
select id,acao,usuario_id,criado_em,expira_em,executado,executado_em,expirado,erro
from public.comandos
where executado=false and expirado=false
  and now()<=coalesce(expira_em,criado_em+interval '30 seconds');
commit;
