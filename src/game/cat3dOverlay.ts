import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  buildArticulatedBlackCat,
  type CatRig,
  createCatIrisTextures,
  createHoudiniFurTextures,
  createInnerEarTextures,
  createNoseLeatherTextures,
  createPawPadTextures,
  detectSoftwareGl,
  poseCatFrontLegIk,
  poseCatHindLegIk,
} from '../utils/cgiCatScene';
import { GROUND_Y, LOGICAL_HEIGHT } from './levels';
import type {
  AnimationStyleMode,
  CatAnimState,
  CatEmotion,
  PlayerState,
  QualityTier,
} from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export interface Cat3DOverlayController {
  setVisible: (visible: boolean) => void;
  setQualityTier: (tier: QualityTier) => void;
  resize: (viewW: number, viewH: number) => void;
  syncGameplay: (
    viewW: number,
    viewH: number,
    player: PlayerState,
    camX: number,
    logicalW: number,
    elapsed: number,
    dt: number,
    style: AnimationStyleMode,
    nearestThreatDx: number | null
  ) => void;
  renderPixarEpilogue: (viewW: number, viewH: number, t: number) => void;
  dispose: () => void;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.82)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.36)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createStrayCollarMesh(disposables: Array<{ dispose: () => void }>): THREE.Group {
  const group = new THREE.Group();
  const collarGeo = new THREE.TorusGeometry(0.056, 0.009, 12, 28);
  const collarMat = new THREE.MeshStandardMaterial({
    color: 0xb91c1c,
    roughness: 0.36,
    metalness: 0.18,
  });
  const collar = new THREE.Mesh(collarGeo, collarMat);
  collar.rotation.x = Math.PI * 0.42;
  group.add(collar);

  const tagGeo = new THREE.SphereGeometry(0.012, 14, 12);
  const tagMat = new THREE.MeshPhysicalMaterial({
    color: 0xfbbf24,
    roughness: 0.16,
    metalness: 0.9,
    clearcoat: 0.8,
    emissive: new THREE.Color(0xf59e0b),
    emissiveIntensity: 0.35,
  });
  const tag = new THREE.Mesh(tagGeo, tagMat);
  tag.position.set(0, -0.052, 0.038);
  group.add(tag);

  disposables.push(collarGeo, collarMat, tagGeo, tagMat);
  return group;
}

interface SmoothedRigState {
  crouchW: number;
  crawlW: number;
  stealthW: number;
  climbW: number;
  swimW: number;
  exhaustW: number;
  hurtW: number;
  deathW: number;
  victoryW: number;
  blockW: number;
  landingW: number;
  jawOpen: number;
  clawExtend: number;
  earRadar: number;
}

function applyFacialExpression(
  rig: CatRig,
  emotion: CatEmotion,
  t: number,
  jawOpen: number,
  earRadar: number,
  meowLift: number,
  attackArch: number
): void {
  // Pupil dilation & eyelid/brow targets by feline emotion
  let dilateX = 0.95;
  let upperLidScale = 0.08;
  let lowerLidScale = 0.06;
  let browTilt = 0.0;
  let browDrop = 0.0;
  let earPin = 0.0;
  let earSpread = 0.0;

  switch (emotion) {
    case 'fear':
      dilateX = 2.05;
      upperLidScale = 0.03;
      lowerLidScale = 0.04;
      browTilt = -0.26;
      browDrop = 0.002;
      earPin = 0.58;
      earSpread = 0.42;
      break;
    case 'anger':
      dilateX = 0.72;
      upperLidScale = 0.28;
      lowerLidScale = 0.22;
      browTilt = 0.42;
      browDrop = -0.0028;
      earPin = 0.65;
      earSpread = 0.35;
      break;
    case 'pain':
      dilateX = 1.45;
      upperLidScale = 0.72;
      lowerLidScale = 0.62;
      browTilt = -0.32;
      browDrop = -0.0018;
      earPin = 0.68;
      earSpread = 0.48;
      break;
    case 'exhausted':
      dilateX = 1.25;
      upperLidScale = 0.52;
      lowerLidScale = 0.32;
      browTilt = -0.18;
      browDrop = -0.0015;
      earPin = 0.34;
      earSpread = 0.3;
      break;
    case 'sadness':
      dilateX = 1.82;
      upperLidScale = 0.34;
      lowerLidScale = 0.26;
      browTilt = -0.38;
      browDrop = 0.0012;
      earPin = 0.52;
      earSpread = 0.44;
      break;
    default:
      dilateX = 1.0 + attackArch * 0.25 + meowLift * 0.3;
      break;
  }

  rig.pupilLeft.scale.set(clamp(dilateX, 0.62, 2.15), 1.0, 1.0);
  rig.pupilRight.scale.set(clamp(dilateX, 0.62, 2.15), 1.0, 1.0);

  // Natural blink pulse every ~3.4s
  const blinkCycle = t % 3.4;
  const blinkEnv = blinkCycle < 0.14 ? Math.sin((blinkCycle / 0.14) * Math.PI) : 0;
  const finalUpper = Math.max(upperLidScale, blinkEnv * 0.96);

  rig.eyelidLeft.scale.y = finalUpper;
  rig.eyelidRight.scale.y = finalUpper;
  rig.lowerLidLeft.scale.y = lowerLidScale;
  rig.lowerLidRight.scale.y = lowerLidScale;

  rig.browLeft.rotation.z = browTilt;
  rig.browRight.rotation.z = -browTilt;
  rig.browLeft.position.y = 0.0145 + browDrop;
  rig.browRight.position.y = 0.0145 + browDrop;

  // Articulated lower jaw (snarl/meow/pant/sadness)
  rig.jawPivot.rotation.x = clamp(jawOpen, 0, 0.58);

  // Ears react to threat direction (radar) + emotion
  const twitchL = Math.sin(t * 2.9) * 0.04 + (earRadar < 0 ? -0.16 : 0.05) * Math.abs(earRadar);
  const twitchR = Math.cos(t * 2.5) * 0.04 + (earRadar > 0 ? -0.16 : 0.05) * Math.abs(earRadar);
  rig.earLeft.rotation.set(
    -earPin - attackArch * 0.2 + meowLift * 0.18 + twitchL,
    earRadar * 0.26,
    0.12 + earSpread
  );
  rig.earRight.rotation.set(
    -earPin - attackArch * 0.2 + meowLift * 0.18 + twitchR,
    earRadar * 0.26,
    -0.12 - earSpread
  );
}

function animateCatPose19(
  rig: CatRig,
  smooth: SmoothedRigState,
  dt: number,
  t: number,
  animState: CatAnimState,
  emotion: CatEmotion,
  stridePhase: number,
  speedNorm: number,
  vy: number,
  attackProgress: number,
  punchProgress: number,
  comboStep: number,
  isBlocking: boolean,
  isCharging: boolean,
  crouchCharge: number,
  meowTimer: number,
  sitBlend: number,
  headLookYaw: number,
  headPitchOffset: number,
  earRadarTarget: number
): void {
  const damp = (cur: number, target: number, lambda: number) =>
    THREE.MathUtils.damp(cur, target, lambda, Math.max(0.001, dt));

  const isCrouch = animState === 'stealth' || animState === 'crawl';
  const isCrawl = animState === 'crawl';
  const isStealth = animState === 'stealth';
  const isClimb = animState === 'climb';
  const isSwim = animState === 'swim';
  const isExhausted = animState === 'exhausted';
  const isHurt = animState === 'hurt';
  const isDeath = animState === 'death';
  const isVictory = animState === 'victory';
  const isLanding = animState === 'landing';

  smooth.crouchW = damp(smooth.crouchW, isCrouch ? 1 : 0, 14);
  smooth.crawlW = damp(smooth.crawlW, isCrawl ? 1 : 0, 14);
  smooth.stealthW = damp(smooth.stealthW, isStealth ? 1 : 0, 14);
  smooth.climbW = damp(smooth.climbW, isClimb ? 1 : 0, 16);
  smooth.swimW = damp(smooth.swimW, isSwim ? 1 : 0, 12);
  smooth.exhaustW = damp(smooth.exhaustW, isExhausted ? 1 : 0, 8);
  smooth.hurtW = damp(smooth.hurtW, isHurt ? 1 : 0, 20);
  smooth.deathW = damp(smooth.deathW, isDeath ? 1 : 0, 9);
  smooth.victoryW = damp(smooth.victoryW, isVictory ? 1 : 0, 10);
  smooth.blockW = damp(smooth.blockW, isBlocking ? 1 : 0, 18);
  smooth.landingW = damp(smooth.landingW, isLanding ? 1 : 0, 18);
  smooth.earRadar = damp(smooth.earRadar, earRadarTarget, 10);

  const grounded =
    animState !== 'jump' &&
    animState !== 'double_jump' &&
    animState !== 'fall' &&
    !isClimb &&
    !isSwim;

  const isSprint = animState === 'sprint' || animState === 'dodge';
  const isRun = animState === 'run' || isSprint;

  const attackArch = attackProgress > 0 ? Math.sin(attackProgress * Math.PI) : 0;
  const punchArch = punchProgress > 0 ? Math.sin(punchProgress * Math.PI) : 0;
  const combinedStrike = Math.max(attackArch, punchArch);
  const meowLift = meowTimer > 0 ? Math.sin(clamp(meowTimer / 0.36, 0, 1) * Math.PI) : 0;

  const targetJaw = Math.max(
    meowLift * 0.44,
    combinedStrike * 0.34,
    smooth.hurtW * 0.36,
    smooth.exhaustW * (0.14 + Math.sin(t * 7.5) * 0.08),
    emotion === 'sadness' ? 0.06 + Math.sin(t * 4) * 0.025 : 0
  );
  smooth.jawOpen = damp(smooth.jawOpen, targetJaw, 20);

  const targetClaw =
    combinedStrike > 0.05 || isClimb || isCharging || smooth.blockW > 0.3 ? 1.55 : 0.55;
  smooth.clawExtend = damp(smooth.clawExtend, targetClaw, 18);
  for (let c = 0; c < rig.claws.length; c++) {
    const cs = smooth.clawExtend;
    rig.claws[c].scale.set(0.7 + cs * 0.32, 0.7 + cs * 0.32, cs);
  }

  // Spine & Body Pitch / Roll
  const breathRate = smooth.exhaustW > 0.3 ? 6.2 : 2.3;
  const breath = Math.sin(t * breathRate) * (0.0032 + smooth.exhaustW * 0.0045);

  const gallopAmp = isSprint ? 0.026 : isRun ? 0.019 : 0.009;
  const airTuck = !grounded ? clamp(-vy / 560, -0.85, 1.0) : 0;
  const doubleSpin = animState === 'double_jump' ? Math.sin(t * 14) * 0.018 : 0;

  let hipY =
    0.205 +
    (grounded ? Math.abs(Math.sin(stridePhase)) * gallopAmp * speedNorm : 0.018) -
    smooth.crouchW * 0.072 -
    smooth.crawlW * 0.038 -
    smooth.landingW * 0.065 -
    smooth.exhaustW * 0.045 -
    smooth.deathW * 0.14 +
    breath;
  let hipZ = -0.152 - smooth.crouchW * 0.024 - (isSprint ? 0.022 : 0);

  let chestY =
    0.188 +
    (grounded ? Math.abs(Math.cos(stridePhase)) * gallopAmp * speedNorm : 0.024) -
    smooth.crouchW * 0.078 -
    smooth.crawlW * 0.042 -
    smooth.landingW * 0.078 -
    smooth.exhaustW * 0.042 -
    smooth.blockW * 0.032 -
    smooth.deathW * 0.13 +
    breath * 1.15;
  let chestZ = 0.132 + smooth.crouchW * 0.022 + (isSprint ? 0.024 : 0);

  let neckY =
    0.246 +
    combinedStrike * 0.024 +
    meowLift * 0.030 -
    smooth.crouchW * 0.068 -
    smooth.crawlW * 0.042 -
    smooth.landingW * 0.06 -
    smooth.exhaustW * 0.048 +
    smooth.victoryW * 0.045 -
    smooth.deathW * 0.14 +
    breath;
  let neckZ = 0.214 + (isSprint ? 0.038 : 0) + smooth.crouchW * 0.026 - smooth.blockW * 0.018;

  if (!grounded && !isClimb && !isSwim) {
    hipY += airTuck * 0.034 + doubleSpin;
    chestY += airTuck * 0.056;
    neckY += airTuck * 0.052;
  }

  if (isSwim) {
    const swimBob = Math.sin(t * 6.5) * 0.014;
    hipY = 0.155 + swimBob;
    chestY = 0.21 + swimBob * 0.7;
    neckY = 0.275 + Math.cos(t * 6.5) * 0.008;
  }

  if (sitBlend > 0.001) {
    hipY = lerp(hipY, 0.072 + breath * 0.3, sitBlend);
    hipZ = lerp(hipZ, -0.105, sitBlend);
    chestY = lerp(chestY, 0.216 + breath * 0.7, sitBlend);
    chestZ = lerp(chestZ, 0.055, sitBlend);
    neckY = lerp(neckY, 0.305 + breath, sitBlend);
    neckZ = lerp(neckZ, 0.122, sitBlend);
  }

  // Body pitch/roll for climbing vertical walls, double-jump tuck, hurt knockback, death slump
  rig.bodyGroup.rotation.x = lerp(
    0,
    -Math.PI * 0.42,
    smooth.climbW
  ) + smooth.hurtW * -0.22 + smooth.victoryW * -0.16;
  rig.bodyGroup.rotation.z = smooth.deathW * 1.28 + (animState === 'dodge' ? Math.sin(t * 20) * 0.16 : 0);

  const spineSway = Math.sin(stridePhase) * (isSprint ? 0.018 : 0.011) * speedNorm * (1 - sitBlend);
  const chargeWiggle = isCharging || crouchCharge > 0.5 ? Math.sin(t * 30) * 0.014 : 0;
  rig.spinePoints[0].set(-spineSway * 0.6 + chargeWiggle, hipY, hipZ - 0.035);
  rig.spinePoints[1].set(
    -spineSway * 0.3 + chargeWiggle * 0.6,
    lerp(hipY, chestY, 0.35) + sitBlend * 0.02 + smooth.crouchW * 0.015 + smooth.blockW * 0.022,
    lerp(hipZ, chestZ, 0.35)
  );
  rig.spinePoints[2].set(
    spineSway * 0.35,
    lerp(hipY, chestY, 0.68) + sitBlend * 0.018 + smooth.blockW * 0.018,
    lerp(hipZ, chestZ, 0.68)
  );
  rig.spinePoints[3].set(spineSway * 0.55, chestY + 0.01, chestZ);
  rig.spinePoints[4].set(0, neckY, neckZ);

  rig.torso.updateFromSpine(
    rig.spinePoints,
    0.0035 + attackArch * 0.004,
    0.0035 + punchArch * 0.004,
    breath * 0.85
  );

  rig.headPivot.position.set(
    rig.spinePoints[4].x,
    rig.spinePoints[4].y + 0.008,
    rig.spinePoints[4].z + 0.016
  );

  const basePitch = isClimb
    ? 0.38
    : isSwim
    ? -0.24
    : !grounded
    ? -airTuck * 0.22
    : smooth.exhaustW > 0.4
    ? 0.22
    : smooth.crouchW > 0.4
    ? -0.14
    : 0.05;

  rig.headPivot.rotation.set(
    basePitch - meowLift * 0.34 + headPitchOffset + smooth.hurtW * -0.26 + Math.sin(t * 2.1) * 0.025,
    headLookYaw + combinedStrike * (comboStep % 2 === 0 ? 0.18 : -0.18),
    combinedStrike * 0.14 + (smooth.exhaustW > 0.4 ? Math.sin(t * 2.4) * 0.08 : 0)
  );

  applyFacialExpression(
    rig,
    emotion,
    t,
    smooth.jawOpen,
    smooth.earRadar,
    meowLift,
    combinedStrike
  );

  // Expressive Tail Dynamics across states
  const tailSpeed = isSprint ? 10.5 : isRun ? 7.8 : smooth.exhaustW > 0.4 ? 1.5 : 3.2;
  const tailBristle = emotion === 'fear' || emotion === 'anger' || isCharging ? 0.06 : 0;
  for (let i = 0; i < rig.tailPoints.length; i++) {
    const u = i / (rig.tailPoints.length - 1);
    const waveX =
      Math.sin(t * tailSpeed - u * 2.8) * (0.014 + u * (0.048 - smooth.deathW * 0.04));
    let waveY: number;
    if (smooth.deathW > 0.5) {
      waveY = 0.025;
    } else if (sitBlend > 0.3) {
      waveY = lerp(hipY + 0.01, 0.04 + Math.sin(u * Math.PI) * 0.04, sitBlend);
    } else if (emotion === 'sadness' || smooth.exhaustW > 0.5) {
      waveY = hipY - 0.14 * u;
    } else if (smooth.crouchW > 0.4) {
      waveY = hipY - 0.02 * u + Math.sin(t * 9.5 - u * 3) * 0.016;
    } else {
      waveY =
        hipY +
        0.015 +
        u * (0.14 + tailBristle + smooth.victoryW * 0.09 - speedNorm * 0.05) +
        Math.cos(t * tailSpeed * 0.8 - u * 2.5) * 0.024;
    }
    const waveZ = hipZ - 0.04 - u * (0.24 + speedNorm * 0.05);
    rig.tailPoints[i].set(waveX, waveY, waveZ);
  }
  rig.tail.updateFromTailPoints(rig.tailPoints);

  // 4-Limb Kinematics synced to stridePhase (so feet NEVER slide when moving!)
  const strideAmp = grounded
    ? lerp(0.008, smooth.crawlW > 0.4 ? 0.062 : isSprint ? 0.125 : 0.102, speedNorm) * (1 - sitBlend)
    : isClimb || isSwim
    ? 0.09
    : 0.02;
  const liftAmp = grounded
    ? lerp(0.0, 0.056, speedNorm) * (1 - sitBlend) * (1 - smooth.crawlW * 0.48)
    : isClimb || isSwim
    ? 0.045
    : 0.0;

  // Gallop phase offsets vs Walk/Trot phase offsets
  const flPhase = stridePhase + 0.35;
  const frPhase = stridePhase + (isSprint ? 0.72 : Math.PI + 0.35);
  const blPhase = stridePhase + (isSprint ? Math.PI + 0.25 : Math.PI * 0.5);
  const brPhase = stridePhase + (isSprint ? Math.PI + 0.65 : Math.PI * 1.5);

  const evalStep = (ph: number) => ({
    zOff: Math.sin(ph) * strideAmp,
    yOff: Math.max(0, Math.cos(ph)) * liftAmp,
    curl: Math.max(0, Math.cos(ph)) * 0.45 * speedNorm,
  });

  const sFL = evalStep(flPhase);
  const sFR = evalStep(frPhase);
  const sBL = evalStep(blPhase);
  const sBR = evalStep(brPhase);

  if (smooth.deathW > 0.55) {
    poseCatFrontLegIk(rig.legs.fl, -0.04, chestY - 0.02, chestZ, -0.05, 0.01, 0.14, 0.2);
    poseCatFrontLegIk(rig.legs.fr, 0.04, chestY - 0.02, chestZ, 0.05, 0.01, 0.11, 0.3);
    poseCatHindLegIk(rig.legs.bl, -0.045, hipY, hipZ, -0.05, 0.01, -0.2, -0.2, 0);
    poseCatHindLegIk(rig.legs.br, 0.045, hipY, hipZ, 0.05, 0.01, -0.22, -0.2, 0);
  } else if (isClimb) {
    const clPhase = t * 11;
    poseCatFrontLegIk(rig.legs.fl, -0.044, chestY - 0.01, chestZ, -0.042, 0.04 + Math.max(0, Math.sin(clPhase)) * 0.08, 0.17 + Math.cos(clPhase) * 0.05, 0.4);
    poseCatFrontLegIk(rig.legs.fr, 0.044, chestY - 0.01, chestZ, 0.042, 0.04 + Math.max(0, -Math.sin(clPhase)) * 0.08, 0.17 - Math.cos(clPhase) * 0.05, 0.4);
    poseCatHindLegIk(rig.legs.bl, -0.048, hipY, hipZ, -0.048, 0.02 + Math.max(0, -Math.sin(clPhase)) * 0.06, -0.14 - Math.cos(clPhase) * 0.05, -0.5, 0.2);
    poseCatHindLegIk(rig.legs.br, 0.048, hipY, hipZ, 0.048, 0.02 + Math.max(0, Math.sin(clPhase)) * 0.06, -0.14 + Math.cos(clPhase) * 0.05, -0.5, 0.2);
  } else if (isSwim) {
    const swPh = t * 9.5;
    poseCatFrontLegIk(rig.legs.fl, -0.042, chestY - 0.02, chestZ, -0.042, 0.04 + Math.sin(swPh) * 0.045, 0.15 + Math.cos(swPh) * 0.06, 0.5);
    poseCatFrontLegIk(rig.legs.fr, 0.042, chestY - 0.02, chestZ, 0.042, 0.04 - Math.sin(swPh) * 0.045, 0.15 - Math.cos(swPh) * 0.06, 0.5);
    poseCatHindLegIk(rig.legs.bl, -0.048, hipY - 0.01, hipZ, -0.048, 0.03 - Math.sin(swPh) * 0.04, -0.19 - Math.cos(swPh) * 0.055, -0.38, -0.2);
    poseCatHindLegIk(rig.legs.br, 0.048, hipY - 0.01, hipZ, 0.048, 0.03 + Math.sin(swPh) * 0.04, -0.19 + Math.cos(swPh) * 0.055, -0.38, -0.2);
  } else if (!grounded) {
    const reachZ = 0.16 + Math.max(0, airTuck) * 0.08 + combinedStrike * 0.14;
    const reachY = 0.06 + Math.max(0, airTuck) * 0.06 + combinedStrike * 0.1;
    poseCatFrontLegIk(rig.legs.fl, -0.042, chestY - 0.02, chestZ - 0.01, -0.04, reachY, reachZ, 0.45);
    poseCatFrontLegIk(rig.legs.fr, 0.042, chestY - 0.02, chestZ - 0.01, 0.04, reachY + combinedStrike * 0.05, reachZ + combinedStrike * 0.08, 0.55);
    poseCatHindLegIk(rig.legs.bl, -0.048, hipY - 0.01, hipZ, -0.046, 0.03, -0.22 - airTuck * 0.06, -0.45, -0.3);
    poseCatHindLegIk(rig.legs.br, 0.048, hipY - 0.01, hipZ, 0.046, 0.03, -0.22 - airTuck * 0.06, -0.45, -0.3);
  } else if (sitBlend > 0.01) {
    poseCatFrontLegIk(rig.legs.fl, -0.04, chestY - 0.02, chestZ, -0.028, 0, lerp(0.12, 0.095, sitBlend), 0);
    poseCatFrontLegIk(rig.legs.fr, 0.04, chestY - 0.02, chestZ, 0.028, 0, lerp(0.12, 0.095, sitBlend), 0);
    poseCatHindLegIk(rig.legs.bl, -0.048, hipY - 0.01, hipZ, -0.052, 0, lerp(-0.15, -0.065, sitBlend), -0.95 * sitBlend - 0.25, 0);
    poseCatHindLegIk(rig.legs.br, 0.048, hipY - 0.01, hipZ, 0.052, 0, lerp(-0.15, -0.065, sitBlend), -0.95 * sitBlend - 0.25, 0);
  } else if (smooth.victoryW > 0.4) {
    // Celebratory raised front paw wave!
    poseCatFrontLegIk(rig.legs.fl, -0.04, chestY, chestZ, -0.035, 0, 0.11, 0);
    poseCatFrontLegIk(rig.legs.fr, 0.04, chestY, chestZ, 0.038, 0.17 + Math.sin(t * 9) * 0.035, 0.16, 0.4);
    poseCatHindLegIk(rig.legs.bl, -0.048, hipY - 0.01, hipZ, -0.048, 0, -0.14, -0.65, 0);
    poseCatHindLegIk(rig.legs.br, 0.048, hipY - 0.01, hipZ, 0.048, 0, -0.14, -0.65, 0);
  } else if (smooth.blockW > 0.35) {
    // Crossed defensive forepaw guard stance
    poseCatFrontLegIk(rig.legs.fl, -0.042, chestY - 0.02, chestZ, -0.012, 0.075, 0.145, 0.6);
    poseCatFrontLegIk(rig.legs.fr, 0.042, chestY - 0.02, chestZ, 0.012, 0.088, 0.155, 0.65);
    poseCatHindLegIk(rig.legs.bl, -0.048, hipY - 0.01, hipZ, -0.046, 0, -0.165, -0.45, 0);
    poseCatHindLegIk(rig.legs.br, 0.048, hipY - 0.01, hipZ, 0.046, 0, -0.165, -0.45, 0);
  } else {
    // Distinct Punch jab (forward boxing punch) vs Claw swipe (wide arc)
    const punchRight = comboStep % 2 === 0;
    const swipeMag = attackArch * 0.15;
    const punchMag = punchArch * 0.21;

    const flLift = (!punchRight ? swipeMag : 0) + (punchArch > 0 && !punchRight ? punchArch * 0.12 : 0);
    const flFwd = (!punchRight ? swipeMag * 1.1 : 0) + (punchArch > 0 && !punchRight ? punchMag : 0);
    const frLift = (punchRight ? swipeMag : 0) + (punchArch > 0 && punchRight ? punchArch * 0.12 : 0);
    const frFwd = (punchRight ? swipeMag * 1.1 : 0) + (punchArch > 0 && punchRight ? punchMag : 0);

    poseCatFrontLegIk(
      rig.legs.fl,
      -0.042,
      chestY - 0.02,
      chestZ - 0.01,
      -0.038 + (!punchRight ? punchArch * 0.024 : 0),
      sFL.yOff + flLift,
      0.125 + sFL.zOff + flFwd + smooth.crouchW * 0.022,
      sFL.curl + (!punchRight ? combinedStrike * 0.72 : 0)
    );
    poseCatFrontLegIk(
      rig.legs.fr,
      0.042,
      chestY - 0.02,
      chestZ - 0.01,
      0.038 - (punchRight ? punchArch * 0.024 : 0),
      sFR.yOff + frLift,
      0.125 + sFR.zOff + frFwd + smooth.crouchW * 0.022,
      sFR.curl + (punchRight ? combinedStrike * 0.72 : 0)
    );
    poseCatHindLegIk(
      rig.legs.bl,
      -0.048,
      hipY - 0.01,
      hipZ,
      -0.045,
      sBL.yOff,
      -0.15 + sBL.zOff - smooth.crouchW * 0.034,
      smooth.crouchW > 0.35 ? -0.7 : -0.28,
      -sBL.curl * 0.4
    );
    poseCatHindLegIk(
      rig.legs.br,
      0.048,
      hipY - 0.01,
      hipZ,
      0.045,
      sBR.yOff,
      -0.15 + sBR.zOff - smooth.crouchW * 0.034,
      smooth.crouchW > 0.35 ? -0.7 : -0.28,
      -sBR.curl * 0.4
    );
  }

  rig.updateFurMotion(
    isSprint ? -0.45 : 0,
    !grounded ? -vy * 0.00055 : 0,
    -speedNorm * 0.24,
    0.25 + speedNorm * 0.85,
    t
  );
}

export function createCat3DOverlay(containerEl: HTMLElement): Cat3DOverlayController {
  const disposables: Array<{ dispose: () => void }> = [];

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.42;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.pointerEvents = 'none';
  containerEl.appendChild(renderer.domElement);

  const gl = renderer.getContext();
  const isSoftwareGl = detectSoftwareGl(gl);
  const shellCount = isSoftwareGl ? 6 : 11;

  const scene = new THREE.Scene();
  const fov = 38;
  const camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.05, 30);
  camera.position.set(0, 0.18, 2.2);
  camera.lookAt(0, 0.18, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();
  disposables.push(envTex);

  // 4-Light Studio + Biome-Adaptive Rim Rig
  const hemiLight = new THREE.HemisphereLight(0xd4ebff, 0x3b2a1e, 1.05);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xffe4b8, 2.95);
  keyLight.position.set(1.7, 2.9, 2.4);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x7dd3fc, 2.55);
  rimLight.position.set(-2.3, 1.85, -1.7);
  scene.add(rimLight);

  const warmPointLight = new THREE.PointLight(0xfbbf24, 2.0, 3.2, 2.0);
  warmPointLight.position.set(0, 0.3, 0.5);
  scene.add(warmPointLight);

  const bounceLight = new THREE.PointLight(0x94a3b8, 0.9, 1.8, 2.0);
  bounceLight.position.set(0, -0.08, 0.25);
  scene.add(bounceLight);

  const noseTex = createNoseLeatherTextures();
  const innerEarTex = createInnerEarTextures();
  const pawPadTex = createPawPadTextures();
  disposables.push(noseTex, innerEarTex, pawPadTex);

  const kuroFurTex = createHoudiniFurTextures('black', 'fast');
  const kuroIrisTex = createCatIrisTextures('amber');
  disposables.push(
    kuroFurTex.colorMap,
    kuroFurTex.strandMap,
    kuroFurTex.normalMap,
    kuroFurTex.roughnessMap,
    kuroIrisTex
  );
  const kuroRig = buildArticulatedBlackCat(
    kuroFurTex,
    kuroIrisTex,
    noseTex,
    innerEarTex,
    pawPadTex,
    shellCount,
    'black'
  );
  const collarMesh = createStrayCollarMesh(disposables);
  collarMesh.position.set(0, -0.025, 0.01);
  kuroRig.headPivot.add(collarMesh);
  scene.add(kuroRig.root);

  const sunmyFurTex = createHoudiniFurTextures('white', 'fast');
  const sunmyIrisTex = createCatIrisTextures('sapphire');
  disposables.push(
    sunmyFurTex.colorMap,
    sunmyFurTex.strandMap,
    sunmyFurTex.normalMap,
    sunmyFurTex.roughnessMap,
    sunmyIrisTex
  );
  const sunmyRig = buildArticulatedBlackCat(
    sunmyFurTex,
    sunmyIrisTex,
    noseTex,
    innerEarTex,
    pawPadTex,
    shellCount,
    'white'
  );
  sunmyRig.root.visible = false;
  scene.add(sunmyRig.root);

  // Soft 3D Contact Shadow Disc under Kuro
  const shadowTex = createContactShadowTexture();
  const shadowGeo = new THREE.PlaneGeometry(0.56, 0.35);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
  });
  const kuroShadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
  kuroShadowDisc.rotation.x = -Math.PI / 2;
  scene.add(kuroShadowDisc);
  disposables.push(shadowTex, shadowGeo, shadowMat);

  // 3D Meow Acoustic Sonic Ring
  const meowRingGeo = new THREE.TorusGeometry(0.18, 0.011, 10, 36);
  const meowRingMat = new THREE.MeshBasicMaterial({
    color: 0xfde047,
    transparent: true,
    opacity: 0,
  });
  const meowRingMesh = new THREE.Mesh(meowRingGeo, meowRingMat);
  meowRingMesh.visible = false;
  scene.add(meowRingMesh);
  disposables.push(meowRingGeo, meowRingMat);

  // 3D Parry / Block Guard Aura Shell
  const guardGeo = new THREE.SphereGeometry(0.32, 24, 18);
  const guardMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0,
    wireframe: true,
  });
  const guardMesh = new THREE.Mesh(guardGeo, guardMat);
  guardMesh.visible = false;
  scene.add(guardMesh);
  disposables.push(guardGeo, guardMat);

  // Glowing 3D Spirit Lotus for Pixar Finale
  const lotusGroup = new THREE.Group();
  const lotusCoreGeo = new THREE.OctahedronGeometry(0.025, 1);
  const lotusCoreMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: new THREE.Color(0xfbbf24),
    emissiveIntensity: 2.5,
    roughness: 0.18,
  });
  const lotusCore = new THREE.Mesh(lotusCoreGeo, lotusCoreMat);
  lotusGroup.add(lotusCore);
  lotusGroup.visible = false;
  scene.add(lotusGroup);
  disposables.push(lotusCoreGeo, lotusCoreMat);

  const sparkCount = 34;
  const sparkGeo = new THREE.SphereGeometry(0.0085, 8, 6);
  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0xfde68a,
    transparent: true,
    opacity: 0.85,
  });
  const sparkInst = new THREE.InstancedMesh(sparkGeo, sparkMat, sparkCount);
  sparkInst.visible = false;
  scene.add(sparkInst);
  disposables.push(sparkGeo, sparkMat);

  const _dummyObj = new THREE.Object3D();

  const kuroSmooth: SmoothedRigState = {
    crouchW: 0,
    crawlW: 0,
    stealthW: 0,
    climbW: 0,
    swimW: 0,
    exhaustW: 0,
    hurtW: 0,
    deathW: 0,
    victoryW: 0,
    blockW: 0,
    landingW: 0,
    jawOpen: 0,
    clawExtend: 0.55,
    earRadar: 0,
  };
  const sunmySmooth: SmoothedRigState = { ...kuroSmooth };

  // Adaptive DPR monitoring so mobile & laptop maintain fluid 60fps
  let adaptiveMaxDpr = isSoftwareGl ? 1.25 : 2.0;
  let slowFrameStreak = 0;

  let currentW = 1280;
  let currentH = 720;
  let visible = false;
  renderer.domElement.style.visibility = 'hidden';

  const setVisible = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    renderer.domElement.style.visibility = next ? 'visible' : 'hidden';
  };

  const applyDprSize = (viewW: number, viewH: number) => {
    const dpr = clamp(window.devicePixelRatio || 1, 0.85, adaptiveMaxDpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(viewW, viewH, false);
  };

  const setQualityTier = (tier: QualityTier) => {
    const cap = isSoftwareGl ? 1.15 : tier === 'low' ? 0.95 : tier === 'medium' ? 1.25 : 1.75;
    if (Math.abs(cap - adaptiveMaxDpr) > 0.05) {
      adaptiveMaxDpr = cap;
      if (currentW > 1 && currentH > 1) {
        applyDprSize(currentW, currentH);
      }
    }
  };

  const resize = (viewW: number, viewH: number) => {
    if (viewW < 2 || viewH < 2) return;
    currentW = viewW;
    currentH = viewH;
    applyDprSize(viewW, viewH);
    camera.aspect = viewW / viewH;
    camera.updateProjectionMatrix();
  };

  const syncGameplay: Cat3DOverlayController['syncGameplay'] = (
    viewW,
    viewH,
    player,
    camX,
    logicalW,
    elapsed,
    dt,
    style,
    nearestThreatDx
  ) => {
    if (dt > 0.036 && adaptiveMaxDpr > 0.95) {
      slowFrameStreak++;
      if (slowFrameStreak >= 14) {
        adaptiveMaxDpr = Math.max(0.9, adaptiveMaxDpr - 0.25);
        slowFrameStreak = 0;
        applyDprSize(viewW, viewH);
      }
    } else {
      slowFrameStreak = Math.max(0, slowFrameStreak - 1);
    }

    if (viewW !== currentW || viewH !== currentH) {
      resize(viewW, viewH);
    }
    setVisible(true);

    // Per-Biome Cinematic 3D Lighting & Art Direction Adaptation
    if (style === 'pixar_3d') {
      keyLight.color.setHex(0xffe4b5);
      keyLight.intensity = 3.15;
      rimLight.color.setHex(0x93c5fd);
      rimLight.intensity = 2.85;
      hemiLight.color.setHex(0xfff1c9);
      renderer.toneMappingExposure = 1.5;
    } else if (style === 'spiderverse') {
      // High-contrast Spider-Verse magenta / cyan dual rim lights
      keyLight.color.setHex(0xfb7185);
      keyLight.intensity = 3.2;
      rimLight.color.setHex(0x22d3ee);
      rimLight.intensity = 3.1;
      hemiLight.color.setHex(0xe2e8f0);
      renderer.toneMappingExposure = 1.48;
    } else if (style === 'rec_horror') {
      // Cold camcorder emerald night-vision flood + harsh contrast
      keyLight.color.setHex(0xbef264);
      keyLight.intensity = 2.9;
      rimLight.color.setHex(0x4ade80);
      rimLight.intensity = 2.25;
      hemiLight.color.setHex(0x14532d);
      renderer.toneMappingExposure = 1.32;
    } else if (style === 'kindergarten') {
      keyLight.color.setHex(0xfffbeb);
      keyLight.intensity = 3.3;
      rimLight.color.setHex(0xfde047);
      rimLight.intensity = 2.3;
      hemiLight.color.setHex(0xbae6fd);
      renderer.toneMappingExposure = 1.46;
    } else if (style === 'sumi_scroll') {
      keyLight.color.setHex(0xfef3c7);
      keyLight.intensity = 2.55;
      rimLight.color.setHex(0xdc2626);
      rimLight.intensity = 2.2;
      hemiLight.color.setHex(0xe7d6b4);
      renderer.toneMappingExposure = 1.35;
    } else if (style === 'watercolor_anime') {
      keyLight.color.setHex(0xe0f2fe);
      keyLight.intensity = 2.9;
      rimLight.color.setHex(0x38bdf8);
      rimLight.intensity = 2.7;
      hemiLight.color.setHex(0x93c5fd);
      renderer.toneMappingExposure = 1.44;
    } else {
      keyLight.color.setHex(0xffca7a);
      keyLight.intensity = 2.95;
      rimLight.color.setHex(0x38bdf8);
      rimLight.intensity = 2.45;
      hemiLight.color.setHex(0xd4ebff);
      renderer.toneMappingExposure = 1.42;
    }

    const camZ = 2.25;
    const camY = 0.16;
    camera.position.set(0, camY, camZ);
    camera.lookAt(0, camY, 0);

    const visH = 2 * camZ * Math.tan(THREE.MathUtils.degToRad(fov * 0.5));
    const scaleToWorld = visH / LOGICAL_HEIGHT;

    const worldX = (player.x - camX - logicalW * 0.5) * scaleToWorld;
    const worldY = camY + (LOGICAL_HEIGHT * 0.5 - player.y) * scaleToWorld;
    const groundWorldY = camY + (LOGICAL_HEIGHT * 0.5 - GROUND_Y) * scaleToWorld;

    const catScale = scaleToWorld * 158;
    kuroRig.root.visible = true;
    sunmyRig.root.visible = false;
    lotusGroup.visible = false;
    sparkInst.visible = false;

    kuroRig.root.position.set(worldX, worldY, 0);
    kuroRig.root.scale.setScalar(catScale);
    const targetYaw = player.climbing
      ? player.facing > 0
        ? Math.PI * 0.5
        : -Math.PI * 0.5
      : player.facing > 0
      ? Math.PI * 0.43
      : -Math.PI * 0.43;
    kuroRig.root.rotation.set(0, targetYaw, 0);

    // Grounded Contact Shadow
    kuroShadowDisc.visible = !player.climbing;
    const heightAboveFloor = Math.max(0, worldY - (player.grounded ? worldY : groundWorldY));
    const shadowFade = clamp(1 - heightAboveFloor / 0.55, 0.2, 1);
    kuroShadowDisc.position.set(worldX, player.grounded ? worldY : groundWorldY, 0);
    kuroShadowDisc.scale.setScalar(catScale * shadowFade);
    shadowMat.opacity = 0.74 * shadowFade;

    // 3D Meow Pulse Ring
    if (player.meowTimer > 0) {
      const mp = 1 - clamp(player.meowTimer / 0.42, 0, 1);
      meowRingMesh.visible = true;
      meowRingMesh.position.set(worldX + player.facing * 0.04, worldY + 0.045, 0.08);
      meowRingMesh.scale.setScalar(catScale * (0.65 + mp * 2.9));
      meowRingMat.opacity = (1 - mp) * 0.85;
    } else {
      meowRingMesh.visible = false;
    }

    // 3D Block / Parry Aura Shield
    if (player.blocking || player.parryWindow > 0) {
      guardMesh.visible = true;
      guardMesh.position.set(worldX + player.facing * 0.02, worldY + 0.032, 0.02);
      guardMesh.scale.setScalar(catScale * (player.parryWindow > 0 ? 1.15 : 0.96));
      guardMesh.rotation.y = elapsed * 2.4;
      guardMat.color.setHex(player.parryWindow > 0 ? 0xfef08a : 0x38bdf8);
      guardMat.opacity = player.parryWindow > 0 ? 0.42 : 0.22;
    } else {
      guardMesh.visible = false;
    }

    warmPointLight.position.set(worldX + player.facing * 0.24, worldY + 0.24, 0.36);
    warmPointLight.intensity =
      player.isChargingAttack || player.crouchCharge > 0.4 ? 3.1 : 1.9;
    warmPointLight.color.setHex(
      player.isChargingAttack ? 0xf97316 : player.crouchCharge > 0.4 ? 0xfef08a : 0xfbbf24
    );
    bounceLight.position.set(worldX, worldY - 0.06, 0.2);

    const speedNorm = clamp(Math.abs(player.vx) / 360, 0, 1);
    const attackProgress =
      player.attackTimer > 0 && player.punchTimer <= 0
        ? 1 - clamp(player.attackTimer / 0.26, 0, 1)
        : 0;
    const punchProgress =
      player.punchTimer > 0 ? 1 - clamp(player.punchTimer / 0.22, 0, 1) : 0;

    // Spider-Verse stylized 12fps animation quantization!
    const evalTime = style === 'spiderverse' ? Math.floor(elapsed * 12) / 12 : elapsed;
    const earRadar =
      nearestThreatDx === null ? 0 : clamp(nearestThreatDx / 220, -1, 1);

    animateCatPose19(
      kuroRig,
      kuroSmooth,
      dt,
      evalTime,
      player.animState,
      player.emotion,
      player.strideAccum,
      speedNorm,
      player.vy,
      attackProgress,
      punchProgress,
      player.comboStep,
      player.blocking,
      player.isChargingAttack,
      player.crouchCharge,
      player.meowTimer,
      0,
      player.facing > 0 ? 0.14 : -0.14,
      0,
      earRadar
    );

    if (player.invulnTimer > 0 && Math.floor(elapsed * 18) % 2 === 1) {
      kuroRig.root.visible = false;
    }

    renderer.render(scene, camera);
  };

  const renderPixarEpilogue: Cat3DOverlayController['renderPixarEpilogue'] = (
    viewW,
    viewH,
    t
  ) => {
    if (viewW !== currentW || viewH !== currentH) {
      resize(viewW, viewH);
    }
    setVisible(true);

    const dolly = smoothstep(0, 11.5, t);
    const camZ = lerp(1.62, 1.08, dolly);
    const camY = 0.205;
    camera.position.set(0, camY + 0.04, camZ);
    camera.lookAt(0, 0.155, 0);

    keyLight.color.setHex(0xffd27d);
    keyLight.intensity = 3.05;
    rimLight.color.setHex(0x60a5fa);
    rimLight.intensity = 2.95;
    renderer.toneMappingExposure = 1.52;

    kuroRig.root.visible = true;
    sunmyRig.root.visible = true;
    kuroShadowDisc.visible = false;
    meowRingMesh.visible = false;
    guardMesh.visible = false;
    kuroRig.root.scale.setScalar(1.0);
    sunmyRig.root.scale.setScalar(0.95);

    const floorY = 0.02;
    const approachT = smoothstep(0.0, 3.8, t);
    const kuroX = lerp(-0.56, -0.19, approachT);
    const kuroWalkSpeed = t < 3.8 ? 0.65 * (1 - smoothstep(3.1, 3.8, t)) : 0;
    const kuroSad = smoothstep(5.0, 8.6, t);
    const kuroSit = smoothstep(7.4, 10.6, t);

    kuroRig.root.position.set(kuroX, floorY, 0.05);
    kuroRig.root.rotation.set(0, Math.PI * 0.42, 0);
    animateCatPose19(
      kuroRig,
      kuroSmooth,
      0.016,
      t,
      kuroWalkSpeed > 0.05 ? 'walk' : kuroSad > 0.5 ? 'exhausted' : 'idle',
      kuroSad > 0.25 ? 'sadness' : 'calm',
      t * kuroWalkSpeed * 6.5,
      kuroWalkSpeed,
      0,
      0,
      0,
      0,
      false,
      false,
      0,
      t > 2.2 && t < 3.0 ? 0.3 : 0,
      kuroSit * 0.88,
      0.16,
      kuroSad * 0.28,
      0.5
    );

    const turnAway = smoothstep(4.8, 6.5, t);
    const walkAway = smoothstep(6.5, 12.2, t);
    const sunmyX = lerp(0.22, 0.74, walkAway);
    const sunmyYaw = lerp(-Math.PI * 0.42, Math.PI * 0.46, turnAway);
    const sunmyWalkSpd = walkAway > 0.02 && walkAway < 0.98 ? 0.55 : 0;

    sunmyRig.root.position.set(sunmyX, floorY, -0.02);
    sunmyRig.root.rotation.set(0, sunmyYaw, 0);
    animateCatPose19(
      sunmyRig,
      sunmySmooth,
      0.016,
      t + 1.2,
      sunmyWalkSpd > 0.05 ? 'walk' : 'idle',
      turnAway > 0.3 ? 'calm' : 'sadness',
      t * sunmyWalkSpd * 6.0,
      sunmyWalkSpd,
      0,
      0,
      0,
      0,
      false,
      false,
      0,
      0,
      0,
      lerp(-0.18, 0.08, turnAway),
      lerp(-0.04, 0.1, turnAway),
      0
    );

    const lotusFade = 1 - smoothstep(5.6, 10.2, t);
    lotusGroup.visible = lotusFade > 0.02;
    lotusGroup.position.set(
      kuroX + 0.14,
      floorY + lerp(0.14, 0.02, smoothstep(6.0, 8.8, t)) + Math.sin(t * 2.5) * 0.01 * lotusFade,
      0.12
    );
    lotusGroup.rotation.y = t * 1.4;
    lotusCoreMat.emissiveIntensity = 2.4 * lotusFade;
    lotusGroup.scale.setScalar(Math.max(0.1, lotusFade));

    warmPointLight.position.copy(lotusGroup.position);
    warmPointLight.intensity = 2.6 * lotusFade + 0.35;

    sparkInst.visible = true;
    for (let i = 0; i < sparkCount; i++) {
      const a = i * 2.399;
      const sx = Math.sin(a + t * 0.25) * 0.75;
      const sy = (i * 0.09 + t * 0.06) % 0.65;
      const sz = Math.cos(a * 1.3 + t * 0.2) * 0.38;
      _dummyObj.position.set(sx, sy, sz);
      const sc = (0.5 + 0.5 * Math.sin(t * 3 + i)) * (0.4 + 0.6 * lotusFade);
      _dummyObj.scale.setScalar(sc);
      _dummyObj.updateMatrix();
      sparkInst.setMatrixAt(i, _dummyObj.matrix);
    }
    sparkInst.instanceMatrix.needsUpdate = true;

    renderer.render(scene, camera);
  };

  const dispose = () => {
    for (const d of kuroRig.disposables) d.dispose();
    for (const d of sunmyRig.disposables) d.dispose();
    for (const d of disposables) d.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };

  return {
    setVisible,
    setQualityTier,
    resize,
    syncGameplay,
    renderPixarEpilogue,
    dispose,
  };
}
