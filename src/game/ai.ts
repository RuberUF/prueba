import { gameAudio } from './audio';
import { GROUND_Y } from './levels';
import type {
  EnemyState,
  LevelConfig,
  PlayerState,
  ProjectileState,
} from './types';

export interface AiCallbacks {
  onDamagePlayer: (amount: number, knockX: number, label: string, blockedFront: boolean) => void;
  onFloatingText: (x: number, y: number, text: string, color: string, scale?: number) => void;
  onSpawnParticles: (x: number, y: number, count: number, color: string, kind: 'spark' | 'dust' | 'ember' | 'ring', speed?: number) => void;
  onSpawnProjectile: (proj: Omit<ProjectileState, 'id'>) => void;
  onStoryBanner: (speaker: 'Kuro' | 'Voz' | 'Sunmy', text: string) => void;
  onCameraShake: (duration: number) => void;
}

export function stepEnemiesAI(
  enemies: EnemyState[],
  player: PlayerState,
  level: LevelConfig,
  dt: number,
  elapsed: number,
  insaneMult: number,
  cb: AiCallbacks
): void {
  const diffScale = (level.difficultyScale ?? 1) * insaneMult;
  const dmgMult = insaneMult * (1 + (level.id - 1) * 0.08);
  const spdFactor = Math.min(1.80, Math.pow(diffScale, 0.42));

  // Count how many melee hounds are actively engaging from Kuro's front so flankers split sides
  let frontMeleeCount = 0;
  for (const e of enemies) {
    if (
      e.state !== 'dead' &&
      e.role !== 'ranged' &&
      (e.state === 'chase' || e.state === 'windup' || e.state === 'attack') &&
      Math.sign(e.x - player.x) === player.facing
    ) {
      frontMeleeCount++;
    }
  }

  for (const en of enemies) {
    if (en.state === 'dead') continue;

    en.hitFlash = Math.max(0, en.hitFlash - dt);
    en.attackCooldown = Math.max(0, en.attackCooldown - dt);
    en.specialCooldown = Math.max(0, en.specialCooldown - dt);
    en.animPhase += dt;

    const isBoss = en.kind === 'alpha_guardian' || en.kind === 'siege_captain';
    const isAlphaBoss = en.kind === 'alpha_guardian';
    const isDrone = en.kind === 'drone_sentinel';
    const isArcher = en.kind === 'bolt_archer';
    const isLeaper = en.kind === 'hound_leaper' || en.kind === 'wolf_pack';
    const isShielded = en.kind === 'armored_hound' || en.kind === 'iron_knight' || isBoss;

    const decoy = !isBoss && player.ghostDecoy && player.ghostDecoy.life > 0 ? player.ghostDecoy : null;
    const decoyCloser = decoy ? Math.abs(decoy.x - en.x) < Math.abs(player.x - en.x) + 45 : false;
    const targetX = decoy && decoyCloser ? decoy.x : player.x;
    const targetY = decoy && decoyCloser ? decoy.y : player.y;

    const distX = targetX - en.x;
    const absDistX = Math.abs(distX);
    const absDistY = Math.abs((targetY - 18) - (en.y - 18));

    // Boss Multi-Phase Transitions!
    if (isAlphaBoss) {
      const hpRatio = en.hp / en.maxHp;
      if (en.bossPhase === 1 && hpRatio < 0.65) {
        en.bossPhase = 2;
        en.state = 'windup';
        en.stateTimer = 0.42;
        en.armor = Math.max(en.armor, 2);
        en.shieldUp = true;
        gameAudio.playBossPhase();
        cb.onCameraShake(0.32);
        cb.onFloatingText(en.x, en.y - 90, 'Fase II', '#fde047', 1.25);
        enemies.push({
          id: 920 + Math.floor(elapsed * 10),
          kind: 'hound_leaper',
          role: 'flanker',
          x: Math.max(80, en.x - 185),
          y: GROUND_Y,
          vx: 0,
          vy: 0,
          w: 44,
          h: 38,
          facing: 1,
          hp: Math.round(74 * insaneMult),
          maxHp: Math.round(74 * insaneMult),
          armor: 0,
          shieldUp: false,
          homeX: en.x - 140,
          baseY: GROUND_Y,
          patrolRadius: 240,
          state: 'chase',
          stateTimer: 0,
          attackCooldown: 0.4,
          animPhase: 0,
          grounded: true,
          hitFlash: 0,
          poiseHits: 0,
          alertLevel: 1,
          visionRange: 480,
          hearingRange: 300,
          lastHeardX: player.x,
          bossPhase: 1,
          hasRetreated: false,
          ambushHidden: false,
          specialCooldown: 1.5,
        });
      } else if (en.bossPhase === 2 && hpRatio < 0.34) {
        en.bossPhase = 3;
        en.state = 'windup';
        en.stateTimer = 0.34;
        gameAudio.playBossPhase();
        cb.onCameraShake(0.42);
        cb.onFloatingText(en.x, en.y - 96, 'Fase III', '#fb7185', 1.3);
        cb.onStoryBanner('Kuro', 'No puedo rendirme.');
        enemies.push({
          id: 960 + Math.floor(elapsed * 10),
          kind: 'wolf_pack',
          role: 'flanker',
          x: Math.min(level.length - 120, en.x + 150),
          y: GROUND_Y,
          vx: 0,
          vy: 0,
          w: 44,
          h: 38,
          facing: -1,
          hp: Math.round(68 * insaneMult),
          maxHp: Math.round(68 * insaneMult),
          armor: 0,
          shieldUp: false,
          homeX: en.x + 120,
          baseY: GROUND_Y,
          patrolRadius: 240,
          state: 'chase',
          stateTimer: 0,
          attackCooldown: 0.35,
          animPhase: 0,
          grounded: true,
          hitFlash: 0,
          poiseHits: 0,
          alertLevel: 1,
          visionRange: 500,
          hearingRange: 300,
          lastHeardX: player.x,
          bossPhase: 1,
          hasRetreated: false,
          ambushHidden: false,
          specialCooldown: 1.2,
        });
      }
    } else if (en.kind === 'siege_captain' && en.bossPhase === 1 && en.hp < en.maxHp * 0.5) {
      en.bossPhase = 2;
      en.armor = Math.max(en.armor, 2);
      gameAudio.playBossPhase();
      cb.onFloatingText(en.x, en.y - 80, '¡CAPITÁN ENFURECIDO!', '#fb923c', 1.25);
    }

    // Perception Check: Vision Cone + Stealth Cover + Noise Hearing
    const inFrontOfEnemy = distX === 0 || Math.sign(distX) === en.facing;
    const stealthMult =
      player.inStealthCover && player.crouching
        ? 0.32
        : player.crouching
        ? 0.58
        : 1.0;
    const effectiveVision = (inFrontOfEnemy ? en.visionRange : en.visionRange * 0.38) * stealthMult;
    const canSeePlayer = absDistX <= effectiveVision && absDistY < 170;
    const canHearPlayer =
      player.noiseLevel > 0.25 && absDistX <= en.hearingRange * player.noiseLevel;

    if (canSeePlayer) {
      en.alertLevel = Math.min(1, en.alertLevel + dt * (absDistX < 210 ? 5.2 : 3.0));
      en.lastHeardX = player.x;
    } else if (canHearPlayer) {
      en.alertLevel = Math.min(1, en.alertLevel + dt * 2.6);
      en.lastHeardX = player.x;
    } else if (en.state === 'patrol' || en.state === 'investigate') {
      en.alertLevel = Math.max(0, en.alertLevel - dt * 0.3);
    }

    // Ambush pop-out
    if (en.state === 'ambush_hide') {
      en.vx = 0;
      const ambushTriggerDist = player.crouching && player.inStealthCover ? 95 : 185;
      if (absDistX <= ambushTriggerDist && absDistY < 130) {
        en.ambushHidden = false;
        en.facing = distX >= 0 ? 1 : -1;
        en.state = 'windup';
        en.stateTimer = 0.22;
        en.alertLevel = 1;
        gameAudio.playHoundGrowl();
        cb.onFloatingText(en.x, en.y - 54, '¡EMBOSCADA!', '#fb7185', 1.15);
      }
      continue;
    }

    // Stagger / Stunned
    if (en.state === 'stagger' || en.state === 'stunned') {
      en.stateTimer -= dt;
      en.vx *= 0.85;
      en.shieldUp = false;
      if (en.stateTimer <= 0) {
        en.state = en.alertLevel > 0.5 ? 'chase' : 'patrol';
      }
    }
    // Windup before attack
    else if (en.state === 'windup') {
      en.stateTimer -= dt;
      en.vx *= 0.8;
      if (en.stateTimer <= 0) {
        if (isArcher || isDrone) {
          en.state = 'recover';
          en.stateTimer = 0.28;
          en.attackCooldown = (isDrone ? 1.15 : 1.06) / spdFactor;
          const dx = targetX - en.x;
          const dy = targetY - 20 - (en.y - 18);
          const len = Math.max(1, Math.hypot(dx, dy));
          const spd = (isDrone ? 405 : 460) * spdFactor;
          cb.onSpawnProjectile({
            x: en.x + (isDrone ? 0 : en.facing * 26),
            y: en.y - (isDrone ? 12 : 24),
            vx: isDrone ? (dx / len) * spd : en.facing * spd,
            vy: isDrone ? (dy / len) * spd : 0,
            radius: 8,
            fromEnemy: true,
            kind: isDrone ? 'plasma_bolt' : 'bolt',
            damage: Math.round((isDrone ? 18 : 21) * dmgMult),
            life: 3.2,
          });
          // Elite Bolt Archers on Lv 6+ loose a staggered dual fan bolt
          if (isArcher && level.id >= 6) {
            cb.onSpawnProjectile({
              x: en.x + en.facing * 24,
              y: en.y - 34,
              vx: en.facing * spd * 0.92,
              vy: -36,
              radius: 7,
              fromEnemy: true,
              kind: 'bolt',
              damage: Math.round(16 * dmgMult),
              life: 2.8,
            });
          }
        } else {
          en.state = 'attack';
          const phaseSpdBoost = isAlphaBoss && en.bossPhase === 3 ? 1.38 : 1.12;
          en.stateTimer = isBoss ? 0.32 : 0.25;
          en.vx = en.facing * (isBoss ? 475 : isLeaper ? 430 : 380) * spdFactor * phaseSpdBoost;
          if ((isLeaper || (isBoss && en.bossPhase >= 2)) && en.grounded && Math.abs(distX) > 65) {
            en.vy = -360;
            en.grounded = false;
          }
          gameAudio.playHoundGrowl();

          // Siege Captain Phase 2 fires flaming cross-bolt during lunge
          if (en.kind === 'siege_captain' && en.bossPhase >= 2 && en.specialCooldown <= 0) {
            en.specialCooldown = 1.75;
            cb.onSpawnProjectile({
              x: en.x + en.facing * 32,
              y: GROUND_Y - 26,
              vx: en.facing * 410,
              vy: 0,
              radius: 10,
              fromEnemy: true,
              kind: 'plasma_bolt',
              damage: Math.round(18 * dmgMult),
              life: 2.2,
            });
          }

          // Phase 2/3 Alpha Guardian fires double lunar shockwaves + Phase 3 falling meteors!
          if (isAlphaBoss && en.bossPhase >= 2 && en.specialCooldown <= 0) {
            en.specialCooldown = en.bossPhase === 3 ? 1.5 : 2.3;
            cb.onSpawnProjectile({
              x: en.x + en.facing * 42,
              y: GROUND_Y - 24,
              vx: en.facing * 400,
              vy: 0,
              radius: 22,
              fromEnemy: true,
              kind: 'rejection_wave',
              damage: Math.round(20 * dmgMult),
              life: 2.8,
            });
            if (en.bossPhase === 3) {
              for (let m = -1; m <= 1; m += 2) {
                cb.onSpawnProjectile({
                  x: player.x + m * 68,
                  y: GROUND_Y - 265,
                  vx: 0,
                  vy: 295,
                  radius: 11,
                  fromEnemy: true,
                  kind: 'ember_fall',
                  damage: Math.round(18 * dmgMult),
                  life: 1.6,
                });
              }
            }
          }
        }
      }
    }
    // Active Attack Lunge
    else if (en.state === 'attack') {
      en.stateTimer -= dt;
      if (Math.abs(player.x - en.x) < en.w * 0.58 + 16 && Math.abs(player.y - en.y) < 48) {
        const hitFront = Math.sign(en.x - player.x) === player.facing || player.blocking;
        cb.onDamagePlayer(
          Math.round((isBoss ? 29 : 20) * dmgMult),
          en.facing * 265,
          isBoss ? '¡Zarpazo Alfa!' : en.kind === 'iron_knight' ? '¡Mandoble!' : '¡Mordida!',
          hitFront
        );
      }
      if (en.stateTimer <= 0) {
        en.state = 'recover';
        const phaseMult = isAlphaBoss && en.bossPhase === 3 ? 0.65 : 0.85;
        en.stateTimer = ((isBoss ? 0.34 : 0.4) / spdFactor) * phaseMult;
        en.attackCooldown = ((isBoss ? 0.7 : 0.88) / spdFactor) * phaseMult;
      }
    }
    // Recover after strike
    else if (en.state === 'recover') {
      en.stateTimer -= dt;
      en.vx *= 0.85;
      if (en.stateTimer <= 0) {
        en.state = en.alertLevel > 0.4 ? 'chase' : 'patrol';
      }
    }
    // Retreat when low HP (<28%, non-boss, one tactical retreat)
    else if (en.state === 'retreat') {
      en.stateTimer -= dt;
      const awayDir = player.x >= en.x ? -1 : 1;
      en.facing = -awayDir as 1 | -1; // keep looking warily back at Kuro
      en.vx = awayDir * 155 * spdFactor;
      if (en.stateTimer <= 0 || absDistX > 290) {
        en.state = 'chase';
        en.hp = Math.min(en.maxHp, en.hp + Math.round(en.maxHp * 0.12));
        cb.onFloatingText(en.x, en.y - 46, '¡Reagrupado!', '#fca5a5', 0.9);
      }
    }
    // Patrol / Investigate / Chase / Flank / Guard Ally
    else {
      // Trigger Last-Breath Enrage on elites (<35% HP) or tactical retreat on scouts
      if (
        !isBoss &&
        !isDrone &&
        !en.hasRetreated &&
        en.hp > 0 &&
        en.hp < en.maxHp * 0.34 &&
        absDistX < 210
      ) {
        en.hasRetreated = true;
        if (en.kind === 'armored_hound' || en.kind === 'iron_knight' || en.kind === 'wolf_pack') {
          en.attackCooldown = 0.05;
          en.state = 'windup';
          en.stateTimer = 0.19;
          en.facing = distX >= 0 ? 1 : -1;
          cb.onFloatingText(en.x, en.y - 50, '¡FURIA ROJA!', '#fb7185', 1.0);
        } else {
          en.state = 'retreat';
          en.stateTimer = 1.35;
          cb.onFloatingText(en.x, en.y - 46, '¡Se retira!', '#93c5fd', 0.85);
          continue;
        }
      }

      if (en.alertLevel >= 0.65 || (isBoss && absDistX < 560)) {
        // Check if Protector should shield a nearby ranged ally
        if (en.role === 'protector' && isShielded) {
          const allyArcher = enemies.find(
            (a) => a.state !== 'dead' && a.kind === 'bolt_archer' && Math.abs(a.x - en.x) < 280
          );
          if (allyArcher && absDistX > 130) {
            en.facing = distX >= 0 ? 1 : -1;
            const guardPosX = allyArcher.x + Math.sign(player.x - allyArcher.x || -1) * 65;
            const deltaG = guardPosX - en.x;
            en.vx = Math.abs(deltaG) > 18 ? Math.sign(deltaG) * 125 * spdFactor : 0;
            en.shieldUp = true;
            if (absDistX <= 115 && en.attackCooldown <= 0) {
              en.state = 'windup';
              en.stateTimer = Math.max(0.24, 0.36 / spdFactor);
            }
            // skip default chase
            gotoPhysics(en, level, dt, elapsed);
            continue;
          }
        }

        en.facing = distX >= 0 ? 1 : -1;
        en.shieldUp = isShielded;

        // Flanking behavior if enemy is flanker or front is already crowded
        const shouldFlank =
          !isBoss &&
          !isArcher &&
          !isDrone &&
          (en.role === 'flanker' || (frontMeleeCount >= 2 && Math.sign(en.x - player.x) === player.facing)) &&
          absDistX < 210 &&
          absDistX > 65;

        if (shouldFlank) {
          en.state = 'flank';
          const behindTargetX = player.x - player.facing * 78;
          const dFlank = behindTargetX - en.x;
          en.vx = Math.sign(dFlank || 1) * 195 * spdFactor;
          if (en.grounded && absDistX < 90 && en.specialCooldown <= 0) {
            // Leap right over Kuro's head to flank!
            en.vy = -420;
            en.grounded = false;
            en.specialCooldown = 2.6;
          }
        } else {
          en.state = 'chase';
          const attackDist = isArcher || isDrone ? 420 : isBoss ? 156 : isLeaper ? 148 : 114;
          if (absDistX <= attackDist && en.attackCooldown <= 0) {
            en.state = 'windup';
            en.stateTimer = Math.max(0.18, (isArcher || isDrone ? 0.36 : 0.27) / spdFactor);
          } else if (isDrone) {
            en.vx = absDistX > 210 ? en.facing * 130 * spdFactor : 0;
          } else if (!isArcher) {
            const baseSpd = isLeaper ? 185 : en.kind === 'swamp_stalker' ? 168 : isBoss ? 180 : 145;
            en.vx = en.facing * baseSpd * spdFactor;
            if (isLeaper && en.grounded && player.y < en.y - 55 && absDistX < 220) {
              en.vy = -450;
              en.grounded = false;
            }
          } else {
            en.vx = 0;
          }
        }
      } else if (en.alertLevel >= 0.25 && en.lastHeardX !== null) {
        // Investigate last heard noise or glimpse!
        en.state = 'investigate';
        const dNoise = en.lastHeardX - en.x;
        en.facing = dNoise >= 0 ? 1 : -1;
        en.vx = Math.abs(dNoise) > 22 ? en.facing * 88 * spdFactor : 0;
      } else {
        // Calm Patrol
        en.state = 'patrol';
        en.shieldUp = isShielded && en.armor > 0;
        if (en.x > en.homeX + en.patrolRadius) en.facing = -1;
        if (en.x < en.homeX - en.patrolRadius) en.facing = 1;
        en.vx = en.facing * 60 * spdFactor;
      }
    }

    gotoPhysics(en, level, dt, elapsed);
  }
}

function gotoPhysics(en: EnemyState, level: LevelConfig, dt: number, elapsed: number): void {
  if (en.kind === 'drone_sentinel') {
    en.y = en.baseY + Math.sin(elapsed * 2.6 + en.id) * 14;
  } else {
    en.vy += 1280 * dt;
    en.y += en.vy * dt;
    if (en.y >= GROUND_Y) {
      en.y = GROUND_Y;
      en.vy = 0;
      en.grounded = true;
    }
  }
  en.x = Math.max(40, Math.min(level.length - 80, en.x + en.vx * dt));
}
