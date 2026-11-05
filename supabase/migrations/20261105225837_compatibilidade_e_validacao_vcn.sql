-- Preparada e testada localmente. Não aplicada ao projeto de produção.
-- Mantém os endpoints, a conta e o protocolo do firmware extraído.
begin;

-- Cancelamento da solicitação Wi-Fi obsoleta identificada e preservada no backup.
do $wifi_guard$ begin
  if exists(select 1 from public.configuracoes where id='portao_principal' and modo_config_wifi=true and atualizado_em is distinct from '2026-06-30T23:47:32.099+00:00'::timestamptz) then
    raise exception 'Solicitação Wi-Fi mudou após o backup; rever antes de prosseguir';
  end if;
end $wifi_guard$;
update public.configuracoes set modo_config_wifi=false,atualizado_em=now(),atualizado_por=null
where id='portao_principal' and modo_config_wifi=true and atualizado_em='2026-06-30T23:47:32.099+00:00'::timestamptz;


alter table public.configuracoes
  add column if not exists wifi_setup_ssid text not null default 'VCN-Control-Setup';

do $$
begin
  if exists (select 1 from public.configuracoes where
      tempo_pulso_ms not between 100 and 2000 or
      expira_comando_seg not between 5 and 60 or
      char_length(nome_dispositivo) not between 1 and 40 or
      wifi_setup_ssid is null or octet_length(wifi_setup_ssid) not between 1 and 32) then
    raise exception 'Configurações fora dos limites: revise os valores antes da migração';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.configuracoes'::regclass and conname='vcn_config_limites') then
    alter table public.configuracoes add constraint vcn_config_limites check (
      tempo_pulso_ms between 100 and 2000 and expira_comando_seg between 5 and 60 and
      char_length(nome_dispositivo) between 1 and 40 and
      wifi_setup_ssid is not null and octet_length(wifi_setup_ssid) between 1 and 32);
  end if;
end;
$$;

-- Os estados iniciais e o horário de criação pertencem ao servidor.
-- Preserva o UUID enviado pelo cliente para impedir duplicação após um timeout.
create or replace function public.vcn_normalizar_novo_comando()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.criado_em := now();
  new.executado := false;
  new.executado_em := null;
  new.expirado := false;
  new.erro := null;
  return new;
end;
$$;
revoke execute on function public.vcn_normalizar_novo_comando() from public, anon, authenticated;
drop trigger if exists trg_vcn_normalizar_novo_comando on public.comandos;
create trigger trg_vcn_normalizar_novo_comando before insert on public.comandos
for each row execute function public.vcn_normalizar_novo_comando();

create index if not exists comandos_usuario_criado_idx on public.comandos (usuario_id, criado_em desc);
create index if not exists comandos_pendentes_criado_idx on public.comandos (criado_em)
  where executado = false and expirado = false;

commit;

