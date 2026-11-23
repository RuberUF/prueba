import React, { useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import { REFERENCE_PLATES } from '../data/catGeometry';
import { CatPoseId, ReferencePlate } from '../types/studio';

interface ReferenceGalleryProps {
  activePose: CatPoseId;
  onSelectPose: (poseId: CatPoseId) => void;
}

export const ReferenceGallery: React.FC<ReferenceGalleryProps> = ({
  activePose,
  onSelectPose,
}) => {
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});
  const [lightboxPlate, setLightboxPlate] = useState<ReferencePlate | null>(null);

  const handleSelectAndScroll = (poseId: CatPoseId) => {
    onSelectPose(poseId);
    const el = document.getElementById('estudio');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section id="laminas" className="py-16 lg:py-24 border-t border-[#E5DFD3]">
      <div className="max-w-[1360px] mx-auto px-6 lg:px-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-widest text-[#78716C] mb-2">
              Archivo Curatorial · Referencias Imperiales
            </p>
            <h2 className="font-serif text-3xl lg:text-4xl font-medium text-[#1C1917] [text-wrap:balance]">
              Tres estudios de tinta sumi-e y acuarela sobre papel Xuan
            </h2>
          </div>
          <p className="text-sm text-[#57534E] max-w-md leading-relaxed">
            Láminas maestras que guían la proporción felina, la descarga del pincel y el equilibrio
            del vacío en el lienzo 2D de Blender.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-10 items-start">
          {REFERENCE_PLATES.map((plate, index) => {
            const isFailed = failedIds[plate.id];
            const isCurrentPose = activePose === plate.poseId;

            return (
              <article key={plate.id} className="flex flex-col">
                <div className="group relative bg-[#F3EFE6] border border-[#E5DFD3] rounded-md p-3">
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-sm bg-[#EFE9DA]">
                    {!isFailed ? (
                      <img
                        src={plate.imageSrc}
                        alt={`${plate.title} — ${plate.medium}`}
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setFailedIds((prev) => ({ ...prev, [plate.id]: true }))
                        }
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-[#F7F3EA] to-[#E6DEC8]">
                        <svg
                          viewBox="0 0 64 64"
                          className="w-10 h-10 text-[#78716C] mb-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          aria-hidden="true"
                        >
                          <path d="M18 46c0-10 6-18 14-18s14 8 14 18" />
                          <path d="M22 24l-2-9 7 5M42 24l2-9-7 5" />
                        </svg>
                        <span className="font-serif text-sm text-[#1C1917]">{plate.title}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setLightboxPlate(plate)}
                      aria-label={`Ampliar ${plate.title}`}
                      className="absolute bottom-3 right-3 p-2 rounded-md bg-[#FBF9F5]/90 text-[#1C1917] border border-[#D6CEBE] opacity-90 hover:bg-[#FBF9F5] transition-opacity cursor-pointer"
                    >
                      <Maximize2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2">
                  <div className="text-[11px] tracking-widest uppercase text-[#78716C]">
                    {plate.accession}
                  </div>
                  <h3 className="font-serif text-2xl font-medium text-[#1C1917]">
                    {plate.title}
                  </h3>
                  <p className="text-xs font-serif italic text-[#57534E]">
                    Fig. {index + 1} — {plate.medium} · {plate.dimensions}
                  </p>
                  <p className="text-sm text-[#44403C] leading-relaxed mt-1">
                    {plate.curatorialNote}
                  </p>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => handleSelectAndScroll(plate.poseId)}
                      className={`px-3.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                        isCurrentPose
                          ? 'bg-[#1C1917] text-[#FBF9F5] border-[#1C1917]'
                          : 'bg-transparent text-[#1C1917] border-[#D6CEBE] hover:bg-[#F3EFE6]'
                      }`}
                    >
                      {isCurrentPose ? 'Pose activa en estudio' : 'Cargar pose en Blender 2D'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxPlate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightboxPlate.title}
          className="fixed inset-0 z-50 bg-[#1C1917]/80 backdrop-blur-xs flex items-center justify-center p-4 sm:p-8"
          onClick={() => setLightboxPlate(null)}
        >
          <div
            className="bg-[#FBF9F5] border border-[#D6CEBE] rounded-lg max-w-4xl w-full p-5 sm:p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#E5DFD3]">
              <div>
                <div className="text-xs uppercase tracking-widest text-[#78716C]">
                  {lightboxPlate.accession}
                </div>
                <h3 className="font-serif text-2xl font-medium text-[#1C1917]">
                  {lightboxPlate.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setLightboxPlate(null)}
                aria-label="Cerrar vista ampliada"
                className="p-2 rounded-md border border-[#D6CEBE] text-[#1C1917] hover:bg-[#F3EFE6] cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 bg-[#F3EFE6] p-3 rounded border border-[#E5DFD3] flex items-center justify-center max-h-[65vh] overflow-hidden">
              <img
                src={lightboxPlate.imageSrc}
                alt={lightboxPlate.title}
                referrerPolicy="no-referrer"
                className="max-h-[60vh] w-auto object-contain rounded-sm"
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
              <p className="text-xs font-serif italic text-[#57534E]">
                {lightboxPlate.medium} · {lightboxPlate.dimensions}
              </p>
              <button
                type="button"
                onClick={() => {
                  handleSelectAndScroll(lightboxPlate.poseId);
                  setLightboxPlate(null);
                }}
                className="px-4 py-2 text-xs font-medium bg-[#1C1917] text-[#FBF9F5] rounded-md hover:bg-[#9A3412] transition-colors cursor-pointer"
              >
                Abrir esta pose en el estudio
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
