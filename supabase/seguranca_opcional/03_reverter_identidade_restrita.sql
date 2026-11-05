-- Retorna apenas a separação de identidade ao modelo anterior, se necessário.
-- Aumenta novamente os privilégios do dispositivo: usar somente como reversão consciente.
-- Preserva o cadastro privado e os dados; não apaga usuários, comandos ou configurações.
begin;
drop trigger if exists trg_aa_vcn_dispositivo_patch on public.comandos;
drop trigger if exists trg_aa_vcn_dispositivo_patch on public.configuracoes;
drop policy if exists vcn_device_comandos_select on public.comandos;
drop policy if exists vcn_device_comandos_update on public.comandos;
drop policy if exists vcn_device_config_select on public.configuracoes;
drop policy if exists vcn_device_config_update on public.configuracoes;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.usuarios u where u.id=auth.uid() and u.admin is true and u.aprovado is true);
$$;
create or replace function public.usuario_aprovado()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.usuarios u where u.id=auth.uid() and u.aprovado is true);
$$;
update public.usuarios u set admin=d.admin_anterior from private.vcn_devices d where u.id=d.usuario_id;
commit;
