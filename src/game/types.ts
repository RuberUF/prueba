export type GamePhase =
  | 'TITLE_MENU'
  | 'PROLOGUE'
  | 'TRANSITION'
  | 'PLAYING'
  | 'PAUSED'
  | 'GAME_OVER'
  | 'EPILOGUE_REJECTION'
  | 'ENDING_2D';

export type QualityTier = 'high' | 'medium' | 'low';

export type AnimationStyleMode =
  | 'kindergarten'
  | 'sumi_scroll'
  | 'blender_3d'
  | 'cgi_realistic'
  | 'rec_horror'
  | 'spiderverse'
  | 'watercolor_anime'
  | 'pixar_3d';

export type BackdropKey =
  | 'stray_alley'
  | 'medieval_castle'
  | 'bamboo_plate'
  | 'pixar_sanctuary';

export type BiomeId =
  | 'jungle_edge'
  | 'stray_alley'
  | 'whisper_river'
  | 'ash_battlefield'
  | 'rec_swamp'
  | 'hound_bridge'
  | 'bamboo_curse'
  | 'ruined_keep'
  | 'frost_torrent'
  | 'siege_ramparts'
  | 'lunar_sanctuary';

export type CatAnimState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'jump'
  | 'double_jump'
  | 'fall'
  | 'landing'
  | 'climb'
  | 'swim'
  | 'crawl'
  | 'stealth'
  | 'attack'
  | 'punch'
  | 'dodge'
  | 'hurt'
  | 'death'
  | 'victory'
  | 'exhausted';

export type CatEmotion =
  | 'calm'
  | 'fear'
  | 'exhausted'
  | 'pain'
  | 'anger'
  | 'sadness';

export type EnemyKind =
  | 'crayon_pup'
  | 'stray_mongrel'
  | 'drone_sentinel'
  | 'scout_hound'
  | 'wolf_pack'
  | 'armored_hound'
  | 'iron_knight'
  | 'swamp_stalker'
  | 'bolt_archer'
  | 'hound_leaper'
  | 'siege_captain'
  | 'alpha_guardian';

export type EnemyRole =
  | 'vanguard'
  | 'flanker'
  | 'protector'
  | 'ambusher'
  | 'ranged'
  | 'boss';

export type EnemyAIState =
  | 'patrol'
  | 'investigate'
  | 'chase'
  | 'flank'
  | 'ambush_hide'
  | 'guard_ally'
  | 'retreat'
  | 'windup'
  | 'attack'
  | 'recover'
  | 'stagger'
  | 'stunned'
  | 'dead';

export interface PlatformDef {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'stone' | 'wood' | 'bridge' | 'ruin' | 'ice' | 'root' | 'neon_catwalk' | 'parchment';
  moveAxis?: 'x' | 'y';
  moveRange?: number;
  moveSpeed?: number;
  crumbleDelay?: number;
  slippery?: boolean;
}

export interface ActivePlatformState extends PlatformDef {
  id: number;
  curX: number;
  curY: number;
  dx: number;
  dy: number;
  crumbleTimer: number;
  brokenTimer: number;
}

export interface ClimbableDef {
  x: number;
  w: number;
  yBottom: number;
  yTop: number;
  kind: 'tree_trunk' | 'vine' | 'ivy_wall' | 'bamboo_pole' | 'tower_ladder';
}

export interface TrapDef {
  x: number;
  y: number;
  w: number;
  kind: 'spikes' | 'dart_wall' | 'icicle_drop' | 'fire_jet' | 'pendulum_blade';
  interval?: number;
  phaseOffset?: number;
  dir?: 1 | -1;
  length?: number;
}

export interface PuzzleGateDef {
  id: string;
  switchX: number;
  switchY: number;
  gateX: number;
  gateHeight: number;
  kind: 'pressure_rune' | 'lever_terminal' | 'ink_seal';
  hint: string;
}

export interface ActivePuzzleGate extends PuzzleGateDef {
  solved: boolean;
  openProgress: number;
}

export interface StealthCoverDef {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'tall_grass' | 'shadow_crate' | 'bamboo_thicket' | 'mist_reed';
}

export interface SecretZoneDef {
  x: number;
  y: number;
  kind: 'collar_fragment' | 'moon_pearl' | 'ancient_scroll';
  title: string;
  loreText: string;
}

export interface ActiveSecretZone extends SecretZoneDef {
  collected: boolean;
}

export interface HazardZoneDef {
  x: number;
  w: number;
  kind: 'river' | 'swamp' | 'chasm' | 'fire_trench';
  currentForce?: number;
}

export interface EnemySpawnDef {
  x: number;
  y?: number;
  kind: EnemyKind;
  patrolRadius?: number;
  role?: EnemyRole;
  ambush?: boolean;
}

export interface PickupDef {
  x: number;
  y: number;
  kind: 'lotus_heal' | 'ember_fury' | 'fish_ration';
}

export interface WorldObjectDef {
  x: number;
  y?: number;
  kind: 'memory_beacon' | 'supply_crate' | 'scratch_post';
  loreText?: string;
}

export interface ActiveWorldObject extends WorldObjectDef {
  id: number;
  activated: boolean;
  hp: number;
  pulsePhase: number;
}

export interface StoryTriggerDef {
  x: number;
  text: string;
  speaker: 'Kuro' | 'Voz' | 'Sunmy';
}

export interface LevelEventDef {
  x: number;
  title: string;
  subtitle: string;
  eventKind: 'ambush_pack' | 'avalanche' | 'drone_sweep' | 'siege_barrage' | 'boss_intro';
}

export type LevelFocus = 'platform_only' | 'combat_only';

export interface LevelConfig {
  id: number;
  title: string;
  subtitle: string;
  focus: LevelFocus;
  focusLabel: string;
  biome: BiomeId;
  styleMode: AnimationStyleMode;
  secondaryStyleMode?: AnimationStyleMode;
  styleLabel: string;
  length: number;
  groundY: number;
  skyColors: [string, string, string];
  fogColor: string;
  accentColor: string;
  hasRain?: boolean;
  hasEmbers?: boolean;
  hasSnow?: boolean;
  hasWind?: boolean;
  windForce?: number;
  hasRejectionWaves?: boolean;
  rejectionWaveInterval?: number;
  platforms: PlatformDef[];
  climbables: ClimbableDef[];
  traps: TrapDef[];
  puzzles: PuzzleGateDef[];
  stealthCovers: StealthCoverDef[];
  secretZone: SecretZoneDef;
  hazards: HazardZoneDef[];
  enemies: EnemySpawnDef[];
  pickups: PickupDef[];
  worldObjects: WorldObjectDef[];
  storyBeats: StoryTriggerDef[];
  events?: LevelEventDef[];
  backdropKey?: BackdropKey;
  use3DCat?: boolean;
  difficultyScale: number;
  introLine: string;
  sideMissionLabel: string;
}

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  facing: 1 | -1;
  grounded: boolean;
  onIce: boolean;
  inWater: boolean;
  inSwamp: boolean;
  climbing: boolean;
  climbSurfaceX: number | null;
  crouching: boolean;
  crawling: boolean;
  sprinting: boolean;
  inStealthCover: boolean;
  blocking: boolean;
  parryWindow: number;
  counterReadyTimer: number;
  crouchCharge: number;
  chargeAttackTimer: number;
  isChargingAttack: boolean;
  meowTimer: number;
  meowCooldown: number;
  coyoteTimer: number;
  jumpBuffer: number;
  jumpsLeft: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  hunger: number;
  maxHunger: number;
  invulnTimer: number;
  attackTimer: number;
  attackCooldown: number;
  punchTimer: number;
  comboStep: number;
  pounceTimer: number;
  dashTimer: number;
  dashCooldown: number;
  hurtTimer: number;
  landingTimer: number;
  deathTimer: number;
  victoryTimer: number;
  animTime: number;
  strideAccum: number;
  animState: CatAnimState;
  emotion: CatEmotion;
  noiseLevel: number;
  trail: Array<{ x: number; y: number; facing: 1 | -1; alpha: number; style: AnimationStyleMode }>;
  comboHits: number;
  comboResetTimer: number;
  punchChain: number;
  feverTimer: number;
  wallKickCooldown: number;
  ghostDecoy: { x: number; y: number; facing: 1 | -1; life: number } | null;
  score: number;
  secretsFound: number;
  beaconsActivated: number;
  sideQuestComplete: boolean;
  lastSafeX: number;
  lastSafeY: number;
}

export interface EnemyState {
  id: number;
  kind: EnemyKind;
  role: EnemyRole;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  armor: number;
  shieldUp: boolean;
  homeX: number;
  baseY: number;
  patrolRadius: number;
  state: EnemyAIState;
  stateTimer: number;
  attackCooldown: number;
  animPhase: number;
  grounded: boolean;
  hitFlash: number;
  poiseHits: number;
  alertLevel: number;
  visionRange: number;
  hearingRange: number;
  lastHeardX: number | null;
  bossPhase: 1 | 2 | 3;
  hasRetreated: boolean;
  ambushHidden: boolean;
  specialCooldown: number;
}

export interface ProjectileState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  fromEnemy: boolean;
  kind: 'bolt' | 'rejection_wave' | 'ember_fall' | 'claw_wave' | 'plasma_bolt' | 'icicle' | 'dart';
  damage: number;
  life: number;
}

export interface ParticleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
  kind: 'spark' | 'blood_ink' | 'splash' | 'petal' | 'halftone' | 'dust' | 'ember' | 'crayon' | 'ring';
}

export interface FloatingTextState {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

export interface ActivePickupState extends PickupDef {
  id: number;
  collected: boolean;
  bobPhase: number;
}

export interface GameInputState {
  moveX: number; // -1..1 analog (virtual joystick or digital keys)
  moveY: number; // -1 (up/climb) .. 1 (down/crouch)
  left: boolean;
  right: boolean;
  upHeld: boolean;
  crouchHeld: boolean;
  sprintHeld: boolean;
  blockHeld: boolean;
  blockPressed: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  attackPressed: boolean;
  punchPressed: boolean;
  dashPressed: boolean;
  heavyHeld: boolean;
  heavyReleased: boolean;
  pouncePressed: boolean;
  meowPressed: boolean;
}
