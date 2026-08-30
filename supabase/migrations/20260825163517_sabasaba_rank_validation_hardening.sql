-- Harden Sabasaba ranking validation before the client is ever allowed to enable ranking.
-- This migration closes time rollback, future-time, client-version replacement, and
-- one-time-token replay gaps. It does not make client-reported combat statistics
-- authoritative; that requires a server-side event ledger or server-run simulation.
create or replace function public.submit_sabasaba_run(
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
  v_run private.sabasaba_run_sessions%rowtype;
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
  if p_play_token is null then
    raise exception 'play token is required';
  end if;

  v_expected_slug := case p_mode
    when 'normal' then 'sabasaba_normal'
    when 'endless' then 'sabasaba_endless'
    else null
  end;
  if v_expected_slug is null then
    raise exception 'invalid mode';
  end if;

  select *
  into v_run
  from private.sabasaba_run_sessions s
  where s.play_token = p_play_token
  for update;

  if not found then
    raise exception 'play token not found';
  end if;
  if v_run.game_slug <> v_expected_slug then
    raise exception 'mode mismatch';
  end if;
  if v_run.expires_at < clock_timestamp() then
    raise exception 'play token expired';
  end if;
  if left(coalesce(p_client_version, ''), 120) <> v_run.client_version then
    raise exception 'client version does not match the started run';
  end if;

  if p_elapsed_seconds is null
     or p_elapsed_seconds < 1
     or p_elapsed_seconds > 86400 then
    raise exception 'invalid elapsed time';
  end if;
  if p_kills is null
     or p_kills < 0
     or p_kills > p_elapsed_seconds * 5 + 200 then
    raise exception 'invalid kill count';
  end if;
  if p_level is null
     or p_level < 1
     or p_level > 200
     or p_level > p_kills + 10 then
    raise exception 'invalid level';
  end if;
  if p_damage_hits is null
     or p_damage_hits < 0
     or p_damage_hits > p_elapsed_seconds * 4 + 100 then
    raise exception 'invalid hit count';
  end if;
  if p_damage_taken is null
     or p_damage_taken < p_damage_hits
     or p_damage_taken > p_damage_hits * 100 then
    raise exception 'invalid damage total';
  end if;
  if p_damage_hits = 0 and p_damage_taken <> 0 then
    raise exception 'damage mismatch';
  end if;

  -- The client clock may lag during rendering or network transfer, but it must
  -- not be able to move the submitted run materially backwards or forwards.
  v_server_elapsed := floor(extract(epoch from (clock_timestamp() - v_run.started_at)));
  if v_server_elapsed < 1 then
    raise exception 'run finished too early';
  end if;
  if p_elapsed_seconds < greatest(1, v_server_elapsed - 10)
     or p_elapsed_seconds > v_server_elapsed + 2 then
    raise exception 'elapsed time does not match server clock';
  end if;

  if p_mode = 'normal' then
    if p_outcome <> 'clear' then
      raise exception 'normal requires clear';
    end if;
    if p_elapsed_seconds < 555 or p_elapsed_seconds > 600 then
      raise exception 'normal clear time is impossible';
    end if;
    if v_server_elapsed < 540 then
      raise exception 'normal run finished too early';
    end if;
  else
    if p_outcome <> 'failed' then
      raise exception 'endless requires game over';
    end if;
  end if;

  -- Score is always recalculated here. The client value is accepted only as a
  -- consistency check and is never used as the stored score.
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

  if p_score is null or p_score <> v_score then
    raise exception 'score mismatch';
  end if;

  if v_run.status = 'submitted' then
    if v_run.outcome <> p_outcome
       or v_run.elapsed_seconds <> p_elapsed_seconds
       or v_run.kills <> p_kills
       or v_run.level <> p_level
       or v_run.damage_hits <> p_damage_hits
       or v_run.damage_taken <> p_damage_taken
       or v_run.score <> v_score then
      raise exception 'play token already used with different result';
    end if;

    select gs.best_score, gs.play_count
    into v_old_best, v_play_count
    from public.game_scores gs
    where gs.normalized_name = v_run.normalized_name
      and gs.game_slug = v_run.game_slug;

    return query
    select true, true, v_score, v_old_best, v_play_count, false,
      v_kill_points, v_time_points, v_level_points,
      v_hit_penalty, v_damage_penalty, v_positive_total, v_penalty_total;
    return;
  end if;

  perform set_config('app.sabasaba_verified_run', p_play_token::text, true);

  update private.sabasaba_run_sessions
  set status = 'submitted',
      finished_at = clock_timestamp(),
      outcome = p_outcome,
      elapsed_seconds = p_elapsed_seconds,
      kills = p_kills,
      level = p_level,
      damage_hits = p_damage_hits,
      damage_taken = p_damage_taken,
      score = v_score
  where play_token = p_play_token;

  insert into public.score_runs (
    normalized_name,
    game_slug,
    score,
    client_version,
    created_at,
    metadata
  )
  values (
    v_run.normalized_name,
    v_run.game_slug,
    v_score,
    v_run.client_version,
    clock_timestamp(),
    jsonb_build_object(
      'source', 'sabasaba_verified',
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

  select gs.best_score, gs.play_count
  into v_old_best, v_play_count
  from public.game_scores gs
  where gs.normalized_name = v_run.normalized_name
    and gs.game_slug = v_run.game_slug
  for update;

  v_is_new_best := v_old_best is null
    or v_score > v_old_best
    or not exists (
      select 1
      from public.game_scores gs
      where gs.normalized_name = v_run.normalized_name
        and gs.game_slug = v_run.game_slug
        and gs.first_score is not null
    );

  update public.game_scores
  set display_name = v_run.display_name,
      first_score = coalesce(first_score, v_score),
      first_score_at = coalesce(first_score_at, clock_timestamp()),
      best_score = case
        when first_score is null or v_score > best_score then v_score
        else best_score
      end,
      best_score_at = case
        when first_score is null or v_score > best_score then clock_timestamp()
        else best_score_at
      end,
      updated_at = clock_timestamp(),
      ranking_status = 'normal',
      ranking_note = null,
      ranking_status_updated_at = clock_timestamp()
  where normalized_name = v_run.normalized_name
    and game_slug = v_run.game_slug;

  select gs.best_score, gs.play_count
  into v_old_best, v_play_count
  from public.game_scores gs
  where gs.normalized_name = v_run.normalized_name
    and gs.game_slug = v_run.game_slug;

  return query
  select true, false, v_score, v_old_best, v_play_count, v_is_new_best,
    v_kill_points, v_time_points, v_level_points,
    v_hit_penalty, v_damage_penalty, v_positive_total, v_penalty_total;
end;
$$;

-- Ranking is intentionally disabled for this phase. Re-granting these functions
-- must be a separate, reviewed migration after authoritative validation exists.
revoke execute on function public.start_sabasaba_run(text, text, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.submit_sabasaba_run(uuid, text, text, integer, integer, integer, integer, integer, integer, text)
  from public, anon, authenticated;
