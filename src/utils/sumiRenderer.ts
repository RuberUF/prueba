import { CAT_POSES, EYE_TONES, WATERCOLOR_THEMES } from '../data/catGeometry';
import { CalligraphicStroke, StrokePoint, StudioConfig } from '../types/studio';

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 750;

let cachedPaperCanvas: HTMLCanvasElement | null = null;

function getPaperGrainCanvas(): HTMLCanvasElement {
  if (cachedPaperCanvas) return cachedPaperCanvas;
  const off = document.createElement('canvas');
  off.width = 400;
  off.height = 400;
  const octx = off.getContext('2d');
  if (!octx) return off;

  // Deterministic PRNG for organic washi / Xuan paper fibers
  let seed = 4219;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  octx.clearRect(0, 0, 400, 400);

  // Fine mineral grain speckles
  for (let i = 0; i < 3200; i++) {
    const x = rand() * 400;
    const y = rand() * 400;
    const alpha = 0.015 + rand() * 0.025;
    octx.fillStyle = rand() > 0.5 ? `rgba(110, 98, 82, ${alpha})` : `rgba(255, 255, 255, ${alpha * 1.4})`;
    octx.fillRect(x, y, 1.2, 1.2);
  }

  // Delicate rice paper mulberry fibers
  octx.lineWidth = 0.7;
  for (let i = 0; i < 190; i++) {
    const x = rand() * 400;
    const y = rand() * 400;
    const len = 8 + rand() * 22;
    const angle = rand() * Math.PI * 2;
    const cx = x + Math.cos(angle + 0.35) * (len * 0.5);
    const cy = y + Math.sin(angle + 0.35) * (len * 0.5);
    const ex = x + Math.cos(angle) * len;
    const ey = y + Math.sin(angle) * len;
    octx.strokeStyle = rand() > 0.35 ? 'rgba(130, 114, 92, 0.055)' : 'rgba(255, 252, 245, 0.09)';
    octx.beginPath();
    octx.moveTo(x, y);
    octx.quadraticCurveTo(cx, cy, ex, ey);
    octx.stroke();
  }

  cachedPaperCanvas = off;
  return off;
}

/** Catmull-Rom spline subdivision for smooth Grease Pencil curves */
export function interpolateCatmullRom(points: StrokePoint[], stepsPerSegment = 14): StrokePoint[] {
  if (points.length < 2) return points;
  if (points.length === 2) {
    const out: StrokePoint[] = [];
    for (let i = 0; i <= stepsPerSegment; i++) {
      const t = i / stepsPerSegment;
      out.push({
        x: points[0].x + (points[1].x - points[0].x) * t,
        y: points[0].y + (points[1].y - points[0].y) * t,
        p: points[0].p + (points[1].p - points[0].p) * t,
      });
    }
    return out;
  }

  const padded: StrokePoint[] = [points[0], ...points, points[points.length - 1]];
  const result: StrokePoint[] = [];

  for (let i = 1; i < padded.length - 2; i++) {
    const p0 = padded[i - 1];
    const p1 = padded[i];
    const p2 = padded[i + 1];
    const p3 = padded[i + 2];

    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      const p = p1.p + (p2.p - p1.p) * t;
      result.push({ x, y, p });
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

function drawSmoothClosedPolygon(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  if (pts.length < 3) return;
  ctx.beginPath();
  const midFirstX = (pts[pts.length - 1].x + pts[0].x) / 2;
  const midFirstY = (pts[pts.length - 1].y + pts[0].y) / 2;
  ctx.moveTo(midFirstX, midFirstY);
  for (let i = 0; i < pts.length; i++) {
    const next = pts[(i + 1) % pts.length];
    const midX = (pts[i].x + next.x) / 2;
    const midY = (pts[i].y + next.y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  ctx.closePath();
}

function drawCalligraphicStroke(
  ctx: CanvasRenderingContext2D,
  stroke: CalligraphicStroke,
  config: StudioConfig,
  progress = 1,
  overrideColor?: string
) {
  const dense = interpolateCatmullRom(stroke.points, 16);
  const maxIndex = Math.max(2, Math.floor(dense.length * Math.min(1, Math.max(0.02, progress))));
  const pts = dense.slice(0, maxIndex);
  if (pts.length < 2) return;

  const total = pts.length;
  const taperStart = stroke.taperStart ?? 0.35;
  const taperEnd = stroke.taperEnd ?? 0.25;
  const widthScale = config.strokeWidthMultiplier;
  const dryBias = (stroke.dryBrushBias ?? 0.45) * config.dryBrushIntensity;

  const leftEdge: { x: number; y: number }[] = [];
  const rightEdge: { x: number; y: number }[] = [];

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
    if (u < 0.14) {
      taper = taperStart + (1 - taperStart) * (u / 0.14);
    } else if (u > 0.84) {
      taper = taperEnd + (1 - taperEnd) * ((1 - u) / 0.16);
    }

    const halfW = Math.max(0.35, (stroke.baseWidth * widthScale * curr.p * taper) / 2);
    leftEdge.push({ x: curr.x + nx * halfW, y: curr.y + ny * halfW });
    rightEdge.push({ x: curr.x - nx * halfW, y: curr.y - ny * halfW });
  }

  ctx.save();
  // Subtle ink bleed halo on Xuan paper
  if (!overrideColor) {
    ctx.beginPath();
    ctx.moveTo(leftEdge[0].x, leftEdge[0].y);
    for (let i = 1; i < leftEdge.length; i++) ctx.lineTo(leftEdge[i].x, leftEdge[i].y);
    for (let i = rightEdge.length - 1; i >= 0; i--) ctx.lineTo(rightEdge[i].x, rightEdge[i].y);
    ctx.closePath();
    ctx.fillStyle = `rgba(22, 20, 18, ${stroke.inkOpacity * 0.14})`;
    ctx.filter = 'blur(2.2px)';
    ctx.fill();
    ctx.filter = 'none';
  }

  // Primary sumi brush body
  ctx.beginPath();
  ctx.moveTo(leftEdge[0].x, leftEdge[0].y);
  for (let i = 1; i < leftEdge.length; i++) ctx.lineTo(leftEdge[i].x, leftEdge[i].y);
  for (let i = rightEdge.length - 1; i >= 0; i--) ctx.lineTo(rightEdge[i].x, rightEdge[i].y);
  ctx.closePath();

  if (overrideColor) {
    ctx.fillStyle = overrideColor;
    ctx.globalAlpha = stroke.inkOpacity;
  } else {
    ctx.fillStyle = `rgba(18, 17, 16, ${stroke.inkOpacity})`;
  }
  ctx.fill();

  // Dry-brush (pincel seco / feibai) texture streaks along main calligraphic strokes
  if (dryBias > 0.08 && stroke.baseWidth >= 6 && !overrideColor) {
    const numBristles = Math.round(2 + dryBias * 4);
    ctx.lineCap = 'round';
    for (let b = 0; b < numBristles; b++) {
      const offsetRatio = ((b + 0.5) / numBristles - 0.5) * 1.15;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < total; i += 2) {
        const curr = pts[i];
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(total - 1, i + 1)];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const halfW = (stroke.baseWidth * widthScale * curr.p) / 2;

        // Deterministic organic skip for paper tooth
        const wave = Math.sin(i * 0.37 + b * 2.1);
        if (wave > -0.25 * (1 - dryBias * 0.5)) {
          const px = curr.x + nx * halfW * offsetRatio;
          const py = curr.y + ny * halfW * offsetRatio;
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else {
            ctx.lineTo(px, py);
          }
        } else {
          started = false;
        }
      }
      ctx.strokeStyle = `rgba(249, 246, 238, ${0.14 + dryBias * 0.28})`;
      ctx.lineWidth = Math.max(0.7, stroke.baseWidth * 0.075);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawHankoSeal(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.025);

  const size = 46;
  const half = size / 2;

  // Vermilion cinnabar stamp frame
  ctx.fillStyle = 'rgba(176, 38, 28, 0.92)';
  ctx.beginPath();
  ctx.roundRect(-half, -half, size, size, 3);
  ctx.fill();

  // Inner carved paper cutout border
  ctx.strokeStyle = 'rgba(251, 247, 239, 0.92)';
  ctx.lineWidth = 2.1;
  ctx.strokeRect(-half + 4.5, -half + 4.5, size - 9, size - 9);

  // Stylized imperial seal characters 墨猫 (Ink Cat)
  ctx.fillStyle = '#FBF7EF';
  ctx.font = '600 15px "Cormorant Garamond", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('墨', 0, -8.5);
  ctx.fillText('猫', 0, 9.5);

  // Subtle weathered stamp noise
  ctx.fillStyle = 'rgba(251, 247, 239, 0.24)';
  ctx.fillRect(-16, -4, 3, 2);
  ctx.fillRect(11, 12, 4, 2);
  ctx.fillRect(-8, 17, 2, 3);
  ctx.restore();
}

function drawImperialEye(
  ctx: CanvasRenderingContext2D,
  eye: { cx: number; cy: number; rx: number; ry: number; angle: number; pupilOffsetX?: number; pupilOffsetY?: number },
  toneKey: StudioConfig['eyeTone']
) {
  const tone = EYE_TONES[toneKey];
  ctx.save();
  ctx.translate(eye.cx, eye.cy);
  ctx.rotate(eye.angle);

  // Almond eye outline clip
  ctx.beginPath();
  ctx.moveTo(-eye.rx, 0);
  ctx.quadraticCurveTo(0, -eye.ry * 1.45, eye.rx, 0);
  ctx.quadraticCurveTo(0, eye.ry * 1.45, -eye.rx, 0);
  ctx.closePath();

  // Soft outer rim
  ctx.strokeStyle = tone.rim;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.save();
  ctx.clip();

  // Iris gradient
  const grad = ctx.createRadialGradient(0, -eye.ry * 0.15, 1, 0, 0, eye.rx * 1.1);
  grad.addColorStop(0, tone.inner);
  grad.addColorStop(0.65, tone.fill);
  grad.addColorStop(1, tone.rim);
  ctx.fillStyle = grad;
  ctx.fillRect(-eye.rx - 2, -eye.ry - 2, eye.rx * 2 + 4, eye.ry * 2 + 4);

  // Vertical feline slit pupil
  const px = eye.pupilOffsetX ?? 0;
  const py = eye.pupilOffsetY ?? 0;
  ctx.fillStyle = '#0F0E0D';
  ctx.beginPath();
  ctx.ellipse(px, py, Math.max(1.8, eye.rx * 0.2), eye.ry * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tiny luminous paper glint
  ctx.fillStyle = 'rgba(255, 252, 244, 0.88)';
  ctx.beginPath();
  ctx.arc(px - eye.rx * 0.22, -eye.ry * 0.28, Math.max(1.2, eye.rx * 0.13), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.restore();
}

export function renderStudioCanvas(
  ctx: CanvasRenderingContext2D,
  config: StudioConfig,
  freehandStrokes: CalligraphicStroke[],
  strokeAnimProgress = 1
) {
  const pose = CAT_POSES[config.pose];
  const theme = WATERCOLOR_THEMES[config.watercolorTheme];

  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // 1. Archival Xuan Paper Base
  const bgGrad = ctx.createRadialGradient(
    CANVAS_WIDTH * 0.5,
    CANVAS_HEIGHT * 0.45,
    80,
    CANVAS_WIDTH * 0.5,
    CANVAS_HEIGHT * 0.5,
    680
  );
  bgGrad.addColorStop(0, theme.paperBg);
  bgGrad.addColorStop(1, theme.paperWarmth);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // 2. Minimalist Watercolor Wash Background (Layer: Acuarela_Fondo)
  if (config.layers.watercolorBg && config.watercolorOpacity > 0.01) {
    ctx.save();
    ctx.globalAlpha = config.watercolorOpacity;

    pose.watercolorCenters.forEach((bloom, idx) => {
      ctx.save();
      ctx.translate(bloom.x, bloom.y);
      ctx.rotate(bloom.rot);
      ctx.scale(1, bloom.ry / bloom.rx);

      const washColor =
        idx === 0 ? theme.primaryWash : idx === 1 ? theme.secondaryWash : theme.accentWash;

      const grad = ctx.createRadialGradient(0, 0, bloom.rx * 0.12, 0, 0, bloom.rx);
      grad.addColorStop(0, washColor);
      grad.addColorStop(0.72, washColor);
      grad.addColorStop(0.92, 'rgba(255,255,255,0)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, bloom.rx, 0, Math.PI * 2);
      ctx.fill();

      // Subtle watercolor drying bloom ring
      ctx.strokeStyle = washColor;
      ctx.lineWidth = 2.4;
      ctx.globalAlpha = config.watercolorOpacity * 0.28;
      ctx.beginPath();
      ctx.arc(0, 0, bloom.rx * 0.78, 0.2, Math.PI * 1.65);
      ctx.stroke();

      ctx.restore();
    });

    // Optional soft watercolor moon disc for Moon pose
    if (pose.moonPos) {
      const m = pose.moonPos;
      const mGrad = ctx.createRadialGradient(m.x, m.y, m.r * 0.25, m.x, m.y, m.r * 1.15);
      mGrad.addColorStop(0, 'rgba(255, 253, 248, 0.72)');
      mGrad.addColorStop(0.85, 'rgba(255, 252, 245, 0.45)');
      mGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = mGrad;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 1.15, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // 3. Paper texture grain overlay (under ink so ink looks absorbed into paper)
  if (config.paperTextureIntensity > 0.02) {
    ctx.save();
    ctx.globalAlpha = config.paperTextureIntensity;
    const grain = getPaperGrainCanvas();
    const pattern = ctx.createPattern(grain, 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    ctx.restore();
  }

  // 4. Bamboo & Moon Ring Strokes (Background calligraphy)
  if (config.layers.bambooSprig) {
    const bgStrokes = pose.strokes.filter((s) => s.layer === 'bamboo' || s.layer === 'moon_ring');
    bgStrokes.forEach((s) => {
      drawCalligraphicStroke(
        ctx,
        s,
        config,
        strokeAnimProgress,
        s.layer === 'bamboo' ? theme.bambooTint : undefined
      );
    });
  }

  // 5. Sumi Ink Wash Silhouette Fill (Layer: Relleno_Sumi)
  if (config.layers.inkWashFill) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, strokeAnimProgress * 1.25);
    pose.washPolygons.forEach((poly) => {
      ctx.save();
      drawSmoothClosedPolygon(ctx, poly.points);
      if (poly.blur) {
        ctx.filter = `blur(${poly.blur}px)`;
      }
      if (poly.tone === 'deep') {
        ctx.fillStyle = `rgba(19, 18, 17, ${poly.opacity})`;
      } else if (poly.tone === 'mid') {
        ctx.fillStyle = `rgba(38, 36, 33, ${poly.opacity})`;
      } else if (poly.tone === 'highlight') {
        ctx.fillStyle = `rgba(82, 78, 72, ${poly.opacity})`;
      } else {
        ctx.fillStyle = `rgba(60, 58, 54, ${poly.opacity})`;
      }
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();
  }

  // 6. Primary Calligraphic Brush Contours & Whiskers (Layer: Trazos_Caligrafía)
  if (config.layers.brushContours) {
    const catStrokes = pose.strokes.filter((s) => s.layer === 'contour' || s.layer === 'whiskers');
    const totalStrokes = catStrokes.length;
    catStrokes.forEach((stroke, idx) => {
      // Stagger stroke reveal during calligraphic animation
      let localProgress = 1;
      if (strokeAnimProgress < 1) {
        const start = (idx / totalStrokes) * 0.85;
        const end = start + 0.25;
        localProgress = Math.max(0, Math.min(1, (strokeAnimProgress - start) / (end - start)));
      }
      if (localProgress > 0.01) {
        drawCalligraphicStroke(ctx, stroke, config, localProgress);
      }
    });
  }

  // 7. Imperial Eyes & Subtle Nose Accent (Layer: Ojos_Imperial)
  if (config.layers.imperialEyes && strokeAnimProgress > 0.45) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, (strokeAnimProgress - 0.45) / 0.3);
    pose.eyes.forEach((eye) => drawImperialEye(ctx, eye, config.eyeTone));

    if (pose.nose) {
      ctx.save();
      ctx.translate(pose.nose.x, pose.nose.y);
      ctx.scale(pose.nose.scale, pose.nose.scale);
      ctx.fillStyle = 'rgba(72, 64, 58, 0.72)';
      ctx.beginPath();
      ctx.moveTo(-4.5, -2);
      ctx.lineTo(4.5, -2);
      ctx.lineTo(0, 3.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // 8. User Freehand Sumi-e Brush Strokes
  freehandStrokes.forEach((stroke) => {
    drawCalligraphicStroke(ctx, stroke, config, 1);
  });

  // 9. Traditional Vermilion Hanko Seal (Layer: Sello_Hanko)
  if (config.layers.hankoSeal) {
    drawHankoSeal(ctx, pose.hankoPos.x, pose.hankoPos.y);
  }

  // 10. Blender 2D Grease Pencil Bezier Guides Overlay (Layer: Guías_Bézier)
  if (config.layers.bezierGuides) {
    ctx.save();
    const visibleGuideStrokes = pose.strokes.filter((s) => {
      if (s.layer === 'bamboo' || s.layer === 'moon_ring') return config.layers.bambooSprig;
      return config.layers.brushContours;
    });

    visibleGuideStrokes.forEach((stroke, sIdx) => {
      // Polyline wireframe hull
      ctx.beginPath();
      stroke.points.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.strokeStyle = 'rgba(217, 70, 39, 0.55)';
      ctx.lineWidth = 1.1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Grease Pencil vertex control dots
      stroke.points.forEach((pt, pIdx) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pIdx === 0 ? 4 : 2.8, 0, Math.PI * 2);
        ctx.fillStyle = pIdx === 0 ? '#B91C1C' : '#FBF9F5';
        ctx.fill();
        ctx.strokeStyle = '#9A3412';
        ctx.lineWidth = 1.25;
        ctx.stroke();
      });

      // Stroke order number near first control point
      const first = stroke.points[0];
      ctx.fillStyle = '#9A3412';
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.fillText(`GP${sIdx + 1}`, first.x + 7, first.y - 6);
    });
    ctx.restore();
  }
}

/** Generate downloadable vector SVG matching current studio pose and parameters */
export function generateSvgExport(config: StudioConfig, freehandStrokes: CalligraphicStroke[]): string {
  const pose = CAT_POSES[config.pose];
  const theme = WATERCOLOR_THEMES[config.watercolorTheme];
  const eyeTone = EYE_TONES[config.eyeTone];

  const washCircles = config.layers.watercolorBg
    ? pose.watercolorCenters
        .map((b, idx) => {
          const color = idx === 0 ? '#84A598' : idx === 1 ? '#A8B6A9' : '#6E807A';
          return `<ellipse cx="${b.x}" cy="${b.y}" rx="${b.rx}" ry="${b.ry}" transform="rotate(${(b.rot * 180) / Math.PI} ${b.x} ${b.y})" fill="${color}" fill-opacity="${(config.watercolorOpacity * 0.25).toFixed(2)}" />`;
        })
        .join('\n    ')
    : '';

  const fillPaths = config.layers.inkWashFill
    ? pose.washPolygons
        .map((poly) => {
          const d =
            poly.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
          const color =
            poly.tone === 'highlight' ? '#524E48' : poly.tone === 'soft' ? '#3C3A36' : '#131211';
          return `<path d="${d}" fill="${color}" fill-opacity="${poly.opacity}" />`;
        })
        .join('\n    ')
    : '';

  const allStrokes = [
    ...pose.strokes.filter((s) => {
      if (s.layer === 'bamboo' || s.layer === 'moon_ring') return config.layers.bambooSprig;
      return config.layers.brushContours;
    }),
    ...freehandStrokes,
  ];

  const strokePaths = allStrokes
    .map((s) => {
      const dense = interpolateCatmullRom(s.points, 8);
      const d = dense.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      const col = s.layer === 'bamboo' ? theme.bambooTint : '#121110';
      return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${(s.baseWidth * config.strokeWidthMultiplier).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${s.inkOpacity}" />`;
    })
    .join('\n    ');

  const eyeEls = config.layers.imperialEyes
    ? pose.eyes
        .map(
          (e) =>
            `<g transform="translate(${e.cx} ${e.cy}) rotate(${(e.angle * 180) / Math.PI})">
      <ellipse cx="0" cy="0" rx="${e.rx}" ry="${e.ry}" fill="${eyeTone.fill}" stroke="${eyeTone.rim}" stroke-width="1.5" />
      <ellipse cx="${e.pupilOffsetX ?? 0}" cy="0" rx="${(e.rx * 0.2).toFixed(1)}" ry="${(e.ry * 0.85).toFixed(1)}" fill="#0F0E0D" />
    </g>`
        )
        .join('\n    ')
    : '';

  const hanko = config.layers.hankoSeal
    ? `<g transform="translate(${pose.hankoPos.x} ${pose.hankoPos.y}) rotate(-1.5)">
      <rect x="-23" y="-23" width="46" height="46" rx="3" fill="#B0261C" />
      <rect x="-18.5" y="-18.5" width="37" height="37" fill="none" stroke="#FBF7EF" stroke-width="2" />
      <text x="0" y="-4" text-anchor="middle" fill="#FBF7EF" font-size="14" font-family="serif">墨</text>
      <text x="0" y="13" text-anchor="middle" fill="#FBF7EF" font-size="14" font-family="serif">猫</text>
    </g>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}">
  <rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${theme.paperBg}" />
  <g id="Acuarela_Fondo">
    ${washCircles}
  </g>
  <g id="Relleno_Sumi">
    ${fillPaths}
  </g>
  <g id="Trazos_Caligrafia">
    ${strokePaths}
  </g>
  <g id="Ojos_Imperial">
    ${eyeEls}
  </g>
  <g id="Sello_Hanko">
    ${hanko}
  </g>
</svg>`;
}
