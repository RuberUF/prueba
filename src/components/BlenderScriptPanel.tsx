import React, { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { StudioConfig } from '../types/studio';
import { generateBlenderPythonScript } from '../utils/blenderScriptGenerator';

interface BlenderScriptPanelProps {
  config: StudioConfig;
  onDownloadPython: () => void;
}

export const BlenderScriptPanel: React.FC<BlenderScriptPanelProps> = ({
  config,
  onDownloadPython,
}) => {
  const [copied, setCopied] = useState(false);
  const script = useMemo(() => generateBlenderPythonScript(config), [config]);
  const lineCount = useMemo(() => script.split('\n').length, [script]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback if clipboard API is restricted
      setCopied(false);
    }
  };

  return (
    <section id="script-blender" className="py-16 lg:py-24 border-t border-[#E5DFD3]">
      <div className="max-w-[1360px] mx-auto px-6 lg:px-10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-widest text-[#78716C] mb-2">
              Código Generado en Tiempo Real · Python bpy
            </p>
            <h2 className="font-serif text-3xl lg:text-4xl font-medium text-[#1C1917] [text-wrap:balance]">
              Script directo para Blender 2D Grease Pencil
            </h2>
            <p className="mt-3 text-sm text-[#57534E] leading-relaxed">
              Este script se actualiza automáticamente con tus ajustes de pose, grosor de pincel,
              pincel seco y acuarela. Pégalo en la pestaña Scripting de Blender y pulsa{' '}
              <span className="font-mono text-xs text-[#1C1917]">Alt + P</span> para construir el
              gato negro 2D completo.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md border border-[#D6CEBE] bg-[#FBF9F5] text-[#1C1917] hover:bg-[#F3EFE6] transition-colors whitespace-nowrap cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#14532D]" aria-hidden="true" />
                  <span>Script copiado</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Copiar código</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onDownloadPython}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md bg-[#1C1917] text-[#FBF9F5] hover:bg-[#9A3412] transition-colors whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Descargar .py</span>
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-[#292524] bg-[#1C1917] text-[#EFE9DA] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#141210] border-b border-[#292524] text-xs font-mono text-[#A8A29E]">
            <span>kuro_imperial_{config.pose}.py</span>
            <span className="tabular-nums">{lineCount} líneas · Blender 3.6 / 4.x</span>
          </div>
          <pre className="p-4 sm:p-6 text-xs font-mono leading-relaxed overflow-x-auto max-h-[460px] text-[#E7E1D6]">
            <code>{script}</code>
          </pre>
        </div>
      </div>
    </section>
  );
};
