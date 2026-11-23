import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Brush, Download, Eye, FileCode2, Play, RotateCcw, Undo2 } from 'lucide-react';
import { CAT_POSES, WATERCOLOR_THEMES } from '../data/catGeometry';
import { CalligraphicStroke, StrokePoint, StudioConfig } from '../types/studio';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  generateSvgExport,
  renderStudioCanvas,
} from '../utils/sumiRenderer';

interface StudioCanvasProps {
  config: StudioConfig;
  freehandStrokes: CalligraphicStroke[];
  onAddFreehandStroke: (stroke: CalligraphicStroke) => void;
  onUndoFreehand: () => void;
  onClearFreehand: () => void;
  onToggleBezierGuides: () => void;
}

export const StudioCanvas: React.FC<StudioCanvasProps> = ({
  config,
  freehandStrokes,
  onAddFreehandStroke,
  onUndoFreehand,
  onClearFreehand,
  onToggleBezierGuides,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [freehandMode, setFreehandMode] = useState(false);
  const [animProgress, setAnimProgress] = useState(1);
  const [isAnimating, setIsAnimating] = useState(false);
  const activePointsRef = useRef<StrokePoint[]>([]);
  const lastTimeRef = useRef<number>(0);
  const isDrawingRef = useRef(false);
  const [liveDraftStroke, setLiveDraftStroke] = useState<CalligraphicStroke | null>(null);

  const pose = CAT_POSES[config.pose];
  const theme = WATERCOLOR_THEMES[config.watercolorTheme];

  // Redraw canvas whenever config, strokes, or animation progress changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const strokesToRender = liveDraftStroke
      ? [...freehandStrokes, liveDraftStroke]
      : freehandStrokes;

    renderStudioCanvas(ctx, config, strokesToRender, animProgress);
  }, [config, freehandStrokes, liveDraftStroke, animProgress]);

  // Calligraphic stroke animation loop (simulates Blender Build Modifier)
  useEffect(() => {
    if (!isAnimating) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setAnimProgress(1);
      setIsAnimating(false);
      return;
    }

    let rafId = 0;
    const startTime = performance.now();
    const duration = 2600;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimProgress(eased);
      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setIsAnimating(false);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isAnimating]);

  const handlePlayAnimation = () => {
    setAnimProgress(0.02);
    setIsAnimating(true);
  };

  const getCanvasPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;

    const now = performance.now();
    const pts = activePointsRef.current;
    let pressure = 0.9;
    if (pts.length > 0) {
      const prev = pts[pts.length - 1];
      const dist = Math.hypot(x - prev.x, y - prev.y);
      const dt = Math.max(8, now - lastTimeRef.current);
      const velocity = dist / dt;
      // Slower brush movement = wider ink deposit; faster = drier/thinner
      pressure = Math.max(0.35, Math.min(1.3, 1.15 - velocity * 0.38));
    }
    lastTimeRef.current = now;
    return { x, y, p: pressure };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!freehandMode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    lastTimeRef.current = performance.now();
    const pt = getCanvasPoint(e);
    activePointsRef.current = [pt];
    setLiveDraftStroke({
      id: `user_${Date.now()}`,
      label: 'Trazo Libre',
      layer: 'contour',
      points: [pt],
      baseWidth: 11,
      inkOpacity: 0.92,
      taperStart: 0.35,
      taperEnd: 0.2,
      dryBrushBias: 0.75,
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!freehandMode || !isDrawingRef.current) return;
    const pt = getCanvasPoint(e);
    const prev = activePointsRef.current[activePointsRef.current.length - 1];
    if (prev && Math.hypot(pt.x - prev.x, pt.y - prev.y) < 4) return;
    activePointsRef.current = [...activePointsRef.current, pt];
    setLiveDraftStroke((curr) =>
      curr ? { ...curr, points: activePointsRef.current } : null
    );
  };

  const finishStroke = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (activePointsRef.current.length >= 2) {
      onAddFreehandStroke({
        id: `user_${Date.now()}`,
        label: 'Trazo Libre Sumi-e',
        layer: 'contour',
        points: activePointsRef.current,
        baseWidth: 11,
        inkOpacity: 0.92,
        taperStart: 0.35,
        taperEnd: 0.2,
        dryBrushBias: 0.75,
      });
    }
    activePointsRef.current = [];
    setLiveDraftStroke(null);
  };

  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `kuro_imperial_${config.pose}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleDownloadSvg = () => {
    const svgText = generateSvgExport(config, freehandStrokes);
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `kuro_imperial_${config.pose}.svg`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Top viewport action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E5DFD3]">
        <div className="flex items-center gap-2 text-xs text-[#57534E] font-medium">
          <span className="text-[#1C1917] font-semibold">{pose.title}</span>
          <span aria-hidden="true">·</span>
          <span>{theme.name}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{pose.strokes.length + freehandStrokes.length} trazos</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFreehandMode((v) => !v)}
            aria-pressed={freehandMode}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#9A3412] ${
              freehandMode
                ? 'bg-[#9A3412] text-[#FBF9F5] border-[#9A3412]'
                : 'bg-[#FBF9F5] text-[#1C1917] border-[#D6CEBE] hover:bg-[#F3EFE6]'
            }`}
          >
            <Brush className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{freehandMode ? 'Pincel Activo' : 'Pincel Libre'}</span>
          </button>

          {freehandStrokes.length > 0 && (
            <>
              <button
                type="button"
                onClick={onUndoFreehand}
                title="Deshacer último trazo"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#D6CEBE] bg-[#FBF9F5] text-[#44403C] hover:bg-[#F3EFE6] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Deshacer</span>
              </button>
              <button
                type="button"
                onClick={onClearFreehand}
                title="Limpiar trazos libres"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-[#D6CEBE] bg-[#FBF9F5] text-[#44403C] hover:bg-[#F3EFE6] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Limpiar</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handlePlayAnimation}
            disabled={isAnimating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[#D6CEBE] bg-[#FBF9F5] text-[#1C1917] hover:bg-[#F3EFE6] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isAnimating ? 'Trazando...' : 'Animar Pincel'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleBezierGuides}
            aria-pressed={config.layers.bezierGuides}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              config.layers.bezierGuides
                ? 'bg-[#1C1917] text-[#FBF9F5] border-[#1C1917]'
                : 'bg-[#FBF9F5] text-[#1C1917] border-[#D6CEBE] hover:bg-[#F3EFE6]'
            }`}
          >
            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Guías Bézier</span>
          </button>
        </div>
      </div>

      {/* Main 2D Grease Pencil Artboard */}
      <div className="relative bg-[#F3EFE6] p-3 sm:p-5 border border-[#E5DFD3] rounded-lg">
        <div className="relative w-full aspect-[4/3] overflow-hidden rounded border border-[#D6CEBE] shadow-sm bg-[#FBF9F5]">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            className={`w-full h-full block touch-none ${
              freehandMode ? 'cursor-crosshair' : 'cursor-default'
            }`}
            aria-label={`Lienzo 2D Blender Grease Pencil: ${pose.title}`}
          />
        </div>

        {/* Bottom museum caption & export actions */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs font-serif italic text-[#57534E] max-w-xl">
            {freehandMode
              ? 'Modo Pincel Libre activo: arrastra sobre el papel Xuan para añadir trazos caligráficos sensibles a la velocidad.'
              : `${pose.kanji} — ${pose.description}`}
          </p>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadPng}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[#D6CEBE] bg-[#FBF9F5] text-[#1C1917] hover:bg-[#EAE3D5] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Descargar PNG</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadSvg}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[#D6CEBE] bg-[#FBF9F5] text-[#1C1917] hover:bg-[#EAE3D5] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Exportar SVG</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
