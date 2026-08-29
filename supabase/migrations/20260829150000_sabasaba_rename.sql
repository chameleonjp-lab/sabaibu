-- Rename the active game identifiers after the repository rename.
begin;

do $$
declare
  v_old_prefix constant text := 'saba' || 'ibu';
  v_new_prefix constant text := 'saba' || 'saba';
  v_old_table constant text := v_old_prefix || '_run_sessions';
  v_new_table constant text := v_new_prefix || '_run_sessions';
  v_old_index constant text := 'score_runs_' || v_old_prefix || '_play_token_unique';
  v_new_index constant text := 'score_runs_' || v_new_prefix || '_play_token_unique';
  r record;
  v_definition text;
begin
  if to_regclass('private.' || v_old_table) is not null
     and to_regclass('private.' || v_new_table) is null then
    execute format(
      'alter table private.%I rename to %I',
      v_old_table,
      v_new_table
    );
  end if;

  for r in
    select n.nspname as schema_name,
           p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and n.nspname in ('public', 'private')
      and lower(p.proname) like '%' || lower(v_old_prefix) || '%'
  loop
    execute format(
      'alter function %I.%I(%s) rename to %I',
      r.schema_name,
      r.function_name,
      r.arguments,
      replace(r.function_name, v_old_prefix, v_new_prefix)
    );
  end loop;

  for r in
    select con.conname as constraint_name,
           con.contype,
           pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    where con.conrelid = to_regclass('private.' || v_new_table)
      and lower(
        con.conname || ' ' || pg_get_constraintdef(con.oid)
      ) like '%' || lower(v_old_prefix) || '%'
  loop
    v_definition := replace(r.definition, v_old_prefix, v_new_prefix);

    if r.contype = 'c' then
      execute format(
        'alter table private.%I drop constraint %I',
        v_new_table,
        r.constraint_name
      );
    else
      execute format(
        'alter table private.%I rename constraint %I to %I',
        v_new_table,
        r.constraint_name,
        replace(r.constraint_name, v_old_prefix, v_new_prefix)
      );
    end if;
  end loop;

  for r in
    select distinct n.nspname as schema_name,
                    c.relname as relation_name,
                    t.tgname as trigger_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and c.relname in ('game_scores', 'score_runs')
      and t.tgname in (
        'guard_verified_game_scores',
        'guard_verified_score_runs',
        'guard_' || v_old_prefix || '_verified_score_runs'
      )
  loop
    execute format(
      'alter table %I.%I disable trigger %I',
      r.schema_name,
      r.relation_name,
      r.trigger_name
    );
  end loop;

  if exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('private.game_play_sessions')
      and conname = 'game_play_sessions_game_slug_fkey'
  ) then
    alter table private.game_play_sessions
      drop constraint game_play_sessions_game_slug_fkey;
  end if;

  update public.games
  set game_slug = replace(game_slug, v_old_prefix, v_new_prefix),
      game_url = replace(
        game_url,
        '/' || v_old_prefix || '/',
        '/' || v_new_prefix || '/'
      ),
      share_text = replace(
        share_text,
        '/' || v_old_prefix || '/',
        '/' || v_new_prefix || '/'
      )
  where game_slug like v_old_prefix || '%'
     or game_url like '%' || v_old_prefix || '%'
     or share_text like '%' || v_old_prefix || '%';

  for r in
    select distinct table_schema, table_name
    from information_schema.columns
    where column_name = 'game_slug'
      and table_schema in ('public', 'private')
      and not (table_schema = 'public' and table_name = 'games')
  loop
    execute format(
      'update %I.%I set game_slug = replace(game_slug, $1, $2)
       where game_slug like $3',
      r.table_schema,
      r.table_name
    )
    using v_old_prefix, v_new_prefix, v_old_prefix || '%';
  end loop;

  if to_regclass('private.' || v_new_table) is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = to_regclass('private.' || v_new_table)
         and conname = v_new_prefix || '_run_game_slug'
     ) then
    execute format(
      'alter table private.%I add constraint %I check (game_slug = any (array[%L::text, %L::text]))',
      v_new_table,
      v_new_prefix || '_run_game_slug',
      v_new_prefix || '_normal',
      v_new_prefix || '_endless'
    );
  end if;

  if to_regclass('private.game_play_sessions') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = to_regclass('private.game_play_sessions')
         and conname = 'game_play_sessions_game_slug_fkey'
     ) then
    alter table private.game_play_sessions
      add constraint game_play_sessions_game_slug_fkey
      foreign key (game_slug) references public.games(game_slug);
  end if;

  for r in
    select table_schema, table_name, column_name
    from information_schema.columns
    where column_name = 'client_version'
      and data_type in ('text', 'character varying', 'character')
      and table_schema in ('public', 'private')
  loop
    execute format(
      'update %I.%I
       set %I = replace(%I, $1, $2)
       where %I like $3',
      r.table_schema,
      r.table_name,
      r.column_name,
      r.column_name,
      r.column_name
    )
    using v_old_prefix, v_new_prefix, '%' || v_old_prefix || '%';
  end loop;

  for r in
    select table_schema, table_name, column_name
    from information_schema.columns
    where data_type in ('text', 'character varying', 'character')
      and column_name not in ('game_slug', 'client_version')
      and table_schema in ('public', 'private')
  loop
    execute format(
      'update %I.%I
       set %I = replace(%I, $1, $2)
       where %I like $3',
      r.table_schema,
      r.table_name,
      r.column_name,
      r.column_name,
      r.column_name
    )
    using v_old_prefix, v_new_prefix, '%' || v_old_prefix || '%';
  end loop;

  for r in
    select table_schema, table_name, column_name, data_type
    from information_schema.columns
    where data_type in ('json', 'jsonb')
      and table_schema in ('public', 'private')
  loop
    execute format(
      'update %I.%I
       set %I = replace(%I::text, $1, $2)::%s
       where %I::text like $3',
      r.table_schema,
      r.table_name,
      r.column_name,
      r.column_name,
      r.data_type,
      r.column_name
    )
    using v_old_prefix, v_new_prefix, '%' || v_old_prefix || '%';
  end loop;

  if to_regclass('public.' || v_old_index) is not null then
    execute format('drop index public.%I', v_old_index);
  end if;

  if to_regclass('public.' || v_new_index) is not null then
    execute format('drop index public.%I', v_new_index);
  end if;

  execute format(
    'create unique index %I on public.score_runs
     using btree (((metadata ->> %L)))
     where game_slug in (%L, %L)
       and (metadata ->> %L) is not null',
    v_new_index,
    'play_token',
    v_new_prefix || '_normal',
    v_new_prefix || '_endless',
    'play_token'
  );

  for r in
    select distinct n.nspname as schema_name,
                    c.relname as relation_name,
                    t.tgname as trigger_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and c.relname in ('game_scores', 'score_runs')
      and t.tgname in (
        'guard_verified_game_scores',
        'guard_verified_score_runs',
        'guard_' || v_old_prefix || '_verified_score_runs'
      )
  loop
    execute format(
      'alter table %I.%I enable trigger %I',
      r.schema_name,
      r.relation_name,
      r.trigger_name
    );
  end loop;

  for r in
    select schemaname, indexname
    from pg_indexes
    where schemaname in ('public', 'private')
      and lower(indexname) like '%' || lower(v_old_prefix) || '%'
  loop
    execute format(
      'alter index %I.%I rename to %I',
      r.schemaname,
      r.indexname,
      replace(r.indexname, v_old_prefix, v_new_prefix)
    );
  end loop;

  for r in
    select distinct trigger_schema, event_object_table, trigger_name
    from information_schema.triggers
    where trigger_schema in ('public', 'private')
      and lower(trigger_name) like '%' || lower(v_old_prefix) || '%'
  loop
    execute format(
      'alter trigger %I on %I.%I rename to %I',
      r.trigger_name,
      r.trigger_schema,
      r.event_object_table,
      replace(r.trigger_name, v_old_prefix, v_new_prefix)
    );
  end loop;

  for r in
    select p.oid,
           pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and n.nspname in ('public', 'private')
      and lower(pg_get_functiondef(p.oid)) like '%' || lower(v_old_prefix) || '%'
  loop
    v_definition := replace(r.definition, v_old_prefix, v_new_prefix);
    v_definition := replace(v_definition, initcap(v_old_prefix), initcap(v_new_prefix));
    v_definition := replace(v_definition, upper(v_old_prefix), upper(v_new_prefix));
    execute v_definition;
  end loop;
end
$$;

grant execute on function public.start_sabasaba_run(text, text, uuid, text)
  to anon, authenticated;

grant execute on function public.submit_sabasaba_run(
  uuid, text, text, integer, integer, integer, integer, integer, integer, text
) to anon, authenticated;

revoke execute on function private.guard_sabasaba_score_runs()
  from public, anon, authenticated;

commit;
