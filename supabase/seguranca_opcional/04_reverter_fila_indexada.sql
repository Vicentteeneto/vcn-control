begin;
set local lock_timeout = '3s';
create or replace view public.comandos_pendentes_validos with (security_invoker=true) as
select id,acao,usuario_id,criado_em,expira_em,executado,executado_em,expirado,erro
from public.comandos
where executado=false and coalesce(expirado,false)=false
  and now()<=coalesce(expira_em,criado_em+interval '30 seconds');
commit;
