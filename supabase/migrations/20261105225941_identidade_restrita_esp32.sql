-- Etapa separada: revisar/aplicar somente depois da migração de compatibilidade.
-- Não altera senha, firmware, endpoints, usuários humanos ou dados históricos.
-- O cadastro de dispositivo é intencionalmente privado e não editável pelo app.
begin;
create schema if not exists private;
create table if not exists private.vcn_devices (
  usuario_id uuid primary key references public.usuarios(id) on delete restrict,
  configuracao_id text not null references public.configuracoes(id) on delete restrict,
  ativo boolean not null default true,
  admin_anterior boolean,
  criado_em timestamptz not null default now()
);
revoke all on private.vcn_devices from public, anon, authenticated;
grant usage on schema private to authenticated;

do $$
begin
  if (select count(*) from public.usuarios where lower(email)='esp32@vcn.local') <> 1 then
    raise exception 'É necessário identificar exatamente uma conta do ESP32 antes de aplicar';
  end if;
  if not exists (select 1 from public.configuracoes where id='portao_principal') then
    raise exception 'Configuração portao_principal não encontrada';
  end if;
end;
$$;
insert into private.vcn_devices(usuario_id, configuracao_id, admin_anterior)
select id, 'portao_principal', admin from public.usuarios where lower(email)='esp32@vcn.local'
on conflict (usuario_id) do nothing;

create or replace function private.vcn_device_registrado()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.vcn_devices d where d.usuario_id=auth.uid());
$$;
create or replace function private.vcn_device_config()
returns text language sql stable security definer set search_path = '' as $$
  select d.configuracao_id from private.vcn_devices d join public.usuarios u on u.id=d.usuario_id
  where d.usuario_id=auth.uid() and d.ativo and u.aprovado is true;
$$;
revoke execute on function private.vcn_device_registrado() from public, anon;
revoke execute on function private.vcn_device_config() from public, anon;
grant execute on function private.vcn_device_registrado() to authenticated;
grant execute on function private.vcn_device_config() to authenticated;

-- A conta do equipamento nunca herda a administração, inclusive se estiver inativa.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.usuarios u where u.id=auth.uid() and u.admin is true and u.aprovado is true)
    and not private.vcn_device_registrado();
$$;
create or replace function public.usuario_aprovado()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.usuarios u where u.id=auth.uid() and u.aprovado is true)
    and not private.vcn_device_registrado();
$$;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.usuario_aprovado() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.usuario_aprovado() to authenticated;

update public.usuarios set admin=false where id in (select usuario_id from private.vcn_devices);

drop policy if exists vcn_device_config_select on public.configuracoes;
create policy vcn_device_config_select on public.configuracoes for select to authenticated
using (id=(select private.vcn_device_config()));
drop policy if exists vcn_device_config_update on public.configuracoes;
create policy vcn_device_config_update on public.configuracoes for update to authenticated
using (id=(select private.vcn_device_config()))
with check (id=(select private.vcn_device_config()) and modo_config_wifi=false);

drop policy if exists vcn_device_comandos_select on public.comandos;
create policy vcn_device_comandos_select on public.comandos for select to authenticated
using ((select private.vcn_device_config()) is not null and acao in ('abrir','fechar')
  and coalesce(expira_em,criado_em+interval '30 seconds') > now()-interval '1 minute');
drop policy if exists vcn_device_comandos_update on public.comandos;
create policy vcn_device_comandos_update on public.comandos for update to authenticated
using ((select private.vcn_device_config()) is not null and executado=false and expirado=false
  and acao in ('abrir','fechar') and coalesce(expira_em,criado_em+interval '30 seconds') >= now())
with check ((select private.vcn_device_config()) is not null and executado=true and expirado=false and acao in ('abrir','fechar'));

create or replace function public.vcn_restringir_patch_dispositivo()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not private.vcn_device_registrado() then return new; end if;
  if private.vcn_device_config() is null then raise exception 'Dispositivo sem acesso' using errcode='42501'; end if;
  if tg_table_name='comandos' then
    if old.executado is distinct from false or new.executado is distinct from true or
       old.expirado or coalesce(old.expira_em,old.criado_em+interval '30 seconds') < now() or
       (to_jsonb(new)-array['executado','executado_em','expirado','erro']) is distinct from
       (to_jsonb(old)-array['executado','executado_em','expirado','erro']) or
       new.executado_em is distinct from old.executado_em or
       new.expirado is distinct from old.expirado or new.erro is distinct from old.erro then
      raise exception 'Transição de comando não autorizada para o dispositivo' using errcode='42501';
    end if;
  elsif tg_table_name='configuracoes' then
    if new.modo_config_wifi is distinct from false or
       (to_jsonb(new)-'modo_config_wifi') is distinct from (to_jsonb(old)-'modo_config_wifi') then
      raise exception 'O dispositivo só pode confirmar a saída do modo Wi-Fi' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.vcn_restringir_patch_dispositivo() from public, anon, authenticated;
drop trigger if exists trg_aa_vcn_dispositivo_patch on public.comandos;
create trigger trg_aa_vcn_dispositivo_patch before update on public.comandos
for each row execute function public.vcn_restringir_patch_dispositivo();
drop trigger if exists trg_aa_vcn_dispositivo_patch on public.configuracoes;
create trigger trg_aa_vcn_dispositivo_patch before update on public.configuracoes
for each row execute function public.vcn_restringir_patch_dispositivo();
commit;

