import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export const CGI_DURATION_SECONDS = 10.0;

export interface CgiCompositingLayers {
  showPlate: boolean;
  showShadowCatcher: boolean;
  showRimLight: boolean;
  showAtmosphere: boolean;
  camcorderLook: boolean;
}

export const DEFAULT_CGI_LAYERS: CgiCompositingLayers = {
  showPlate: true,
  showShadowCatcher: true,
  showRimLight: true,
  showAtmosphere: true,
  camcorderLook: true,
};

// Reusable scratch math objects — zero GC inside renderAtTime()
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _vec3C = new THREE.Vector3();
const _vec3Tangent = new THREE.Vector3();
const _vec3Normal = new THREE.Vector3();
const _vec3Binormal = new THREE.Vector3();
const _vec3Up = new THREE.Vector3(0, 1, 0);
const _vec3SideRef = new THREE.Vector3(1, 0, 0);
const _vLimbP0 = new THREE.Vector3();
const _vLimbP1 = new THREE.Vector3();
const _vLimbP2 = new THREE.Vector3();
const _vLimbP3 = new THREE.Vector3();
const _vLimbChord = new THREE.Vector3();
const _vLimbBend = new THREE.Vector3();
const _vLimbFwd = new THREE.Vector3();
const _vLimbSide = new THREE.Vector3();
const _vec3ReflTarget = new THREE.Vector3();
const _mat4Refl = new THREE.Matrix4();
const _vec2DrawBuf = new THREE.Vector2();
const _prevClearColor = new THREE.Color();

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function detectSoftwareGl(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const rendererStr = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);
  } catch {
    return false;
  }
}

export interface HoudiniFurTextures {
  colorMap: THREE.DataTexture;
  strandMap: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
}

/**
 * Generates seamless 1024x1024 Houdini-style two-pass clumped feline fur textures:
 * 1) Melanin colorMap (black obsidian/sable for Kuro or pearlescent ivory-cream for Sunmy)
 * 2) Tapered hair clump length/alpha heightfield (for 22-shell progressive volumetric slicing)
 * 3) Sobel tangent-space normalMap derived 1:1 from the exact hair clump heightfield
 * 4) Roughness + Micro-Dew map (G = fiber roughness, B = fine mist/rain droplet bead mask)
 */
export function createHoudiniFurTextures(
  variant: 'black' | 'white' = 'black',
  quality: 'full' | 'fast' = 'full'
): HoudiniFurTextures {
  const size = quality === 'fast' ? 512 : 1024;
  const scaleFactor = size / 1024;
  const pixelCount = size * size;
  const heightField = new Float32Array(pixelCount);

  const colorRgba = new Uint8Array(pixelCount * 4);
  const strandRgba = new Uint8Array(pixelCount * 4);
  const roughRgba = new Uint8Array(pixelCount * 4);
  const normRgba = new Uint8Array(pixelCount * 4);

  const isWhite = variant === 'white';

  // Skin/undercoat root base
  for (let i = 0; i < pixelCount; i++) {
    const p = i * 4;
    colorRgba[p] = isWhite ? 186 : 7;
    colorRgba[p + 1] = isWhite ? 178 : 8;
    colorRgba[p + 2] = isWhite ? 168 : 11;
    colorRgba[p + 3] = 255;

    roughRgba[p] = 218;
    roughRgba[p + 1] = 218;
    roughRgba[p + 2] = 0; // B channel: mist/rain micro-dew beads
    roughRgba[p + 3] = 255;
  }

  let seed = isWhite ? 6217 : 7919;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Pass 1: Dense velvety wavy undercoat wool
  // Pass 2: Crisp tapered guard hairs + micro-dew tips
  const clumpCount = quality === 'fast' ? 2200 : 5600;
  const undercoatCutoff = quality === 'fast' ? 900 : 2200;
  for (let c = 0; c < clumpCount; c++) {
    const isUndercoatPass = c < undercoatCutoff;
    const cx = rand() * size;
    const cy = rand() * size;
    const clumpWindX = (rand() - 0.5) * (isUndercoatPass ? 9.5 : 6.0) * scaleFactor;
    const clumpCurve = (rand() - 0.5) * (isUndercoatPass ? 5.2 : 3.4) * scaleFactor;
    const strandsInClump = isUndercoatPass ? 10 + Math.floor(rand() * 7) : 13 + Math.floor(rand() * 8);

    for (let s = 0; s < strandsInClump; s++) {
      const rx = cx + (rand() - 0.5) * (isUndercoatPass ? 15.0 : 11.0) * scaleFactor;
      const ry = cy + (rand() - 0.5) * (isUndercoatPass ? 15.0 : 11.0) * scaleFactor;
      const isGuardHair = !isUndercoatPass && rand() > 0.34;
      const hMax = isGuardHair
        ? 0.76 + rand() * 0.24
        : isUndercoatPass
        ? 0.16 + rand() * 0.32
        : 0.34 + rand() * 0.36;
      const len = (isGuardHair ? 26 + rand() * 20 : 12 + rand() * 12) * scaleFactor;
      const tipX = rx + (cx - rx) * 0.44 + clumpWindX + (rand() - 0.5) * 2.1 * scaleFactor;
      const tipY = ry - len; // -V direction in DataTexture (flipY=false) -> flows head-to-tail & down legs

      // Rich melanin tint variation
      const tintPick = rand();
      let cr = isWhite ? 216 : 15;
      let cg = isWhite ? 210 : 17;
      let cb = isWhite ? 202 : 22;
      if (isWhite) {
        if (isGuardHair) {
          if (tintPick > 0.82) {
            cr = 250;
            cg = 248;
            cb = 245;
          } else if (tintPick > 0.4) {
            cr = 236;
            cg = 228;
            cb = 216;
          } else {
            cr = 222;
            cg = 220;
            cb = 224;
          }
        } else if (!isUndercoatPass) {
          cr = 224;
          cg = 218;
          cb = 210;
        }
      } else {
        if (isGuardHair) {
          if (tintPick > 0.91) {
            cr = 52;
            cg = 57;
            cb = 68;
          } else if (tintPick > 0.45) {
            cr = 35;
            cg = 27;
            cb = 24;
          } else {
            cr = 23;
            cg = 27;
            cb = 36;
          }
        } else if (!isUndercoatPass) {
          cr = 19;
          cg = 20;
          cb = 26;
        }
      }

      const hasDewBead = isGuardHair && rand() > 0.885;
      const dewAtU = 0.62 + rand() * 0.32;

      const steps = Math.ceil(len * 1.45);
      for (let st = 0; st <= steps; st++) {
        const u = st / steps;
        const px = rx + (tipX - rx) * u + Math.sin(u * Math.PI) * clumpCurve;
        const py = ry + (tipY - ry) * u;

        const halfW = lerp(0.88, 0.20, Math.pow(u, 0.72)) * (isGuardHair ? 1.02 : 0.86);
        const strandH = hMax * (1.0 - u * 0.13);
        const rVal = Math.round(lerp(208, 96, isGuardHair ? 0.90 : 0.32));
        const dewVal =
          hasDewBead && Math.abs(u - dewAtU) < 0.08
            ? Math.round((1.0 - Math.abs(u - dewAtU) / 0.08) * 240)
            : 0;

        const minIx = Math.floor(px - halfW);
        const maxIx = Math.ceil(px + halfW);
        const minIy = Math.floor(py - 0.5);
        const maxIy = Math.ceil(py + 0.5);

        for (let iy = minIy; iy <= maxIy; iy++) {
          const wy = ((iy % size) + size) % size;
          for (let ix = minIx; ix <= maxIx; ix++) {
            const dist = Math.abs(ix - px);
            if (dist > halfW) continue;
            const profile = 1.0 - Math.pow(dist / halfW, 1.85);
            const hSample = strandH * profile;

            const wx = ((ix % size) + size) % size;
            const idx = wy * size + wx;
            if (hSample > heightField[idx]) {
              heightField[idx] = hSample;
              const p = idx * 4;
              const rootShade = lerp(0.52, 1.25, u);
              colorRgba[p] = Math.min(255, Math.round(cr * rootShade));
              colorRgba[p + 1] = Math.min(255, Math.round(cg * rootShade));
              colorRgba[p + 2] = Math.min(255, Math.round(cb * rootShade));
              roughRgba[p] = rVal;
              roughRgba[p + 1] = rVal;
              roughRgba[p + 2] = Math.max(roughRgba[p + 2], dewVal);
            }
          }
        }
      }
    }
  }

  // Encode alpha strand mask + compute crisp Sobel tangent-space normalMap from heightField
  const strength = 4.4;
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;

      const h = heightField[y * size + x];
      const alphaByte = Math.min(255, Math.max(0, Math.round(Math.pow(h, 0.72) * 255)));
      const p = (y * size + x) * 4;
      strandRgba[p] = alphaByte;
      strandRgba[p + 1] = alphaByte;
      strandRgba[p + 2] = alphaByte;
      strandRgba[p + 3] = 255;

      const tl = heightField[ym * size + xm];
      const t = heightField[ym * size + x];
      const tr = heightField[ym * size + xp];
      const l = heightField[y * size + xm];
      const r = heightField[y * size + xp];
      const bl = heightField[yp * size + xm];
      const b = heightField[yp * size + x];
      const br = heightField[yp * size + xp];

      const dX = tr + 2 * r + br - (tl + 2 * l + bl);
      const dY = bl + 2 * b + br - (tl + 2 * t + tr);

      let nx = -dX * strength;
      let ny = -dY * strength;
      let nz = 1.0;
      const invLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      normRgba[p] = Math.round((nx * 0.5 + 0.5) * 255);
      normRgba[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normRgba[p + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normRgba[p + 3] = 255;
    }
  }

  const makeTex = (data: Uint8Array, isSrgb: boolean) => {
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    colorMap: makeTex(colorRgba, true),
    strandMap: makeTex(strandRgba, false),
    normalMap: makeTex(normRgba, false),
    roughnessMap: makeTex(roughRgba, false),
  };
}

function scaleGeometryUvs(geo: THREE.BufferGeometry, scaleU: number, scaleV: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * scaleU, uv.getY(i) * scaleV);
  }
  uv.needsUpdate = true;
}

function attachFurAttributes(
  geo: THREE.BufferGeometry,
  calcFur: (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    idx: number
  ) => { len: number; fx: number; fy: number; fz: number }
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const lenArr = new Float32Array(pos.count);
  const flowArr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const res = calcFur(
      pos.getX(i),
      pos.getY(i),
      pos.getZ(i),
      norm ? norm.getX(i) : 0,
      norm ? norm.getY(i) : 1,
      norm ? norm.getZ(i) : 0,
      i
    );
    lenArr[i] = res.len;
    const fMag = Math.hypot(res.fx, res.fy, res.fz) || 1;
    flowArr[i * 3] = res.fx / fMag;
    flowArr[i * 3 + 1] = res.fy / fMag;
    flowArr[i * 3 + 2] = res.fz / fMag;
  }
  geo.setAttribute('aFurLen', new THREE.BufferAttribute(lenArr, 1));
  geo.setAttribute('aFurFlow', new THREE.BufferAttribute(flowArr, 3));
}

interface GroomedFurResult {
  baseMat: THREE.MeshPhysicalMaterial;
  shellMats: THREE.MeshPhysicalMaterial[];
  updateFurMotion: (
    inertiaX: number,
    inertiaY: number,
    inertiaZ: number,
    windStrength: number,
    timeSec: number
  ) => void;
}

function createGroomedFurMaterials(
  furTex: HoudiniFurTextures,
  shellCount: number,
  maxFurLength = 0.0175
): GroomedFurResult {
  const sharedFurDynamic = { value: new THREE.Vector3(0, 0, 0) };
  const sharedFurTime = { value: 0 };
  const sharedWindStrength = { value: 1.0 };

  const applyFurShader = (
    mat: THREE.MeshPhysicalMaterial,
    shellHeight: number,
    layDownDist: number,
    hairOcclusion: number,
    rimBoost: number,
    flexFactor: number
  ) => {
    mat.customProgramCacheKey = () => 'houdini-groomed-fur-v4-marschner';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uShellHeight = { value: shellHeight };
      shader.uniforms.uLayDownDist = { value: layDownDist };
      shader.uniforms.uHairOcclusion = { value: hairOcclusion };
      shader.uniforms.uFurRimBoost = { value: rimBoost };
      shader.uniforms.uFlexFactor = { value: flexFactor };
      shader.uniforms.uFurDynamic = sharedFurDynamic;
      shader.uniforms.uFurTime = sharedFurTime;
      shader.uniforms.uWindStrength = sharedWindStrength;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aFurLen;
          attribute vec3 aFurFlow;
          uniform float uShellHeight;
          uniform float uLayDownDist;
          uniform float uFlexFactor;
          uniform vec3 uFurDynamic;
          uniform float uFurTime;
          uniform float uWindStrength;
          varying float vFurLen;
          varying vec2 vFurUv;
          varying vec3 vFurFlowView;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vFurLen = aFurLen;
          vFurUv = uv;
          vFurFlowView = normalize( normalMatrix * aFurFlow );
          float fLen = max(0.05, aFurLen);
          float breezeWave = sin(position.z * 26.0 + position.y * 19.0 - uFurTime * 3.2)
            * cos(position.x * 22.0 + uFurTime * 2.1);
          vec3 windVec = vec3(
            breezeWave * 0.0015 + sin(uFurTime * 1.9 + position.z * 14.0) * 0.0007,
            breezeWave * 0.0006,
            cos(uFurTime * 2.5 + position.y * 18.0) * 0.0009
          ) * uWindStrength;
          vec3 groomDisp = aFurFlow * uLayDownDist + (uFurDynamic + windVec) * uFlexFactor;
          transformed += (normalize( objectNormal ) * uShellHeight + groomDisp) * fLen;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uHairOcclusion;
          uniform float uFurRimBoost;
          varying float vFurLen;
          varying vec2 vFurUv;
          varying vec3 vFurFlowView;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb *= mix( 0.42, uHairOcclusion, clamp( vFurLen, 0.0, 1.0 ) );`
        )
        .replace(
          '#include <opaque_fragment>',
          `float ndv = saturate( dot( normal, geometryViewDir ) );
          float fresnelHair = pow( 1.0 - ndv, 2.35 );
          float trtScatter = pow( 1.0 - ndv, 4.1 );

          // Kajiya-Kay / Marschner anisotropic dual-lobe cuticle reflection along hair tangent
          vec3 hairT1 = normalize( vFurFlowView + normal * 0.22 );
          vec3 hairT2 = normalize( vFurFlowView - normal * 0.14 );
          vec3 hLantern = normalize( geometryViewDir + vec3(-0.62, 0.50, -0.58) );
          vec3 hSky = normalize( geometryViewDir + vec3(0.42, 0.72, 0.55) );
          float dotTH1 = dot( hairT1, hSky );
          float dotTH2 = dot( hairT2, hLantern );
          float kajiyaCool = pow( sqrt( max(0.0, 1.0 - dotTH1 * dotTH1) ), 28.0 );
          float kajiyaWarm = pow( sqrt( max(0.0, 1.0 - dotTH2 * dotTH2) ), 18.0 );

          // Micro-rain & forest mist dew beads clinging to outer guard hair tips
          float dewMask = texture2D( roughnessMap, vFurUv ).b;
          float dewSparkle = smoothstep(0.32, 0.85, dewMask) * smoothstep(0.22, 0.58, uFurRimBoost);
          float wetTipGlint = pow( 1.0 - ndv, 5.2 ) * smoothstep(0.18, 0.55, uFurRimBoost);

          // Plate twilight light-wrap around fur silhouette
          vec3 plateWrap = vec3(0.032, 0.052, 0.068) * pow(1.0 - ndv, 3.4) * smoothstep(0.08, 0.48, uFurRimBoost);

          outgoingLight += (diffuseColor.rgb + vec3(0.034, 0.028, 0.024)) * fresnelHair * uFurRimBoost
            + vec3(0.024, 0.015, 0.008) * trtScatter * uFurRimBoost
            + vec3(0.038, 0.052, 0.068) * kajiyaCool * (0.28 + uFurRimBoost * 0.95)
            + vec3(0.062, 0.038, 0.016) * kajiyaWarm * (0.25 + uFurRimBoost * 1.15)
            + vec3(0.28, 0.34, 0.38) * (wetTipGlint * 0.45 + dewSparkle * (0.35 + 0.65 * fresnelHair))
            + plateWrap;
          #include <opaque_fragment>`
        );
    };
  };

  const baseMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: furTex.colorMap,
    roughness: 0.78,
    roughnessMap: furTex.roughnessMap,
    normalMap: furTex.normalMap,
    normalScale: new THREE.Vector2(1.12, 1.12),
    metalness: 0.02,
    sheen: 0.88,
    sheenRoughness: 0.44,
    sheenColor: new THREE.Color(0x5b768c),
    envMapIntensity: 0.85,
  });
  applyFurShader(baseMat, 0.0, 0.0, 0.54, 0.04, 0.0);

  const shellMats: THREE.MeshPhysicalMaterial[] = [];
  for (let k = 1; k <= shellCount; k++) {
    const frac = k / shellCount;
    const height = frac * maxFurLength;
    const combPower = Math.pow(frac, 1.48);
    const layDownDist = 0.0056 * combPower;
    const occlusion = lerp(0.58, 1.60, Math.pow(frac, 0.76));
    const rimBoost = lerp(0.07, 0.66, Math.pow(frac, 1.18));
    const alphaCutoff = lerp(0.05, 0.88, Math.pow(frac, 0.92));

    const sMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: furTex.colorMap,
      alphaMap: furTex.strandMap,
      alphaTest: alphaCutoff,
      alphaToCoverage: k >= Math.max(1, shellCount - 6),
      roughness: lerp(0.72, 0.46, frac),
      roughnessMap: furTex.roughnessMap,
      normalMap: furTex.normalMap,
      normalScale: new THREE.Vector2(1.22, 1.22),
      metalness: 0.02,
      sheen: 1.0,
      sheenRoughness: lerp(0.40, 0.20, frac),
      sheenColor: new THREE.Color().lerpColors(
        new THREE.Color(0x738fa8),
        new THREE.Color(0xdcecf8),
        frac
      ),
      envMapIntensity: lerp(0.95, 1.45, frac),
    });
    applyFurShader(sMat, height, layDownDist, occlusion, rimBoost, combPower);
    shellMats.push(sMat);
  }

  const updateFurMotion = (
    inertiaX: number,
    inertiaY: number,
    inertiaZ: number,
    windStrength: number,
    timeSec: number
  ) => {
    sharedFurDynamic.value.set(inertiaX, inertiaY, inertiaZ);
    sharedWindStrength.value = windStrength;
    sharedFurTime.value = timeSec;
  };

  return { baseMat, shellMats, updateFurMotion };
}

export interface PbrTextureTriplet {
  colorMap: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  dispose: () => void;
}

function buildSobelNormalData(
  heightField: Float32Array,
  size: number,
  strength: number
): Uint8Array {
  const normRgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(size - 1, y + 1);
    for (let x = 0; x < size; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(size - 1, x + 1);
      const tl = heightField[ym * size + xm];
      const tc = heightField[ym * size + x];
      const tr = heightField[ym * size + xp];
      const ml = heightField[y * size + xm];
      const mr = heightField[y * size + xp];
      const bl = heightField[yp * size + xm];
      const bc = heightField[yp * size + x];
      const br = heightField[yp * size + xp];

      const dX = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const dY = bl + 2 * bc + br - (tl + 2 * tc + tr);
      let nx = -dX * strength;
      let ny = -dY * strength;
      let nz = 1.0;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;

      const p = (y * size + x) * 4;
      normRgba[p] = Math.round((nx * 0.5 + 0.5) * 255);
      normRgba[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normRgba[p + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normRgba[p + 3] = 255;
    }
  }
  return normRgba;
}

function makeLinearOrSrgbDataTex(
  data: Uint8Array,
  size: number,
  isSrgb: boolean,
  repeat = false
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 512x512 hyper-detailed feline iris PBR set (color, 3D stroma relief normalMap, roughnessMap)
 * with emerald-chartreuse to amber-gold heterochromia, Crypts of Fuchs, collarette, and limbal ring.
 */
export function createCatIrisTextures(variant: 'amber' | 'sapphire' = 'amber'): PbrTextureTriplet {
  const size = 512;
  const pxCount = size * size;
  const colorRgba = new Uint8Array(pxCount * 4);
  const roughRgba = new Uint8Array(pxCount * 4);
  const heightField = new Float32Array(pxCount);

  const cx = size * 0.5;
  const cy = size * 0.5;
  const isSapphire = variant === 'sapphire';

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / (size * 0.5);
      const dy = (y - cy) / (size * 0.5);
      const r = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);

      // Multi-harmonic radial stroma fibers + wavy collarette boundary
      const fiber1 = Math.sin(ang * 46.0 + Math.sin(r * 14.0 + ang * 7.0) * 1.4);
      const fiber2 = Math.cos(ang * 92.0 - r * 18.0 + Math.sin(ang * 19.0) * 0.9);
      const fiber3 = Math.sin(ang * 165.0 + Math.cos(r * 32.0) * 1.2);
      const crypts = Math.max(0, Math.sin(ang * 17.0 + r * 9.0) * Math.cos(ang * 11.0 - r * 6.0));
      const fiberMix = clamp01(0.5 + fiber1 * 0.24 + fiber2 * 0.16 + fiber3 * 0.10 - crypts * 0.25);

      const collaretteR = 0.42 + Math.sin(ang * 14.0) * 0.035 + Math.cos(ang * 23.0) * 0.02;
      const collarette = Math.exp(-Math.pow((r - collaretteR) / 0.055, 2));

      let cr: number;
      let cg: number;
      let cb: number;
      if (isSapphire) {
        if (r < 0.34) {
          const u = r / 0.34;
          cr = lerp(172, 118, u);
          cg = lerp(236, 206, u);
          cb = lerp(248, 245, u);
        } else if (r < 0.72) {
          const u = (r - 0.34) / 0.38;
          cr = lerp(118, 42, u);
          cg = lerp(206, 122, u);
          cb = lerp(245, 212, u);
        } else {
          const u = clamp01((r - 0.72) / 0.26);
          cr = lerp(42, 12, Math.pow(u, 0.75));
          cg = lerp(122, 24, Math.pow(u, 0.75));
          cb = lerp(212, 48, Math.pow(u, 0.75));
        }
      } else if (r < 0.34) {
        const u = r / 0.34;
        cr = lerp(195, 236, u);
        cg = lerp(228, 198, u);
        cb = lerp(128, 72, u);
      } else if (r < 0.72) {
        const u = (r - 0.34) / 0.38;
        cr = lerp(236, 174, u);
        cg = lerp(198, 96, u);
        cb = lerp(72, 18, u);
      } else {
        const u = clamp01((r - 0.72) / 0.26);
        cr = lerp(174, 16, Math.pow(u, 0.75));
        cg = lerp(96, 14, Math.pow(u, 0.75));
        cb = lerp(18, 12, Math.pow(u, 0.75));
      }

      // Apply fiber highlights, crypt darkening, and golden collarette rim
      const shade = lerp(0.58, 1.24, fiberMix) + collarette * 0.22;
      const limbalMask = 1.0 - smoothstep(0.86, 0.98, r) * 0.92;

      const idx = y * size + x;
      const p = idx * 4;
      colorRgba[p] = Math.min(255, Math.max(0, Math.round(cr * shade * limbalMask)));
      colorRgba[p + 1] = Math.min(255, Math.max(0, Math.round(cg * shade * limbalMask)));
      colorRgba[p + 2] = Math.min(255, Math.max(0, Math.round(cb * shade * limbalMask)));
      colorRgba[p + 3] = 255;

      const roughByte = Math.round(lerp(0.32, 0.14, fiberMix * 0.6 + collarette * 0.4) * 255);
      roughRgba[p] = roughByte;
      roughRgba[p + 1] = roughByte;
      roughRgba[p + 2] = roughByte;
      roughRgba[p + 3] = 255;

      heightField[idx] = clamp01(fiberMix * 0.7 + collarette * 0.3) * limbalMask;
    }
  }

  const normRgba = buildSobelNormalData(heightField, size, 4.2);
  const colorMap = makeLinearOrSrgbDataTex(colorRgba, size, true);
  const normalMap = makeLinearOrSrgbDataTex(normRgba, size, false);
  const roughnessMap = makeLinearOrSrgbDataTex(roughRgba, size, false);

  return {
    colorMap,
    normalMap,
    roughnessMap,
    dispose: () => {
      colorMap.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * 256x256 Voronoi cobblestone dermatoglyphic feline nose leather textures
 * with wet nasal bridge sheen and damp slate-plum color variation.
 */
export function createNoseLeatherTextures(): PbrTextureTriplet {
  const size = 256;
  const pxCount = size * size;
  const colorRgba = new Uint8Array(pxCount * 4);
  const roughRgba = new Uint8Array(pxCount * 4);
  const heightField = new Float32Array(pxCount);

  const cells = 22;
  const pts: Array<{ x: number; y: number; h: number }> = [];
  let seed = 8821;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      pts.push({
        x: (c + 0.2 + rand() * 0.6) / cells,
        y: (r + 0.2 + rand() * 0.6) / cells,
        h: 0.75 + rand() * 0.35,
      });
    }
  }

  for (let py = 0; py < size; py++) {
    const v = py / size;
    const gr = Math.floor(v * cells);
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const gc = Math.floor(u * cells);
      let d1 = 999;
      let d2 = 999;
      let bestH = 1.0;

      for (let dr = -1; dr <= 1; dr++) {
        const rr = (gr + dr + cells) % cells;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = (gc + dc + cells) % cells;
          const pt = pts[rr * cells + cc];
          let dx = u - pt.x;
          let dy = v - pt.y;
          if (dx > 0.5) dx -= 1;
          if (dx < -0.5) dx += 1;
          if (dy > 0.5) dy -= 1;
          if (dy < -0.5) dy += 1;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            bestH = pt.h;
          } else if (d < d2) {
            d2 = d;
          }
        }
      }

      const seam = clamp01((d2 - d1) * cells * 1.45);
      const dome = Math.pow(smoothstep(0.0, 0.75, seam), 0.55) * bestH;
      const idx = py * size + px;
      heightField[idx] = dome;

      const p = idx * 4;
      const shade = lerp(0.55, 1.15, dome);
      colorRgba[p] = Math.round(33 * shade);
      colorRgba[p + 1] = Math.round(23 * shade);
      colorRgba[p + 2] = Math.round(28 * shade);
      colorRgba[p + 3] = 255;

      const roughByte = Math.round(lerp(0.28, 0.08, dome) * 255);
      roughRgba[p] = roughByte;
      roughRgba[p + 1] = roughByte;
      roughRgba[p + 2] = roughByte;
      roughRgba[p + 3] = 255;
    }
  }

  const normRgba = buildSobelNormalData(heightField, size, 4.8);
  const colorMap = makeLinearOrSrgbDataTex(colorRgba, size, true, true);
  const normalMap = makeLinearOrSrgbDataTex(normRgba, size, false, true);
  const roughnessMap = makeLinearOrSrgbDataTex(roughRgba, size, false, true);

  return {
    colorMap,
    normalMap,
    roughnessMap,
    dispose: () => {
      colorMap.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * 256x256 inner ear pinna cartilage, fine blood-vessel branching, and soft pore textures.
 */
export function createInnerEarTextures(): PbrTextureTriplet {
  const size = 256;
  const pxCount = size * size;
  const colorRgba = new Uint8Array(pxCount * 4);
  const roughRgba = new Uint8Array(pxCount * 4);
  const heightField = new Float32Array(pxCount);

  for (let py = 0; py < size; py++) {
    const v = py / size;
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const vein1 = Math.exp(-Math.pow(Math.abs(u - 0.5 + Math.sin(v * 7.5) * 0.14) / 0.018, 2));
      const vein2 = Math.exp(-Math.pow(Math.abs(u - 0.34 - v * 0.18 + Math.cos(v * 11.0) * 0.05) / 0.013, 2)) * smoothstep(0.15, 0.85, v);
      const vein3 = Math.exp(-Math.pow(Math.abs(u - 0.66 + v * 0.18 + Math.sin(v * 10.0) * 0.05) / 0.013, 2)) * smoothstep(0.15, 0.85, v);
      const veins = clamp01(vein1 * 0.7 + vein2 + vein3);
      const pores = Math.sin(u * 140.0 + v * 90.0) * Math.cos(u * 110.0 - v * 150.0) * 0.5 + 0.5;
      const h = clamp01(0.45 + pores * 0.25 + veins * 0.3);

      const idx = py * size + px;
      heightField[idx] = h;
      const p = idx * 4;
      colorRgba[p] = Math.round(lerp(56, 74, veins) + pores * 6);
      colorRgba[p + 1] = Math.round(lerp(40, 44, veins) + pores * 4);
      colorRgba[p + 2] = Math.round(lerp(44, 48, veins) + pores * 5);
      colorRgba[p + 3] = 255;

      const roughByte = Math.round(lerp(0.86, 0.66, veins * 0.4 + pores * 0.3) * 255);
      roughRgba[p] = roughByte;
      roughRgba[p + 1] = roughByte;
      roughRgba[p + 2] = roughByte;
      roughRgba[p + 3] = 255;
    }
  }

  const normRgba = buildSobelNormalData(heightField, size, 2.8);
  const colorMap = makeLinearOrSrgbDataTex(colorRgba, size, true);
  const normalMap = makeLinearOrSrgbDataTex(normRgba, size, false);
  const roughnessMap = makeLinearOrSrgbDataTex(roughRgba, size, false);

  return {
    colorMap,
    normalMap,
    roughnessMap,
    dispose: () => {
      colorMap.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * 256x256 leathery feline paw-pad (toe bean) skin texture with micro-grain and damp sheen.
 */
export function createPawPadTextures(): PbrTextureTriplet {
  const size = 256;
  const pxCount = size * size;
  const colorRgba = new Uint8Array(pxCount * 4);
  const roughRgba = new Uint8Array(pxCount * 4);
  const heightField = new Float32Array(pxCount);

  for (let py = 0; py < size; py++) {
    const v = py / size;
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const g1 = Math.sin(u * 120.0 + Math.cos(v * 95.0) * 2.0);
      const g2 = Math.cos(v * 135.0 - Math.sin(u * 110.0) * 1.8);
      const grain = clamp01(0.5 + g1 * 0.25 + g2 * 0.25);
      const idx = py * size + px;
      heightField[idx] = grain;

      const p = idx * 4;
      const shade = lerp(0.76, 1.18, grain);
      colorRgba[p] = Math.round(24 * shade);
      colorRgba[p + 1] = Math.round(21 * shade);
      colorRgba[p + 2] = Math.round(25 * shade);
      colorRgba[p + 3] = 255;

      const roughByte = Math.round(lerp(0.54, 0.28, grain) * 255);
      roughRgba[p] = roughByte;
      roughRgba[p + 1] = roughByte;
      roughRgba[p + 2] = roughByte;
      roughRgba[p + 3] = 255;
    }
  }

  const normRgba = buildSobelNormalData(heightField, size, 3.6);
  const colorMap = makeLinearOrSrgbDataTex(colorRgba, size, true, true);
  const normalMap = makeLinearOrSrgbDataTex(normRgba, size, false, true);
  const roughnessMap = makeLinearOrSrgbDataTex(roughRgba, size, false, true);

  return {
    colorMap,
    normalMap,
    roughnessMap,
    dispose: () => {
      colorMap.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Builds a smoothly tapered cylindrical whisker mesh from thicker follicle root to razor-fine tip.
 */
function createTaperedWhiskerGeometry(
  curve: THREE.CatmullRomCurve3,
  rRoot: number,
  rTip: number,
  tubularSegs = 14,
  radialSegs = 6
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubularSegs, false);
  const vertCount = (tubularSegs + 1) * (radialSegs + 1);
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  const pt = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let i = 0; i <= tubularSegs; i++) {
    const u = i / tubularSegs;
    curve.getPointAt(u, pt);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const radius = lerp(rRoot, rTip, Math.pow(u, 0.72));

    for (let j = 0; j <= radialSegs; j++) {
      const v = j / radialSegs;
      const theta = v * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      nrm.set(
        cosT * N.x + sinT * B.x,
        cosT * N.y + sinT * B.y,
        cosT * N.z + sinT * B.z
      ).normalize();

      const idx = i * (radialSegs + 1) + j;
      positions[idx * 3] = pt.x + nrm.x * radius;
      positions[idx * 3 + 1] = pt.y + nrm.y * radius;
      positions[idx * 3 + 2] = pt.z + nrm.z * radius;
      normals[idx * 3] = nrm.x;
      normals[idx * 3 + 1] = nrm.y;
      normals[idx * 3 + 2] = nrm.z;
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
    }
  }

  for (let i = 0; i < tubularSegs; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * (radialSegs + 1) + j;
      const b = (i + 1) * (radialSegs + 1) + j;
      const c = (i + 1) * (radialSegs + 1) + (j + 1);
      const d = i * (radialSegs + 1) + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Soft radial sprite texture for contact AO shadows, wet specular bounce, and dust motes.
 */
function createSoftRadialTexture(
  innerRgba: string,
  midRgba: string,
  outerRgba: string
): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0, innerRgba);
  grad.addColorStop(0.45, midRgba);
  grad.addColorStop(1, outerRgba);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface PlatePalette {
  skyColor: number;
  lanternColor: number;
  canopyColor: number;
  groundColor: number;
}

function samplePlatePaletteFromImage(img: CanvasImageSource & { width?: number; height?: number }): PlatePalette | null {
  try {
    const w = 32;
    const h = 18;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const avgRegion = (x0: number, y0: number, x1: number, y1: number, boost = 1.0): number => {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * w + x) * 4;
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          count++;
        }
      }
      if (!count) return 0x203040;
      const rr = Math.min(255, Math.round((r / count) * boost));
      const gg = Math.min(255, Math.round((g / count) * boost));
      const bb = Math.min(255, Math.round((b / count) * boost));
      return (rr << 16) | (gg << 8) | bb;
    };

    return {
      skyColor: avgRegion(8, 0, 24, 6, 1.65),
      lanternColor: avgRegion(0, 3, 10, 12, 2.35),
      canopyColor: avgRegion(22, 3, 32, 12, 1.45),
      groundColor: avgRegion(8, 13, 24, 18, 0.85),
    };
  } catch {
    return null;
  }
}

/**
 * Blender-style HDRI Light-Card Studio Environment rendered via PMREMGenerator.
 * Can rebuild dynamically using actual pixel colors sampled from the loaded DSLR photo plate!
 */
function createPlateMatchedEnvironment(
  renderer: THREE.WebGLRenderer,
  palette?: PlatePalette | null
): {
  envMap: THREE.Texture;
  dispose: () => void;
} {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();

  const domeGeo = new THREE.SphereGeometry(12, 24, 16);
  const domeMat = new THREE.MeshBasicMaterial({
    color: palette ? palette.groundColor : 0x132430,
    side: THREE.BackSide,
  });
  envScene.add(new THREE.Mesh(domeGeo, domeMat));

  const skyCardGeo = new THREE.PlaneGeometry(10, 10);
  const skyCardMat = new THREE.MeshBasicMaterial({
    color: palette ? palette.skyColor : 0x5c859c,
    side: THREE.DoubleSide,
  });
  const skyCard = new THREE.Mesh(skyCardGeo, skyCardMat);
  skyCard.position.set(1.5, 5.5, 1.5);
  skyCard.lookAt(0, 0, 0);
  envScene.add(skyCard);

  const lanternCardGeo = new THREE.CircleGeometry(1.75, 24);
  const lanternCardMat = new THREE.MeshBasicMaterial({
    color: palette ? palette.lanternColor : 0xffb35c,
    side: THREE.DoubleSide,
  });
  const lanternCard = new THREE.Mesh(lanternCardGeo, lanternCardMat);
  lanternCard.position.set(-3.6, 2.2, -3.5);
  lanternCard.lookAt(0, 0, 0);
  envScene.add(lanternCard);

  const fillCardGeo = new THREE.PlaneGeometry(5, 3);
  const fillCardMat = new THREE.MeshBasicMaterial({
    color: palette ? palette.canopyColor : 0x3b6370,
    side: THREE.DoubleSide,
  });
  const fillCard = new THREE.Mesh(fillCardGeo, fillCardMat);
  fillCard.position.set(4.5, 1.8, 2.0);
  fillCard.lookAt(0, 0, 0);
  envScene.add(fillCard);

  const groundCardGeo = new THREE.PlaneGeometry(12, 12);
  const groundCardMat = new THREE.MeshBasicMaterial({
    color: palette ? palette.groundColor : 0x10171d,
    side: THREE.DoubleSide,
  });
  const groundCard = new THREE.Mesh(groundCardGeo, groundCardMat);
  groundCard.position.set(0, -3.5, 0);
  groundCard.rotation.x = -Math.PI / 2;
  envScene.add(groundCard);

  const renderTarget = pmrem.fromScene(envScene, 0.04);

  domeGeo.dispose();
  domeMat.dispose();
  skyCardGeo.dispose();
  skyCardMat.dispose();
  lanternCardGeo.dispose();
  lanternCardMat.dispose();
  fillCardGeo.dispose();
  fillCardMat.dispose();
  groundCardGeo.dispose();
  groundCardMat.dispose();
  pmrem.dispose();

  return {
    envMap: renderTarget.texture,
    dispose: () => {
      renderTarget.dispose();
    },
  };
}

// Helper to build a layered groomed mesh group sharing one BufferGeometry across GPU fur shells
function addGroomedShellStack(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  baseMat: THREE.Material,
  shellMats: THREE.Material[],
  maxShells = shellMats.length
): void {
  const base = new THREE.Mesh(geo, baseMat);
  base.castShadow = true;
  base.receiveShadow = true;
  parent.add(base);

  const count = Math.min(maxShells, shellMats.length);
  for (let i = 0; i < count; i++) {
    const shell = new THREE.Mesh(geo, shellMats[i]);
    shell.castShadow = false;
    shell.receiveShadow = true;
    parent.add(shell);
  }
}

/**
 * High-poly (96x72 = 7,081 vertices) hyper-detailed FELINE head mesh:
 * carved nasal philtrum Y-cleft, rounded upper lip pads, arched brow ridges,
 * tear-duct eye recesses, malar cheekbones, plush cheek ruffs, and flared neck collar.
 */
function createSculptedHeadGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 96, 72);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i);
    const ny = pos.getY(i);
    const nz = pos.getZ(i);

    let x = nx * 0.0445;
    let y = ny * 0.0385;
    let z = nz * 0.039;

    // Gentle cranial flatten on crown between ears
    y -= 0.0038 * smoothstep(0.42, 0.98, ny) * (1 - Math.abs(nx) * 0.22);

    // Full feline cheekbones & plush cheek fur ruffs framing the face
    const cheekBulge =
      Math.exp(-Math.pow((ny + 0.08) / 0.44, 2)) *
      Math.exp(-Math.pow((nz - 0.12) / 0.46, 2));
    x *= 1 + 0.23 * cheekBulge;

    const ruff =
      Math.exp(-Math.pow((ny + 0.34) / 0.28, 2)) *
      smoothstep(0.32, 0.92, Math.abs(nx)) *
      Math.exp(-Math.pow((nz + 0.02) / 0.52, 2));
    x *= 1 + 0.21 * ruff;
    y -= 0.0034 * ruff;

    // Refined short feline nasal bridge (crisp bridge ridge tapering smoothly down to nose tip)
    const bridge =
      Math.exp(-Math.pow(nx / 0.14, 2)) *
      smoothstep(0.05, 0.72, ny) *
      smoothstep(0.55, 0.98, nz);
    z += 0.0042 * bridge;

    const fwd = smoothstep(0.32, 0.98, nz);
    x *= 1 - 0.53 * fwd * smoothstep(-0.28, 0.58, ny);
    y -= 0.0072 * fwd * smoothstep(-0.08, 0.85, ny);
    z += 0.0112 * fwd * Math.exp(-Math.pow((ny + 0.18) / 0.44, 2));

    // Plump feline whisker pads + carved central philtrum Y-cleft under the nose
    const pad =
      Math.exp(-Math.pow((Math.abs(nx) - 0.23) / 0.16, 2)) *
      Math.exp(-Math.pow((ny + 0.24) / 0.16, 2)) *
      smoothstep(0.48, 0.97, nz);
    z += 0.0064 * pad;
    x += Math.sign(nx) * 0.0038 * pad;

    const philtrum =
      Math.exp(-Math.pow(nx / 0.055, 2)) *
      Math.exp(-Math.pow((ny + 0.32) / 0.12, 2)) *
      smoothstep(0.65, 0.99, nz);
    z -= 0.0038 * philtrum;

    // Large forward-facing feline orbital sockets + sculpted brow arches
    for (const side of [-1, 1] as const) {
      const dx = nx - side * 0.37;
      const dy = ny - 0.10;
      const dz = nz - 0.84;
      const distSq = dx * dx + dy * dy + dz * dz;
      const socket = Math.exp(-distSq / 0.068);
      z -= 0.0082 * socket;
      x -= side * 0.0018 * socket;

      const brow = Math.exp(
        -(Math.pow(dx * 1.15, 2) + Math.pow((ny - 0.33) * 1.85, 2) + Math.pow((nz - 0.76) * 1.5, 2)) /
          0.08
      );
      z += 0.0034 * brow;
      y += 0.0025 * brow;
    }

    // Dainty feline chin & broad occipital transition into the neck
    const chin = smoothstep(-0.34, -0.82, ny) * smoothstep(0.38, 0.9, nz);
    y -= 0.0022 * chin;
    z -= 0.0028 * chin;
    const occiput = smoothstep(-0.10, -0.85, ny) * smoothstep(0.30, -0.62, nz);
    y -= 0.011 * occiput;
    z -= 0.006 * occiput;

    pos.setXYZ(i, x, y, z);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * High-poly (40x30 = 1,271 vertices per ear) upright feline ear pinna with
 * skull-embedded curved root skirt, tragus ridge, and Henry's pocket lateral fold.
 */
function createSculptedEarGeometry(): THREE.BufferGeometry {
  const segU = 40;
  const segV = 30;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    const widthProfile = Math.pow(1 - v * 0.94, 0.72) * 0.0205;
    const depthProfile = Math.pow(1 - v * 0.9, 0.76) * 0.0080;
    const curveZ = -Math.pow(v, 2.2) * 0.0035 + Math.sin(v * Math.PI) * 0.0025;

    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const theta = u * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      let x = cosT * widthProfile;
      let z = sinT * depthProfile + curveZ;
      const rootWrap = (1 - smoothstep(0, 0.30, v)) * (0.008 + Math.abs(cosT) * 0.007);
      const h = v * 0.056 - rootWrap;

      if (sinT > 0) {
        const centerMask = Math.pow(sinT, 1.25) * (1 - Math.pow(cosT, 2) * 0.88);
        const midHeightMask = Math.sin(v * Math.PI);
        z -= centerMask * midHeightMask * 0.0054;
      } else {
        z += sinT * (1 - v) * 0.0036;
      }

      // Henry's pocket & tragus fold along outer lower rim
      const henrysNotch =
        Math.exp(-Math.pow((v - 0.32) / 0.09, 2)) *
        Math.exp(-Math.pow((cosT - 0.88) / 0.2, 2));
      x -= henrysNotch * 0.0018;
      z -= henrysNotch * 0.0012;

      const tragus =
        Math.exp(-Math.pow((v - 0.2) / 0.14, 2)) *
        Math.exp(-Math.pow((cosT - 0.55) / 0.35, 2));
      x -= tragus * 0.0016;

      positions.push(x, h, z);
      uvs.push(u, v);
    }
  }

  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * (segU + 1) + iu;
      const b = a + 1;
      const c = (iv + 1) * (segU + 1) + iu;
      const d = c + 1;
      indices.push(a, d, b, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * High-poly (44x32 = 1,485 vertices) sculpted 4-toed feline paw with distinct arched toes,
 * inter-digital valleys, subtle tarsal slope, and flush plantar sole at y = 0.
 */
function createSculptedFelinePawGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 48, 36);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i);
    const ny = pos.getY(i);
    const nz = pos.getZ(i);

    let x = nx * 0.015;
    let y = ny * 0.0102;
    let z = nz * 0.0205;

    // Flatten plantar bottom pad cleanly at stone level
    if (ny < -0.14) {
      y = lerp(y, -0.009, smoothstep(-0.14, -0.82, ny));
    }

    // 4 sculpted arched feline toes (inner 2 slightly longer, distinct inter-digital creases)
    if (nz > 0.08) {
      const frontMask = smoothstep(0.08, 0.94, nz);
      x *= 1 + 0.16 * frontMask;
      const toeWave = Math.cos(nx * Math.PI * 3.9);
      const digitArch = Math.max(0, toeWave);
      const valley = Math.max(0, -toeWave);
      const middleBias = 1.0 - smoothstep(0.25, 0.95, Math.abs(nx)) * 0.45;
      y += digitArch * 0.0030 * frontMask * smoothstep(-0.25, 0.65, ny);
      y -= valley * 0.0018 * frontMask * smoothstep(-0.1, 0.7, ny);
      z += (digitArch * 0.0042 * middleBias - valley * 0.0015) * frontMask;
    }

    // Smooth wrist/ankle collar rising into continuous limb mesh
    if (nz < -0.15 && ny > 0.1) {
      y += smoothstep(0.1, 0.9, ny) * smoothstep(-0.15, -0.8, nz) * 0.004;
    }

    pos.setXYZ(i, x, y + 0.0092, z + 0.0075);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sculpted feline triangular nose leather with indented comma nostril cavities and philtrum cleft.
 */
function createSculptedNoseGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 36, 28);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i);
    const ny = pos.getY(i);
    const nz = pos.getZ(i);

    const taper = lerp(0.55, 1.15, smoothstep(-0.8, 0.8, ny));
    const nostrilFlare =
      Math.exp(-Math.pow((Math.abs(nx) - 0.56) / 0.25, 2)) *
      Math.exp(-Math.pow((ny + 0.08) / 0.45, 2));
    const nostrilPit =
      Math.exp(-Math.pow((Math.abs(nx) - 0.45) / 0.16, 2)) *
      Math.exp(-Math.pow((ny + 0.14) / 0.24, 2)) *
      smoothstep(0.25, 0.96, nz);
    const cleft =
      Math.exp(-Math.pow(nx / 0.14, 2)) * smoothstep(0.1, -0.9, ny) * smoothstep(0.2, 0.9, nz);

    const x = nx * 0.0056 * taper + Math.sign(nx) * nostrilFlare * 0.0010;
    const y = ny * 0.0038;
    const z = nz * 0.0036 - cleft * 0.0011 - nostrilPit * 0.0014;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

interface DynamicLimbMesh {
  geometry: THREE.BufferGeometry;
  group: THREE.Group;
  updateFromJoints: (
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3
  ) => void;
}

/**
 * Continuous seamless 44x28 (1,305-vert) anatomical skinned limb mesh spanning from torso wall
 * (scapula/deltoid or gluteal/quadriceps haunch) through sculpted elbow/stifle, Achilles tendon web,
 * carpus/hock, right down into the paw wrist — ZERO separate cylinder segments or ball seams!
 */
function createDeformableLimb(
  side: -1 | 1,
  isHind: boolean,
  baseMat: THREE.Material,
  shellMats: THREE.Material[]
): DynamicLimbMesh {
  const rings = 44;
  const radial = 28;
  const vertCount = (rings + 1) * (radial + 1);

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const furLens = new Float32Array(vertCount);
  const furFlows = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const u = r / rings;
    for (let s = 0; s <= radial; s++) {
      const v = s / radial;
      const theta = v * Math.PI * 2;
      const idx = r * (radial + 1) + s;
      uvs[idx * 2] = v * 1.8;
      uvs[idx * 2 + 1] = (1 - u) * 2.8;

      // Back of upper leg/thigh has plush feathered fur ("pantaloons"); shins & ankles sleek velvet
      const backMask = Math.max(0, -Math.sin(theta));
      const featherBoost = isHind
        ? Math.exp(-Math.pow((u - 0.25) / 0.22, 2)) * backMask * 0.42
        : Math.exp(-Math.pow((u - 0.35) / 0.2, 2)) * backMask * 0.25;
      furLens[idx] = lerp(isHind ? 0.92 : 0.84, 0.24, Math.pow(u, 0.85)) + featherBoost;
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < radial; s++) {
      const a = r * (radial + 1) + s;
      const b = a + 1;
      const c = (r + 1) * (radial + 1) + s;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aFurLen', new THREE.BufferAttribute(furLens, 1));
  geometry.setAttribute('aFurFlow', new THREE.BufferAttribute(furFlows, 3));
  geometry.setIndex(indices);

  const jointCurve = new THREE.CatmullRomCurve3(
    [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
    false,
    'centripetal',
    0.4
  );

  // Precomputed tangent/center helper
  const updateFromJoints = (
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3
  ) => {
    jointCurve.points[0].copy(p0);
    jointCurve.points[1].copy(p1);
    jointCurve.points[2].copy(p2);
    jointCurve.points[3].copy(p3);

    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const flowAttr = geometry.getAttribute('aFurFlow') as THREE.BufferAttribute;

    for (let r = 0; r <= rings; r++) {
      const u = r / rings;
      jointCurve.getPointAt(u, _vec3A);
      jointCurve.getTangentAt(u, _vec3Tangent).normalize();

      // Sagittal-locked parallel transport using global lateral X so vertical legs never gimbal-flip!
      _vLimbFwd.crossVectors(_vec3Tangent, _vec3SideRef);
      if (_vLimbFwd.lengthSq() < 1e-6) {
        _vLimbFwd.set(0, 0, 1);
      } else {
        _vLimbFwd.normalize();
      }
      _vLimbSide.crossVectors(_vLimbFwd, _vec3Tangent).normalize();

      let rx: number;
      let rz: number;
      let zCenterShift = 0;
      let medialTuck = 0;

      if (!isHind) {
        // Front Leg Anatomy: Deltoid shoulder flare -> Triceps -> Olecranon elbow -> Tapered forearm -> Carpus
        const shoulderFlare = Math.exp(-Math.pow(u / 0.18, 2));
        const triceps = Math.exp(-Math.pow((u - 0.24) / 0.18, 2));
        const forearmMuscle = Math.exp(-Math.pow((u - 0.54) / 0.18, 2));
        const elbowPoint = Math.exp(-Math.pow((u - 0.39) / 0.075, 2));
        rx =
          lerp(0.023, 0.0095, Math.pow(u, 0.85)) +
          shoulderFlare * 0.011 +
          triceps * 0.003 +
          forearmMuscle * 0.0025;
        rz =
          lerp(0.030, 0.0115, Math.pow(u, 0.85)) +
          shoulderFlare * 0.016 +
          triceps * 0.006 +
          forearmMuscle * 0.004 +
          elbowPoint * 0.0045;
        zCenterShift = -elbowPoint * 0.0045;
        medialTuck = -side * shoulderFlare * 0.011;
      } else {
        // Hind Leg Anatomy: Broad Gluteal/Quad Thigh -> Stifle -> Achilles Tendon Web -> Hock -> Metatarsus
        const hipFlare = Math.exp(-Math.pow(u / 0.20, 2));
        const quadThigh = Math.exp(-Math.pow((u - 0.22) / 0.18, 2));
        const calf = Math.exp(-Math.pow((u - 0.50) / 0.16, 2));
        const hockPoint = Math.exp(-Math.pow((u - 0.72) / 0.075, 2));
        rx =
          lerp(0.029, 0.009, Math.pow(u, 0.88)) +
          hipFlare * 0.014 +
          quadThigh * 0.005 +
          calf * 0.002;
        rz =
          lerp(0.040, 0.011, Math.pow(u, 0.88)) +
          hipFlare * 0.022 +
          quadThigh * 0.009 +
          calf * 0.005 +
          hockPoint * 0.0042;
        zCenterShift = -hockPoint * 0.0042;
        medialTuck = -side * hipFlare * 0.012;
      }

      // Close top shoulder/hip root inside torso cleanly and taper wrist into paw
      const rootSeal = u < 0.03 ? Math.sin((u / 0.03) * (Math.PI / 2)) : 1.0;
      const pawEndTaper = u > 0.94 ? lerp(1.0, 0.72, (u - 0.94) / 0.06) : 1.0;
      rx *= rootSeal * pawEndTaper;
      rz *= rootSeal * pawEndTaper;

      for (let s = 0; s <= radial; s++) {
        const theta = (s / radial) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        // Sleeker Achilles tendon narrowing on lower-back of hind shin
        let achillesPinch = 1.0;
        if (isHind && u > 0.45 && u < 0.72 && sinT < -0.2) {
          achillesPinch = 1.0 - Math.sin(((u - 0.45) / 0.27) * Math.PI) * 0.26 * (-sinT);
        }

        const px = cosT * rx * achillesPinch + medialTuck;
        const pz = sinT * rz + zCenterShift;

        const wx = _vec3A.x + _vLimbSide.x * px + _vLimbFwd.x * pz;
        const wy = _vec3A.y + _vLimbSide.y * px + _vLimbFwd.y * pz;
        const wz = _vec3A.z + _vLimbSide.z * px + _vLimbFwd.z * pz;

        const idx = r * (radial + 1) + s;
        posAttr.setXYZ(idx, wx, wy, wz);
        // Hair flows cleanly down along the limb toward the paw and slightly backward
        flowAttr.setXYZ(
          idx,
          _vec3Tangent.x * 0.85,
          _vec3Tangent.y * 0.85 - 0.25,
          _vec3Tangent.z * 0.85 - 0.2
        );
      }
    }

    posAttr.needsUpdate = true;
    flowAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  };

  const group = new THREE.Group();
  addGroomedShellStack(group, geometry, baseMat, shellMats, Math.min(10, shellMats.length));

  return { geometry, group, updateFromJoints };
}

interface DynamicTorsoMesh {
  geometry: THREE.BufferGeometry;
  group: THREE.Group;
  updateFromSpine: (
    spinePoints: THREE.Vector3[],
    leftScapulaLift?: number,
    rightScapulaLift?: number,
    breathExpand?: number
  ) => void;
}

/**
 * Creates a continuous 72x64 (4,745-vert) anatomical deformable feline torso + chest + neck mesh
 * with dynamic scapula (shoulder blade) glides, sternum keel, abdominal tuck, and breathing ribs.
 */
function createDeformableTorso(
  baseMat: THREE.Material,
  shellMats: THREE.Material[]
): DynamicTorsoMesh {
  const rings = 84;
  const radial = 68;
  const vertCount = (rings + 1) * (radial + 1);

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const furLens = new Float32Array(vertCount);
  const furFlows = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  const ringRadiiX = new Float32Array(rings + 1);
  const ringRadiiY = new Float32Array(rings + 1);
  const ringCentersYOffset = new Float32Array(rings + 1);

  for (let r = 0; r <= rings; r++) {
    const u = r / rings;

    let rx = 0.048;
    let ry = 0.052;
    let yShift = 0;

    if (u < 0.06) {
      const cap = Math.sin((u / 0.06) * (Math.PI / 2));
      rx = 0.041 * cap;
      ry = 0.044 * cap;
    } else if (u < 0.72) {
      const b = (u - 0.06) / 0.66;
      const pelvisFlare = Math.exp(-Math.pow((b - 0.16) / 0.2, 2)) * 0.015;
      const waistTuck = Math.exp(-Math.pow((b - 0.48) / 0.18, 2)) * 0.010;
      const ribDeep = Math.exp(-Math.pow((b - 0.77) / 0.21, 2)) * 0.009;
      const shoulderFlare = Math.exp(-Math.pow((b - 0.85) / 0.14, 2)) * 0.010;
      rx = 0.044 + pelvisFlare * 0.85 - waistTuck * 0.68 + ribDeep * 0.6 + shoulderFlare;
      ry = 0.049 + pelvisFlare * 0.9 - waistTuck * 0.95 + ribDeep * 0.85;
      yShift = -ribDeep * 0.25 + waistTuck * 0.35;
    } else {
      const n = (u - 0.72) / 0.28;
      const chestBlend = Math.cos(n * Math.PI * 0.5);
      const neckR = lerp(0.048, 0.032, smoothstep(0, 0.82, n));
      // Keep top occipital collar broad inside the skull base so neck-head never pinches!
      const tipCap = n > 0.95 ? Math.sin(((1 - n) / 0.05) * (Math.PI / 2)) : 1.0;
      rx = (neckR + chestBlend * 0.007) * tipCap;
      ry = (neckR * 1.05 + chestBlend * 0.009) * tipCap;
    }

    ringRadiiX[r] = Math.max(0.001, rx);
    ringRadiiY[r] = Math.max(0.001, ry);
    ringCentersYOffset[r] = yShift;

    for (let s = 0; s <= radial; s++) {
      const v = s / radial;
      const idx = r * (radial + 1) + s;
      uvs[idx * 2] = v * 3.0;
      uvs[idx * 2 + 1] = u * 3.8;

      const sinT = Math.sin(v * Math.PI * 2);
      const neckTrim = smoothstep(0.84, 1.0, u);
      const ruffBoost = Math.exp(-Math.pow((u - 0.72) / 0.12, 2)) * (sinT < 0 ? 0.34 : 0.14);
      const dorsalBoost = sinT > 0.2 ? 0.18 : 0.0;
      furLens[idx] = lerp(0.85 + ruffBoost + dorsalBoost, 0.48, neckTrim);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < radial; s++) {
      const a = r * (radial + 1) + s;
      const b = a + 1;
      const c = (r + 1) * (radial + 1) + s;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aFurLen', new THREE.BufferAttribute(furLens, 1));
  geometry.setAttribute('aFurFlow', new THREE.BufferAttribute(furFlows, 3));
  geometry.setIndex(indices);

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -0.2),
    new THREE.Vector3(0, 0, -0.08),
    new THREE.Vector3(0, 0, 0.04),
    new THREE.Vector3(0, 0.02, 0.14),
    new THREE.Vector3(0, 0.09, 0.21),
  ]);

  const updateFromSpine = (
    spinePoints: THREE.Vector3[],
    leftScapulaLift = 0,
    rightScapulaLift = 0,
    breathExpand = 0
  ) => {
    for (let i = 0; i < 5; i++) {
      curve.points[i].copy(spinePoints[i]);
    }

    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const flowAttr = geometry.getAttribute('aFurFlow') as THREE.BufferAttribute;

    for (let r = 0; r <= rings; r++) {
      const u = r / rings;
      curve.getPointAt(u, _vec3A);
      curve.getTangentAt(u, _vec3Tangent).normalize();

      _vec3Binormal.crossVectors(_vec3Up, _vec3Tangent);
      if (_vec3Binormal.lengthSq() < 1e-6) {
        _vec3Binormal.set(1, 0, 0);
      } else {
        _vec3Binormal.normalize();
      }
      _vec3Normal.crossVectors(_vec3Tangent, _vec3Binormal).normalize();

      const ribMask = Math.exp(-Math.pow((u - 0.56) / 0.16, 2));
      const rx = ringRadiiX[r] + ribMask * breathExpand;
      const ry = ringRadiiY[r] + ribMask * breathExpand * 0.75;
      const yShift = ringCentersYOffset[r];
      const scapulaZone = Math.exp(-Math.pow((u - 0.64) / 0.09, 2));
      const sternumZone = Math.exp(-Math.pow((u - 0.67) / 0.12, 2));

      for (let s = 0; s <= radial; s++) {
        const v = s / radial;
        const theta = v * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        // Subtle dorsal spine furrow + sternum keel + dynamic left/right shoulder blade rise
        const spineFurrow =
          sinT > 0.72 && u > 0.12 && u < 0.78
            ? -0.0024 * Math.pow((sinT - 0.72) / 0.28, 2)
            : 0;
        const sternumKeel =
          sinT < -0.65 ? -0.0038 * sternumZone * Math.pow((-sinT - 0.65) / 0.35, 1.5) : 0;
        const sideLift = cosT < 0 ? leftScapulaLift : rightScapulaLift;
        const scapulaBump =
          scapulaZone *
          Math.exp(-Math.pow((Math.abs(cosT) - 0.62) / 0.28, 2)) *
          smoothstep(0.0, 0.75, sinT) *
          (0.0035 + sideLift * 0.45);

        const px = cosT * (rx + scapulaBump * 0.4);
        const py = sinT * ry + yShift + spineFurrow + sternumKeel + scapulaBump;

        const wx = _vec3A.x + _vec3Binormal.x * px + _vec3Normal.x * py;
        const wy = _vec3A.y + _vec3Binormal.y * px + _vec3Normal.y * py;
        const wz = _vec3A.z + _vec3Binormal.z * px + _vec3Normal.z * py;

        const idx = r * (radial + 1) + s;
        posAttr.setXYZ(idx, wx, wy, wz);
        // Coat flows head-to-tail (-tangent) and drapes softly downward along flanks
        flowAttr.setXYZ(
          idx,
          -_vec3Tangent.x * 0.9,
          -_vec3Tangent.y * 0.9 - 0.28 * (1 - Math.abs(sinT) * 0.5),
          -_vec3Tangent.z * 0.9
        );
      }
    }

    posAttr.needsUpdate = true;
    flowAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  };

  const group = new THREE.Group();
  addGroomedShellStack(group, geometry, baseMat, shellMats);

  return { geometry, group, updateFromSpine };
}

interface DynamicTailMesh {
  geometry: THREE.BufferGeometry;
  group: THREE.Group;
  updateFromTailPoints: (pts: THREE.Vector3[]) => void;
}

/**
 * Creates a seamless 60x24 (1,525-vert) continuous tapered tail sharing its dynamic GPU
 * vertex buffer across all Houdini fur shell layers with tangent-aligned coat flow.
 */
function createDeformableTail(
  baseMat: THREE.Material,
  shellMats: THREE.Material[]
): DynamicTailMesh {
  const rings = 68;
  const radial = 26;
  const vertCount = (rings + 1) * (radial + 1);

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const furLens = new Float32Array(vertCount);
  const furFlows = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const u = r / rings;
    for (let s = 0; s <= radial; s++) {
      const v = s / radial;
      const idx = r * (radial + 1) + s;
      uvs[idx * 2] = v * 1.4;
      uvs[idx * 2 + 1] = (1 - u) * 3.4;
      furLens[idx] = lerp(1.18, 0.92, u);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < radial; s++) {
      const a = r * (radial + 1) + s;
      const b = a + 1;
      const c = (r + 1) * (radial + 1) + s;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aFurLen', new THREE.BufferAttribute(furLens, 1));
  geometry.setAttribute('aFurFlow', new THREE.BufferAttribute(furFlows, 3));
  geometry.setIndex(indices);

  const curve = new THREE.CatmullRomCurve3(
    Array.from({ length: 7 }, (_, i) => new THREE.Vector3(0, 0, -i * 0.055))
  );

  const updateFromTailPoints = (pts: THREE.Vector3[]) => {
    for (let i = 0; i < 7; i++) {
      curve.points[i].copy(pts[i]);
    }

    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const flowAttr = geometry.getAttribute('aFurFlow') as THREE.BufferAttribute;

    for (let r = 0; r <= rings; r++) {
      const u = r / rings;
      curve.getPointAt(u, _vec3A);
      curve.getTangentAt(u, _vec3Tangent).normalize();

      _vec3Binormal.crossVectors(_vec3Up, _vec3Tangent);
      if (_vec3Binormal.lengthSq() < 1e-6) {
        _vec3Binormal.set(1, 0, 0);
      } else {
        _vec3Binormal.normalize();
      }
      _vec3Normal.crossVectors(_vec3Tangent, _vec3Binormal).normalize();

      const tipCap = u > 0.92 ? Math.cos(((u - 0.92) / 0.08) * (Math.PI / 2)) : 1.0;
      const radius = lerp(0.0185, 0.0078, Math.pow(u, 0.85)) * tipCap;

      for (let s = 0; s <= radial; s++) {
        const theta = (s / radial) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        const rx = (_vec3Binormal.x * cosT + _vec3Normal.x * sinT) * radius;
        const ry = (_vec3Binormal.y * cosT + _vec3Normal.y * sinT) * radius;
        const rz = (_vec3Binormal.z * cosT + _vec3Normal.z * sinT) * radius;

        const idx = r * (radial + 1) + s;
        posAttr.setXYZ(idx, _vec3A.x + rx, _vec3A.y + ry, _vec3A.z + rz);
        flowAttr.setXYZ(idx, _vec3Tangent.x, _vec3Tangent.y - 0.15, _vec3Tangent.z);
      }
    }

    posAttr.needsUpdate = true;
    flowAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  };

  const group = new THREE.Group();
  addGroomedShellStack(group, geometry, baseMat, shellMats);

  return { geometry, group, updateFromTailPoints };
}

export interface LegRig {
  skin: DynamicLimbMesh;
  paw: THREE.Group;
  pawContact: THREE.Object3D;
  isHind: boolean;
}

export interface CatRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  torso: DynamicTorsoMesh;
  tail: DynamicTailMesh;
  headPivot: THREE.Group;
  jawPivot: THREE.Group;
  earLeft: THREE.Group;
  earRight: THREE.Group;
  pupilLeft: THREE.Mesh;
  pupilRight: THREE.Mesh;
  eyelidLeft: THREE.Mesh;
  eyelidRight: THREE.Mesh;
  lowerLidLeft: THREE.Mesh;
  lowerLidRight: THREE.Mesh;
  browLeft: THREE.Group;
  browRight: THREE.Group;
  claws: THREE.Mesh[];
  furBaseMat: THREE.MeshPhysicalMaterial;
  legs: {
    fl: LegRig;
    fr: LegRig;
    bl: LegRig;
    br: LegRig;
  };
  spinePoints: THREE.Vector3[];
  tailPoints: THREE.Vector3[];
  updateFurMotion: (
    inertiaX: number,
    inertiaY: number,
    inertiaZ: number,
    windStrength: number,
    timeSec: number
  ) => void;
  disposables: Array<{ dispose: () => void }>;
}

/**
 * Builds a high-poly (~26,000+ unique vertices) photorealistic articulated cat:
 * continuous anatomical skinned limbs (zero segmented joint seams!), dynamic scapula torso,
 * sculpted 4-toed paws with toe beans, philtrum-carved feline head, embedded ears,
 * and tangent-combed Houdini fur shells.
 */
export function buildArticulatedBlackCat(
  furTex: HoudiniFurTextures,
  irisTex: PbrTextureTriplet,
  noseTex: PbrTextureTriplet,
  innerEarTex: PbrTextureTriplet,
  pawPadTex: PbrTextureTriplet,
  shellCount: number,
  variant: 'black' | 'white' = 'black'
): CatRig {
  const isWhiteCat = variant === 'white';
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const {
    baseMat: furBaseMat,
    shellMats: furShellMats,
    updateFurMotion,
  } = createGroomedFurMaterials(furTex, shellCount, 0.0175);
  track(furBaseMat);
  for (const sm of furShellMats) track(sm);

  const innerEarMat = track(
    new THREE.MeshStandardMaterial({
      color: isWhiteCat ? 0xffd5da : 0xffffff,
      map: innerEarTex.colorMap,
      normalMap: innerEarTex.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: innerEarTex.roughnessMap,
      roughness: 0.9,
      metalness: 0.0,
      envMapIntensity: 0.55,
    })
  );
  // Subtle warm crimson/amber subsurface translucency through thin backlit ear cartilage
  innerEarMat.customProgramCacheKey = () => 'feline-ear-sss-v1';
  innerEarMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float earRim = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), 2.2 );
      outgoingLight += vec3(0.18, 0.045, 0.025) * earRim;
      #include <opaque_fragment>`
    );
  };

  const wetNoseMat = track(
    new THREE.MeshPhysicalMaterial({
      color: isWhiteCat ? 0xf4a8b4 : 0xffffff,
      map: noseTex.colorMap,
      normalMap: noseTex.normalMap,
      normalScale: new THREE.Vector2(1.35, 1.35),
      roughnessMap: noseTex.roughnessMap,
      roughness: 1.0,
      metalness: 0.0,
      clearcoat: 0.94,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.55,
    })
  );

  const pawPadMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: pawPadTex.colorMap,
      normalMap: pawPadTex.normalMap,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughnessMap: pawPadTex.roughnessMap,
      roughness: 0.9,
      metalness: 0.0,
      clearcoat: 0.34,
      clearcoatRoughness: 0.28,
    })
  );

  const clawMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x3b3835,
      roughness: 0.28,
      metalness: 0.04,
      clearcoat: 0.45,
    })
  );

  const irisMat = track(
    new THREE.MeshStandardMaterial({
      map: irisTex.colorMap,
      normalMap: irisTex.normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: irisTex.roughnessMap,
      roughness: 0.85,
      metalness: 0.0,
      emissive: new THREE.Color(isWhiteCat ? 0x38bdf8 : 0xb8741c),
      emissiveIntensity: isWhiteCat ? 0.14 : 0.07,
      envMapIntensity: 0.95,
    })
  );

  const pupilMat = track(
    new THREE.MeshBasicMaterial({
      color: 0x010102,
    })
  );

  const corneaMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.004,
      metalness: 0.0,
      ior: 1.42,
      clearcoat: 1.0,
      clearcoatRoughness: 0.005,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      envMapIntensity: 3.1,
    })
  );

  const tearMeniscusMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x0a0d12,
      roughness: 0.02,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      envMapIntensity: 2.6,
    })
  );

  const whiskerMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xd4dee8,
      roughness: 0.26,
      metalness: 0.0,
      transparent: true,
      opacity: 0.64,
    })
  );

  const follicleDotMat = track(
    new THREE.MeshStandardMaterial({
      color: isWhiteCat ? 0xcfc4bc : 0x060709,
      roughness: 0.65,
    })
  );

  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const torso = createDeformableTorso(furBaseMat, furShellMats);
  track(torso.geometry);
  bodyGroup.add(torso.group);

  const tail = createDeformableTail(furBaseMat, furShellMats);
  track(tail.geometry);
  bodyGroup.add(tail.group);

  // Sculpted high-poly Feline Head + per-vertex tangent-combed Houdini fur shells
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.27, 0.22);
  bodyGroup.add(headPivot);

  const headGeo = track(createSculptedHeadGeometry());
  scaleGeometryUvs(headGeo, 5.2, 4.4);
  attachFurAttributes(headGeo, (x, y, z, nx, ny, nz) => {
    const noseClear = smoothstep(0.026, 0.048, z);
    const eyeSocketClear =
      Math.exp(-(Math.pow(Math.abs(x) - 0.0175, 2) + Math.pow(y - 0.004, 2)) / 0.00024) *
      smoothstep(0.016, 0.042, z);
    const cheekRuff =
      smoothstep(0.018, 0.046, Math.abs(x)) * smoothstep(0.012, -0.028, y);
    const raw = 0.64 + cheekRuff * 0.50 - noseClear * 0.48 - eyeSocketClear * 0.56;
    const len = Math.max(0.10, Math.min(1.18, raw));

    const sideSweep = Math.sign(x || 0.001) * smoothstep(0.01, 0.04, Math.abs(x)) * 0.45;
    const crownBack = smoothstep(-0.01, 0.035, y) * 0.85;
    const downCheek = smoothstep(0.01, -0.03, y) * 0.45;
    return {
      len,
      fx: sideSweep - nx * 0.1,
      fy: crownBack * 0.35 - downCheek - ny * 0.1,
      fz: -0.9 - nz * 0.15,
    };
  });
  addGroomedShellStack(headPivot, headGeo, furBaseMat, furShellMats, furShellMats.length);

  // Geometric Cheek Ruff & Crown Fur Tuft Clusters for Crisp Feline Silhouette
  const ruffTuftGeo = track(new THREE.ConeGeometry(0.0046, 0.022, 6));
  attachFurAttributes(ruffTuftGeo, () => ({ len: 0.42, fx: 0, fy: -0.2, fz: -0.85 }));
  for (const side of [-1, 1] as const) {
    for (let rt = 0; rt < 4; rt++) {
      const tMesh = new THREE.Mesh(ruffTuftGeo, furBaseMat);
      tMesh.position.set(side * (0.041 - rt * 0.003), -0.008 - rt * 0.0055, 0.004 - rt * 0.005);
      tMesh.rotation.set(0.28 + rt * 0.14, side * 0.25, -side * (1.28 + rt * 0.16));
      tMesh.castShadow = true;
      headPivot.add(tMesh);
    }
  }

  // Sculpted Voronoi-textured triangular feline nose leather nestled above philtrum cleft
  const noseGeo = track(createSculptedNoseGeometry());
  scaleGeometryUvs(noseGeo, 1.5, 1.5);
  const noseMesh = new THREE.Mesh(noseGeo, wetNoseMat);
  noseMesh.position.set(0, -0.0068, 0.0488);
  headPivot.add(noseMesh);

  // Articulated Lower Jaw + Oral Cavity + Tongue + Sharp Canines (for meow, hiss, pant, sadness)
  const jawPivot = new THREE.Group();
  jawPivot.position.set(0, -0.0175, 0.016);
  headPivot.add(jawPivot);

  const lowerJawGeo = track(new THREE.SphereGeometry(1, 20, 14));
  lowerJawGeo.scale(0.0175, 0.0072, 0.022);
  attachFurAttributes(lowerJawGeo, () => ({ len: 0.24, fx: 0, fy: -0.6, fz: -0.7 }));
  const lowerJawMesh = new THREE.Mesh(lowerJawGeo, furBaseMat);
  lowerJawMesh.position.set(0, -0.0035, 0.013);
  jawPivot.add(lowerJawMesh);

  const mouthInnerMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x3b0b16,
      roughness: 0.42,
      metalness: 0.0,
    })
  );
  const tongueMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xd96b7e,
      roughness: 0.32,
      metalness: 0.0,
    })
  );
  const fangMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xfaf7ef,
      roughness: 0.18,
      metalness: 0.0,
      clearcoat: 0.7,
    })
  );

  const palateGeo = track(new THREE.BoxGeometry(0.020, 0.004, 0.022));
  const palateMesh = new THREE.Mesh(palateGeo, mouthInnerMat);
  palateMesh.position.set(0, 0.001, 0.014);
  jawPivot.add(palateMesh);

  const tongueGeo = track(new THREE.SphereGeometry(0.0078, 12, 10));
  tongueGeo.scale(0.95, 0.34, 1.45);
  const tongueMesh = new THREE.Mesh(tongueGeo, tongueMat);
  tongueMesh.position.set(0, 0.0028, 0.016);
  jawPivot.add(tongueMesh);

  const fangGeo = track(new THREE.ConeGeometry(0.0014, 0.0064, 6));
  for (const side of [-1, 1] as const) {
    const upperFang = new THREE.Mesh(fangGeo, fangMat);
    upperFang.position.set(side * 0.0072, -0.0172, 0.039);
    upperFang.rotation.x = Math.PI;
    headPivot.add(upperFang);

    const lowerFang = new THREE.Mesh(fangGeo, fangMat);
    lowerFang.position.set(side * 0.0058, 0.0032, 0.025);
    lowerFang.scale.setScalar(0.8);
    jawPivot.add(lowerFang);
  }

  // Upright triangular feline ears embedded deeply inside skull dome + SSS cartilage + lynx tip tufts
  const earGeo = track(createSculptedEarGeometry());
  scaleGeometryUvs(earGeo, 3.6, 3.2);
  attachFurAttributes(earGeo, (_x, y, z) => {
    const isOuterBack = z < 0.0;
    const tipTaper = 1.0 - smoothstep(0.036, 0.055, y) * 0.62;
    return {
      len: isOuterBack ? 0.54 * tipTaper : 0.10,
      fx: 0,
      fy: 0.92,
      fz: -0.35,
    };
  });
  const buildEar = (side: -1 | 1): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(side * 0.0195, 0.0205, -0.002);
    g.rotation.set(0.06, side * 0.24, -side * 0.22);

    addGroomedShellStack(g, earGeo, furBaseMat, furShellMats, Math.min(8, furShellMats.length));

    const innerGeo = track(earGeo.clone());
    innerGeo.scale(0.56, 0.66, 0.25);
    const inner = new THREE.Mesh(innerGeo, innerEarMat);
    inner.position.set(0, 0.005, 0.0036);
    g.add(inner);

    // Tapered inner ear-furnishing wisps + delicate lynx ear-tip tufts
    for (let t = 0; t < 5; t++) {
      const tuftCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-side * 0.009, 0.008 + t * 0.0044, 0.0024),
        new THREE.Vector3(-side * 0.001, 0.011 + t * 0.0046, 0.0058),
        new THREE.Vector3(side * 0.006, 0.010 + t * 0.0040, 0.0074),
      ]);
      const tuftGeo = track(createTaperedWhiskerGeometry(tuftCurve, 0.00052, 0.00010, 8, 5));
      g.add(new THREE.Mesh(tuftGeo, whiskerMat));
    }

    for (let tip = 0; tip < 3; tip++) {
      const tipCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3((tip - 1) * 0.0015, 0.049, -0.002),
        new THREE.Vector3((tip - 1) * 0.0022, 0.056, -0.003),
        new THREE.Vector3((tip - 1) * 0.0030, 0.062, -0.005),
      ]);
      const tipGeo = track(createTaperedWhiskerGeometry(tipCurve, 0.00038, 0.00008, 6, 4));
      g.add(new THREE.Mesh(tipGeo, follicleDotMat));
    }

    headPivot.add(g);
    return g;
  };
  const earLeft = buildEar(-1);
  const earRight = buildEar(1);

  // Large forward-facing expressive cat eyes with 3D stroma-relief iris, real HDRI cornea catchlight & wet tear meniscus
  const buildEye = (side: -1 | 1) => {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(side * 0.0175, 0.0046, 0.0360);
    eyeGroup.rotation.set(0, side * 0.14, -side * 0.17);

    const irisGeo = track(new THREE.SphereGeometry(0.0138, 36, 28));
    irisGeo.scale(1.06, 0.96, 0.26);
    const irisPos = irisGeo.getAttribute('position') as THREE.BufferAttribute;
    const irisUv = irisGeo.getAttribute('uv') as THREE.BufferAttribute;
    const irisRx = 0.0138 * 1.06;
    const irisRy = 0.0138 * 0.96;
    for (let i = 0; i < irisPos.count; i++) {
      const vx = irisPos.getX(i);
      const vy = irisPos.getY(i);
      irisUv.setXY(
        i,
        clamp01(0.5 + (vx / irisRx) * 0.49),
        clamp01(0.5 + (vy / irisRy) * 0.49)
      );
    }
    irisUv.needsUpdate = true;

    const iris = new THREE.Mesh(irisGeo, irisMat);
    iris.position.z = 0.0032;
    eyeGroup.add(iris);

    const pupilGeo = track(new THREE.SphereGeometry(0.0104, 24, 20));
    pupilGeo.scale(0.24, 0.88, 0.18);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.z = 0.0068;
    eyeGroup.add(pupil);

    const corneaGeo = track(new THREE.SphereGeometry(0.0148, 36, 28));
    corneaGeo.scale(1.06, 0.96, 0.72);
    const cornea = new THREE.Mesh(corneaGeo, corneaMat);
    cornea.position.z = 0.0018;
    eyeGroup.add(cornea);

    // Wet mucosal eyelid rim & lower tear-line meniscus catching specular highlights
    const rimGeo = track(new THREE.TorusGeometry(0.0143, 0.00085, 8, 28));
    rimGeo.scale(1.05, 0.92, 0.85);
    const rimMesh = new THREE.Mesh(rimGeo, tearMeniscusMat);
    rimMesh.position.z = 0.0022;
    eyeGroup.add(rimMesh);

    const lidGeo = track(
      new THREE.SphereGeometry(0.0156, 26, 20, 0, Math.PI * 2, 0, Math.PI * 0.54)
    );
    attachFurAttributes(lidGeo, () => ({ len: 0.08, fx: 0, fy: 0.2, fz: -0.95 }));
    const eyelid = new THREE.Mesh(lidGeo, furBaseMat);
    eyelid.rotation.x = -Math.PI * 0.58;
    eyeGroup.add(eyelid);

    const lowerLid = new THREE.Mesh(lidGeo, furBaseMat);
    lowerLid.rotation.x = Math.PI * 0.56;
    lowerLid.scale.set(1.0, 0.06, 1.0);
    eyeGroup.add(lowerLid);

    // Expressive Fur Brow Ridge above each eye socket (rotates for anger, fear, sadness)
    const browGroup = new THREE.Group();
    browGroup.position.set(0, 0.0145, 0.004);
    const browGeo = track(new THREE.CapsuleGeometry(0.0022, 0.012, 4, 8));
    browGeo.rotateZ(Math.PI * 0.5);
    attachFurAttributes(browGeo, () => ({ len: 0.14, fx: 0, fy: 0.3, fz: -0.9 }));
    const browMesh = new THREE.Mesh(browGeo, furBaseMat);
    browGroup.add(browMesh);
    eyeGroup.add(browGroup);

    headPivot.add(eyeGroup);
    return { pupil, eyelid, lowerLid, browGroup };
  };

  const leftEye = buildEye(-1);
  const rightEye = buildEye(1);

  // Tapered Root-to-Tip Muzzle Whiskers (5 per side), Vibrissae Follicle Dots, Brow & Cheek Whiskers
  const follicleGeo = track(new THREE.SphereGeometry(0.00085, 6, 6));
  for (const side of [-1, 1] as const) {
    for (let w = 0; w < 5; w++) {
      const spreadY = (w - 2.0) * 0.0033;
      const spreadZ = -w * 0.0026;
      const rootPt = new THREE.Vector3(side * 0.012, -0.012 + spreadY * 0.4, 0.0435);
      const curve = new THREE.CatmullRomCurve3([
        rootPt,
        new THREE.Vector3(side * 0.046, -0.013 + spreadY, 0.039 + spreadZ),
        new THREE.Vector3(side * 0.088, -0.022 + spreadY * 1.48, 0.025 + spreadZ * 2),
      ]);
      const whiskerGeo = track(createTaperedWhiskerGeometry(curve, 0.00068, 0.00012, 14, 6));
      headPivot.add(new THREE.Mesh(whiskerGeo, whiskerMat));

      const dot = new THREE.Mesh(follicleGeo, follicleDotMat);
      dot.position.copy(rootPt).add(new THREE.Vector3(side * 0.0006, 0, 0.0004));
      headPivot.add(dot);
    }
    for (let b = 0; b < 3; b++) {
      const browCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * (0.014 + b * 0.0038), 0.016, 0.031),
        new THREE.Vector3(side * (0.024 + b * 0.0052), 0.030, 0.025),
        new THREE.Vector3(side * (0.036 + b * 0.0068), 0.041, 0.013),
      ]);
      const browGeo = track(createTaperedWhiskerGeometry(browCurve, 0.00050, 0.00010, 12, 5));
      headPivot.add(new THREE.Mesh(browGeo, whiskerMat));
    }
    for (let c = 0; c < 2; c++) {
      const cheekCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.034, -0.009 - c * 0.005, 0.019),
        new THREE.Vector3(side * 0.052, -0.012 - c * 0.007, 0.011),
        new THREE.Vector3(side * 0.068, -0.017 - c * 0.009, 0.002),
      ]);
      const cheekGeo = track(createTaperedWhiskerGeometry(cheekCurve, 0.00046, 0.00010, 10, 5));
      headPivot.add(new THREE.Mesh(cheekGeo, whiskerMat));
    }
  }

  // Sculpted 4-Toed Feline Paws + Textured Toe Bean Pads + Sheathed Claw Tips + Continuous Skinned Limbs
  const pawGeo = track(createSculptedFelinePawGeometry());
  scaleGeometryUvs(pawGeo, 2.8, 2.8);
  attachFurAttributes(pawGeo, (_x, y) => ({
    len: y < 0.004 ? 0.14 : 0.30,
    fx: 0,
    fy: -0.45,
    fz: 0.85,
  }));

  const toePadGeo = track(new THREE.SphereGeometry(0.0035, 12, 10));
  toePadGeo.scale(0.95, 0.45, 1.2);
  const centralPadGeo = track(new THREE.SphereGeometry(0.0058, 14, 12));
  centralPadGeo.scale(1.15, 0.42, 1.0);
  const clawTipGeo = track(new THREE.ConeGeometry(0.0014, 0.0068, 6));
  clawTipGeo.rotateX(Math.PI * 0.46);
  const allClaws: THREE.Mesh[] = [];

  const buildLeg = (side: -1 | 1, isHind: boolean): LegRig => {
    const skin = createDeformableLimb(side, isHind, furBaseMat, furShellMats);
    track(skin.geometry);
    bodyGroup.add(skin.group);

    const paw = new THREE.Group();
    bodyGroup.add(paw);

    const pawGroup = new THREE.Group();
    pawGroup.position.y = -0.008;
    addGroomedShellStack(pawGroup, pawGeo, furBaseMat, furShellMats, Math.min(5, furShellMats.length));

    // Textured plantar toe beans + central paw pad + extendable razor claws
    const mainPad = new THREE.Mesh(centralPadGeo, pawPadMat);
    mainPad.position.set(0, 0.0004, 0.001);
    pawGroup.add(mainPad);
    for (let d = 0; d < 4; d++) {
      const ang = (d - 1.5) * 0.36;
      const bean = new THREE.Mesh(toePadGeo, pawPadMat);
      bean.position.set(Math.sin(ang) * 0.011, 0.0005, 0.014 + Math.cos(ang) * 0.006);
      pawGroup.add(bean);

      const claw = new THREE.Mesh(clawTipGeo, clawMat);
      claw.position.set(Math.sin(ang) * 0.0115, 0.0022, 0.0205 + Math.cos(ang) * 0.0058);
      claw.scale.set(0.75, 0.75, 0.55);
      pawGroup.add(claw);
      allClaws.push(claw);
    }

    paw.add(pawGroup);

    const pawContact = new THREE.Object3D();
    pawContact.position.set(0, -0.008, 0.007);
    paw.add(pawContact);

    return { skin, paw, pawContact, isHind };
  };

  const legs = {
    fl: buildLeg(-1, false),
    fr: buildLeg(1, false),
    bl: buildLeg(-1, true),
    br: buildLeg(1, true),
  };

  // Sculpted shoulder scruff & haunch fur tufts anchored in bodyGroup
  const bodyTuftGeo = track(new THREE.ConeGeometry(0.006, 0.028, 6));
  attachFurAttributes(bodyTuftGeo, () => ({ len: 0.45, fx: 0, fy: 0.2, fz: -0.9 }));
  const shoulderTuftOffsets: Array<[number, number, number, number, number]> = [
    [-0.036, 0.24, 0.13, -0.95, 0.35],
    [0.036, 0.24, 0.13, -0.95, -0.35],
    [0, 0.27, 0.11, -1.12, 0],
    [-0.042, 0.23, -0.14, -1.05, 0.4],
    [0.042, 0.23, -0.14, -1.05, -0.4],
  ];
  for (const [tx, ty, tz, rx, rz] of shoulderTuftOffsets) {
    const bt = new THREE.Mesh(bodyTuftGeo, furBaseMat);
    bt.position.set(tx, ty, tz);
    bt.rotation.set(rx, 0, rz);
    bodyGroup.add(bt);
  }

  const spinePoints = [
    new THREE.Vector3(0, 0.21, -0.18),
    new THREE.Vector3(0, 0.215, -0.07),
    new THREE.Vector3(0, 0.218, 0.04),
    new THREE.Vector3(0, 0.232, 0.14),
    new THREE.Vector3(0, 0.305, 0.205),
  ];

  const tailPoints = Array.from(
    { length: 7 },
    (_, i) => new THREE.Vector3(0, 0.225, -0.18 - i * 0.06)
  );

  torso.updateFromSpine(spinePoints);
  tail.updateFromTailPoints(tailPoints);

  return {
    root,
    bodyGroup,
    torso,
    tail,
    headPivot,
    jawPivot,
    earLeft,
    earRight,
    pupilLeft: leftEye.pupil,
    pupilRight: rightEye.pupil,
    eyelidLeft: leftEye.eyelid,
    eyelidRight: rightEye.eyelid,
    lowerLidLeft: leftEye.lowerLid,
    lowerLidRight: rightEye.lowerLid,
    browLeft: leftEye.browGroup,
    browRight: rightEye.browGroup,
    claws: allClaws,
    furBaseMat,
    legs,
    spinePoints,
    tailPoints,
    updateFurMotion,
    disposables,
  };
}

/**
 * Procedural 1024x1024 photorealistic dark basalt flagstone + lichen + emerald moss + localized
 * sunken rainwater puddles (uses separate clearcoatMap & cavity aoMap so dry/damp stone stays matte).
 */
function createWetStoneGroundSuite(reflectionTex: THREE.Texture | null) {
  const size = 1024;
  const pixelCount = size * size;
  const heightField = new Float32Array(pixelCount);

  const colorRgba = new Uint8Array(pixelCount * 4);
  const roughRgba = new Uint8Array(pixelCount * 4);
  const clearcoatRgba = new Uint8Array(pixelCount * 4);
  const aoRgba = new Uint8Array(pixelCount * 4);
  const normRgba = new Uint8Array(pixelCount * 4);
  const alphaRgba = new Uint8Array(pixelCount * 4);

  let seed = 31337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Generate 78 irregular slate flagstone centers on a jittered grid
  const cols = 6;
  const rows = 13;
  const stones: Array<{ x: number; y: number; tint: number; puddleBias: number; crackAngle: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      stones.push({
        x: (c + 0.16 + rand() * 0.68) / cols,
        y: (r + 0.16 + rand() * 0.68) / rows,
        tint: 0.72 + rand() * 0.42,
        puddleBias: rand(),
        crackAngle: rand() * Math.PI,
      });
    }
  }

  for (let py = 0; py < size; py++) {
    const v = py / size;
    const edgeFadeV = smoothstep(0.0, 0.14, v) * smoothstep(1.0, 0.84, v);
    const gridR = Math.floor(v * rows);

    for (let px = 0; px < size; px++) {
      const u = px / size;
      const idx = py * size + px;
      const p4 = idx * 4;

      // Multi-scale organic domain warp for chiseled irregular flagstone seams
      const warpU =
        u +
        Math.sin(v * 29.0 + u * 13.0) * 0.012 +
        Math.cos(v * 63.0 - u * 41.0) * 0.0045;
      const warpV =
        v +
        Math.cos(u * 31.0 + v * 17.0) * 0.008 +
        Math.sin(u * 59.0 + v * 47.0) * 0.0035;

      const gridC = Math.floor(u * cols);
      let d1 = 999;
      let d2 = 999;
      let bestStone = stones[0];

      for (let dr = -1; dr <= 1; dr++) {
        const rr = Math.max(0, Math.min(rows - 1, gridR + dr));
        for (let dc = -1; dc <= 1; dc++) {
          const cc = Math.max(0, Math.min(cols - 1, gridC + dc));
          const st = stones[rr * cols + cc];
          const dx = (warpU - st.x) * 1.12;
          const dy = (warpV - st.y) * 2.15;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < d1) {
            d2 = d1;
            d1 = dist;
            bestStone = st;
          } else if (dist < d2) {
            d2 = dist;
          }
        }
      }

      const seamDist = d2 - d1;
      const stoneMask = smoothstep(0.008, 0.038, seamDist);
      const curbDist = Math.abs(u - 0.5) * 2.0; // 0 center -> 1 outer edge
      const curbMossWeight = smoothstep(0.48, 0.85, curbDist);

      // Multi-octave stone grain + fine mineral pitting + weathered hairline fractures
      const fbm1 = Math.sin(u * 95.0 + v * 73.0) * Math.cos(u * 61.0 - v * 89.0);
      const fbm2 = Math.sin(u * 230.0 - v * 175.0) * Math.cos(u * 195.0 + v * 260.0);
      const fbm3 = Math.sin(u * 480.0 + v * 410.0) * 0.5 + Math.cos(u * 620.0 - v * 530.0) * 0.5;
      const rockDetail = fbm1 * 0.45 + fbm2 * 0.35 + fbm3 * 0.20;

      // Hairline fracture across stone slab
      const ca = bestStone.crackAngle;
      const crackProj =
        (u - bestStone.x) * Math.cos(ca) +
        (v - bestStone.y) * Math.sin(ca) +
        fbm1 * 0.006;
      const hairlineCrack =
        bestStone.puddleBias > 0.35 ? 1.0 - smoothstep(0.0008, 0.0032, Math.abs(crackProj)) : 0.0;

      const mossNoise =
        0.5 +
        0.28 * Math.sin(u * 58.0 + Math.cos(v * 48.0) * 2.2) +
        0.22 * Math.cos(v * 104.0 - u * 44.0) +
        fbm2 * 0.14;

      const seamMoss = (1.0 - stoneMask) * smoothstep(0.30, 0.72, mossNoise);
      const mossMix = clamp01(Math.max(seamMoss * 0.90, curbMossWeight * (0.48 + mossNoise * 0.52)));

      // Subtle sage-grey stone lichen speckles near slab edges
      const edgeLichenZone = stoneMask * (1.0 - smoothstep(0.025, 0.075, seamDist));
      const lichenMask = edgeLichenZone * smoothstep(0.62, 0.85, fbm1 * 0.5 + mossNoise * 0.65) * (1.0 - mossMix);

      // Localized sunken puddles ONLY in ~18% of central path depressions (no full-floor plastic shine!)
      const macroBasin =
        0.5 +
        0.34 * Math.sin(u * 11.0 + v * 16.0 + 0.8) +
        0.22 * Math.cos(v * 25.0 - u * 19.0);
      const puddlePotential =
        macroBasin * 0.64 + bestStone.puddleBias * 0.36 - curbDist * 0.28;
      const puddleMask =
        stoneMask *
        (1.0 - mossMix) *
        smoothstep(0.64, 0.77, puddlePotential);
      // Dark wet capillary dampness ring hugging the shoreline of each puddle
      const capillaryRing =
        stoneMask *
        (1.0 - mossMix) *
        smoothstep(0.48, 0.64, puddlePotential) *
        (1.0 - puddleMask * 0.85);

      // Heightfield: flat porous stones ~0.56, fractures/crevices ~0.12, puddles ~0.46, mossy edges ~0.86
      const stoneTopH = 0.57 + rockDetail * 0.055 - hairlineCrack * 0.14;
      const seamH = 0.08 + mossNoise * 0.08;
      const rawH = lerp(seamH, stoneTopH, stoneMask);
      const puddleFlattenH = lerp(rawH, 0.45, puddleMask * 0.88);
      const h = clamp01(lerp(puddleFlattenH, 0.80 + mossNoise * 0.16, curbMossWeight * 0.78));
      heightField[idx] = h;

      // Rich charcoal-slate tones matching the real wet slate path in the bamboo plate
      const t = bestStone.tint;
      const speck = fbm3 > 0.62 ? 12 : 0;
      const slateR = (21 + rockDetail * 7 + speck) * t;
      const slateG = (29 + rockDetail * 8 + speck) * t;
      const slateB = (36 + rockDetail * 9 + speck) * t;

      const mortarR = 9;
      const mortarG = 12;
      const mortarB = 15;

      let r = lerp(mortarR, slateR, stoneMask);
      let g = lerp(mortarG, slateG, stoneMask);
      let b = lerp(mortarB, slateB, stoneMask);

      // Hairline fracture darkening
      r *= 1.0 - hairlineCrack * 0.55;
      g *= 1.0 - hairlineCrack * 0.55;
      b *= 1.0 - hairlineCrack * 0.55;

      // Lichen patches
      r = lerp(r, 48 + rockDetail * 8, lichenMask * 0.65);
      g = lerp(g, 58 + rockDetail * 8, lichenMask * 0.65);
      b = lerp(b, 46 + rockDetail * 6, lichenMask * 0.65);

      // Lush velvety emerald moss along borders & joints
      const mossR = 20 + mossNoise * 14;
      const mossG = 42 + mossNoise * 22;
      const mossB = 17 + mossNoise * 8;
      r = lerp(r, mossR, mossMix);
      g = lerp(g, mossG, mossMix);
      b = lerp(b, mossB, mossMix);

      // Wet porous darkening on capillary ring & deep absorption inside puddles
      const wetDarken = 1.0 - capillaryRing * 0.34 - puddleMask * 0.44;
      colorRgba[p4] = Math.min(255, Math.max(0, Math.round(r * wetDarken)));
      colorRgba[p4 + 1] = Math.min(255, Math.max(0, Math.round(g * wetDarken)));
      colorRgba[p4 + 2] = Math.min(255, Math.max(0, Math.round(b * wetDarken)));
      colorRgba[p4 + 3] = 255;

      // Roughness: porous basalt stays matte-damp (0.52-0.78), capillary edge (0.34), ONLY puddles mirror (0.06)
      const stoneRough = lerp(0.76, 0.56, stoneMask) + rockDetail * 0.08 - capillaryRing * 0.22;
      const wetRough = lerp(stoneRough, 0.06, puddleMask);
      const finalRough = clamp01(lerp(wetRough, 0.94, mossMix));
      const rByte = Math.round(finalRough * 255);
      roughRgba[p4] = rByte;
      roughRgba[p4 + 1] = rByte;
      roughRgba[p4 + 2] = rByte;
      roughRgba[p4 + 3] = 255;

      // Clearcoat mask: 0 on dry/damp stone & moss, 255 strictly inside sunken rainwater puddles!
      const ccVal = Math.round(clamp01(puddleMask * 1.15) * 255);
      clearcoatRgba[p4] = ccVal;
      clearcoatRgba[p4 + 1] = ccVal;
      clearcoatRgba[p4 + 2] = ccVal;
      clearcoatRgba[p4 + 3] = 255;

      // Cavity Ambient Occlusion baked directly into mortar seams, fractures, and rock pores
      const ao = clamp01(0.32 + stoneMask * 0.68 - hairlineCrack * 0.42 + rockDetail * 0.08);
      const aoByte = Math.round(ao * 255);
      aoRgba[p4] = aoByte;
      aoRgba[p4 + 1] = aoByte;
      aoRgba[p4 + 2] = aoByte;
      aoRgba[p4 + 3] = 255;

      // Soft feathered edge alpha mask so 3D ground blends seamlessly into the DSLR plate
      const edgeFadeU =
        smoothstep(0.0, 0.22 + mossNoise * 0.06, u) *
        smoothstep(1.0, 0.78 - mossNoise * 0.06, u);
      const alphaVal = Math.round(clamp01(edgeFadeU * edgeFadeV) * 255);
      alphaRgba[p4] = alphaVal;
      alphaRgba[p4 + 1] = alphaVal;
      alphaRgba[p4 + 2] = alphaVal;
      alphaRgba[p4 + 3] = 255;
    }
  }

  // Sobel tangent-space normal map matching heightField
  const strength = 6.2;
  for (let py = 0; py < size; py++) {
    const ym = Math.max(0, py - 1);
    const yp = Math.min(size - 1, py + 1);
    for (let px = 0; px < size; px++) {
      const xm = Math.max(0, px - 1);
      const xp = Math.min(size - 1, px + 1);

      const tl = heightField[ym * size + xm];
      const tc = heightField[ym * size + px];
      const tr = heightField[ym * size + xp];
      const ml = heightField[py * size + xm];
      const mr = heightField[py * size + xp];
      const bl = heightField[yp * size + xm];
      const bc = heightField[yp * size + px];
      const br = heightField[yp * size + xp];

      const dX = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const dY = bl + 2 * bc + br - (tl + 2 * tc + tr);
      let nx = -dX * strength;
      let ny = -dY * strength;
      let nz = 1.0;
      const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const p4 = (py * size + px) * 4;
      normRgba[p4] = Math.round((nx * 0.5 + 0.5) * 255);
      normRgba[p4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normRgba[p4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normRgba[p4 + 3] = 255;
    }
  }

  const makeTex = (data: Uint8Array, colorSpace: THREE.ColorSpace) => {
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.colorSpace = colorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  };

  const colorMap = makeTex(colorRgba, THREE.SRGBColorSpace);
  const normalMap = makeTex(normRgba, THREE.NoColorSpace);
  const roughnessMap = makeTex(roughRgba, THREE.NoColorSpace);
  const clearcoatMap = makeTex(clearcoatRgba, THREE.NoColorSpace);
  const aoMap = makeTex(aoRgba, THREE.NoColorSpace);
  const alphaMap = makeTex(alphaRgba, THREE.NoColorSpace);

  // Displaced 3D cobblestone mesh aligned along central path
  const geo = new THREE.PlaneGeometry(1.72, 3.45, 96, 144);
  geo.rotateX(-Math.PI / 2);
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;

  for (let i = 0; i < posAttr.count; i++) {
    const u = clamp01(uvAttr.getX(i));
    const v = clamp01(uvAttr.getY(i));
    const sx = Math.min(size - 1, Math.floor(u * (size - 1)));
    const sy = Math.min(size - 1, Math.floor((1.0 - v) * (size - 1)));
    const h = heightField[sy * size + sx];
    const centerPathFlatten = 1.0 - smoothstep(0.28, 0.50, Math.abs(u - 0.5));
    const disp = (h - 0.55) * lerp(0.034, 0.012, centerPathFlatten);
    posAttr.setY(i, Math.min(0.0004 + (1.0 - centerPathFlatten) * 0.019, disp));
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();

  const uReflTex = { value: reflectionTex };
  const uReflMatrix = { value: new THREE.Matrix4() };
  const uHasRefl = { value: reflectionTex ? 1.0 : 0.0 };
  const uGroundTime = { value: 0.0 };
  const uRipples = {
    value: [
      new THREE.Vector4(0, 0, -10, 0),
      new THREE.Vector4(0, 0, -10, 0),
      new THREE.Vector4(0, 0, -10, 0),
      new THREE.Vector4(0, 0, -10, 0),
    ],
  };

  const mat = new THREE.MeshPhysicalMaterial({
    map: colorMap,
    normalMap,
    normalScale: new THREE.Vector2(1.45, 1.45),
    roughnessMap,
    roughness: 1.0,
    metalness: 0.02,
    specularIntensity: 0.45,
    clearcoat: 0.68,
    clearcoatMap,
    clearcoatRoughness: 0.08,
    clearcoatNormalMap: normalMap,
    clearcoatNormalScale: new THREE.Vector2(0.18, 0.18),
    aoMap,
    aoMapIntensity: 1.15,
    alphaMap,
    transparent: true,
    depthWrite: true,
    envMapIntensity: 0.58,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uReflTex = uReflTex;
    shader.uniforms.uReflMatrix = uReflMatrix;
    shader.uniforms.uHasRefl = uHasRefl;
    shader.uniforms.uGroundTime = uGroundTime;
    shader.uniforms.uRipples = uRipples;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform mat4 uReflMatrix;
        varying vec3 vGroundWorldPos;
        varying vec3 vGroundViewDir;
        varying vec4 vReflClip;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 _groundWPos = modelMatrix * vec4(transformed, 1.0);
        vGroundWorldPos = _groundWPos.xyz;
        vGroundViewDir = normalize(cameraPosition - _groundWPos.xyz);
        vReflClip = uReflMatrix * _groundWPos;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uReflTex;
        uniform float uHasRefl;
        uniform float uGroundTime;
        uniform vec4 uRipples[4];
        varying vec3 vGroundWorldPos;
        varying vec3 vGroundViewDir;
        varying vec4 vReflClip;`
      )
      .replace(
        '#include <tonemapping_fragment>',
        `float rippleWave = 0.0;
        vec2 rippleDisp = vec2(0.0);
        // Paw touchdown expanding ripples
        for (int i = 0; i < 4; i++) {
          if (uRipples[i].w > 0.5) {
            float age = mod(uGroundTime - uRipples[i].z + 10.0, 10.0);
            if (age >= 0.0 && age < 1.35) {
              vec2 delta = vGroundWorldPos.xz - uRipples[i].xy;
              float dist = length(delta) + 0.0001;
              float env = exp(-dist * 7.5) * exp(-age * 2.4) * smoothstep(0.0, 0.04, dist);
              float ring = sin(dist * 72.0 - age * 15.0) * env;
              rippleWave += ring;
              rippleDisp += (delta / dist) * ring * 0.016;
            }
          }
        }
        // Subtle ambient falling raindrop splash rings on puddles
        for (int r = 0; r < 4; r++) {
          float fr = float(r);
          float cycle = uGroundTime * 0.95 + fr * 0.27;
          float dropId = floor(cycle);
          float age = fract(cycle);
          vec2 dropPos = vec2(
            sin(dropId * 12.9898 + fr * 41.2) * 0.34,
            cos(dropId * 78.233 + fr * 19.7) * 0.88 - 0.15
          );
          vec2 dlt = vGroundWorldPos.xz - dropPos;
          float d = length(dlt) + 0.0001;
          float rEnv = exp(-d * 18.0) * (1.0 - age) * smoothstep(0.0, 0.018, d);
          float rRing = sin(d * 115.0 - age * 18.0) * rEnv * 0.45;
          rippleWave += rRing;
          rippleDisp += (dlt / d) * rRing * 0.009;
        }

        // Strict puddle isolation so damp stone does not mirror
        float puddleWeight = 1.0 - smoothstep(0.06, 0.24, roughnessFactor);
        if (uHasRefl > 0.5 && vReflClip.w > 0.001 && puddleWeight > 0.01) {
          vec2 reflUv = (vReflClip.xy / vReflClip.w) * 0.5 + 0.5 + rippleDisp;
          if (reflUv.x > 0.0 && reflUv.x < 1.0 && reflUv.y > 0.0 && reflUv.y < 1.0) {
            vec3 reflCol = texture2D(uReflTex, reflUv).rgb;
            float fresnel = mix(0.22, 0.78, pow(1.0 - clamp(vGroundViewDir.y, 0.0, 1.0), 2.3));
            // Energy-conserving reflection blend (never washes out dark basalt stones)
            gl_FragColor.rgb = mix(
              gl_FragColor.rgb,
              gl_FragColor.rgb * 0.42 + reflCol * 0.92,
              puddleWeight * fresnel * 0.72
            );
          }
        }
        gl_FragColor.rgb += vec3(0.32, 0.46, 0.54) * max(0.0, rippleWave) * puddleWeight * 0.18;
        #include <tonemapping_fragment>`
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, -0.15);
  mesh.receiveShadow = true;

  const pawPrevHeights = [1.0, 1.0, 1.0, 1.0];
  let rippleCursor = 0;

  const triggerPawRipple = (pawIdx: number, wx: number, wy: number, wz: number, t: number) => {
    const prev = pawPrevHeights[pawIdx];
    if (prev >= 0.011 && wy < 0.011) {
      uRipples.value[rippleCursor].set(wx, wz, t, 1.0);
      rippleCursor = (rippleCursor + 1) % 4;
    }
    pawPrevHeights[pawIdx] = wy;
  };

  const update = (t: number, reflMatrix: THREE.Matrix4, hasReflection: boolean) => {
    uGroundTime.value = t;
    uReflMatrix.value.copy(reflMatrix);
    uHasRefl.value = hasReflection ? 1.0 : 0.0;
  };

  const dispose = () => {
    colorMap.dispose();
    normalMap.dispose();
    roughnessMap.dispose();
    clearcoatMap.dispose();
    aoMap.dispose();
    alphaMap.dispose();
    geo.dispose();
    mat.dispose();
  };

  return { mesh, triggerPawRipple, update, dispose };
}

/**
 * Blender-style Non-Destructive Plate Wetness, Photo-Normal Relighting, Puddle Reflection,
 * Persistent Wet Footprints & Paw Ripple Catcher.
 * Uses premultiplied-alpha Over compositing along a curved, perspective-tapered path silhouette
 * so untouched background pixels pass through 100% pure from the DSLR plate with ZERO mid-frame cut.
 */
function createPlateWetCatcher(reflectionTex: THREE.Texture | null) {
  const geo = new THREE.PlaneGeometry(3.2, 6.2, 40, 64);
  geo.rotateX(-Math.PI / 2);

  const uPlateTex = { value: null as THREE.Texture | null };
  const uPlateMatrix = { value: new THREE.Matrix3() };
  const uHasPlate = { value: 0.0 };
  const uReflTex = { value: reflectionTex };
  const uReflMatrix = { value: new THREE.Matrix4() };
  const uHasRefl = { value: reflectionTex ? 1.0 : 0.0 };
  const uResolution = { value: new THREE.Vector2(1280, 720) };
  const uTime = { value: 0.0 };
  const uFireflyPos = { value: new THREE.Vector3(0, 0.25, 0) };
  const uFireflyStrength = { value: 1.0 };
  const uRipples = {
    value: [
      new THREE.Vector4(0, 0, -10, 0),
      new THREE.Vector4(0, 0, -10, 0),
      new THREE.Vector4(0, 0, -10, 0),
      new THREE.Vector4(0, 0, -10, 0),
    ],
  };
  const uFootprints = {
    value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -10, 0)),
  };

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uPlateTex,
      uPlateMatrix,
      uHasPlate,
      uReflTex,
      uReflMatrix,
      uHasRefl,
      uResolution,
      uTime,
      uFireflyPos,
      uFireflyStrength,
      uRipples,
      uFootprints,
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform mat4 uReflMatrix;
      varying vec3 vWorldPos;
      varying vec3 vViewDir;
      varying vec4 vReflClip;
      void main() {
        vec4 wPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = wPos.xyz;
        vViewDir = normalize(cameraPosition - wPos.xyz);
        vReflClip = uReflMatrix * wPos;
        gl_Position = projectionMatrix * viewMatrix * wPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uPlateTex;
      uniform mat3 uPlateMatrix;
      uniform float uHasPlate;
      uniform sampler2D uReflTex;
      uniform float uHasRefl;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform vec3 uFireflyPos;
      uniform float uFireflyStrength;
      uniform vec4 uRipples[4];
      uniform vec4 uFootprints[8];
      varying vec3 vWorldPos;
      varying vec3 vViewDir;
      varying vec4 vReflClip;

      float luma3(vec3 c) {
        return dot(c, vec3(0.299, 0.587, 0.114));
      }

      void main() {
        if (uHasPlate < 0.5) discard;

        // Curved, perspective-tapered path silhouette matching the bamboo plate's real stone walkway
        float pathCenter = -0.02 + smoothstep(0.4, -3.8, vWorldPos.z) * 0.20;
        float pathHalfW = mix(0.64, 0.22, smoothstep(1.2, -3.6, vWorldPos.z));
        float sideDist = abs(vWorldPos.x - pathCenter);
        float pathMask = (1.0 - smoothstep(pathHalfW * 0.38, pathHalfW, sideDist))
          * smoothstep(-4.1, -1.35, vWorldPos.z)
          * (1.0 - smoothstep(1.10, 1.68, vWorldPos.z));
        if (pathMask <= 0.004) discard;

        // Distance atmospheric fade so puddles & ripples recede smoothly into forest mist
        float distFade = smoothstep(-3.9, -0.7, vWorldPos.z);

        // Organic puddle pockets across the real cobblestones
        float puddleNoise = 0.5
          + 0.30 * sin(vWorldPos.x * 6.5 + vWorldPos.z * 4.2 + 0.7)
          + 0.22 * cos(vWorldPos.z * 7.8 - vWorldPos.x * 5.1);
        float puddlePocket = smoothstep(0.40, 0.72, puddleNoise) * pathMask;

        // Expanding paw touchdown water ripples + delicate ambient raindrop rings
        float rippleWave = 0.0;
        vec2 rippleDisp = vec2(0.0);

        for (int i = 0; i < 4; i++) {
          if (uRipples[i].w > 0.5) {
            float age = mod(uTime - uRipples[i].z + 10.0, 10.0);
            if (age >= 0.0 && age < 1.35) {
              vec2 delta = vWorldPos.xz - uRipples[i].xy;
              float dist = length(delta) + 0.0001;
              float env = exp(-dist * 8.0) * exp(-age * 2.5) * smoothstep(0.0, 0.032, dist);
              float ring = sin(dist * 74.0 - age * 15.5) * env;
              rippleWave += ring;
              rippleDisp += (delta / dist) * ring * 0.013;
            }
          }
        }

        for (int r = 0; r < 4; r++) {
          float fr = float(r);
          float cycle = uTime * 0.92 + fr * 0.27;
          float dropId = floor(cycle);
          float age = fract(cycle);
          vec2 dropPos = vec2(
            sin(dropId * 12.9898 + fr * 41.2) * 0.30,
            cos(dropId * 78.233 + fr * 19.7) * 0.85 - 0.15
          );
          vec2 dlt = vWorldPos.xz - dropPos;
          float d = length(dlt) + 0.0001;
          float rEnv = exp(-d * 19.0) * (1.0 - age) * smoothstep(0.0, 0.015, d);
          float rRing = sin(d * 115.0 - age * 18.0) * rEnv * 0.40;
          rippleWave += rRing;
          rippleDisp += (dlt / d) * rRing * 0.006;
        }

        // Persistent damp feline paw prints that fade gently over 2.6 seconds
        float wetPrint = 0.0;
        for (int f = 0; f < 8; f++) {
          if (uFootprints[f].w > 0.5) {
            float age = mod(uTime - uFootprints[f].z + 10.0, 10.0);
            if (age >= 0.0 && age < 2.6) {
              float d = length(vWorldPos.xz - uFootprints[f].xy);
              float printSpot = 1.0 - smoothstep(0.008, 0.022, d);
              wetPrint = max(wetPrint, printSpot * exp(-age * 1.15));
            }
          }
        }

        vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
        vec2 plateUv = (uPlateMatrix * vec3(clamp(screenUv, 0.001, 0.999), 1.0)).xy;
        vec3 plateCol = texture2D(uPlateTex, clamp(plateUv, 0.001, 0.999)).rgb;

        // Extract real-time relief normal vector straight from DSLR photograph luminance
        vec2 duv = 2.0 / max(uResolution, vec2(1.0));
        float hR = luma3(texture2D(uPlateTex, clamp(plateUv + vec2(duv.x, 0.0), 0.001, 0.999)).rgb);
        float hL = luma3(texture2D(uPlateTex, clamp(plateUv - vec2(duv.x, 0.0), 0.001, 0.999)).rgb);
        float hU = luma3(texture2D(uPlateTex, clamp(plateUv + vec2(0.0, duv.y), 0.001, 0.999)).rgb);
        float hD = luma3(texture2D(uPlateTex, clamp(plateUv - vec2(0.0, duv.y), 0.001, 0.999)).rgb);
        vec3 stoneNormal = normalize(vec3((hL - hR) * 4.5, 1.0, (hD - hU) * 4.5));
        stoneNormal = normalize(mix(stoneNormal, vec3(0.0, 1.0, 0.0), puddlePocket * 0.65));

        float stoneLuma = luma3(plateCol);
        float wetStoneMask = mix(puddlePocket, pathMask, smoothstep(0.06, 0.24, stoneLuma) * 0.55) * distFade;

        // Non-destructive premultiplied-alpha effects only (never overwrites untouched background pixels!)
        float darkAlpha = wetPrint * 0.28 * pathMask * distFade;
        vec3 addLight = vec3(0.0);

        // Dynamic photo-normal-mapped 3D firefly relighting on actual cobblestones
        vec3 toFly = uFireflyPos - vWorldPos;
        float flyDist = length(toFly) + 0.001;
        vec3 flyDir = toFly / flyDist;
        float flyAtten = uFireflyStrength / (1.0 + flyDist * flyDist * 9.5);
        float flyDiff = max(0.0, dot(stoneNormal, flyDir));
        vec3 flyHalf = normalize(flyDir + vViewDir);
        float flySpec = pow(max(0.0, dot(stoneNormal, flyHalf)), mix(24.0, 96.0, wetStoneMask));
        addLight += vec3(0.95, 0.58, 0.22) * flyAtten * (flyDiff * 0.14 + flySpec * (0.18 + wetStoneMask * 0.48)) * pathMask * distFade;

        // Specular ripple wave crests catching twilight & lantern sky
        float crest = max(0.0, rippleWave) * pathMask * distFade;
        addLight += vec3(0.42, 0.56, 0.66) * crest * 0.18;

        // Live planar cat & firefly puddle reflection
        vec3 reflContrib = vec3(0.0);
        float reflAlpha = 0.0;
        if (uHasRefl > 0.5 && vReflClip.w > 0.001) {
          vec2 reflUv = (vReflClip.xy / vReflClip.w) * 0.5 + 0.5 + rippleDisp;
          if (reflUv.x > 0.0 && reflUv.x < 1.0 && reflUv.y > 0.0 && reflUv.y < 1.0) {
            vec4 reflSample = texture2D(uReflTex, reflUv);
            float fresnel = mix(0.24, 0.74, pow(1.0 - clamp(vViewDir.y, 0.0, 1.0), 2.2));
            reflAlpha = reflSample.a * wetStoneMask * fresnel * 0.58;
            reflContrib = reflSample.rgb * reflAlpha;
          }
        }

        float finalAlpha = clamp(darkAlpha + reflAlpha * (1.0 - darkAlpha), 0.0, 0.92);
        vec3 finalRgb = reflContrib * (1.0 - darkAlpha) + addLight;

        gl_FragColor = vec4(finalRgb, finalAlpha);
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, -0.0009, -1.2);
  mesh.renderOrder = 1;

  const pawPrevHeights = [1.0, 1.0, 1.0, 1.0];
  let rippleCursor = 0;
  let footprintCursor = 0;

  const triggerPawRipple = (
    pawIdx: number,
    wx: number,
    wy: number,
    wz: number,
    t: number
  ): boolean => {
    const prev = pawPrevHeights[pawIdx];
    pawPrevHeights[pawIdx] = wy;
    if (prev >= 0.011 && wy < 0.011) {
      uRipples.value[rippleCursor].set(wx, wz, t, 1.0);
      rippleCursor = (rippleCursor + 1) % 4;
      uFootprints.value[footprintCursor].set(wx, wz, t, 1.0);
      footprintCursor = (footprintCursor + 1) % 8;
      return true;
    }
    return false;
  };

  const update = (
    t: number,
    reflMatrix: THREE.Matrix4,
    hasReflection: boolean,
    plateTex: THREE.Texture | null,
    drawW: number,
    drawH: number,
    fireflyX: number,
    fireflyY: number,
    fireflyZ: number,
    fireflyStrength: number
  ) => {
    uTime.value = t;
    uReflMatrix.value.copy(reflMatrix);
    uHasRefl.value = hasReflection ? 1.0 : 0.0;
    uPlateTex.value = plateTex;
    uHasPlate.value = plateTex ? 1.0 : 0.0;
    if (plateTex) {
      uPlateMatrix.value.copy(plateTex.matrix);
    }
    uResolution.value.set(Math.max(1, drawW), Math.max(1, drawH));
    uFireflyPos.value.set(fireflyX, fireflyY, fireflyZ);
    uFireflyStrength.value = fireflyStrength;
  };

  const dispose = () => {
    geo.dispose();
    mat.dispose();
  };

  return { mesh, triggerPawRipple, update, dispose };
}

/**
 * Seamless multi-octave world-space volumetric valley mist bridging the crisp foreground
 * stone path and the distant misty bamboo forest so there is zero hard horizon split.
 */
function createVolumetricValleyMist() {
  const geo = new THREE.PlaneGeometry(5.6, 1.15, 1, 1);
  const uTime = { value: 0.0 };

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 wPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = wPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * wPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorldPos;

      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
          mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.55;
        for (int i = 0; i < 3; i++) {
          v += a * vnoise(p);
          p = p * 2.05 + vec2(3.7, 1.9);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        // Ultra-soft Gaussian falloff on all 4 edges (never shows card borders)
        float edgeX = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
        float edgeY = smoothstep(0.0, 0.24, vUv.y) * exp(-pow(max(0.0, vUv.y - 0.18) * 1.9, 2.0));
        vec2 drift = vec2(uTime * 0.075, -uTime * 0.025);
        float wisp = fbm(vWorldPos.xz * vec2(1.15, 0.75) + drift + vec2(vUv.y * 1.4, 0.0));
        float density = edgeX * edgeY * smoothstep(0.24, 0.84, wisp);

        // Warm stone-lantern scatter on upper-left fading into cool slate-teal forest mist
        float lanternScatter = smoothstep(0.6, -1.6, vWorldPos.x) * smoothstep(0.08, 0.45, vUv.y);
        vec3 mistCol = mix(vec3(0.068, 0.118, 0.155), vec3(0.16, 0.125, 0.085), lanternScatter * 0.28);

        gl_FragColor = vec4(mistCol, density * 0.24);
        #include <colorspace_fragment>
      }
    `,
  });

  const group = new THREE.Group();
  const zOffsets = [-0.95, -1.75, -2.65];
  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < zOffsets.length; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set((i - 1) * 0.12, 0.14 + i * 0.035, zOffsets[i]);
    m.renderOrder = 6;
    group.add(m);
    meshes.push(m);
  }

  const update = (t: number) => {
    uTime.value = t;
    for (let i = 0; i < meshes.length; i++) {
      meshes[i].position.x = (i - 1) * 0.12 + Math.sin(t * 0.28 + i * 1.7) * 0.10;
    }
  };

  const dispose = () => {
    geo.dispose();
    mat.dispose();
  };

  return { group, update, dispose };
}

/**
 * Subtle 2.5D parallax bamboo culms & mossy stone edge tufts flanking the midground walkway
 * to unify the 3D cat & wet ground seamlessly with the misty bamboo forest backplate.
 */
function createParallaxBambooFraming() {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const culmMat = new THREE.MeshStandardMaterial({
    color: 0x132221,
    roughness: 0.44,
    metalness: 0.04,
    envMapIntensity: 0.72,
  });
  const nodeMat = new THREE.MeshStandardMaterial({
    color: 0x0b1616,
    roughness: 0.52,
    metalness: 0.02,
  });
  const mossRockMat = new THREE.MeshStandardMaterial({
    color: 0x142419,
    roughness: 0.88,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });
  disposables.push(culmMat, nodeMat, mossRockMat);

  const culmGeo = new THREE.CylinderGeometry(0.022, 0.028, 2.2, 12, 1);
  const nodeGeo = new THREE.TorusGeometry(0.0255, 0.0032, 6, 12);
  nodeGeo.rotateX(Math.PI / 2);
  const rockGeo = new THREE.IcosahedronGeometry(0.085, 2);
  disposables.push(culmGeo, nodeGeo, rockGeo);

  const stalks: Array<{ x: number; z: number; scale: number; leanZ: number; leanX: number }> = [
    { x: -0.96, z: -0.75, scale: 1.15, leanZ: 0.03, leanX: -0.04 },
    { x: -1.16, z: -1.25, scale: 0.96, leanZ: -0.02, leanX: -0.02 },
    { x: -0.88, z: -1.85, scale: 0.92, leanZ: 0.02, leanX: 0.03 },
    { x: -1.08, z: -2.45, scale: 1.05, leanZ: -0.03, leanX: -0.02 },
    { x: 0.86, z: -0.68, scale: 1.18, leanZ: 0.02, leanX: 0.03 },
    { x: 1.06, z: -1.18, scale: 0.98, leanZ: -0.03, leanX: 0.05 },
    { x: 0.84, z: -1.78, scale: 0.90, leanZ: 0.02, leanX: -0.02 },
    { x: 1.04, z: -2.35, scale: 1.02, leanZ: -0.02, leanX: 0.03 },
  ];

  for (const s of stalks) {
    const stalk = new THREE.Group();
    stalk.position.set(s.x, 0.85, s.z);
    stalk.rotation.set(s.leanZ, 0, s.leanX);
    stalk.scale.set(s.scale, 1, s.scale);

    const mesh = new THREE.Mesh(culmGeo, culmMat);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    stalk.add(mesh);

    for (let n = -3; n <= 3; n++) {
      const ring = new THREE.Mesh(nodeGeo, nodeMat);
      ring.position.y = n * 0.26;
      stalk.add(ring);
    }
    group.add(stalk);
  }

  const borderRocks: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number }> = [
    { x: -0.62, y: -0.02, z: 0.35, sx: 1.4, sy: 0.45, sz: 1.9, ry: 0.4 },
    { x: -0.58, y: -0.015, z: -0.45, sx: 1.3, sy: 0.50, sz: 1.6, ry: -0.3 },
    { x: -0.52, y: -0.01, z: -1.20, sx: 1.5, sy: 0.55, sz: 1.8, ry: 0.8 },
    { x: 0.62, y: -0.02, z: 0.25, sx: 1.3, sy: 0.42, sz: 1.7, ry: -0.5 },
    { x: 0.56, y: -0.015, z: -0.55, sx: 1.2, sy: 0.48, sz: 1.5, ry: 0.2 },
    { x: 0.54, y: -0.01, z: -1.30, sx: 1.4, sy: 0.52, sz: 1.7, ry: 0.9 },
  ];

  for (const br of borderRocks) {
    const rMesh = new THREE.Mesh(rockGeo, mossRockMat);
    rMesh.position.set(br.x, br.y, br.z);
    rMesh.scale.set(br.sx, br.sy, br.sz);
    rMesh.rotation.y = br.ry;
    rMesh.receiveShadow = true;
    group.add(rMesh);
  }

  const dispose = () => {
    for (const d of disposables) d.dispose();
  };

  return { group, dispose };
}

/**
 * Deterministic 3D micro-water splash droplet system triggered by paw impacts on wet flagstones.
 */
function createPawSplashSystem() {
  const maxDrops = 72;
  const positions = new Float32Array(maxDrops * 3);
  // x0, z0, vx, vy0, vz, startTime, active
  const meta = new Float32Array(maxDrops * 7);
  for (let i = 0; i < maxDrops; i++) {
    positions[i * 3 + 1] = -5.0;
    meta[i * 7 + 6] = 0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const tex = createSoftRadialTexture(
    'rgba(225, 240, 250, 0.85)',
    'rgba(165, 200, 224, 0.35)',
    'rgba(0, 0, 0, 0)'
  );
  const mat = new THREE.PointsMaterial({
    size: 0.0085,
    map: tex,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  let cursor = 0;
  let splashSeed = 2029;
  const sRand = () => {
    splashSeed = (splashSeed * 16807) % 2147483647;
    return (splashSeed - 1) / 2147483646;
  };

  const emitBurst = (wx: number, wz: number, t: number, count = 8, power = 1.0) => {
    for (let i = 0; i < count; i++) {
      const idx = cursor * 7;
      const ang = sRand() * Math.PI * 2;
      const spd = (0.045 + sRand() * 0.075) * power;
      meta[idx] = wx + Math.cos(ang) * 0.009;
      meta[idx + 1] = wz + Math.sin(ang) * 0.009;
      meta[idx + 2] = Math.cos(ang) * spd;
      meta[idx + 3] = (0.14 + sRand() * 0.16) * power;
      meta[idx + 4] = Math.sin(ang) * spd;
      meta[idx + 5] = t;
      meta[idx + 6] = 1;
      cursor = (cursor + 1) % maxDrops;
    }
  };

  const update = (t: number) => {
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const gravity = 0.98;
    for (let i = 0; i < maxDrops; i++) {
      const idx = i * 7;
      if (meta[idx + 6] < 0.5) {
        posAttr.setXYZ(i, 0, -5, 0);
        continue;
      }
      const age = ((t - meta[idx + 5]) % 10 + 10) % 10;
      if (age > 0.42) {
        posAttr.setXYZ(i, 0, -5, 0);
        continue;
      }
      const x = meta[idx] + meta[idx + 2] * age;
      const y = Math.max(0.001, 0.004 + meta[idx + 3] * age - 0.5 * gravity * age * age);
      const z = meta[idx + 1] + meta[idx + 4] * age;
      posAttr.setXYZ(i, x, y, z);
    }
    posAttr.needsUpdate = true;
  };

  const dispose = () => {
    geo.dispose();
    mat.dispose();
    tex.dispose();
  };

  return { points, emitBurst, update, dispose };
}

/**
 * Renders an authentic 1990s/2000s Hi8 / MiniDV camcorder viewfinder HUD onto a reusable CanvasTexture,
 * redrawing only when the 1/10s or blinking REC cadence changes (zero GC during steady frames).
 */
function createCamcorderHudOverlay() {
  const w = 640;
  const h = 360;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  let lastBucket = -1;

  const update = (tSeconds: number) => {
    const clamped = Math.max(0, Math.min(9.99, tSeconds));
    const bucket = Math.floor(clamped * 15);
    if (bucket === lastBucket) return;
    lastBucket = bucket;

    ctx.clearRect(0, 0, w, h);

    const wholeSec = Math.floor(clamped);
    const frames30 = Math.floor((clamped - wholeSec) * 30);
    const secStr = String(wholeSec).padStart(2, '0');
    const frmStr = String(frames30).padStart(2, '0');
    const blinkOn = Math.floor(clamped * 2) % 2 === 0;

    // Minimal viewfinder framing corner brackets
    ctx.strokeStyle = 'rgba(232, 238, 242, 0.26)';
    ctx.lineWidth = 1.5;
    const m = 24;
    const arm = 18;
    ctx.beginPath();
    // Top-left
    ctx.moveTo(m, m + arm);
    ctx.lineTo(m, m);
    ctx.lineTo(m + arm, m);
    // Top-right
    ctx.moveTo(w - m - arm, m);
    ctx.lineTo(w - m, m);
    ctx.lineTo(w - m, m + arm);
    // Bottom-left
    ctx.moveTo(m, h - m - arm);
    ctx.lineTo(m, h - m);
    ctx.lineTo(m + arm, h - m);
    // Bottom-right
    ctx.moveTo(w - m - arm, h - m);
    ctx.lineTo(w - m, h - m);
    ctx.lineTo(w - m, h - m - arm);
    ctx.stroke();

    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    // Top-left: Blinking REC dot + live ticking seconds/frames timecode
    if (blinkOn) {
      ctx.fillStyle = 'rgba(235, 58, 48, 0.88)';
      ctx.beginPath();
      ctx.arc(46, 42, 5.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = 'bold 14px "Courier New", Courier, monospace';
    ctx.fillStyle = 'rgba(236, 242, 246, 0.80)';
    ctx.fillText(`REC  00:00:${secStr}:${frmStr}`, 58, 35);

    // Top-right: Tape speed & night shutter mode
    ctx.textAlign = 'right';
    ctx.font = 'bold 12px "Courier New", Courier, monospace';
    ctx.fillStyle = 'rgba(222, 230, 236, 0.68)';
    ctx.fillText('SP  NIGHT 1/30', w - 36, 36);

    // Bottom-right: Classic 90s/2000s camcorder date + ticking seconds stamp
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold 13px "Courier New", Courier, monospace';
    ctx.fillStyle = 'rgba(244, 212, 148, 0.78)';
    ctx.fillText(`NOV.21 1999  23:14:${secStr}`, w - 36, h - 32);

    ctx.textAlign = 'left';
    ctx.shadowBlur = 0;
    texture.needsUpdate = true;
  };

  update(0);

  return {
    texture,
    update,
    dispose: () => texture.dispose(),
  };
}

/**
 * Custom 35mm DSLR + toggleable late-80s/90s/2000s MiniDV/Hi8 Night Camcorder finishing pass:
 * lens barrel curvature, YUV 4:1:1 analog chroma bleed, CCD vertical highlight smear,
 * subtle CRT scanlines & tape head-switching ripple, optical MTF softening, halation,
 * twilight black-point toe, 2-scale CCD grain, and live ticking-seconds viewfinder HUD.
 */
const FilmVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uHudTex: { value: null },
    uTime: { value: 0 },
    uTexelSize: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uGrainAmount: { value: 0.014 },
    uVignetteDarkness: { value: 0.28 },
    uCamcorder: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D uHudTex;
    uniform float uTime;
    uniform vec2 uTexelSize;
    uniform float uGrainAmount;
    uniform float uVignetteDarkness;
    uniform float uCamcorder;
    varying vec2 vUv;

    float rand(vec2 co) {
      float qTime = floor(uTime * 29.97);
      return fract(sin(dot(co, vec2(12.9898, 78.233)) + qTime * 7.13) * 43758.5453);
    }

    vec3 rgb2yuv(vec3 c) {
      float y = dot(c, vec3(0.299, 0.587, 0.114));
      float u = (c.b - y) * 0.493;
      float v = (c.r - y) * 0.877;
      return vec3(y, u, v);
    }

    vec3 yuv2rgb(vec3 yuv) {
      float r = yuv.x + yuv.z * 1.140;
      float g = yuv.x - yuv.y * 0.395 - yuv.z * 0.581;
      float b = yuv.x + yuv.y * 2.032;
      return vec3(r, g, b);
    }

    void main() {
      vec2 baseUv = vUv;

      // Subtle late-90s/2000s zoom-lens barrel distortion & bottom tape head-switching jitter
      if (uCamcorder > 0.5) {
        vec2 c = baseUv - 0.5;
        float r2 = dot(c, c);
        baseUv = 0.5 + c * (1.0 + 0.022 * r2);

        float qTime = floor(uTime * 29.97);
        float lineHash = fract(sin(floor(baseUv.y * 480.0) * 19.31 + qTime * 3.7) * 43758.54);
        baseUv.x += (lineHash - 0.5) * 0.00045;

        // Classic bottom VHS/Hi8 head-switching band ripple
        float headBand = 1.0 - smoothstep(0.0, 0.013, baseUv.y);
        baseUv.x += headBand * sin(baseUv.y * 420.0 + qTime * 5.0) * 0.0045;
      }

      vec2 centered = (baseUv - 0.5) * vec2(1.15, 1.0);
      float dist = length(centered);
      vec2 caOffset = (baseUv - 0.5) * pow(dist, 1.65) * mix(0.0020, 0.0032, uCamcorder);

      vec3 centerSample = vec3(
        texture2D(tDiffuse, clamp(baseUv + caOffset, 0.001, 0.999)).r,
        texture2D(tDiffuse, clamp(baseUv, 0.001, 0.999)).g,
        texture2D(tDiffuse, clamp(baseUv - caOffset, 0.001, 0.999)).b
      );

      // Subtle optical MTF softening (stronger on camcorder glass to unify CG fur & backplate)
      vec2 off = uTexelSize * mix(0.9, 1.45, uCamcorder);
      vec3 mtfBlur = (
        texture2D(tDiffuse, clamp(baseUv + vec2(off.x, 0.0), 0.001, 0.999)).rgb +
        texture2D(tDiffuse, clamp(baseUv - vec2(off.x, 0.0), 0.001, 0.999)).rgb +
        texture2D(tDiffuse, clamp(baseUv + vec2(0.0, off.y), 0.001, 0.999)).rgb +
        texture2D(tDiffuse, clamp(baseUv - vec2(0.0, off.y), 0.001, 0.999)).rgb
      ) * 0.25;
      vec3 col = mix(centerSample, mtfBlur, mix(0.18, 0.34, uCamcorder));

      // Analog 4:1:1 MiniDV/VHS horizontal chroma subsampling & subtle tape color bleed
      if (uCamcorder > 0.5) {
        vec2 chStep = vec2(uTexelSize.x * 2.6, 0.0);
        vec3 cL = texture2D(tDiffuse, clamp(baseUv - chStep, 0.001, 0.999)).rgb;
        vec3 cR = texture2D(tDiffuse, clamp(baseUv + chStep, 0.001, 0.999)).rgb;
        vec3 cL2 = texture2D(tDiffuse, clamp(baseUv - chStep * 2.0, 0.001, 0.999)).rgb;
        vec3 yuvCenter = rgb2yuv(col);
        vec3 yuvAvg = rgb2yuv((cL * 0.35 + col * 0.30 + cR * 0.25 + cL2 * 0.10));
        col = max(yuv2rgb(vec3(yuvCenter.x, yuvAvg.y, yuvAvg.z)), 0.0);

        // CCD vertical charge-transfer smear on bright point sources (firefly & stone lantern)
        float vStep = uTexelSize.y * 16.0;
        vec3 s1 = texture2D(tDiffuse, clamp(baseUv + vec2(0.0, vStep), 0.001, 0.999)).rgb;
        vec3 s2 = texture2D(tDiffuse, clamp(baseUv - vec2(0.0, vStep), 0.001, 0.999)).rgb;
        vec3 s3 = texture2D(tDiffuse, clamp(baseUv + vec2(0.0, vStep * 2.1), 0.001, 0.999)).rgb;
        vec3 s4 = texture2D(tDiffuse, clamp(baseUv - vec2(0.0, vStep * 2.1), 0.001, 0.999)).rgb;
        vec3 ccdTap = (s1 + s2 + s3 + s4) * 0.25;
        float ccdMask = smoothstep(0.68, 1.25, dot(ccdTap, vec3(0.3, 0.59, 0.11)));
        col += ccdTap * ccdMask * 0.11;
      }

      // Warm halation bleed around bright highlights + subtle upper-left stone lantern optical veiling glare
      vec2 halOff = uTexelSize * 3.5;
      vec3 halTap = (
        texture2D(tDiffuse, clamp(baseUv + vec2(halOff.x, halOff.y), 0.001, 0.999)).rgb +
        texture2D(tDiffuse, clamp(baseUv - vec2(halOff.x, halOff.y), 0.001, 0.999)).rgb
      ) * 0.5;
      float halMask = smoothstep(0.72, 1.15, dot(halTap, vec3(0.3, 0.59, 0.11)));
      col += vec3(0.14, 0.08, 0.03) * halMask;

      float lanternGlare = exp(-length((baseUv - vec2(0.16, 0.62)) * vec2(1.4, 1.0)) * 3.2);
      col += vec3(0.045, 0.025, 0.008) * lanternGlare;

      // Match twilight plate's cool-slate atmospheric black point & soft analog tape toe
      vec3 blackFloor = mix(vec3(0.007, 0.012, 0.017), vec3(0.013, 0.018, 0.024), uCamcorder);
      col = max(col, blackFloor);

      // Subtle interlace scanline texture & low-light CCD gain speckle (luma + faint shadow chroma)
      if (uCamcorder > 0.5) {
        float scan = sin(baseUv.y * 480.0 * 3.14159) * 0.013;
        col *= 1.0 - scan;

        float lumaNoise = (rand(floor(baseUv * vec2(520.0, 300.0))) - 0.5) * 0.65
          + (rand(floor(baseUv * vec2(220.0, 140.0))) - 0.5) * 0.35;
        float shadowGain = mix(1.45, 0.55, smoothstep(0.02, 0.28, dot(col, vec3(0.3, 0.59, 0.11))));
        float cNoiseR = (rand(floor(baseUv * vec2(180.0, 120.0)) + vec2(11.3, 4.7)) - 0.5);
        float cNoiseB = (rand(floor(baseUv * vec2(180.0, 120.0)) + vec2(27.9, 17.1)) - 0.5);
        col += vec3(lumaNoise * 0.022 + cNoiseR * 0.010, lumaNoise * 0.020, lumaNoise * 0.022 + cNoiseB * 0.012) * shadowGain;
      } else {
        float grain = (rand(baseUv * 400.0) - 0.5) * 0.7 + (rand(baseUv * 185.0) - 0.5) * 0.3;
        col += grain * uGrainAmount;
      }

      float vignette = smoothstep(0.46, 1.08, dist) * mix(uVignetteDarkness, uVignetteDarkness + 0.08, uCamcorder);
      col = max(col * (1.0 - vignette), 0.0);

      // Composite crisp camcorder viewfinder OSD (REC + ticking seconds + 1999 timestamp)
      if (uCamcorder > 0.5) {
        vec4 hud = texture2D(uHudTex, clamp(vUv, 0.001, 0.999));
        vec4 hudGhost = texture2D(uHudTex, clamp(vUv - vec2(uTexelSize.x * 2.0, 0.0), 0.001, 0.999));
        col = mix(col, hud.rgb * 0.78, hud.a * 0.88);
        col += hudGhost.rgb * hudGhost.a * 0.08;
      }

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export interface CgiCatSceneController {
  ready: Promise<void>;
  isSoftwareGl: boolean;
  resize: (width: number, height: number) => void;
  setLayers: (layers: CgiCompositingLayers) => void;
  renderAtTime: (tSeconds: number) => void;
  dispose: (releaseContext?: boolean) => void;
}

/**
 * Creates a self-contained Blender-style CGI compositing engine attached to any HTMLCanvasElement.
 * Works identically for the interactive fullscreen viewport AND deterministic offline video export.
 */
export function createCgiCatSceneEngine(
  canvas: HTMLCanvasElement,
  options?: {
    width?: number;
    height?: number;
    maxDpr?: number;
    disablePostProcessing?: boolean;
  }
): CgiCatSceneController {
  const initialW = options?.width ?? (canvas.clientWidth || window.innerWidth || 1280);
  const initialH = options?.height ?? (canvas.clientHeight || window.innerHeight || 720);
  const maxDpr = options?.maxDpr ?? 2;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });

  const gl = renderer.getContext();
  const isSoftwareGl = detectSoftwareGl(gl);

  const dpr = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, maxDpr);
  renderer.setPixelRatio(dpr);
  renderer.setSize(initialW, initialH, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();

  // Perspective-matched 38° lens sitting ~27cm above wet stone path
  const camera = new THREE.PerspectiveCamera(38, initialW / initialH, 0.05, 45);
  camera.position.set(0.0, 0.27, 1.88);
  camera.lookAt(0.0, 0.14, -0.35);

  const fogColor = new THREE.Color(0x0b161e);
  const atmosphericFog = new THREE.FogExp2(fogColor.getHex(), 0.085);
  scene.fog = atmosphericFog;

  let hdri = createPlateMatchedEnvironment(renderer);
  scene.environment = hdri.envMap;

  let plateTexture: THREE.Texture | null = null;
  let plateImageWidth = 16;
  let plateImageHeight = 9;
  const fallbackBgColor = new THREE.Color(0x131d25);
  scene.background = fallbackBgColor;

  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const procCanvas = document.createElement('canvas');
  procCanvas.width = 512;
  procCanvas.height = 288;
  const pCtx = procCanvas.getContext('2d');
  if (pCtx) {
    const sky = pCtx.createLinearGradient(0, 0, 0, 288);
    sky.addColorStop(0, '#0a1418');
    sky.addColorStop(0.55, '#182b30');
    sky.addColorStop(1, '#2d443d');
    pCtx.fillStyle = sky;
    pCtx.fillRect(0, 0, 512, 288);
    pCtx.fillStyle = 'rgba(245, 182, 92, 0.14)';
    pCtx.beginPath();
    pCtx.arc(380, 74, 48, 0, Math.PI * 2);
    pCtx.fill();
  }
  const tex = new THREE.CanvasTexture(procCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.matrixAutoUpdate = false;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  let currentW = initialW;
  let currentH = initialH;
  let layers: CgiCompositingLayers = { ...DEFAULT_CGI_LAYERS };

  plateTexture = tex;
  plateImageWidth = procCanvas.width;
  plateImageHeight = procCanvas.height;
  if (layers.showPlate) {
    scene.background = plateTexture;
  }
  resolveReady();

  function updatePlateTransform(
    vw: number,
    vh: number,
    zoom: number,
    panX: number,
    panY: number
  ) {
    if (!plateTexture) return;
    const viewAspect = vw / Math.max(1, vh);
    const imgAspect = plateImageWidth / Math.max(1, plateImageHeight);

    let repeatX = 1;
    let repeatY = 1;
    if (viewAspect > imgAspect) {
      repeatY = imgAspect / viewAspect;
    } else {
      repeatX = viewAspect / imgAspect;
    }
    repeatX /= zoom;
    repeatY /= zoom;

    const offsetX = (1 - repeatX) * 0.5 + panX;
    const offsetY = (1 - repeatY) * 0.5 + panY;
    plateTexture.matrix.setUvTransform(offsetX, offsetY, repeatX, repeatY, 0, 0, 0);
  }

  // =========================================================
  // BLENDER COMPOSITING RIG: Shadow Catcher + Displaced Wet Stone Ground + Planar Reflection
  // =========================================================
  const shadowGeo = new THREE.PlaneGeometry(8, 8);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.ShadowMaterial({
    color: 0x03060b,
    opacity: 0.72,
  });
  const shadowCatcher = new THREE.Mesh(shadowGeo, shadowMat);
  shadowCatcher.position.set(0, -0.0005, 0);
  shadowCatcher.receiveShadow = true;
  shadowCatcher.renderOrder = 2;
  scene.add(shadowCatcher);

  const studioFloorGeo = new THREE.PlaneGeometry(8, 8);
  studioFloorGeo.rotateX(-Math.PI / 2);
  const studioFloorMat = new THREE.MeshStandardMaterial({
    color: 0x26313a,
    roughness: 0.65,
    metalness: 0.05,
  });
  const studioFloor = new THREE.Mesh(studioFloorGeo, studioFloorMat);
  studioFloor.position.set(0, -0.002, 0);
  studioFloor.receiveShadow = true;
  studioFloor.visible = false;
  scene.add(studioFloor);

  // Half-res live planar reflection buffer (alpha=0 clear so only cat & firefly reflect onto real photo)
  const reflectionCamera = new THREE.PerspectiveCamera(38, initialW / initialH, 0.05, 45);
  const reflectionRT = isSoftwareGl
    ? null
    : new THREE.WebGLRenderTarget(
        Math.max(256, Math.floor(initialW * 0.5)),
        Math.max(256, Math.floor(initialH * 0.5)),
        {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        }
      );

  // Camera-projected real-plate wet puddle & paw-ripple catcher (used when showPlate=true)
  const plateWetCatcher = createPlateWetCatcher(reflectionRT ? reflectionRT.texture : null);
  scene.add(plateWetCatcher.mesh);

  // Studio procedural wet basalt floor (used ONLY when showPlate=false)
  const wetGroundSuite = createWetStoneGroundSuite(reflectionRT ? reflectionRT.texture : null);
  wetGroundSuite.mesh.visible = false;
  scene.add(wetGroundSuite.mesh);

  const pawSplashSystem = createPawSplashSystem();
  scene.add(pawSplashSystem.points);

  const aoTex = createSoftRadialTexture(
    'rgba(2,4,8,0.74)',
    'rgba(2,4,8,0.36)',
    'rgba(2,4,8,0.0)'
  );
  const bellyAoMat = new THREE.MeshBasicMaterial({
    map: aoTex,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const bellyAoGeo = new THREE.PlaneGeometry(0.44, 0.54);
  bellyAoGeo.rotateX(-Math.PI / 2);
  const bellyAoMesh = new THREE.Mesh(bellyAoGeo, bellyAoMat);
  bellyAoMesh.position.set(0, 0.0015, 0);
  bellyAoMesh.renderOrder = 3;
  scene.add(bellyAoMesh);

  const pawAoGeo = new THREE.PlaneGeometry(0.078, 0.098);
  pawAoGeo.rotateX(-Math.PI / 2);
  const pawAoMeshes = Array.from({ length: 4 }, () => {
    const mat = new THREE.MeshBasicMaterial({
      map: aoTex,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    });
    const m = new THREE.Mesh(pawAoGeo, mat);
    m.position.y = 0.002;
    m.renderOrder = 4;
    scene.add(m);
    return { mesh: m, mat };
  });

  const wetGlowTex = createSoftRadialTexture(
    'rgba(255, 194, 102, 0.24)',
    'rgba(255, 160, 72, 0.08)',
    'rgba(0, 0, 0, 0)'
  );
  const wetGlowMat = new THREE.MeshBasicMaterial({
    map: wetGlowTex,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const wetGlowGeo = new THREE.PlaneGeometry(0.55, 0.72);
  wetGlowGeo.rotateX(-Math.PI / 2);
  const wetGlowMesh = new THREE.Mesh(wetGlowGeo, wetGlowMat);
  wetGlowMesh.position.set(0, 0.0025, 0);
  wetGlowMesh.renderOrder = 5;
  scene.add(wetGlowMesh);

  // =========================================================
  // SUBTLE ATMOSPHERIC 3D DRIZZLE & GROUND MIST (Zero Fake Geometry)
  // =========================================================
  const propSeeded = (() => {
    let s = 5151;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  })();

  // Ultra-fine 3D falling night rain drizzle streaks catching twilight & lantern rim
  const rainCount = 135;
  const rainSeeds = new Float32Array(rainCount * 4);
  const rainPositions = new Float32Array(rainCount * 6);
  for (let i = 0; i < rainCount; i++) {
    rainSeeds[i * 4] = (propSeeded() - 0.5) * 2.2;
    rainSeeds[i * 4 + 1] = propSeeded() * 1.4;
    rainSeeds[i * 4 + 2] = -1.5 + propSeeded() * 2.7;
    rainSeeds[i * 4 + 3] = 2.6 + propSeeded() * 1.3;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xa4c4da,
    transparent: true,
    opacity: 0.09,
    depthWrite: false,
  });
  const rainLines = new THREE.LineSegments(rainGeo, rainMat);
  scene.add(rainLines);

  // Seamless volumetric valley mist bridging the crisp path stones into the bamboo forest
  const volumetricMist = createVolumetricValleyMist();
  scene.add(volumetricMist.group);

  // Subtle 3D parallax bamboo culms & mossy path-border stones
  const bambooFraming = createParallaxBambooFraming();
  scene.add(bambooFraming.group);

  // =========================================================
  // PLATE-MATCHED TWILIGHT LIGHTING (Velvety Dark Coat + Crisp Amber Rim)
  // =========================================================
  const hemiLight = new THREE.HemisphereLight(0x527896, 0x10181d, 0.85);
  scene.add(hemiLight);

  const lanternRimLight = new THREE.DirectionalLight(0xff9f45, 3.4);
  lanternRimLight.position.set(-2.2, 1.85, -2.1);
  lanternRimLight.castShadow = !isSoftwareGl;
  lanternRimLight.shadow.mapSize.set(2048, 2048);
  lanternRimLight.shadow.camera.near = 0.4;
  lanternRimLight.shadow.camera.far = 9.0;
  lanternRimLight.shadow.camera.left = -1.6;
  lanternRimLight.shadow.camera.right = 1.6;
  lanternRimLight.shadow.camera.top = 1.6;
  lanternRimLight.shadow.camera.bottom = -1.6;
  lanternRimLight.shadow.bias = -0.0005;
  lanternRimLight.shadow.normalBias = 0.012;
  scene.add(lanternRimLight);
  scene.add(lanternRimLight.target);

  const skyFillLight = new THREE.DirectionalLight(0x7ca6c8, 0.92);
  skyFillLight.position.set(1.8, 2.4, 2.2);
  scene.add(skyFillLight);

  const canopyRimLight = new THREE.DirectionalLight(0x6398aa, 1.05);
  canopyRimLight.position.set(2.0, 1.4, -2.4);
  scene.add(canopyRimLight);

  const emberPointLight = new THREE.PointLight(0xffc668, 1.85, 2.2, 2.0);
  scene.add(emberPointLight);

  // =========================================================
  // HIGH-POLY ARTICULATED 3D BLACK CAT & GROUNDED NOCTURNAL FIREFLY
  // =========================================================
  const furTex = createHoudiniFurTextures();
  const irisTex = createCatIrisTextures();
  const noseTex = createNoseLeatherTextures();
  const innerEarTex = createInnerEarTextures();
  const pawPadTex = createPawPadTextures();
  const cat = buildArticulatedBlackCat(
    furTex,
    irisTex,
    noseTex,
    innerEarTex,
    pawPadTex,
    isSoftwareGl ? 6 : 22
  );
  scene.add(cat.root);

  const emberGroup = new THREE.Group();
  const emberCoreGeo = new THREE.SphereGeometry(0.0044, 16, 12);
  const emberCoreMat = new THREE.MeshBasicMaterial({ color: 0xffdf88 });
  emberGroup.add(new THREE.Mesh(emberCoreGeo, emberCoreMat));

  const emberHaloTex = createSoftRadialTexture(
    'rgba(255, 212, 128, 0.72)',
    'rgba(255, 162, 68, 0.22)',
    'rgba(100, 190, 210, 0.0)'
  );
  const emberSpriteMat = new THREE.SpriteMaterial({
    map: emberHaloTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const emberHalo = new THREE.Sprite(emberSpriteMat);
  emberHalo.scale.set(0.075, 0.075, 1);
  emberGroup.add(emberHalo);
  scene.add(emberGroup);

  // Delicate drifting twilight forest dust motes
  const moteCount = 48;
  const motePositions = new Float32Array(moteCount * 3);
  const moteBase = new Float32Array(moteCount * 4);
  let moteSeed = 9001;
  const mRand = () => {
    moteSeed = (moteSeed * 16807) % 2147483647;
    return (moteSeed - 1) / 2147483646;
  };
  for (let i = 0; i < moteCount; i++) {
    const x = (mRand() - 0.5) * 2.2;
    const y = 0.05 + mRand() * 0.85;
    const z = -1.6 + mRand() * 2.8;
    motePositions[i * 3] = x;
    motePositions[i * 3 + 1] = y;
    motePositions[i * 3 + 2] = z;
    moteBase[i * 4] = x;
    moteBase[i * 4 + 1] = y;
    moteBase[i * 4 + 2] = z;
    moteBase[i * 4 + 3] = mRand() * Math.PI * 2;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const moteTex = createSoftRadialTexture(
    'rgba(215, 232, 244, 0.65)',
    'rgba(255, 206, 132, 0.18)',
    'rgba(0, 0, 0, 0)'
  );
  const moteMat = new THREE.PointsMaterial({
    size: 0.020,
    map: moteTex,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const motePoints = new THREE.Points(moteGeo, moteMat);
  scene.add(motePoints);

  const camcorderHud = createCamcorderHudOverlay();

  // =========================================================
  // 4x MSAA HDR POST-PROCESSING COMPOSITOR (Disabled cleanly on software GL)
  // =========================================================
  const useComposer = !isSoftwareGl && !options?.disablePostProcessing;
  let composer: EffectComposer | null = null;
  let composerTarget: THREE.WebGLRenderTarget | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  let vignettePass: ShaderPass | null = null;

  // Fallback camera-locked HUD overlay if software GL runs without EffectComposer
  const fallbackHudGeo = new THREE.PlaneGeometry(0.132, 0.074);
  const fallbackHudMat = new THREE.MeshBasicMaterial({
    map: camcorderHud.texture,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const fallbackHudMesh = new THREE.Mesh(fallbackHudGeo, fallbackHudMat);
  fallbackHudMesh.position.set(0, 0, -0.11);
  fallbackHudMesh.renderOrder = 999;
  fallbackHudMesh.visible = false;
  scene.add(camera);
  camera.add(fallbackHudMesh);

  if (useComposer) {
    composerTarget = new THREE.WebGLRenderTarget(initialW, initialH, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    composer = new EffectComposer(renderer, composerTarget);
    composer.setPixelRatio(dpr);
    composer.setSize(initialW, initialH);

    composer.addPass(new RenderPass(scene, camera));

    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(initialW, initialH),
      0.16,
      0.38,
      0.90
    );
    composer.addPass(bloomPass);

    vignettePass = new ShaderPass(FilmVignetteShader);
    vignettePass.uniforms.uHudTex.value = camcorderHud.texture;
    vignettePass.uniforms.uTexelSize.value.set(
      1 / Math.max(1, initialW * dpr),
      1 / Math.max(1, initialH * dpr)
    );
    composer.addPass(vignettePass);

    composer.addPass(new OutputPass());
  }

  function applyLayerVisibility() {
    if (layers.showPlate && plateTexture) {
      scene.background = plateTexture;
      studioFloor.visible = false;
      shadowCatcher.visible = layers.showShadowCatcher;
      plateWetCatcher.mesh.visible = layers.showShadowCatcher;
      wetGroundSuite.mesh.visible = false;
    } else {
      scene.background = fallbackBgColor;
      studioFloor.visible = layers.showShadowCatcher;
      shadowCatcher.visible = false;
      plateWetCatcher.mesh.visible = false;
      wetGroundSuite.mesh.visible = layers.showShadowCatcher;
    }

    bellyAoMesh.visible = layers.showShadowCatcher;
    for (const p of pawAoMeshes) {
      p.mesh.visible = layers.showShadowCatcher;
    }
    wetGlowMesh.visible = layers.showShadowCatcher;
    pawSplashSystem.points.visible = layers.showShadowCatcher && layers.showAtmosphere;

    lanternRimLight.visible = layers.showRimLight;
    canopyRimLight.visible = layers.showRimLight;
    emberPointLight.visible = layers.showAtmosphere;
    emberGroup.visible = layers.showAtmosphere;
    motePoints.visible = layers.showAtmosphere;
    rainLines.visible = layers.showAtmosphere;
    volumetricMist.group.visible = layers.showAtmosphere;
    bambooFraming.group.visible = true;
    scene.fog = layers.showAtmosphere ? atmosphericFog : null;

    if (vignettePass) {
      vignettePass.uniforms.uCamcorder.value = layers.camcorderLook ? 1.0 : 0.0;
    }
    fallbackHudMesh.visible = !useComposer && layers.camcorderLook;
  }

  const resize = (width: number, height: number) => {
    currentW = Math.max(1, Math.floor(width));
    currentH = Math.max(1, Math.floor(height));
    camera.aspect = currentW / currentH;
    camera.updateProjectionMatrix();
    fallbackHudMesh.scale.x = camera.aspect / (16 / 9);
    const nextDpr = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, maxDpr);
    renderer.setPixelRatio(nextDpr);
    renderer.setSize(currentW, currentH, false);
    if (reflectionRT) {
      reflectionRT.setSize(
        Math.max(256, Math.floor(currentW * 0.5)),
        Math.max(256, Math.floor(currentH * 0.5))
      );
    }
    if (composer) {
      composer.setPixelRatio(nextDpr);
      composer.setSize(currentW, currentH);
      bloomPass?.setSize(currentW, currentH);
      if (vignettePass) {
        vignettePass.uniforms.uTexelSize.value.set(
          1 / Math.max(1, currentW * nextDpr),
          1 / Math.max(1, currentH * nextDpr)
        );
      }
    }
    updatePlateTransform(currentW, currentH, 1.0, 0, 0);
  };

  const setLayers = (next: CgiCompositingLayers) => {
    layers = { ...next };
    applyLayerVisibility();
  };

  // Exact 3D chord-plane IK solvers (zero allocations) driving continuous skinned limbs
  const solveFrontLegIk = (
    leg: LegRig,
    sx: number,
    sy: number,
    sz: number,
    tx: number,
    ty: number,
    tz: number,
    pawPitchExtra: number
  ) => {
    const L1 = 0.106;
    const L2 = 0.106;

    _vLimbP0.set(sx, sy, sz);
    _vLimbP2.set(tx, ty + 0.008, tz);
    _vLimbP3.set(tx, ty, tz);

    _vLimbChord.subVectors(_vLimbP2, _vLimbP0);
    const rawDist = _vLimbChord.length();
    const dist = Math.min(L1 + L2 - 0.002, Math.max(0.035, rawDist));
    _vLimbChord.divideScalar(Math.max(1e-5, rawDist));

    _vLimbBend.crossVectors(_vLimbChord, _vec3SideRef);
    if (_vLimbBend.lengthSq() < 1e-6) {
      _vLimbBend.set(0, 0, 1);
    } else {
      _vLimbBend.normalize();
    }

    const cosA = Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    // Elbow bends BACKWARD (-_vLimbBend)
    _vLimbP1
      .copy(_vLimbP0)
      .addScaledVector(_vLimbChord, L1 * cosA)
      .addScaledVector(_vLimbBend, -L1 * sinA);

    leg.skin.updateFromJoints(_vLimbP0, _vLimbP1, _vLimbP2, _vLimbP3);
    leg.paw.position.copy(_vLimbP3);
    const rollZ = Math.atan2(tx - sx, Math.max(0.03, sy - ty));
    leg.paw.rotation.set(pawPitchExtra, 0, rollZ * 0.25);
  };

  const solveHindLegIk = (
    leg: LegRig,
    sx: number,
    sy: number,
    sz: number,
    px: number,
    py: number,
    pz: number,
    metaWorldPitch: number,
    pawPitchExtra: number
  ) => {
    const L1 = 0.114;
    const L2 = 0.114;
    const L3 = 0.056;

    _vLimbP0.set(sx, sy, sz);
    _vLimbP3.set(px, py, pz);
    _vLimbP2.set(
      px,
      py + L3 * Math.cos(metaWorldPitch),
      pz + L3 * Math.sin(metaWorldPitch)
    );

    _vLimbChord.subVectors(_vLimbP2, _vLimbP0);
    const rawDist = _vLimbChord.length();
    const dist = Math.min(L1 + L2 - 0.002, Math.max(0.035, rawDist));
    _vLimbChord.divideScalar(Math.max(1e-5, rawDist));

    _vLimbBend.crossVectors(_vLimbChord, _vec3SideRef);
    if (_vLimbBend.lengthSq() < 1e-6) {
      _vLimbBend.set(0, 0, 1);
    } else {
      _vLimbBend.normalize();
    }

    const cosA = Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    // Knee/stifle bends FORWARD (+_vLimbBend)
    _vLimbP1
      .copy(_vLimbP0)
      .addScaledVector(_vLimbChord, L1 * cosA)
      .addScaledVector(_vLimbBend, L1 * sinA);

    leg.skin.updateFromJoints(_vLimbP0, _vLimbP1, _vLimbP2, _vLimbP3);
    leg.paw.position.copy(_vLimbP3);
    const rollZ = Math.atan2(px - sx, Math.max(0.03, sy - py));
    leg.paw.rotation.set(pawPitchExtra, 0, rollZ * 0.25);
  };

  const renderAtTime = (rawSeconds: number) => {
    const t = ((rawSeconds % CGI_DURATION_SECONDS) + CGI_DURATION_SECONDS) % CGI_DURATION_SECONDS;

    // -------------------------------------------------------
    // 1. FLUID FELINE CHOREOGRAPHY, SCAPULA ROLL & WORLD-LOCKED IK
    // -------------------------------------------------------
    // 0.00 -> 3.35s: Slinky low feline stalking prowl with spine S-wave & head stabilization
    // 3.35 -> 4.42s: Deep coiled crouch + predatory butt-wiggle + target lock
    // 4.42 -> 5.95s: Explosive launch stretch, airborne paw-reach & shock-absorbing landing
    // 5.95 -> 10.0s: Sequential front-paw step into poised feline sit + ear swivel & slow blink
    const walkPhaseT = smoothstep(0, 3.35, t);
    const crouchEnter = smoothstep(3.15, 3.76, t);
    const crouchRelease = smoothstep(4.32, 4.54, t);
    const crouchBlend = crouchEnter * (1 - crouchRelease);

    const leapT = clamp01((t - 4.42) / 1.52);
    const inLeap = t >= 4.42 && t <= 5.94;
    const sitBlend = smoothstep(6.05, 7.75, t);

    // Soft cushioned shock-absorption dip & damped follow-through on landing (~5.68s)
    const landTime = t - 5.68;
    const landImpact =
      landTime > 0 ? Math.exp(-landTime * 4.6) * Math.sin(landTime * 9.5) * 0.032 : 0;

    let catX = lerp(-0.08, 0.01, walkPhaseT);
    let catZ = lerp(-1.12, -0.22, walkPhaseT);
    let catY = 0;

    if (inLeap) {
      catX = lerp(0.01, 0.04, smoothstep(0.04, 0.96, leapT));
      catZ = lerp(-0.22, 0.42, smoothstep(0.05, 0.96, leapT));
      const airT = clamp01((leapT - 0.11) / 0.78);
      catY = 4 * airT * (1 - airT) * 0.30;
    } else if (t > 5.94) {
      catX = 0.04;
      catZ = 0.42;
      catY = 0;
    }

    const walkYaw = lerp(0.14, 0.02, walkPhaseT);
    const heroYaw = lerp(0.02, -0.22, smoothstep(6.15, 8.1, t));
    const catYaw = t < 5.94 ? walkYaw : heroYaw;

    cat.root.position.set(catX, catY, catZ);
    cat.root.rotation.y = catYaw;

    // 4-Beat Feline Walk Cycle (BL -> FL -> BR -> FR) with 0.66 stance / 0.34 swing
    const strideLen = 0.27;
    const walkS = (catZ - -1.12) / strideLen;
    const walkActivity = t < 3.35 ? smoothstep(0.0, 0.22, t) * (1 - smoothstep(3.05, 3.35, t)) : 0;

    const evalWalkFoot = (
      phaseOffset: number,
      baseLocalZ: number,
      baseLocalX: number
    ): { lx: number; ly: number; lz: number; curl: number; swingPhase: number } => {
      const u = walkS + phaseOffset;
      const cycleIdx = Math.floor(u);
      const phase = u - cycleIdx;

      let worldStepZ: number;
      let liftY = 0;
      let curl = 0;
      let swingPhase = 0;

      if (phase < 0.34) {
        const sw = phase / 0.34;
        const swSmooth = sw * sw * (3 - 2 * sw);
        worldStepZ =
          -1.12 + baseLocalZ + (cycleIdx + swSmooth - phaseOffset - 0.33) * strideLen;
        liftY = Math.sin(Math.pow(sw, 0.8) * Math.PI) * 0.042 * walkActivity;
        curl = Math.sin(sw * Math.PI * 1.15) * 0.62 * walkActivity;
        swingPhase = Math.sin(sw * Math.PI);
      } else {
        worldStepZ =
          -1.12 + baseLocalZ + (cycleIdx + 1 - phaseOffset - 0.33) * strideLen;
      }

      return {
        lx: baseLocalX,
        ly: liftY,
        lz: worldStepZ - catZ,
        curl,
        swingPhase,
      };
    };

    const walkCycleAngle = walkS * Math.PI * 2;
    const walkSwayX = Math.sin(walkCycleAngle) * 0.014 * walkActivity;
    const shoulderWave = Math.sin(walkCycleAngle * 2 + 0.5) * 0.011 * walkActivity;
    const pelvisWave = Math.sin(walkCycleAngle * 2 - 0.6) * 0.011 * walkActivity;

    const wiggleEnv = smoothstep(3.62, 3.82, t) * (1 - smoothstep(4.2, 4.36, t));
    const wigglePhase = (t - 3.62) * (20.0 + smoothstep(3.62, 4.25, t) * 9.0);
    const haunchWiggleX = Math.sin(wigglePhase) * 0.018 * wiggleEnv;
    const haunchWiggleRoll = Math.cos(wigglePhase) * 0.008 * wiggleEnv;

    const breath = Math.sin(t * 2.2) * 0.0032;

    let hipY = 0.210 + pelvisWave - crouchBlend * 0.072 - landImpact * 0.55 + breath;
    let hipZ = -0.152;
    let chestY = 0.186 + shoulderWave - crouchBlend * 0.076 - landImpact + breath * 1.1;
    let chestZ = 0.132;
    let neckY = 0.242 + shoulderWave * 0.35 - crouchBlend * 0.068 - landImpact * 0.7 + breath;
    let neckZ = 0.214;

    const headAlert = smoothstep(3.05, 4.05, t) * (1 - smoothstep(6.05, 7.1, t));
    const lookAtCam = smoothstep(6.95, 8.35, t);

    if (inLeap) {
      const pushStretch = smoothstep(0.0, 0.24, leapT);
      const midArch = Math.sin(clamp01((leapT - 0.12) / 0.68) * Math.PI);
      const landDip = smoothstep(0.68, 0.96, leapT);

      hipY = lerp(0.145, 0.228, pushStretch) + midArch * 0.025 - landDip * 0.055;
      hipZ = lerp(-0.155, -0.195, pushStretch * (1 - landDip * 0.5));
      chestY = lerp(0.132, 0.268, pushStretch) + midArch * 0.02 - landDip * 0.088;
      chestZ = lerp(0.135, 0.168, pushStretch * (1 - landDip * 0.4));
      neckY = chestY + 0.052 - landDip * 0.028;
      neckZ = chestZ + 0.076;
    } else if (sitBlend > 0.001) {
      hipY = lerp(hipY, 0.068 + breath * 0.25, sitBlend);
      hipZ = lerp(hipZ, -0.105, sitBlend);
      chestY = lerp(chestY, 0.212 + breath * 0.85, sitBlend);
      chestZ = lerp(chestZ, 0.052, sitBlend);
      neckY = lerp(neckY, 0.305 + breath * 1.15, sitBlend);
      neckZ = lerp(neckZ, 0.118, sitBlend);
    }

    const headShiftX =
      Math.sin(t * 0.85) * 0.008 +
      lookAtCam * 0.019 * (1 - sitBlend * 0.25) -
      walkSwayX * 0.25;

    // Walk foot targets computed before spine so shoulder-blade scapula lift follows weight-bearing stride
    const settleToStance = smoothstep(2.92, 3.36, t);
    const walkFL = evalWalkFoot(0.25, 0.122, -0.036);
    const walkFR = evalWalkFoot(0.75, 0.122, 0.036);
    const walkBL = evalWalkFoot(0.0, -0.152, -0.041);
    const walkBR = evalWalkFoot(0.5, -0.152, 0.041);

    const leftScapulaLift =
      (1 - walkFL.swingPhase) * 0.0045 * walkActivity + Math.max(0, landImpact) * 0.12;
    const rightScapulaLift =
      (1 - walkFR.swingPhase) * 0.0045 * walkActivity + Math.max(0, landImpact) * 0.12;
    const breathExpand = (Math.sin(t * 2.2) * 0.5 + 0.5) * 0.0018;

    // Update 5-point deformable serpentine feline spine with moving scapulae & rib breathing
    cat.spinePoints[0].set(-walkSwayX * 0.7 + haunchWiggleX, hipY, hipZ - 0.036);
    cat.spinePoints[1].set(
      -walkSwayX * 0.35 + haunchWiggleX * 0.55,
      lerp(hipY, chestY, 0.34) + (crouchBlend * 0.016 + sitBlend * 0.024 + haunchWiggleRoll),
      lerp(hipZ, chestZ, 0.34)
    );
    cat.spinePoints[2].set(
      walkSwayX * 0.45 + haunchWiggleX * 0.18,
      lerp(hipY, chestY, 0.68) + (crouchBlend * 0.01 + sitBlend * 0.02),
      lerp(hipZ, chestZ, 0.68)
    );
    cat.spinePoints[3].set(walkSwayX * 0.65 + headShiftX * 0.32, chestY + 0.012, chestZ);
    cat.spinePoints[4].set(headShiftX, neckY, neckZ);
    cat.torso.updateFromSpine(
      cat.spinePoints,
      leftScapulaLift,
      rightScapulaLift,
      breathExpand
    );

    cat.headPivot.position.set(
      cat.spinePoints[4].x,
      cat.spinePoints[4].y + 0.008,
      cat.spinePoints[4].z + 0.016
    );
    const curiousTilt =
      smoothstep(7.2, 8.2, t) * Math.sin((t - 7.2) * 0.85) * 0.18 +
      smoothstep(7.7, 9.3, t) * 0.095;
    const landHeadNod =
      landTime > 0 ? Math.exp(-landTime * 5.2) * Math.sin(landTime * 11.0) * 0.22 : 0;
    const headPitch =
      (inLeap ? lerp(-0.22, 0.18, leapT) : 0.08) -
      headAlert * 0.20 -
      sitBlend * 0.10 +
      landHeadNod +
      Math.sin(t * 1.25) * 0.025;
    cat.headPivot.rotation.set(
      headPitch,
      Math.sin(t * 0.8) * 0.085 + lookAtCam * 0.28,
      curiousTilt + Math.sin(t * 1.05) * 0.025
    );

    const crouchTargetFL = { lx: -0.044, ly: 0, lz: 0.14, curl: 0 };
    const crouchTargetFR = { lx: 0.044, ly: 0, lz: 0.14, curl: 0 };
    const crouchTargetBL = { lx: -0.048, ly: 0, lz: -0.152, curl: 0 };
    const crouchTargetBR = { lx: 0.048, ly: 0, lz: -0.152, curl: 0 };

    const blendFoot = (
      a: { lx: number; ly: number; lz: number; curl: number },
      b: { lx: number; ly: number; lz: number; curl: number },
      w: number
    ) => ({
      lx: lerp(a.lx, b.lx, w),
      ly: lerp(a.ly, b.ly, w),
      lz: lerp(a.lz, b.lz, w),
      curl: lerp(a.curl, b.curl, w),
    });

    let targetFL = blendFoot(walkFL, crouchTargetFL, settleToStance);
    let targetFR = blendFoot(walkFR, crouchTargetFR, settleToStance);
    let targetBL = blendFoot(walkBL, crouchTargetBL, settleToStance);
    let targetBR = blendFoot(walkBR, crouchTargetBR, settleToStance);

    let hindMetaPitch = lerp(-0.26, -0.84, crouchBlend);

    if (inLeap) {
      const fLift = smoothstep(0.0, 0.18, leapT) * (1 - smoothstep(0.75, 0.91, leapT));
      const bLift = smoothstep(0.14, 0.30, leapT) * (1 - smoothstep(0.83, 0.98, leapT));
      const swipeReach = Math.sin(clamp01((leapT - 0.18) / 0.55) * Math.PI);
      targetFL = {
        lx: -0.040,
        ly: fLift * 0.082 + swipeReach * 0.025,
        lz: lerp(0.135, 0.225, smoothstep(0.06, 0.86, leapT)) - (1 - fLift) * 0.055,
        curl: Math.sin(leapT * Math.PI) * 0.52,
      };
      targetFR = {
        lx: 0.036,
        ly: fLift * 0.095 + swipeReach * 0.045,
        lz: lerp(0.135, 0.242, smoothstep(0.06, 0.86, leapT)) - (1 - fLift) * 0.055,
        curl: Math.sin(leapT * Math.PI) * 0.48,
      };
      targetBL = {
        lx: -0.044,
        ly: bLift * 0.045,
        lz: lerp(-0.255, -0.105, smoothstep(0.24, 0.94, leapT)),
        curl: -Math.sin(leapT * Math.PI) * 0.42,
      };
      targetBR = {
        lx: 0.044,
        ly: bLift * 0.045,
        lz: lerp(-0.255, -0.105, smoothstep(0.24, 0.94, leapT)),
        curl: -Math.sin(leapT * Math.PI) * 0.42,
      };
      hindMetaPitch = lerp(-0.84, -0.26, smoothstep(0.15, 0.9, leapT));
    } else if (sitBlend > 0.001) {
      const flStep = smoothstep(0.05, 0.55, sitBlend);
      const frStep = smoothstep(0.32, 0.82, sitBlend);
      const flArc = Math.sin(flStep * Math.PI) * 0.022;
      const frArc = Math.sin(frStep * Math.PI) * 0.020;

      targetFL = {
        lx: lerp(-0.042, -0.025, flStep),
        ly: flArc,
        lz: lerp(0.13, 0.102, flStep),
        curl: flArc * 10.0,
      };
      targetFR = {
        lx: lerp(0.042, 0.025, frStep),
        ly: frArc,
        lz: lerp(0.13, 0.102, frStep),
        curl: frArc * 10.0,
      };
      targetBL = {
        lx: lerp(-0.046, -0.048, sitBlend),
        ly: 0,
        lz: lerp(-0.145, -0.055, sitBlend),
        curl: 0,
      };
      targetBR = {
        lx: lerp(0.046, 0.048, sitBlend),
        ly: 0,
        lz: lerp(-0.145, -0.055, sitBlend),
        curl: 0,
      };
      hindMetaPitch = lerp(-0.26, -1.42, sitBlend);
    }

    const shoulderXBase = walkSwayX * 0.65 + headShiftX * 0.32;
    const hipXBase = -walkSwayX * 0.7 + haunchWiggleX;

    solveFrontLegIk(
      cat.legs.fl,
      shoulderXBase - 0.036,
      chestY + leftScapulaLift * 0.6,
      chestZ,
      targetFL.lx,
      0.008 + targetFL.ly,
      targetFL.lz,
      targetFL.curl
    );
    solveFrontLegIk(
      cat.legs.fr,
      shoulderXBase + 0.036,
      chestY + rightScapulaLift * 0.6,
      chestZ,
      targetFR.lx,
      0.008 + targetFR.ly,
      targetFR.lz,
      targetFR.curl
    );
    solveHindLegIk(
      cat.legs.bl,
      hipXBase - 0.042,
      hipY,
      hipZ,
      targetBL.lx,
      0.008 + targetBL.ly,
      targetBL.lz,
      hindMetaPitch,
      targetBL.curl
    );
    solveHindLegIk(
      cat.legs.br,
      hipXBase + 0.042,
      hipY,
      hipZ,
      targetBR.lx,
      0.008 + targetBR.ly,
      targetBR.lz,
      hindMetaPitch,
      targetBR.curl
    );

    // Graceful feline tail with natural low J-curve while stalking & curled wrap when seated
    const tailAmp = inLeap ? 0.022 : lerp(0.038, 0.085, sitBlend);
    const tailBaseY = hipY + 0.006;
    const tailBaseZ = hipZ - 0.036;
    for (let i = 0; i < 7; i++) {
      const frac = i / 6;
      const sitCurveX = sitBlend * Math.pow(frac, 1.32) * 0.145;
      const tipFlick = Math.sin(t * 2.8 - i * 0.68) * tailAmp * Math.pow(frac, 1.22);
      const sx = cat.spinePoints[0].x + sitCurveX + tipFlick;

      // Stalking feline tail drapes downward then curls upward gracefully at the tip!
      const walkJCurve =
        -0.068 * Math.sin(frac * Math.PI * 0.72) + Math.pow(frac, 2.3) * 0.062 - crouchBlend * 0.042;
      const sitArc = -0.056 * frac + Math.pow(frac, 2.1) * 0.030;
      const leapArc = lerp(0.025, -0.022, frac);

      const sy = Math.max(
        0.011,
        tailBaseY +
          (inLeap ? leapArc : lerp(walkJCurve, sitArc, sitBlend)) +
          Math.cos(t * 2.1 - i * 0.5) * 0.013 * frac
      );
      const sz = tailBaseZ - frac * lerp(0.32, 0.25, sitBlend) + sitBlend * Math.pow(frac, 2) * 0.135;
      cat.tailPoints[i].set(sx, sy, sz);
    }
    cat.tail.updateFromTailPoints(cat.tailPoints);

    // Independent subtle feline ear swivels & reactive flattening during crouch/leap
    const twitch1 = Math.exp(-Math.pow((t - 2.25) * 14, 2)) * 0.18;
    const twitch2 = Math.exp(-Math.pow((t - 8.75) * 15, 2)) * 0.20;
    const crouchFlatten = crouchBlend * 0.14;
    cat.earLeft.rotation.set(
      0.06 + headAlert * 0.08 - twitch1 * 0.35,
      -0.24 - Math.sin(t * 1.1) * 0.05 - twitch1 * 0.45,
      0.22 + twitch1 + crouchFlatten
    );
    cat.earRight.rotation.set(
      0.06 + headAlert * 0.08 - twitch2 * 0.35,
      0.24 + Math.cos(t * 0.95) * 0.05 + twitch2 * 0.45,
      -0.22 - twitch2 - crouchFlatten
    );

    // Natural slow feline blinks
    const blink1 = Math.exp(-Math.pow((t - 2.65) * 10, 2));
    const blink2 = Math.exp(-Math.pow((t - 8.25) * 8.5, 2));
    const blinkAmt = clamp01(blink1 + blink2);
    const lidRot = lerp(-Math.PI * 0.58, 0.05, blinkAmt);
    cat.eyelidLeft.rotation.x = lidRot;
    cat.eyelidRight.rotation.x = lidRot;

    const pupilScaleX = lerp(0.86, 1.85, crouchBlend + headAlert * 0.50 + sitBlend * 0.22);
    cat.pupilLeft.scale.x = pupilScaleX;
    cat.pupilRight.scale.x = pupilScaleX;

    // -------------------------------------------------------
    // 1B. DYNAMIC HAIR INERTIA, LANDING RIPPLE & BAMBOO BREEZE
    // -------------------------------------------------------
    const airTNorm = clamp01((leapT - 0.11) / 0.78);
    const leapVelY = inLeap ? (1 - 2 * airTNorm) * 0.65 : 0;
    const leapVelZ = inLeap ? 0.55 : walkActivity * 0.18;
    const furInertiaX = -haunchWiggleX * 0.16 - walkSwayX * 0.12;
    const furInertiaY = -leapVelY * 0.0038 + landImpact * 0.12;
    const furInertiaZ = -leapVelZ * 0.0042;
    const breezeAmount = inLeap ? 1.55 : lerp(0.85, 1.0, sitBlend);
    cat.updateFurMotion(furInertiaX, furInertiaY, furInertiaZ, breezeAmount, t);

    // -------------------------------------------------------
    // 2. FLOATING SPIRIT EMBER & WET GROUND REFLECTION
    // -------------------------------------------------------
    const emberX =
      t < 4.5
        ? lerp(-0.14, 0.12, smoothstep(0, 4.4, t)) + Math.sin(t * 2.2) * 0.05
        : lerp(0.12, -0.22, smoothstep(4.5, 9.8, t)) + Math.cos(t * 1.9) * 0.06;
    const emberY =
      t < 4.5
        ? 0.24 + Math.sin(t * 3.1) * 0.045
        : lerp(0.28, 0.36, smoothstep(4.5, 8.5, t)) + Math.sin(t * 2.7) * 0.04;
    const emberZ =
      t < 4.5
        ? lerp(-0.78, 0.18, smoothstep(0, 4.3, t))
        : lerp(0.18, 0.62, smoothstep(4.5, 9.2, t));

    emberGroup.position.set(emberX, emberY, emberZ);
    const fireflyPulse = 0.65 + 0.35 * Math.sin(t * 7.2) * Math.cos(t * 3.1);
    const haloScale = 0.068 + fireflyPulse * 0.024;
    emberHalo.scale.set(haloScale, haloScale, 1);

    emberPointLight.position.set(emberX, emberY + 0.03, emberZ);
    emberPointLight.intensity = 1.4 + fireflyPulse * 0.75;

    wetGlowMesh.position.set(emberX, 0.0025, emberZ);
    wetGlowMat.opacity = clamp01((0.20 - emberY * 0.28) * fireflyPulse);

    // -------------------------------------------------------
    // 3. CONTACT AO GROUNDING (Updates Shadow Under Belly & Paws)
    // -------------------------------------------------------
    cat.root.updateMatrixWorld(true);

    const heightNorm = clamp01(catY / 0.35);
    bellyAoMesh.position.set(catX, 0.0015, catZ);
    const aoScale = 1 + heightNorm * 0.65;
    bellyAoMesh.scale.set(aoScale, aoScale, 1);
    bellyAoMat.opacity = lerp(0.74, 0.16, heightNorm);

    const legList = [cat.legs.fl, cat.legs.fr, cat.legs.bl, cat.legs.br];
    for (let i = 0; i < 4; i++) {
      legList[i].pawContact.getWorldPosition(_vec3A);
      const pawH = Math.max(0, _vec3A.y);
      const contactAlpha = clamp01(1 - pawH / 0.14);
      pawAoMeshes[i].mesh.position.set(_vec3A.x, 0.002, _vec3A.z);
      const s = lerp(1.35, 0.9, contactAlpha);
      pawAoMeshes[i].mesh.scale.set(s, s, 1);
      pawAoMeshes[i].mat.opacity = contactAlpha * 0.68;

      if (layers.showShadowCatcher) {
        if (layers.showPlate && plateTexture) {
          const hit = plateWetCatcher.triggerPawRipple(i, _vec3A.x, pawH, _vec3A.z, t);
          if (hit) {
            pawSplashSystem.emitBurst(
              _vec3A.x,
              _vec3A.z,
              t,
              inLeap ? 10 : 5,
              inLeap ? 1.35 : 0.72
            );
          }
        } else {
          wetGroundSuite.triggerPawRipple(i, _vec3A.x, pawH, _vec3A.z, t);
        }
      }
    }
    pawSplashSystem.update(t);

    lanternRimLight.target.position.set(catX, 0.1, catZ);
    lanternRimLight.target.updateMatrixWorld();

    // -------------------------------------------------------
    // 4. ATMOSPHERIC MIST MOTES, GROUND MIST & FALLING NIGHT DRIZZLE
    // -------------------------------------------------------
    const posAttr = moteGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < moteCount; i++) {
      const bx = moteBase[i * 4];
      const by = moteBase[i * 4 + 1];
      const bz = moteBase[i * 4 + 2];
      const ph = moteBase[i * 4 + 3];
      posAttr.setXYZ(
        i,
        bx + Math.sin(t * 0.65 + ph) * 0.06,
        by + Math.cos(t * 0.55 + ph * 1.3) * 0.035,
        bz + Math.sin(t * 0.45 + ph * 0.7) * 0.05
      );
    }
    posAttr.needsUpdate = true;

    const rainPosAttr = rainGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < rainCount; i++) {
      const rx = rainSeeds[i * 4];
      const ry0 = rainSeeds[i * 4 + 1];
      const rz = rainSeeds[i * 4 + 2];
      const speed = rainSeeds[i * 4 + 3];
      const currY = (((ry0 - t * speed) % 1.4) + 1.4) % 1.4;
      rainPosAttr.setXYZ(i * 2, rx, currY + 0.055, rz);
      rainPosAttr.setXYZ(i * 2 + 1, rx - 0.006, currY, rz + 0.005);
    }
    rainPosAttr.needsUpdate = true;

    volumetricMist.update(t);

    // -------------------------------------------------------
    // 5. SUBTLE CINEMATIC HANDHELD BREATHING & LOCKED PLATE MATCHMOVE
    // -------------------------------------------------------
    const zoomMatch = 1.0 + smoothstep(0, 10, t) * 0.035;
    const tremorGain = layers.camcorderLook ? 1.0 : 0.0;
    const handTremorX = (Math.sin(t * 5.7) * 0.0013 + Math.sin(t * 11.3) * 0.0005) * tremorGain;
    const handTremorY = (Math.cos(t * 6.4) * 0.0009 + Math.cos(t * 13.1) * 0.0004) * tremorGain;
    const camSwayX = Math.sin(t * 0.75) * 0.010 + handTremorX;
    const camSwayY = Math.cos(t * 0.95) * 0.005 + handTremorY;

    camera.position.set(camSwayX, 0.27 + camSwayY, lerp(1.9, 1.82, smoothstep(0, 10, t)));
    _vec3B.set(
      lerp(0.0, 0.015, smoothstep(4.5, 9.0, t)) + camSwayX * 0.35,
      0.142 + camSwayY * 0.25,
      -0.35
    );
    camera.lookAt(_vec3B);
    camera.updateMatrixWorld();

    updatePlateTransform(
      currentW,
      currentH,
      zoomMatch,
      -camSwayX * 0.12,
      -camSwayY * 0.12
    );

    // -------------------------------------------------------
    // 5B. REAL-TIME PLANAR PUDDLE REFLECTION PASS (y = 0 mirror, alpha = 0 clear)
    // -------------------------------------------------------
    const doReflection = Boolean(reflectionRT && layers.showShadowCatcher);
    if (doReflection && reflectionRT) {
      reflectionCamera.fov = camera.fov;
      reflectionCamera.aspect = camera.aspect;
      reflectionCamera.near = camera.near;
      reflectionCamera.far = camera.far;
      reflectionCamera.updateProjectionMatrix();
      reflectionCamera.position.set(camera.position.x, -camera.position.y, camera.position.z);
      _vec3ReflTarget.set(_vec3B.x, -_vec3B.y, _vec3B.z);
      reflectionCamera.lookAt(_vec3ReflTarget);
      reflectionCamera.updateMatrixWorld();
      _mat4Refl.multiplyMatrices(
        reflectionCamera.projectionMatrix,
        reflectionCamera.matrixWorldInverse
      );

      const prevBg = scene.background;
      const prevShadowVis = shadowCatcher.visible;
      const prevStudioVis = studioFloor.visible;
      const prevBellyVis = bellyAoMesh.visible;
      const prevGlowVis = wetGlowMesh.visible;
      const prevRainVis = rainLines.visible;
      const prevMistVis = volumetricMist.group.visible;
      const prevWetPlateVis = plateWetCatcher.mesh.visible;
      const prevWetGroundVis = wetGroundSuite.mesh.visible;
      const prevFallbackHudVis = fallbackHudMesh.visible;

      renderer.getClearColor(_prevClearColor);
      const prevClearAlpha = renderer.getClearAlpha();

      plateWetCatcher.mesh.visible = false;
      wetGroundSuite.mesh.visible = false;
      shadowCatcher.visible = false;
      studioFloor.visible = false;
      bellyAoMesh.visible = false;
      wetGlowMesh.visible = false;
      rainLines.visible = false;
      volumetricMist.group.visible = false;
      fallbackHudMesh.visible = false;
      for (const p of pawAoMeshes) p.mesh.visible = false;
      scene.background = null;
      renderer.setClearColor(0x000000, 0.0);

      renderer.setRenderTarget(reflectionRT);
      renderer.clear();
      renderer.render(scene, reflectionCamera);
      renderer.setRenderTarget(null);

      renderer.setClearColor(_prevClearColor, prevClearAlpha);
      scene.background = prevBg;
      plateWetCatcher.mesh.visible = prevWetPlateVis;
      wetGroundSuite.mesh.visible = prevWetGroundVis;
      shadowCatcher.visible = prevShadowVis;
      studioFloor.visible = prevStudioVis;
      bellyAoMesh.visible = prevBellyVis;
      wetGlowMesh.visible = prevGlowVis;
      rainLines.visible = prevRainVis;
      volumetricMist.group.visible = prevMistVis;
      fallbackHudMesh.visible = prevFallbackHudVis;
      for (const p of pawAoMeshes) p.mesh.visible = layers.showShadowCatcher;
    }

    renderer.getDrawingBufferSize(_vec2DrawBuf);
    if (layers.showPlate && plateTexture) {
      plateWetCatcher.update(
        t,
        _mat4Refl,
        doReflection,
        plateTexture,
        _vec2DrawBuf.x,
        _vec2DrawBuf.y,
        emberX,
        emberY,
        emberZ,
        layers.showAtmosphere ? 0.65 + fireflyPulse * 0.55 : 0.0
      );
    } else {
      wetGroundSuite.update(t, _mat4Refl, doReflection);
    }

    camcorderHud.update(t);

    if (vignettePass) {
      vignettePass.uniforms.uTime.value = t;
      vignettePass.uniforms.uCamcorder.value = layers.camcorderLook ? 1.0 : 0.0;
    }

    if (composer) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  };

  applyLayerVisibility();
  _vec3C.set(0, 0, 0);

  const dispose = (releaseContext = false) => {
    for (const d of cat.disposables) {
      d.dispose();
    }
    furTex.colorMap.dispose();
    furTex.strandMap.dispose();
    furTex.normalMap.dispose();
    furTex.roughnessMap.dispose();
    irisTex.dispose();
    noseTex.dispose();
    innerEarTex.dispose();
    pawPadTex.dispose();
    plateTexture?.dispose();
    reflectionRT?.dispose();
    plateWetCatcher.dispose();
    wetGroundSuite.dispose();
    pawSplashSystem.dispose();
    rainGeo.dispose();
    rainMat.dispose();
    volumetricMist.dispose();
    bambooFraming.dispose();
    aoTex.dispose();
    wetGlowTex.dispose();
    emberHaloTex.dispose();
    moteTex.dispose();
    shadowGeo.dispose();
    shadowMat.dispose();
    studioFloorGeo.dispose();
    studioFloorMat.dispose();
    bellyAoGeo.dispose();
    bellyAoMat.dispose();
    pawAoGeo.dispose();
    for (const p of pawAoMeshes) p.mat.dispose();
    wetGlowGeo.dispose();
    wetGlowMat.dispose();
    emberCoreGeo.dispose();
    emberCoreMat.dispose();
    emberSpriteMat.dispose();
    moteGeo.dispose();
    moteMat.dispose();
    camcorderHud.dispose();
    fallbackHudGeo.dispose();
    fallbackHudMat.dispose();
    hdri.dispose();
    composerTarget?.dispose();
    composer?.dispose();
    renderer.dispose();
    if (releaseContext) {
      renderer.forceContextLoss();
    }
  };

  return {
    ready,
    isSoftwareGl,
    resize,
    setLayers,
    renderAtTime,
    dispose,
  };
}

export function poseCatFrontLegIk(
  leg: LegRig,
  sx: number,
  sy: number,
  sz: number,
  tx: number,
  ty: number,
  tz: number,
  pawPitchExtra: number
): void {
  const L1 = 0.106;
  const L2 = 0.106;

  _vLimbP0.set(sx, sy, sz);
  _vLimbP2.set(tx, ty + 0.008, tz);
  _vLimbP3.set(tx, ty, tz);

  _vLimbChord.subVectors(_vLimbP2, _vLimbP0);
  const rawDist = _vLimbChord.length();
  const dist = Math.min(L1 + L2 - 0.002, Math.max(0.035, rawDist));
  _vLimbChord.divideScalar(Math.max(1e-5, rawDist));

  _vLimbBend.crossVectors(_vLimbChord, _vec3SideRef);
  if (_vLimbBend.lengthSq() < 1e-6) {
    _vLimbBend.set(0, 0, 1);
  } else {
    _vLimbBend.normalize();
  }

  const cosA = Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _vLimbP1
    .copy(_vLimbP0)
    .addScaledVector(_vLimbChord, L1 * cosA)
    .addScaledVector(_vLimbBend, -L1 * sinA);

  leg.skin.updateFromJoints(_vLimbP0, _vLimbP1, _vLimbP2, _vLimbP3);
  leg.paw.position.copy(_vLimbP3);
  const rollZ = Math.atan2(tx - sx, Math.max(0.03, sy - ty));
  leg.paw.rotation.set(pawPitchExtra, 0, rollZ * 0.25);
}

export function poseCatHindLegIk(
  leg: LegRig,
  sx: number,
  sy: number,
  sz: number,
  px: number,
  py: number,
  pz: number,
  metaWorldPitch: number,
  pawPitchExtra: number
): void {
  const L1 = 0.114;
  const L2 = 0.114;
  const L3 = 0.056;

  _vLimbP0.set(sx, sy, sz);
  _vLimbP3.set(px, py, pz);
  _vLimbP2.set(
    px,
    py + L3 * Math.cos(metaWorldPitch),
    pz + L3 * Math.sin(metaWorldPitch)
  );

  _vLimbChord.subVectors(_vLimbP2, _vLimbP0);
  const rawDist = _vLimbChord.length();
  const dist = Math.min(L1 + L2 - 0.002, Math.max(0.035, rawDist));
  _vLimbChord.divideScalar(Math.max(1e-5, rawDist));

  _vLimbBend.crossVectors(_vLimbChord, _vec3SideRef);
  if (_vLimbBend.lengthSq() < 1e-6) {
    _vLimbBend.set(0, 0, 1);
  } else {
    _vLimbBend.normalize();
  }

  const cosA = Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _vLimbP1
    .copy(_vLimbP0)
    .addScaledVector(_vLimbChord, L1 * cosA)
    .addScaledVector(_vLimbBend, L1 * sinA);

  leg.skin.updateFromJoints(_vLimbP0, _vLimbP1, _vLimbP2, _vLimbP3);
  leg.paw.position.copy(_vLimbP3);
  const rollZ = Math.atan2(px - sx, Math.max(0.03, sy - py));
  leg.paw.rotation.set(pawPitchExtra, 0, rollZ * 0.25);
}
