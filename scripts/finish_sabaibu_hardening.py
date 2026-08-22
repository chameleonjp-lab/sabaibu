from __future__ import annotations

import re
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


# Avoid a ReferenceError on older browsers that do not expose Web Crypto.
ranking_path = "client/src/hooks/useGameRanking.ts"
ranking = read(ranking_path)
ranking = replace_once(
    ranking,
    '''export const createClientRunId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};''',
    '''export const createClientRunId = () => {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};''',
    "ranking UUID fallback",
)
write(ranking_path, ranking)

# Make attack warning geometry match its actual radius and avoid phantom fire sounds.
world_path = "client/src/game/GameWorld.ts"
world = read(world_path)
world = replace_once(
    world,
    '''  private createBossWarning(position: Vector3, diameter: number) {
    this.dangerSignal += 1;
    this.queueSound("warning");
    const marker = MeshBuilder.CreateTorus("bulwark-warning", { diameter, thickness: 0.1, tessellation: 28 }, this.scene);
    marker.position.copyFrom(position);
    marker.position.y = 0.14;
    marker.material = this.enemyThreatMaterial;
    return marker;
  }

  private finishBulwarkAction''',
    '''  private createBossWarning(position: Vector3, attackRadius: number) {
    this.dangerSignal += 1;
    this.queueSound("warning");
    const marker = MeshBuilder.CreateTorus("bulwark-warning", { diameter: Math.max(0.2, attackRadius * 2), thickness: 0.1, tessellation: 28 }, this.scene);
    marker.position.copyFrom(position);
    marker.position.y = 0.14;
    marker.material = this.enemyThreatMaterial;
    return marker;
  }

  private finishBulwarkAction''',
    "boss warning radius",
)
world = replace_once(
    world,
    '''  private playerRingTouchesPoint(point: Vector3, attackRadius = 0) {
    const dx = this.player.position.x - point.x;
    const dz = this.player.position.z - point.z;
    const radius = PLAYER_RING_RADIUS + Math.max(0, attackRadius);
    return dx * dx + dz * dz <= radius * radius;
  }

  private playerRingTouchesTrace''',
    '''  private ringTouchesPointAt(origin: Vector3, point: Vector3, attackRadius = 0) {
    const dx = origin.x - point.x;
    const dz = origin.z - point.z;
    const radius = PLAYER_RING_RADIUS + Math.max(0, attackRadius);
    return dx * dx + dz * dz <= radius * radius;
  }

  private playerRingTouchesPoint(point: Vector3, attackRadius = 0) {
    return this.ringTouchesPointAt(this.player.position, point, attackRadius);
  }

  private playerRingTouchesTrace''',
    "origin-aware ring check",
)
for old, new, label in [
    ('if (enemy.bossAction === "shockwave" && this.playerRingTouchesPoint(enemy.mesh.position, 3.8)) return true;', 'if (enemy.bossAction === "shockwave" && this.ringTouchesPointAt(origin, enemy.mesh.position, 3.8)) return true;', "dodge shockwave origin"),
    ('if (enemy.bossAction === "artillery" && this.playerRingTouchesPoint(enemy.bossTarget, 3.15)) return true;', 'if (enemy.bossAction === "artillery" && this.ringTouchesPointAt(origin, enemy.bossTarget, 3.15)) return true;', "dodge artillery origin"),
    ('if (enemy.bossAction === "barrage" && this.playerRingTouchesPoint(enemy.bossTarget, 1.85)) return true;', 'if (enemy.bossAction === "barrage" && this.ringTouchesPointAt(origin, enemy.bossTarget, 1.85)) return true;', "dodge barrage origin"),
    ('if (this.playerRingTouchesPoint(enemy.mesh.position, pulseRadius)) return true;', 'if (this.ringTouchesPointAt(origin, enemy.mesh.position, pulseRadius)) return true;', "dodge pulse origin"),
]:
    world = replace_once(world, old, new, label)

const_target_functions = "|".join([
    "fireVectorLance", "fireRicochetBurst", "spawnGravityCore", "fireMortarArc",
    "fireSplitShell", "throwReturnBlade", "fireIonLance", "firePrismFan",
    "deploySkyfallMarker", "firePhaseCleaver", "fireNeedleRain", "fireChainHarpoon",
    "fireSonicBreaker", "fireClusterCore",
])
pattern = re.compile(
    rf'''(?P<header>  private (?:{const_target_functions})\([^\n]*\) \{{\n)'''
    r'''    this\.queueAttackSound\(\);\n'''
    r'''(?P<target>    const target = [^\n]+;\n    if \(!target\) return;\n)'''
)
world, moved = pattern.subn(lambda match: match.group("header") + match.group("target") + "    this.queueAttackSound();\n", world)
if moved != 14:
    raise RuntimeError(f"targeted attack sounds: expected 14 moves, found {moved}")
for function_name in ("fireArcLink", "fireThermalArc"):
    pattern = re.compile(
        rf'''(?P<header>  private {function_name}\([^\n]*\) \{{\n)'''
        r'''    this\.queueAttackSound\(\);\n'''
        r'''(?P<body>    const tier = [^\n]+;\n    let target = [^\n]+;\n    if \(!target\) return;\n)'''
    )
    world, moved = pattern.subn(lambda match: match.group("header") + match.group("body") + "    this.queueAttackSound();\n", world)
    if moved != 1:
        raise RuntimeError(f"{function_name} attack sound: expected one move, found {moved}")
write(world_path, world)

# Keep the migration self-contained when upgrading the earlier provisional contract.
migration_path = "supabase/migrations/20260823160000_sabaibu_verified_ranking.sql"
migration = read(migration_path)
migration = replace_once(
    migration,
    "-- Verified ranking sessions for sabaibu Normal and Endless.\n",
    '''-- Verified ranking sessions for sabaibu Normal and Endless.
-- Remove the earlier provisional RPC overloads before exposing the final contract.
drop function if exists public.finish_sabaibu_run(uuid, text, integer, integer, integer, integer, integer, text);
drop function if exists public.start_sabaibu_run(text, text);
drop table if exists private.sabaibu_runs;

''',
    "legacy ranking cleanup",
)
migration = replace_once(
    migration,
    "  v_display_name := btrim(coalesce(p_display_name, ''));",
    "  v_display_name := left(btrim(coalesce(p_display_name, '')), 20);",
    "display name cap",
)
migration = replace_once(
    migration,
    '''create or replace function private.guard_sabaibu_score_runs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.game_slug in ('sabaibu_normal', 'sabaibu_endless')
     and (coalesce(new.metadata ->> 'source', '') <> 'sabaibu_verified'
       or coalesce(new.metadata ->> 'play_token', '') = '') then
    raise exception 'verified sabaibu submission required';
  end if;
  return new;
end;
$$;''',
    '''create or replace function private.guard_sabaibu_score_runs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.game_slug in ('sabaibu_normal', 'sabaibu_endless') then
    if coalesce(new.metadata ->> 'source', '') <> 'sabaibu_verified'
       or coalesce(new.metadata ->> 'play_token', '') = '' then
      raise exception 'verified sabaibu submission required';
    end if;
    if not exists (
      select 1
      from private.sabaibu_run_sessions s
      where s.play_token::text = new.metadata ->> 'play_token'
        and s.status = 'submitted'
        and s.game_slug = new.game_slug
        and s.normalized_name = new.normalized_name
        and s.score = new.score
    ) then
      raise exception 'verified sabaibu session mismatch';
    end if;
  end if;
  return new;
end;
$$;''',
    "score run guard",
)
migration = replace_once(
    migration,
    '''create trigger guard_sabaibu_verified_score_runs
before insert on public.score_runs
for each row execute function private.guard_sabaibu_score_runs();

revoke execute on function public.start_sabaibu_run(text, text, uuid, text) from public;
revoke execute on function public.submit_sabaibu_run(uuid, text, text, integer, integer, integer, integer, integer, integer, text) from public;
grant execute on function public.start_sabaibu_run(text, text, uuid, text) to anon, authenticated;
grant execute on function public.submit_sabaibu_run(uuid, text, text, integer, integer, integer, integer, integer, integer, text) to anon, authenticated;
''',
    '''create trigger guard_sabaibu_verified_score_runs
before insert on public.score_runs
for each row execute function private.guard_sabaibu_score_runs();

create unique index if not exists score_runs_sabaibu_play_token_unique
  on public.score_runs ((metadata ->> 'play_token'))
  where game_slug in ('sabaibu_normal', 'sabaibu_endless')
    and metadata ->> 'play_token' is not null;

update public.games
set submission_mode = 'verified'
where game_slug in ('sabaibu_normal', 'sabaibu_endless');

revoke execute on function public.start_sabaibu_run(text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.submit_sabaibu_run(uuid, text, text, integer, integer, integer, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.start_sabaibu_run(text, text, uuid, text) to anon, authenticated;
grant execute on function public.submit_sabaibu_run(uuid, text, text, integer, integer, integer, integer, integer, integer, text) to anon, authenticated;
''',
    "verified ranking grants and index",
)
write(migration_path, migration)

# Add a regression test for browsers without crypto.randomUUID/getRandomValues.
test_path = "client/src/hooks/useGameRanking.test.ts"
test = read(test_path)
test = replace_once(
    test,
    'import { describe, expect, it } from "vitest";\nimport { canSubmitRankingResult, normalizeRankingName, rankingSlugForMode } from "@/hooks/useGameRanking";',
    'import { afterEach, describe, expect, it, vi } from "vitest";\nimport { canSubmitRankingResult, createClientRunId, normalizeRankingName, rankingSlugForMode } from "@/hooks/useGameRanking";',
    "ranking test imports",
)
test = replace_once(
    test,
    'describe("verified ranking contract", () => {\n',
    '''describe("verified ranking contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a valid one-time id even without Web Crypto", () => {
    vi.stubGlobal("crypto", undefined);
    expect(createClientRunId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

''',
    "UUID fallback test",
)
write(test_path, test)

print("Final hardening patch applied.")
