-- Compatibilidade com firmware que consulta continuamente por GET (transação READ ONLY).
-- Marcador efêmero em memória: um advisory lock compartilhado por dispositivo/conexão.
-- Não bloqueia comandos, não grava linhas, não muda application_name e não exige firmware novo.
begin;
set local lock_timeout='3s';
do $$ begin
  if exists(select 1 from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,
    lateral unnest(s.setconfig) cfg where r.rolname='authenticator'
    and cfg like 'pgrst.db_pre_request=%'
    and cfg not in ('pgrst.db_pre_request=','pgrst.db_pre_request=public.vcn_request_presence')) then
    raise exception 'Já existe um pre-request: preservar e integrar antes de instalar presença';
  end if;
end $$;

create or replace function private.vcn_presence_key(device uuid)
returns integer language sql immutable strict set search_path='' as $$
  select ('x'||substr(md5('vcn.presenca.v1:'||device::text),1,8))::bit(32)::integer;
$$;
revoke all on function private.vcn_presence_key(uuid) from public,anon,authenticated;

create or replace function private.vcn_touch_device_presence()
returns void language plpgsql volatile security definer set search_path='' as $$
declare device uuid; k integer; stamp bigint; stamp_i integer; previous record;
begin
  select d.usuario_id into device from private.vcn_devices d join public.usuarios u on u.id=d.usuario_id
    where d.usuario_id=auth.uid() and d.ativo and u.aprovado is true;
  if device is null then return; end if;
  k:=private.vcn_presence_key(device);
  stamp:=floor(extract(epoch from clock_timestamp()))::bigint % 4294967296;
  stamp_i:=(case when stamp>2147483647 then stamp-4294967296 else stamp end)::integer;
  -- Não acumula aquisições recursivas quando duas consultas caem no mesmo segundo.
  if exists(select 1 from pg_catalog.pg_locks l where l.locktype='advisory'
    and l.pid=pg_backend_pid() and l.objsubid=2 and l.mode='ShareLock' and l.granted
    and l.classid::bigint=(k::bigint & 4294967295) and l.objid::bigint=stamp) then return; end if;
  -- Nunca espera um lock; adquirir o novo antes de soltar o anterior evita lacuna de presença.
  if not pg_try_advisory_lock_shared(k,stamp_i) then return; end if;
  for previous in select l.objid::bigint as stamp from pg_catalog.pg_locks l
    where l.locktype='advisory' and l.pid=pg_backend_pid() and l.objsubid=2
    and l.mode='ShareLock' and l.granted and l.classid::bigint=(k::bigint & 4294967295)
    and l.objid::bigint<>stamp
  loop
    perform pg_advisory_unlock_shared(k,
      (case when previous.stamp>2147483647 then previous.stamp-4294967296 else previous.stamp end)::integer);
  end loop;
exception when others then
  -- Telemetria não pode impedir um pedido já permitido pelas políticas originais.
  return;
end $$;
revoke all on function private.vcn_touch_device_presence() from public,anon;
grant execute on function private.vcn_touch_device_presence() to authenticated;

create or replace function public.vcn_request_presence()
returns void language plpgsql volatile security invoker set search_path='' as $$
begin
  if current_user='authenticated' then perform private.vcn_touch_device_presence(); end if;
end $$;
revoke all on function public.vcn_request_presence() from public;
grant execute on function public.vcn_request_presence() to anon,authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.vcn_request_presence() to service_role;
  end if;
end $$;

create or replace function private.vcn_read_device_presence()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare clock_ms bigint; age_ms bigint;
begin
  if not (public.usuario_aprovado() or public.is_admin()) then
    raise exception 'Acesso não aprovado' using errcode='42501';
  end if;
  clock_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  select min((clock_ms-l.objid::bigint*1000+4294967296000)%4294967296000) into age_ms
  from pg_catalog.pg_locks l join private.vcn_devices d
    on l.classid::bigint=(private.vcn_presence_key(d.usuario_id)::bigint & 4294967295)
  join public.usuarios u on u.id=d.usuario_id
  where l.locktype='advisory' and l.objsubid=2 and l.mode='ShareLock' and l.granted
    and l.database=(select oid from pg_catalog.pg_database where datname=current_database())
    and d.ativo and u.aprovado is true and d.configuracao_id='portao_principal';
  return jsonb_build_object('online',age_ms is not null and age_ms<5000,
    'age_ms',age_ms,'valid_for_ms',5000);
end $$;
revoke all on function private.vcn_read_device_presence() from public,anon;
grant execute on function private.vcn_read_device_presence() to authenticated;
create or replace function public.vcn_device_status()
returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.vcn_read_device_presence();
$$;
revoke all on function public.vcn_device_status() from public,anon;
grant execute on function public.vcn_device_status() to authenticated;

alter role authenticator set pgrst.db_pre_request='public.vcn_request_presence';
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
