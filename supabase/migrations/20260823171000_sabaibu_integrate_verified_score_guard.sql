-- Extend the shared verified-score guard so Sabaibu uses its own one-time run ledger
-- without weakening the existing Tomatoku verified-run protection.
create or replace function private.guard_verified_score_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_slug text;
  v_run_token_text text;
  v_run_token uuid;
  v_run private.tomatoku_runs_v1%rowtype;
  v_sabaibu_run private.sabaibu_run_sessions%rowtype;
begin
  v_game_slug := case when tg_op = 'DELETE' then old.game_slug else new.game_slug end;

  if v_game_slug in ('sabaibu_normal', 'sabaibu_endless') then
    v_run_token_text := nullif(current_setting('app.sabaibu_verified_run', true), '');
    begin
      v_run_token := v_run_token_text::uuid;
    exception when others then
      raise exception 'verified sabaibu score write requires a valid run';
    end;

    select * into v_sabaibu_run
    from private.sabaibu_run_sessions s
    where s.play_token = v_run_token
      and s.game_slug = v_game_slug
      and s.status in ('started', 'submitted');
    if not found then
      raise exception 'verified sabaibu score write requires an active run';
    end if;
    if new.normalized_name is distinct from v_sabaibu_run.normalized_name then
      raise exception 'verified sabaibu score write does not match the active run';
    end if;
    if tg_table_name = 'score_runs' then
      if v_sabaibu_run.status <> 'submitted'
        or new.score is distinct from v_sabaibu_run.score
        or new.client_version is distinct from v_sabaibu_run.client_version
        or new.metadata ->> 'source' is distinct from 'sabaibu_verified'
        or new.metadata ->> 'play_token' is distinct from v_sabaibu_run.play_token::text
      then
        raise exception 'verified sabaibu score write values do not match the active run';
      end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if exists (
    select 1
    from public.games g
    where g.game_slug = v_game_slug
      and g.submission_mode = 'verified'
  ) then
    if current_setting('app.tomatoku_verified_admin', true) = 'review' then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
    v_run_token_text := nullif(
      current_setting('app.tomatoku_verified_run', true),
      ''
    );
    begin
      v_run_token := v_run_token_text::uuid;
    exception when others then
      raise exception 'verified score write requires a valid run';
    end;

    select *
    into v_run
    from private.tomatoku_runs_v1 r
    where r.run_token = v_run_token
      and r.game_slug = v_game_slug
      and r.status = 'active';
    if not found then
      raise exception 'verified score write requires an active run';
    end if;
    if new.normalized_name is distinct from v_run.normalized_name then
      raise exception 'verified score write does not match the active run';
    end if;
    if tg_table_name = 'score_runs' then
      if new.score is distinct from v_run.score
        or new.client_version is distinct from v_run.client_version
      then
        raise exception 'verified score write values do not match the active run';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.start_sabaibu_run(
  p_display_name text,
  p_mode text,
  p_client_run_id uuid,
  p_client_version text default ''
)
returns table(play_token uuid, game_slug text, play_count integer, already_started boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_normalized_name text;
  v_game_slug text;
  v_play_token uuid;
  v_play_count integer;
  v_inserted boolean := false;
begin
  if p_client_run_id is null then raise exception 'client run id is required'; end if;
  v_display_name := left(btrim(coalesce(p_display_name, '')), 20);
  v_normalized_name := public.normalize_player_name(v_display_name);
  if char_length(v_normalized_name) = 0 then raise exception 'name is empty'; end if;
  if char_length(v_normalized_name) > 20 then raise exception 'name is too long'; end if;
  v_game_slug := case p_mode when 'normal' then 'sabaibu_normal' when 'endless' then 'sabaibu_endless' else null end;
  if v_game_slug is null then raise exception 'invalid mode'; end if;
  if not exists (select 1 from public.games g where g.game_slug = v_game_slug and g.is_active) then
    raise exception 'game not found';
  end if;

  select s.play_token into v_play_token
  from private.sabaibu_run_sessions s
  where s.client_run_id = p_client_run_id;
  if found then
    if not exists (
      select 1
      from private.sabaibu_run_sessions s
      where s.client_run_id = p_client_run_id
        and s.normalized_name = v_normalized_name
        and s.game_slug = v_game_slug
    ) then
      raise exception 'client run id conflict';
    end if;
    select gs.play_count into v_play_count
    from public.game_scores gs
    where gs.normalized_name = v_normalized_name and gs.game_slug = v_game_slug;
    return query select v_play_token, v_game_slug, coalesce(v_play_count, 1), true;
    return;
  end if;

  v_play_token := gen_random_uuid();
  insert into private.sabaibu_run_sessions (
    play_token, client_run_id, game_slug, normalized_name, display_name, client_version
  ) values (
    v_play_token, p_client_run_id, v_game_slug, v_normalized_name, v_display_name,
    left(coalesce(p_client_version, ''), 120)
  )
  on conflict (client_run_id) do nothing;
  get diagnostics v_play_count = row_count;
  v_inserted := v_play_count = 1;

  if not v_inserted then
    select s.play_token into v_play_token
    from private.sabaibu_run_sessions s
    where s.client_run_id = p_client_run_id
      and s.normalized_name = v_normalized_name
      and s.game_slug = v_game_slug;
    if not found then raise exception 'client run id conflict'; end if;
    select gs.play_count into v_play_count
    from public.game_scores gs
    where gs.normalized_name = v_normalized_name and gs.game_slug = v_game_slug;
    return query select v_play_token, v_game_slug, coalesce(v_play_count, 1), true;
    return;
  end if;

  insert into public.players (normalized_name, display_name, created_at, last_played_at)
  values (v_normalized_name, v_display_name, clock_timestamp(), clock_timestamp())
  on conflict (normalized_name) do update set
    display_name = excluded.display_name,
    last_played_at = excluded.last_played_at;

  perform set_config('app.sabaibu_verified_run', v_play_token::text, true);
  insert into public.game_scores (
    normalized_name, game_slug, display_name,
    first_score, best_score, play_count,
    updated_at, ranking_status
  ) values (
    v_normalized_name, v_game_slug, v_display_name,
    null, 0, 1,
    clock_timestamp(), 'hidden'
  )
  on conflict on constraint game_scores_pkey do update set
    display_name = excluded.display_name,
    play_count = public.game_scores.play_count + 1,
    updated_at = excluded.updated_at;

  select gs.play_count into v_play_count
  from public.game_scores gs
  where gs.normalized_name = v_normalized_name and gs.game_slug = v_game_slug;
  return query select v_play_token, v_game_slug, v_play_count, false;
end;
$$;

create or replace function public.submit_sabaibu_run(
  p_play_token uuid,
  p_mode text,
  p_outcome text,
  p_score integer,
  p_elapsed_seconds integer,
  p_kills integer,
  p_level integer,
  p_damage_hits integer,
  p_damage_taken integer,
  p_client_version text default ''
)
returns table(
  accepted boolean,
  already_submitted boolean,
  result_score integer,
  result_best_score integer,
  result_play_count integer,
  is_new_best boolean,
  kill_points integer,
  time_points integer,
  level_points integer,
  hit_penalty integer,
  damage_penalty integer,
  positive_total integer,
  penalty_total integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run private.sabaibu_run_sessions%rowtype;
  v_expected_slug text;
  v_server_elapsed integer;
  v_kill_points integer;
  v_time_points integer;
  v_level_points integer;
  v_hit_penalty integer;
  v_damage_penalty integer;
  v_positive_total integer;
  v_penalty_total integer;
  v_score integer;
  v_old_best integer;
  v_play_count integer;
  v_is_new_best boolean := false;
begin
  if p_play_token is null then raise exception 'play token is required'; end if;
  v_expected_slug := case p_mode when 'normal' then 'sabaibu_normal' when 'endless' then 'sabaibu_endless' else null end;
  if v_expected_slug is null then raise exception 'invalid mode'; end if;

  select * into v_run
  from private.sabaibu_run_sessions s
  where s.play_token = p_play_token
  for update;
  if not found then raise exception 'play token not found'; end if;
  if v_run.game_slug <> v_expected_slug then raise exception 'mode mismatch'; end if;
  if v_run.expires_at < clock_timestamp() then raise exception 'play token expired'; end if;

  if p_elapsed_seconds is null or p_elapsed_seconds < 1 or p_elapsed_seconds > 86400 then
    raise exception 'invalid elapsed time';
  end if;
  if p_kills is null or p_kills < 0 or p_kills > p_elapsed_seconds * 5 + 200 then
    raise exception 'invalid kill count';
  end if;
  if p_level is null or p_level < 1 or p_level > 200 or p_level > p_kills + 10 then
    raise exception 'invalid level';
  end if;
  if p_damage_hits is null or p_damage_hits < 0 or p_damage_hits > p_elapsed_seconds * 4 + 100 then
    raise exception 'invalid hit count';
  end if;
  if p_damage_taken is null or p_damage_taken < p_damage_hits or p_damage_taken > p_damage_hits * 100 then
    raise exception 'invalid damage total';
  end if;
  if p_damage_hits = 0 and p_damage_taken <> 0 then raise exception 'damage mismatch'; end if;

  v_server_elapsed := floor(extract(epoch from (clock_timestamp() - v_run.started_at)));
  if p_elapsed_seconds > v_server_elapsed + 10 then raise exception 'elapsed time exceeds server time'; end if;
  if p_mode = 'normal' then
    if p_outcome <> 'clear' then raise exception 'normal requires clear'; end if;
    if p_elapsed_seconds < 555 or p_elapsed_seconds > 600 then
      raise exception 'normal clear time is impossible';
    end if;
    if v_server_elapsed < 540 then raise exception 'normal run finished too early'; end if;
  else
    if p_outcome <> 'failed' then raise exception 'endless requires game over'; end if;
  end if;

  v_kill_points := p_kills * 100;
  v_time_points := case
    when p_mode = 'normal' then greatest(0, 600 - p_elapsed_seconds) * 100
    else p_elapsed_seconds * 10
  end;
  v_level_points := p_level * 250;
  v_hit_penalty := p_damage_hits * 400;
  v_damage_penalty := p_damage_taken * 10;
  v_positive_total := v_kill_points + v_time_points + v_level_points;
  v_penalty_total := v_hit_penalty + v_damage_penalty;
  v_score := greatest(0, v_positive_total - v_penalty_total);
  if p_score is null or p_score <> v_score then raise exception 'score mismatch'; end if;

  if v_run.status = 'submitted' then
    if v_run.outcome <> p_outcome
      or v_run.elapsed_seconds <> p_elapsed_seconds
      or v_run.kills <> p_kills
      or v_run.level <> p_level
      or v_run.damage_hits <> p_damage_hits
      or v_run.damage_taken <> p_damage_taken
      or v_run.score <> v_score
    then
      raise exception 'play token already used with different result';
    end if;
    select gs.best_score, gs.play_count into v_old_best, v_play_count
    from public.game_scores gs
    where gs.normalized_name = v_run.normalized_name and gs.game_slug = v_run.game_slug;
    return query select
      true, true, v_score, v_old_best, v_play_count, false,
      v_kill_points, v_time_points, v_level_points,
      v_hit_penalty, v_damage_penalty, v_positive_total, v_penalty_total;
    return;
  end if;

  perform set_config('app.sabaibu_verified_run', p_play_token::text, true);
  update private.sabaibu_run_sessions set
    status = 'submitted',
    finished_at = clock_timestamp(),
    outcome = p_outcome,
    elapsed_seconds = p_elapsed_seconds,
    kills = p_kills,
    level = p_level,
    damage_hits = p_damage_hits,
    damage_taken = p_damage_taken,
    score = v_score,
    client_version = left(coalesce(p_client_version, client_version), 120)
  where play_token = p_play_token;

  insert into public.score_runs (
    normalized_name, game_slug, score, client_version, created_at, metadata
  ) values (
    v_run.normalized_name,
    v_run.game_slug,
    v_score,
    left(coalesce(p_client_version, ''), 120),
    clock_timestamp(),
    jsonb_build_object(
      'source', 'sabaibu_verified',
      'play_token', p_play_token::text,
      'outcome', p_outcome,
      'elapsed_seconds', p_elapsed_seconds,
      'kills', p_kills,
      'level', p_level,
      'damage_hits', p_damage_hits,
      'damage_taken', p_damage_taken,
      'kill_points', v_kill_points,
      'time_points', v_time_points,
      'level_points', v_level_points,
      'hit_penalty', v_hit_penalty,
      'damage_penalty', v_damage_penalty
    )
  );

  select gs.best_score, gs.play_count into v_old_best, v_play_count
  from public.game_scores gs
  where gs.normalized_name = v_run.normalized_name and gs.game_slug = v_run.game_slug
  for update;
  v_is_new_best := v_old_best is null or v_score > v_old_best or not exists (
    select 1
    from public.game_scores gs
    where gs.normalized_name = v_run.normalized_name
      and gs.game_slug = v_run.game_slug
      and gs.first_score is not null
  );

  update public.game_scores set
    display_name = v_run.display_name,
    first_score = coalesce(first_score, v_score),
    first_score_at = coalesce(first_score_at, clock_timestamp()),
    best_score = case when first_score is null or v_score > best_score then v_score else best_score end,
    best_score_at = case when first_score is null or v_score > best_score then clock_timestamp() else best_score_at end,
    updated_at = clock_timestamp(),
    ranking_status = 'normal',
    ranking_note = null,
    ranking_status_updated_at = clock_timestamp()
  where normalized_name = v_run.normalized_name and game_slug = v_run.game_slug;

  select gs.best_score, gs.play_count into v_old_best, v_play_count
  from public.game_scores gs
  where gs.normalized_name = v_run.normalized_name and gs.game_slug = v_run.game_slug;
  return query select
    true, false, v_score, v_old_best, v_play_count, v_is_new_best,
    v_kill_points, v_time_points, v_level_points,
    v_hit_penalty, v_damage_penalty, v_positive_total, v_penalty_total;
end;
$$;

revoke execute on function private.guard_verified_score_write()
  from public, anon, authenticated;
revoke execute on function public.start_sabaibu_run(text, text, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.submit_sabaibu_run(uuid, text, text, integer, integer, integer, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.start_sabaibu_run(text, text, uuid, text)
  to anon, authenticated;
grant execute on function public.submit_sabaibu_run(uuid, text, text, integer, integer, integer, integer, integer, integer, text)
  to anon, authenticated;
