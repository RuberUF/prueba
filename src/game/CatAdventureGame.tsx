import {
  ArrowUp,
  Hand,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  Wind,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ANIMATION_TOTAL_DURATION, renderJumpingCatFrame } from '../utils/jumpingCatAnimation';
import { stepEnemiesAI } from './ai';
import { gameAudio } from './audio';
import { type Cat3DOverlayController, createCat3DOverlay } from './cat3dOverlay';
import { GROUND_Y, LEVELS, LOGICAL_HEIGHT } from './levels';
import {
  EPILOGUE_REJECTION_DURATION,
  PROLOGUE_DURATION,
  renderEpilogueRejectionFrame,
  renderGameplayFrame,
  renderPrologueFrame,
  renderTitleBackdrop,
  renderTransitionFrame,
  resolveActiveStyle,
} from './renderers';
import type {
  ActivePickupState,
  ActivePlatformState,
  ActivePuzzleGate,
  ActiveSecretZone,
  ActiveWorldObject,
  CatAnimState,
  CatEmotion,
  EnemyState,
  FloatingTextState,
  GameInputState,
  GamePhase,
  LevelConfig,
  ParticleState,
  PlayerState,
  ProjectileState,
  QualityTier,
} from './types';

interface HudSnapshot {
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  hunger: number;
  maxHunger: number;
  chapterNumeral: string;
  whisper: string | null;
  bossHpPct: number | null;
  bossName: string;
  exhausted: boolean;
}

const INSANE_MULT = 2.3;
const TRANSITION_DURATION = 1.85;

function detectInitialTouchMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.matchMedia('(pointer: coarse)').matches ||
      'ontouchstart' in window ||
      (navigator.maxTouchPoints ?? 0) > 0
    );
  } catch {
    return false;
  }
}

function detectInitialQuality(): QualityTier {
  if (typeof navigator === 'undefined') return 'high';
  const cores = navigator.hardwareConcurrency ?? 8;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return mobile || cores <= 4 ? 'medium' : 'high';
}

function createInitialPlayer(score = 0, secretsFound = 0): PlayerState {
  return {
    x: 80,
    y: GROUND_Y,
    vx: 0,
    vy: 0,
    w: 36,
    h: 38,
    facing: 1,
    grounded: true,
    onIce: false,
    inWater: false,
    inSwamp: false,
    climbing: false,
    climbSurfaceX: null,
    crouching: false,
    crawling: false,
    sprinting: false,
    inStealthCover: false,
    blocking: false,
    parryWindow: 0,
    counterReadyTimer: 0,
    crouchCharge: 0,
    chargeAttackTimer: 0,
    isChargingAttack: false,
    meowTimer: 0,
    meowCooldown: 0,
    coyoteTimer: 0,
    jumpBuffer: 0,
    jumpsLeft: 2,
    hp: 100,
    maxHp: 100,
    stamina: 100,
    maxStamina: 100,
    hunger: 100,
    maxHunger: 100,
    invulnTimer: 0,
    attackTimer: 0,
    attackCooldown: 0,
    punchTimer: 0,
    comboStep: 0,
    pounceTimer: 0,
    dashTimer: 0,
    dashCooldown: 0,
    hurtTimer: 0,
    landingTimer: 0,
    deathTimer: 0,
    victoryTimer: 0,
    animTime: 0,
    strideAccum: 0,
    animState: 'idle',
    emotion: 'calm',
    noiseLevel: 0.1,
    trail: [],
    comboHits: 0,
    comboResetTimer: 0,
    punchChain: 0,
    feverTimer: 0,
    wallKickCooldown: 0,
    ghostDecoy: null,
    score,
    secretsFound,
    beaconsActivated: 0,
    sideQuestComplete: false,
    lastSafeX: 80,
    lastSafeY: GROUND_Y,
  };
}

function spawnPlatformsForLevel(level: LevelConfig): ActivePlatformState[] {
  return level.platforms.map((pl, idx) => ({
    ...pl,
    id: idx + 1,
    curX: pl.x,
    curY: pl.y,
    dx: 0,
    dy: 0,
    crumbleTimer: 0,
    brokenTimer: 0,
  }));
}

function spawnPuzzlesForLevel(level: LevelConfig): ActivePuzzleGate[] {
  return level.puzzles.map((pz) => ({
    ...pz,
    solved: false,
    openProgress: 0,
  }));
}

function spawnSecretForLevel(level: LevelConfig): ActiveSecretZone {
  return {
    ...level.secretZone,
    collected: false,
  };
}

function spawnEnemiesForLevel(level: LevelConfig): EnemyState[] {
  const diffScale = (level.difficultyScale ?? 1) * INSANE_MULT;
  return level.enemies.map((sp, idx) => {
    const isAlpha = sp.kind === 'alpha_guardian';
    const isCapt = sp.kind === 'siege_captain';
    const isBoss = isAlpha || isCapt;
    const isKnight = sp.kind === 'iron_knight';
    const isArmored = sp.kind === 'armored_hound' || isKnight;
    const isArcher = sp.kind === 'bolt_archer';
    const isDrone = sp.kind === 'drone_sentinel';
    const isLeaper = sp.kind === 'hound_leaper' || sp.kind === 'wolf_pack';
    const isPuppy = sp.kind === 'crayon_pup';

    const baseHp = isAlpha
      ? 460
      : isCapt
      ? 230
      : isKnight
      ? 145
      : isArmored
      ? 122
      : isLeaper
      ? 88
      : isDrone
      ? 72
      : isArcher
      ? 60
      : isPuppy
      ? 58
      : 78;
    const maxHp = Math.round(baseHp * Math.sqrt(diffScale));
    const spawnY = GROUND_Y - (sp.y ?? (isDrone ? 160 : 0));

    let armor = 0;
    if (isAlpha) armor = 3;
    else if (isCapt || isKnight) armor = 2;
    else if (sp.kind === 'armored_hound') armor = level.id >= 6 ? 2 : 1;

    const role =
      sp.role ??
      (isBoss
        ? 'boss'
        : isArcher || isDrone
        ? 'ranged'
        : sp.ambush
        ? 'ambusher'
        : isLeaper
        ? 'flanker'
        : isArmored
        ? 'protector'
        : 'vanguard');

    return {
      id: idx + 1,
      kind: sp.kind,
      role,
      x: sp.x,
      y: spawnY,
      vx: 0,
      vy: 0,
      w: isAlpha ? 76 : isCapt ? 58 : isDrone ? 46 : 44,
      h: isAlpha ? 62 : isCapt ? 54 : isDrone ? 34 : 38,
      facing: -1,
      hp: maxHp,
      maxHp,
      armor,
      shieldUp: armor > 0,
      homeX: sp.x,
      baseY: spawnY,
      patrolRadius: sp.patrolRadius ?? 105,
      state: sp.ambush ? 'ambush_hide' : 'patrol',
      stateTimer: 0,
      attackCooldown: Math.max(0.28, 0.72 / Math.sqrt(diffScale)) + (idx % 3) * 0.16,
      animPhase: idx * 0.8,
      grounded: !isDrone,
      hitFlash: 0,
      poiseHits: 0,
      alertLevel: 0,
      visionRange: isBoss ? 560 : isDrone || isArcher ? 480 : 350,
      hearingRange: isBoss ? 440 : 280,
      lastHeardX: null,
      bossPhase: 1,
      hasRetreated: false,
      ambushHidden: Boolean(sp.ambush),
      specialCooldown: 1.4,
    };
  });
}

function spawnPickupsForLevel(level: LevelConfig): ActivePickupState[] {
  return level.pickups.map((p, idx) => ({
    ...p,
    id: idx + 1,
    collected: false,
    bobPhase: idx * 1.3,
  }));
}

function spawnWorldObjectsForLevel(level: LevelConfig): ActiveWorldObject[] {
  return level.worldObjects.map((w, idx) => ({
    ...w,
    id: idx + 1,
    activated: false,
    hp: w.kind === 'supply_crate' ? 1 : 99,
    pulsePhase: idx * 1.1,
  }));
}

export default function CatAdventureGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const webglMountRef = useRef<HTMLDivElement | null>(null);
  const cat3DOverlayRef = useRef<Cat3DOverlayController | null>(null);
  const joyKnobRef = useRef<HTMLDivElement | null>(null);

  const [phase, setPhase] = useState<GamePhase>('TITLE_MENU');
  const phaseRef = useRef<GamePhase>('TITLE_MENU');

  const [currentLevelIdx, setCurrentLevelIdx] = useState(0);
  const [muted, setMuted] = useState(false);
  const [isTouchMode, setIsTouchMode] = useState<boolean>(detectInitialTouchMode);
  const qualityRef = useRef<QualityTier>(detectInitialQuality());

  const [hud, setHud] = useState<HudSnapshot>({
    hp: 100,
    maxHp: 100,
    stamina: 100,
    maxStamina: 100,
    hunger: 100,
    maxHunger: 100,
    chapterNumeral: LEVELS[0].title,
    whisper: null,
    bossHpPct: null,
    bossName: 'Alfa',
    exhausted: false,
  });

  const levelIdxRef = useRef(0);
  const playerRef = useRef<PlayerState>(createInitialPlayer(0, 0));
  const platformsRef = useRef<ActivePlatformState[]>(spawnPlatformsForLevel(LEVELS[0]));
  const puzzlesRef = useRef<ActivePuzzleGate[]>(spawnPuzzlesForLevel(LEVELS[0]));
  const secretRef = useRef<ActiveSecretZone>(spawnSecretForLevel(LEVELS[0]));
  const enemiesRef = useRef<EnemyState[]>(spawnEnemiesForLevel(LEVELS[0]));
  const projectilesRef = useRef<ProjectileState[]>([]);
  const particlesRef = useRef<ParticleState[]>([]);
  const pickupsRef = useRef<ActivePickupState[]>(spawnPickupsForLevel(LEVELS[0]));
  const worldObjectsRef = useRef<ActiveWorldObject[]>(spawnWorldObjectsForLevel(LEVELS[0]));
  const triggeredStoriesRef = useRef<Set<number>>(new Set());
  const trapFireCyclesRef = useRef<Map<number, number>>(new Map());
  const activeWhisperRef = useRef<{ text: string; timer: number } | null>(null);
  const floatingTextsRef = useRef<FloatingTextState[]>([]);

  const camXRef = useRef(0);
  const shakeTimerRef = useRef(0);
  const hitStopRef = useRef(0);
  const timeSlowTimerRef = useRef(0);
  const zarpazoFinalRef = useRef(false);
  const hitFlashRef = useRef(0);
  const elapsedRef = useRef(0);
  const rejectionWaveTimerRef = useRef(3.2);
  const cutsceneTimeRef = useRef(0);
  const transitionTimerRef = useRef(0);
  const transitionTargetIdxRef = useRef(0);
  const ending2DTimeRef = useRef(18.6);
  const nextProjIdRef = useRef(1);
  const lastSplashTimeRef = useRef(-10);
  const lastStepTimeRef = useRef(-10);
  const epilogueChordStepRef = useRef(-1);
  const joyPointerIdRef = useRef<number | null>(null);

  const inputRef = useRef<GameInputState>({
    moveX: 0,
    moveY: 0,
    left: false,
    right: false,
    upHeld: false,
    crouchHeld: false,
    sprintHeld: false,
    blockHeld: false,
    blockPressed: false,
    jumpHeld: false,
    jumpPressed: false,
    attackPressed: false,
    punchPressed: false,
    dashPressed: false,
    heavyHeld: false,
    heavyReleased: false,
    pouncePressed: false,
    meowPressed: false,
  });

  const setGamePhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const loadLevel = useCallback((idx: number, preserveCampaign = false) => {
    const clampedIdx = Math.max(0, Math.min(LEVELS.length - 1, idx));
    const lvl = LEVELS[clampedIdx];
    levelIdxRef.current = clampedIdx;
    setCurrentLevelIdx(clampedIdx);

    const prevScore = preserveCampaign ? playerRef.current.score : 0;
    const prevSecrets = preserveCampaign ? playerRef.current.secretsFound : 0;
    playerRef.current = createInitialPlayer(prevScore, prevSecrets);
    platformsRef.current = spawnPlatformsForLevel(lvl);
    puzzlesRef.current = spawnPuzzlesForLevel(lvl);
    secretRef.current = spawnSecretForLevel(lvl);
    enemiesRef.current = spawnEnemiesForLevel(lvl);
    pickupsRef.current = spawnPickupsForLevel(lvl);
    worldObjectsRef.current = spawnWorldObjectsForLevel(lvl);
    projectilesRef.current = [];
    particlesRef.current = [];
    floatingTextsRef.current = [];
    triggeredStoriesRef.current = new Set();
    trapFireCyclesRef.current = new Map();
    activeWhisperRef.current = lvl.introLine ? { text: lvl.introLine, timer: 2.8 } : null;

    camXRef.current = 0;
    shakeTimerRef.current = 0;
    hitStopRef.current = 0;
    timeSlowTimerRef.current = 0;
    zarpazoFinalRef.current = false;
    hitFlashRef.current = 0;
    rejectionWaveTimerRef.current = lvl.rejectionWaveInterval ?? 4.2;

    const boss = enemiesRef.current.find(
      (e) => e.kind === 'alpha_guardian' || e.kind === 'siege_captain'
    );

    setHud({
      hp: 100,
      maxHp: 100,
      stamina: 100,
      maxStamina: 100,
      hunger: 100,
      maxHunger: 100,
      chapterNumeral: lvl.title,
      whisper: lvl.introLine || null,
      bossHpPct: boss ? 100 : null,
      bossName: boss?.kind === 'siege_captain' ? 'Capitán' : 'Alfa',
      exhausted: false,
    });
  }, []);

  const beginTransitionToLevel = useCallback(
    (idx: number, preserveCampaign: boolean) => {
      loadLevel(idx, preserveCampaign);
      transitionTargetIdxRef.current = idx;
      transitionTimerRef.current = TRANSITION_DURATION;
      setGamePhase('TRANSITION');
    },
    [loadLevel, setGamePhase]
  );

  const startAdventure = useCallback(() => {
    gameAudio.unlock();
    loadLevel(0, false);
    cutsceneTimeRef.current = 0;
    setGamePhase('PROLOGUE');
  }, [loadLevel, setGamePhase]);

  // Dynamically detect touch interaction (shows mobile overlay automatically on touch devices)
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        setIsTouchMode(true);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  // Lazy-initialize Three.js 3D Cat WebGL Overlay only when current level uses 3D or Epilogue 3D runs
  const currentUses3D = Boolean(LEVELS[currentLevelIdx]?.use3DCat);
  useEffect(() => {
    const needs3D = currentUses3D || phase === 'EPILOGUE_REJECTION';
    if (!needs3D || cat3DOverlayRef.current) return;
    const mount = webglMountRef.current;
    if (!mount) return;
    try {
      const controller = createCat3DOverlay(mount);
      controller.setQualityTier(qualityRef.current);
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect && rect.width > 1 && rect.height > 1) {
        controller.resize(Math.round(rect.width), Math.round(rect.height));
      }
      cat3DOverlayRef.current = controller;
    } catch (err) {
      console.warn('WebGL 3D cat overlay fallback to 2D:', err);
      cat3DOverlayRef.current = null;
    }
  }, [currentUses3D, phase]);

  useEffect(() => {
    return () => {
      cat3DOverlayRef.current?.dispose();
      cat3DOverlayRef.current = null;
    };
  }, []);

  // Keyboard Listeners (PC & Laptop Full Action Bindings)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(code)) {
        e.preventDefault();
      }
      gameAudio.unlock();

      if (code === 'Escape' || code === 'KeyP') {
        if (phaseRef.current === 'PLAYING') setGamePhase('PAUSED');
        else if (phaseRef.current === 'PAUSED') setGamePhase('PLAYING');
        return;
      }

      if (code === 'KeyA' || code === 'ArrowLeft') inputRef.current.left = true;
      if (code === 'KeyD' || code === 'ArrowRight') inputRef.current.right = true;
      if (code === 'KeyW' || code === 'ArrowUp') inputRef.current.upHeld = true;
      if (code === 'KeyS' || code === 'ArrowDown') inputRef.current.crouchHeld = true;
      if (code === 'ShiftLeft' || code === 'ShiftRight') inputRef.current.sprintHeld = true;

      if (code === 'Space') {
        if (!inputRef.current.jumpHeld) inputRef.current.jumpPressed = true;
        inputRef.current.jumpHeld = true;
      } else if (code === 'KeyW' || code === 'ArrowUp') {
        if (!playerRef.current.climbing && !inputRef.current.jumpHeld) {
          inputRef.current.jumpPressed = true;
        }
        inputRef.current.jumpHeld = true;
      }

      if (code === 'KeyJ' || code === 'KeyZ') inputRef.current.attackPressed = true;
      if (code === 'KeyU' || code === 'KeyC') inputRef.current.punchPressed = true;
      if (code === 'KeyK') inputRef.current.dashPressed = true;
      if (code === 'KeyL' || code === 'KeyX') {
        if (!inputRef.current.heavyHeld) {
          inputRef.current.pouncePressed = true;
        }
        inputRef.current.heavyHeld = true;
      }
      if (code === 'KeyF' || code === 'KeyB') {
        if (!inputRef.current.blockHeld) inputRef.current.blockPressed = true;
        inputRef.current.blockHeld = true;
      }
      if (code === 'KeyE' || code === 'KeyQ') inputRef.current.meowPressed = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const code = e.code;
      if (code === 'KeyA' || code === 'ArrowLeft') inputRef.current.left = false;
      if (code === 'KeyD' || code === 'ArrowRight') inputRef.current.right = false;
      if (code === 'KeyW' || code === 'ArrowUp') {
        inputRef.current.upHeld = false;
        inputRef.current.jumpHeld = false;
      }
      if (code === 'KeyS' || code === 'ArrowDown') inputRef.current.crouchHeld = false;
      if (code === 'ShiftLeft' || code === 'ShiftRight') inputRef.current.sprintHeld = false;
      if (code === 'Space') inputRef.current.jumpHeld = false;
      if (code === 'KeyL' || code === 'KeyX') {
        if (inputRef.current.heavyHeld) inputRef.current.heavyReleased = true;
        inputRef.current.heavyHeld = false;
      }
      if (code === 'KeyF' || code === 'KeyB') {
        inputRef.current.blockHeld = false;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [setGamePhase]);

  // Main Simulation & Adaptive-Quality Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let viewW = 0;
    let viewH = 0;

    const getMaxDprForQuality = (q: QualityTier) =>
      q === 'low' ? 1.0 : q === 'medium' ? 1.25 : 1.75;

    let dpr = Math.min(window.devicePixelRatio || 1, getMaxDprForQuality(qualityRef.current));

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, getMaxDprForQuality(qualityRef.current));
      const rect = canvas.getBoundingClientRect();
      const nextW = Math.round(rect.width > 1 ? rect.width : window.innerWidth);
      const nextH = Math.round(rect.height > 1 ? rect.height : window.innerHeight);
      if (nextW < 2 || nextH < 2) return;
      viewW = nextW;
      viewH = nextH;
      const targetBufW = Math.floor(viewW * dpr);
      const targetBufH = Math.floor(viewH * dpr);
      if (canvas.width !== targetBufW || canvas.height !== targetBufH) {
        canvas.width = targetBufW;
        canvas.height = targetBufH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cat3DOverlayRef.current?.resize(viewW, viewH);
    };
    resize();
    window.addEventListener('resize', resize);
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
    resizeObserver?.observe(canvas);

    let disposed = false;
    let rafId = 0;
    let lastNow = performance.now();
    let hudSyncTimer = 0;
    let avgDt = 1 / 60;
    let lowFpsTime = 0;
    let highFpsTime = 0;

    const onVisibilityChange = () => {
      if (!document.hidden) {
        lastNow = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const addParticles = (
      x: number,
      y: number,
      count: number,
      color: string,
      kind: ParticleState['kind'],
      speed = 160
    ) => {
      const q = qualityRef.current;
      const cap = q === 'low' ? 22 : q === 'medium' ? 50 : 95;
      const scaledCount = Math.max(1, Math.round(count * (q === 'low' ? 0.35 : q === 'medium' ? 0.65 : 1)));
      if (particlesRef.current.length > cap) {
        particlesRef.current.splice(0, particlesRef.current.length - Math.max(8, cap - 12));
      }
      for (let i = 0; i < scaledCount; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = speed * (0.35 + Math.random() * 0.75);
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 45,
          size: 2.4 + Math.random() * 3.2,
          life: 0.34 + Math.random() * 0.32,
          maxLife: 0.66,
          color,
          kind,
        });
      }
    };

    const addFloatingText = (x: number, y: number, text: string, color: string, scale = 1) => {
      if (floatingTextsRef.current.length > 8) {
        floatingTextsRef.current.shift();
      }
      floatingTextsRef.current.push({
        x,
        y,
        vy: -48,
        text,
        color,
        life: 0.62,
        maxLife: 0.62,
        scale,
      });
    };

    const damagePlayer = (
      amount: number,
      knockX: number,
      blockedFront = false
    ) => {
      const p = playerRef.current;
      if (p.invulnTimer > 0 || p.dashTimer > 0 || p.deathTimer > 0) return;

      // Timed Parry Window
      if (p.blocking && blockedFront && p.parryWindow > 0) {
        p.counterReadyTimer = 1.45;
        p.invulnTimer = 0.28;
        p.stamina = Math.min(p.maxStamina, p.stamina + 18);
        gameAudio.playParrySuccess();
        hitStopRef.current = 0.05;
        addParticles(p.x + p.facing * 20, p.y - 24, 10, '#fde047', 'spark', 210);
        addFloatingText(p.x, p.y - 50, 'Parry', '#fde047', 1.1);
        for (const en of enemiesRef.current) {
          if (en.state !== 'dead' && Math.abs(en.x - p.x) < 125) {
            en.state = 'stunned';
            en.stateTimer = en.kind === 'alpha_guardian' ? 0.65 : 1.05;
            en.shieldUp = false;
            en.vx = -Math.sign(p.x - en.x || 1) * 140;
          }
        }
        return;
      }

      // Standard Guard Block
      if (p.blocking && blockedFront && p.stamina >= 18) {
        p.stamina = Math.max(0, p.stamina - 22);
        const chip = Math.max(4, Math.round(amount * 0.36));
        p.hp = Math.max(0, p.hp - chip);
        p.invulnTimer = 0.28;
        p.vx = knockX * 0.55;
        gameAudio.playArmorClang();
        addParticles(p.x + p.facing * 18, p.y - 22, 6, '#38bdf8', 'spark', 140);
        addFloatingText(p.x, p.y - 44, `-${chip}`, '#7dd3fc', 0.9);
        if (p.hp <= 0) {
          p.deathTimer = 0.95;
          p.animState = 'death';
        }
        return;
      }

      p.hp = Math.max(0, p.hp - amount);
      p.invulnTimer = 0.46;
      p.hurtTimer = 0.34;
      p.climbing = false;
      p.vx = knockX;
      p.vy = -240;
      p.comboHits = 0;
      shakeTimerRef.current = 0.24;
      hitFlashRef.current = 0.16;
      gameAudio.playHit(true);
      addParticles(p.x, p.y - 20, 10, '#ef4444', 'blood_ink', 200);
      addFloatingText(p.x, p.y - 44, `-${Math.round(amount)}`, '#fca5a5', 1.05);

      if (p.hp <= 0) {
        p.deathTimer = 0.95;
        p.animState = 'death';
        p.emotion = 'pain';
      }
    };

    const stepSimulation = (dt: number) => {
      const level = LEVELS[levelIdxRef.current];
      const diffScale = (level.difficultyScale ?? 1) * INSANE_MULT;
      const dmgMult = INSANE_MULT * (1 + levelIdxRef.current * 0.08);
      const p = playerRef.current;
      const inp = inputRef.current;

      if (timeSlowTimerRef.current > 0) {
        timeSlowTimerRef.current = Math.max(0, timeSlowTimerRef.current - dt);
      }
      const worldDt = timeSlowTimerRef.current > 0 ? dt * 0.34 : dt;

      elapsedRef.current += worldDt;
      p.animTime += dt;

      if (hitFlashRef.current > 0) hitFlashRef.current = Math.max(0, hitFlashRef.current - dt);
      if (shakeTimerRef.current > 0) shakeTimerRef.current = Math.max(0, shakeTimerRef.current - dt);

      if (hitStopRef.current > 0) {
        hitStopRef.current = Math.max(0, hitStopRef.current - dt);
        return;
      }

      // Death / Victory playback windows
      if (p.deathTimer > 0) {
        p.deathTimer = Math.max(0, p.deathTimer - dt);
        p.animState = 'death';
        p.emotion = 'pain';
        p.vx *= 0.88;
        p.vy += 1200 * dt;
        p.y = Math.min(GROUND_Y, p.y + p.vy * dt);
        if (p.deathTimer <= 0) {
          setGamePhase('GAME_OVER');
        }
        return;
      }

      if (p.victoryTimer > 0) {
        p.victoryTimer = Math.max(0, p.victoryTimer - dt);
        p.animState = 'victory';
        p.emotion = 'calm';
        p.vx *= 0.85;
        if (p.victoryTimer <= 0) {
          if (level.id === LEVELS.length) {
            cutsceneTimeRef.current = 0;
            epilogueChordStepRef.current = -1;
            setGamePhase('EPILOGUE_REJECTION');
          } else {
            gameAudio.playBeaconChime();
            const nextIdx = levelIdxRef.current + 1;
            beginTransitionToLevel(nextIdx, true);
          }
        }
        return;
      }

      // Decrement timers
      p.invulnTimer = Math.max(0, p.invulnTimer - dt);
      p.hurtTimer = Math.max(0, p.hurtTimer - dt);
      p.landingTimer = Math.max(0, p.landingTimer - dt);
      p.attackTimer = Math.max(0, p.attackTimer - dt);
      p.attackCooldown = Math.max(0, p.attackCooldown - dt);
      p.punchTimer = Math.max(0, p.punchTimer - dt);
      p.dashTimer = Math.max(0, p.dashTimer - dt);
      p.dashCooldown = Math.max(0, p.dashCooldown - dt);
      p.pounceTimer = Math.max(0, p.pounceTimer - dt);
      p.meowTimer = Math.max(0, p.meowTimer - dt);
      p.meowCooldown = Math.max(0, p.meowCooldown - dt);
      p.parryWindow = Math.max(0, p.parryWindow - dt);
      p.counterReadyTimer = Math.max(0, p.counterReadyTimer - dt);
      p.feverTimer = Math.max(0, p.feverTimer - dt);
      p.wallKickCooldown = Math.max(0, p.wallKickCooldown - dt);
      if (p.attackTimer <= 0.08) {
        zarpazoFinalRef.current = false;
      }
      if (p.ghostDecoy) {
        p.ghostDecoy.life -= dt;
        if (p.ghostDecoy.life <= 0) p.ghostDecoy = null;
      }

      if (p.comboResetTimer > 0) {
        p.comboResetTimer -= dt;
        if (p.comboResetTimer <= 0) {
          p.comboHits = 0;
          p.punchChain = 0;
        }
      }

      // Moving & Crumbling Platforms
      for (const plat of platformsRef.current) {
        const oldX = plat.curX;
        const oldY = plat.curY;
        if (plat.moveAxis && plat.moveRange && plat.moveSpeed) {
          const offset = Math.sin(elapsedRef.current * plat.moveSpeed + plat.id) * plat.moveRange;
          if (plat.moveAxis === 'x') plat.curX = plat.x + offset;
          else plat.curY = plat.y + offset;
        }
        plat.dx = plat.curX - oldX;
        plat.dy = plat.curY - oldY;

        if (plat.brokenTimer > 0) {
          plat.brokenTimer = Math.max(0, plat.brokenTimer - worldDt);
        } else if (plat.crumbleTimer > 0) {
          plat.crumbleTimer -= worldDt;
          if (plat.crumbleTimer <= 0) {
            plat.brokenTimer = 3.0;
            addParticles(plat.curX + plat.w * 0.5, GROUND_Y - plat.curY, 8, '#cbd5e1', 'dust', 110);
          }
        }
      }

      // Environmental Puzzle Gates
      for (const pz of puzzlesRef.current) {
        if (pz.solved && pz.openProgress < 1) {
          pz.openProgress = Math.min(1, pz.openProgress + dt * 1.4);
        }
        if (!pz.solved && pz.kind === 'pressure_rune') {
          const swY = GROUND_Y - pz.switchY;
          if (Math.abs(p.x - pz.switchX) < 28 && Math.abs(p.y - swY) < 28) {
            pz.solved = true;
            p.score += 220;
            gameAudio.playPuzzleSolved();
            addParticles(pz.switchX, swY - 12, 10, '#38bdf8', 'spark', 150);
          }
        }
      }

      // Stealth Cover overlap
      p.inStealthCover = false;
      for (const cov of level.stealthCovers) {
        const covTop = GROUND_Y - cov.y - cov.h;
        const covBot = GROUND_Y - cov.y + 10;
        if (p.x >= cov.x && p.x <= cov.x + cov.w && p.y >= covTop && p.y <= covBot) {
          p.inStealthCover = true;
          break;
        }
      }

      // Hazards under player
      let currentRiverForce = 0;
      p.inWater = false;
      p.inSwamp = false;
      let overVoidChasm = false;
      let overFireTrench = false;

      for (const hz of level.hazards) {
        if (p.x >= hz.x && p.x <= hz.x + hz.w) {
          if (hz.kind === 'river') {
            p.inWater = true;
            currentRiverForce = (hz.currentForce ?? -120) * Math.min(1.65, Math.sqrt(diffScale) * 1.15);
          } else if (hz.kind === 'swamp') {
            p.inSwamp = true;
          } else if (hz.kind === 'chasm') {
            overVoidChasm = true;
          } else if (hz.kind === 'fire_trench') {
            overFireTrench = true;
          }
        }
      }

      // Survival Hunger & Stamina Loop
      const digitalMove = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const rawMoveX = Math.abs(inp.moveX) > 0.12 ? inp.moveX : digitalMove;
      const wantsSprint =
        (inp.sprintHeld || Math.abs(inp.moveX) > 0.88) &&
        Math.abs(rawMoveX) > 0.45 &&
        !p.crouching &&
        !p.blocking &&
        p.hunger >= 20 &&
        p.stamina > 8;
      p.sprinting = Boolean(wantsSprint);

      const hungerDrain = p.sprinting ? 1.9 : 0.98;
      p.hunger = Math.max(0, p.hunger - hungerDrain * dt);
      const isHungry = p.hunger < 25;

      if (p.inSwamp && p.grounded) {
        p.stamina = Math.max(0, p.stamina - dt * 24);
      } else if (p.sprinting && p.grounded) {
        p.stamina = Math.max(0, p.stamina - dt * 18);
      } else {
        const regenRate = isHungry ? 9 : p.blocking ? 6 : 19;
        p.stamina = Math.min(p.maxStamina, p.stamina + dt * regenRate);
      }

      // Block & Timed Parry
      if (inp.blockPressed) {
        inp.blockPressed = false;
        if (p.stamina >= 12) {
          p.parryWindow = 0.12;
        }
      }
      p.blocking = Boolean(inp.blockHeld && p.grounded && p.dashTimer <= 0 && p.stamina > 4);

      // Climbing detection
      const upDir = inp.upHeld || inp.moveY < -0.35;
      const downDir = inp.crouchHeld || inp.moveY > 0.45;
      const climbTarget = level.climbables.find(
        (cl) =>
          p.x >= cl.x - 16 &&
          p.x <= cl.x + cl.w + 16 &&
          p.y <= GROUND_Y - cl.yBottom + 14 &&
          p.y >= GROUND_Y - cl.yTop - 18
      );

      if (climbTarget && upDir && p.dashTimer <= 0 && p.hurtTimer <= 0) {
        p.climbing = true;
        p.climbSurfaceX = climbTarget.x + climbTarget.w * 0.5;
        p.grounded = false;
        p.jumpsLeft = 2;
      } else if (!climbTarget && p.climbing) {
        p.climbing = false;
        p.climbSurfaceX = null;
      }

      // Crouch / Stealth & Super Jump charge
      p.crouching = Boolean(
        !p.climbing && inp.crouchHeld && p.grounded && p.dashTimer <= 0 && p.pounceTimer <= 0
      );
      if (p.crouching && Math.abs(rawMoveX) < 0.2) {
        p.crouchCharge = Math.min(1, p.crouchCharge + dt * 1.85);
      } else {
        p.crouchCharge = Math.max(0, p.crouchCharge - dt * 3.5);
      }

      // Horizontal & Climb Movement
      if (Math.abs(rawMoveX) > 0.12 && p.dashTimer <= 0 && p.pounceTimer <= 0 && !p.blocking) {
        p.facing = rawMoveX > 0 ? 1 : -1;
      }

      const speedPenalty = (isHungry ? 0.84 : 1.0) * (p.feverTimer > 0 ? 1.2 : 1.0);
      const maxSpeed = p.crouching
        ? 135
        : p.blocking
        ? 85
        : p.inSwamp && p.grounded
        ? 145
        : p.inWater && p.grounded
        ? 215
        : p.sprinting
        ? 410 * speedPenalty
        : 305 * speedPenalty;

      if (p.climbing && climbTarget) {
        const climbMoveY = inp.upHeld ? -1 : downDir ? 1 : Math.abs(inp.moveY) > 0.25 ? inp.moveY : 0;
        p.vy = climbMoveY * 185;
        p.vx = rawMoveX * 95;
        if (inp.jumpPressed) {
          inp.jumpPressed = false;
          p.climbing = false;
          p.vy = -495;
          p.vx = p.facing * 220;
          gameAudio.playJump(false);
        }
      } else if (p.dashTimer > 0) {
        if (Math.random() < 0.65) {
          p.trail.push({
            x: p.x,
            y: p.y,
            facing: p.facing,
            alpha: 0.9,
            style: resolveActiveStyle(level, p.x, elapsedRef.current, hitFlashRef.current),
          });
        }
      } else if (p.pounceTimer <= 0 && p.hurtTimer <= 0.1) {
        const targetVx =
          rawMoveX * maxSpeed + (p.grounded && p.inWater ? currentRiverForce : 0);
        const accel = p.onIce && p.grounded ? 3.2 : p.grounded ? 18 : 11;
        p.vx += (targetVx - p.vx) * Math.min(1, accel * dt);
        if (level.windForce && !p.grounded) {
          const gust = Math.sin(elapsedRef.current * 0.9) * level.windForce;
          p.vx += gust * dt * 1.45;
        }
      }

      // Coyote & Jump Buffer + Wall-Kick
      if (p.grounded) {
        p.coyoteTimer = 0.11;
        p.jumpsLeft = 2;
      } else {
        p.coyoteTimer = Math.max(0, p.coyoteTimer - dt);
      }

      if (inp.jumpPressed) {
        p.jumpBuffer = 0.13;
        inp.jumpPressed = false;
      } else {
        p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
      }

      if (!p.climbing && p.jumpBuffer > 0) {
        if (p.coyoteTimer > 0 || p.jumpsLeft > 0) {
          const isDouble = p.coyoteTimer <= 0;
          const isSuperLeap = !isDouble && p.crouchCharge >= 0.45;
          p.vy = isSuperLeap ? -675 : isDouble ? -495 : -545;
          p.grounded = false;
          p.crouching = false;
          p.crouchCharge = 0;
          p.coyoteTimer = 0;
          p.jumpBuffer = 0;
          p.jumpsLeft = isDouble ? 0 : 1;
          gameAudio.playJump(isDouble || isSuperLeap);
          if (isSuperLeap) {
            addParticles(p.x, p.y - 6, 10, '#fde047', 'spark', 140);
          } else {
            addParticles(p.x, p.y - 4, 6, '#e2e8f0', 'dust', 90);
          }
        } else if (p.wallKickCooldown <= 0) {
          const wallClimb = level.climbables.find(
            (cl) =>
              p.x >= cl.x - 22 &&
              p.x <= cl.x + cl.w + 22 &&
              p.y <= GROUND_Y - cl.yBottom + 18 &&
              p.y >= GROUND_Y - cl.yTop - 16
          );
          const wallGate = !wallClimb
            ? puzzlesRef.current.find(
                (pz) =>
                  pz.openProgress < 0.72 &&
                  Math.abs(p.x - pz.gateX) < 30 &&
                  p.y > GROUND_Y - pz.gateHeight
              )
            : undefined;
          const wallRefX = wallClimb
            ? wallClimb.x + wallClimb.w * 0.5
            : wallGate
            ? wallGate.gateX
            : null;
          if (wallRefX !== null) {
            const wallDir = wallRefX >= p.x ? 1 : -1;
            p.vx = -wallDir * 355;
            p.vy = -525;
            p.facing = (-wallDir) as 1 | -1;
            p.jumpsLeft = 1;
            p.wallKickCooldown = 0.22;
            p.jumpBuffer = 0;
            gameAudio.playJump(true);
            addParticles(p.x + wallDir * 12, p.y - 16, 8, '#38bdf8', 'spark', 140);
          }
        }
      }

      if (!p.climbing && !inp.jumpHeld && p.vy < -210 && p.pounceTimer <= 0) {
        p.vy *= 0.88;
      }

      // Sonic Meow & Environmental Puzzle / Beacon Interaction
      if (inp.meowPressed) {
        inp.meowPressed = false;
        if (p.meowCooldown <= 0) {
          p.meowTimer = 0.34;
          p.meowCooldown = 1.5;
          gameAudio.playMeow();
          particlesRef.current.push({
            x: p.x + p.facing * 14,
            y: p.y - 26,
            vx: 0,
            vy: 0,
            size: 16,
            life: 0.42,
            maxLife: 0.42,
            color: '#7dd3fc',
            kind: 'ring',
          });

          for (const en of enemiesRef.current) {
            if (en.state === 'dead') continue;
            if (Math.hypot(en.x - p.x, en.y - p.y) <= 200) {
              en.state = 'stunned';
              en.stateTimer = en.kind === 'alpha_guardian' ? 0.55 : 0.98;
              en.shieldUp = false;
              en.vx = Math.sign(en.x - p.x || 1) * 90;
            }
          }

          for (const pz of puzzlesRef.current) {
            if (pz.solved) continue;
            const swY = GROUND_Y - pz.switchY;
            if (Math.hypot(pz.switchX - p.x, swY - p.y) <= 95) {
              pz.solved = true;
              p.score += 240;
              gameAudio.playPuzzleSolved();
              addParticles(pz.switchX, swY - 12, 12, '#38bdf8', 'spark', 160);
            }
          }

          for (const obj of worldObjectsRef.current) {
            if (obj.activated) continue;
            const oy = GROUND_Y - (obj.y ?? 0);
            if (Math.hypot(obj.x - p.x, oy - p.y) <= 145) {
              obj.activated = true;
              if (obj.kind === 'memory_beacon') {
                gameAudio.playBeaconChime();
                p.hp = Math.min(p.maxHp, p.hp + 14);
                p.stamina = p.maxStamina;
                p.beaconsActivated += 1;
                p.score += 250;
                if (obj.loreText) {
                  activeWhisperRef.current = { text: obj.loreText, timer: 2.8 };
                }
                addParticles(obj.x, oy - 24, 12, '#38bdf8', 'spark', 150);
              } else if (obj.kind === 'scratch_post') {
                gameAudio.playSlash(1);
                p.stamina = p.maxStamina;
                p.score += 180;
                addParticles(obj.x, oy - 24, 10, '#fde047', 'spark', 140);
              } else {
                gameAudio.playPickup();
                p.hp = Math.min(p.maxHp, p.hp + 12);
                p.hunger = Math.min(p.maxHunger, p.hunger + 15);
                p.score += 120;
                addParticles(obj.x, oy - 16, 10, '#fed7aa', 'spark', 140);
              }
            }
          }
        }
      }

      // Shadow Dodge + Perfect Dodge Ghost Decoy & Slow-Mo
      if (inp.dashPressed) {
        inp.dashPressed = false;
        if (p.dashCooldown <= 0 && p.stamina >= 30) {
          const nearThreatProj = projectilesRef.current.some(
            (pr) => pr.fromEnemy && Math.hypot(pr.x - p.x, pr.y - (p.y - 20)) < 82
          );
          const nearThreatEnemy = enemiesRef.current.some(
            (en) =>
              en.state !== 'dead' &&
              (en.state === 'windup' || en.state === 'attack') &&
              Math.abs(en.x - p.x) < 88
          );
          const originX = p.x;
          const originY = p.y;
          p.stamina -= 30;
          p.dashTimer = 0.15;
          p.dashCooldown = 0.62;
          p.climbing = false;
          p.vx = p.facing * 645;
          p.vy = Math.min(0, p.vy * 0.2);
          gameAudio.playDash();
          addParticles(p.x, p.y - 18, 6, '#38bdf8', 'halftone', 140);
          if (nearThreatProj || nearThreatEnemy) {
            timeSlowTimerRef.current = 0.3;
            p.stamina = Math.min(p.maxStamina, p.stamina + 28);
            p.ghostDecoy = { x: originX, y: originY, facing: p.facing, life: 1.55 };
            addParticles(originX, originY - 20, 12, '#22d3ee', 'spark', 200);
          }
        }
      }

      // Charged Heavy Strike (Hold L)
      if (inp.heavyHeld && p.dashTimer <= 0 && !p.climbing) {
        p.isChargingAttack = true;
        p.chargeAttackTimer = Math.min(1.0, p.chargeAttackTimer + dt * 1.35);
      } else {
        p.isChargingAttack = false;
      }

      if (inp.heavyReleased) {
        inp.heavyReleased = false;
        if (p.chargeAttackTimer >= 0.48 && p.attackCooldown <= 0 && p.stamina >= 25) {
          p.stamina -= 25;
          p.pounceTimer = 0.34;
          p.attackTimer = 0.34;
          p.attackCooldown = 0.4;
          p.vx = p.facing * 520;
          gameAudio.playHeavyCharge();
          addParticles(p.x + p.facing * 20, p.y - 24, 12, '#fde047', 'spark', 200);
          if (p.chargeAttackTimer >= 0.85) {
            projectilesRef.current.push({
              id: nextProjIdRef.current++,
              x: p.x + p.facing * 28,
              y: p.y - 24,
              vx: p.facing * 480,
              vy: 0,
              radius: 14,
              fromEnemy: false,
              kind: 'claw_wave',
              damage: 42,
              life: 0.75,
            });
          }
        }
        p.chargeAttackTimer = 0;
      }

      // Tap Heavy Embiste
      if (inp.pouncePressed) {
        inp.pouncePressed = false;
        if (p.attackCooldown <= 0 && p.stamina >= 30) {
          p.stamina -= 30;
          p.pounceTimer = 0.28;
          p.attackTimer = 0.28;
          p.attackCooldown = 0.4;
          p.vx = p.facing * 490;
          p.vy = -205;
          gameAudio.playSlash(2);
        }
      }

      // Punch Combo -> Zarpazo Final
      if (inp.punchPressed) {
        inp.punchPressed = false;
        if (p.attackCooldown <= 0) {
          p.punchTimer = 0.22;
          p.attackTimer = 0.2;
          p.attackCooldown = 0.2;
          p.punchChain = Math.min(2, p.punchChain + 1);
          if (p.grounded) p.vx += p.facing * 120;
          gameAudio.playPunch();
        }
      }

      // Light Claw Combo / Zarpazo Final / Aerial Dive Strike
      const performAttack = inp.attackPressed;
      inp.attackPressed = false;
      if (performAttack && p.attackCooldown <= 0) {
        const isZarpazoFinal = p.punchChain >= 2;
        if (isZarpazoFinal) p.punchChain = 0;
        zarpazoFinalRef.current = isZarpazoFinal;
        p.attackTimer = isZarpazoFinal ? 0.3 : 0.24;
        p.attackCooldown = 0.24;
        p.comboStep = (p.comboStep + 1) % 3;
        if (!p.grounded && inp.crouchHeld) {
          p.vy = 480;
          p.pounceTimer = 0.28;
        } else if (p.grounded) {
          p.vx += p.facing * (isZarpazoFinal ? 165 : 95);
        }
        gameAudio.playSlash(isZarpazoFinal ? 2 : p.comboStep);
      }

      // Gravity & Integration
      const prevY = p.y;
      if (!p.climbing && p.dashTimer <= 0) {
        p.vy += 1380 * dt;
      }

      let nextX = Math.max(24, Math.min(level.length - 28, p.x + p.vx * dt));
      const nextY = p.y + p.vy * dt;

      // Locked Puzzle Gate Barrier
      for (const pz of puzzlesRef.current) {
        if (pz.openProgress < 0.72) {
          const gateLeft = pz.gateX - 12;
          const gateRight = pz.gateX + 12;
          const gateTop = GROUND_Y - pz.gateHeight;
          if (nextY > gateTop && p.x <= gateLeft && nextX + 14 > gateLeft) {
            nextX = gateLeft - 14;
            p.vx = 0;
          } else if (nextY > gateTop && p.x >= gateRight && nextX - 14 < gateRight) {
            nextX = gateRight + 14;
            p.vx = 0;
          }
        }
      }

      p.x = nextX;
      p.y = nextY;

      if (p.climbing && climbTarget) {
        p.y = Math.max(GROUND_Y - climbTarget.yTop, Math.min(GROUND_Y - climbTarget.yBottom, p.y));
      }

      // Platform Collisions
      const wasGrounded = p.grounded;
      p.grounded = false;
      p.onIce = level.biome === 'frost_torrent';
      if (!p.climbing && p.vy >= 0) {
        for (const plat of platformsRef.current) {
          if (plat.brokenTimer > 0) continue;
          const platTop = GROUND_Y - plat.curY;
          if (
            p.x + 14 >= plat.curX &&
            p.x - 14 <= plat.curX + plat.w &&
            prevY <= platTop + 12 &&
            p.y >= platTop
          ) {
            p.y = platTop;
            p.x = Math.max(24, Math.min(level.length - 28, p.x + plat.dx));
            p.vy = 0;
            p.grounded = true;
            p.onIce = Boolean(plat.slippery || plat.kind === 'ice');
            if (plat.crumbleDelay && plat.crumbleTimer <= 0) {
              plat.crumbleTimer = Math.max(0.28, plat.crumbleDelay * 0.65);
            }
            break;
          }
        }
      }

      // Ground & Lethal Hazards
      if (!p.grounded && !p.climbing) {
        if (overVoidChasm || overFireTrench) {
          if (p.y > GROUND_Y + 46) {
            const hazDmg = Math.round((overFireTrench ? 32 : 26) * INSANE_MULT);
            damagePlayer(hazDmg, -p.facing * 170, false);
            p.x = p.lastSafeX;
            p.y = p.lastSafeY - 60;
            p.vy = -220;
          }
        } else {
          const floorY = p.inWater || p.inSwamp ? GROUND_Y + 10 : GROUND_Y;
          if (p.y >= floorY) {
            if (!wasGrounded && p.inWater && elapsedRef.current - lastSplashTimeRef.current > 0.35) {
              lastSplashTimeRef.current = elapsedRef.current;
              gameAudio.playSplash();
              addParticles(p.x, GROUND_Y + 4, 8, '#bae6fd', 'splash', 130);
            }
            p.y = floorY;
            p.vy = 0;
            p.grounded = true;
            if (!p.inWater && !p.inSwamp) {
              p.lastSafeX = p.x;
              p.lastSafeY = GROUND_Y;
            }
          }
        }
      }

      const stepSurface = p.onIce
        ? 'ice'
        : p.inWater
        ? 'water'
        : level.biome === 'jungle_edge' || level.biome === 'bamboo_curse'
        ? 'wood'
        : 'stone';

      if (!wasGrounded && p.grounded && !p.inWater) {
        p.landingTimer = 0.16;
        addParticles(p.x, p.y - 2, 5, '#e2e8f0', 'dust', 85);
        gameAudio.playStep(stepSurface);
      }

      const horizSpeed = Math.abs(p.vx);
      if (p.grounded && horizSpeed > 18) {
        p.strideAccum += (horizSpeed / 36) * dt * 2.4;
        if (elapsedRef.current - lastStepTimeRef.current > (p.sprinting ? 0.21 : 0.32)) {
          lastStepTimeRef.current = elapsedRef.current;
          gameAudio.playStep(stepSurface);
        }
      } else if (p.climbing && Math.abs(p.vy) > 15) {
        p.strideAccum += Math.abs(p.vy) * 0.045 * dt;
      }

      p.noiseLevel =
        p.meowTimer > 0
          ? 1.8
          : p.attackTimer > 0 || p.punchTimer > 0
          ? 1.25
          : p.sprinting
          ? 1.15
          : p.crouching
          ? p.inStealthCover
            ? 0.06
            : 0.18
          : horizSpeed > 60
          ? 0.72
          : 0.12;

      // 19-State Animation & Feline Emotion
      p.crawling = Boolean(p.crouching && horizSpeed > 24);
      let nextAnim: CatAnimState = 'idle';
      if (p.deathTimer > 0) nextAnim = 'death';
      else if (p.victoryTimer > 0) nextAnim = 'victory';
      else if (p.hurtTimer > 0.1) nextAnim = 'hurt';
      else if (p.dashTimer > 0) nextAnim = 'dodge';
      else if (p.punchTimer > 0) nextAnim = 'punch';
      else if (p.attackTimer > 0) nextAnim = 'attack';
      else if (p.climbing) nextAnim = 'climb';
      else if (p.inWater && !p.grounded) nextAnim = 'swim';
      else if (p.inWater && horizSpeed > 25) nextAnim = 'swim';
      else if (!p.grounded) {
        if (p.vy < -20) nextAnim = p.jumpsLeft === 0 ? 'double_jump' : 'jump';
        else nextAnim = 'fall';
      } else if (p.landingTimer > 0 && horizSpeed < 60) nextAnim = 'landing';
      else if (p.crawling) nextAnim = 'crawl';
      else if (p.crouching) nextAnim = 'stealth';
      else if (p.sprinting && horizSpeed > 260) nextAnim = 'sprint';
      else if (horizSpeed > 180) nextAnim = 'run';
      else if (horizSpeed > 22) nextAnim = 'walk';
      else if (isHungry || p.stamina < 18) nextAnim = 'exhausted';
      p.animState = nextAnim;

      let nextEmotion: CatEmotion = 'calm';
      if (p.hurtTimer > 0) nextEmotion = 'pain';
      else if (p.attackTimer > 0 || p.punchTimer > 0 || p.isChargingAttack || p.comboHits >= 2) {
        nextEmotion = 'anger';
      } else if (isHungry || p.stamina < 20) nextEmotion = 'exhausted';
      else if (
        enemiesRef.current.some(
          (e) => e.state === 'windup' && Math.abs(e.x - p.x) < 170
        )
      ) {
        nextEmotion = 'fear';
      }
      p.emotion = nextEmotion;

      for (let i = p.trail.length - 1; i >= 0; i--) {
        p.trail[i].alpha -= dt * 4.5;
        if (p.trail[i].alpha <= 0) p.trail.splice(i, 1);
      }

      // Environmental Traps
      level.traps.forEach((tr, tIdx) => {
        const ty = GROUND_Y - tr.y;
        const interval = (tr.interval ?? 2.6) * 0.78;
        const elapsedShifted = elapsedRef.current + (tr.phaseOffset ?? 0);
        const cycleIdx = Math.floor(elapsedShifted / interval);
        const cycle = (elapsedShifted % interval) / interval;

        if (tr.kind === 'spikes') {
          if (p.x + 10 >= tr.x && p.x - 10 <= tr.x + tr.w && Math.abs(p.y - ty) < 22) {
            damagePlayer(Math.round(16 * dmgMult), -p.facing * 180, false);
          }
        } else if (tr.kind === 'fire_jet') {
          if (cycle >= 0.62 && p.x + 12 >= tr.x && p.x - 12 <= tr.x + tr.w && p.y >= ty - 95) {
            damagePlayer(Math.round(20 * dmgMult), -p.facing * 165, false);
          }
        } else if (tr.kind === 'pendulum_blade') {
          const pInterval = tr.interval ?? 2.0;
          const pAngle =
            Math.sin(elapsedRef.current * ((Math.PI * 2) / pInterval) + (tr.phaseOffset ?? 0)) * 1.15;
          const pLen = tr.length ?? 130;
          const bobX = tr.x + Math.sin(pAngle) * pLen;
          const bobY = ty + Math.cos(pAngle) * pLen;
          if (Math.hypot(p.x - bobX, p.y - 18 - bobY) < 28) {
            damagePlayer(Math.round(22 * dmgMult), -p.facing * 210, false);
          }
        } else if (tr.kind === 'dart_wall') {
          const prevCycle = trapFireCyclesRef.current.get(tIdx) ?? -1;
          if (cycleIdx !== prevCycle && Math.abs(p.x - tr.x) < 620) {
            trapFireCyclesRef.current.set(tIdx, cycleIdx);
            projectilesRef.current.push({
              id: nextProjIdRef.current++,
              x: tr.x + (tr.dir === 1 ? 22 : -4),
              y: ty - 14,
              vx: (tr.dir ?? -1) * 340,
              vy: 0,
              radius: 7,
              fromEnemy: true,
              kind: 'dart',
              damage: Math.round(15 * dmgMult),
              life: 2.2,
            });
          }
        } else if (tr.kind === 'icicle_drop') {
          const prevCycle = trapFireCyclesRef.current.get(tIdx) ?? -1;
          if (cycleIdx !== prevCycle && Math.abs(p.x - tr.x) < 230) {
            trapFireCyclesRef.current.set(tIdx, cycleIdx);
            projectilesRef.current.push({
              id: nextProjIdRef.current++,
              x: tr.x + 12,
              y: ty - 170,
              vx: 0,
              vy: 330,
              radius: 9,
              fromEnemy: true,
              kind: 'icicle',
              damage: Math.round(19 * dmgMult),
              life: 1.5,
            });
          }
        }
      });

      // Player Attacks vs Enemies, World Objects & Projectiles
      if (p.attackTimer > 0.08) {
        const isHeavy = p.pounceTimer > 0;
        const isPunch = p.punchTimer > 0;
        const isZarpazo = zarpazoFinalRef.current;
        const reachX = p.x + p.facing * (isHeavy || isZarpazo ? 52 : 42);
        const reachRadius = isHeavy || isZarpazo ? 58 : 44;
        const counterBoost = p.counterReadyTimer > 0 ? 2.4 : 1.0;

        for (const en of enemiesRef.current) {
          if (en.state === 'dead' || en.hitFlash > 0.14) continue;
          const dx = en.x - reachX;
          const dy = en.y - 20 - (p.y - 20);
          if (Math.abs(dx) < reachRadius + en.w * 0.42 && Math.abs(dy) < 58) {
            const hittingFront = Math.sign(p.x - en.x) === en.facing;
            if (
              (en.armor > 0 || en.shieldUp) &&
              hittingFront &&
              !isHeavy &&
              !isZarpazo &&
              p.counterReadyTimer <= 0
            ) {
              en.hitFlash = 0.2;
              en.vx = p.facing * 65;
              en.facing = p.x >= en.x ? 1 : -1;
              en.state = 'windup';
              en.stateTimer = 0.18;
              gameAudio.playArmorClang();
              addParticles(en.x, en.y - 22, 6, '#cbd5e1', 'spark', 150);
            } else {
              en.ambushHidden = false;
              const wasCounter = p.counterReadyTimer > 0;
              if ((isHeavy || isZarpazo || wasCounter) && en.armor > 0) {
                en.armor = Math.max(0, en.armor - 1);
                en.shieldUp = false;
                addFloatingText(en.x, en.y - 54, '¡Rota!', '#fde047', 1.1);
              }
              const baseDmg = isHeavy ? 48 : isPunch ? 22 : 24 + p.comboStep * 5;
              const zarpazoMult = isZarpazo ? 1.9 : 1.0;
              const feverMult = p.feverTimer > 0 ? 1.3 : 1.0;
              const hungerDmgMult = isHungry ? 0.8 : 1.0;
              const dmg = Math.round(baseDmg * zarpazoMult * feverMult * counterBoost * hungerDmgMult);
              if (wasCounter) {
                p.counterReadyTimer = 0;
                p.hp = Math.min(p.maxHp, p.hp + 7);
              }
              if (isZarpazo) zarpazoFinalRef.current = false;

              en.hp -= dmg;
              en.hitFlash = 0.22;
              en.alertLevel = 1;
              en.vx = p.facing * (isHeavy || isZarpazo ? 230 : 110);

              en.poiseHits = isHeavy || isZarpazo ? 0 : en.poiseHits + 1;
              if (!isHeavy && !isZarpazo && en.poiseHits >= 2 && en.kind !== 'drone_sentinel') {
                en.poiseHits = 0;
                en.facing = p.x >= en.x ? 1 : -1;
                en.state = 'windup';
                en.stateTimer = 0.22;
              } else {
                en.state = 'stagger';
                en.stateTimer =
                  en.kind === 'alpha_guardian' || en.kind === 'siege_captain' ? 0.14 : 0.22;
              }

              p.comboHits += 1;
              p.comboResetTimer = 2.6;
              if (p.comboHits >= 5 && p.feverTimer <= 0) {
                p.feverTimer = 6.5;
              }
              p.score += dmg;

              hitStopRef.current = isHeavy || isZarpazo ? 0.04 : 0.022;
              hitFlashRef.current = isHeavy || isZarpazo ? 0.14 : 0.05;
              shakeTimerRef.current = isHeavy || isZarpazo ? 0.15 : 0.07;
              gameAudio.playHit(isHeavy || isZarpazo);

              addParticles(
                en.x,
                en.y - 22,
                isZarpazo ? 12 : 8,
                isZarpazo ? '#fde047' : '#fb7185',
                'halftone',
                isZarpazo ? 220 : 185
              );

              if (en.hp <= 0) {
                en.state = 'dead';
                p.score += en.kind === 'alpha_guardian' ? 750 : 160;
                addParticles(en.x, en.y - 24, 14, '#f59e0b', 'spark', 220);
              }
            }
          }
        }

        // Break Supply Crates & use Scratch Posts
        for (const obj of worldObjectsRef.current) {
          if (obj.activated) continue;
          const oy = GROUND_Y - (obj.y ?? 0);
          if (Math.abs(obj.x - reachX) < reachRadius + 16 && Math.abs(oy - 18 - (p.y - 20)) < 52) {
            if (obj.kind === 'supply_crate') {
              obj.activated = true;
              gameAudio.playPickup();
              p.hp = Math.min(p.maxHp, p.hp + 12);
              p.hunger = Math.min(p.maxHunger, p.hunger + 15);
              addParticles(obj.x, oy - 16, 10, '#d97706', 'spark', 150);
            } else if (obj.kind === 'scratch_post') {
              obj.activated = true;
              gameAudio.playSlash(1);
              p.stamina = p.maxStamina;
              addParticles(obj.x, oy - 24, 8, '#fde047', 'spark', 130);
            }
          }
        }

        // Deflect Enemy Projectiles
        for (let i = projectilesRef.current.length - 1; i >= 0; i--) {
          const pr = projectilesRef.current[i];
          if (!pr.fromEnemy) continue;
          if (Math.hypot(pr.x - reachX, pr.y - (p.y - 22)) < reachRadius + pr.radius) {
            if (pr.kind === 'rejection_wave' || pr.kind === 'icicle') {
              projectilesRef.current.splice(i, 1);
              gameAudio.playArmorClang();
            } else {
              pr.fromEnemy = false;
              pr.vx = -pr.vx * 1.4;
              pr.vy = -pr.vy * 1.4;
              gameAudio.playArmorClang();
            }
          }
        }
      }

      // Rejection Waves
      if (level.hasRejectionWaves) {
        rejectionWaveTimerRef.current -= worldDt;
        if (rejectionWaveTimerRef.current <= 0) {
          const intervalBase = level.rejectionWaveInterval ?? 4.8;
          rejectionWaveTimerRef.current = Math.max(2.0, intervalBase / Math.sqrt(INSANE_MULT));
          projectilesRef.current.push({
            id: nextProjIdRef.current++,
            x: camXRef.current + viewW / (viewH / LOGICAL_HEIGHT) + 30,
            y: GROUND_Y - 26,
            vx: -325 * Math.sqrt(INSANE_MULT),
            vy: 0,
            radius: 25,
            fromEnemy: true,
            kind: 'rejection_wave',
            damage: Math.round(16 * dmgMult),
            life: 4.5,
          });
        }
      }

      // Enemy & Boss AI
      stepEnemiesAI(enemiesRef.current, p, level, worldDt, elapsedRef.current, INSANE_MULT, {
        onDamagePlayer: (amount, knockX, _label, blockedFront) => {
          damagePlayer(amount, knockX, blockedFront);
        },
        onFloatingText: (x, y, text, color, scale) => {
          addFloatingText(x, y, text, color, scale);
        },
        onSpawnParticles: (x, y, count, color, kind, speed) => {
          addParticles(x, y, count, color, kind, speed);
        },
        onSpawnProjectile: (proj) => {
          projectilesRef.current.push({
            ...proj,
            id: nextProjIdRef.current++,
          });
        },
        onStoryBanner: (_speaker, text) => {
          if (text) activeWhisperRef.current = { text, timer: 2.6 };
        },
        onCameraShake: (duration) => {
          shakeTimerRef.current = Math.max(shakeTimerRef.current, duration);
        },
      });

      // Projectiles update
      for (let i = projectilesRef.current.length - 1; i >= 0; i--) {
        const pr = projectilesRef.current[i];
        const projStepDt = pr.fromEnemy ? worldDt : dt;
        pr.x += pr.vx * projStepDt;
        pr.y += pr.vy * projStepDt;
        pr.life -= projStepDt;
        if (pr.life <= 0 || pr.y > GROUND_Y + 30) {
          projectilesRef.current.splice(i, 1);
          continue;
        }
        if (pr.fromEnemy) {
          const hitTop = p.crouching ? p.y - 16 : p.y - 36;
          const hitCenterY = (hitTop + p.y) * 0.5;
          const hitHalfH = p.crouching ? 10 : 18;
          if (
            Math.abs(pr.x - p.x) < pr.radius + 15 &&
            Math.abs(pr.y - hitCenterY) < pr.radius + hitHalfH
          ) {
            const blockedFront =
              p.blocking && Math.sign(pr.x - p.x || -pr.vx) === p.facing;
            damagePlayer(
              pr.damage,
              pr.kind === 'rejection_wave' ? -280 : Math.sign(pr.vx || -1) * 180,
              blockedFront
            );
            projectilesRef.current.splice(i, 1);
          }
        } else {
          for (const en of enemiesRef.current) {
            if (en.state === 'dead') continue;
            if (Math.hypot(pr.x - en.x, pr.y - (en.y - 20)) < pr.radius + 26) {
              en.hp -= pr.damage || 50;
              en.hitFlash = 0.25;
              en.alertLevel = 1;
              if (en.hp <= 0) {
                en.state = 'dead';
                p.score += 140;
              }
              projectilesRef.current.splice(i, 1);
              break;
            }
          }
        }
      }

      // Secret Zone Pickup
      if (!secretRef.current.collected) {
        const sy = GROUND_Y - secretRef.current.y;
        if (Math.hypot(p.x - secretRef.current.x, p.y - 20 - sy) < 38) {
          secretRef.current.collected = true;
          p.secretsFound += 1;
          p.sideQuestComplete = true;
          p.hp = Math.min(p.maxHp, p.hp + 30);
          p.hunger = p.maxHunger;
          gameAudio.playBeaconChime();
          addParticles(secretRef.current.x, sy, 14, '#fde047', 'petal', 160);
          if (secretRef.current.loreText) {
            activeWhisperRef.current = { text: secretRef.current.loreText, timer: 2.8 };
          }
        }
      }

      // Pickups
      for (const pk of pickupsRef.current) {
        if (pk.collected) continue;
        const py = GROUND_Y - pk.y;
        if (Math.hypot(p.x - pk.x, p.y - 20 - py) < 34) {
          pk.collected = true;
          gameAudio.playPickup();
          if (pk.kind === 'lotus_heal') {
            p.hp = Math.min(p.maxHp, p.hp + 18);
            p.hunger = Math.min(p.maxHunger, p.hunger + 10);
          } else if (pk.kind === 'fish_ration') {
            p.hunger = Math.min(p.maxHunger, p.hunger + 34);
            p.hp = Math.min(p.maxHp, p.hp + 10);
            p.stamina = p.maxStamina;
          } else {
            p.stamina = p.maxStamina;
            p.feverTimer = Math.max(p.feverTimer, 6.5);
          }
          addParticles(pk.x, py, 10, '#fef08a', 'petal', 130);
        }
      }

      // Particles & Floating Texts
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const pt = particlesRef.current[i];
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        if (pt.kind !== 'ring') pt.vy += 280 * dt;
        pt.life -= dt;
        if (pt.life <= 0) particlesRef.current.splice(i, 1);
      }
      for (let i = floatingTextsRef.current.length - 1; i >= 0; i--) {
        const ft = floatingTextsRef.current[i];
        ft.y += ft.vy * dt;
        ft.life -= dt;
        if (ft.life <= 0) floatingTextsRef.current.splice(i, 1);
      }

      // Emotional Whispers
      level.storyBeats.forEach((sb, idx) => {
        if (!triggeredStoriesRef.current.has(idx) && p.x >= sb.x) {
          triggeredStoriesRef.current.add(idx);
          if (sb.text) {
            activeWhisperRef.current = { text: sb.text, timer: 2.8 };
          }
        }
      });

      if (activeWhisperRef.current) {
        activeWhisperRef.current.timer -= dt;
        if (activeWhisperRef.current.timer <= 0) activeWhisperRef.current = null;
      }

      // Smooth Camera Follow
      const safeScale = Math.max(0.1, viewH / LOGICAL_HEIGHT);
      const logicalW = Math.max(100, viewW / safeScale);
      const maxCam = Math.max(0, level.length - logicalW);
      const targetCam = Math.max(0, Math.min(maxCam, p.x - logicalW * 0.34));
      const baseCam = Number.isFinite(camXRef.current) ? camXRef.current : 0;
      camXRef.current = baseCam + (targetCam - baseCam) * Math.min(1, 8 * dt);

      // Level Goal Check
      if (p.x >= level.length - 125) {
        const activeBoss = enemiesRef.current.find(
          (e) => (e.kind === 'alpha_guardian' || e.kind === 'siege_captain') && e.state !== 'dead'
        );
        if (!activeBoss) {
          p.victoryTimer = level.id === LEVELS.length ? 0.72 : 0.65;
          p.animState = 'victory';
          gameAudio.playBeaconChime();
          addParticles(p.x, p.y - 26, 14, '#fde047', 'petal', 160);
        }
      }
    };

    const frame = (now: number) => {
      if (disposed) return;
      try {
        if (document.hidden) {
          lastNow = now;
          return;
        }

        const curClientW = Math.round(canvas.clientWidth || window.innerWidth);
        const curClientH = Math.round(canvas.clientHeight || window.innerHeight);
        if (curClientW > 1 && curClientH > 1 && (curClientW !== viewW || curClientH !== viewH)) {
          resize();
        }
        if (viewW < 2 || viewH < 2) {
          lastNow = now;
          return;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const dt = Math.max(0, Math.min(0.05, (now - lastNow) / 1000));
        lastNow = now;

        // Rolling EMA FPS Monitor -> Adaptive Quality Tier (battery & mobile smooth 60fps)
        avgDt = avgDt * 0.92 + Math.max(0.008, dt) * 0.08;
        const fps = 1 / avgDt;
        const curQ = qualityRef.current;
        if ((curQ === 'high' && fps < 46) || (curQ === 'medium' && fps < 36)) {
          lowFpsTime += dt;
          highFpsTime = 0;
          if (lowFpsTime > 1.4) {
            lowFpsTime = 0;
            const nextQ: QualityTier = curQ === 'high' ? 'medium' : 'low';
            qualityRef.current = nextQ;
            cat3DOverlayRef.current?.setQualityTier(nextQ);
            resize();
          }
        } else if (fps > 57 && curQ !== 'high') {
          highFpsTime += dt;
          lowFpsTime = Math.max(0, lowFpsTime - dt);
          if (highFpsTime > 5.0) {
            highFpsTime = 0;
            const nextQ: QualityTier = curQ === 'low' ? 'medium' : 'high';
            qualityRef.current = nextQ;
            cat3DOverlayRef.current?.setQualityTier(nextQ);
            resize();
          }
        } else {
          lowFpsTime = Math.max(0, lowFpsTime - dt * 0.5);
          highFpsTime = 0;
        }

        const curPhase = phaseRef.current;

        if (curPhase === 'TITLE_MENU') {
          cat3DOverlayRef.current?.setVisible(false);
          elapsedRef.current += dt;
          renderTitleBackdrop(ctx, viewW, viewH, elapsedRef.current);
        } else if (curPhase === 'PROLOGUE') {
          cat3DOverlayRef.current?.setVisible(false);
          const prevT = cutsceneTimeRef.current;
          cutsceneTimeRef.current += dt;
          if (prevT < 0.2 && cutsceneTimeRef.current >= 0.2) gameAudio.playProloguePluck(0);
          if (prevT < 4.6 && cutsceneTimeRef.current >= 4.6) gameAudio.playHoundGrowl();
          if (prevT < 9.4 && cutsceneTimeRef.current >= 9.4) gameAudio.playProloguePluck(1);

          renderPrologueFrame(ctx, viewW, viewH, cutsceneTimeRef.current);
          if (cutsceneTimeRef.current >= PROLOGUE_DURATION) {
            beginTransitionToLevel(0, false);
          }
        } else if (curPhase === 'TRANSITION') {
          cat3DOverlayRef.current?.setVisible(false);
          transitionTimerRef.current = Math.max(0, transitionTimerRef.current - dt);
          const targetLvl = LEVELS[transitionTargetIdxRef.current] ?? LEVELS[0];
          const progress = 1 - transitionTimerRef.current / TRANSITION_DURATION;
          renderTransitionFrame(ctx, viewW, viewH, targetLvl.title, targetLvl.introLine, progress);
          if (transitionTimerRef.current <= 0) {
            setGamePhase('PLAYING');
          }
        } else if (curPhase === 'EPILOGUE_REJECTION') {
          cutsceneTimeRef.current += dt;
          const chordStep = Math.floor(cutsceneTimeRef.current / 4.2);
          if (chordStep !== epilogueChordStepRef.current) {
            epilogueChordStepRef.current = chordStep;
            gameAudio.playTragicChord(chordStep);
          }
          const has3D = Boolean(cat3DOverlayRef.current);
          renderEpilogueRejectionFrame(
            ctx,
            viewW,
            viewH,
            cutsceneTimeRef.current,
            has3D,
            qualityRef.current
          );
          if (has3D) {
            cat3DOverlayRef.current!.renderPixarEpilogue(viewW, viewH, cutsceneTimeRef.current);
          }
          if (cutsceneTimeRef.current >= EPILOGUE_REJECTION_DURATION) {
            ending2DTimeRef.current = 18.6;
            epilogueChordStepRef.current = -1;
            setGamePhase('ENDING_2D');
          }
        } else if (curPhase === 'ENDING_2D') {
          cat3DOverlayRef.current?.setVisible(false);
          const prevT = ending2DTimeRef.current;
          ending2DTimeRef.current += dt;
          if (prevT < 20.8 && ending2DTimeRef.current >= 20.8) gameAudio.playTragicChord(0);
          if (prevT < 27.8 && ending2DTimeRef.current >= 27.8) gameAudio.playTragicChord(1);
          if (prevT < 32.0 && ending2DTimeRef.current >= 32.0) gameAudio.playTragicChord(2);
          if (prevT < 36.5 && ending2DTimeRef.current >= 36.5) gameAudio.playTragicChord(3);
          if (ending2DTimeRef.current >= ANIMATION_TOTAL_DURATION) {
            ending2DTimeRef.current = 18.6;
            epilogueChordStepRef.current = -1;
          }
          renderJumpingCatFrame(ctx, viewW, viewH, ending2DTimeRef.current);
        } else {
          if (curPhase === 'PLAYING') {
            stepSimulation(dt);
          }

          const level = LEVELS[levelIdxRef.current];
          const sx = shakeTimerRef.current > 0 ? (Math.random() - 0.5) * 10 : 0;
          const sy = shakeTimerRef.current > 0 ? (Math.random() - 0.5) * 8 : 0;

          const active3D = Boolean(
            level.use3DCat &&
              cat3DOverlayRef.current &&
              (curPhase === 'PLAYING' || curPhase === 'PAUSED' || curPhase === 'GAME_OVER') &&
              qualityRef.current !== 'low'
          );

          renderGameplayFrame(
            ctx,
            viewW,
            viewH,
            level,
            platformsRef.current,
            puzzlesRef.current,
            secretRef.current,
            playerRef.current,
            enemiesRef.current,
            projectilesRef.current,
            particlesRef.current,
            pickupsRef.current,
            worldObjectsRef.current,
            floatingTextsRef.current,
            camXRef.current,
            sx,
            sy,
            elapsedRef.current,
            hitFlashRef.current,
            active3D,
            qualityRef.current
          );

          if (active3D) {
            const safeScale = Math.max(0.1, viewH / LOGICAL_HEIGHT);
            const logicalW = Math.max(100, viewW / safeScale);
            const st = resolveActiveStyle(
              level,
              playerRef.current.x,
              elapsedRef.current,
              hitFlashRef.current
            );
            let nearestDx: number | null = null;
            let bestAbs = 480;
            for (const en of enemiesRef.current) {
              if (en.state === 'dead' || en.ambushHidden) continue;
              const dx = en.x - playerRef.current.x;
              if (Math.abs(dx) < bestAbs) {
                bestAbs = Math.abs(dx);
                nearestDx = dx;
              }
            }
            cat3DOverlayRef.current!.syncGameplay(
              viewW,
              viewH,
              playerRef.current,
              camXRef.current,
              logicalW,
              elapsedRef.current,
              dt,
              st,
              nearestDx
            );
          } else {
            cat3DOverlayRef.current?.setVisible(false);
          }

          hudSyncTimer += dt;
          if (hudSyncTimer >= 0.1) {
            hudSyncTimer = 0;
            const p = playerRef.current;
            const boss = enemiesRef.current.find(
              (e) =>
                (e.kind === 'alpha_guardian' || e.kind === 'siege_captain') && e.state !== 'dead'
            );
            setHud({
              hp: Math.ceil(p.hp),
              maxHp: p.maxHp,
              stamina: Math.ceil(p.stamina),
              maxStamina: p.maxStamina,
              hunger: Math.ceil(p.hunger),
              maxHunger: p.maxHunger,
              chapterNumeral: level.title,
              whisper: activeWhisperRef.current?.text ?? null,
              bossHpPct: boss ? Math.max(0, Math.round((boss.hp / boss.maxHp) * 100)) : null,
              bossName: boss?.kind === 'siege_captain' ? 'Capitán' : 'Alfa',
              exhausted: p.hunger < 25,
            });
          }
        }
      } catch (err) {
        console.error('Frame render error:', err);
      } finally {
        if (!disposed) {
          rafId = requestAnimationFrame(frame);
        }
      }
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [beginTransitionToLevel, loadLevel, setGamePhase]);

  const handleToggleMute = () => {
    gameAudio.unlock();
    setMuted(gameAudio.toggleMute());
  };

  // Virtual Analog Joystick Handlers (Left Bottom Pad)
  const updateJoystickFromEvent = (clientX: number, clientY: number, el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const maxR = rect.width * 0.42;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    const nx = dx / maxR;
    const ny = dy / maxR;
    inputRef.current.moveX = Math.abs(nx) < 0.14 ? 0 : nx;
    inputRef.current.moveY = Math.abs(ny) < 0.18 ? 0 : ny;
    inputRef.current.upHeld = ny < -0.45;
    inputRef.current.crouchHeld = ny > 0.52;
    if (joyKnobRef.current) {
      joyKnobRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    }
  };

  const resetJoystick = () => {
    joyPointerIdRef.current = null;
    inputRef.current.moveX = 0;
    inputRef.current.moveY = 0;
    inputRef.current.upHeld = false;
    inputRef.current.crouchHeld = false;
    if (joyKnobRef.current) {
      joyKnobRef.current.style.transform = 'translate3d(0px, 0px, 0)';
    }
  };

  const holdBlock = (down: boolean) => {
    gameAudio.unlock();
    if (down && !inputRef.current.blockHeld) inputRef.current.blockPressed = true;
    inputRef.current.blockHeld = down;
  };
  const triggerJump = (down: boolean) => {
    gameAudio.unlock();
    if (down) {
      if (!inputRef.current.jumpHeld) inputRef.current.jumpPressed = true;
      inputRef.current.jumpHeld = true;
    } else {
      inputRef.current.jumpHeld = false;
    }
  };
  const triggerAttack = () => {
    gameAudio.unlock();
    inputRef.current.attackPressed = true;
  };
  const triggerDash = () => {
    gameAudio.unlock();
    inputRef.current.dashPressed = true;
  };
  const triggerSkill = () => {
    gameAudio.unlock();
    inputRef.current.meowPressed = true;
  };

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-[#07090e] text-[#faf7f0] select-none"
      style={{ touchAction: 'none' }}
    >
      {/* 2D Multi-Style World Canvas */}
      <canvas
        ref={canvasRef}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (phase !== 'PLAYING' || e.pointerType !== 'mouse') return;
          if (e.button === 2) {
            holdBlock(true);
          } else {
            triggerAttack();
          }
        }}
        onPointerUp={(e) => {
          if (e.pointerType === 'mouse' && e.button === 2) {
            holdBlock(false);
          }
        }}
        className="fixed inset-0 z-0 block h-full w-full"
        aria-label="La Senda de Sunmy"
      />

      {/* Transparent Three.js WebGL Overlay (no backdrop-blur anywhere above or beside) */}
      <div
        ref={webglMountRef}
        className="pointer-events-none fixed inset-0 z-[5]"
        aria-hidden="true"
      />

      {/* Razor-Minimal Top Gameplay HUD */}
      {(phase === 'PLAYING' || phase === 'PAUSED') && (
        <header className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-start justify-between gap-2 px-3 pt-3 sm:px-5">
          {/* Top-Left: Roman Chapter + Thin Vida, Vigor & Energía Bars */}
          <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-[#07090e]/75 px-3 py-2">
            <div className="flex items-center gap-2.5">
              <span className="font-serif text-sm font-semibold tracking-widest text-[#f5b65c]">
                {hud.chapterNumeral}
              </span>
              <div className="h-2 w-24 overflow-hidden rounded-sm bg-white/15 sm:w-32">
                <div
                  className="h-full bg-[#dc2626] transition-all duration-100"
                  style={{ width: `${(hud.hp / hud.maxHp) * 100}%` }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1 w-14 overflow-hidden rounded-sm bg-white/12 sm:w-16">
                <div
                  className="h-full bg-[#38bdf8] transition-all duration-75"
                  style={{ width: `${(hud.stamina / hud.maxStamina) * 100}%` }}
                />
              </div>
              <div className="h-1 w-12 overflow-hidden rounded-sm bg-white/12 sm:w-14">
                <div
                  className={`h-full transition-all duration-150 ${
                    hud.exhausted ? 'bg-[#ef4444]' : 'bg-[#f59e0b]'
                  }`}
                  style={{ width: `${(hud.hunger / hud.maxHunger) * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* Top-Center: Optional Clean Boss Bar */}
          {hud.bossHpPct !== null && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-400/25 bg-[#07090e]/75 px-3 py-1.5">
              <span className="font-serif text-xs font-semibold tracking-wide text-[#fde68a]">
                {hud.bossName}
              </span>
              <div className="h-1.5 w-24 overflow-hidden rounded-sm bg-white/15 sm:w-36">
                <div className="h-full bg-[#f59e0b]" style={{ width: `${hud.bossHpPct}%` }} />
              </div>
            </div>
          )}

          {/* Top-Right: Mute & Pause Icons Only */}
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleMute}
              aria-label={muted ? 'Activar sonido' : 'Silenciar'}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-[#07090e]/75 text-[#e7e5e4] hover:bg-black/90 cursor-pointer"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={() => setGamePhase(phase === 'PAUSED' ? 'PLAYING' : 'PAUSED')}
              aria-label={phase === 'PAUSED' ? 'Reanudar' : 'Pausar'}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-[#07090e]/75 text-[#e7e5e4] hover:bg-black/90 cursor-pointer"
            >
              {phase === 'PAUSED' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
          </div>
        </header>
      )}

      {/* Brief Emotional Whisper Subtitle */}
      {phase === 'PLAYING' && hud.whisper && (
        <div
          className={`pointer-events-none fixed inset-x-0 z-15 flex justify-center px-6 ${
            isTouchMode ? 'bottom-32' : 'bottom-8'
          }`}
        >
          <p className="font-serif text-base italic tracking-wide text-[#faf7f0] drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] sm:text-lg">
            {hud.whisper}
          </p>
        </div>
      )}

      {/* Mobile Touch Controls (Auto-detected on touch / mobile devices ONLY) */}
      {phase === 'PLAYING' && isTouchMode && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-3 z-20 flex items-end justify-between px-4 sm:px-6"
          style={{ touchAction: 'none' }}
        >
          {/* Left Side: Semi-Transparent Virtual Analog Stick */}
          <div className="pointer-events-auto">
            <div
              onPointerDown={(e) => {
                e.preventDefault();
                gameAudio.unlock();
                joyPointerIdRef.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                updateJoystickFromEvent(e.clientX, e.clientY, e.currentTarget);
              }}
              onPointerMove={(e) => {
                if (joyPointerIdRef.current === e.pointerId) {
                  updateJoystickFromEvent(e.clientX, e.clientY, e.currentTarget);
                }
              }}
              onPointerUp={(e) => {
                if (joyPointerIdRef.current === e.pointerId) {
                  resetJoystick();
                }
              }}
              onPointerCancel={resetJoystick}
              aria-label="Mover"
              className="relative flex h-24 w-24 items-center justify-center rounded-full border border-white/25 bg-black/45 sm:h-28 sm:w-28"
            >
              <div className="pointer-events-none h-11 w-11 rounded-full border border-white/10" />
              <div
                ref={joyKnobRef}
                className="pointer-events-none absolute h-10 w-10 rounded-full border border-[#f5b65c]/75 bg-[#f5b65c]/40"
              />
            </div>
          </div>

          {/* Right Side: 4 Ergonomic Action Buttons (Saltar, Atacar, Esquivar, Habilidad) */}
          <div className="pointer-events-auto grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                triggerSkill();
              }}
              aria-label="Habilidad"
              className="flex h-13 w-16 flex-col items-center justify-center gap-0.5 rounded-xl border border-amber-300/40 bg-black/55 text-[#fde68a] active:scale-95 cursor-pointer"
            >
              <Sparkles className="h-4 w-4" />
              <span className="text-[10px] font-semibold">Habilidad</span>
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                triggerDash();
              }}
              aria-label="Esquivar"
              className="flex h-13 w-16 flex-col items-center justify-center gap-0.5 rounded-xl border border-white/25 bg-black/55 text-slate-100 active:scale-95 cursor-pointer"
            >
              <Wind className="h-4 w-4" />
              <span className="text-[10px] font-semibold">Esquivar</span>
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                triggerAttack();
              }}
              aria-label="Atacar"
              className="flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-xl border border-rose-400/55 bg-[#7f1d1d]/65 text-rose-100 active:scale-95 cursor-pointer"
            >
              <Hand className="h-4 w-4" />
              <span className="text-[10px] font-bold">Atacar</span>
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                triggerJump(true);
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                triggerJump(false);
              }}
              onPointerCancel={() => triggerJump(false)}
              aria-label="Saltar"
              className="flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-xl border border-sky-300/60 bg-[#0c4a6e]/70 text-sky-50 active:scale-95 cursor-pointer"
            >
              <ArrowUp className="h-4 w-4" />
              <span className="text-[10px] font-bold">Saltar</span>
            </button>
          </div>
        </div>
      )}

      {/* Prologue Controls */}
      {phase === 'PROLOGUE' && (
        <div className="fixed right-4 top-4 z-30 flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={muted ? 'Activar sonido' : 'Silenciar'}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 bg-black/65 text-white hover:bg-black cursor-pointer"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => beginTransitionToLevel(0, false)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#f5b65c]/40 bg-black/70 px-3.5 text-xs font-medium text-[#fef3c7] hover:bg-black cursor-pointer"
          >
            <SkipForward className="h-3.5 w-3.5" />
            Saltar
          </button>
        </div>
      )}

      {/* Epilogue 3D / 2D Ending Controls (Discreet top-right only) */}
      {(phase === 'EPILOGUE_REJECTION' || phase === 'ENDING_2D') && (
        <div className="fixed right-4 top-4 z-30 flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={muted ? 'Activar sonido' : 'Silenciar'}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 bg-black/65 text-white hover:bg-black cursor-pointer"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          {phase === 'EPILOGUE_REJECTION' ? (
            <button
              type="button"
              onClick={() => {
                ending2DTimeRef.current = 18.6;
                epilogueChordStepRef.current = -1;
                setGamePhase('ENDING_2D');
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/25 bg-black/70 px-3.5 text-xs font-medium text-white hover:bg-black cursor-pointer"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Saltar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setGamePhase('TITLE_MENU')}
              className="h-10 rounded-lg border border-[#1c1917]/20 bg-[#faf7f0]/90 px-4 text-xs font-semibold text-[#1c1917] hover:bg-white cursor-pointer"
            >
              Volver
            </button>
          )}
        </div>
      )}

      {/* Minimal Title Screen over Animated Backdrop */}
      {phase === 'TITLE_MENU' && (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-center p-6 text-center">
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={muted ? 'Activar sonido' : 'Silenciar'}
            className="fixed right-4 top-4 flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-black/50 text-[#e7e5e4] hover:bg-black/80 cursor-pointer"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          <h1 className="font-serif text-4xl font-bold tracking-wide text-[#faf7f0] drop-shadow-[0_4px_16px_rgba(0,0,0,0.85)] sm:text-6xl">
            La Senda de Sunmy
          </h1>

          <button
            type="button"
            onClick={startAdventure}
            className="mt-8 inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-lg border border-[#f5b65c]/60 bg-[#f5b65c] px-8 text-base font-bold text-[#11161c] shadow-lg transition-transform hover:scale-[1.02] hover:bg-[#f7c57c] active:scale-95 cursor-pointer"
          >
            <Play className="h-4 w-4 fill-current" />
            Comenzar
          </button>
        </div>
      )}

      {/* Minimal Pause Overlay */}
      {phase === 'PAUSED' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/72 p-4">
          <div className="w-full max-w-xs rounded-xl border border-white/15 bg-[#0d1119] p-6 text-center shadow-2xl">
            <h2 className="font-serif text-2xl font-bold text-[#faf7f0]">Pausa</h2>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => setGamePhase('PLAYING')}
                className="min-h-[44px] rounded-lg bg-[#f5b65c] font-semibold text-[#11161c] hover:bg-[#f7c57c] cursor-pointer"
              >
                Continuar
              </button>
              <button
                type="button"
                onClick={() => {
                  loadLevel(currentLevelIdx, false);
                  setGamePhase('PLAYING');
                }}
                className="min-h-[44px] rounded-lg border border-white/15 bg-white/5 font-medium text-white hover:bg-white/15 cursor-pointer"
              >
                Reiniciar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Minimal Game Over Overlay */}
      {phase === 'GAME_OVER' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/78 p-4">
          <div className="w-full max-w-xs rounded-xl border border-rose-500/35 bg-[#120b0e] p-6 text-center shadow-2xl">
            <h2 className="font-serif text-2xl font-bold text-[#fecdd3]">No puedo rendirme...</h2>
            <button
              type="button"
              onClick={() => {
                loadLevel(currentLevelIdx, false);
                setGamePhase('PLAYING');
              }}
              className="mt-5 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#dc2626] px-4 font-bold text-white hover:bg-[#ef4444] cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              Intentar de nuevo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
