import React from 'react';

const STEPS = [
  {
    index: '01',
    title: 'Escena 2D y Cámara Ortográfica',
    subtitle: 'Espacio de trabajo 2D Animation',
    body: 'Trabaja sobre el plano XZ en Blender con una cámara ortográfica orientada a 90° en X. Desactiva las sombras de escena y usa Color Management en modo Standard para preservar la pureza marfil del papel Xuan sin oscurecimientos grisáceos.',
    spec: 'Ortho Scale: 10.0 · View Transform: Standard · Fondo World RGB cálido',
  },
  {
    index: '02',
    title: 'Materiales Sumi-e y Veladura de Acuarela',
    subtitle: 'Separación de trazo y aguada',
    body: 'Crea dos materiales de tinta: uno de tipo Stroke (negro carbón profundo 0.03, 0.03, 0.03 con textura Noise en la pestaña Material) y otro de tipo Fill para la silueta base en aguada al 88% de opacidad. El fondo minimalista usa elipses Fill con alfa bajo (0.18–0.32).',
    spec: 'Mat_Tinta_Sumi (Stroke) · Mat_Acuarela_Fondo (Fill Alpha 0.28)',
  },
  {
    index: '03',
    title: 'Modificadores de Pincel Seco y Caligrafía',
    subtitle: 'Noise, Thickness y Build',
    body: 'Añade un modificador Noise (GP_NOISE) a la capa Trazos_Caligrafia modulando Thickness y UV para simular la separación de cerdas sobre papel rugoso (feibai). Combínalo con un modificador Build para animar cada pincelada en orden caligráfico.',
    spec: 'GP_NOISE (Thickness 0.45) · GP_THICK · GP_BUILD (Sequential)',
  },
  {
    index: '04',
    title: 'Composición Ma (間) y Sello Hanko',
    subtitle: 'Equilibrio imperial japonés/chino',
    body: 'Reserva al menos el 55% del encuadre como espacio negativo respirable. Coloca un detalle vegetal mínimo (dos o tres hojas de bambú en tinta diluida) como contrapeso diagonal y cierra la composición con el sello bermellón 墨猫 en la esquina inferior.',
    spec: 'Espacio negativo ≥ 55% · Contraste bermellón #B0261C',
  },
];

export const BlenderGuide: React.FC = () => {
  return (
    <section id="tecnica" className="py-16 lg:py-24 border-t border-[#E5DFD3]">
      <div className="max-w-[1360px] mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12">
          <div className="lg:col-span-4">
            <p className="text-xs uppercase tracking-widest text-[#78716C] mb-2">
              Método de Producción
            </p>
            <h2 className="font-serif text-3xl lg:text-4xl font-medium text-[#1C1917] [text-wrap:balance]">
              Anatomía del pincel imperial en Blender 2D
            </h2>
            <p className="mt-4 text-sm text-[#57534E] leading-relaxed">
              Cómo traducir la caligrafía asiática sumi-e y la acuarela diluida a capas, trazos con
              presión variable y modificadores nativos de Grease Pencil.
            </p>
          </div>

          <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-10">
            {STEPS.map((step) => (
              <div key={step.index} className="pt-4 border-t border-[#D6CEBE]">
                <div className="flex items-baseline gap-3 mb-2">
                  <span className="font-mono text-xs text-[#9A3412] font-medium">
                    {step.index}
                  </span>
                  <span className="text-xs text-[#78716C]">{step.subtitle}</span>
                </div>
                <h3 className="font-serif text-2xl font-medium text-[#1C1917] mb-2.5">
                  {step.title}
                </h3>
                <p className="text-sm text-[#44403C] leading-relaxed mb-3">{step.body}</p>
                <div className="text-xs font-mono text-[#78716C]">{step.spec}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
