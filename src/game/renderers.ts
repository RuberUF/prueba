import type { StrokePoint } from '../types/studio';
import { interpolateCatmullRom } from '../utils/sumiRenderer';
import { GROUND_Y, LOGICAL_HEIGHT } from './levels';
import type {
  ActivePickupState,
  ActivePlatformState,
  ActivePuzzleGate,
  ActiveSecretZone,
  ActiveWorldObject,
  AnimationStyleMode,
  BackdropKey,
  EnemyState,
  FloatingTextState,
  HazardZoneDef,
  LevelConfig,
  ParticleState,
  PlayerState,
  ProjectileState,
  QualityTier,
} from './types';

const sortedHazardsCache = new WeakMap<LevelConfig, HazardZoneDef[]>();
function getSortedHazards(level: LevelConfig): HazardZoneDef[] {
  let cached = sortedHazardsCache.get(level);
  if (!cached) {
    cached = [...level.hazards].sort((a, b) => a.x - b.x);
    sortedHazardsCache.set(level, cached);
  }
  return cached;
}

function drawProceduralBackdropPlate(
  ctx: CanvasRenderingContext2D,
  key: BackdropKey,
  w: number,
  h: number,
  camX: number,
  elapsed: number,
  quality: QualityTier
): void {
  ctx.save();
  if (key === 'stray_alley') {
    const step = 190;
    const par = camX * 0.16;
    const start = Math.floor(par / step) - 1;
    const count = Math.ceil(w / step) + 3;
    for (let i = start; i < start + count; i++) {
      const bx = i * step - par;
      const seed = Math.abs(Math.sin(i * 17.3));
      const bh = 180 + seed * 150;
      const bw = 115 + (i % 3) * 28;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(10, 20, 30, 0.88)' : 'rgba(15, 28, 42, 0.82)';
      ctx.fillRect(bx, GROUND_Y - bh, bw, bh + 30);

      // Neon vertical sign strips & cyberpunk windows
      ctx.fillStyle = i % 2 === 0 ? 'rgba(56, 189, 248, 0.42)' : 'rgba(245, 158, 11, 0.36)';
      ctx.fillRect(bx + 14, GROUND_Y - bh + 28, 6, 48);
      if (quality !== 'low') {
        ctx.fillStyle = 'rgba(186, 230, 253, 0.18)';
        for (let wy = GROUND_Y - bh + 34; wy < GROUND_Y - 45; wy += 28) {
          ctx.fillRect(bx + 36, wy, 14, 10);
          ctx.fillRect(bx + 62, wy, 14, 10);
        }
      }
    }
    // Overhead rain-slicked cables
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 74);
    ctx.quadraticCurveTo(w * 0.5, 116, w, 68);
    ctx.stroke();
  } else if (key === 'medieval_castle') {
    const step = 260;
    const par = camX * 0.15;
    const start = Math.floor(par / step) - 1;
    const count = Math.ceil(w / step) + 3;
    for (let i = start; i < start + count; i++) {
      const cx = i * step - par;
      const seed = Math.abs(Math.cos(i * 11.7));
      const th = 195 + seed * 110;
      ctx.fillStyle = 'rgba(17, 24, 39, 0.86)';
      ctx.fillRect(cx + 12, GROUND_Y - th, 78, th + 20);
      // Battlements
      for (let b = 0; b < 4; b++) {
        ctx.fillRect(cx + 12 + b * 21, GROUND_Y - th - 14, 12, 14);
      }
      // Distant Gothic spire & warm torchlight slit
      ctx.beginPath();
      ctx.moveTo(cx + 105, GROUND_Y - th + 40);
      ctx.lineTo(cx + 132, GROUND_Y - th - 36);
      ctx.lineTo(cx + 159, GROUND_Y - th + 40);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(251, 146, 60, 0.62)';
      ctx.fillRect(cx + 46, GROUND_Y - th + 44, 8, 22);
    }
  } else if (key === 'bamboo_plate') {
    const step = 140;
    const par = camX * 0.22;
    const start = Math.floor(par / step) - 1;
    const count = Math.ceil(w / step) + 3;
    for (let i = start; i < start + count; i++) {
      const bx = i * step - par + 24;
      const sway = Math.sin(elapsed * 1.1 + i) * 6;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(20, 48, 42, 0.72)' : 'rgba(34, 68, 56, 0.54)';
      ctx.lineWidth = i % 2 === 0 ? 11 : 7;
      ctx.beginPath();
      ctx.moveTo(bx, GROUND_Y + 12);
      ctx.quadraticCurveTo(bx + sway, GROUND_Y * 0.45, bx + sway * 1.7, -10);
      ctx.stroke();
    }
  } else if (key === 'pixar_sanctuary') {
    const moonX = w * 0.56 - camX * 0.03;
    const moonY = h * 0.30;
    const moonR = 68;
    const glow = ctx.createRadialGradient(moonX, moonY, moonR * 0.2, moonX, moonY, moonR * 2.8);
    glow.addColorStop(0, 'rgba(254, 249, 195, 0.78)');
    glow.addColorStop(0.45, 'rgba(147, 197, 253, 0.26)');
    glow.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR * 2.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fefce8';
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.fill();

    // Sacred Torii & floating warm lanterns
    const toriiX = w * 0.5 - camX * 0.08;
    ctx.fillStyle = 'rgba(24, 24, 37, 0.85)';
    ctx.fillRect(toriiX - 74, GROUND_Y - 172, 16, 174);
    ctx.fillRect(toriiX + 58, GROUND_Y - 172, 16, 174);
    ctx.fillRect(toriiX - 102, GROUND_Y - 186, 204, 18);
    ctx.fillRect(toriiX - 84, GROUND_Y - 148, 168, 11);

    const lanternCount = quality === 'low' ? 3 : 6;
    for (let l = 0; l < lanternCount; l++) {
      const lx = w * (0.14 + l * 0.14) + Math.sin(elapsed * 0.7 + l) * 12;
      const ly = h * (0.36 + (l % 3) * 0.09) + Math.cos(elapsed * 0.9 + l) * 8;
      ctx.fillStyle = 'rgba(251, 191, 36, 0.78)';
      ctx.fillRect(lx - 6, ly - 9, 12, 18);
    }
  }
  ctx.restore();
}

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

export function resolveActiveStyle(
  level: LevelConfig,
  _playerX: number,
  elapsed: number,
  hitFlashTimer: number
): AnimationStyleMode {
  if (hitFlashTimer > 0.025 && level.secondaryStyleMode) {
    return level.secondaryStyleMode;
  }
  if (level.id === 8 && level.secondaryStyleMode) {
    return Math.sin(elapsed * 2.2) > 0.8 ? level.secondaryStyleMode : level.styleMode;
  }
  return level.styleMode;
}

function drawHalftonePattern(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  alpha: number,
  color = 'rgba(15, 23, 42, 0.25)'
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const step = 20;
  ctx.beginPath();
  for (let y = 0; y < h; y += step * 2) {
    for (let x = y % (step * 4) === 0 ? 0 : step; x < w; x += step * 2) {
      ctx.moveTo(x + 2.2, y);
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();
}

function drawKindergartenPaperAndSun(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  camX: number,
  elapsed: number
) {
  ctx.save();
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.16)';
  ctx.lineWidth = 1.2;
  for (let y = 42; y < h; y += 34) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(244, 63, 94, 0.24)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(52, 0);
  ctx.lineTo(52, h);
  ctx.stroke();

  const sunX = w * 0.85 - camX * 0.02;
  const sunY = 74;
  ctx.fillStyle = '#fde047';
  ctx.strokeStyle = '#ca8a04';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  for (let r = 0; r < 10; r++) {
    const a = (r / 10) * Math.PI * 2 + elapsed * 0.35;
    ctx.beginPath();
    ctx.moveTo(sunX + Math.cos(a) * 40, sunY + Math.sin(a) * 40);
    ctx.lineTo(sunX + Math.cos(a) * 53, sunY + Math.sin(a) * 53);
    ctx.stroke();
  }
  ctx.fillStyle = '#713f12';
  ctx.beginPath();
  ctx.arc(sunX - 10, sunY - 5, 3.2, 0, Math.PI * 2);
  ctx.arc(sunX + 10, sunY - 5, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sunX, sunY + 3, 12, 0.2, Math.PI - 0.2);
  ctx.stroke();

  const cloudPositions = [180, 460, 740, 1020];
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = 2.6;
  for (let c = 0; c < cloudPositions.length; c++) {
    const cx = ((cloudPositions[c] - camX * 0.12) % (w + 260) + (w + 260)) % (w + 260) - 100;
    const cy = 68 + (c % 2) * 32;
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.arc(cx + 22, cy - 8, 24, 0, Math.PI * 2);
    ctx.arc(cx + 46, cy, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawSumiScrollOverlay(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(87, 62, 34, 0.28)';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  ctx.fillStyle = 'rgba(153, 27, 27, 0.72)';
  ctx.fillRect(w - 54, 72, 28, 38);
  ctx.strokeStyle = '#faf0d7';
  ctx.lineWidth = 1.6;
  ctx.strokeRect(w - 50, 76, 20, 30);
  ctx.fillStyle = '#faf0d7';
  ctx.font = '700 13px serif';
  ctx.textAlign = 'center';
  ctx.fillText('猫', w - 40, 96);
  ctx.restore();
}

function drawRecCamcorderOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elapsed: number,
  playerScreenX: number,
  playerScreenY: number,
  facing: 1 | -1,
  hurtTimer: number
) {
  ctx.save();
  const flashGrad = ctx.createRadialGradient(
    playerScreenX + facing * 120,
    playerScreenY - 22,
    30,
    playerScreenX + facing * 165,
    playerScreenY - 18,
    400
  );
  flashGrad.addColorStop(0, 'rgba(220, 255, 228, 0.08)');
  flashGrad.addColorStop(0.55, 'rgba(8, 22, 13, 0.22)');
  flashGrad.addColorStop(1, 'rgba(2, 10, 6, 0.62)');
  ctx.fillStyle = flashGrad;
  ctx.fillRect(0, 0, w, h);

  ctx.beginPath();
  ctx.moveTo(playerScreenX + facing * 14, playerScreenY - 26);
  ctx.lineTo(playerScreenX + facing * 390, playerScreenY - 145);
  ctx.lineTo(playerScreenX + facing * 390, playerScreenY + 75);
  ctx.closePath();
  const beam = ctx.createLinearGradient(
    playerScreenX,
    playerScreenY - 26,
    playerScreenX + facing * 390,
    playerScreenY - 26
  );
  beam.addColorStop(0, 'rgba(235, 255, 232, 0.25)');
  beam.addColorStop(1, 'rgba(180, 255, 195, 0)');
  ctx.fillStyle = beam;
  ctx.fill();

  ctx.fillStyle = 'rgba(120, 255, 160, 0.045)';
  const jitter = hurtTimer > 0 ? Math.sin(elapsed * 85) * 6 : 0;
  for (let y = Math.floor(elapsed * 40) % 4; y < h; y += 4) {
    ctx.fillRect(jitter, y, w, 1);
  }

  if (hurtTimer > 0 || Math.sin(elapsed * 3.7) > 0.96) {
    const barY = (elapsed * 210) % h;
    ctx.fillStyle = 'rgba(210, 255, 225, 0.14)';
    ctx.fillRect(0, barY, w, 16);
  }

  ctx.strokeStyle = 'rgba(225, 255, 232, 0.65)';
  ctx.lineWidth = 2;
  const m = 22;
  const c = 20;
  ctx.beginPath();
  ctx.moveTo(m, m + c);
  ctx.lineTo(m, m);
  ctx.lineTo(m + c, m);
  ctx.moveTo(w - m - c, m);
  ctx.lineTo(w - m, m);
  ctx.lineTo(w - m, m + c);
  ctx.moveTo(m, h - m - c);
  ctx.lineTo(m, h - m);
  ctx.lineTo(m + c, h - m);
  ctx.moveTo(w - m - c, h - m);
  ctx.lineTo(w - m, h - m);
  ctx.lineTo(w - m, h - m - c);
  ctx.stroke();

  if (Math.floor(elapsed * 2) % 2 === 0) {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(m + 20, m + 20, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(232, 255, 236, 0.85)';
  ctx.font = '600 13px "JetBrains Mono", monospace';
  const secs = Math.floor(elapsed);
  const mins = Math.floor(secs / 60);
  const remS = secs % 60;
  const frames = Math.floor((elapsed % 1) * 24);
  const ts = `REC  00:${String(mins).padStart(2, '0')}:${String(remS).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  ctx.fillText(ts, m + 33, m + 25);

  ctx.textAlign = 'right';
  ctx.fillText('00 LUX', w - m - 14, m + 25);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawSpiderVersePostEffects(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  playerScreenX: number,
  playerScreenY: number,
  comboHits: number,
  dashTimer: number,
  quality: QualityTier
) {
  ctx.save();
  if (quality === 'high') {
    drawHalftonePattern(ctx, w, 92, 0.22, 'rgba(244, 63, 94, 0.28)');
  }
  if (dashTimer > 0 || comboHits >= 2) {
    ctx.strokeStyle = 'rgba(255, 240, 210, 0.24)';
    ctx.lineWidth = 1.6;
    const rays = quality === 'low' ? 6 : 12;
    ctx.beginPath();
    for (let i = 0; i < rays; i++) {
      const ang = (i / rays) * Math.PI * 2;
      const r1 = 90 + (i % 3) * 25;
      const r2 = Math.max(w, h) * 0.72;
      ctx.moveTo(playerScreenX + Math.cos(ang) * r1, playerScreenY + Math.sin(ang) * r1);
      ctx.lineTo(playerScreenX + Math.cos(ang) * r2, playerScreenY + Math.sin(ang) * r2);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawPixarAtmosphereOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  elapsed: number,
  quality: QualityTier = 'high'
) {
  ctx.save();
  const count = quality === 'low' ? 8 : quality === 'medium' ? 14 : 20;
  for (let i = 0; i < count; i++) {
    const px = ((i * 137 + elapsed * (18 + (i % 3) * 8)) % (w + 60)) - 30;
    const py = h - ((i * 89 + elapsed * (22 + (i % 4) * 6)) % h);
    const rad = 3.5 + (i % 4) * 2.4;
    if (quality === 'high') {
      const g = ctx.createRadialGradient(px, py, 0, px, py, rad * 2.1);
      g.addColorStop(0, 'rgba(254, 240, 138, 0.45)');
      g.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, rad * 2.1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(254, 240, 138, 0.34)';
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawVolumetricGodRays(
  ctx: CanvasRenderingContext2D,
  w: number,
  elapsed: number,
  tint = 'rgba(254, 243, 199, 0.08)'
) {
  ctx.save();
  for (let i = 0; i < 4; i++) {
    const x0 = w * (0.15 + i * 0.24) + Math.sin(elapsed * 0.3 + i) * 35;
    const grad = ctx.createLinearGradient(x0, 0, x0 + 95, GROUND_Y);
    grad.addColorStop(0, tint);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + 60, 0);
    ctx.lineTo(x0 + 185, GROUND_Y);
    ctx.lineTo(x0 + 75, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawBiomeSceneryDetails(
  ctx: CanvasRenderingContext2D,
  w: number,
  camX: number,
  level: LevelConfig,
  style: AnimationStyleMode,
  elapsed: number,
  quality: QualityTier
) {
  ctx.save();

  if (level.biome === 'jungle_edge') {
    const step = 360;
    const start = Math.floor((camX * 0.25) / step) - 1;
    for (let i = start; i < start + Math.ceil(w / step) + 2; i++) {
      const rx = i * step - camX * 0.25;
      ctx.fillStyle = 'rgba(134, 239, 172, 0.65)';
      ctx.strokeStyle = '#166534';
      ctx.lineWidth = 2.4;
      ctx.fillRect(rx + 40, GROUND_Y - 110, 56, 110);
      ctx.strokeRect(rx + 40, GROUND_Y - 110, 56, 110);
      ctx.fillStyle = '#fca5a5';
      ctx.beginPath();
      ctx.moveTo(rx + 32, GROUND_Y - 110);
      ctx.lineTo(rx + 68, GROUND_Y - 152);
      ctx.lineTo(rx + 104, GROUND_Y - 110);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (level.biome === 'whisper_river') {
    const step = 420;
    const start = Math.floor((camX * 0.28) / step) - 1;
    for (let i = start; i < start + Math.ceil(w / step) + 2; i++) {
      const px = i * step - camX * 0.28 + 120;
      ctx.fillStyle = 'rgba(41, 37, 36, 0.34)';
      for (let tier = 0; tier < 3; tier++) {
        const tw = 74 - tier * 16;
        const ty = GROUND_Y - 52 - tier * 36;
        ctx.fillRect(px - tw * 0.36, ty, tw * 0.72, 32);
        ctx.beginPath();
        ctx.moveTo(px - tw * 0.62, ty);
        ctx.quadraticCurveTo(px, ty - 16, px + tw * 0.62, ty);
        ctx.lineTo(px + tw * 0.42, ty + 6);
        ctx.lineTo(px - tw * 0.42, ty + 6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255, 250, 240, 0.45)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(px - 110, GROUND_Y - 72 + Math.sin(elapsed + i) * 6);
      ctx.quadraticCurveTo(px, GROUND_Y - 84, px + 110, GROUND_Y - 68);
      ctx.stroke();
    }
  } else if (level.biome === 'rec_swamp') {
    const step = 290;
    const start = Math.floor((camX * 0.36) / step) - 1;
    for (let i = start; i < start + Math.ceil(w / step) + 2; i++) {
      const sx = i * step - camX * 0.36 + 60;
      ctx.fillStyle = 'rgba(10, 24, 15, 0.84)';
      ctx.fillRect(sx, GROUND_Y - 210, 24, 210);
      ctx.strokeStyle = 'rgba(16, 40, 22, 0.8)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(sx + 12, GROUND_Y - 175);
      ctx.quadraticCurveTo(sx + 75, GROUND_Y - 195, sx + 125, GROUND_Y - 160);
      ctx.stroke();
      for (let m = 0; m < 4; m++) {
        const mx = sx + 38 + m * 22;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(mx, GROUND_Y - 178);
        ctx.lineTo(mx + Math.sin(elapsed * 1.8 + m) * 5, GROUND_Y - 135 - (m % 2) * 14);
        ctx.stroke();
      }
    }
  } else if (level.biome === 'ruined_keep') {
    const step = 360;
    const start = Math.floor((camX * 0.28) / step) - 1;
    for (let i = start; i < start + Math.ceil(w / step) + 2; i++) {
      const ax = i * step - camX * 0.28 + 110;
      const hover = Math.sin(elapsed * 1.1 + i) * 6;
      ctx.fillStyle = 'rgba(30, 41, 59, 0.62)';
      ctx.fillRect(ax - 36, GROUND_Y - 165, 16, 165);
      ctx.fillRect(ax + 20, GROUND_Y - 165, 16, 165);
      ctx.beginPath();
      ctx.arc(ax, GROUND_Y - 165, 36, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = 'rgba(125, 211, 252, 0.28)';
      ctx.beginPath();
      ctx.moveTo(ax, 95 + hover);
      ctx.lineTo(ax + 14, 130 + hover);
      ctx.lineTo(ax, 165 + hover);
      ctx.lineTo(ax - 14, 130 + hover);
      ctx.closePath();
      ctx.fill();
    }
    if (quality !== 'low') {
      drawVolumetricGodRays(ctx, w, elapsed, 'rgba(186, 230, 253, 0.12)');
    }
  } else if (level.biome === 'frost_torrent') {
    const step = 310;
    const start = Math.floor((camX * 0.26) / step) - 1;
    for (let i = start; i < start + Math.ceil(w / step) + 2; i++) {
      const gx = i * step - camX * 0.26 + 90;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(56, 189, 248, 0.22)' : 'rgba(244, 63, 94, 0.20)';
      ctx.beginPath();
      ctx.moveTo(gx - 65, GROUND_Y + 20);
      ctx.lineTo(gx, GROUND_Y - 220 - (i % 3) * 35);
      ctx.lineTo(gx + 75, GROUND_Y + 20);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (quality === 'high') {
      drawHalftonePattern(ctx, w, GROUND_Y, 0.14, 'rgba(56, 189, 248, 0.25)');
    }
  } else if ((style === 'blender_3d' || style === 'cgi_realistic') && quality !== 'low') {
    drawVolumetricGodRays(ctx, w, elapsed, 'rgba(251, 191, 36, 0.08)');
  }

  ctx.restore();
}

function drawParallaxBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  camX: number,
  level: LevelConfig,
  style: AnimationStyleMode,
  elapsed: number,
  quality: QualityTier
) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, level.skyColors[0]);
  sky.addColorStop(0.55, level.skyColors[1]);
  sky.addColorStop(1, level.skyColors[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  if (level.backdropKey) {
    drawProceduralBackdropPlate(ctx, level.backdropKey, w, h, camX, elapsed, quality);
  }

  if (style === 'kindergarten') {
    drawKindergartenPaperAndSun(ctx, w, h, camX, elapsed);
  } else if (!level.backdropKey) {
    const moonX = w * 0.78 - camX * 0.025;
    const moonY = h * 0.22;
    ctx.save();
    const moonRadius = level.id === 10 ? 64 : 42;
    if (quality !== 'low') {
      const halo = ctx.createRadialGradient(
        moonX,
        moonY,
        moonRadius * 0.3,
        moonX,
        moonY,
        moonRadius * 3.0
      );
      halo.addColorStop(
        0,
        level.id === 8 || level.id === 9
          ? 'rgba(251, 146, 60, 0.48)'
          : style === 'sumi_scroll'
          ? 'rgba(185, 28, 28, 0.22)'
          : 'rgba(226, 232, 240, 0.42)'
      );
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonRadius * 3.0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle =
      style === 'sumi_scroll'
        ? '#b91c1c'
        : level.id === 8 || level.id === 9
        ? '#fdba74'
        : '#f8fafc';
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (!level.backdropKey) {
    ctx.save();
    const farColor =
      style === 'kindergarten'
        ? 'rgba(134, 239, 172, 0.55)'
        : style === 'sumi_scroll'
        ? 'rgba(41, 37, 36, 0.28)'
        : style === 'rec_horror'
        ? 'rgba(14, 34, 21, 0.82)'
        : 'rgba(10, 15, 24, 0.55)';
    ctx.fillStyle = farColor;
    const stepFar = 280;
    const startFar = Math.floor((camX * 0.18) / stepFar) - 1;
    for (let i = startFar; i < startFar + Math.ceil(w / stepFar) + 3; i++) {
      const bx = i * stepFar - camX * 0.18;
      const seed = Math.abs(Math.sin(i * 19.7));
      const ridgeH = style === 'kindergarten' ? 68 + seed * 50 : 110 + seed * 125;
      ctx.beginPath();
      ctx.moveTo(bx - 40, GROUND_Y + 40);
      ctx.lineTo(bx + stepFar * 0.35, GROUND_Y - ridgeH);
      ctx.lineTo(bx + stepFar * 0.72, GROUND_Y - ridgeH * 0.65);
      ctx.lineTo(bx + stepFar + 40, GROUND_Y + 40);
      ctx.closePath();
      ctx.fill();
      if (style === 'kindergarten') {
        ctx.strokeStyle = '#15803d';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawBiomeSceneryDetails(ctx, w, camX, level, style, elapsed, quality);

  if (!level.backdropKey) {
    ctx.save();
    const stepMid = 215;
    const startMid = Math.floor((camX * 0.42) / stepMid) - 1;
    for (let i = startMid; i < startMid + Math.ceil(w / stepMid) + 3; i++) {
      const tx = i * stepMid - camX * 0.42;
      const sway = Math.sin(elapsed * 1.4 + i) * 5;
      if (style === 'kindergarten') {
        ctx.fillStyle = '#92400e';
        ctx.fillRect(tx - 6, GROUND_Y - 82, 12, 86);
        ctx.fillStyle = '#22c55e';
        ctx.strokeStyle = '#14532d';
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.arc(tx, GROUND_Y - 105, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (style === 'sumi_scroll') {
        ctx.strokeStyle = 'rgba(28, 25, 23, 0.55)';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(tx, GROUND_Y + 12);
        ctx.quadraticCurveTo(tx + sway, GROUND_Y - 150, tx + sway * 1.6, 40);
        ctx.stroke();
      } else {
        ctx.strokeStyle =
          style === 'rec_horror' ? 'rgba(8, 22, 13, 0.88)' : 'rgba(12, 16, 22, 0.74)';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(tx, GROUND_Y + 10);
        ctx.quadraticCurveTo(tx - 14, GROUND_Y - 120, tx + 22 + sway, GROUND_Y - 220);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  const mist = ctx.createLinearGradient(0, GROUND_Y - 115, 0, GROUND_Y + 28);
  mist.addColorStop(0, 'rgba(0,0,0,0)');
  mist.addColorStop(1, level.fogColor);
  ctx.fillStyle = mist;
  ctx.fillRect(0, GROUND_Y - 115, w, 143);
}

function drawClimbablesAndStealthAndTraps(
  ctx: CanvasRenderingContext2D,
  camX: number,
  logicalW: number,
  level: LevelConfig,
  puzzles: ActivePuzzleGate[],
  secret: ActiveSecretZone,
  playerX: number,
  elapsed: number
) {
  const worldLeft = camX - 90;
  const worldRight = camX + logicalW + 90;

  // 1. Climbables (Trees, Vines, Ivy Walls, Bamboo Poles, Ladders)
  for (const cl of level.climbables) {
    if (cl.x + cl.w < worldLeft || cl.x > worldRight) continue;
    const cx = cl.x - camX;
    const yBot = GROUND_Y - cl.yBottom;
    const yTop = GROUND_Y - cl.yTop;
    const near = Math.abs(playerX - (cl.x + cl.w * 0.5)) < 48;

    ctx.save();
    if (cl.kind === 'tree_trunk') {
      ctx.fillStyle = '#5c3a21';
      ctx.fillRect(cx + 4, yTop, cl.w - 8, yBot - yTop);
      ctx.fillStyle = '#15803d';
      ctx.beginPath();
      ctx.arc(cx + cl.w * 0.5, yTop - 6, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3f2310';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx + 4, yTop, cl.w - 8, yBot - yTop);
    } else if (cl.kind === 'vine' || cl.kind === 'ivy_wall') {
      ctx.strokeStyle = cl.kind === 'vine' ? '#16a34a' : '#22c55e';
      ctx.lineWidth = cl.kind === 'ivy_wall' ? 8 : 5;
      ctx.beginPath();
      for (let yy = yTop; yy <= yBot; yy += 12) {
        const vx = cx + cl.w * 0.5 + Math.sin(yy * 0.12 + elapsed * 2) * 3;
        if (yy === yTop) ctx.moveTo(vx, yy);
        else ctx.lineTo(vx, yy);
      }
      ctx.stroke();
      ctx.fillStyle = '#4ade80';
      for (let yy = yTop + 14; yy < yBot - 10; yy += 24) {
        ctx.beginPath();
        ctx.ellipse(cx + cl.w * 0.5 + 7, yy, 5, 2.5, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (cl.kind === 'bamboo_pole') {
      ctx.fillStyle = '#4d7c0f';
      ctx.fillRect(cx + cl.w * 0.35, yTop, 10, yBot - yTop);
      ctx.strokeStyle = '#bef264';
      ctx.lineWidth = 2;
      for (let yy = yTop + 18; yy < yBot; yy += 28) {
        ctx.beginPath();
        ctx.moveTo(cx + cl.w * 0.35 - 2, yy);
        ctx.lineTo(cx + cl.w * 0.35 + 12, yy);
        ctx.stroke();
      }
    } else {
      // tower_ladder
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + 4, yTop);
      ctx.lineTo(cx + 4, yBot);
      ctx.moveTo(cx + cl.w - 4, yTop);
      ctx.lineTo(cx + cl.w - 4, yBot);
      for (let yy = yTop + 14; yy < yBot; yy += 20) {
        ctx.moveTo(cx + 4, yy);
        ctx.lineTo(cx + cl.w - 4, yy);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  // 2. Traps (Spikes, Dart Walls, Icicle Drops, Fire Jets)
  for (const tr of level.traps) {
    if (tr.x + tr.w < worldLeft || tr.x > worldRight) continue;
    const tx = tr.x - camX;
    const ty = GROUND_Y - tr.y;
    const interval = tr.interval ?? 2.6;
    const cycle = ((elapsed + (tr.phaseOffset ?? 0)) % interval) / interval;

    ctx.save();
    if (tr.kind === 'spikes') {
      const teeth = Math.max(3, Math.floor(tr.w / 12));
      const tw = tr.w / teeth;
      ctx.fillStyle = '#94a3b8';
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < teeth; i++) {
        ctx.beginPath();
        ctx.moveTo(tx + i * tw, ty);
        ctx.lineTo(tx + (i + 0.5) * tw, ty - 18);
        ctx.lineTo(tx + (i + 1) * tw, ty);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else if (tr.kind === 'dart_wall') {
      ctx.fillStyle = '#334155';
      ctx.fillRect(tx, ty - 28, 22, 34);
      ctx.fillStyle = cycle > 0.78 ? '#ef4444' : '#f59e0b';
      ctx.beginPath();
      ctx.arc(tx + (tr.dir === 1 ? 18 : 4), ty - 11, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (tr.kind === 'icicle_drop') {
      const warn = cycle > 0.65;
      const shake = warn ? Math.sin(elapsed * 45) * 2.5 : 0;
      ctx.fillStyle = warn ? '#e0f2fe' : '#7dd3fc';
      ctx.beginPath();
      ctx.moveTo(tx + shake, ty - 210);
      ctx.lineTo(tx + 12 + shake, ty - 165);
      ctx.lineTo(tx + 24 + shake, ty - 210);
      ctx.closePath();
      ctx.fill();
    } else if (tr.kind === 'fire_jet') {
      ctx.fillStyle = '#292524';
      ctx.fillRect(tx, ty - 7, tr.w, 8);
      const isWarmup = cycle >= 0.45 && cycle < 0.62;
      const isFiring = cycle >= 0.62;
      if (isWarmup) {
        ctx.fillStyle = 'rgba(251, 146, 60, 0.55)';
        ctx.fillRect(tx + 4, ty - 14, tr.w - 8, 8);
      } else if (isFiring) {
        const fh = 96 + Math.sin(elapsed * 32) * 14;
        const fg = ctx.createLinearGradient(0, ty, 0, ty - fh);
        fg.addColorStop(0, '#fef08a');
        fg.addColorStop(0.45, '#f97316');
        fg.addColorStop(1, 'rgba(220, 38, 38, 0)');
        ctx.fillStyle = fg;
        ctx.fillRect(tx + 3, ty - fh, tr.w - 6, fh);
      }
    } else if (tr.kind === 'pendulum_blade') {
      const pInterval = tr.interval ?? 2.0;
      const pAngle = Math.sin(elapsed * ((Math.PI * 2) / pInterval) + (tr.phaseOffset ?? 0)) * 1.15;
      const pLen = tr.length ?? 130;
      const bobScreenX = tx + Math.sin(pAngle) * pLen;
      const bobY = ty + Math.cos(pAngle) * pLen;

      // Subtle sweep arc guide
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tx, ty, pLen, Math.PI * 0.5 - 1.15, Math.PI * 0.5 + 1.15);
      ctx.stroke();

      // Anchor & chain
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(tx, ty, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(bobScreenX, bobY);
      ctx.stroke();

      // Crescent blade bob
      ctx.save();
      ctx.translate(bobScreenX, bobY);
      ctx.rotate(-pAngle);
      ctx.fillStyle = '#e2e8f0';
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-26, -6);
      ctx.quadraticCurveTo(0, 22, 26, -6);
      ctx.quadraticCurveTo(0, 6, -26, -6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // 3. Puzzle Switches & Locking Gates
  for (const pz of puzzles) {
    const swX = pz.switchX - camX;
    const swY = GROUND_Y - pz.switchY;
    const gtX = pz.gateX - camX;
    const nearSwitch = Math.abs(playerX - pz.switchX) < 75;

    ctx.save();
    if (swX > -60 && swX < logicalW + 60) {
      ctx.fillStyle = pz.solved ? '#38bdf8' : '#f59e0b';
      if (pz.kind === 'lever_terminal') {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(swX - 10, swY - 34, 20, 34);
        ctx.fillStyle = pz.solved ? '#22c55e' : '#ef4444';
        ctx.fillRect(swX - 6, swY - 28, 12, 10);
      } else {
        ctx.beginPath();
        ctx.ellipse(swX, swY - 3, 18, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pz.solved ? 'rgba(56, 189, 248, 0.35)' : 'rgba(251, 191, 36, 0.32)';
        ctx.beginPath();
        ctx.arc(swX, swY - 14, 18, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!pz.solved && nearSwitch) {
        ctx.fillStyle = '#fef08a';
        ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('[E]', swX, swY - 40);
      }
    }

    if (gtX > -60 && gtX < logicalW + 60) {
      const lift = pz.openProgress * (pz.gateHeight - 12);
      const barH = pz.gateHeight - lift;
      if (barH > 4) {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(gtX - 10, GROUND_Y - pz.gateHeight, 20, barH);
        ctx.strokeStyle = pz.solved ? '#38bdf8' : '#f59e0b';
        ctx.lineWidth = 2;
        ctx.strokeRect(gtX - 10, GROUND_Y - pz.gateHeight, 20, barH);
      }
    }
    ctx.restore();
  }

  // 4. Secret Zone Floating Relic
  if (!secret.collected) {
    const rx = secret.x - camX;
    if (rx > -60 && rx < logicalW + 60) {
      const ry = GROUND_Y - secret.y + Math.sin(elapsed * 3.1) * 6;
      ctx.save();
      const aura = ctx.createRadialGradient(rx, ry, 2, rx, ry, 28);
      aura.addColorStop(0, 'rgba(253, 224, 71, 0.92)');
      aura.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(rx, ry, 28, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = secret.kind === 'moon_pearl' ? '#bae6fd' : '#fde047';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(rx, ry - 11);
      ctx.lineTo(rx + 9, ry);
      ctx.lineTo(rx, ry + 11);
      ctx.lineTo(rx - 9, ry);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawStealthCoversForeground(
  ctx: CanvasRenderingContext2D,
  camX: number,
  logicalW: number,
  level: LevelConfig,
  elapsed: number
) {
  const worldLeft = camX - 80;
  const worldRight = camX + logicalW + 80;
  for (const cov of level.stealthCovers) {
    if (cov.x + cov.w < worldLeft || cov.x > worldRight) continue;
    const cx = cov.x - camX;
    const cy = GROUND_Y - cov.y;
    ctx.save();
    if (cov.kind === 'shadow_crate') {
      ctx.fillStyle = 'rgba(30, 41, 59, 0.78)';
      ctx.fillRect(cx, cy - cov.h, cov.w, cov.h);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx, cy - cov.h, cov.w, cov.h);
    } else {
      const color =
        cov.kind === 'bamboo_thicket'
          ? 'rgba(34, 197, 94, 0.56)'
          : cov.kind === 'mist_reed'
          ? 'rgba(103, 232, 249, 0.42)'
          : 'rgba(21, 128, 61, 0.58)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 3.2;
      for (let bx = cx + 6; bx < cx + cov.w - 4; bx += 9) {
        const sway = Math.sin(elapsed * 2.5 + bx * 0.1) * 4;
        ctx.beginPath();
        ctx.moveTo(bx, cy);
        ctx.quadraticCurveTo(bx + sway, cy - cov.h * 0.55, bx + sway * 1.4, cy - cov.h);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function drawTerrainAndHazards(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  camX: number,
  level: LevelConfig,
  platforms: ActivePlatformState[],
  style: AnimationStyleMode,
  elapsed: number
) {
  const worldLeft = camX - 80;
  const worldRight = camX + w + 80;

  let cursor = 0;
  const sortedHazards = getSortedHazards(level);

  const drawGroundSpan = (x0: number, x1: number) => {
    if (x1 <= x0 || x1 < worldLeft || x0 > worldRight) return;
    const sx = x0 - camX;
    const sw = x1 - x0;

    if (style === 'kindergarten') {
      ctx.fillStyle = '#a16207';
      ctx.fillRect(sx, GROUND_Y + 10, sw, h - GROUND_Y);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(sx, GROUND_Y, sw, 14);
      ctx.strokeStyle = '#14532d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, GROUND_Y);
      for (let px = sx; px <= sx + sw; px += 14) {
        ctx.lineTo(px, GROUND_Y + (px % 28 === 0 ? -4 : 3));
      }
      ctx.stroke();
    } else if (style === 'sumi_scroll') {
      ctx.fillStyle = '#c8b48e';
      ctx.fillRect(sx, GROUND_Y, sw, h - GROUND_Y);
      ctx.strokeStyle = '#1c1917';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sx, GROUND_Y);
      ctx.lineTo(sx + sw, GROUND_Y);
      ctx.stroke();
    } else {
      const groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, h);
      if (level.biome === 'rec_swamp') {
        groundGrad.addColorStop(0, '#182b1d');
        groundGrad.addColorStop(1, '#070f09');
      } else if (level.biome === 'frost_torrent') {
        groundGrad.addColorStop(0, '#475569');
        groundGrad.addColorStop(1, '#0f172a');
      } else if (level.biome === 'stray_alley' || level.biome === 'siege_ramparts') {
        groundGrad.addColorStop(0, '#1f242c');
        groundGrad.addColorStop(1, '#080a0e');
      } else {
        groundGrad.addColorStop(0, '#272420');
        groundGrad.addColorStop(1, '#09090b');
      }
      ctx.fillStyle = groundGrad;
      ctx.fillRect(sx, GROUND_Y, sw, h - GROUND_Y);

      ctx.fillStyle =
        level.biome === 'bamboo_curse'
          ? 'rgba(101, 163, 13, 0.38)'
          : level.biome === 'frost_torrent'
          ? 'rgba(186, 230, 253, 0.48)'
          : style === 'blender_3d' || style === 'cgi_realistic' || style === 'pixar_3d'
          ? 'rgba(245, 182, 92, 0.22)'
          : 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(sx, GROUND_Y, sw, 5);
    }
  };

  for (const hz of sortedHazards) {
    if (hz.x > cursor) {
      drawGroundSpan(cursor, hz.x);
    }
    const hx = hz.x - camX;
    if (hz.x + hz.w >= worldLeft && hz.x <= worldRight) {
      if (hz.kind === 'river') {
        const waterGrad = ctx.createLinearGradient(0, GROUND_Y + 6, 0, h);
        waterGrad.addColorStop(0, level.biome === 'frost_torrent' ? '#0284c7' : '#0e7490');
        waterGrad.addColorStop(1, '#082f49');
        ctx.fillStyle = waterGrad;
        ctx.fillRect(hx, GROUND_Y + 8, hz.w, h - GROUND_Y);

        ctx.strokeStyle = 'rgba(224, 242, 254, 0.6)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const wy = GROUND_Y + 14 + i * 16;
          const phase = ((elapsed * -105 + i * 47) % hz.w + hz.w) % hz.w;
          ctx.beginPath();
          ctx.moveTo(hx + phase, wy);
          ctx.lineTo(hx + Math.min(hz.w, phase + 38), wy);
          ctx.stroke();
        }
      } else if (hz.kind === 'swamp') {
        ctx.fillStyle = style === 'rec_horror' ? '#132a17' : '#2b331b';
        ctx.fillRect(hx, GROUND_Y + 4, hz.w, h - GROUND_Y);
        ctx.fillStyle = 'rgba(132, 204, 22, 0.35)';
        for (let b = 0; b < 5; b++) {
          const bx = hx + ((b * 53 + 20) % Math.max(40, hz.w - 20));
          const r = 3 + ((elapsed * 2 + b) % 1) * 5;
          ctx.beginPath();
          ctx.arc(bx, GROUND_Y + 8, r, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (hz.kind === 'fire_trench') {
        ctx.fillStyle = '#1c0a09';
        ctx.fillRect(hx, GROUND_Y + 6, hz.w, h - GROUND_Y);
        for (let f = 0; f < Math.ceil(hz.w / 24); f++) {
          const fx = hx + f * 24 + 12;
          const fh = 20 + Math.sin(elapsed * 14 + f) * 10;
          const fg = ctx.createLinearGradient(fx, GROUND_Y + 10, fx, GROUND_Y - fh);
          fg.addColorStop(0, '#dc2626');
          fg.addColorStop(0.6, '#f97316');
          fg.addColorStop(1, 'rgba(253, 224, 71, 0)');
          ctx.fillStyle = fg;
          ctx.beginPath();
          ctx.moveTo(fx - 11, GROUND_Y + 10);
          ctx.lineTo(fx, GROUND_Y - fh);
          ctx.lineTo(fx + 11, GROUND_Y + 10);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        ctx.fillStyle = '#050507';
        ctx.fillRect(hx, GROUND_Y + 2, hz.w, h - GROUND_Y);
      }
    }
    cursor = Math.max(cursor, hz.x + hz.w);
  }
  drawGroundSpan(cursor, level.length + 400);

  // Active Moving, Crumbling & Material Platforms
  for (const p of platforms) {
    if (p.curX + p.w < worldLeft || p.curX > worldRight) continue;
    const jitterX = p.crumbleTimer > 0 && p.brokenTimer <= 0 ? Math.sin(elapsed * 55) * 2.5 : 0;
    const px = p.curX - camX + jitterX;
    const py = GROUND_Y - p.curY;
    ctx.save();

    if (p.brokenTimer > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(px, py, p.w, p.h);
      ctx.restore();
      continue;
    }

    if (style === 'kindergarten') {
      ctx.fillStyle = '#fb923c';
      ctx.fillRect(px, py, p.w, p.h);
      ctx.strokeStyle = '#7c2d12';
      ctx.lineWidth = 3;
      ctx.strokeRect(px, py, p.w, p.h);
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let zx = px + 6; zx < px + p.w - 6; zx += 14) {
        ctx.lineTo(zx, py + (zx % 28 < 14 ? 5 : p.h - 5));
      }
      ctx.stroke();
    } else if (style === 'sumi_scroll') {
      ctx.fillStyle = '#b49b72';
      ctx.fillRect(px, py, p.w, p.h);
      ctx.strokeStyle = '#1c1917';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(px, py, p.w, p.h);
      ctx.fillStyle = 'rgba(28, 25, 23, 0.2)';
      ctx.fillRect(px + 4, py + p.h - 4, p.w - 8, 3);
    } else if (p.kind === 'neon_catwalk') {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(px, py, p.w, p.h);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(px, py, p.w, 3.5);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
      for (let sx = px + 14; sx < px + p.w - 10; sx += 28) {
        ctx.fillRect(sx, py + 5, 10, p.h - 8);
      }
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px, py, p.w, p.h);
    } else if (p.kind === 'ice') {
      const iceG = ctx.createLinearGradient(0, py, 0, py + p.h);
      iceG.addColorStop(0, '#bae6fd');
      iceG.addColorStop(1, '#0284c7');
      ctx.fillStyle = iceG;
      ctx.fillRect(px, py, p.w, p.h);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.fillRect(px, py, p.w, 4);
      ctx.fillStyle = 'rgba(186, 230, 253, 0.8)';
      for (let ix = px + 10; ix < px + p.w - 10; ix += 22) {
        ctx.beginPath();
        ctx.moveTo(ix - 4, py + p.h);
        ctx.lineTo(ix, py + p.h + 10 + (ix % 7));
        ctx.lineTo(ix + 4, py + p.h);
        ctx.closePath();
        ctx.fill();
      }
    } else if (p.kind === 'wood' || p.kind === 'root' || p.kind === 'bridge') {
      ctx.fillStyle = p.kind === 'bridge' ? '#6b4226' : '#573b26';
      ctx.fillRect(px, py, p.w, p.h);
      ctx.fillStyle = 'rgba(255, 240, 210, 0.16)';
      ctx.fillRect(px, py, p.w, 3.5);
      ctx.fillStyle = 'rgba(20, 12, 6, 0.48)';
      for (let wx = px + 26; wx < px + p.w - 6; wx += 26) {
        ctx.fillRect(wx, py + 2, 2, p.h - 4);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px, py, p.w, p.h);
    } else {
      ctx.fillStyle = p.kind === 'ruin' ? '#3f3b38' : '#44403c';
      ctx.fillRect(px, py, p.w, p.h);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(px, py, p.w, 3.5);
      ctx.strokeStyle = 'rgba(12, 10, 9, 0.42)';
      ctx.lineWidth = 1.2;
      for (let bx = px + 22; bx < px + p.w - 4; bx += 22) {
        ctx.beginPath();
        ctx.moveTo(bx, py + 3);
        ctx.lineTo(bx, py + p.h);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(px, py, p.w, p.h);
    }
    ctx.restore();
  }

  // Goal Shrine / Torii Gate at end of level
  const goalX = level.length - 110 - camX;
  if (goalX > -120 && goalX < w + 120) {
    ctx.save();
    const glow = ctx.createRadialGradient(goalX, GROUND_Y - 62, 6, goalX, GROUND_Y - 62, 95);
    glow.addColorStop(
      0,
      level.id === 10 ? 'rgba(254, 240, 138, 0.72)' : 'rgba(245, 182, 92, 0.54)'
    );
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(goalX, GROUND_Y - 62, 95, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = style === 'kindergarten' ? '#b91c1c' : '#1f1614';
    ctx.fillRect(goalX - 38, GROUND_Y - 125, 12, 125);
    ctx.fillRect(goalX + 26, GROUND_Y - 125, 12, 125);
    ctx.fillRect(goalX - 52, GROUND_Y - 132, 104, 14);
    ctx.fillRect(goalX - 42, GROUND_Y - 105, 84, 8);
    ctx.restore();
  }
}

function drawPlayerGroundContactAndSlash(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  player: PlayerState,
  style: AnimationStyleMode,
  elapsed: number
) {
  const shadowScale = clamp(1 - (GROUND_Y - sy) / 180, 0.35, 1);
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(
    sx,
    player.grounded ? sy + 2 : GROUND_Y + 2,
    24 * shadowScale,
    6.5 * shadowScale,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // Super Jump crouch indicator
  if (player.crouching && player.crouchCharge >= 0.4) {
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(sx, sy - 2, 26, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Charging Heavy Attack golden ring
  if (player.isChargingAttack && player.chargeAttackTimer > 0.15) {
    const chRatio = clamp(player.chargeAttackTimer / 0.9, 0, 1);
    ctx.strokeStyle = chRatio >= 0.85 ? '#fde047' : '#fb923c';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.arc(sx, sy - 24, 22 + Math.sin(elapsed * 20) * 3, 0, Math.PI * 2 * chRatio);
    ctx.stroke();
  }

  // Block & Parry Aura
  if (player.blocking) {
    const isParry = player.parryWindow > 0;
    ctx.strokeStyle = isParry ? '#fde047' : '#38bdf8';
    ctx.lineWidth = isParry ? 4 : 2.8;
    ctx.beginPath();
    ctx.arc(
      sx + player.facing * 12,
      sy - 24,
      30,
      player.facing > 0 ? -0.95 : Math.PI - 0.95,
      player.facing > 0 ? 0.95 : Math.PI + 0.95
    );
    ctx.stroke();
  }

  // Counterattack Ready Gleam
  if (player.counterReadyTimer > 0) {
    ctx.strokeStyle = 'rgba(254, 240, 138, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy - 24, 34, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Furia Felina Aura (Fever State)
  if (player.feverTimer > 0) {
    const pulse = 1 + Math.sin(elapsed * 18) * 0.12;
    const fg = ctx.createRadialGradient(sx, sy - 22, 6, sx, sy - 22, 42 * pulse);
    fg.addColorStop(0, 'rgba(253, 224, 71, 0.36)');
    fg.addColorStop(0.55, 'rgba(244, 63, 94, 0.25)');
    fg.addColorStop(1, 'rgba(244, 63, 94, 0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(sx, sy - 22, 42 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.72)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(sx, sy - 22, 29 * pulse, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Punch shockwave
  if (player.punchTimer > 0) {
    const pp = 1 - player.punchTimer / 0.22;
    ctx.save();
    ctx.translate(sx + player.facing * 26, sy - 24);
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 3.5 * (1 - pp * 0.6);
    ctx.beginPath();
    ctx.arc(0, 0, 12 + pp * 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Claw slash arcs
  if (player.attackTimer > 0) {
    const slashP = 1 - player.attackTimer / 0.28;
    ctx.translate(sx, sy);
    ctx.scale(player.facing, 1);
    ctx.strokeStyle =
      player.pounceTimer > 0
        ? '#fde047'
        : style === 'pixar_3d'
        ? '#fde047'
        : '#f59e0b';
    ctx.lineWidth = (player.pounceTimer > 0 ? 6.5 : 4.5) * (1 - slashP * 0.45);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(24, -22, player.pounceTimer > 0 ? 40 : 34, -0.9 + slashP * 0.5, 0.75 + slashP * 0.4);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(27, -22, 30, -0.65 + slashP * 0.4, 0.55 + slashP * 0.35);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBrushInkStroke(
  ctx: CanvasRenderingContext2D,
  rawPoints: StrokePoint[],
  baseWidth: number,
  opacity: number,
  dryBrush: number,
  rgb = '18, 17, 16',
  boilTick = 0,
  boilAmt = 0.42
) {
  const boiled = rawPoints.map((pt, idx) => ({
    x: pt.x + Math.sin(boilTick * 2.17 + idx * 2 * 3.71) * boilAmt,
    y: pt.y + Math.sin(boilTick * 2.17 + (idx * 2 + 1) * 3.71) * boilAmt,
    p: pt.p,
  }));
  const pts = interpolateCatmullRom(boiled, 7);
  if (pts.length < 2) return;
  const total = pts.length;
  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < total; i++) {
    const curr = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(total - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const u = i / (total - 1);
    let taper = 1;
    if (u < 0.14) taper = 0.28 + 0.72 * (u / 0.14);
    else if (u > 0.8) taper = 0.16 + 0.84 * ((1 - u) / 0.2);
    const halfW = Math.max(0.35, (baseWidth * curr.p * taper) / 2);
    left.push({ x: curr.x + nx * halfW, y: curr.y + ny * halfW });
    right.push({ x: curr.x - nx * halfW, y: curr.y - ny * halfW });
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = `rgba(${rgb}, ${opacity})`;
  ctx.fill();

  if (dryBrush > 0.08 && baseWidth >= 3.2) {
    ctx.beginPath();
    let down = false;
    for (let i = 0; i < total; i += 2) {
      if (Math.sin(i * 0.6 + boilTick * 0.4) > -0.15) {
        if (!down) {
          ctx.moveTo(pts[i].x, pts[i].y);
          down = true;
        } else {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
      } else {
        down = false;
      }
    }
    ctx.strokeStyle = `rgba(250, 246, 238, ${dryBrush * 0.24})`;
    ctx.lineWidth = Math.max(0.5, baseWidth * 0.09);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDetailedCat(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  player: PlayerState,
  style: AnimationStyleMode,
  alpha = 1,
  tintOverride?: string
) {
  const animT =
    style === 'kindergarten' || style === 'spiderverse'
      ? Math.floor(player.animTime * 12) / 12
      : player.animTime;
  const boilTick = Math.floor(player.animTime * 12);
  const st = player.animState;

  const isMoving = Math.abs(player.vx) > 20 && (player.grounded || st === 'climb' || st === 'swim');
  const stridePhase = isMoving ? player.strideAccum : animT * (st === 'exhausted' ? 4.4 : 2.5);
  const sA = Math.sin(stridePhase);
  const cA = Math.cos(stridePhase);

  const crouchAmt = st === 'stealth' ? 0.65 : st === 'crawl' ? 0.78 : st === 'landing' ? 0.45 : 0;
  const deathCollapse = st === 'death' ? 1 : 0;
  const breath = Math.sin(animT * (st === 'exhausted' ? 6.5 : 2.6)) * (st === 'exhausted' ? 2.2 : 1.0);
  const runBounce = isMoving && player.grounded ? Math.abs(cA) * 3.4 : 0;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy - runBounce + deathCollapse * 11);
  ctx.scale(player.facing, 1);

  // Body pitch by animation state (jump rise, fall dive, hurt recoil, climb vertical, death collapse)
  let bodyTilt = 0;
  if (st === 'climb') bodyTilt = -1.22;
  else if (st === 'jump' || st === 'double_jump') bodyTilt = clamp(player.vy * 0.00055, -0.34, 0.2);
  else if (st === 'fall') bodyTilt = 0.22;
  else if (st === 'hurt') bodyTilt = -0.26;
  else if (st === 'death') bodyTilt = 0.18;
  else if (st === 'victory') bodyTilt = -0.14;
  else if (st === 'attack' || st === 'punch') bodyTilt = 0.14;
  ctx.rotate(bodyTilt);

  if (st === 'swim') {
    // Subtle clipping above water line in rivers
    ctx.beginPath();
    ctx.rect(-70, -70, 140, 62);
    ctx.clip();
  }

  const rgbMain = tintOverride
    ? '34, 211, 238'
    : style === 'rec_horror'
    ? '12, 26, 16'
    : '18, 17, 16';
  const rgbFar = tintOverride ? '244, 63, 94' : '11, 11, 10';
  const fillMain = tintOverride ?? (style === 'rec_horror' ? 'rgba(14, 30, 18, 0.94)' : 'rgba(20, 19, 18, 0.92)');

  const bodyScaleY = 1 - crouchAmt * 0.28 - deathCollapse * 0.35;
  const bodyScaleX = 1 + crouchAmt * 0.14 + (st === 'sprint' ? 0.08 : 0);
  ctx.scale(bodyScaleX, bodyScaleY);

  // Core anatomical spine points (Hip -> Lumbar -> MidBack -> Chest -> Neck)
  const arch =
    player.emotion === 'anger' || st === 'attack'
      ? -4.5
      : crouchAmt * 3.5 + (st === 'hurt' ? -3 : 0);
  const hip = { x: -17, y: -19 + breath * 0.4 };
  const lumbar = { x: -7, y: -22 + arch * 0.6 + breath * 0.6 };
  const midBack = { x: 4, y: -23 + arch + breath * 0.8 };
  const chest = { x: 14, y: -21 + breath * 0.5 };
  const neck = { x: 20, y: -26 - crouchAmt * 2 + (st === 'exhausted' ? 3 : 0) };

  // Helper to draw 3-joint Kaguya brush-ink limb
  const drawArticulatedLimb = (
    rx: number,
    ry: number,
    k1x: number,
    k1y: number,
    k2x: number,
    k2y: number,
    px: number,
    py: number,
    isFar: boolean
  ) => {
    const col = isFar ? rgbFar : rgbMain;
    const op = isFar ? 0.72 : 0.95;
    drawBrushInkStroke(
      ctx,
      [
        { x: rx, y: ry, p: 1.15 },
        { x: k1x, y: k1y, p: 0.82 },
        { x: k2x, y: k2y, p: 0.54 },
        { x: px, y: Math.min(0, py), p: 0.64 },
      ],
      5.4,
      op,
      isFar ? 0.2 : 0.62,
      col,
      boilTick,
      0.34
    );
  };

  // Compute limb swing offsets for gait, climb, swim, attack, punch, jump
  const legLift = !player.grounded && st !== 'climb' ? 1 : 0;
  const hSwing = st === 'crawl' ? sA * 5 : isMoving ? sA * 10 : legLift * -6;
  const fSwing = st === 'crawl' ? -sA * 5 : isMoving ? -sA * 10 : legLift * 7;

  // Far limbs behind torso
  drawArticulatedLimb(
    hip.x + 2,
    hip.y + 3,
    hip.x - 4 - hSwing * 0.4,
    -11,
    hip.x + 1 - hSwing * 0.7,
    -5,
    hip.x + 3 - hSwing,
    legLift ? -6 : 0,
    true
  );
  drawArticulatedLimb(
    chest.x - 2,
    chest.y + 3,
    chest.x - 1 - fSwing * 0.4,
    -11,
    chest.x + 2 - fSwing * 0.7,
    -5,
    chest.x + 4 - fSwing,
    legLift ? -5 : 0,
    true
  );

  // Flowing S-curve Kaguya brush-ink tail
  const tailDroop = st === 'exhausted' || st === 'death' || player.emotion === 'sadness' ? 10 : 0;
  const tailCurl = st === 'victory' ? -12 : Math.sin(animT * 5.2) * 7;
  drawBrushInkStroke(
    ctx,
    [
      { x: hip.x - 2, y: hip.y - 1, p: 1.1 },
      { x: hip.x - 14, y: hip.y - 7 + tailDroop * 0.5 + tailCurl * 0.5, p: 0.85 },
      { x: hip.x - 25, y: hip.y - 22 + tailDroop + tailCurl, p: 0.62 },
      { x: hip.x - 20, y: hip.y - 34 + tailDroop + Math.cos(animT * 6) * 5, p: 0.35 },
    ],
    6.4,
    0.94,
    0.68,
    rgbMain,
    boilTick,
    0.55
  );

  // Smooth Catmull-Rom Spine Hull (authentic silhouette from jumpingCatAnimation.ts!)
  const spineDense = interpolateCatmullRom(
    [
      { x: hip.x, y: hip.y, p: 9.6 },
      { x: lumbar.x, y: lumbar.y, p: 8.4 },
      { x: midBack.x, y: midBack.y, p: 9.2 },
      { x: chest.x, y: chest.y, p: 10.6 },
      { x: neck.x, y: neck.y, p: 6.4 },
    ],
    6
  );
  const topHull: Array<{ x: number; y: number }> = [];
  const botHull: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < spineDense.length; i++) {
    const curr = spineDense[i];
    const prev = spineDense[Math.max(0, i - 1)];
    const next = spineDense[Math.min(spineDense.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    topHull.push({ x: curr.x - nx * curr.p * 0.88, y: curr.y - ny * curr.p * 0.88 });
    botHull.push({ x: curr.x + nx * curr.p * 0.94, y: curr.y + ny * curr.p * 0.94 });
  }
  ctx.beginPath();
  ctx.moveTo(topHull[0].x, topHull[0].y);
  for (let i = 1; i < topHull.length; i++) ctx.lineTo(topHull[i].x, topHull[i].y);
  for (let i = botHull.length - 1; i >= 0; i--) ctx.lineTo(botHull[i].x, botHull[i].y);
  ctx.closePath();
  ctx.fillStyle = fillMain;
  ctx.fill();

  // Dry-brush dorsal highlight along back spine
  drawBrushInkStroke(
    ctx,
    [
      { x: hip.x - 3, y: hip.y - 6, p: 0.65 },
      { x: lumbar.x, y: lumbar.y - 8, p: 1.08 },
      { x: midBack.x, y: midBack.y - 9, p: 1.1 },
      { x: chest.x, y: chest.y - 9, p: 0.95 },
      { x: neck.x - 1, y: neck.y - 5, p: 0.58 },
    ],
    5.8,
    0.96,
    0.78,
    rgbMain,
    boilTick,
    0.58
  );

  // Flowing Stray red collar & silk scarf ribbon
  if (!tintOverride) {
    drawBrushInkStroke(
      ctx,
      [
        { x: neck.x - 2, y: neck.y + 3, p: 1.0 },
        { x: chest.x - 7, y: chest.y - 4 + Math.sin(animT * 8) * 3, p: 0.85 },
        { x: lumbar.x - 16 - Math.min(12, Math.abs(player.vx) * 0.04), y: lumbar.y + Math.cos(animT * 9) * 4, p: 0.42 },
      ],
      4.2,
      0.94,
      0.22,
      '215, 38, 46',
      boilTick,
      0.38
    );
  }

  // Near Hind Limb
  drawArticulatedLimb(
    hip.x,
    hip.y + 2,
    hip.x - 5 + hSwing * 0.45,
    -11,
    hip.x + 1 + hSwing * 0.75,
    -5,
    hip.x + 2 + hSwing,
    legLift ? -6 : 0,
    false
  );

  // Near Front Limb (extends violently during Punch or Claw Attack, or raises in Victory!)
  if (st === 'punch' || st === 'attack' || st === 'victory') {
    const extX = st === 'victory' ? 28 : st === 'punch' ? 39 : 36;
    const extY = st === 'victory' ? -42 : st === 'punch' ? -22 : -26 + Math.sin(player.attackTimer * 28) * 5;
    drawBrushInkStroke(
      ctx,
      [
        { x: chest.x + 1, y: chest.y + 1, p: 1.1 },
        { x: chest.x + 12, y: (chest.y + extY) * 0.5, p: 0.85 },
        { x: extX, y: extY, p: 0.78 },
      ],
      5.6,
      0.98,
      0.45,
      rgbMain,
      boilTick,
      0.3
    );
    // Extended bright claws on swipe!
    if ((st === 'attack' || st === 'punch') && !tintOverride) {
      ctx.strokeStyle = '#faf7f0';
      ctx.lineWidth = 1.6;
      for (let c = -1; c <= 1; c++) {
        ctx.beginPath();
        ctx.moveTo(extX, extY + c * 2.5);
        ctx.lineTo(extX + 6, extY + c * 3.5 - 1);
        ctx.stroke();
      }
    }
  } else {
    drawArticulatedLimb(
      chest.x + 1,
      chest.y + 2,
      chest.x + 2 + fSwing * 0.45,
      -11,
      chest.x + 4 + fSwing * 0.75,
      -5,
      chest.x + 5 + fSwing,
      legLift ? -5 : 0,
      false
    );
  }

  // Expressive Kaguya Ink Head + Swept Ears + Amber Radial Iris Eye + Whiskers
  ctx.save();
  const headPitch =
    player.meowTimer > 0
      ? -0.25
      : st === 'exhausted' || player.emotion === 'sadness'
      ? 0.24
      : st === 'hurt'
      ? -0.2
      : st === 'attack' || st === 'punch'
      ? 0.14
      : -0.04;
  ctx.translate(neck.x + 3, neck.y - 4);
  ctx.rotate(headPitch);

  const earSweep =
    player.emotion === 'fear' || player.emotion === 'pain' || player.emotion === 'anger' || st === 'stealth'
      ? 4.2
      : st === 'exhausted'
      ? 3.0
      : 0;

  // Far ear
  ctx.fillStyle = tintOverride ?? 'rgba(30, 29, 27, 0.88)';
  ctx.beginPath();
  ctx.moveTo(-1, -7);
  ctx.lineTo(2 - earSweep * 0.6, -18 + earSweep * 0.7);
  ctx.lineTo(7, -6);
  ctx.closePath();
  ctx.fill();

  // Cranium & sculpted feline muzzle
  ctx.fillStyle = fillMain;
  ctx.beginPath();
  ctx.ellipse(0, 0, 10.5, 9, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(4, -4);
  ctx.quadraticCurveTo(14, -1, 13.5, 4);
  ctx.quadraticCurveTo(9, 8, 1, 7);
  ctx.closePath();
  ctx.fill();

  // Near swept ear + brush outline
  ctx.beginPath();
  ctx.moveTo(-7, -5);
  ctx.lineTo(-5 - earSweep, -19 + earSweep * 0.8);
  ctx.lineTo(2, -7);
  ctx.closePath();
  ctx.fill();

  drawBrushInkStroke(
    ctx,
    [
      { x: -8, y: 4, p: 0.7 },
      { x: -8, y: -6, p: 0.9 },
      { x: -5 - earSweep, y: -18 + earSweep * 0.8, p: 0.45 },
      { x: 1, y: -7, p: 0.8 },
      { x: 12, y: -1, p: 0.7 },
    ],
    2.8,
    0.94,
    0.35,
    rgbMain,
    boilTick,
    0.32
  );

  // Amber / Emerald Radial Iris Eye + Slit Pupil + Specular Highlight
  if (!tintOverride) {
    ctx.save();
    ctx.translate(5.5, -1.2);
    ctx.rotate(player.emotion === 'anger' ? -0.28 : -0.1);
    const eyeH = st === 'hurt' ? 0.35 : st === 'exhausted' ? 0.58 : 1.0;
    ctx.scale(1, eyeH);
    ctx.beginPath();
    ctx.moveTo(-3.4, 0);
    ctx.quadraticCurveTo(0, -2.8, 3.4, 0);
    ctx.quadraticCurveTo(0, 2.8, -3.4, 0);
    ctx.closePath();

    const iris = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 3.4);
    if (style === 'rec_horror') {
      iris.addColorStop(0, '#ecfccb');
      iris.addColorStop(0.7, '#a3e635');
      iris.addColorStop(1, '#365314');
    } else {
      iris.addColorStop(0, '#F7D882');
      iris.addColorStop(0.7, '#DE9B35');
      iris.addColorStop(1, '#7A4910');
    }
    ctx.fillStyle = iris;
    ctx.fill();

    // Dynamic pupil width (dilated in stealth/fear, sharp slit in anger)
    const pupilW =
      player.emotion === 'fear' || st === 'stealth' ? 1.5 : player.emotion === 'anger' ? 0.55 : 0.82;
    ctx.fillStyle = '#0F0E0D';
    ctx.beginPath();
    ctx.ellipse(0.6, 0, pupilW, 2.1, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 252, 244, 0.94)';
    ctx.beginPath();
    ctx.arc(-0.3, -0.7, 0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Open Meow / Hiss Mouth
    if (player.meowTimer > 0 || st === 'hurt') {
      ctx.fillStyle = '#fda4af';
      ctx.beginPath();
      ctx.ellipse(10.5, 4.2, 2.4, 2.0, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fine Kaguya ink whiskers
    drawBrushInkStroke(
      ctx,
      [
        { x: 10, y: 2.5, p: 0.7 },
        { x: -2, y: 3.5, p: 0.4 },
        { x: -15, y: 6.5, p: 0.12 },
      ],
      1.1,
      0.65,
      0,
      rgbMain,
      boilTick,
      0.22
    );
  }

  ctx.restore();
  ctx.restore();
}

function drawWorldObjects(
  ctx: CanvasRenderingContext2D,
  camX: number,
  logicalW: number,
  worldObjects: ActiveWorldObject[],
  playerX: number,
  elapsed: number
) {
  for (const obj of worldObjects) {
    const ox = obj.x - camX;
    if (ox < -80 || ox > logicalW + 80) continue;
    const oy = GROUND_Y - (obj.y ?? 0);
    const nearPlayer = Math.abs(playerX - obj.x) < 105;

    ctx.save();
    if (obj.kind === 'memory_beacon') {
      const pulse = 0.6 + Math.sin(elapsed * 4 + obj.pulsePhase) * 0.4;
      const glowColor = obj.activated ? 'rgba(56, 189, 248, 0.75)' : 'rgba(251, 191, 36, 0.55)';
      const g = ctx.createRadialGradient(ox, oy - 30, 4, ox, oy - 30, 42);
      g.addColorStop(0, glowColor);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ox, oy - 30, 42, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(ox - 10, oy - 44, 20, 44);
      ctx.fillStyle = obj.activated ? '#38bdf8' : `rgba(251, 191, 36, ${pulse})`;
      ctx.fillRect(ox - 6, oy - 38, 12, 16);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox - 10, oy - 44, 20, 44);

      if (!obj.activated && nearPlayer) {
        ctx.fillStyle = '#fef08a';
        ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('[E]', ox, oy - 52);
      }
    } else if (obj.kind === 'scratch_post') {
      ctx.fillStyle = '#78350f';
      ctx.fillRect(ox - 11, oy - 48, 22, 48);
      ctx.fillStyle = obj.activated ? '#92400e' : '#d6b37c';
      ctx.fillRect(ox - 9, oy - 44, 18, 32);
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 1.5;
      for (let sy = oy - 40; sy <= oy - 16; sy += 6) {
        ctx.beginPath();
        ctx.moveTo(ox - 9, sy);
        ctx.lineTo(ox + 9, sy);
        ctx.stroke();
      }
    } else {
      if (obj.activated) {
        ctx.fillStyle = '#451a03';
        ctx.fillRect(ox - 16, oy - 6, 13, 6);
        ctx.fillRect(ox + 2, oy - 5, 14, 5);
      } else {
        ctx.fillStyle = '#854d0e';
        ctx.fillRect(ox - 15, oy - 30, 30, 30);
        ctx.strokeStyle = '#422006';
        ctx.lineWidth = 2;
        ctx.strokeRect(ox - 15, oy - 30, 30, 30);
        ctx.beginPath();
        ctx.moveTo(ox - 15, oy - 30);
        ctx.lineTo(ox + 15, oy);
        ctx.stroke();
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(ox, oy - 15, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function drawEnemyEntity(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  enemy: EnemyState,
  style: AnimationStyleMode,
  elapsed: number
) {
  if (enemy.state === 'dead') return;

  // Ambush-hidden subtle shimmer before popping out
  if (enemy.ambushHidden) {
    ctx.save();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
    ctx.beginPath();
    ctx.arc(sx - 4, sy - 14, 2.5, 0, Math.PI * 2);
    ctx.arc(sx + 5, sy - 14, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Subtle translucent vision cone during patrol / investigate
  if (enemy.state === 'patrol' || enemy.state === 'investigate') {
    ctx.save();
    const coneLen = Math.min(180, enemy.visionRange * 0.45);
    const vGrad = ctx.createLinearGradient(sx, sy - 22, sx + enemy.facing * coneLen, sy - 22);
    vGrad.addColorStop(
      0,
      enemy.state === 'investigate' ? 'rgba(251, 191, 36, 0.16)' : 'rgba(248, 113, 113, 0.08)'
    );
    vGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = vGrad;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 24);
    ctx.lineTo(sx + enemy.facing * coneLen, sy - 58);
    ctx.lineTo(sx + enemy.facing * coneLen, sy + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(sx, sy);

  if (enemy.kind === 'drone_sentinel') {
    const hover = Math.sin(elapsed * 5 + enemy.id) * 6;
    ctx.translate(0, hover);
    ctx.scale(enemy.facing, 1);

    ctx.fillStyle = enemy.hitFlash > 0 ? '#fef2f2' : '#1e293b';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -18, 22, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-24, -32);
    ctx.lineTo(24, -32);
    ctx.stroke();

    ctx.fillStyle =
      enemy.state === 'stunned' ? '#7dd3fc' : enemy.state === 'windup' ? '#ef4444' : '#f59e0b';
    ctx.beginPath();
    ctx.arc(10, -17, 5.5, 0, Math.PI * 2);
    ctx.fill();

    if (enemy.state === 'windup') {
      ctx.fillStyle = '#fde047';
      ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('!', 6, -40);
    } else if (enemy.state === 'investigate') {
      ctx.fillStyle = '#fbbf24';
      ctx.font = '700 14px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('?', 6, -40);
    } else if (enemy.state === 'stunned') {
      ctx.fillStyle = '#7dd3fc';
      ctx.font = '700 13px sans-serif';
      ctx.fillText('✦ ✦', -10, -40 + Math.sin(elapsed * 12) * 2);
    }
    ctx.restore();

    if (enemy.hp < enemy.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(sx - 20, sy - 54, 40, 4);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(sx - 19, sy - 53, 38 * clamp(enemy.hp / enemy.maxHp, 0, 1), 2.5);
    }
    return;
  }

  // Iron Knight (bipedal medieval armored guardian)
  if (enemy.kind === 'iron_knight' || enemy.kind === 'siege_captain') {
    const isCapt = enemy.kind === 'siege_captain';
    ctx.scale(enemy.facing * (isCapt ? 1.24 : 1.05), isCapt ? 1.24 : 1.05);
    const flash = enemy.hitFlash > 0;
    const walk = Math.sin(enemy.animPhase * 9) * (Math.abs(enemy.vx) > 10 ? 1 : 0);

    // Legs
    ctx.strokeStyle = flash ? '#ffffff' : '#334155';
    ctx.lineWidth = 6.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-6, -20);
    ctx.lineTo(-6 - walk * 6, 0);
    ctx.moveTo(6, -20);
    ctx.lineTo(6 + walk * 6, 0);
    ctx.stroke();

    // Tattered crimson cloak
    ctx.fillStyle = isCapt ? '#7f1d1d' : '#450a0a';
    ctx.beginPath();
    ctx.moveTo(-4, -44);
    ctx.lineTo(-22 - Math.sin(elapsed * 4) * 3, -8);
    ctx.lineTo(-6, -12);
    ctx.closePath();
    ctx.fill();

    // Armored cuirass + greathelm
    ctx.fillStyle = flash ? '#fef2f2' : '#475569';
    ctx.fillRect(-12, -46, 24, 28);
    ctx.fillStyle = flash ? '#ffffff' : '#64748b';
    ctx.beginPath();
    ctx.roundRect(-10, -64, 20, 20, 4);
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(1, -56, 8, 3); // visor eye slit

    // Tower shield if armor/shieldUp
    if (enemy.armor > 0 || enemy.shieldUp) {
      ctx.fillStyle = flash ? '#ffffff' : '#94a3b8';
      ctx.fillRect(8, -46, 10, 34);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(8, -46, 10, 34);
    }

    // Greatsword raised during windup
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (enemy.state === 'windup') {
      ctx.moveTo(-4, -38);
      ctx.lineTo(-18, -74);
    } else if (enemy.state === 'attack') {
      ctx.moveTo(6, -34);
      ctx.lineTo(40, -26);
    } else {
      ctx.moveTo(4, -34);
      ctx.lineTo(22, -52);
    }
    ctx.stroke();

    ctx.restore();

    // Status badges & HP bar (unflipped)
    if (enemy.state === 'windup') {
      ctx.fillStyle = '#fde047';
      ctx.font = '700 16px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('!', sx - 3, sy - (isCapt ? 94 : 76));
    } else if (enemy.state === 'investigate') {
      ctx.fillStyle = '#fbbf24';
      ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('?', sx - 3, sy - (isCapt ? 94 : 76));
    } else if (enemy.state === 'stunned') {
      ctx.fillStyle = '#7dd3fc';
      ctx.font = '700 13px sans-serif';
      ctx.fillText('✦ ✦', sx - 12, sy - (isCapt ? 94 : 76));
    }

    const bw = isCapt ? 78 : 50;
    const bx = sx - bw / 2;
    const by = sy - (isCapt ? 84 : 70);
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
    ctx.fillStyle = enemy.armor > 0 ? '#94a3b8' : '#ef4444';
    ctx.fillRect(bx, by, bw * clamp(enemy.hp / enemy.maxHp, 0, 1), 4);
    return;
  }

  // Quadruped Hounds, Wolves, Stalkers & Alpha Boss
  ctx.scale(enemy.facing, 1);
  const isBoss = enemy.kind === 'alpha_guardian';
  const sc = isBoss
    ? 1.66
    : enemy.kind === 'armored_hound'
    ? 1.2
    : enemy.kind === 'wolf_pack'
    ? 1.08
    : enemy.kind === 'crayon_pup'
    ? 0.92
    : 1.0;
  ctx.scale(sc, sc);

  // Boss Phase II / III aura
  if (isBoss && enemy.bossPhase >= 2) {
    ctx.strokeStyle =
      enemy.bossPhase === 3 ? 'rgba(244, 63, 94, 0.72)' : 'rgba(251, 191, 36, 0.62)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, -22, 34 + Math.sin(elapsed * 8) * 3, 22, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const runCycle = Math.sin(enemy.animPhase * 11) * (Math.abs(enemy.vx) > 8 ? 1 : 0.15);
  const flash = enemy.hitFlash > 0;
  const bodyColor = flash
    ? '#fef2f2'
    : enemy.kind === 'crayon_pup'
    ? '#d97706'
    : enemy.kind === 'stray_mongrel'
    ? '#57534e'
    : enemy.kind === 'wolf_pack'
    ? '#334155'
    : enemy.kind === 'hound_leaper'
    ? '#3b0764'
    : enemy.kind === 'swamp_stalker'
    ? '#1f3622'
    : enemy.kind === 'armored_hound' || isBoss
    ? '#27272a'
    : '#3b2418';

  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 5.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-14, -14);
  ctx.lineTo(-14 - runCycle * 6, 0);
  ctx.moveTo(12, -14);
  ctx.lineTo(12 + runCycle * 6, 0);
  ctx.stroke();

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(0, -22, 24, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  if (enemy.kind === 'crayon_pup' || style === 'kindergarten') {
    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }

  if (enemy.kind === 'stray_mongrel') {
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(11, -31);
    ctx.lineTo(13, -15);
    ctx.stroke();
  }

  if (enemy.armor > 0) {
    ctx.fillStyle = flash ? '#ffffff' : '#64748b';
    ctx.beginPath();
    ctx.moveTo(4, -35);
    ctx.lineTo(24, -28);
    ctx.lineTo(22, -10);
    ctx.lineTo(2, -14);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.arc(20, -30, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(22, -32, 14, 9);

  ctx.beginPath();
  if (enemy.kind === 'crayon_pup') {
    ctx.ellipse(14, -26, 4.5, 9, 0.3, 0, Math.PI * 2);
  } else {
    ctx.moveTo(14, -37);
    ctx.lineTo(11, -48);
    ctx.lineTo(20, -39);
    ctx.closePath();
  }
  ctx.fill();

  ctx.fillStyle =
    enemy.state === 'windup'
      ? '#ff2e2e'
      : enemy.kind === 'bolt_archer'
      ? '#fbbf24'
      : enemy.kind === 'crayon_pup'
      ? '#1c1917'
      : '#ef4444';
  ctx.beginPath();
  ctx.arc(23, -31, enemy.state === 'windup' ? 3.4 : 2.3, 0, Math.PI * 2);
  ctx.fill();

  if (enemy.kind === 'bolt_archer') {
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(18, -24);
    ctx.lineTo(36, -24);
    ctx.stroke();
    ctx.strokeStyle = '#d6d3d1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(32, -24, 10, -Math.PI * 0.42, Math.PI * 0.42);
    ctx.stroke();
  }

  ctx.restore();

  if (enemy.state === 'windup') {
    ctx.fillStyle = '#fde047';
    ctx.font = '700 16px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('!', sx - 2, sy - (isBoss ? 100 : 54) + Math.sin(elapsed * 20) * 2);
  } else if (enemy.state === 'investigate') {
    ctx.fillStyle = '#fbbf24';
    ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('?', sx - 2, sy - (isBoss ? 100 : 54));
  } else if (enemy.state === 'stunned') {
    ctx.fillStyle = '#7dd3fc';
    ctx.font = '700 13px sans-serif';
    ctx.fillText('✦ ✦', sx - 12, sy - (isBoss ? 100 : 54) + Math.sin(elapsed * 12) * 2.5);
  }

  if (enemy.hp < enemy.maxHp || isBoss) {
    const bw = isBoss ? 102 : 44;
    const bh = isBoss ? 6 : 4;
    const bx = sx - bw / 2;
    const by = sy - (isBoss ? 94 : 56);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = enemy.armor > 0 ? '#94a3b8' : isBoss && enemy.bossPhase === 3 ? '#f43f5e' : '#ef4444';
    ctx.fillRect(bx, by, bw * clamp(enemy.hp / enemy.maxHp, 0, 1), bh);
  }
}

export function renderGameplayFrame(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  level: LevelConfig,
  platforms: ActivePlatformState[],
  puzzles: ActivePuzzleGate[],
  secret: ActiveSecretZone,
  player: PlayerState,
  enemies: EnemyState[],
  projectiles: ProjectileState[],
  particles: ParticleState[],
  pickups: ActivePickupState[],
  worldObjects: ActiveWorldObject[],
  floatingTexts: FloatingTextState[],
  camX: number,
  shakeX: number,
  shakeY: number,
  elapsed: number,
  hitFlashTimer: number,
  hide2DCat = false,
  quality: QualityTier = 'high'
): void {
  if (!Number.isFinite(viewW) || !Number.isFinite(viewH) || wCheck(viewW, viewH)) {
    return;
  }
  const scale = Math.max(0.1, viewH / LOGICAL_HEIGHT);
  const logicalW = Math.max(100, viewW / scale);
  camX = Number.isFinite(camX) ? camX : 0;
  const activeStyle = resolveActiveStyle(level, player.x, elapsed, hitFlashTimer);

  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(shakeX, shakeY);

  drawParallaxBackdrop(ctx, logicalW, LOGICAL_HEIGHT, camX, level, activeStyle, elapsed, quality);
  drawTerrainAndHazards(ctx, logicalW, LOGICAL_HEIGHT, camX, level, platforms, activeStyle, elapsed);
  drawClimbablesAndStealthAndTraps(
    ctx,
    camX,
    logicalW,
    level,
    puzzles,
    secret,
    player.x,
    elapsed
  );
  drawWorldObjects(ctx, camX, logicalW, worldObjects, player.x, elapsed);

  // Pickups (Lotus Heal, Ember Fury, Fish Ration)
  for (const pk of pickups) {
    if (pk.collected) continue;
    const px = pk.x - camX;
    if (px < -40 || px > logicalW + 40) continue;
    const py = GROUND_Y - pk.y + Math.sin(elapsed * 3.5 + pk.bobPhase) * 6;
    ctx.save();
    const glowClr =
      pk.kind === 'lotus_heal'
        ? 'rgba(244, 114, 182, 0.9)'
        : pk.kind === 'fish_ration'
        ? 'rgba(56, 189, 248, 0.9)'
        : 'rgba(251, 146, 60, 0.95)';
    const g = ctx.createRadialGradient(px, py, 2, px, py, 24);
    g.addColorStop(0, glowClr);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, 24, 0, Math.PI * 2);
    ctx.fill();

    if (pk.kind === 'fish_ration') {
      ctx.fillStyle = '#bae6fd';
      ctx.beginPath();
      ctx.ellipse(px, py, 9, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px - 8, py);
      ctx.lineTo(px - 14, py - 5);
      ctx.lineTo(px - 14, py + 5);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = pk.kind === 'lotus_heal' ? '#fbcfe8' : '#fed7aa';
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (player.ghostDecoy && player.ghostDecoy.life > 0) {
    const gx = player.ghostDecoy.x - camX;
    const gy = player.ghostDecoy.y;
    const gAlpha = clamp(player.ghostDecoy.life / 1.55, 0.18, 0.8);
    ctx.save();
    ctx.strokeStyle = `rgba(34, 211, 238, ${gAlpha * 0.75})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(gx, gy - 20, 26 + Math.sin(elapsed * 14) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    drawDetailedCat(
      ctx,
      gx,
      gy,
      { ...player, facing: player.ghostDecoy.facing, animState: 'stealth', vx: 0 },
      activeStyle,
      gAlpha * 0.72,
      '#22d3ee'
    );
  }

  if (!hide2DCat) {
    for (const tr of player.trail) {
      drawDetailedCat(
        ctx,
        tr.x - camX,
        tr.y,
        player,
        tr.style,
        tr.alpha * 0.45,
        tr.style === 'spiderverse' ? '#38bdf8' : '#f43f5e'
      );
    }
  }

  for (const en of enemies) {
    const ex = en.x - camX;
    if (ex < -110 || ex > logicalW + 110) continue;
    drawEnemyEntity(ctx, ex, en.y, en, activeStyle, elapsed);
  }

  if (hide2DCat) {
    drawPlayerGroundContactAndSlash(ctx, player.x - camX, player.y, player, activeStyle, elapsed);
  } else {
    drawPlayerGroundContactAndSlash(ctx, player.x - camX, player.y, player, activeStyle, elapsed);
    if (player.invulnTimer <= 0 || Math.floor(elapsed * 18) % 2 === 0) {
      if (activeStyle === 'spiderverse' && (player.dashTimer > 0 || player.attackTimer > 0)) {
        drawDetailedCat(ctx, player.x - camX - 4, player.y, player, activeStyle, 0.45, '#22d3ee');
        drawDetailedCat(ctx, player.x - camX + 4, player.y, player, activeStyle, 0.45, '#fb7185');
      }
      drawDetailedCat(ctx, player.x - camX, player.y, player, activeStyle, 1);
    }
  }

  // Foreground Stealth Covers (draw over Kuro/dogs bottom so sneaking inside grass/reed feels real!)
  drawStealthCoversForeground(ctx, camX, logicalW, level, elapsed);

  // Projectiles (bolts, plasma, rejection waves, darts, falling icicles)
  for (const pr of projectiles) {
    const px = pr.x - camX;
    if (px < -60 || px > logicalW + 60) continue;
    ctx.save();
    if (pr.kind === 'rejection_wave') {
      const waveGrad = ctx.createRadialGradient(px, pr.y, 4, px, pr.y, pr.radius * 1.4);
      waveGrad.addColorStop(0, 'rgba(186, 230, 253, 0.95)');
      waveGrad.addColorStop(0.6, 'rgba(59, 130, 246, 0.55)');
      waveGrad.addColorStop(1, 'rgba(30, 58, 138, 0)');
      ctx.fillStyle = waveGrad;
      ctx.beginPath();
      ctx.arc(px, pr.y, pr.radius * 1.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, pr.y, pr.radius * 0.9, Math.PI * 0.65, Math.PI * 1.35);
      ctx.stroke();
    } else if (pr.kind === 'plasma_bolt' || pr.kind === 'claw_wave' || pr.kind === 'ember_fall') {
      ctx.fillStyle =
        pr.kind === 'claw_wave' ? '#fde047' : pr.kind === 'ember_fall' ? '#ef4444' : '#fb923c';
      ctx.beginPath();
      ctx.arc(px, pr.y, pr.kind === 'claw_wave' ? 9 : pr.kind === 'ember_fall' ? 10 : 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pr.kind === 'ember_fall' ? '#fde047' : '#ffffff';
      ctx.beginPath();
      ctx.arc(px, pr.y, pr.kind === 'ember_fall' ? 4.5 : 3.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (pr.kind === 'icicle') {
      ctx.fillStyle = '#bae6fd';
      ctx.beginPath();
      ctx.moveTo(px - 6, pr.y - 16);
      ctx.lineTo(px + 6, pr.y - 16);
      ctx.lineTo(px, pr.y + 10);
      ctx.closePath();
      ctx.fill();
    } else if (pr.kind === 'dart') {
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(px - Math.sign(pr.vx || 1) * 16, pr.y);
      ctx.lineTo(px + Math.sign(pr.vx || 1) * 6, pr.y);
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px - Math.sign(pr.vx || 1) * 14, pr.y);
      ctx.lineTo(px + Math.sign(pr.vx || 1) * 6, pr.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const pt of particles) {
    const px = pt.x - camX;
    if (px < -80 || px > logicalW + 80) continue;
    const alpha = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (pt.kind === 'ring') {
      const expandR = pt.size + (1 - alpha) * 165;
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 3.2 * alpha + 0.8;
      ctx.beginPath();
      ctx.arc(px, pt.y, expandR, 0, Math.PI * 2);
      ctx.stroke();
    } else if (pt.kind === 'halftone' || activeStyle === 'kindergarten') {
      ctx.fillStyle = pt.color;
      ctx.fillRect(px - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    } else {
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(px, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const densityScale = quality === 'low' ? 0.25 : quality === 'medium' ? 0.55 : 1.0;

  if (level.hasRain) {
    ctx.save();
    ctx.strokeStyle =
      activeStyle === 'rec_horror' ? 'rgba(187, 247, 208, 0.28)' : 'rgba(186, 230, 253, 0.25)';
    ctx.lineWidth = 1.2;
    const rainCount = Math.round(44 * densityScale);
    ctx.beginPath();
    for (let r = 0; r < rainCount; r++) {
      const rx = ((r * 97 + elapsed * 320) % (logicalW + 80)) - 40;
      const ry = (r * 73 + elapsed * 780) % LOGICAL_HEIGHT;
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 6, ry + 18);
    }
    ctx.stroke();
    ctx.restore();
  }
  if (level.hasSnow) {
    ctx.save();
    ctx.fillStyle = 'rgba(240, 249, 255, 0.72)';
    const snowCount = Math.round(36 * densityScale);
    ctx.beginPath();
    for (let s = 0; s < snowCount; s++) {
      const sx =
        ((s * 83 + elapsed * 55 + Math.sin(elapsed + s) * 20) % logicalW + logicalW) % logicalW;
      const sy = (s * 61 + elapsed * 95) % LOGICAL_HEIGHT;
      ctx.moveTo(sx + 2.1, sy);
      ctx.arc(sx, sy, 2.1, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }
  if (level.hasEmbers) {
    ctx.save();
    const emberCount = Math.round(28 * densityScale);
    ctx.fillStyle = 'rgba(251, 146, 60, 0.65)';
    ctx.beginPath();
    for (let e = 0; e < emberCount; e++) {
      const ex = ((e * 113 - elapsed * 42) % logicalW + logicalW) % logicalW;
      const ey = LOGICAL_HEIGHT - ((e * 79 + elapsed * 85) % LOGICAL_HEIGHT);
      ctx.moveTo(ex + 2.2, ey);
      ctx.arc(ex, ey, 2.2, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }
  if (level.hasWind || level.windForce) {
    const gust = Math.sin(elapsed * 0.9) * (level.windForce ?? -85);
    const dir = gust >= 0 ? 1 : -1;
    const strength = Math.min(1, Math.abs(gust) / 130);
    if (strength > 0.14) {
      ctx.save();
      ctx.strokeStyle = `rgba(224, 242, 254, ${(0.18 + strength * 0.28).toFixed(2)})`;
      ctx.lineWidth = 1.6;
      const windCount = Math.round(18 * densityScale);
      ctx.beginPath();
      for (let w = 0; w < windCount; w++) {
        const wx = (((w * 137 + elapsed * gust * 4.5) % logicalW) + logicalW) % logicalW;
        const wy = 40 + ((w * 79) % (LOGICAL_HEIGHT - 95));
        const len = 34 + strength * 56;
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx + dir * len, wy + Math.sin(elapsed * 5 + w) * 4);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  for (const ft of floatingTexts) {
    const fx = ft.x - camX;
    const alpha = clamp(ft.life / ft.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `700 ${Math.round(16 * ft.scale)}px "Cormorant Garamond", serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#09090b';
    ctx.fillText(ft.text, fx + 1.5, ft.y + 1.5);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, fx, ft.y);
    ctx.restore();
  }

  if (activeStyle === 'sumi_scroll') {
    drawSumiScrollOverlay(ctx, logicalW, LOGICAL_HEIGHT);
  } else if (activeStyle === 'rec_horror') {
    drawRecCamcorderOverlay(
      ctx,
      logicalW,
      LOGICAL_HEIGHT,
      elapsed,
      player.x - camX,
      player.y,
      player.facing,
      player.hurtTimer
    );
  } else if (activeStyle === 'spiderverse') {
    drawSpiderVersePostEffects(
      ctx,
      logicalW,
      LOGICAL_HEIGHT,
      player.x - camX,
      player.y,
      player.comboHits,
      player.dashTimer,
      quality
    );
  } else if (activeStyle === 'pixar_3d') {
    drawPixarAtmosphereOverlay(ctx, logicalW, LOGICAL_HEIGHT, elapsed, quality);
  }

  ctx.restore();
}

export const PROLOGUE_DURATION = 16.0;

/**
 * Ancient Japanese & Chinese Emakimono Scroll Prologue (26s):
 * Unrolling silk/rice-paper scroll with calligraphic stamps, lanterns, ink wolves & fortress silhouettes
 * dissolving seamlessly into Kuro's 3D journey.
 */
export function renderPrologueFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number
): void {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) return;
  ctx.save();

  ctx.fillStyle = '#120d0a';
  ctx.fillRect(0, 0, w, h);

  const unroll = smoothstep(0.0, 2.2, t);
  const fullW = Math.min(w * 0.92, 1100);
  const scrollW = lerp(80, fullW, unroll);
  const scrollH = Math.min(h * 0.72, 460);
  const leftX = (w - scrollW) * 0.5;
  const topY = (h - scrollH) * 0.44;

  ctx.save();
  ctx.beginPath();
  ctx.rect(leftX, topY, scrollW, scrollH);
  ctx.clip();

  const paper = ctx.createLinearGradient(0, topY, 0, topY + scrollH);
  paper.addColorStop(0, '#e8d4ad');
  paper.addColorStop(0.5, '#f5e8cc');
  paper.addColorStop(1, '#d8be8f');
  ctx.fillStyle = paper;
  ctx.fillRect(leftX, topY, scrollW, scrollH);

  ctx.strokeStyle = 'rgba(120, 82, 38, 0.08)';
  ctx.lineWidth = 1;
  for (let fy = topY + 26; fy < topY + scrollH - 24; fy += 18) {
    ctx.beginPath();
    ctx.moveTo(leftX + 18, fy);
    ctx.lineTo(leftX + scrollW - 18, fy + Math.sin(fy) * 2);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(104, 34, 24, 0.85)';
  ctx.fillRect(leftX, topY, scrollW, 14);
  ctx.fillRect(leftX, topY + scrollH - 14, scrollW, 14);
  ctx.strokeStyle = 'rgba(217, 173, 94, 0.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(leftX + 10, topY + 18, Math.max(2, scrollW - 20), scrollH - 36);

  const pan = (t / PROLOGUE_DURATION) * 420;
  const artY = topY + scrollH * 0.74;

  // Distant Sumi-e Mountains + Pagoda silhouettes
  ctx.fillStyle = 'rgba(41, 37, 36, 0.14)';
  for (let m = -1; m < 7; m++) {
    const mx = leftX + m * 240 - pan * 0.4;
    ctx.beginPath();
    ctx.moveTo(mx, artY + 40);
    ctx.quadraticCurveTo(mx + 120, topY + 54 + (m % 2) * 36, mx + 250, artY + 40);
    ctx.closePath();
    ctx.fill();
  }

  // Painted vermilion sun / moon seal
  const sunSealX = leftX + scrollW * 0.74 - pan * 0.12;
  const sunSealY = topY + scrollH * 0.29;
  const sealAura = ctx.createRadialGradient(sunSealX, sunSealY, 8, sunSealX, sunSealY, 54);
  sealAura.addColorStop(0, 'rgba(185, 28, 28, 0.42)');
  sealAura.addColorStop(1, 'rgba(185, 28, 28, 0)');
  ctx.fillStyle = sealAura;
  ctx.beginPath();
  ctx.arc(sunSealX, sunSealY, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(185, 28, 28, 0.84)';
  ctx.beginPath();
  ctx.arc(sunSealX, sunSealY, 32, 0, Math.PI * 2);
  ctx.fill();

  // Swaying Bamboo Stalks
  ctx.strokeStyle = 'rgba(28, 25, 23, 0.42)';
  for (let b = 0; b < 6; b++) {
    const bx = leftX + scrollW * (0.12 + b * 0.17) - pan * 0.25;
    const sway = Math.sin(t * 1.4 + b) * 6;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(bx, artY);
    ctx.quadraticCurveTo(bx + sway, topY + 110, bx + sway * 1.8, topY + 34);
    ctx.stroke();
  }

  ctx.strokeStyle = '#1c1917';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(leftX, artY);
  ctx.quadraticCurveTo(leftX + scrollW * 0.5, artY - 8, leftX + scrollW, artY + 4);
  ctx.stroke();

  const lanternX = leftX + scrollW * 0.22 - pan * 0.2;
  const lanternGlow = ctx.createRadialGradient(lanternX + 36, topY + 109, 4, lanternX + 36, topY + 109, 52);
  lanternGlow.addColorStop(0, 'rgba(251, 146, 60, 0.55)');
  lanternGlow.addColorStop(1, 'rgba(251, 146, 60, 0)');
  ctx.fillStyle = lanternGlow;
  ctx.beginPath();
  ctx.arc(lanternX + 36, topY + 109, 52, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(28, 25, 23, 0.72)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(lanternX, artY);
  ctx.lineTo(lanternX, topY + 85);
  ctx.lineTo(lanternX + 36, topY + 85);
  ctx.stroke();
  ctx.fillStyle = '#b91c1c';
  ctx.fillRect(lanternX + 24, topY + 92, 24, 34);
  ctx.fillStyle = '#fde68a';
  ctx.fillRect(lanternX + 30, topY + 98, 12, 22);

  // Beat 1 (0..5.2s): Kuro & Sunmy before separation
  if (t < 5.2) {
    const kX = leftX + scrollW * 0.34;
    const sX = leftX + scrollW * 0.46 + smoothstep(2.6, 5.0, t) * 160;
    const sAlpha = 1 - smoothstep(3.0, 5.0, t);

    ctx.fillStyle = '#171717';
    ctx.beginPath();
    ctx.ellipse(kX, artY - 18, 21, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(kX + 12, artY - 34, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(kX + 16, artY - 35, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(kX + 8, artY - 26);
    ctx.lineTo(kX - 20, artY - 18 + Math.sin(t * 5) * 4);
    ctx.stroke();

    ctx.save();
    ctx.globalAlpha = sAlpha;
    ctx.fillStyle = '#faf5eb';
    ctx.strokeStyle = '#57534e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(sX, artY - 17, 19, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sX + 10, artY - 32, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Beat 2 (4.6..13.8s): Silhouettes pursue Kuro through inked realms
  if (t >= 4.6 && t < 14.0) {
    const chaseP = clamp((t - 4.6) / 9.0, 0, 1);
    const runnerX = leftX + lerp(scrollW * 0.16, scrollW * 0.84, chaseP);
    const leapY = Math.abs(Math.sin(t * 5.6)) * 30;

    const drX = runnerX - 65;
    const drY = artY - 96 + Math.sin(t * 4) * 6;
    ctx.fillStyle = 'rgba(28, 25, 23, 0.82)';
    ctx.beginPath();
    ctx.ellipse(drX, drY, 16, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(drX + 8, drY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(28, 25, 23, 0.85)';
    for (let d = 0; d < 2; d++) {
      const dx = runnerX - 120 - d * 68;
      ctx.beginPath();
      ctx.ellipse(dx, artY - 18 - (d % 2) * 8, 24, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(dx + 14, artY - 28, 12, 8);
    }

    ctx.fillStyle = '#09090b';
    ctx.beginPath();
    ctx.ellipse(runnerX, artY - 20 - leapY, 22, 12, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(runnerX + 18, artY - 32 - leapY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(runnerX + 22, artY - 33 - leapY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Red Hanko Seal
  const stampX = leftX + scrollW - 76;
  const stampY = topY + 28;
  ctx.fillStyle = 'rgba(153, 27, 27, 0.86)';
  ctx.fillRect(stampX, stampY, 44, 58);
  ctx.strokeStyle = '#f5e7c8';
  ctx.lineWidth = 2;
  ctx.strokeRect(stampX + 4, stampY + 4, 36, 50);
  ctx.fillStyle = '#f5e7c8';
  ctx.font = '700 18px serif';
  ctx.textAlign = 'center';
  ctx.fillText('黑', stampX + 22, stampY + 26);
  ctx.fillText('道', stampX + 22, stampY + 48);

  if (t >= 13.6) {
    const morph = smoothstep(13.6, 15.9, t);
    ctx.fillStyle = `rgba(11, 14, 22, ${morph})`;
    ctx.fillRect(leftX, topY, scrollW, scrollH);
  }

  ctx.restore();

  const drawRoller = (rx: number) => {
    ctx.fillStyle = '#451a03';
    ctx.fillRect(rx - 9, topY - 14, 18, scrollH + 28);
    ctx.fillStyle = '#15803d';
    ctx.fillRect(rx - 11, topY - 22, 22, 12);
    ctx.fillRect(rx - 11, topY + scrollH + 10, 22, 12);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(rx - 10, topY - 10, 20, 4);
    ctx.fillRect(rx - 10, topY + scrollH + 6, 20, 4);
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(rx, topY + scrollH + 22);
    ctx.lineTo(rx + Math.sin(t * 2.2) * 4, topY + scrollH + 46);
    ctx.stroke();
  };
  drawRoller(leftX);
  drawRoller(leftX + scrollW);

  const lines = [
    { start: 0.4, end: 4.5, text: 'Sunmy...' },
    { start: 4.8, end: 9.0, text: 'Espera...' },
    { start: 9.4, end: 13.8, text: 'No puedo rendirme.' },
  ];
  const activeLine = lines.find((l) => t >= l.start && t <= l.end);
  if (activeLine) {
    const boxY = Math.min(h - 68, topY + scrollH + 30);
    ctx.fillStyle = '#faf7f0';
    ctx.font = `italic 600 ${w < 540 ? 18 : 24}px "Cormorant Garamond", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(activeLine.text, w / 2, boxY);
  }

  ctx.restore();
}

export function renderTitleBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number
): void {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) return;
  ctx.save();
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#070a12');
  sky.addColorStop(0.55, '#111b2e');
  sky.addColorStop(1, '#090b10');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Luminous pale moon
  const moonX = w * 0.72;
  const moonY = h * 0.28;
  const halo = ctx.createRadialGradient(moonX, moonY, 16, moonX, moonY, 210);
  halo.addColorStop(0, 'rgba(254, 249, 195, 0.36)');
  halo.addColorStop(0.5, 'rgba(147, 197, 253, 0.12)');
  halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(moonX, moonY, 210, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fefce8';
  ctx.beginPath();
  ctx.arc(moonX, moonY, 44, 0, Math.PI * 2);
  ctx.fill();

  // Drifting golden embers/fireflies
  ctx.fillStyle = 'rgba(253, 224, 71, 0.45)';
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const px = ((i * 119 + t * (16 + (i % 3) * 5)) % (w + 40)) - 20;
    const py = h - ((i * 83 + t * (14 + (i % 4) * 4)) % h);
    ctx.moveTo(px + 2.2, py);
    ctx.arc(px, py, 2.2, 0, Math.PI * 2);
  }
  ctx.fill();

  // Foreground hill & Kuro silhouette gazing toward the moon
  const groundTop = h * 0.78;
  ctx.fillStyle = '#07090e';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, groundTop + 18);
  ctx.quadraticCurveTo(w * 0.28, groundTop - 22, w * 0.62, groundTop + 10);
  ctx.lineTo(w, groundTop + 26);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  const kx = w * 0.28;
  const ky = groundTop - 6;
  ctx.fillStyle = '#050608';
  ctx.beginPath();
  ctx.ellipse(kx, ky - 14, 18, 12, -0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(kx + 11, ky - 29, 10, 0, Math.PI * 2);
  ctx.fill();
  // Ears
  ctx.beginPath();
  ctx.moveTo(kx + 4, ky - 36);
  ctx.lineTo(kx + 7, ky - 46);
  ctx.lineTo(kx + 11, ky - 37);
  ctx.moveTo(kx + 12, ky - 37);
  ctx.lineTo(kx + 16, ky - 46);
  ctx.lineTo(kx + 19, ky - 35);
  ctx.fill();
  // Amber eye & flowing crimson collar ribbon
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(kx + 15, ky - 30, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(kx + 5, ky - 22);
  ctx.quadraticCurveTo(kx - 14, ky - 22 + Math.sin(t * 2.8) * 5, kx - 28, ky - 16 + Math.cos(t * 2.4) * 5);
  ctx.stroke();

  ctx.restore();
}

export function renderTransitionFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  numeral: string,
  whisper: string,
  progress: number
): void {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) return;
  ctx.save();
  ctx.fillStyle = '#07090e';
  ctx.fillRect(0, 0, w, h);

  const fade = progress < 0.25 ? smoothstep(0, 0.25, progress) : 1 - smoothstep(0.75, 1.0, progress);
  ctx.globalAlpha = fade;

  ctx.fillStyle = '#f5b65c';
  ctx.font = '600 42px "Cormorant Garamond", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(numeral, w * 0.5, h * 0.45);

  if (whisper) {
    ctx.fillStyle = '#e7e5e4';
    ctx.font = 'italic 500 20px "Cormorant Garamond", serif';
    ctx.fillText(whisper, w * 0.5, h * 0.55);
  }
  ctx.restore();
}

export const EPILOGUE_REJECTION_DURATION = 12.5;

export function renderEpilogueRejectionFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  hide2DCats = false,
  quality: QualityTier = 'high'
): void {
  ctx.save();
  const dissolveTo2D = smoothstep(10.3, 12.4, t);

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#090e20');
  bg.addColorStop(0.65, '#192446');
  bg.addColorStop(1, '#090c14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  drawProceduralBackdropPlate(ctx, 'pixar_sanctuary', w, h, 0, t, quality);

  const cx = w * 0.5;
  const ground = h * 0.72;

  if (!hide2DCats) {
    const kuroX = lerp(w * 0.25, cx - 72, smoothstep(0, 3.0, t));
    ctx.fillStyle = '#050507';
    ctx.beginPath();
    ctx.ellipse(kuroX, ground - 20, 24, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(kuroX + 18, ground - 34, 11, 0, Math.PI * 2);
    ctx.fill();

    const sunmyX = cx + 78 + smoothstep(5.4, 9.8, t) * 95;
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.ellipse(sunmyX, ground - 20, 23, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sunmyX + 16, ground - 34, 10.5, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPixarAtmosphereOverlay(ctx, w, h, t, quality);

  let line = '';
  if (t < 4.2) {
    line = 'Sunmy...';
  } else if (t < 8.4) {
    line = 'No me sigas.';
  } else {
    line = '¿Por qué...?';
  }

  ctx.fillStyle = '#f8fafc';
  ctx.font = `italic 600 ${w < 540 ? 19 : 25}px "Cormorant Garamond", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(line, w / 2, h - 72);

  if (dissolveTo2D > 0.01) {
    ctx.fillStyle = `rgba(250, 246, 238, ${dissolveTo2D})`;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function wCheck(w: number, h: number): boolean {
  return w < 2 || h < 2;
}
