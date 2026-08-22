-- Correct the verified-run start RPC so the upsert targets the composite primary key unambiguously.
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
  if not exists (select 1 from public.games g where g.game_slug = v_game_slug and g.is_active) then raise exception 'game not found'; end if;

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

revoke execute on function public.start_sabaibu_run(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.start_sabaibu_run(text, text, uuid, text)
  to anon, authenticated;
