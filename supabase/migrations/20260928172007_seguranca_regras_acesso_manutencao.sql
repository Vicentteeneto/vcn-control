-- Registro da migração JÁ APLICADA no projeto Supabase "Portao" em 2026-09-28
-- (versão 20260928172007). Mantido aqui apenas para histórico/versionamento.
-- Não altera dados de usuários; só regras de acesso e gatilhos.

-- 1) CRÍTICO: remove policy FOR ALL que permitia ao usuário alterar o próprio
--    cadastro (aprovado/admin).
drop policy if exists "usuario acessa proprio perfil" on public.usuarios;

create or replace function public.proteger_campos_privilegiados()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.aprovado is distinct from old.aprovado or new.admin is distinct from old.admin)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Apenas administradores podem alterar aprovação/permissões'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proteger_campos_privilegiados on public.usuarios;
create trigger trg_proteger_campos_privilegiados
  before update on public.usuarios
  for each row execute function public.proteger_campos_privilegiados();

-- 2) Usuário aprovado pode LER a configuração (nome e manutenção).
create or replace function public.usuario_aprovado()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.aprovado = true);
$$;
drop policy if exists configuracoes_aprovado_select on public.configuracoes;
create policy configuracoes_aprovado_select on public.configuracoes
  for select to authenticated using (public.usuario_aprovado());

-- 3) Manutenção respeitada pelo banco para abrir/fechar de usuários comuns.
create or replace function public.em_manutencao()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select modo_manutencao from public.configuracoes where id = 'portao_principal'), false);
$$;
drop policy if exists comandos_insert_aprovado on public.comandos;
create policy comandos_insert_aprovado on public.comandos
  for insert to authenticated
  with check (
    usuario_id = auth.uid() and (
      (acao = any (array['abrir','fechar'])
        and public.usuario_aprovado()
        and (not public.em_manutencao() or public.is_admin()))
      or
      (acao = any (array['config_wifi','reiniciar_esp32']) and public.is_admin())
    )
  );

-- 4) Expiração do comando segue a configuração do painel (5–60 s).
create or replace function public.definir_expiracao_comando()
returns trigger language plpgsql security definer set search_path = public as $$
declare seg int;
begin
  select expira_comando_seg into seg from public.configuracoes where id = 'portao_principal';
  new.expira_em := now() + make_interval(secs => greatest(5, least(coalesce(seg, 30), 60)));
  return new;
end;
$$;
drop trigger if exists trg_definir_expiracao_comando on public.comandos;
create trigger trg_definir_expiracao_comando
  before insert on public.comandos
  for each row execute function public.definir_expiracao_comando();

-- 5) Tabela logs (não usada pelo app): remove inserção livre.
drop policy if exists "insere log" on public.logs;

revoke execute on function public.usuario_aprovado() from anon, public;
revoke execute on function public.em_manutencao() from anon, public;
grant execute on function public.usuario_aprovado() to authenticated;
grant execute on function public.em_manutencao() to authenticated;
revoke execute on function public.proteger_campos_privilegiados() from anon, authenticated, public;
revoke execute on function public.definir_expiracao_comando() from anon, authenticated, public;
