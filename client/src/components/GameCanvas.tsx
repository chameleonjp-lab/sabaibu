/**
 * Amberline Cataclysm: React is the tactical HUD frame; Babylon owns the 3D battle.
 * The HUD mode follows the live display dimensions so it never assumes one device shape.
 */

import { useEffect, useRef, useState } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { createGameScene, type GameHandle } from "@/game/scene";
import { GAME_ASSETS } from "@/game/assets";
import { MODULE_UPGRADES, type GameSnapshot, type IconId, type ModuleId, type UpgradeId } from "@/game/types";

const INITIAL_SNAPSHOT: GameSnapshot = {
  phase: "playing", health: 100, maxHealth: 100, damageFlash: 0, xp: 0, xpNeeded: 9, level: 1, kills: 0, seconds: 0, weaponTier: 1, weaponCount: 0, weaponLimit: 5, moduleMilestone: false, rerollsRemaining: 3, enemyCount: 0, attacks: [], totalDamage: 0, resultStats: [], upgrades: [],
};

const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const formatStat = (value: number) => new Intl.NumberFormat("ja-JP").format(Math.round(value));
const ModuleIcon = ({ id, className = "" }: { id: IconId; className?: string }) => <span className={`module-icon module-icon-${id} ${className}`} aria-hidden="true" />;
type ViewportMode = "portrait-narrow" | "portrait" | "landscape-compact" | "landscape" | "desktop";

const getViewportMode = (width: number, height: number): ViewportMode => {
  const aspect = width / Math.max(1, height);
  if (aspect < 0.68) return "portrait-narrow";
  if (aspect < 1) return "portrait";
  if (width < 960 && height < 600) return "landscape-compact";
  if (width < 1280) return "landscape";
  return "desktop";
};

export default function GameCanvas() {
  const mainRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startedRef = useRef(false);
  const handleRef = useRef<GameHandle | null>(null);
  const joystickPointerIdRef = useRef<number | null>(null);
  const stickOriginRef = useRef({ x: 0, y: 0 });
  const [snapshot, setSnapshot] = useState<GameSnapshot>(INITIAL_SNAPSHOT);
  const [stickOffset, setStickOffset] = useState({ x: 0, y: 0 });
  const [floatingStick, setFloatingStick] = useState<{ x: number; y: number } | null>(null);
  const [viewportMode, setViewportMode] = useState<ViewportMode>(() => getViewportMode(window.innerWidth, window.innerHeight));
  const demoMode = new URLSearchParams(window.location.search).has("demo");
  const searchParams = new URLSearchParams(window.location.search);
  const rerollPreview = Number(searchParams.get("reroll") ?? (searchParams.has("reroll") ? "1" : "0"));
  const levelPreview = Math.max(0, Math.min(200, Math.floor(Number(searchParams.get("level") ?? "0"))));
  const balancePreviewLevel = Math.max(0, Math.min(200, Math.floor(Number(searchParams.get("balance") ?? "0"))));
  const variantPreviewLevel = Math.max(0, Math.min(200, Math.floor(Number(searchParams.get("variants") ?? "0"))));
  const milestoneBossPreviewLevel = Math.max(0, Math.min(200, Math.floor(Number(searchParams.get("milestoneBoss") ?? "0"))));
  const milestoneRewardPreviewLevel = Math.max(0, Math.min(200, Math.floor(Number(searchParams.get("milestoneReward") ?? "0"))));
  const obstaclePreview = searchParams.has("obstacle");
  const resultPreview = searchParams.has("result");
  const touchPreview = searchParams.has("touch");
  const forceUpgrade = searchParams.has("upgrade") || rerollPreview > 0 || levelPreview > 0;
  const forceModulePreview = new URLSearchParams(window.location.search).has("modules");
  const bossPreview = new URLSearchParams(window.location.search).has("boss");
  const strikerPreview = searchParams.has("striker");
  const idlePreview = searchParams.has("idle");
  const explosionPreview = searchParams.has("explosion");
  const bossExplosionPreview = searchParams.has("bossExplosion");
  const bossExplosionFarPreview = searchParams.has("bossExplosionFar");
  const auditValue = searchParams.get("audit");
  const auditModule = MODULE_UPGRADES.some((option) => option.id === auditValue) ? auditValue as ModuleId : undefined;
  const debugMode = searchParams.has("debug") || Boolean(auditModule) || balancePreviewLevel > 0 || variantPreviewLevel > 0 || milestoneBossPreviewLevel > 0 || milestoneRewardPreviewLevel > 0 || obstaclePreview || resultPreview;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || startedRef.current) return;
    startedRef.current = true;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, adaptToDeviceRatio: true });
    let cancelled = false;
    createGameScene(engine, canvas, { demoMode, forceUpgrade, forceModulePreview, bossPreview, strikerPreview, idlePreview, explosionPreview, bossExplosionPreview, bossExplosionFarPreview, auditModule, debugMode, rerollPreview, levelPreview, balancePreviewLevel, variantPreviewLevel, milestoneBossPreviewLevel, milestoneRewardPreviewLevel, obstaclePreview, resultPreview, onSnapshot: setSnapshot }).then((handle) => {
      if (cancelled) {
        handle.dispose();
        return;
      }
      handleRef.current = handle;
      engine.runRenderLoop(() => handle.scene.render());
    });
    const onResize = () => {
      engine.resize();
      const width = mainRef.current?.clientWidth ?? window.innerWidth;
      const height = mainRef.current?.clientHeight ?? window.innerHeight;
      const nextMode = getViewportMode(width, height);
      setViewportMode((currentMode) => currentMode === nextMode ? currentMode : nextMode);
    };
    const resizeObserver = new ResizeObserver(onResize);
    if (mainRef.current) resizeObserver.observe(mainRef.current);
    window.visualViewport?.addEventListener("resize", onResize);
    window.addEventListener("resize", onResize);
    onResize();
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", onResize);
      window.removeEventListener("resize", onResize);
      handleRef.current?.dispose();
      handleRef.current = null;
      engine.dispose();
      startedRef.current = false;
    };
  }, [demoMode, forceUpgrade, forceModulePreview, bossPreview, strikerPreview, idlePreview, explosionPreview, bossExplosionPreview, bossExplosionFarPreview, auditModule, debugMode, rerollPreview, levelPreview, balancePreviewLevel, variantPreviewLevel, milestoneBossPreviewLevel, milestoneRewardPreviewLevel, obstaclePreview, resultPreview]);

  const setDirection = (x: number, z: number) => handleRef.current?.setTouchDirection(x, z);
  useEffect(() => {
    if (!touchPreview) return;
    setFloatingStick({ x: window.innerWidth * 0.68, y: window.innerHeight * 0.62 });
  }, [touchPreview]);
  const updateJoystick = (clientX: number, clientY: number) => {
    const bounds = mainRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const range = 42;
    const rawX = clientX - bounds.left - stickOriginRef.current.x;
    const rawY = clientY - bounds.top - stickOriginRef.current.y;
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > range ? range / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    setStickOffset({ x, y });
    setDirection(x / range, -y / range);
  };
  const beginJoystick = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.pointerType !== "touch" && event.pointerType !== "pen") || snapshot.phase !== "playing") return;
    const bounds = mainRef.current?.getBoundingClientRect();
    if (!bounds) return;
    joystickPointerIdRef.current = event.pointerId;
    stickOriginRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    setFloatingStick(stickOriginRef.current);
    setStickOffset({ x: 0, y: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
    updateJoystick(event.clientX, event.clientY);
  };
  const moveJoystick = (event: React.PointerEvent<HTMLElement>) => {
    if (joystickPointerIdRef.current === event.pointerId) updateJoystick(event.clientX, event.clientY);
  };
  const endJoystick = (event: React.PointerEvent<HTMLElement>) => {
    if (joystickPointerIdRef.current !== event.pointerId) return;
    joystickPointerIdRef.current = null;
    setStickOffset({ x: 0, y: 0 });
    setFloatingStick(null);
    setDirection(0, 0);
  };
  const selectUpgrade = (id: UpgradeId) => handleRef.current?.chooseUpgrade(id);
  const rerollUpgrades = () => handleRef.current?.rerollUpgrades();
  const healthPercent = (snapshot.health / snapshot.maxHealth) * 100;
  const xpPercent = (snapshot.xp / snapshot.xpNeeded) * 100;

  return (
    <main ref={mainRef} className={`game-shell viewport-${viewportMode}`} aria-label="Neon Siege Survivor">
      <canvas ref={canvasRef} className="game-canvas" style={{ touchAction: "none" }} />
      <div className="containment-floor-overlay" aria-hidden="true" />
      <img src={GAME_ASSETS.sigil} className="combat-sigil" alt="" aria-hidden="true" />
      <div className="threat-perimeter" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="safety-frame" aria-hidden="true"><span className="frame-code frame-code-a">LIVE GRID // 07-A</span><span className="frame-code frame-code-b">HOLD THE LINE</span></div>
      <div className="tactical-vignette" aria-hidden="true" />
      <section className="hud-layer" aria-live="polite">
        <header className="mission-bar">
          <div className="brand-lockup">
            <img src={GAME_ASSETS.sigil} className="brand-sigil" alt="" />
            <div><p className="eyebrow">CONTAINMENT // SECTOR 07</p><h1>NEON SIEGE<span>:</span> SURVIVOR</h1></div>
          </div>
          <div className="timer-panel"><span className="timer-label">SURVIVAL CLOCK</span><strong>{formatTime(snapshot.seconds)}</strong>{demoMode && <em>DEMO LINK ACTIVE</em>}</div>
          <div className="kills-panel"><span>HOSTILES PURGED</span><strong>{String(snapshot.kills).padStart(3, "0")}</strong><small>{snapshot.enemyCount} SIGNALS IN RANGE</small></div>
        </header>

        <aside className={`health-unit ${snapshot.damageFlash > 0 ? "damage-alert" : ""}`}>
          <div className="unit-header"><span>VITAL ARMOR</span><strong>{Math.ceil(snapshot.health)}<i>/{snapshot.maxHealth}</i></strong></div>
          <div className="meter health-meter"><i style={{ width: `${healthPercent}%` }} /></div>
          <p>OPERATOR // ALPHA-13</p>
        </aside>
        {snapshot.debugStatus && <aside className="combat-debug-panel">{snapshot.debugStatus}</aside>}

        <div className="xp-unit"><div className="xp-readout"><span>REACTOR SYNC // LV.{String(snapshot.level).padStart(2, "0")}</span><b>{snapshot.xp} / {snapshot.xpNeeded}</b></div><div className="meter xp-meter"><i style={{ width: `${xpPercent}%` }} /></div></div>

        <footer className="loadout-rail" role="region" tabIndex={0} aria-label="装備レール。左右へスワイプして全ての武器とモジュールを確認">
          <div className="loadout-mark">WPN<br/><strong>{String(snapshot.attacks.filter((attack) => attack.active).length).padStart(2, "0")}</strong></div>
          {snapshot.attacks.map((attack) => <div key={attack.id} className={`weapon-card ${attack.active ? "active" : "muted"}`}><ModuleIcon id={attack.iconId} className="weapon-glyph"/><div><b>{attack.label}</b><small>{attack.active ? `LV.${String(attack.tier).padStart(2, "0")} // ${attack.detail}` : attack.detail}</small></div></div>)}
          <div className="instruction"><kbd>W A S D</kbd><span>HOLD PERIMETER</span></div>
        </footer>

        {snapshot.phase === "playing" && <div className="floating-control-surface" aria-label="任意位置タップ移動エリア" onPointerDown={beginJoystick} onPointerMove={moveJoystick} onPointerUp={endJoystick} onPointerCancel={endJoystick} onLostPointerCapture={endJoystick} />}
        {floatingStick && <nav className="touch-drive touch-drive-floating" aria-label="移動用フローティングスティック" style={{ left: floatingStick.x, top: floatingStick.y }}>
          <span className="joystick-rings" aria-hidden="true" />
          <span className="joystick-knob" aria-hidden="true" style={{ transform: `translate(calc(-50% + ${stickOffset.x}px), calc(-50% + ${stickOffset.y}px))` }}><i /></span>
          <small>VECTOR<br/>DRIVE</small>
        </nav>}
        <aside className="mobile-fire-status" aria-hidden="true"><span>WPN</span><b>AUTO<br/>FIRE</b><i /></aside>

        {snapshot.phase === "upgrade" && <div className="modal-layer"><section className="upgrade-console"><p className="modal-eyebrow">{snapshot.moduleMilestone ? "MODULE BAY EXPANDED" : "SIGNAL OVERRIDE ACCEPTED"}</p><h2>SELECT A FIELD<br/><em>MODIFICATION.</em></h2><p className="modal-copy">{snapshot.moduleMilestone ? "7Lv周期の新規攻撃モジュール候補です。ひとつだけ導入してください。" : "既存装備の強化候補から、ひとつだけ承認してください。"} 追加武器枠 {snapshot.weaponCount}/{snapshot.weaponLimit}。</p><div className="upgrade-actions"><button className="reroll-button" onClick={rerollUpgrades} disabled={snapshot.rerollsRemaining <= 0}>REROLL <span>{snapshot.rerollsRemaining}/3</span></button><small>候補を再抽選</small></div><div className="upgrade-grid">{snapshot.upgrades.map((upgrade, index) => <button key={upgrade.id} className="upgrade-card" onClick={() => selectUpgrade(upgrade.id)}><span className="choice-number">0{index + 1}</span><ModuleIcon id={upgrade.iconId} className="upgrade-symbol"/><span className="upgrade-code">{upgrade.code}</span><strong>{upgrade.title}</strong><small>{upgrade.description}</small><i>INSTALL</i></button>)}</div></section></div>}
        {snapshot.phase === "gameover" && <div className="modal-layer"><section className="failure-console result-console"><p className="modal-eyebrow danger">CONTAINMENT BREACH // AFTER ACTION REPORT</p><h2>SIGNAL<br/><em>LOST.</em></h2><div className="result-summary"><span><small>SURVIVAL TIME</small><b>{formatTime(snapshot.seconds)}</b></span><span><small>HOSTILES PURGED</small><b>{formatStat(snapshot.kills)}</b></span><span><small>TOTAL DAMAGE</small><b>{formatStat(snapshot.totalDamage)}</b></span><span><small>FINAL LEVEL</small><b>LV.{String(snapshot.level).padStart(2, "0")}</b></span></div><section className="result-breakdown" aria-label="武器別戦闘統計"><header><span>WEAPON TELEMETRY</span><small>DAMAGE / KILLS</small></header><div className="result-stat-list">{snapshot.resultStats.map((stat, index) => <div className="result-stat-row" key={stat.id}><span className="result-rank">{String(index + 1).padStart(2, "0")}</span><ModuleIcon id={stat.iconId} className="result-stat-icon"/><strong>{stat.label}<small>LV.{String(stat.tier).padStart(2, "0")}</small></strong><b>{formatStat(stat.damage)}<small>DMG</small></b><i>{formatStat(stat.kills)}<small>KILLS</small></i></div>)}</div></section><p>封鎖線は崩壊しました。記録された戦闘テレメトリーを再確認し、次の出撃に備えてください。</p><button onClick={() => handleRef.current?.restart()}>RE-ENTER THE SIEGE <span>GO</span></button></section></div>}
      </section>
    </main>
  );
}
