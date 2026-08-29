-- Keep Sabasaba ranking fully disabled until authoritative combat proof exists.
-- The write RPCs are already revoked; these guards close the shared read RPCs too.

create or replace function public.get_best_score_ranking(
  p_game_slug text,
  p_limit integer default 100
)
returns table(
  rank_no bigint,
  display_name text,
  first_score integer,
  best_score integer,
  play_count integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_game_slug in ('sabasaba_normal', 'sabasaba_endless') then
    raise exception 'sabasaba ranking is disabled';
  end if;

  return query
  with game_config as (
    select coalesce(g.score_order, 'desc') as score_order
    from public.games as g
    where g.game_slug = p_game_slug
    limit 1
  ), ranked as (
    select rank() over (
      order by
        case when coalesce((select score_order from game_config), 'desc') = 'asc'
          then gs.best_score end asc nulls last,
        case when coalesce((select score_order from game_config), 'desc') <> 'asc'
          then gs.best_score end desc nulls last
    ) as rank_no,
    gs.display_name, gs.first_score, gs.best_score, gs.play_count, gs.updated_at
    from public.game_scores as gs
    where gs.game_slug = p_game_slug
      and coalesce(gs.ranking_status, 'normal') = 'normal'
  )
  select ranked.rank_no, ranked.display_name, ranked.first_score, ranked.best_score,
         ranked.play_count, ranked.updated_at
  from ranked
  order by ranked.rank_no asc, ranked.updated_at asc, ranked.display_name asc
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
end;
$function$;

create or replace function public.get_best_score_ranking_with_metadata(
  p_game_slug text,
  p_limit integer default 10
)
returns table(
  rank_no integer,
  display_name text,
  best_score integer,
  play_count integer,
  best_score_at timestamptz,
  metadata jsonb
)
language sql
security definer
set search_path = 'public'
as $function$
  with ranked as (
    select
      row_number() over (
        order by
          case when g.score_order = 'asc' then gs.best_score end asc nulls last,
          case when coalesce(g.score_order, 'desc') <> 'asc' then gs.best_score end desc nulls last,
          gs.best_score_at asc
      )::integer as rank_no,
      p.display_name,
      gs.normalized_name,
      gs.game_slug,
      gs.best_score,
      gs.play_count,
      gs.best_score_at
    from public.game_scores gs
    join public.players p
      on p.normalized_name = gs.normalized_name
    join public.games g
      on g.game_slug = gs.game_slug
    where gs.game_slug = p_game_slug
      and p_game_slug not in ('sabasaba_normal', 'sabasaba_endless')
    order by
      case when g.score_order = 'asc' then gs.best_score end asc nulls last,
      case when coalesce(g.score_order, 'desc') <> 'asc' then gs.best_score end desc nulls last,
      gs.best_score_at asc
    limit p_limit
  )
  select
    r.rank_no,
    r.display_name,
    r.best_score,
    r.play_count,
    r.best_score_at,
    sr.metadata
  from ranked r
  left join lateral (
    select s.metadata
    from public.score_runs s
    where s.normalized_name = r.normalized_name
      and s.game_slug = r.game_slug
      and s.score = r.best_score
    order by
      abs(extract(epoch from (s.created_at - r.best_score_at))) asc,
      s.created_at desc,
      s.id desc
    limit 1
  ) sr on true
  order by r.rank_no;
$function$;

create or replace function public.get_disqualified_score_entries(
  p_game_slug text,
  p_limit integer default 50
)
returns table(
  display_name text,
  ranking_status text,
  ranking_note text,
  first_score integer,
  best_score integer,
  play_count integer,
  updated_at timestamptz,
  ranking_status_updated_at timestamptz
)
language sql
stable
security definer
set search_path = 'public'
as $function$
  select
    gs.display_name,
    gs.ranking_status,
    gs.ranking_note,
    gs.first_score,
    gs.best_score,
    gs.play_count,
    gs.updated_at,
    gs.ranking_status_updated_at
  from public.game_scores gs
  where gs.game_slug = p_game_slug
    and p_game_slug not in ('sabasaba_normal', 'sabasaba_endless')
    and gs.ranking_status = 'disqualified'
  order by
    gs.ranking_status_updated_at desc nulls last,
    gs.updated_at desc,
    gs.display_name asc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$function$;

create or replace function public.get_player_score_summary_with_metadata(
  p_game_slug text,
  p_normalized_name text
)
returns table(
  display_name text,
  first_score integer,
  best_score integer,
  play_count integer,
  first_score_at timestamptz,
  best_score_at timestamptz,
  first_metadata jsonb,
  best_metadata jsonb
)
language sql
security definer
set search_path = 'public'
as $function$
  select
    p.display_name,
    gs.first_score,
    gs.best_score,
    gs.play_count,
    gs.first_score_at,
    gs.best_score_at,
    first_run.metadata as first_metadata,
    best_run.metadata as best_metadata
  from public.game_scores gs
  join public.players p
    on p.normalized_name = gs.normalized_name
  left join lateral (
    select s.metadata
    from public.score_runs s
    where s.normalized_name = gs.normalized_name
      and s.game_slug = gs.game_slug
      and s.score = gs.first_score
    order by
      abs(extract(epoch from (s.created_at - gs.first_score_at))) asc,
      s.created_at asc,
      s.id asc
    limit 1
  ) first_run on true
  left join lateral (
    select s.metadata
    from public.score_runs s
    where s.normalized_name = gs.normalized_name
      and s.game_slug = gs.game_slug
      and s.score = gs.best_score
    order by
      abs(extract(epoch from (s.created_at - gs.best_score_at))) asc,
      s.created_at desc,
      s.id desc
    limit 1
  ) best_run on true
  where gs.game_slug = p_game_slug
    and p_game_slug not in ('sabasaba_normal', 'sabasaba_endless')
    and gs.normalized_name = p_normalized_name
  limit 1;
$function$;