import { StrokePoint } from '../types/studio';
import { interpolateCatmullRom } from './sumiRenderer';

interface Vec2 {
  x: number;
  y: number;
}

interface ThreeJointLimb {
  root: Vec2;
  mid1: Vec2;
  mid2: Vec2;
  paw: Vec2;
  widths: [number, number, number, number];
  isFar?: boolean;
}

type ObstacleKind = 'zen_boulder' | 'moss_log' | 'organic_lantern' | 'vine_fence';

interface ObstacleSpec {
  worldX: number;
  kind: ObstacleKind;
  clearHeight: number;
  span: number;
}

const OBSTACLES: ObstacleSpec[] = [
  { worldX: 640, kind: 'zen_boulder', clearHeight: 142, span: 165 },
  { worldX: 1180, kind: 'moss_log', clearHeight: 158, span: 175 },
  { worldX: 1720, kind: 'organic_lantern', clearHeight: 176, span: 185 },
  { worldX: 2260, kind: 'vine_fence', clearHeight: 180, span: 180 },
];

const RIVER_START_X = 2660;
const RIVER_ENTRY_X = 2860;
const RIVER_EXIT_X = 3250;
const RIVER_END_X = 3315;

const JOURNEY_START_X = 110;
const TRAVEL_END_X = 3676;
const MEETING_CAT_X = 3768;
const TRAVEL_DURATION = 20.5;
const TOTAL_DURATION = 44.0;
export const ANIMATION_TOTAL_DURATION = TOTAL_DURATION;

// Non-linear journey keyframes: energetic start -> agile bounds -> heavy river struggle -> exhausted slow trudge
const JOURNEY_KNOTS: { t: number; x: number }[] = [
  { t: 0.0, x: JOURNEY_START_X },   // Energetic start
  { t: 2.5, x: 780 },   // Clears mossy boulder briskly
  { t: 5.6, x: 1380 },  // Nimble gallop over mossy log
  { t: 8.9, x: 1960 },  // Clears stone lantern
  { t: 11.1, x: 2140 }, // Slight pause/gather before tall fence
  { t: 13.0, x: 2560 }, // Vaults vine fence & approaches river bank
  { t: 14.1, x: 2860 }, // Plunges into river!
  { t: 17.1, x: 3250 }, // Slow heavy struggle swimming against current
  { t: 18.0, x: 3340 }, // Climbs exhausted onto far bank
  { t: 20.5, x: TRAVEL_END_X }, // Slow weary exhausted trudge to Sunmy
];

const FLOATING_LEAVES = Array.from({ length: 8 }, (_, i) => ({
  baseX: ((i * 197) % 1000) / 1000,
  baseY: ((i * 313) % 1000) / 1000,
  speedX: 0.042 + (i % 4) * 0.014,
  speedY: 0.015 + (i % 3) * 0.008,
  size: 9 + (i % 3) * 3,
  swayFreq: 1.2 + (i % 3) * 0.45,
  phase: i * 1.15,
  isPetal: false,
}));

const RAIN_DROPS = Array.from({ length: 48 }, (_, i) => ({
  xFrac: ((i * 271 + 43) % 1000) / 1000,
  yOffset: ((i * 419) % 1000) / 1000,
  speed: 1.45 + (i % 5) * 0.25,
  len: 26 + (i % 4) * 12,
}));

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Smooth Catmull-Rom interpolation across non-uniform journey time knots */
function sampleJourneyX(t: number): number {
  if (t <= 0) return JOURNEY_KNOTS[0].x;
  if (t >= TRAVEL_DURATION) return TRAVEL_END_X;

  for (let i = 0; i < JOURNEY_KNOTS.length - 1; i++) {
    const k0 = JOURNEY_KNOTS[i];
    const k1 = JOURNEY_KNOTS[i + 1];
    if (t >= k0.t && t <= k1.t) {
      const localT = (t - k0.t) / (k1.t - k0.t || 1);
      // Smooth cosine/hermite easing on final approach so he slows gradually
      if (i === JOURNEY_KNOTS.length - 2) {
        const decel = Math.sin(localT * Math.PI * 0.5);
        return lerp(k0.x, k1.x, decel);
      }
      const pPrev = JOURNEY_KNOTS[Math.max(0, i - 1)].x;
      const pNext = JOURNEY_KNOTS[Math.min(JOURNEY_KNOTS.length - 1, i + 2)].x;
      const t2 = localT * localT;
      const t3 = t2 * localT;
      return (
        0.5 *
        (2 * k0.x +
          (-pPrev + k1.x) * localT +
          (2 * pPrev - 5 * k0.x + 4 * k1.x - pNext) * t2 +
          (-pPrev + 3 * k0.x - 3 * k1.x + pNext) * t3)
      );
    }
  }
  return TRAVEL_END_X;
}

function sampleCyclic(u: number, keys: { u: number; v: number }[]): number {
  const w = ((u % 1) + 1) % 1;
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i];
    const k1 = keys[i + 1];
    if (w >= k0.u && w <= k1.u) {
      const span = k1.u - k0.u || 1;
      const t = (w - k0.u) / span;
      const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
      return lerp(k0.v, k1.v, ease);
    }
  }
  return keys[0].v;
}

function lineBoil(boilTick: number, index: number, amplitude: number): number {
  return Math.sin(boilTick * 2.17 + index * 3.71) * amplitude;
}

let cachedKaguyaWashi: HTMLCanvasElement | null = null;

function getKaguyaWashiTile(): HTMLCanvasElement {
  if (cachedKaguyaWashi) return cachedKaguyaWashi;
  const tile = document.createElement('canvas');
  tile.width = 400;
  tile.height = 400;
  const tctx = tile.getContext('2d');
  if (!tctx) return tile;

  let seed = 9187;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 3400; i++) {
    const x = rand() * 400;
    const y = rand() * 400;
    const alpha = 0.012 + rand() * 0.024;
    tctx.fillStyle =
      rand() > 0.48 ? `rgba(116, 98, 76, ${alpha})` : `rgba(255, 253, 248, ${alpha * 1.4})`;
    tctx.fillRect(x, y, 1.3, 1.3);
  }

  tctx.lineWidth = 0.7;
  for (let i = 0; i < 180; i++) {
    const x = rand() * 400;
    const y = rand() * 400;
    const len = 10 + rand() * 24;
    const ang = rand() * Math.PI * 2;
    tctx.strokeStyle = rand() > 0.38 ? 'rgba(130, 114, 92, 0.05)' : 'rgba(255, 252, 246, 0.08)';
    tctx.beginPath();
    tctx.moveTo(x, y);
    tctx.quadraticCurveTo(
      x + Math.cos(ang + 0.32) * len * 0.5,
      y + Math.sin(ang + 0.32) * len * 0.5,
      x + Math.cos(ang) * len,
      y + Math.sin(ang) * len
    );
    tctx.stroke();
  }

  cachedKaguyaWashi = tile;
  return tile;
}

function drawKaguyaBrushStroke(
  ctx: CanvasRenderingContext2D,
  rawPoints: StrokePoint[],
  baseWidth: number,
  opacity: number,
  dryBrush: number,
  color = '20, 18, 17',
  boilTick = 0,
  boilAmount = 0.48
) {
  const boiled = rawPoints.map((pt, idx) => ({
    x: pt.x + lineBoil(boilTick, idx * 2, boilAmount),
    y: pt.y + lineBoil(boilTick, idx * 2 + 1, boilAmount),
    p: pt.p,
  }));

  const pts = interpolateCatmullRom(boiled, 10);
  if (pts.length < 2) return;
  const total = pts.length;

  const left: Vec2[] = [];
  const right: Vec2[] = [];

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
    if (u < 0.14) taper = 0.25 + 0.75 * (u / 0.14);
    else if (u > 0.8) taper = 0.14 + 0.86 * ((1 - u) / 0.2);

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
  ctx.fillStyle = `rgba(${color}, ${opacity * 0.11})`;
  ctx.filter = 'blur(2px)';
  ctx.fill();
  ctx.filter = 'none';

  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = `rgba(${color}, ${opacity})`;
  ctx.fill();

  if (dryBrush > 0.06 && baseWidth >= 4.5) {
    const bristles = 3;
    ctx.lineCap = 'round';
    for (let b = 0; b < bristles; b++) {
      const offsetRatio = ((b + 0.5) / bristles - 0.5) * 1.05;
      ctx.beginPath();
      let penDown = false;
      for (let i = 0; i < total; i += 2) {
        const curr = pts[i];
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(total - 1, i + 1)];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const halfW = (baseWidth * curr.p) / 2;

        if (Math.sin(i * 0.45 + b * 2.1 + boilTick * 0.35) > -0.18) {
          const px = curr.x + nx * halfW * offsetRatio;
          const py = curr.y + ny * halfW * offsetRatio;
          if (!penDown) {
            ctx.moveTo(px, py);
            penDown = true;
          } else {
            ctx.lineTo(px, py);
          }
        } else {
          penDown = false;
        }
      }
      ctx.strokeStyle = `rgba(250, 246, 238, ${dryBrush * 0.26})`;
      ctx.lineWidth = Math.max(0.55, baseWidth * 0.08);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawSmoothWatercolorPolygon(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  fillStyle: string
) {
  if (pts.length < 3) return;
  ctx.save();
  ctx.beginPath();
  const midX0 = (pts[pts.length - 1].x + pts[0].x) / 2;
  const midY0 = (pts[pts.length - 1].y + pts[0].y) / 2;
  ctx.moveTo(midX0, midY0);
  for (let i = 0; i < pts.length; i++) {
    const next = pts[(i + 1) % pts.length];
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + next.x) / 2, (pts[i].y + next.y) / 2);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.restore();
}

function drawKaguyaSpeechBubble(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  tailTargetX: number,
  tailTargetY: number,
  text: string,
  alpha: number,
  scale: number,
  boilTick: number,
  isMelancholy = false
) {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  const fontSize = Math.round(19 * Math.max(0.85, Math.min(1.22, scale)));
  ctx.font = `italic 600 ${fontSize}px "Cormorant Garamond", Georgia, serif`;
  const metrics = ctx.measureText(text);
  const padX = 22 * Math.max(0.85, scale);
  const padY = 13 * Math.max(0.85, scale);
  const boxW = Math.max(126, metrics.width + padX * 2);
  const boxH = fontSize + padY * 2;
  const rx = boxW / 2;
  const ry = boxH / 2;

  const liftY = (1 - alpha) * 10;
  const cx = anchorX;
  const cy = anchorY + liftY;

  ctx.save();
  ctx.fillStyle = isMelancholy ? 'rgba(32, 44, 62, 0.18)' : 'rgba(28, 24, 20, 0.11)';
  ctx.filter = 'blur(6px)';
  ctx.beginPath();
  ctx.ellipse(cx + 2, cy + 4, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const tailBaseDx = Math.max(-rx * 0.45, Math.min(rx * 0.45, tailTargetX - cx));
  const tailTipX = lerp(cx + tailBaseDx, tailTargetX, 0.52);
  const tailTipY = lerp(cy + ry, tailTargetY, 0.58);

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = isMelancholy ? 'rgba(238, 243, 250, 0.95)' : 'rgba(253, 249, 241, 0.96)';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx + tailBaseDx - 10, cy + ry - 4);
  ctx.quadraticCurveTo(cx + tailBaseDx - 4, tailTipY - 4, tailTipX, tailTipY);
  ctx.quadraticCurveTo(cx + tailBaseDx + 8, tailTipY - 6, cx + tailBaseDx + 10, cy + ry - 4);
  ctx.closePath();
  ctx.fillStyle = isMelancholy ? 'rgba(238, 243, 250, 0.95)' : 'rgba(253, 249, 241, 0.96)';
  ctx.fill();

  const rimPts: StrokePoint[] = [];
  const segs = 20;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    rimPts.push({
      x: cx + Math.cos(a) * rx,
      y: cy + Math.sin(a) * ry,
      p: 0.7 + 0.35 * Math.sin(a * 2),
    });
  }
  drawKaguyaBrushStroke(
    ctx,
    rimPts,
    2.8,
    0.85,
    0.25,
    isMelancholy ? '42, 54, 72' : '28, 25, 23',
    boilTick,
    0.4
  );

  ctx.strokeStyle = isMelancholy ? 'rgba(42, 54, 72, 0.75)' : 'rgba(28, 25, 23, 0.72)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + tailBaseDx - 8, cy + ry - 1);
  ctx.lineTo(tailTipX, tailTipY);
  ctx.lineTo(cx + tailBaseDx + 9, cy + ry - 1);
  ctx.stroke();

  ctx.fillStyle = isMelancholy ? '#1E293B' : '#1C1917';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 1);

  ctx.restore();
}


function drawThreeJointLimb(
  ctx: CanvasRenderingContext2D,
  limb: ThreeJointLimb,
  scale: number,
  boilTick: number
) {
  const opacity = limb.isFar ? 0.52 : 0.94;
  const color = limb.isFar ? '52, 49, 45' : '18, 17, 16';

  const pts: StrokePoint[] = [
    { x: limb.root.x, y: limb.root.y, p: limb.widths[0] },
    {
      x: lerp(limb.root.x, limb.mid1.x, 0.52),
      y: lerp(limb.root.y, limb.mid1.y, 0.52),
      p: lerp(limb.widths[0], limb.widths[1], 0.5),
    },
    { x: limb.mid1.x, y: limb.mid1.y, p: limb.widths[1] },
    { x: limb.mid2.x, y: limb.mid2.y, p: limb.widths[2] },
    { x: limb.paw.x, y: limb.paw.y, p: limb.widths[3] },
  ];

  drawKaguyaBrushStroke(
    ctx,
    pts,
    11.5 * scale,
    opacity,
    limb.isFar ? 0.12 : 0.48,
    color,
    boilTick,
    limb.isFar ? 0.3 : 0.45
  );

  ctx.save();
  ctx.fillStyle = `rgba(${color}, ${opacity})`;
  ctx.beginPath();
  ctx.ellipse(
    limb.paw.x + 2.2 * scale,
    limb.paw.y + 1.2 * scale,
    5.4 * scale,
    3.1 * scale,
    0.1,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.restore();
}

function drawBambooStalk(
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  heightPx: number,
  thickness: number,
  leanX: number,
  swayPhase: number,
  opacity: number,
  rgb: string,
  blurPx = 0
) {
  ctx.save();
  if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;

  const segments = 5;
  const segH = heightPx / segments;
  const wind = Math.sin(swayPhase) * (heightPx * 0.022);

  let prevX = baseX;
  let prevY = baseY;

  for (let s = 1; s <= segments; s++) {
    const frac = s / segments;
    const nextX = baseX + leanX * frac + wind * frac * frac;
    const nextY = baseY - s * segH;
    const segW = thickness * (1 - frac * 0.38);

    ctx.strokeStyle = `rgba(${rgb}, ${opacity * (1 - frac * 0.15)})`;
    ctx.lineWidth = segW;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(prevX, prevY);
    ctx.quadraticCurveTo(
      lerp(prevX, nextX, 0.5) + leanX * 0.03,
      lerp(prevY, nextY, 0.5),
      nextX,
      nextY + 2
    );
    ctx.stroke();

    ctx.strokeStyle = `rgba(250, 246, 238, ${opacity * 0.24})`;
    ctx.lineWidth = Math.max(0.8, segW * 0.22);
    ctx.beginPath();
    ctx.moveTo(prevX - segW * 0.2, prevY);
    ctx.lineTo(nextX - segW * 0.2, nextY + 2);
    ctx.stroke();

    if (s < segments) {
      ctx.strokeStyle = `rgba(${rgb}, ${Math.min(0.95, opacity * 1.25)})`;
      ctx.lineWidth = Math.max(1.4, segW * 0.28);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(nextX - segW * 0.65, nextY + 1);
      ctx.lineTo(nextX + segW * 0.65, nextY - 0.5);
      ctx.stroke();
    }

    if (s >= 2 && s <= segments) {
      const dir = s % 2 === 0 ? 1 : -1;
      const leafSway = Math.sin(swayPhase * 1.35 + s * 0.9) * 5;
      const numLeaves = s === 2 ? 2 : 3;
      for (let l = 0; l < numLeaves; l++) {
        const ang = (dir === 1 ? -0.35 : Math.PI + 0.35) + (l - 1) * 0.34 * dir;
        const len = (34 + (s % 2) * 14 - l * 5) * Math.max(0.65, thickness / 7.5);
        const midX = nextX + Math.cos(ang) * (len * 0.52);
        const midY = nextY + Math.sin(ang) * (len * 0.45) + 4 + leafSway * 0.4;
        const tipX = nextX + Math.cos(ang + 0.14 * dir) * len;
        const tipY = nextY + Math.sin(ang + 0.14 * dir) * len + 10 + leafSway;

        ctx.fillStyle = `rgba(${rgb}, ${opacity * (0.92 - l * 0.14)})`;
        ctx.beginPath();
        ctx.moveTo(nextX, nextY);
        ctx.quadraticCurveTo(midX, midY - 4.5, tipX, tipY);
        ctx.quadraticCurveTo(midX, midY + 4.5, nextX, nextY);
        ctx.closePath();
        ctx.fill();
      }
    }

    prevX = nextX;
    prevY = nextY - 1.5;
  }

  ctx.restore();
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  obs: ObstacleSpec,
  screenX: number,
  groundY: number,
  scale: number,
  elapsed: number,
  boilTick: number
) {
  ctx.save();

  if (obs.kind === 'zen_boulder') {
    drawSmoothWatercolorPolygon(
      ctx,
      [
        { x: screenX - 58 * scale, y: groundY + 6 * scale },
        { x: screenX - 52 * scale, y: groundY - 34 * scale },
        { x: screenX - 24 * scale, y: groundY - 64 * scale },
        { x: screenX + 12 * scale, y: groundY - 68 * scale },
        { x: screenX + 48 * scale, y: groundY - 38 * scale },
        { x: screenX + 56 * scale, y: groundY + 6 * scale },
      ],
      'rgba(86, 84, 78, 0.72)'
    );

    drawSmoothWatercolorPolygon(
      ctx,
      [
        { x: screenX - 6 * scale, y: groundY + 4 * scale },
        { x: screenX + 10 * scale, y: groundY - 56 * scale },
        { x: screenX + 44 * scale, y: groundY - 34 * scale },
        { x: screenX + 52 * scale, y: groundY + 6 * scale },
      ],
      'rgba(52, 50, 46, 0.42)'
    );

    ctx.fillStyle = 'rgba(116, 148, 122, 0.48)';
    ctx.beginPath();
    ctx.ellipse(
      screenX - 10 * scale,
      groundY - 52 * scale,
      26 * scale,
      10 * scale,
      -0.15,
      0,
      Math.PI * 2
    );
    ctx.fill();

    drawKaguyaBrushStroke(
      ctx,
      [
        { x: screenX - 56 * scale, y: groundY + 4 * scale, p: 0.7 },
        { x: screenX - 48 * scale, y: groundY - 38 * scale, p: 1.05 },
        { x: screenX - 18 * scale, y: groundY - 66 * scale, p: 1.15 },
        { x: screenX + 20 * scale, y: groundY - 62 * scale, p: 0.95 },
        { x: screenX + 52 * scale, y: groundY - 24 * scale, p: 0.85 },
      ],
      5.5 * scale,
      0.86,
      0.82,
      '28, 27, 25',
      boilTick,
      0.4
    );

    [-58, -46, 52].forEach((gx, idx) => {
      const sway = Math.sin(elapsed * 2.1 + idx) * 5 * scale;
      drawKaguyaBrushStroke(
        ctx,
        [
          { x: screenX + gx * scale, y: groundY + 4 * scale, p: 0.8 },
          { x: screenX + (gx - 6) * scale + sway * 0.5, y: groundY - 20 * scale, p: 0.5 },
          {
            x: screenX + (gx - 12) * scale + sway,
            y: groundY - (36 + idx * 6) * scale,
            p: 0.15,
          },
        ],
        2.6 * scale,
        0.68,
        0.2,
        '44, 56, 46',
        boilTick,
        0.3
      );
    });
  } else if (obs.kind === 'moss_log') {
    drawSmoothWatercolorPolygon(
      ctx,
      [
        { x: screenX - 66 * scale, y: groundY + 6 * scale },
        { x: screenX - 54 * scale, y: groundY - 24 * scale },
        { x: screenX + 4 * scale, y: groundY - 48 * scale },
        { x: screenX + 60 * scale, y: groundY - 22 * scale },
        { x: screenX + 68 * scale, y: groundY + 6 * scale },
      ],
      'rgba(104, 118, 102, 0.36)'
    );

    drawKaguyaBrushStroke(
      ctx,
      [
        { x: screenX - 68 * scale, y: groundY - 8 * scale, p: 1.05 },
        { x: screenX - 18 * scale, y: groundY - 48 * scale, p: 1.15 },
        { x: screenX + 36 * scale, y: groundY - 62 * scale, p: 0.98 },
        { x: screenX + 66 * scale, y: groundY - 48 * scale, p: 0.85 },
      ],
      24 * scale,
      0.86,
      0.72,
      '74, 66, 54',
      boilTick,
      0.38
    );

    drawKaguyaBrushStroke(
      ctx,
      [
        { x: screenX - 56 * scale, y: groundY - 18 * scale, p: 0.7 },
        { x: screenX - 14 * scale, y: groundY - 56 * scale, p: 0.95 },
        { x: screenX + 38 * scale, y: groundY - 68 * scale, p: 0.7 },
      ],
      7 * scale,
      0.48,
      0.4,
      '112, 146, 114',
      boilTick,
      0.3
    );

    drawKaguyaBrushStroke(
      ctx,
      [
        { x: screenX + 30 * scale, y: groundY - 58 * scale, p: 0.8 },
        { x: screenX + 42 * scale, y: groundY - 84 * scale, p: 0.4 },
      ],
      3.4 * scale,
      0.75,
      0.2,
      '56, 78, 58',
      boilTick,
      0.3
    );
  } else if (obs.kind === 'organic_lantern') {
    const lx = screenX;

    drawSmoothWatercolorPolygon(
      ctx,
      [
        { x: lx - 42 * scale, y: groundY + 6 * scale },
        { x: lx - 32 * scale, y: groundY - 16 * scale },
        { x: lx + 32 * scale, y: groundY - 16 * scale },
        { x: lx + 44 * scale, y: groundY + 6 * scale },
      ],
      'rgba(78, 82, 76, 0.76)'
    );

    drawKaguyaBrushStroke(
      ctx,
      [
        { x: lx, y: groundY - 12 * scale, p: 1.2 },
        { x: lx - 2 * scale, y: groundY - 38 * scale, p: 0.92 },
        { x: lx, y: groundY - 58 * scale, p: 1.05 },
      ],
      18 * scale,
      0.86,
      0.65,
      '66, 64, 60',
      boilTick,
      0.35
    );

    const glow = ctx.createRadialGradient(
      lx,
      groundY - 72 * scale,
      2,
      lx,
      groundY - 72 * scale,
      56 * scale
    );
    glow.addColorStop(0, 'rgba(246, 198, 104, 0.45)');
    glow.addColorStop(0.5, 'rgba(246, 198, 104, 0.16)');
    glow.addColorStop(1, 'rgba(246, 198, 104, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lx, groundY - 72 * scale, 56 * scale, 0, Math.PI * 2);
    ctx.fill();

    drawSmoothWatercolorPolygon(
      ctx,
      [
        { x: lx - 12 * scale, y: groundY - 60 * scale },
        { x: lx - 13 * scale, y: groundY - 82 * scale },
        { x: lx + 13 * scale, y: groundY - 82 * scale },
        { x: lx + 12 * scale, y: groundY - 60 * scale },
      ],
      'rgba(244, 196, 102, 0.85)'
    );

    drawKaguyaBrushStroke(
      ctx,
      [
        { x: lx - 14 * scale, y: groundY - 60 * scale, p: 0.8 },
        { x: lx - 14 * scale, y: groundY - 82 * scale, p: 0.8 },
        { x: lx + 14 * scale, y: groundY - 82 * scale, p: 0.8 },
        { x: lx + 14 * scale, y: groundY - 60 * scale, p: 0.8 },
      ],
      3.0 * scale,
      0.85,
      0.3,
      '32, 30, 28',
      boilTick,
      0.3
    );

    drawSmoothWatercolorPolygon(
      ctx,
      [
        { x: lx - 38 * scale, y: groundY - 78 * scale },
        { x: lx - 18 * scale, y: groundY - 94 * scale },
        { x: lx, y: groundY - 104 * scale },
        { x: lx + 18 * scale, y: groundY - 94 * scale },
        { x: lx + 38 * scale, y: groundY - 78 * scale },
      ],
      'rgba(48, 46, 44, 0.92)'
    );
    drawKaguyaBrushStroke(
      ctx,
      [
        { x: lx - 40 * scale, y: groundY - 80 * scale, p: 0.6 },
        { x: lx - 14 * scale, y: groundY - 95 * scale, p: 1.05 },
        { x: lx, y: groundY - 103 * scale, p: 1.1 },
        { x: lx + 14 * scale, y: groundY - 95 * scale, p: 1.05 },
        { x: lx + 40 * scale, y: groundY - 80 * scale, p: 0.6 },
      ],
      5.5 * scale,
      0.92,
      0.5,
      '22, 20, 18',
      boilTick,
      0.35
    );
  } else if (obs.kind === 'vine_fence') {
    const posts = [
      { ox: -38, lean: -5, h: 86 },
      { ox: 0, lean: 2, h: 92 },
      { ox: 38, lean: 6, h: 84 },
    ];
    [-34, -68].forEach((ry) => {
      drawKaguyaBrushStroke(
        ctx,
        [
          { x: screenX - 58 * scale, y: groundY + ry * scale, p: 0.78 },
          { x: screenX, y: groundY + (ry - 2) * scale, p: 0.92 },
          { x: screenX + 58 * scale, y: groundY + ry * scale, p: 0.78 },
        ],
        6.2 * scale,
        0.84,
        0.4,
        '58, 72, 56',
        boilTick,
        0.35
      );
    });

    posts.forEach((p) => {
      const px = screenX + p.ox * scale;
      drawKaguyaBrushStroke(
        ctx,
        [
          { x: px, y: groundY + 6 * scale, p: 0.98 },
          { x: px + p.lean * 0.5 * scale, y: groundY - p.h * 0.5 * scale, p: 0.88 },
          { x: px + p.lean * scale, y: groundY - p.h * scale, p: 0.75 },
        ],
        7.8 * scale,
        0.88,
        0.42,
        '44, 58, 46',
        boilTick,
        0.35
      );
      [-34, -68].forEach((ry) => {
        ctx.strokeStyle = 'rgba(20, 18, 16, 0.85)';
        ctx.lineWidth = 2.0 * scale;
        ctx.beginPath();
        ctx.moveTo(px - 6 * scale, groundY + (ry - 4) * scale);
        ctx.lineTo(px + 6 * scale, groundY + (ry + 4) * scale);
        ctx.moveTo(px + 6 * scale, groundY + (ry - 4) * scale);
        ctx.lineTo(px - 6 * scale, groundY + (ry + 4) * scale);
        ctx.stroke();
      });
    });

    [
      { x: -24, y: -74 },
      { x: 14, y: -64 },
      { x: -10, y: -38 },
      { x: 28, y: -42 },
    ].forEach((lf, idx) => {
      ctx.fillStyle = 'rgba(102, 134, 98, 0.65)';
      ctx.beginPath();
      ctx.ellipse(
        screenX + lf.x * scale,
        groundY + lf.y * scale,
        8.5 * scale,
        4.2 * scale,
        idx * 0.6 - 0.3,
        0,
        Math.PI * 2
      );
      ctx.fill();
    });
  }

  ctx.restore();
}

function drawImperialRiver(
  ctx: CanvasRenderingContext2D,
  leftScreenX: number,
  rightScreenX: number,
  groundY: number,
  height: number,
  scale: number,
  elapsed: number,
  boilTick: number
) {
  const riverW = rightScreenX - leftScreenX;
  if (rightScreenX < -80 || leftScreenX > ctx.canvas.width + 80) return;

  ctx.save();
  ctx.fillStyle = 'rgba(84, 82, 76, 0.72)';
  ctx.beginPath();
  ctx.ellipse(
    leftScreenX - 18 * scale,
    groundY + 6 * scale,
    42 * scale,
    18 * scale,
    -0.1,
    0,
    Math.PI * 2
  );
  ctx.ellipse(
    rightScreenX + 18 * scale,
    groundY + 6 * scale,
    42 * scale,
    18 * scale,
    0.1,
    0,
    Math.PI * 2
  );
  ctx.fill();

  const waterGrad = ctx.createLinearGradient(0, groundY - 2 * scale, 0, height);
  waterGrad.addColorStop(0, 'rgba(92, 136, 166, 0.56)');
  waterGrad.addColorStop(0.25, 'rgba(66, 108, 142, 0.66)');
  waterGrad.addColorStop(1, 'rgba(48, 82, 114, 0.44)');
  ctx.fillStyle = waterGrad;
  ctx.beginPath();
  ctx.moveTo(leftScreenX, groundY + 2 * scale);
  ctx.quadraticCurveTo(
    leftScreenX + riverW * 0.5,
    groundY - 5 * scale,
    rightScreenX,
    groundY + 2 * scale
  );
  ctx.lineTo(rightScreenX + 35 * scale, height + 20);
  ctx.lineTo(leftScreenX - 35 * scale, height + 20);
  ctx.closePath();
  ctx.fill();

  for (let row = 0; row < 4; row++) {
    const wy = groundY + (10 + row * 18) * scale;
    const waveShift = ((elapsed * (50 + row * 15)) % (120 * scale)) - 60 * scale;
    for (let wx = leftScreenX + 30 * scale; wx < rightScreenX - 30 * scale; wx += 115 * scale) {
      const px = wx + waveShift * 0.35;
      drawKaguyaBrushStroke(
        ctx,
        [
          { x: px - 36 * scale, y: wy, p: 0.45 },
          { x: px, y: wy - (5 + Math.sin(elapsed * 3 + row) * 2) * scale, p: 0.95 },
          { x: px + 36 * scale, y: wy + 1 * scale, p: 0.4 },
        ],
        3.2 * scale,
        0.55 - row * 0.09,
        0.35,
        '38, 68, 92',
        boilTick,
        0.4
      );
    }
  }
  ctx.restore();
}

function drawRiverSplashes(
  ctx: CanvasRenderingContext2D,
  splashX: number,
  groundY: number,
  scale: number,
  splashProgress: number,
  isSwimming: boolean,
  catScreenX: number,
  elapsed: number
) {
  ctx.save();

  if (splashProgress > 0 && splashProgress < 1) {
    const burst = Math.sin(splashProgress * Math.PI);
    for (let i = -5; i <= 5; i++) {
      const ang = -Math.PI / 2 + i * 0.22;
      const dist = (26 + Math.abs(i) * 9) * splashProgress * 2.4 * scale;
      const dx = splashX + Math.cos(ang) * dist;
      const dy =
        groundY - Math.sin(-ang) * dist * 0.85 + splashProgress * splashProgress * 46 * scale;
      ctx.fillStyle = `rgba(246, 250, 255, ${burst * 0.9})`;
      ctx.beginPath();
      ctx.arc(dx, dy, (4.8 - Math.abs(i) * 0.35) * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(62, 102, 132, ${burst * 0.6})`;
      ctx.lineWidth = 1.6 * scale;
      ctx.stroke();
    }
  }

  if (isSwimming) {
    for (let r = 0; r < 3; r++) {
      const rx = catScreenX - (18 + r * 28) * scale + Math.sin(elapsed * 8 + r) * 4 * scale;
      const ry = groundY + (8 + (r % 2) * 5) * scale;
      ctx.strokeStyle = `rgba(244, 248, 252, ${0.78 - r * 0.2})`;
      ctx.lineWidth = 2.4 * scale;
      ctx.beginPath();
      ctx.arc(rx, ry, (12 + r * 7) * scale, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawSpiritLotusEmber(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  bloomT: number,
  alpha: number,
  elapsed: number,
  boilTick: number
) {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  const pulse = 1 + Math.sin(elapsed * 4.5) * 0.12;
  const glowR = lerp(18, 52, bloomT) * scale * pulse;

  const halo = ctx.createRadialGradient(x, y, 1, x, y, glowR);
  halo.addColorStop(0, 'rgba(255, 244, 200, 0.96)');
  halo.addColorStop(0.28, 'rgba(248, 198, 108, 0.62)');
  halo.addColorStop(0.65, 'rgba(236, 146, 134, 0.24)');
  halo.addColorStop(1, 'rgba(236, 146, 134, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, glowR, 0, Math.PI * 2);
  ctx.fill();

  // Blooming magical lotus-flower petals when offered to Sunmy
  if (bloomT > 0.04) {
    const petalCount = 6;
    const petalLen = lerp(4, 17, bloomT) * scale;
    const petalW = lerp(2, 6.5, bloomT) * scale;
    for (let i = 0; i < petalCount; i++) {
      const ang = (i / petalCount) * Math.PI * 2 + elapsed * 0.55;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(252, 224, 168, 0.86)' : 'rgba(248, 194, 190, 0.78)';
      ctx.beginPath();
      ctx.ellipse(petalLen * 0.55, 0, petalLen * 0.55, petalW, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Luminous golden core
  ctx.fillStyle = '#FFFDF2';
  ctx.beginPath();
  ctx.arc(x, y, (3.6 + bloomT * 2.4) * scale * pulse, 0, Math.PI * 2);
  ctx.fill();

  // Tiny orbiting spark ring
  if (bloomT > 0.2) {
    drawKaguyaBrushStroke(
      ctx,
      [
        { x: x - 14 * bloomT * scale, y: y + Math.sin(elapsed * 3) * 4 * scale, p: 0.45 },
        { x: x, y: y - 10 * bloomT * scale, p: 0.7 },
        { x: x + 14 * bloomT * scale, y: y - Math.sin(elapsed * 3) * 4 * scale, p: 0.45 },
      ],
      2.2 * scale,
      0.55 * bloomT,
      0.2,
      '232, 178, 92',
      boilTick,
      0.25
    );
  }

  ctx.restore();
}

function drawMagicFirefliesAndPetals(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  scale: number,
  magicT: number,
  dissolveT: number,
  elapsed: number
) {
  if (magicT <= 0.02 && dissolveT <= 0.02) return;
  ctx.save();

  // Swirling warm golden fireflies & sakura petals during the romantic magical moment
  if (magicT > 0.02) {
    const count = 20;
    for (let i = 0; i < count; i++) {
      const seed = i * 1.37;
      const orbitR = (36 + (i % 5) * 26) * scale * (0.65 + magicT * 0.55);
      const ang = elapsed * (0.8 + (i % 3) * 0.28) + seed * 2.1;
      const rise = ((elapsed * 18 + i * 23) % 150) * scale;
      const px = centerX + Math.cos(ang) * orbitR;
      const py = centerY + 14 * scale - rise + Math.sin(ang * 2) * 14 * scale;
      const alpha = magicT * (1 - dissolveT * 0.65) * Math.sin((rise / (150 * scale)) * Math.PI);

      if (alpha <= 0.02) continue;
      ctx.globalAlpha = clamp01(alpha);

      if (i % 3 === 0) {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang + elapsed);
        ctx.fillStyle = 'rgba(244, 184, 182, 0.88)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 5.2 * scale, 2.8 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        const g = ctx.createRadialGradient(px, py, 0.5, px, py, 7.5 * scale);
        g.addColorStop(0, 'rgba(255, 248, 212, 0.98)');
        g.addColorStop(0.5, 'rgba(246, 198, 108, 0.55)');
        g.addColorStop(1, 'rgba(246, 198, 108, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, 7.5 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Rising silver moon-petals & wisps as Sunmy dissolves skyward
  if (dissolveT > 0.02 && dissolveT < 0.99) {
    const burst = Math.sin(dissolveT * Math.PI);
    const num = 26;
    for (let i = 0; i < num; i++) {
      const progress = clamp01((dissolveT * 1.35 - (i % 7) * 0.05));
      if (progress <= 0 || progress >= 1) continue;
      const driftX =
        Math.sin(elapsed * 2.4 + i * 1.7) * (24 + progress * 34) * scale +
        ((i % 5) - 2) * 12 * scale;
      const liftY = progress * (260 + (i % 4) * 45) * scale;
      const px = centerX + 38 * scale + driftX;
      const py = centerY - 20 * scale - liftY;
      const a = Math.sin(progress * Math.PI) * (0.45 + burst * 0.55);

      ctx.globalAlpha = clamp01(a);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(elapsed * 1.6 + i);

      const g = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 8 * scale);
      g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      g.addColorStop(0.6, 'rgba(206, 224, 248, 0.55)');
      g.addColorStop(1, 'rgba(206, 224, 248, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 8 * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(248, 246, 252, 0.92)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.5 * scale, 2.7 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();
}

function drawCelestialMoonAndBeams(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sunmyScreenX: number,
  groundY: number,
  scale: number,
  moonNightT: number,
  beamT: number,
  elapsed: number
) {
  if (moonNightT <= 0.02) return;
  ctx.save();

  const moonX = Math.min(w * 0.74, Math.max(w * 0.56, sunmyScreenX + 55 * scale));
  const moonY = h * (0.21 - moonNightT * 0.03);
  const moonR = Math.min(w, h) * 0.095;

  // Outer celestial silver halo
  const halo = ctx.createRadialGradient(moonX, moonY, moonR * 0.5, moonX, moonY, moonR * 3.4);
  halo.addColorStop(0, `rgba(244, 248, 255, ${(moonNightT * 0.45).toFixed(3)})`);
  halo.addColorStop(0.45, `rgba(188, 206, 232, ${(moonNightT * 0.22).toFixed(3)})`);
  halo.addColorStop(1, 'rgba(188, 206, 232, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR * 3.4, 0, Math.PI * 2);
  ctx.fill();

  // Moon disc with delicate sumi-e ink crater wash
  ctx.globalAlpha = clamp01(moonNightT * 0.96);
  const disc = ctx.createRadialGradient(
    moonX - moonR * 0.25,
    moonY - moonR * 0.25,
    moonR * 0.1,
    moonX,
    moonY,
    moonR
  );
  disc.addColorStop(0, '#FFFFFF');
  disc.addColorStop(0.75, '#EEF2F8');
  disc.addColorStop(1, '#CFD9E8');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
  ctx.fill();

  // Faint misty cloud ribbon drifting past the moon
  const drift = Math.sin(elapsed * 0.35) * 18 * scale;
  ctx.fillStyle = `rgba(38, 48, 72, ${(moonNightT * 0.16).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(moonX + drift, moonY + moonR * 0.35, moonR * 1.45, moonR * 0.22, -0.05, 0, Math.PI * 2);
  ctx.fill();

  // Descending Kaguya moonbeam claiming Sunmy
  if (beamT > 0.02) {
    const beamAlpha = beamT * 0.34;
    const beamGrad = ctx.createLinearGradient(moonX, moonY, sunmyScreenX, groundY + 10);
    beamGrad.addColorStop(0, `rgba(245, 250, 255, ${(beamAlpha * 0.9).toFixed(3)})`);
    beamGrad.addColorStop(0.65, `rgba(222, 235, 252, ${(beamAlpha * 0.72).toFixed(3)})`);
    beamGrad.addColorStop(1, 'rgba(222, 235, 252, 0)');

    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(moonX - moonR * 0.55, moonY);
    ctx.lineTo(moonX + moonR * 0.55, moonY);
    ctx.lineTo(sunmyScreenX + 86 * scale, groundY + 12 * scale);
    ctx.lineTo(sunmyScreenX - 86 * scale, groundY + 12 * scale);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawFemaleCatSunmy(
  ctx: CanvasRenderingContext2D,
  baseScreenX: number,
  groundY: number,
  scale: number,
  romanceT: number,
  sorrowT: number,
  dissolveT: number,
  elapsed: number,
  boilTick: number
): { headX: number; headY: number; screenX: number } {
  const opacity = clamp01(1 - smoothstep(0.2, 0.96, dissolveT));
  const stepCloser = romanceT * 24 * scale;
  const screenX = baseScreenX - stepCloser;
  if (opacity <= 0.01) {
    return { headX: screenX - 12 * scale, headY: groundY - 84 * scale, screenX };
  }

  ctx.save();
  ctx.globalAlpha = opacity;

  const floatLift = smoothstep(0.15, 0.95, dissolveT) * 34 * scale;
  const breath = Math.sin(elapsed * 2.1) * 1.4 * scale;
  const bob = breath - floatLift;

  ctx.save();
  ctx.fillStyle = `rgba(34, 30, 28, ${(0.16 * opacity).toFixed(3)})`;
  ctx.filter = 'blur(4px)';
  ctx.beginPath();
  ctx.ellipse(screenX + 4 * scale, groundY + 4 * scale, 46 * scale, 9 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Warm swaying tail curling gently closer during romance, drooping in sorrow
  const tailWave = Math.sin(elapsed * 2.4) * (5 + romanceT * 4) * scale;
  const tailDroop = sorrowT * 22 * scale;
  drawKaguyaBrushStroke(
    ctx,
    [
      { x: screenX + 24 * scale, y: groundY - 12 * scale + bob * 0.4, p: 1.05 },
      { x: screenX + 52 * scale, y: groundY - (22 - tailDroop * 0.3) * scale + bob * 0.5, p: 0.95 },
      {
        x: screenX + (66 - romanceT * 10) * scale,
        y: groundY - (56 - tailDroop * 0.7) * scale + tailWave + bob * 0.7,
        p: 0.85,
      },
      {
        x: screenX + (56 - romanceT * 22) * scale,
        y: groundY - (86 - tailDroop) * scale + tailWave * 0.6 + bob * 0.8,
        p: 0.65,
      },
    ],
    11 * scale,
    0.92,
    0.55,
    '224, 214, 198',
    boilTick,
    0.45
  );

  // Body leans gently forward toward the black cat in affection!
  const leanFwd = romanceT * 11 * scale - sorrowT * 4 * scale;
  ctx.fillStyle = '#F7F1E5';
  ctx.beginPath();
  ctx.moveTo(screenX - 18 * scale - leanFwd * 0.35, groundY + 2 * scale - floatLift);
  ctx.quadraticCurveTo(
    screenX - 24 * scale - leanFwd * 0.65,
    groundY - 46 * scale - floatLift,
    screenX - 14 * scale - leanFwd,
    groundY - 76 * scale + bob
  );
  ctx.quadraticCurveTo(
    screenX + 14 * scale - leanFwd * 0.5,
    groundY - 78 * scale + bob,
    screenX + 28 * scale,
    groundY - 40 * scale - floatLift
  );
  ctx.quadraticCurveTo(
    screenX + 36 * scale,
    groundY - 10 * scale - floatLift,
    screenX + 24 * scale,
    groundY + 2 * scale - floatLift
  );
  ctx.closePath();
  ctx.fill();

  // Gentle reaching front paw during romance/farewell
  if (romanceT > 0.15) {
    const reachAmt = romanceT * (1 - dissolveT * 0.3);
    drawKaguyaBrushStroke(
      ctx,
      [
        { x: screenX - 12 * scale - leanFwd * 0.6, y: groundY - 46 * scale - floatLift, p: 0.88 },
        { x: screenX - (28 + reachAmt * 14) * scale, y: groundY - (50 + reachAmt * 8) * scale + bob * 0.7, p: 0.7 },
        { x: screenX - (36 + reachAmt * 18) * scale, y: groundY - (52 + reachAmt * 10) * scale + bob * 0.7, p: 0.58 },
      ],
      7.5 * scale,
      0.92,
      0.32,
      '236, 228, 212',
      boilTick,
      0.32
    );
  }

  drawKaguyaBrushStroke(
    ctx,
    [
      { x: screenX - 12 * scale - leanFwd, y: groundY - 74 * scale + bob, p: 0.55 },
      { x: screenX + 10 * scale - leanFwd * 0.4, y: groundY - 62 * scale + bob, p: 0.9 },
      { x: screenX + 28 * scale, y: groundY - 32 * scale - floatLift, p: 1.05 },
      { x: screenX + 26 * scale, y: groundY + 1 * scale - floatLift, p: 0.75 },
    ],
    4.6 * scale,
    0.85,
    0.45,
    '32, 30, 28',
    boilTick,
    0.4
  );

  const headX = screenX - 13 * scale - leanFwd * 1.1;
  const headY = groundY - 84 * scale + bob;

  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(-romanceT * 0.08 + sorrowT * 0.14);

  ctx.fillStyle = '#F7F1E5';
  ctx.beginPath();
  ctx.ellipse(0, 0, 18.5 * scale, 16 * scale, 0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-8 * scale, -6 * scale);
  ctx.quadraticCurveTo(-24 * scale, 0, -22 * scale, 7 * scale);
  ctx.quadraticCurveTo(-14 * scale, 13 * scale, -2 * scale, 12 * scale);
  ctx.closePath();
  ctx.fill();

  const earDrop = sorrowT * 7 * scale;
  ctx.fillStyle = 'rgba(48, 44, 42, 0.88)';
  ctx.beginPath();
  ctx.moveTo(2 * scale, -12 * scale);
  ctx.lineTo((-4 + earDrop) * scale, (-32 + earDrop * 0.7) * scale);
  ctx.lineTo(-12 * scale, -10 * scale);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(28, 26, 24, 0.94)';
  ctx.beginPath();
  ctx.moveTo(14 * scale, -8 * scale);
  ctx.lineTo((10 + earDrop * 1.1) * scale, (-34 + earDrop * 0.8) * scale);
  ctx.lineTo(-2 * scale, -12 * scale);
  ctx.closePath();
  ctx.fill();

  drawKaguyaBrushStroke(
    ctx,
    [
      { x: 14 * scale, y: 6 * scale, p: 0.6 },
      { x: 14 * scale, y: -10 * scale, p: 0.85 },
      { x: (10 + earDrop * 1.1) * scale, y: (-33 + earDrop * 0.8) * scale, p: 0.5 },
      { x: -1 * scale, y: -13 * scale, p: 0.78 },
      { x: -20 * scale, y: 1 * scale, p: 0.72 },
      { x: -12 * scale, y: 11 * scale, p: 0.55 },
    ],
    4.0 * scale,
    0.88,
    0.3,
    '28, 26, 24',
    boilTick,
    0.35
  );

  // Delicate sakura blush during the romantic moment
  if (romanceT > 0.2 && sorrowT < 0.8) {
    ctx.fillStyle = `rgba(232, 134, 138, ${(romanceT * (1 - sorrowT * 0.6) * 0.42).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(-11 * scale, 4.5 * scale, 4.6 * scale, 2.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(-9 * scale, -2 * scale);
  if (romanceT > 0.55 && sorrowT < 0.25) {
    // Soft affectionate closed-smile eye
    ctx.strokeStyle = '#1C1917';
    ctx.lineWidth = 2.0 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-5.2 * scale, 0.2 * scale);
    ctx.quadraticCurveTo(0, -4.4 * scale, 5.2 * scale, 0.2 * scale);
    ctx.stroke();
  } else {
    ctx.rotate(0.14 - sorrowT * 0.24);
    const eyeRy = lerp(4.8, 3.6, sorrowT);
    ctx.beginPath();
    ctx.moveTo(-6 * scale, 0);
    ctx.quadraticCurveTo(0, -eyeRy * scale, 6 * scale, 0);
    ctx.quadraticCurveTo(0, eyeRy * scale, -6 * scale, 0);
    ctx.closePath();
    const eyeGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, 6 * scale);
    eyeGrad.addColorStop(0, '#C5E0BA');
    eyeGrad.addColorStop(0.7, '#75A47A');
    eyeGrad.addColorStop(1, '#2B4C32');
    ctx.fillStyle = eyeGrad;
    ctx.fill();

    ctx.fillStyle = '#0F0E0D';
    ctx.beginPath();
    ctx.ellipse(-1.2 * scale, 0, (1.1 + sorrowT * 0.6) * scale, eyeRy * 0.72 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    if (sorrowT > 0.2) {
      ctx.fillStyle = `rgba(230, 242, 255, ${(sorrowT * 0.9).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(1.2 * scale, 1.3 * scale, 1.5 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.fillStyle = 'rgba(206, 128, 124, 0.85)';
  ctx.beginPath();
  ctx.arc(-20 * scale, 2.5 * scale, 2.0 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.restore();

  return { headX, headY, screenX };
}

function drawKaguyaWatercolorBambooWorld(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  camX: number,
  elapsed: number,
  groundY: number,
  romanceGlowT: number,
  moonNightT: number,
  rainT: number
) {
  const bg = ctx.createRadialGradient(
    w * 0.52,
    h * 0.44,
    w * 0.06,
    w * 0.5,
    h * 0.5,
    Math.max(w, h) * 0.78
  );
  if (moonNightT > 0.25) {
    bg.addColorStop(0, '#E8EEF5');
    bg.addColorStop(0.6, '#C8D3E3');
    bg.addColorStop(1, '#9BAAC2');
  } else if (romanceGlowT > 0.15) {
    bg.addColorStop(0, '#FFF8EE');
    bg.addColorStop(0.65, '#F9E6DA');
    bg.addColorStop(1, '#EDD0C2');
  } else {
    bg.addColorStop(0, '#FCF8F0');
    bg.addColorStop(0.65, '#F5EFE2');
    bg.addColorStop(1, '#E8DEC8');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  if (romanceGlowT > 0.02 && moonNightT < 0.95) {
    const rAlpha = romanceGlowT * (1 - moonNightT * 0.85) * 0.24;
    ctx.save();
    const warmWash = ctx.createRadialGradient(w * 0.56, h * 0.56, 20, w * 0.56, h * 0.56, w * 0.55);
    warmWash.addColorStop(0, `rgba(248, 186, 152, ${rAlpha.toFixed(3)})`);
    warmWash.addColorStop(0.6, `rgba(238, 156, 158, ${(rAlpha * 0.55).toFixed(3)})`);
    warmWash.addColorStop(1, 'rgba(238, 156, 158, 0)');
    ctx.fillStyle = warmWash;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  if (moonNightT > 0.02) {
    ctx.save();
    ctx.fillStyle = `rgba(34, 48, 78, ${(moonNightT * 0.34).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  const washes = [
    {
      x: w * 0.5,
      y: h * 0.48,
      rx: Math.min(w, h) * 0.48,
      ry: Math.min(w, h) * 0.3,
      color:
        moonNightT > 0.3
          ? 'rgba(72, 92, 128, 0.26)'
          : romanceGlowT > 0.3
          ? 'rgba(224, 174, 158, 0.22)'
          : 'rgba(136, 166, 152, 0.19)',
    },
    {
      x: w * 0.28,
      y: h * 0.32,
      rx: Math.min(w, h) * 0.34,
      ry: Math.min(w, h) * 0.24,
      color: 'rgba(164, 178, 172, 0.15)',
    },
    {
      x: w * 0.74,
      y: h * 0.38,
      rx: Math.min(w, h) * 0.3,
      ry: Math.min(w, h) * 0.22,
      color:
        moonNightT > 0.3
          ? 'rgba(98, 118, 152, 0.18)'
          : 'rgba(218, 176, 162, 0.16)',
    },
  ];
  washes.forEach((wash, idx) => {
    const dx = Math.sin(elapsed * 0.22 + idx * 1.9) * 18;
    const dy = Math.cos(elapsed * 0.17 + idx * 1.3) * 9;
    ctx.save();
    ctx.translate(wash.x + dx, wash.y + dy);
    ctx.scale(1, wash.ry / wash.rx);
    const grad = ctx.createRadialGradient(0, 0, wash.rx * 0.1, 0, 0, wash.rx);
    grad.addColorStop(0, wash.color);
    grad.addColorStop(0.75, wash.color);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, wash.rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  ctx.save();
  const hillSpan = w * 1.4;
  const hillOffset = -((camX * 0.08) % hillSpan);
  ctx.fillStyle = moonNightT > 0.3 ? 'rgba(64, 78, 102, 0.18)' : 'rgba(144, 160, 152, 0.12)';
  for (let rep = -1; rep <= 1; rep++) {
    const ox = hillOffset + rep * hillSpan;
    ctx.beginPath();
    ctx.moveTo(ox, groundY + 40);
    ctx.quadraticCurveTo(
      ox + hillSpan * 0.25,
      groundY - h * 0.2,
      ox + hillSpan * 0.5,
      groundY - h * 0.05
    );
    ctx.quadraticCurveTo(
      ox + hillSpan * 0.75,
      groundY - h * 0.24,
      ox + hillSpan,
      groundY + 40
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const farSpacing = 310;
  const farOffset = -((camX * 0.18) % farSpacing);
  for (let i = -1; i <= Math.ceil(w / farSpacing) + 2; i++) {
    const x = farOffset + i * farSpacing + ((i * 53) % 70);
    const lean = ((i % 3) - 1) * 24;
    const tall = h * (0.68 + (i % 3) * 0.12);
    drawBambooStalk(
      ctx,
      x,
      groundY + 12,
      tall,
      5.5 + (i % 2) * 1.5,
      lean,
      elapsed * (0.85 + rainT * 0.85) + i * 0.9,
      0.16,
      moonNightT > 0.3 ? '78, 92, 108' : '102, 118, 110',
      0
    );
  }

  const mistGrad = ctx.createLinearGradient(0, groundY - h * 0.16, 0, groundY + 45);
  mistGrad.addColorStop(0, 'rgba(250, 246, 238, 0)');
  mistGrad.addColorStop(
    0.65,
    moonNightT > 0.3 ? 'rgba(216, 224, 236, 0.35)' : 'rgba(246, 241, 230, 0.55)'
  );
  mistGrad.addColorStop(1, 'rgba(130, 140, 132, 0.12)');
  ctx.fillStyle = mistGrad;
  ctx.fillRect(0, groundY - h * 0.16, w, h * 0.16 + 45);

  const groundWash = ctx.createLinearGradient(0, groundY - 4, 0, groundY + 34);
  groundWash.addColorStop(0, 'rgba(72, 78, 72, 0.18)');
  groundWash.addColorStop(0.45, 'rgba(92, 98, 92, 0.08)');
  groundWash.addColorStop(1, 'rgba(92, 98, 92, 0)');
  ctx.fillStyle = groundWash;
  ctx.fillRect(0, groundY - 4, w, 38);

  const midSpacing = 450;
  const midOffset = -((camX * 0.45) % midSpacing);
  for (let i = -1; i <= Math.ceil(w / midSpacing) + 2; i++) {
    const gx = midOffset + i * midSpacing + 100;
    drawBambooStalk(
      ctx,
      gx,
      groundY + 10,
      h * (0.78 + (i % 2) * 0.1),
      7.0,
      -24 + (i % 3) * 15,
      elapsed * (1.05 + rainT * 0.9) + i * 1.4,
      0.32,
      moonNightT > 0.3 ? '36, 46, 56' : '44, 54, 48',
      0
    );
    drawBambooStalk(
      ctx,
      gx + 24,
      groundY + 14,
      h * (0.64 + ((i + 1) % 2) * 0.12),
      5.0,
      16,
      elapsed * (1.15 + rainT * 0.9) + i * 1.9,
      0.25,
      moonNightT > 0.3 ? '46, 56, 68' : '56, 66, 60',
      0
    );
  }

  FLOATING_LEAVES.forEach((leaf) => {
    const px =
      (((leaf.baseX - elapsed * leaf.speedX * (1 + rainT * 0.8)) % 1.15) + 1.15) % 1.15 -
      0.08;
    const py =
      (((leaf.baseY +
        elapsed * leaf.speedY +
        Math.sin(elapsed * leaf.swayFreq + leaf.phase) * 0.035) %
        1.12) +
        1.12) %
        1.12 -
      0.06;
    const x = px * w;
    const y = py * h;
    const rot = Math.sin(elapsed * 1.6 + leaf.phase) * 0.55 - 0.25;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = moonNightT > 0.3 ? 'rgba(54, 66, 80, 0.38)' : 'rgba(46, 56, 50, 0.34)';
    ctx.beginPath();
    ctx.moveTo(-leaf.size, 0);
    ctx.quadraticCurveTo(0, -leaf.size * 0.25, leaf.size, 0);
    ctx.quadraticCurveTo(0, leaf.size * 0.25, -leaf.size, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

  if (rainT > 0.08) {
    ctx.save();
    ctx.strokeStyle = `rgba(218, 232, 250, ${(rainT * 0.32).toFixed(3)})`;
    ctx.lineWidth = 1.25;
    ctx.lineCap = 'round';
    RAIN_DROPS.forEach((r) => {
      const ry = ((r.yOffset + elapsed * r.speed) % 1.1) * h;
      const rx = ((r.xFrac - elapsed * 0.18 + 10) % 1.0) * w;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - r.len * 0.25, ry + r.len);
      ctx.stroke();
    });
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = 0.72;
  const pat = ctx.createPattern(getKaguyaWashiTile(), 'repeat');
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

export function renderJumpingCatFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  elapsedSeconds: number
) {
  const t = elapsedSeconds % TOTAL_DURATION;
  const boilTick = Math.floor(elapsedSeconds * 11);

  const baseScale = Math.max(0.7, Math.min(1.4, Math.min(width / 980, height / 620) * 1.08));
  const climaxZoom = 1.0 + 0.08 * smoothstep(20.0, 26.5, t) * (1 - smoothstep(37.5, 42.0, t));
  const scale = baseScale * climaxZoom;
  const groundY = height * 0.74;

  // Story timeline (44s):
  // 0.0 -> 20.5s : Travel guided by glowing golden spirit ember -> obstacles -> river -> exhausted arrival
  // 20.5 -> 23.8s : Offers the blooming spirit lotus light to Sunmy ("Sunmy... guardé esta luz solo para ti.")
  // 23.2 -> 27.2s : Romance & Magic! Sunmy steps closer, warm rose-gold glow & fireflies ("¿Cruzaste el río... solo por mí?")
  // 27.2 -> 31.3s : Tragedy strikes: silver full moon & beams claim Sunmy ("Perdóname... la luna ya viene por mí.")
  // 31.0 -> 36.2s : Ink rain falls; black cat lunges in tears as Sunmy dissolves into silver moon-petals ("¡Sunmy! ¡No me dejes solo otra vez!")
  // 36.2 -> 44.0s : Epilogue: single glowing petal settles by his paws; he gazes up at the silver moon in the rain

  let catWorldX = JOURNEY_START_X;
  let speedPxPerSec = 0;

  if (t < TRAVEL_DURATION) {
    catWorldX = sampleJourneyX(t);
    const xNext = sampleJourneyX(Math.min(TRAVEL_DURATION, t + 0.05));
    const xPrev = sampleJourneyX(Math.max(0, t - 0.05));
    speedPxPerSec = (xNext - xPrev) / 0.1;
  } else {
    catWorldX = TRAVEL_END_X;
    speedPxPerSec = 0;
  }

  const speedFactor = clamp01(speedPxPerSec / 220);
  const fatigueT = smoothstep(3260, 3660, catWorldX);
  const giftT = smoothstep(20.6, 22.4, t);
  const magicBloomT = smoothstep(21.4, 25.0, t) * (1 - smoothstep(27.8, 30.8, t));
  const romanceT = smoothstep(23.0, 24.5, t) * (1 - smoothstep(29.8, 32.0, t));
  const romanceGlowT = smoothstep(22.6, 24.5, t) * (1 - smoothstep(27.4, 29.6, t));
  const moonNightT = smoothstep(26.8, 29.2, t);
  const beamT = smoothstep(27.4, 29.4, t) * (1 - smoothstep(36.2, 38.8, t));
  const sorrowT = smoothstep(27.4, 29.0, t);
  const sunmyDissolveT = smoothstep(29.2, 36.2, t);
  const desperateReachT =
    t >= 30.6 && t <= 36.5
      ? Math.min(smoothstep(30.6, 32.0, t), 1 - smoothstep(35.2, 36.5, t))
      : 0;
  const rainT = smoothstep(29.8, 32.0, t);
  const griefT = smoothstep(30.8, 33.2, t);
  const lookUpT = smoothstep(37.6, 40.0, t);

  const targetCamLead = lerp(
    width * 0.34,
    width * 0.43,
    smoothstep(TRAVEL_DURATION - 2.0, TRAVEL_DURATION, t)
  );
  const camX = catWorldX - targetCamLead / scale;
  const toScreenX = (wx: number) => (wx - camX) * scale;

  // 1. Background world (shifts from morning washi -> rose-gold romance -> indigo moonlit rain)
  drawKaguyaWatercolorBambooWorld(
    ctx,
    width,
    height,
    camX * scale,
    elapsedSeconds,
    groundY,
    romanceGlowT,
    moonNightT,
    rainT
  );

  const femaleBaseScreenX = toScreenX(MEETING_CAT_X);

  // 2. Celestial Full Moon & Descending Moonbeam
  drawCelestialMoonAndBeams(
    ctx,
    width,
    height,
    femaleBaseScreenX - 18 * scale,
    groundY,
    scale,
    moonNightT,
    beamT,
    elapsedSeconds
  );

  // 3. Organic Obstacles
  OBSTACLES.forEach((obs) => {
    const sx = toScreenX(obs.worldX);
    if (sx < -240 * scale || sx > width + 240 * scale) return;
    drawObstacle(ctx, obs, sx, groundY, scale, elapsedSeconds, boilTick);
  });

  // 4. Imperial River
  drawImperialRiver(
    ctx,
    toScreenX(RIVER_START_X),
    toScreenX(RIVER_END_X),
    groundY,
    height,
    scale,
    elapsedSeconds,
    boilTick
  );

  // 5. Sunmy
  let femaleHeadPos = {
    headX: femaleBaseScreenX - 12 * scale,
    headY: groundY - 84 * scale,
    screenX: femaleBaseScreenX,
  };
  if (femaleBaseScreenX > -240 * scale && femaleBaseScreenX < width + 260 * scale) {
    femaleHeadPos = drawFemaleCatSunmy(
      ctx,
      femaleBaseScreenX,
      groundY,
      scale,
      romanceT,
      sorrowT,
      sunmyDissolveT,
      elapsedSeconds,
      boilTick
    );
  }

  // 6. Black Cat Kinematics
  let obstacleLift = 0;
  let obstacleJumpPhase = -1;
  let riverDiveY = 0;
  let riverPitchDeg = 0;
  const isPlungingIntoRiver = t < TRAVEL_DURATION && catWorldX >= 2540 && catWorldX < RIVER_ENTRY_X;
  const isSwimmingInRiver = t < TRAVEL_DURATION && catWorldX >= RIVER_ENTRY_X && catWorldX <= RIVER_EXIT_X;
  const isClimbingOut = t < TRAVEL_DURATION && catWorldX > RIVER_EXIT_X && catWorldX <= RIVER_END_X + 95;
  const isWet = catWorldX > RIVER_ENTRY_X && t < 29.0;

  if (isPlungingIntoRiver) {
    const s = (catWorldX - 2540) / (RIVER_ENTRY_X - 2540);
    obstacleLift = (Math.sin(s * Math.PI * 0.92) * 150 - s * s * 36) * scale;
    riverPitchDeg = lerp(-36, 38, s);
    obstacleJumpPhase = clamp01(s * 0.78);
  } else if (isSwimmingInRiver) {
    const swimBob = Math.sin(elapsedSeconds * 8.5) * 4.5 * scale;
    riverDiveY = 26 * scale + swimBob;
    riverPitchDeg = -6 + Math.sin(elapsedSeconds * 8.5) * 4;
  } else if (isClimbingOut) {
    const s = (catWorldX - RIVER_EXIT_X) / (RIVER_END_X + 95 - RIVER_EXIT_X);
    obstacleLift = Math.sin(s * Math.PI) * 58 * scale;
    riverDiveY = (1 - smoothstep(0, 0.45, s)) * 22 * scale;
    riverPitchDeg = lerp(-26, 4, s);
  } else if (t < TRAVEL_DURATION) {
    for (const obs of OBSTACLES) {
      const dx = catWorldX - obs.worldX;
      if (Math.abs(dx) < obs.span) {
        const s = (dx + obs.span) / (obs.span * 2);
        obstacleJumpPhase = s;
        obstacleLift = Math.pow(Math.sin(s * Math.PI), 0.92) * obs.clearHeight * scale;
        break;
      }
    }
  }

  const strideCycle = (catWorldX / 172) % 1;
  const runLift =
    obstacleJumpPhase >= 0 || isSwimmingInRiver || isClimbingOut
      ? 0
      : Math.max(0, Math.sin(clamp01((strideCycle - 0.16) / 0.58) * Math.PI)) *
        36 *
        scale *
        speedFactor *
        (1 - fatigueT * 0.85);

  const totalLift = obstacleLift + runLift - riverDiveY;
  const u = obstacleJumpPhase >= 0 ? obstacleJumpPhase : strideCycle;
  const isEncounterSeated = t >= TRAVEL_DURATION - 0.15;
  const catScreenX = toScreenX(catWorldX);

  if (!isSwimmingInRiver) {
    const shadowScale = clamp01(Math.max(0, totalLift) / (170 * scale));
    ctx.save();
    ctx.fillStyle = `rgba(26, 24, 22, ${0.19 * (1 - shadowScale * 0.72)})`;
    ctx.filter = `blur(${(4 + shadowScale * 11).toFixed(1)}px)`;
    ctx.beginPath();
    ctx.ellipse(
      catScreenX,
      groundY + 5 * scale,
      (58 - shadowScale * 22) * scale,
      (11 - shadowScale * 4.5) * scale,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();
  }

  let blackHeadScreen = { x: catScreenX + 15 * scale, y: groundY - 87 * scale };

  if (isEncounterSeated) {
    // --- EXHAUSTED OFFERING -> ROMANTIC CLOSENESS -> TRAGIC GRIEF ---
    const pantRate = lerp(6.8, 2.2, Math.max(romanceT, griefT));
    const pantAmp = (1 - romanceT * 0.55) * (2.5 - griefT * 1.1);
    const pantHeave = Math.sin(elapsedSeconds * pantRate) * pantAmp * scale;
    const slumpY = (5 + griefT * 14 * (1 - lookUpT * 0.4)) * scale;
    const leanFwd = (romanceT * 12 + desperateReachT * 24 - griefT * 8 * (1 - desperateReachT)) * scale;

    // Tail curls softly upward in romance, then droops heavy on the wet ground in tragedy
    const tailLift = romanceT * 48 * (1 - griefT);
    const tailArchY = lerp(10, 42, romanceT * (1 - griefT)) - griefT * 6;
    const tailTipY = lerp(22, 62, romanceT * (1 - griefT)) - griefT * 20;
    drawKaguyaBrushStroke(
      ctx,
      [
        { x: catScreenX - 24 * scale, y: groundY - 12 * scale, p: 1.08 },
        { x: catScreenX - 56 * scale, y: groundY - Math.max(3, tailArchY) * scale, p: 0.95 },
        {
          x: catScreenX - (70 - tailLift * 0.35 + griefT * 18) * scale,
          y: groundY - Math.max(2, tailTipY * 0.7) * scale,
          p: 0.8,
        },
        {
          x: catScreenX - (60 - tailLift * 0.55 + griefT * 30) * scale,
          y: groundY - Math.max(1, tailTipY) * scale,
          p: 0.52,
        },
      ],
      11.5 * scale,
      0.95,
      0.65,
      '18, 17, 16',
      boilTick,
      0.42
    );

    ctx.fillStyle = 'rgba(18, 17, 16, 0.93)';
    ctx.beginPath();
    ctx.moveTo(catScreenX + 18 * scale + leanFwd * 0.4, groundY + 2 * scale);
    ctx.quadraticCurveTo(
      catScreenX + 24 * scale + leanFwd * 0.65,
      groundY - (48 - slumpY * 0.5) * scale,
      catScreenX + 16 * scale + leanFwd * 0.85,
      groundY - (78 - slumpY) * scale + pantHeave
    );
    ctx.quadraticCurveTo(
      catScreenX - 12 * scale,
      groundY - (82 - slumpY * 0.6) * scale + pantHeave,
      catScreenX - 28 * scale,
      groundY - 40 * scale
    );
    ctx.quadraticCurveTo(
      catScreenX - 36 * scale,
      groundY - 10 * scale,
      catScreenX - 24 * scale,
      groundY + 2 * scale
    );
    ctx.closePath();
    ctx.fill();

    // Gentle paw offering light / desperate reach as she vanishes
    const pawOut = Math.max(giftT * (1 - griefT * 0.5), desperateReachT);
    if (pawOut > 0.05) {
      const tremble = desperateReachT > 0.1 ? Math.sin(elapsedSeconds * 18) * 1.4 * scale : 0;
      drawKaguyaBrushStroke(
        ctx,
        [
          { x: catScreenX + 14 * scale + leanFwd * 0.5, y: groundY - 46 * scale, p: 0.92 },
          {
            x: catScreenX + (34 + pawOut * 30) * scale,
            y: groundY - (50 + pawOut * 14) * scale + tremble,
            p: 0.72,
          },
          {
            x: catScreenX + (44 + pawOut * 42) * scale,
            y: groundY - (53 + pawOut * 18) * scale + tremble,
            p: 0.62,
          },
        ],
        8.5 * scale,
        0.95,
        0.4,
        '16, 15, 14',
        boilTick,
        0.38
      );
    }

    drawKaguyaBrushStroke(
      ctx,
      [
        {
          x: catScreenX + 14 * scale + leanFwd * 0.85,
          y: groundY - (78 - slumpY) * scale + pantHeave,
          p: 0.6,
        },
        {
          x: catScreenX - 8 * scale,
          y: groundY - (64 - slumpY * 0.5) * scale + pantHeave,
          p: 0.95,
        },
        { x: catScreenX - 28 * scale, y: groundY - 32 * scale, p: 1.1 },
        { x: catScreenX - 26 * scale, y: groundY + 1 * scale, p: 0.75 },
      ],
      11 * scale,
      0.95,
      0.68,
      '16, 15, 14',
      boilTick,
      0.45
    );

    const headX = catScreenX + 15 * scale + leanFwd;
    const headY = groundY - (84 - slumpY * 1.35) * scale + pantHeave * 1.2;
    blackHeadScreen = { x: headX, y: headY };

    // Quiet mist breath in the cold moonlit rain / exhaustion
    if (romanceT < 0.4 || griefT > 0.6) {
      const puffCycle = (elapsedSeconds * 0.85) % 1;
      const puffAlpha = Math.sin(puffCycle * Math.PI) * 0.24;
      ctx.fillStyle = `rgba(244, 246, 250, ${puffAlpha})`;
      ctx.beginPath();
      ctx.ellipse(
        headX + (26 + puffCycle * 18) * scale,
        headY + (4 - puffCycle * 10) * scale,
        (5 + puffCycle * 6) * scale,
        (3 + puffCycle * 4) * scale,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    ctx.save();
    ctx.translate(headX, headY);
    const headRot = 0.08 - romanceT * 0.14 + griefT * 0.34 - lookUpT * 0.68;
    ctx.rotate(headRot);

    ctx.fillStyle = 'rgba(17, 16, 15, 0.95)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 19.5 * scale, 16.5 * scale, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8 * scale, -7 * scale);
    ctx.quadraticCurveTo(25 * scale, -1 * scale, 23 * scale, 7 * scale);
    ctx.quadraticCurveTo(15 * scale, 13 * scale, 2 * scale, 12.5 * scale);
    ctx.closePath();
    ctx.fill();

    const earDroop = (3.0 + griefT * 9.5 * (1 - lookUpT * 0.35)) * scale;
    ctx.beginPath();
    ctx.moveTo(-2 * scale, -13 * scale);
    ctx.lineTo((3 - earDroop * 0.7) * scale, (-33 + earDroop) * scale);
    ctx.lineTo(12 * scale, -11 * scale);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-14 * scale, -9 * scale);
    ctx.lineTo((-10 - earDroop) * scale, (-35 + earDroop * 1.1) * scale);
    ctx.lineTo(3 * scale, -12 * scale);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(9 * scale, -2 * scale);
    if (romanceT > 0.55 && griefT < 0.2) {
      // Warm gentle closed eyes in the romantic moment
      ctx.strokeStyle = '#F7D882';
      ctx.lineWidth = 2.0 * scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-5.2 * scale, 0.2 * scale);
      ctx.quadraticCurveTo(0, -4.4 * scale, 5.2 * scale, 0.2 * scale);
      ctx.stroke();
    } else {
      ctx.rotate(-0.14 + griefT * 0.24);
      ctx.beginPath();
      ctx.moveTo(-6 * scale, 0);
      ctx.quadraticCurveTo(0, -(4.2 - griefT * 1.1) * scale, 6 * scale, 0);
      ctx.quadraticCurveTo(0, (4.2 - griefT * 0.8) * scale, -6 * scale, 0);
      ctx.closePath();
      ctx.fillStyle = griefT > 0.4 ? '#D69E42' : '#E2A13A';
      ctx.fill();

      ctx.fillStyle = '#0F0E0D';
      ctx.beginPath();
      ctx.ellipse(1.1 * scale, 0, (1.2 + griefT * 0.7) * scale, 2.7 * scale, 0, 0, Math.PI * 2);
      ctx.fill();

      if (griefT > 0.2) {
        ctx.fillStyle = `rgba(218, 236, 250, ${griefT * 0.95})`;
        ctx.beginPath();
        ctx.arc(-1.5 * scale, 1.5 * scale, 1.9 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    if (griefT > 0.28) {
      for (let d = 0; d < 3; d++) {
        const dropCycle = (elapsedSeconds * 0.8 + d * 0.33) % 1;
        const dropY = (4 + dropCycle * 32) * scale;
        const dropAlpha = Math.sin(dropCycle * Math.PI) * griefT * 0.9;
        ctx.fillStyle = `rgba(186, 214, 242, ${dropAlpha})`;
        ctx.beginPath();
        ctx.ellipse((11 - d * 1.8) * scale, dropY, 1.9 * scale, 3.2 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawKaguyaBrushStroke(
      ctx,
      [
        { x: 16 * scale, y: 4 * scale, p: 0.7 },
        { x: -4 * scale, y: (6 + griefT * 4) * scale, p: 0.4 },
        { x: -24 * scale, y: (10 + griefT * 8) * scale, p: 0.12 },
      ],
      1.5 * scale,
      0.68,
      0,
      '20, 18, 17',
      boilTick,
      0.25
    );
    ctx.restore();
  } else {
    // --- TRAVELING (ENERGETIC -> SWIMMING -> EXHAUSTED TRUDGE) ---
    const isBigJump = obstacleJumpPhase >= 0;
    const wearyDamp = 1 - fatigueT * 0.68;
    const pitchAmp = isBigJump ? 1.0 : 0.42 * speedFactor * wearyDamp;

    const pitchDeg =
      isPlungingIntoRiver || isSwimmingInRiver || isClimbingOut
        ? riverPitchDeg
        : sampleCyclic(u, [
            { u: 0.0, v: 4 },
            { u: 0.14, v: 12 },
            { u: 0.28, v: -36 },
            { u: 0.48, v: -6 },
            { u: 0.68, v: 26 },
            { u: 0.84, v: 12 },
            { u: 1.0, v: 4 },
          ]) *
            pitchAmp +
          fatigueT * 8;
    const pitch = (pitchDeg * Math.PI) / 180;

    const stretch = isSwimmingInRiver
      ? 1.14
      : lerp(
          0.92,
          sampleCyclic(u, [
            { u: 0.0, v: 0.94 },
            { u: 0.14, v: 0.78 },
            { u: 0.3, v: 1.22 },
            { u: 0.5, v: 1.28 },
            { u: 0.72, v: 1.08 },
            { u: 0.86, v: 0.84 },
            { u: 1.0, v: 0.94 },
          ]),
          isBigJump ? 1.0 : 0.62 * speedFactor * wearyDamp
        );

    const gatherDip =
      isBigJump || isSwimmingInRiver
        ? 0
        : sampleCyclic(u, [
            { u: 0.0, v: 2 },
            { u: 0.14, v: 9 },
            { u: 0.3, v: 0 },
            { u: 0.8, v: 0 },
            { u: 0.9, v: 8 },
            { u: 1.0, v: 2 },
          ]) *
          scale *
          speedFactor;

    const wearyDroopY = fatigueT * 6 * scale;
    const baseY = groundY - 45 * scale - totalLift + gatherDip + wearyDroopY;

    const spineWave =
      sampleCyclic(u, [
        { u: 0.0, v: -10 },
        { u: 0.14, v: -20 },
        { u: 0.3, v: 6 },
        { u: 0.5, v: -4 },
        { u: 0.7, v: -14 },
        { u: 0.86, v: -18 },
        { u: 1.0, v: -10 },
      ]) *
      scale *
      (isBigJump ? 1 : wearyDamp);

    const toWorld = (lx: number, ly: number): Vec2 => {
      const c = Math.cos(pitch);
      const s = Math.sin(pitch);
      return {
        x: catScreenX + (lx * c - ly * s) * scale,
        y: baseY + (lx * s + ly * c) * scale,
      };
    };

    const hip = toWorld(-45 * stretch, 8);
    const lumbar = toWorld(-18 * stretch, spineWave / scale);
    const midBack = toWorld(6 * stretch, (spineWave * 0.7) / scale - 2);
    const chest = toWorld(30 * stretch, -5 + (spineWave * 0.35) / scale);
    const neck = toWorld(51 * stretch, -21 + fatigueT * 6);

    const headPos: Vec2 = {
      x: neck.x + 17 * scale,
      y: neck.y - (11 - fatigueT * 8) * scale + gatherDip * 0.1,
    };
    blackHeadScreen = headPos;

    const tailVertical = isSwimmingInRiver
      ? -18
      : fatigueT > 0.4
      ? 28
      : sampleCyclic(u, [
          { u: 0.0, v: 12 },
          { u: 0.16, v: 22 },
          { u: 0.34, v: 24 },
          { u: 0.52, v: -12 },
          { u: 0.72, v: -40 },
          { u: 0.86, v: -28 },
          { u: 1.0, v: 12 },
        ]);

    const tailPts: StrokePoint[] = Array.from({ length: 6 }, (_, idx) => {
      const k = idx / 5;
      const wave = Math.sin(u * Math.PI * 2 - k * 2.4) * (9 + k * 14);
      return {
        x: hip.x - (6 + k * 114) * scale,
        y: hip.y + (tailVertical * k + wave * k) * scale,
        p: 1.12 - k * 0.68,
      };
    });

    const swimPhase = (elapsedSeconds * 2.5) % 1;
    const animU = isSwimmingInRiver ? swimPhase : u;
    const limbLiftScale = fatigueT > 0.5 ? 0.45 : 1.0;

    const hKneeX = sampleCyclic(animU, [
      { u: 0.0, v: -20 },
      { u: 0.14, v: -8 },
      { u: 0.28, v: -66 },
      { u: 0.5, v: -90 },
      { u: 0.72, v: -46 },
      { u: 0.86, v: -14 },
      { u: 1.0, v: -20 },
    ]);
    const hKneeY = sampleCyclic(animU, [
      { u: 0.0, v: 18 },
      { u: 0.14, v: 16 },
      { u: 0.28, v: 30 },
      { u: 0.5, v: 14 },
      { u: 0.72, v: 22 },
      { u: 0.86, v: 20 },
      { u: 1.0, v: 18 },
    ]);
    const hHockX = sampleCyclic(animU, [
      { u: 0.0, v: -50 },
      { u: 0.14, v: -44 },
      { u: 0.28, v: -90 },
      { u: 0.5, v: -114 },
      { u: 0.72, v: -72 },
      { u: 0.86, v: -46 },
      { u: 1.0, v: -50 },
    ]);
    const hHockY = sampleCyclic(animU, [
      { u: 0.0, v: 36 },
      { u: 0.14, v: 32 },
      { u: 0.28, v: 46 },
      { u: 0.5, v: 24 },
      { u: 0.72, v: 38 },
      { u: 0.86, v: 34 },
      { u: 1.0, v: 36 },
    ]);
    const hPawX = lerp(
      -34,
      sampleCyclic(animU, [
        { u: 0.0, v: -36 },
        { u: 0.14, v: -30 },
        { u: 0.28, v: -106 },
        { u: 0.5, v: -134 },
        { u: 0.72, v: -58 },
        { u: 0.86, v: -32 },
        { u: 1.0, v: -36 },
      ]),
      limbLiftScale
    );
    const hPawY = lerp(
      44,
      sampleCyclic(animU, [
        { u: 0.0, v: 45 },
        { u: 0.14, v: 34 },
        { u: 0.28, v: 64 },
        { u: 0.5, v: 34 },
        { u: 0.72, v: 50 },
        { u: 0.86, v: 42 },
        { u: 1.0, v: 45 },
      ]),
      limbLiftScale
    );

    const fElbowX = sampleCyclic(animU, [
      { u: 0.0, v: 22 },
      { u: 0.14, v: 14 },
      { u: 0.28, v: 54 },
      { u: 0.5, v: 78 },
      { u: 0.72, v: 48 },
      { u: 0.86, v: 24 },
      { u: 1.0, v: 22 },
    ]);
    const fElbowY = sampleCyclic(animU, [
      { u: 0.0, v: 20 },
      { u: 0.14, v: 16 },
      { u: 0.28, v: 4 },
      { u: 0.5, v: 10 },
      { u: 0.72, v: 26 },
      { u: 0.86, v: 20 },
      { u: 1.0, v: 20 },
    ]);
    const fWristX = sampleCyclic(animU, [
      { u: 0.0, v: 36 },
      { u: 0.14, v: 34 },
      { u: 0.28, v: 76 },
      { u: 0.5, v: 102 },
      { u: 0.72, v: 60 },
      { u: 0.86, v: 38 },
      { u: 1.0, v: 36 },
    ]);
    const fWristY = sampleCyclic(animU, [
      { u: 0.0, v: 38 },
      { u: 0.14, v: 30 },
      { u: 0.28, v: -6 },
      { u: 0.5, v: 14 },
      { u: 0.72, v: 44 },
      { u: 0.86, v: 36 },
      { u: 1.0, v: 38 },
    ]);
    const fPawX = lerp(
      44,
      sampleCyclic(animU, [
        { u: 0.0, v: 46 },
        { u: 0.14, v: 48 },
        { u: 0.28, v: 94 },
        { u: 0.5, v: 118 },
        { u: 0.72, v: 68 },
        { u: 0.86, v: 48 },
        { u: 1.0, v: 46 },
      ]),
      limbLiftScale
    );
    const fPawY = lerp(
      44,
      sampleCyclic(animU, [
        { u: 0.0, v: 45 },
        { u: 0.14, v: 34 },
        { u: 0.28, v: -10 },
        { u: 0.5, v: 18 },
        { u: 0.72, v: 54 },
        { u: 0.86, v: 42 },
        { u: 1.0, v: 45 },
      ]),
      limbLiftScale
    );

    const clampGround = (pt: Vec2): Vec2 =>
      isSwimmingInRiver || isPlungingIntoRiver
        ? pt
        : { x: pt.x, y: Math.min(pt.y, groundY + 2 * scale) };

    const farHind: ThreeJointLimb = {
      root: { x: hip.x + 8 * scale, y: hip.y + 3 * scale },
      mid1: toWorld(hKneeX + 12, hKneeY - 3),
      mid2: toWorld(hHockX + 12, hHockY - 4),
      paw: clampGround(toWorld(hPawX + 16, hPawY - 5)),
      widths: [1.12, 0.8, 0.5, 0.54],
      isFar: true,
    };
    const nearHind: ThreeJointLimb = {
      root: { x: hip.x + 2 * scale, y: hip.y + 2 * scale },
      mid1: toWorld(hKneeX, hKneeY),
      mid2: toWorld(hHockX, hHockY),
      paw: clampGround(toWorld(hPawX, hPawY)),
      widths: [1.3, 0.9, 0.56, 0.64],
    };
    const farFront: ThreeJointLimb = {
      root: { x: chest.x + 6 * scale, y: chest.y + 5 * scale },
      mid1: toWorld(fElbowX + 12, fElbowY - 4),
      mid2: toWorld(fWristX + 14, fWristY - 5),
      paw: clampGround(toWorld(fPawX + 18, fPawY - 6)),
      widths: [1.0, 0.72, 0.48, 0.52],
      isFar: true,
    };
    const nearFront: ThreeJointLimb = {
      root: { x: chest.x + 2 * scale, y: chest.y + 7 * scale },
      mid1: toWorld(fElbowX, fElbowY),
      mid2: toWorld(fWristX, fWristY),
      paw: clampGround(toWorld(fPawX, fPawY)),
      widths: [1.14, 0.8, 0.52, 0.6],
    };

    ctx.save();
    if (isSwimmingInRiver) {
      ctx.beginPath();
      ctx.rect(0, 0, width, groundY + 12 * scale);
      ctx.clip();
    }

    drawThreeJointLimb(ctx, farHind, scale, boilTick);
    drawThreeJointLimb(ctx, farFront, scale, boilTick);

    drawKaguyaBrushStroke(ctx, tailPts, 13 * scale, 0.94, 0.74, '18, 17, 16', boilTick, 0.6);

    const spineDense = interpolateCatmullRom(
      [
        { x: hip.x, y: hip.y, p: 21.5 * scale },
        { x: lumbar.x, y: lumbar.y, p: 18 * scale },
        { x: midBack.x, y: midBack.y, p: 20 * scale },
        { x: chest.x, y: chest.y, p: 24 * scale },
        { x: neck.x, y: neck.y, p: 14 * scale },
      ],
      8
    );
    const topHull: Vec2[] = [];
    const botHull: Vec2[] = [];
    for (let i = 0; i < spineDense.length; i++) {
      const curr = spineDense[i];
      const prev = spineDense[Math.max(0, i - 1)];
      const next = spineDense[Math.min(spineDense.length - 1, i + 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      topHull.push({ x: curr.x - nx * curr.p * 0.86, y: curr.y - ny * curr.p * 0.86 });
      botHull.push({ x: curr.x + nx * curr.p * 0.94, y: curr.y + ny * curr.p * 0.94 });
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(topHull[0].x, topHull[0].y);
    for (let i = 1; i < topHull.length; i++) ctx.lineTo(topHull[i].x, topHull[i].y);
    for (let i = botHull.length - 1; i >= 0; i--) ctx.lineTo(botHull[i].x, botHull[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(19, 18, 17, 0.89)';
    ctx.fill();
    ctx.restore();

    drawKaguyaBrushStroke(
      ctx,
      [
        { x: hip.x - 6 * scale, y: hip.y - 13 * scale, p: 0.65 },
        { x: lumbar.x, y: lumbar.y - 16 * scale, p: 1.12 },
        { x: midBack.x, y: midBack.y - 18 * scale, p: 1.15 },
        { x: chest.x, y: chest.y - 20 * scale, p: 1.0 },
        { x: neck.x, y: neck.y - 11 * scale, p: 0.62 },
      ],
      13 * scale,
      0.96,
      0.8,
      '16, 15, 14',
      boilTick,
      0.7
    );

    drawKaguyaBrushStroke(
      ctx,
      [
        { x: hip.x + 8 * scale, y: hip.y + 15 * scale, p: 0.55 },
        { x: lumbar.x, y: lumbar.y + 16 * scale, p: 0.85 },
        { x: chest.x, y: chest.y + 19 * scale, p: 0.8 },
      ],
      7 * scale,
      0.84,
      0.45,
      '18, 17, 16',
      boilTick,
      0.5
    );

    drawThreeJointLimb(ctx, nearHind, scale, boilTick);
    drawThreeJointLimb(ctx, nearFront, scale, boilTick);

    ctx.save();
    ctx.translate(headPos.x, headPos.y);
    ctx.rotate(pitch * 0.22);

    ctx.fillStyle = 'rgba(17, 16, 15, 0.94)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 20 * scale, 17 * scale, -0.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(8 * scale, -8 * scale);
    ctx.quadraticCurveTo(26 * scale, -2 * scale, 25 * scale, 7 * scale);
    ctx.quadraticCurveTo(17 * scale, 14 * scale, 2 * scale, 13 * scale);
    ctx.closePath();
    ctx.fill();

    const earSweep = (clamp01(-pitchDeg / 36) * 4 + fatigueT * 5) * scale;

    ctx.fillStyle = 'rgba(26, 25, 23, 0.84)';
    ctx.beginPath();
    ctx.moveTo(-2 * scale, -14 * scale);
    ctx.lineTo((3 - earSweep * 0.6) * scale, (-32 + earSweep * 0.8) * scale);
    ctx.lineTo(13 * scale, -12 * scale);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(16, 15, 14, 0.96)';
    ctx.beginPath();
    ctx.moveTo(-14 * scale, -10 * scale);
    ctx.lineTo((-10 - earSweep) * scale, (-34 + earSweep * 0.9) * scale);
    ctx.lineTo(4 * scale, -13 * scale);
    ctx.closePath();
    ctx.fill();

    drawKaguyaBrushStroke(
      ctx,
      [
        { x: -16 * scale, y: 8 * scale, p: 0.7 },
        { x: -16 * scale, y: -12 * scale, p: 0.92 },
        { x: (-10 - earSweep) * scale, y: (-33 + earSweep * 0.9) * scale, p: 0.48 },
        { x: 2 * scale, y: -14 * scale, p: 0.82 },
        { x: 22 * scale, y: -1 * scale, p: 0.72 },
      ],
      5.4 * scale,
      0.94,
      0.35,
      '16, 15, 14',
      boilTick,
      0.42
    );

    ctx.save();
    ctx.translate(10 * scale, -2 * scale);
    ctx.rotate(-0.14);
    ctx.beginPath();
    ctx.moveTo(-6.2 * scale, 0);
    ctx.quadraticCurveTo(0, -5 * scale, 6.2 * scale, 0);
    ctx.quadraticCurveTo(0, 5 * scale, -6.2 * scale, 0);
    ctx.closePath();
    const eyeGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, 6.2 * scale);
    eyeGrad.addColorStop(0, '#F7D882');
    eyeGrad.addColorStop(0.7, '#DE9B35');
    eyeGrad.addColorStop(1, '#7A4910');
    ctx.fillStyle = eyeGrad;
    ctx.fill();

    ctx.fillStyle = '#0F0E0D';
    ctx.beginPath();
    ctx.ellipse(1.3 * scale, 0, 1.3 * scale, 3.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 252, 244, 0.92)';
    ctx.beginPath();
    ctx.arc(0, -1.2 * scale, 1.0 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawKaguyaBrushStroke(
      ctx,
      [
        { x: 18 * scale, y: 5 * scale, p: 0.8 },
        { x: -4 * scale, y: 7 * scale, p: 0.45 },
        { x: -28 * scale, y: 12 * scale, p: 0.12 },
      ],
      1.6 * scale,
      0.7,
      0,
      '20, 18, 17',
      boilTick,
      0.28
    );

    ctx.restore();
    ctx.restore();

    if (isWet && !isSwimmingInRiver) {
      for (let d = 0; d < 3; d++) {
        const dy = ((elapsedSeconds * 3 + d * 0.35) % 1) * 26 * scale;
        ctx.fillStyle = 'rgba(130, 170, 200, 0.55)';
        ctx.beginPath();
        ctx.arc(
          catScreenX - (16 + d * 14) * scale,
          baseY + 18 * scale + dy,
          1.6 * scale,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
  }

  // 7. Spirit Lotus / Guiding Firefly Magic + Lone Tragic Petal
  if (t < 31.2) {
    const travelEmberX = blackHeadScreen.x + (38 + Math.sin(elapsedSeconds * 3.1) * 7) * scale;
    const travelEmberY =
      (isSwimmingInRiver ? groundY - 46 * scale : blackHeadScreen.y - 12 * scale) +
      Math.cos(elapsedSeconds * 3.8) * 6 * scale;
    const offerX = (blackHeadScreen.x + femaleHeadPos.headX) * 0.5;
    const offerY = groundY - (56 + magicBloomT * 14) * scale + Math.sin(elapsedSeconds * 2.5) * 4 * scale;
    const emberX = lerp(travelEmberX, offerX, giftT);
    const emberY = lerp(travelEmberY, offerY, giftT);
    const emberAlpha = 1 - smoothstep(28.5, 31.0, t);

    drawSpiritLotusEmber(
      ctx,
      emberX,
      emberY,
      scale,
      magicBloomT,
      emberAlpha,
      elapsedSeconds,
      boilTick
    );
  }

  // Swirling magic fireflies & dissolving moon-petals
  drawMagicFirefliesAndPetals(
    ctx,
    (catScreenX + femaleHeadPos.screenX) * 0.5,
    groundY - 58 * scale,
    scale,
    magicBloomT,
    sunmyDissolveT,
    elapsedSeconds
  );

  // One single luminous petal drifting gently to rest beside his paws after she vanishes
  if (t >= 34.4) {
    const driftT = smoothstep(34.4, 38.4, t);
    const px = lerp(
      femaleHeadPos.headX,
      catScreenX + 46 * scale,
      driftT
    ) + (1 - driftT) * Math.sin(elapsedSeconds * 3.2) * 18 * scale;
    const py = lerp(groundY - 96 * scale, groundY - 1 * scale, driftT * driftT);

    ctx.save();
    const glow = ctx.createRadialGradient(px, py, 1, px, py, 18 * scale);
    glow.addColorStop(0, 'rgba(255, 232, 224, 0.85)');
    glow.addColorStop(0.55, 'rgba(242, 182, 186, 0.35)');
    glow.addColorStop(1, 'rgba(242, 182, 186, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(px, py, 18 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(px, py);
    ctx.rotate(lerp(Math.sin(elapsedSeconds * 2) * 0.5, -0.18, driftT));
    ctx.fillStyle = 'rgba(250, 212, 214, 0.96)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 6.2 * scale, 3.0 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // River splashes
  const splashProgress =
    t < TRAVEL_DURATION && catWorldX >= RIVER_ENTRY_X && catWorldX <= RIVER_ENTRY_X + 165
      ? (catWorldX - RIVER_ENTRY_X) / 165
      : 0;
  if (splashProgress > 0 || isSwimmingInRiver) {
    drawRiverSplashes(
      ctx,
      toScreenX(RIVER_ENTRY_X),
      groundY,
      scale,
      splashProgress,
      isSwimmingInRiver,
      catScreenX,
      elapsedSeconds
    );
  }

  // 8. Dramatic Poetic Story Speech Bubbles
  const hisOfferBubbleAlpha =
    t >= 20.8 && t <= 23.8
      ? Math.min(smoothstep(20.8, 21.4, t), 1 - smoothstep(23.1, 23.8, t))
      : 0;
  if (hisOfferBubbleAlpha > 0.01) {
    drawKaguyaSpeechBubble(
      ctx,
      blackHeadScreen.x - 42 * scale,
      blackHeadScreen.y - 78 * scale,
      blackHeadScreen.x - 4 * scale,
      blackHeadScreen.y - 26 * scale,
      'Para ti...',
      hisOfferBubbleAlpha,
      scale,
      boilTick,
      false
    );
  }

  const herRomanceBubbleAlpha =
    t >= 23.9 && t <= 27.1
      ? Math.min(smoothstep(23.9, 24.5, t), 1 - smoothstep(26.4, 27.1, t))
      : 0;
  if (herRomanceBubbleAlpha > 0.01) {
    drawKaguyaSpeechBubble(
      ctx,
      femaleHeadPos.headX + 24 * scale,
      femaleHeadPos.headY - 78 * scale,
      femaleHeadPos.headX - 2 * scale,
      femaleHeadPos.headY - 30 * scale,
      '¿Viniste?',
      herRomanceBubbleAlpha,
      scale,
      boilTick,
      false
    );
  }

  const herFarewellBubbleAlpha =
    t >= 28.0 && t <= 31.4
      ? Math.min(smoothstep(28.0, 28.6, t), 1 - smoothstep(30.7, 31.4, t))
      : 0;
  if (herFarewellBubbleAlpha > 0.01) {
    drawKaguyaSpeechBubble(
      ctx,
      femaleHeadPos.headX + 26 * scale,
      femaleHeadPos.headY - 82 * scale,
      femaleHeadPos.headX - 2 * scale,
      femaleHeadPos.headY - 30 * scale,
      'Debo irme...',
      herFarewellBubbleAlpha,
      scale,
      boilTick,
      true
    );
  }

  const hisCryBubbleAlpha =
    t >= 31.5 && t <= 35.6
      ? Math.min(smoothstep(31.5, 32.1, t), 1 - smoothstep(34.8, 35.6, t))
      : 0;
  if (hisCryBubbleAlpha > 0.01) {
    drawKaguyaSpeechBubble(
      ctx,
      blackHeadScreen.x - 40 * scale,
      blackHeadScreen.y - 82 * scale,
      blackHeadScreen.x - 4 * scale,
      blackHeadScreen.y - 26 * scale,
      '¡Sunmy!',
      hisCryBubbleAlpha,
      scale,
      boilTick,
      true
    );
  }

  // 9. Soft rice-paper mist crossfade at loop end/start
  let fadeMist = 0;
  if (t > TOTAL_DURATION - 1.4) {
    fadeMist = smoothstep(TOTAL_DURATION - 1.4, TOTAL_DURATION, t);
  } else if (t < 0.8) {
    fadeMist = 1 - smoothstep(0.0, 0.8, t);
  }
  if (fadeMist > 0.005) {
    ctx.save();
    ctx.fillStyle = `rgba(250, 246, 238, ${fadeMist.toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}
