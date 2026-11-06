-- Reverte a instalação feita quando não havia pre-request anterior.
begin;
alter role authenticator reset pgrst.db_pre_request;
drop function if exists public.vcn_request_presence();
drop function if exists public.vcn_device_status();
drop function if exists private.vcn_read_device_presence();
drop function if exists private.vcn_touch_device_presence();
drop function if exists private.vcn_presence_key(uuid);
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
-- Marcadores em memória são ignorados após 5 s e liberados com o encerramento da conexão.
