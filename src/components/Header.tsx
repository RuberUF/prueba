import React from 'react';

interface HeaderProps {
  onDownloadPython: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onDownloadPython }) => {
  return (
    <header className="sticky top-0 z-30 bg-[#FBF9F5]/95 backdrop-blur-sm border-b border-[#E5DFD3]">
      <div className="max-w-[1360px] mx-auto px-6 lg:px-10 h-16 flex items-center justify-between gap-8">
        <a
          href="#estudio"
          className="font-serif text-xl lg:text-2xl font-semibold tracking-tight text-[#1C1917] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#9A3412] focus-visible:outline-offset-4"
        >
          Kuro · Tinta Imperial
        </a>

        <nav
          aria-label="Navegación principal"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-[#57534E]"
        >
          <a
            href="#estudio"
            className="hover:text-[#1C1917] hover:underline underline-offset-4 decoration-[#9A3412]/50 transition-colors whitespace-nowrap shrink-0"
          >
            Estudio 2D
          </a>
          <a
            href="#laminas"
            className="hover:text-[#1C1917] hover:underline underline-offset-4 decoration-[#9A3412]/50 transition-colors whitespace-nowrap shrink-0"
          >
            Láminas
          </a>
          <a
            href="#tecnica"
            className="hover:text-[#1C1917] hover:underline underline-offset-4 decoration-[#9A3412]/50 transition-colors whitespace-nowrap shrink-0"
          >
            Técnica Sumi-e
          </a>
          <a
            href="#script-blender"
            className="hover:text-[#1C1917] hover:underline underline-offset-4 decoration-[#9A3412]/50 transition-colors whitespace-nowrap shrink-0"
          >
            Script Blender
          </a>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onDownloadPython}
            className="px-4 py-2 text-xs font-medium text-[#FBF9F5] bg-[#1C1917] rounded-md hover:bg-[#9A3412] transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#9A3412] focus-visible:outline-offset-2"
          >
            Exportar Script .py
          </button>
        </div>
      </div>
    </header>
  );
};
