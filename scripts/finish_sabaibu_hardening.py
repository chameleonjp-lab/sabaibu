from pathlib import Path

path = Path("supabase/migrations/20260823160000_sabaibu_verified_ranking.sql")
text = path.read_text(encoding="utf-8")

def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    text = text.replace(old, new, 1)

replace_once(
    """create index if not exists sabaibu_run_sessions_status_expiry_idx
  on private.sabaibu_run_sessions (status, expires_at);

create or replace function public.start_sabaibu_run(""",
    """create index if not exists sabaibu_run_sessions_status_expiry_idx
  on private.sabaibu_run_sessions (status, expires_at);

-- Preserve old rows for audit, but do not allow a pre-contract score to remain a best score.
update public.score_runs
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'sabaibu_legacy_unverified')
where game_slug in ('sabaibu_normal', 'sabaibu_endless')
  and coalesce(metadata ->> 'source', '') <> 'sabaibu_verified';

delete from public.game_scores gs
where gs.game_slug in ('sabaibu_normal', 'sabaibu_endless')
  and not exists (
    select 1
    from public.score_runs sr
    where sr.normalized_name = gs.normalized_name
      and sr.game_slug = gs.game_slug
      and sr.metadata ->> 'source' = 'sabaibu_verified'
  );

create or replace function public.start_sabaibu_run(""",
    "legacy aggregate cleanup",
)

replace_once(
    """  if not v_inserted then
    select s.play_token into v_play_token from private.sabaibu_run_sessions s where s.client_run_id = p_client_run_id;
    select gs.play_count into v_play_count from public.game_scores gs where gs.normalized_name = v_normalized_name and gs.game_slug = v_game_slug;
    return query select v_play_token, v_game_slug, coalesce(v_play_count, 1), true;
    return;
  end if;""",
    """  if not v_inserted then
    select s.play_token into v_play_token
    from private.sabaibu_run_sessions s
    where s.client_run_id = p_client_run_id
      and s.normalized_name = v_normalized_name
      and s.game_slug = v_game_slug;
    if not found then raise exception 'client run id conflict'; end if;
    select gs.play_count into v_play_count from public.game_scores gs where gs.normalized_name = v_normalized_name and gs.game_slug = v_game_slug;
    return query select v_play_token, v_game_slug, coalesce(v_play_count, 1), true;
    return;
  end if;""",
    "concurrent client id conflict",
)

replace_once(
    """grant execute on function public.start_sabaibu_run(text, text, uuid, text) to anon, authenticated;
grant execute on function public.submit_sabaibu_run(uuid, text, text, integer, integer, integer, integer, integer, integer, text) to anon, authenticated;""",
    """grant execute on function public.start_sabaibu_run(text, text, uuid, text) to anon, authenticated;
grant execute on function public.submit_sabaibu_run(uuid, text, text, integer, integer, integer, integer, integer, integer, text) to anon, authenticated;
revoke execute on function private.guard_sabaibu_score_runs() from public, anon, authenticated;""",
    "trigger function privileges",
)

path.write_text(text, encoding="utf-8")
print("Ranking migration cleanup patch applied.")
