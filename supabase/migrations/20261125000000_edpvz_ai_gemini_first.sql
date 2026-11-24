alter table public.edpvz_ai_settings
  alter column primary_provider set default 'gemini';
update public.edpvz_ai_settings set primary_provider = 'gemini' where id;
alter table public.edpvz_ai_settings
  add constraint edpvz_ai_gemini_first check(primary_provider='gemini');
alter table public.edpvz_ai_cooldowns add column quota_model text;
