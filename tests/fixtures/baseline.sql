-- Contrato mínimo reproduzido do catálogo consultado; somente dados fictícios.

create role anon nologin;

create role authenticated nologin;
create role authenticator nologin;
create role service_role nologin;

create schema auth;

create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;

grant usage on schema auth,public to authenticated;

create table public.usuarios ("id" uuid not null,
"email" text not null,
"nome" text default ''::text,
"aprovado" boolean default false,
"admin" boolean default false,
"criado_em" timestamptz default now());

create table public.configuracoes ("id" text default 'portao_principal'::text not null,
"nome_dispositivo" text default 'Portão'::text not null,
"tempo_pulso_ms" integer default 400 not null,
"expira_comando_seg" integer default 30 not null,
"modo_manutencao" boolean default false not null,
"modo_config_wifi" boolean default false not null,
"atualizado_em" timestamptz default now() not null,
"atualizado_por" uuid);

create table public.comandos ("id" uuid default gen_random_uuid() not null,
"acao" text not null,
"usuario_id" uuid,
"executado" boolean default false,
"criado_em" timestamptz default now(),
"expira_em" timestamptz default (now() + '00:00:30'::interval),
"executado_em" timestamptz,
"expirado" boolean default false not null,
"erro" text);

alter table public.usuarios add primary key(id);

alter table public.configuracoes add primary key(id);

alter table public.comandos add primary key(id);

alter table public.comandos add constraint comandos_acao_check check(acao in ('abrir','fechar'));

alter table public.comandos add constraint comandos_usuario_id_fkey foreign key(usuario_id) references public.usuarios(id);

CREATE OR REPLACE FUNCTION public.definir_expiracao_comando()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare seg int;
begin
  select expira_comando_seg into seg from public.configuracoes where id = 'portao_principal';
  new.expira_em := now() + make_interval(secs => greatest(5, least(coalesce(seg, 30), 60)));
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.em_manutencao()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select modo_manutencao from public.configuracoes where id = 'portao_principal'), false);
$function$;


CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.admin = true
      and u.aprovado = true
  );
$function$;


CREATE OR REPLACE FUNCTION public.proteger_campos_privilegiados()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (new.aprovado is distinct from old.aprovado or new.admin is distinct from old.admin)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Apenas administradores podem alterar aprovação/permissões'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.usuario_aprovado()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.aprovado = true);
$function$;


CREATE OR REPLACE FUNCTION public.bloquear_execucao_expirada()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.executado = true
     and old.executado is distinct from true
     and now() > coalesce(old.expira_em, old.criado_em + interval '10 seconds') then

    new.executado = false;
    new.executado_em = null;
    new.expirado = true;
    new.erro = 'ESP32 tentou executar comando expirado';

    return new;
  end if;

  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.set_executado_em()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.executado = true and old.executado is distinct from true then
    new.executado_em = now();
    new.expirado = false;
    new.erro = null;
  end if;

  return new;
end;
$function$;


CREATE TRIGGER trg_bloquear_execucao_expirada BEFORE UPDATE ON public.comandos FOR EACH ROW EXECUTE FUNCTION bloquear_execucao_expirada();

CREATE TRIGGER trg_definir_expiracao_comando BEFORE INSERT ON public.comandos FOR EACH ROW EXECUTE FUNCTION definir_expiracao_comando();

CREATE TRIGGER trg_set_executado_em BEFORE UPDATE ON public.comandos FOR EACH ROW EXECUTE FUNCTION set_executado_em();

CREATE TRIGGER trg_proteger_campos_privilegiados BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION proteger_campos_privilegiados();

alter table public.usuarios enable row level security;

grant select,insert,update,delete on public.usuarios to authenticated;

alter table public.configuracoes enable row level security;

grant select,insert,update,delete on public.configuracoes to authenticated;

alter table public.comandos enable row level security;

grant select,insert,update,delete on public.comandos to authenticated;

create policy "comandos_admin_update" on public.comandos for UPDATE to authenticated using (is_admin()) with check (is_admin());

create policy "comandos_insert_aprovado" on public.comandos for INSERT to authenticated with check (((usuario_id = auth.uid()) AND (((acao = ANY (ARRAY['abrir'::text, 'fechar'::text])) AND usuario_aprovado() AND ((NOT em_manutencao()) OR is_admin())) OR ((acao = ANY (ARRAY['config_wifi'::text, 'reiniciar_esp32'::text])) AND is_admin()))));

create policy "comandos_select_own_or_admin" on public.comandos for SELECT to authenticated using (((usuario_id = auth.uid()) OR is_admin()));

create policy "configuracoes_admin_delete" on public.configuracoes for DELETE to authenticated using (is_admin());

create policy "configuracoes_admin_insert" on public.configuracoes for INSERT to authenticated with check (is_admin());

create policy "configuracoes_admin_select" on public.configuracoes for SELECT to authenticated using (is_admin());

create policy "configuracoes_admin_update" on public.configuracoes for UPDATE to authenticated using (is_admin()) with check (is_admin());

create policy "configuracoes_aprovado_select" on public.configuracoes for SELECT to authenticated using (usuario_aprovado());

create policy "admin acessa todos" on public.usuarios for ALL to authenticated using (is_admin()) with check (is_admin());

create policy "usuarios_admin_update" on public.usuarios for UPDATE to authenticated using (is_admin()) with check (is_admin());

create policy "usuarios_select_own_or_admin" on public.usuarios for SELECT to authenticated using (((id = auth.uid()) OR is_admin()));

create view public.comandos_pendentes_validos with(security_invoker=true) as  SELECT id,
    acao,
    usuario_id,
    criado_em,
    expira_em,
    executado,
    executado_em,
    expirado,
    erro
   FROM comandos
  WHERE executado = false AND COALESCE(expirado, false) = false AND now() <= COALESCE(expira_em, criado_em + '00:00:30'::interval);

grant select on public.comandos_pendentes_validos to authenticated;

insert into public.usuarios(id,email,nome,admin,aprovado) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin@example.test','Admin',true,true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','user@example.test','Usuario',false,true),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','waiting@example.test','Aguardando',false,false),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','esp32@vcn.local','Dispositivo',true,true);

insert into public.configuracoes(id,nome_dispositivo) values('portao_principal','Portão');

insert into public.comandos(id,acao,usuario_id) values('11111111-1111-4111-8111-111111111111','abrir','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),('22222222-2222-4222-8222-222222222222','fechar','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

update public.comandos set expira_em=now()-interval '5 minutes' where id='22222222-2222-4222-8222-222222222222';
