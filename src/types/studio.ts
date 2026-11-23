export type CatPoseId = 'seated' | 'prowling' | 'moon';

export type WatercolorThemeId = 'jade' | 'celestial' | 'vermilion' | 'xuan';

export type EyeToneId = 'amber' | 'jade' | 'gold';

export interface StrokePoint {
  x: number;
  y: number;
  /** Relative pressure 0.1 to 1.4 controlling brush width */
  p: number;
}

export interface CalligraphicStroke {
  id: string;
  label: string;
  layer: 'contour' | 'whiskers' | 'bamboo' | 'moon_ring';
  points: StrokePoint[];
  baseWidth: number;
  inkOpacity: number;
  taperStart?: number;
  taperEnd?: number;
  dryBrushBias?: number;
}

export interface InkWashPolygon {
  id: string;
  points: { x: number; y: number }[];
  opacity: number;
  tone: 'deep' | 'mid' | 'soft' | 'highlight';
  blur?: number;
}

export interface CatEyeSpec {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number; // radians
  pupilOffsetX?: number;
  pupilOffsetY?: number;
}

export interface CatPoseData {
  id: CatPoseId;
  title: string;
  subtitle: string;
  kanji: string;
  description: string;
  washPolygons: InkWashPolygon[];
  strokes: CalligraphicStroke[];
  eyes: CatEyeSpec[];
  nose?: { x: number; y: number; scale: number };
  hankoPos: { x: number; y: number };
  moonPos?: { x: number; y: number; r: number };
  watercolorCenters: { x: number; y: number; rx: number; ry: number; rot: number }[];
}

export interface LayerVisibility {
  watercolorBg: boolean;
  inkWashFill: boolean;
  brushContours: boolean;
  imperialEyes: boolean;
  bambooSprig: boolean;
  hankoSeal: boolean;
  bezierGuides: boolean;
}

export interface StudioConfig {
  pose: CatPoseId;
  watercolorTheme: WatercolorThemeId;
  eyeTone: EyeToneId;
  strokeWidthMultiplier: number; // 0.6 to 1.6
  dryBrushIntensity: number; // 0 to 1
  watercolorOpacity: number; // 0 to 1
  paperTextureIntensity: number; // 0 to 1
  layers: LayerVisibility;
}

export interface WatercolorThemeSpec {
  id: WatercolorThemeId;
  name: string;
  subtitle: string;
  paperBg: string;
  paperWarmth: string;
  primaryWash: string;
  secondaryWash: string;
  accentWash: string;
  bambooTint: string;
  blenderBgRgb: [number, number, number];
  blenderWashRgb: [number, number, number];
}

export interface ReferencePlate {
  id: string;
  accession: string;
  title: string;
  poseId: CatPoseId;
  medium: string;
  dimensions: string;
  imageSrc: string;
  aspectClass: string;
  curatorialNote: string;
}
