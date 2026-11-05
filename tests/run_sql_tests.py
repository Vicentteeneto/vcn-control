"""Testes em PostgreSQL descartável, com identidades fictícias e sem acesso ao Supabase."""
from pathlib import Path
import os
import shutil
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PSQL = shutil.which('psql')
INITDB = shutil.which('initdb')
PGCTL = shutil.which('pg_ctl')
if not all([PSQL, INITDB, PGCTL]):
    raise SystemExit('PostgreSQL local necessário: psql, initdb e pg_ctl. Nenhuma dependência foi instalada.')

ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
WAITING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
DEVICE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
CMD = '11111111-1111-4111-8111-111111111111'
EXPIRED = '22222222-2222-4222-8222-222222222222'

def require(expression, message):
    return f"do $$ begin if not ({expression}) then raise exception '{message}'; end if; end $$;"

def denied(statement):
    return "do $$ begin begin " + statement + "; raise exception 'Operação indevida foi aceita'; exception when insufficient_privilege or check_violation then null; end; end $$;"

with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
work = os.environ.get('VCN_TEST_WORK_DIR')
if work:
    Path(work).mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='vcn-db-', dir=work) as directory:
    datadir = str(Path(directory) / 'data')
    log = str(Path(directory) / 'server.log')
    env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': str(port), 'PGDATABASE': 'postgres',
           'PGUSER': os.environ.get('USER', ''), 'PGCONNECT_TIMEOUT': '5'}
    started = False
    count = 0

    def sql(text):
        p = subprocess.run([PSQL, '-X', '-v', 'ON_ERROR_STOP=1', '-q'], input=text, text=True,
                           capture_output=True, env=env, timeout=30)
        if p.returncode:
            raise AssertionError(p.stderr.strip())
        return p.stdout

    def case(name, statements, user=None, role='authenticated'):
        global count
        auth = f"select set_config('request.jwt.claim.sub','{user}',true);" if user else ''
        sql('begin; ' + auth + f' set local role {role}; ' + statements + ' rollback;')
        count += 1
        print('OK SQL:', name, flush=True)

    try:
        subprocess.run([INITDB, '-D', datadir, '-A', 'trust', '--no-locale', '-E', 'UTF8'],
                       check=True, capture_output=True, timeout=40)
        subprocess.run([PGCTL, '-D', datadir, '-l', log, '-o', f'-h 127.0.0.1 -p {port} -k /tmp', '-w', 'start'],
                       check=True, capture_output=True, timeout=30)
        started = True
        sql((ROOT/'tests/fixtures/baseline.sql').read_text())
        migration = (ROOT/'supabase/migrations/20261105225837_compatibilidade_e_validacao_vcn.sql').read_text()
        sql(migration)
        sql(migration)  # reaplicação não apaga nem recria dados
        case('consulta do firmware encontra todos os campos', require(
            "(select count(*) from (select nome_dispositivo,tempo_pulso_ms,modo_manutencao,modo_config_wifi,wifi_setup_ssid from public.configuracoes) q)=1",
            'Configuração incompatível'), DEVICE)
        case('usuário aprovado continua criando pedidos com UUID próprio',
             "insert into public.comandos(id,acao,usuario_id) values('33333333-3333-4333-8333-333333333333','abrir','"+USER+"');" +
             require("(select count(*) from public.comandos where id='33333333-3333-4333-8333-333333333333')=1",'Pedido perdido'), USER)
        case('cliente não forja confirmação ou data de criação',
             "insert into public.comandos(id,acao,usuario_id,executado,executado_em,criado_em,expirado,erro) values('33333333-3333-4333-8333-333333333333','abrir','"+USER+"',true,now(),now()-interval '1 day',true,'falso');"+
             require("(select not executado and executado_em is null and not expirado and erro is null and criado_em > now()-interval '1 minute' from public.comandos where id='33333333-3333-4333-8333-333333333333')",'Estado inicial forjado'), USER)
        case('cadastro não aprovado continua sem permissão de acionar',
             denied("insert into public.comandos(acao,usuario_id) values('abrir','"+WAITING+"')"), WAITING)
        case('usuário comum não altera duração do pulso',
             "update public.configuracoes set tempo_pulso_ms=500;"+require("(select tempo_pulso_ms from public.configuracoes where id='portao_principal')=400",'Alteração indevida'), USER)
        case('servidor rejeita duração insegura', denied("update public.configuracoes set tempo_pulso_ms=1"), ADMIN)
        case('servidor rejeita SSID fora do limite', denied("update public.configuracoes set wifi_setup_ssid=repeat('a',33)"), ADMIN)
        case('view não entrega pedidos vencidos', require("(select count(*) from public.comandos_pendentes_validos where id='"+EXPIRED+"')=0",'Pedido vencido exposto'), DEVICE)

        hardening=(ROOT/'supabase/migrations/20261105225941_identidade_restrita_esp32.sql').read_text()
        sql(hardening)
        sql(hardening)
        case('equipamento deixa de ser administrador',require('not public.is_admin()','Equipamento ainda administrador'),DEVICE)
        case('equipamento continua lendo a configuração exigida pelo firmware',require(
            "(select wifi_setup_ssid from public.configuracoes where id='portao_principal')='VCN-Control-Setup'",'Leitura de configuração quebrada'),DEVICE)
        case('equipamento continua buscando comandos pela mesma view',require(
            "(select count(*) from public.comandos_pendentes_validos where id='"+CMD+"')=1",'Fila do firmware quebrada'),DEVICE)
        case('PATCH legado confirma uma vez e horário é do servidor',
            "update public.comandos set executado=true where id='"+CMD+"';"+require(
            "(select executado and executado_em is not null from public.comandos where id='"+CMD+"')",'Confirmação quebrada')+
            "do $$ declare n int; begin update public.comandos set executado=true where id='"+CMD+"'; get diagnostics n=row_count; if n<>0 then raise exception 'Repetição autorizada'; end if; end $$;",DEVICE)
        case('equipamento não confirma pedido vencido',
            "update public.comandos set executado=true where id='"+EXPIRED+"';"+require(
            "(select count(*) from public.comandos_pendentes_validos where id='"+EXPIRED+"')=0",'Pedido vencido confirmado'),DEVICE)
        case('equipamento não troca ação ou autor do comando',
            denied("update public.comandos set executado=true,acao='fechar' where id='"+CMD+"'"),DEVICE)
        case('equipamento não define horário falso de confirmação',
            denied("update public.comandos set executado=true,executado_em=now() where id='"+CMD+"'"),DEVICE)
        case('equipamento não insere novos acionamentos',
            denied("insert into public.comandos(acao,usuario_id) values('abrir','"+DEVICE+"')"),DEVICE)
        case('equipamento não administra outros usuários',
            "update public.usuarios set admin=true where id='"+USER+"';"+require(
            "(select count(*) from public.usuarios where id='"+USER+"')=0",'Usuários expostos'),DEVICE)
        case('equipamento não altera configurações do pulso',
            denied("update public.configuracoes set modo_config_wifi=false,tempo_pulso_ms=500 where id='portao_principal'"),DEVICE)
        sql("update public.configuracoes set modo_config_wifi=true where id='portao_principal';")
        case('PATCH legado pode limpar somente o sinal de modo Wi-Fi',
            "update public.configuracoes set modo_config_wifi=false where id='portao_principal';"+require(
            "(select not modo_config_wifi from public.configuracoes where id='portao_principal')",'Confirmação Wi-Fi quebrada'),DEVICE)
        case('admin humano mantém controle e aprovação',
            require('public.is_admin()','Administrador humano bloqueado')+
            "update public.configuracoes set tempo_pulso_ms=500; update public.usuarios set aprovado=true where id='"+WAITING+"';"+
            require("(select tempo_pulso_ms from public.configuracoes)=500",'Admin bloqueado'),ADMIN)
        case('usuário aprovado continua acionando depois da separação da conta',
             "insert into public.comandos(acao,usuario_id) values('fechar','"+USER+"');",USER)
        case('visitante anônimo não lê configuração nem comandos',
             denied('select * from public.configuracoes')+denied('select * from public.comandos'),role='anon')
        sql('update private.vcn_devices set ativo=false;')
        case('equipamento desativado não volta a herdar administração',require('not public.is_admin()','Dispositivo inativo herdou admin')+
             require('(select count(*) from public.configuracoes)=0','Dispositivo inativo leu configuração'),DEVICE)
        sql((ROOT/'supabase/seguranca_opcional/03_reverter_identidade_restrita.sql').read_text())
        case('reversão restaura o perfil anterior sem apagar dados',require('public.is_admin()','Perfil anterior não restaurado')+
             require('(select count(*) from public.comandos)=2','Dados de comandos alterados na reversão'),DEVICE)
        print(f'TOTAL SQL: {count} verificações passaram. Banco descartável encerrado.',flush=True)
    finally:
        if started:
            subprocess.run([PGCTL, '-D', datadir, '-m', 'fast', '-w', 'stop'],capture_output=True,timeout=30,check=True)
