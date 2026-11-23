import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { CAT_POSES, EYE_TONES, WATERCOLOR_THEMES } from '../data/catGeometry';
import {
  CatPoseId,
  EyeToneId,
  LayerVisibility,
  StudioConfig,
  WatercolorThemeId,
} from '../types/studio';

interface StudioControlsProps {
  config: StudioConfig;
  onChange: (updater: (prev: StudioConfig) => StudioConfig) => void;
}

const LAYER_ITEMS: { key: keyof LayerVisibility; blenderName: string; desc: string }[] = [
  { key: 'watercolorBg', blenderName: 'Acuarela_Fondo', desc: 'Veladuras minerales' },
  { key: 'inkWashFill', blenderName: 'Relleno_Sumi', desc: 'Aguada corporal' },
  { key: 'brushContours', blenderName: 'Trazos_Caligrafía', desc: 'Pincelada maestra' },
  { key: 'imperialEyes', blenderName: 'Ojos_Imperial', desc: 'Iris y pupila vertical' },
  { key: 'bambooSprig', blenderName: 'Bambú_Minimal', desc: 'Vegetación / Luna' },
  { key: 'hankoSeal', blenderName: 'Sello_Hanko', desc: 'Estampa bermellón 墨猫' },
  { key: 'bezierGuides', blenderName: 'Guías_Bézier', desc: 'Vértices GPencil' },
];

export const StudioControls: React.FC<StudioControlsProps> = ({ config, onChange }) => {
  const poses: CatPoseId[] = ['seated', 'prowling', 'moon'];
  const themes: WatercolorThemeId[] = ['jade', 'celestial', 'vermilion', 'xuan'];
  const eyeTones: EyeToneId[] = ['amber', 'jade', 'gold'];

  return (
    <aside
      aria-label="Inspector de Blender 2D"
      className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-5 lg:p-6 flex flex-col gap-6"
    >
      {/* Pose Selector */}
      <div>
        <div className="flex items-baseline justify-between mb-2.5">
          <h2 className="text-sm font-semibold text-[#1C1917]">Pose Imperial</h2>
          <span className="text-xs text-[#78716C] font-mono">Objeto 2D</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#EAE3D5] rounded-md">
          {poses.map((poseId) => {
            const active = config.pose === poseId;
            const shortLabel =
              poseId === 'seated' ? 'Sedente' : poseId === 'prowling' ? 'Acecho' : 'Lunar';
            return (
              <button
                key={poseId}
                type="button"
                onClick={() => onChange((prev) => ({ ...prev, pose: poseId }))}
                className={`px-2.5 py-2 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#FBF9F5] text-[#1C1917] shadow-xs'
                    : 'text-[#57534E] hover:text-[#1C1917]'
                }`}
              >
                {shortLabel}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-[#57534E] leading-relaxed">
          {CAT_POSES[config.pose].subtitle}
        </p>
      </div>

      <div className="border-t border-[#E5DFD3]" />

      {/* Watercolor Wash Theme */}
      <div>
        <h2 className="text-sm font-semibold text-[#1C1917] mb-2.5">Acuarela de Fondo</h2>
        <div className="grid grid-cols-2 gap-2">
          {themes.map((tId) => {
            const t = WATERCOLOR_THEMES[tId];
            const active = config.watercolorTheme === tId;
            return (
              <button
                key={tId}
                type="button"
                onClick={() => onChange((prev) => ({ ...prev, watercolorTheme: tId }))}
                className={`flex items-center gap-2.5 px-3 py-2 text-left rounded-md border transition-colors cursor-pointer ${
                  active
                    ? 'border-[#9A3412] bg-[#FBF9F5]'
                    : 'border-[#DDD5C5] bg-[#FBF9F5]/60 hover:bg-[#FBF9F5]'
                }`}
              >
                <span
                  className="w-4 h-4 rounded-full border border-[#D6CEBE] shrink-0"
                  style={{ backgroundColor: t.primaryWash }}
                  aria-hidden="true"
                />
                <span className="text-xs font-medium text-[#1C1917] truncate">{t.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-[#E5DFD3]" />

      {/* Blender Brush Parameters */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-[#1C1917]">Parámetros de Pincel</h2>

        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <label htmlFor="stroke-width" className="text-[#44403C] font-medium">
              Grosor de Trazo
            </label>
            <span className="font-mono tabular-nums text-[#57534E]">
              {config.strokeWidthMultiplier.toFixed(2)}×
            </span>
          </div>
          <input
            id="stroke-width"
            type="range"
            min="0.65"
            max="1.5"
            step="0.05"
            value={config.strokeWidthMultiplier}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                strokeWidthMultiplier: parseFloat(e.target.value),
              }))
            }
            className="w-full accent-[#9A3412] cursor-pointer"
          />
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <label htmlFor="dry-brush" className="text-[#44403C] font-medium">
              Pincel Seco (Feibai)
            </label>
            <span className="font-mono tabular-nums text-[#57534E]">
              {Math.round(config.dryBrushIntensity * 100)}%
            </span>
          </div>
          <input
            id="dry-brush"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={config.dryBrushIntensity}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                dryBrushIntensity: parseFloat(e.target.value),
              }))
            }
            className="w-full accent-[#9A3412] cursor-pointer"
          />
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <label htmlFor="wash-opacity" className="text-[#44403C] font-medium">
              Difusión de Acuarela
            </label>
            <span className="font-mono tabular-nums text-[#57534E]">
              {Math.round(config.watercolorOpacity * 100)}%
            </span>
          </div>
          <input
            id="wash-opacity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={config.watercolorOpacity}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                watercolorOpacity: parseFloat(e.target.value),
              }))
            }
            className="w-full accent-[#9A3412] cursor-pointer"
          />
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <label htmlFor="paper-grain" className="text-[#44403C] font-medium">
              Fibra Papel Xuan
            </label>
            <span className="font-mono tabular-nums text-[#57534E]">
              {Math.round(config.paperTextureIntensity * 100)}%
            </span>
          </div>
          <input
            id="paper-grain"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={config.paperTextureIntensity}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                paperTextureIntensity: parseFloat(e.target.value),
              }))
            }
            className="w-full accent-[#9A3412] cursor-pointer"
          />
        </div>
      </div>

      <div className="border-t border-[#E5DFD3]" />

      {/* Eye Color */}
      <div>
        <h2 className="text-sm font-semibold text-[#1C1917] mb-2.5">Mirada Imperial</h2>
        <div className="grid grid-cols-3 gap-1.5">
          {eyeTones.map((toneId) => {
            const tone = EYE_TONES[toneId];
            const active = config.eyeTone === toneId;
            return (
              <button
                key={toneId}
                type="button"
                onClick={() => onChange((prev) => ({ ...prev, eyeTone: toneId }))}
                className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? 'border-[#9A3412] bg-[#FBF9F5] text-[#1C1917]'
                    : 'border-[#DDD5C5] bg-[#FBF9F5]/60 text-[#57534E] hover:text-[#1C1917]'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: tone.fill }}
                  aria-hidden="true"
                />
                <span className="truncate">{tone.name.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-[#E5DFD3]" />

      {/* Blender Grease Pencil Layers */}
      <div>
        <div className="flex items-baseline justify-between mb-2.5">
          <h2 className="text-sm font-semibold text-[#1C1917]">Capas Grease Pencil</h2>
          <span className="text-xs text-[#78716C] font-mono">7 capas</span>
        </div>
        <ul className="flex flex-col divide-y divide-[#E5DFD3]">
          {LAYER_ITEMS.map((item) => {
            const visible = config.layers[item.key];
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() =>
                    onChange((prev) => ({
                      ...prev,
                      layers: { ...prev.layers, [item.key]: !prev.layers[item.key] },
                    }))
                  }
                  aria-pressed={visible}
                  className="w-full py-2 flex items-center justify-between gap-3 text-left hover:bg-[#EAE3D5]/50 px-1.5 rounded transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div
                      className={`text-xs font-mono truncate ${
                        visible ? 'text-[#1C1917] font-medium' : 'text-[#A8A29E] line-through'
                      }`}
                    >
                      {item.blenderName}
                    </div>
                    <div className="text-[11px] text-[#78716C] truncate">{item.desc}</div>
                  </div>
                  {visible ? (
                    <Eye className="w-4 h-4 text-[#57534E] shrink-0" aria-hidden="true" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-[#A8A29E] shrink-0" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
};
