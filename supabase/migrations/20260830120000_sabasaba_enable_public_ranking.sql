-- Publish the verified Sabasaba leaderboard through the aggregate RPC only.
-- The source tables remain unavailable to anon/authenticated SELECT.

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

revoke all on function public.get_best_score_ranking(text, integer) from public;
grant execute on function public.get_best_score_ranking(text, integer)
  to anon, authenticated, service_role;

update public.games
set is_active = true
where game_slug in ('sabasaba_normal', 'sabasaba_endless');
