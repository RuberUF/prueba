import {
  ArrayBufferTarget as Mp4ArrayBufferTarget,
  Muxer as Mp4Muxer,
} from 'mp4-muxer';
import {
  ArrayBufferTarget as WebmArrayBufferTarget,
  Muxer as WebmMuxer,
} from 'webm-muxer';
import {
  CGI_DURATION_SECONDS,
  type CgiCompositingLayers,
  createCgiCatSceneEngine,
  DEFAULT_CGI_LAYERS,
} from './cgiCatScene';
import { ANIMATION_TOTAL_DURATION, renderJumpingCatFrame } from './jumpingCatAnimation';

export type VideoExportFormat = 'mp4' | 'mkv';
export type VideoResolutionPreset = '720p' | '1080p';
export type ExportSceneMode = 'cgi3d' | 'story2d';

export interface VideoExportProgress {
  phase: 'preparing' | 'rendering' | 'encoding' | 'finalizing';
  progress: number; // 0..1
  currentFrame: number;
  totalFrames: number;
}

export interface VideoExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
  usedFallbackNotice?: string;
}

interface ExportFrameSession {
  canvas: HTMLCanvasElement;
  durationSeconds: number;
  baseFilename: string;
  renderFrame: (tSec: number) => void;
  dispose: () => void;
}

function getDimensions(preset: VideoResolutionPreset): { width: number; height: number } {
  return preset === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function canvasToJpegUint8Array(canvas: HTMLCanvasElement, quality = 0.92): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('No se pudo capturar el fotograma.'));
          return;
        }
        const buf = await blob.arrayBuffer();
        resolve(new Uint8Array(buf));
      },
      'image/jpeg',
      quality
    );
  });
}

async function createFrameSession(
  mode: ExportSceneMode,
  width: number,
  height: number,
  cgiLayers?: CgiCompositingLayers
): Promise<ExportFrameSession> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  if (mode === 'cgi3d') {
    const engine = createCgiCatSceneEngine(canvas, {
      width,
      height,
      maxDpr: 1,
    });
    engine.setLayers(cgiLayers ?? DEFAULT_CGI_LAYERS);
    await engine.ready;
    return {
      canvas,
      durationSeconds: CGI_DURATION_SECONDS,
      baseFilename: 'gato-cgi-3d-bambu',
      renderFrame: (tSec) => engine.renderAtTime(tSec),
      dispose: () => engine.dispose(true),
    };
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo inicializar el lienzo 2D de exportación.');
  }
  return {
    canvas,
    durationSeconds: ANIMATION_TOTAL_DURATION,
    baseFilename: 'gato-sumi-e-sunmy',
    renderFrame: (tSec) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      renderJumpingCatFrame(ctx, width, height, tSec);
    },
    dispose: () => {},
  };
}

async function pickWebCodecsConfig(
  format: VideoExportFormat,
  width: number,
  height: number,
  fps: number
): Promise<{ codec: string; muxerCodec: 'avc' | 'vp9' | 'vp8'; config: VideoEncoderConfig } | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return null;
  }

  const bitrate = width >= 1920 ? 8_000_000 : 4_800_000;

  const candidates: Array<{
    codec: string;
    muxerCodec: 'avc' | 'vp9' | 'vp8';
    extra?: Partial<VideoEncoderConfig>;
  }> =
    format === 'mp4'
      ? [
          { codec: 'avc1.4d002a', muxerCodec: 'avc', extra: { avc: { format: 'avc' } } },
          { codec: 'avc1.420028', muxerCodec: 'avc', extra: { avc: { format: 'avc' } } },
          { codec: 'avc1.42001f', muxerCodec: 'avc', extra: { avc: { format: 'avc' } } },
        ]
      : [
          { codec: 'vp09.00.10.08', muxerCodec: 'vp9' },
          { codec: 'vp8', muxerCodec: 'vp8' },
        ];

  for (const candidate of candidates) {
    const config: VideoEncoderConfig = {
      codec: candidate.codec,
      width,
      height,
      bitrate,
      framerate: fps,
      ...candidate.extra,
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        return { codec: candidate.codec, muxerCodec: candidate.muxerCodec, config };
      }
    } catch {
      // Try next codec candidate
    }
  }

  return null;
}

async function exportViaWebCodecs(
  format: VideoExportFormat,
  width: number,
  height: number,
  fps: number,
  totalFrames: number,
  session: ExportFrameSession,
  onProgress: (p: VideoExportProgress) => void,
  signal?: AbortSignal
): Promise<VideoExportResult> {
  const picked = await pickWebCodecsConfig(format, width, height, fps);
  if (!picked) {
    throw new Error('WEBCODECS_UNSUPPORTED');
  }

  let encoderError: Error | null = null;
  let mp4Muxer: Mp4Muxer<Mp4ArrayBufferTarget> | null = null;
  let mkvMuxer: WebmMuxer<WebmArrayBufferTarget> | null = null;

  if (format === 'mp4') {
    mp4Muxer = new Mp4Muxer({
      target: new Mp4ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width,
        height,
        frameRate: fps,
      },
      fastStart: 'in-memory',
    });
  } else {
    mkvMuxer = new WebmMuxer({
      target: new WebmArrayBufferTarget(),
      type: 'matroska',
      video: {
        codec: picked.muxerCodec === 'vp9' ? 'V_VP9' : 'V_VP8',
        width,
        height,
        frameRate: fps,
      },
    });
  }

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (mp4Muxer) {
        mp4Muxer.addVideoChunk(chunk, meta);
      } else if (mkvMuxer) {
        mkvMuxer.addVideoChunk(chunk, meta);
      }
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  encoder.configure(picked.config);
  const frameDurationUs = Math.round(1_000_000 / fps);

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) {
        throw new DOMException('Exportación cancelada', 'AbortError');
      }
      if (encoderError) {
        throw encoderError;
      }

      const tSec = Math.min(session.durationSeconds - 0.001, i / fps);
      session.renderFrame(tSec);

      while (encoder.encodeQueueSize >= 8) {
        if (signal?.aborted) {
          throw new DOMException('Exportación cancelada', 'AbortError');
        }
        await yieldToUi();
      }

      const timestampUs = i * frameDurationUs;
      const frame = new VideoFrame(session.canvas, {
        timestamp: timestampUs,
        duration: frameDurationUs,
      });

      try {
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      } finally {
        frame.close();
      }

      if (i % 4 === 0 || i === totalFrames - 1) {
        onProgress({
          phase: 'rendering',
          progress: ((i + 1) / totalFrames) * 0.92,
          currentFrame: i + 1,
          totalFrames,
        });
        await yieldToUi();
      }
    }

    onProgress({
      phase: 'finalizing',
      progress: 0.95,
      currentFrame: totalFrames,
      totalFrames,
    });

    await encoder.flush();
    if (encoderError) {
      throw encoderError;
    }

    const buffer = mp4Muxer
      ? (mp4Muxer.finalize(), mp4Muxer.target.buffer)
      : (mkvMuxer!.finalize(), mkvMuxer!.target.buffer);

    const mimeType = format === 'mp4' ? 'video/mp4' : 'video/x-matroska';
    const blob = new Blob([buffer], { type: mimeType });

    onProgress({
      phase: 'finalizing',
      progress: 1,
      currentFrame: totalFrames,
      totalFrames,
    });

    return {
      blob,
      filename: `${session.baseFilename}.${format}`,
      mimeType,
    };
  } finally {
    if (encoder.state !== 'closed') {
      try {
        encoder.close();
      } catch {
        // Ignore close errors after abort
      }
    }
  }
}

async function exportViaServerFfmpeg(
  format: VideoExportFormat,
  width: number,
  height: number,
  fps: number,
  totalFrames: number,
  session: ExportFrameSession,
  onProgress: (p: VideoExportProgress) => void,
  signal?: AbortSignal
): Promise<VideoExportResult> {
  const healthRes = await fetch('/api/export-video/health', { signal }).catch(() => null);
  if (!healthRes || !healthRes.ok) {
    throw new Error('SERVER_UNAVAILABLE');
  }
  const health = (await healthRes.json()) as { ffmpeg?: boolean };
  if (!health.ffmpeg) {
    throw new Error('SERVER_UNAVAILABLE');
  }

  const startRes = await fetch('/api/export-video/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps, width, height }),
    signal,
  });

  if (!startRes.ok) {
    throw new Error('No se pudo iniciar la sesión de exportación en el servidor.');
  }

  const { sessionId } = (await startRes.json()) as { sessionId: string };
  const batchSize = 24;
  let batchFrames: Array<{ index: number; bytes: Uint8Array }> = [];

  const flushBatch = async () => {
    if (batchFrames.length === 0) return;
    let totalBytes = 4;
    for (const item of batchFrames) {
      totalBytes += 8 + item.bytes.byteLength;
    }

    const payload = new Uint8Array(totalBytes);
    const view = new DataView(payload.buffer);
    let offset = 0;
    view.setUint32(offset, batchFrames.length, true);
    offset += 4;

    for (const item of batchFrames) {
      view.setUint32(offset, item.index, true);
      view.setUint32(offset + 4, item.bytes.byteLength, true);
      offset += 8;
      payload.set(item.bytes, offset);
      offset += item.bytes.byteLength;
    }

    batchFrames = [];

    const res = await fetch(`/api/export-video/batch/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: payload,
      signal,
    });
    if (!res.ok) {
      throw new Error('Error enviando fotogramas al servidor.');
    }
  };

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) {
        throw new DOMException('Exportación cancelada', 'AbortError');
      }

      const tSec = Math.min(session.durationSeconds - 0.001, i / fps);
      session.renderFrame(tSec);

      const bytes = await canvasToJpegUint8Array(session.canvas, 0.92);
      batchFrames.push({ index: i, bytes });

      if (batchFrames.length >= batchSize || i === totalFrames - 1) {
        await flushBatch();
        onProgress({
          phase: 'rendering',
          progress: ((i + 1) / totalFrames) * 0.85,
          currentFrame: i + 1,
          totalFrames,
        });
        await yieldToUi();
      }
    }

    onProgress({
      phase: 'encoding',
      progress: 0.9,
      currentFrame: totalFrames,
      totalFrames,
    });

    const finishRes = await fetch(`/api/export-video/finish/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format }),
      signal,
    });

    if (!finishRes.ok) {
      throw new Error('FFmpeg no pudo generar el archivo de video.');
    }

    const blob = await finishRes.blob();
    const mimeType = format === 'mp4' ? 'video/mp4' : 'video/x-matroska';

    onProgress({
      phase: 'finalizing',
      progress: 1,
      currentFrame: totalFrames,
      totalFrames,
    });

    return {
      blob,
      filename: `${session.baseFilename}.${format}`,
      mimeType,
    };
  } catch (err) {
    void fetch(`/api/export-video/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }).catch(() => {});
    throw err;
  }
}

async function exportViaMediaRecorder(
  format: VideoExportFormat,
  fps: number,
  totalFrames: number,
  session: ExportFrameSession,
  onProgress: (p: VideoExportProgress) => void,
  signal?: AbortSignal
): Promise<VideoExportResult> {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof session.canvas.captureStream !== 'function'
  ) {
    throw new Error('Este navegador no soporta exportación de video.');
  }

  const mimeCandidates =
    format === 'mp4'
      ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
      : ['video/x-matroska;codecs=avc1', 'video/x-matroska', 'video/webm;codecs=vp9', 'video/webm'];

  const chosenMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';

  const stream = session.canvas.captureStream(fps);
  const recorder = new MediaRecorder(
    stream,
    chosenMime ? { mimeType: chosenMime, videoBitsPerSecond: 4_800_000 } : undefined
  );

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
    recorder.onerror = () => reject(new Error('Error grabando el video.'));
  });

  recorder.start(250);

  const frameMs = 1000 / fps;
  const startTime = performance.now();

  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) {
      recorder.stop();
      throw new DOMException('Exportación cancelada', 'AbortError');
    }

    const tSec = Math.min(session.durationSeconds - 0.001, i / fps);
    session.renderFrame(tSec);

    onProgress({
      phase: 'rendering',
      progress: (i + 1) / totalFrames,
      currentFrame: i + 1,
      totalFrames,
    });

    const targetTime = startTime + (i + 1) * frameMs;
    const waitMs = Math.max(0, targetTime - performance.now());
    await new Promise((r) => setTimeout(r, waitMs));
  }

  recorder.stop();
  const blob = await stopPromise;

  const isWebmFallback = !chosenMime.includes(format === 'mp4' ? 'mp4' : 'matroska');
  const ext = isWebmFallback ? 'webm' : format;

  return {
    blob,
    filename: `${session.baseFilename}.${ext}`,
    mimeType: blob.type || 'video/webm',
    usedFallbackNotice: isWebmFallback
      ? `Tu navegador exportó en formato WebM compatible al no soportar ${format.toUpperCase()} nativo.`
      : undefined,
  };
}

export async function exportAnimationVideo(options: {
  mode?: ExportSceneMode;
  format: VideoExportFormat;
  resolution?: VideoResolutionPreset;
  fps?: number;
  cgiLayers?: CgiCompositingLayers;
  onProgress: (progress: VideoExportProgress) => void;
  signal?: AbortSignal;
}): Promise<VideoExportResult> {
  const {
    mode = 'cgi3d',
    format,
    resolution = '720p',
    fps = 30,
    cgiLayers,
    onProgress,
    signal,
  } = options;

  const { width, height } = getDimensions(resolution);
  const durationSeconds = mode === 'cgi3d' ? CGI_DURATION_SECONDS : ANIMATION_TOTAL_DURATION;
  const totalFrames = Math.ceil(durationSeconds * fps);

  onProgress({
    phase: 'preparing',
    progress: 0,
    currentFrame: 0,
    totalFrames,
  });

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const session = await createFrameSession(mode, width, height, cgiLayers);

  try {
    // 1. Prefer WebCodecs for fast zero-upload MP4 / MKV generation
    try {
      return await exportViaWebCodecs(
        format,
        width,
        height,
        fps,
        totalFrames,
        session,
        onProgress,
        signal
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      // Fall through to FFmpeg server route
    }

    // 2. Fallback to FFmpeg on the backend (/api/export-video/*)
    try {
      return await exportViaServerFfmpeg(
        format,
        width,
        height,
        fps,
        totalFrames,
        session,
        onProgress,
        signal
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      // Fall through to MediaRecorder only if server FFmpeg isn't reachable
    }

    // 3. Final fallback to MediaRecorder
    return await exportViaMediaRecorder(
      format,
      fps,
      totalFrames,
      session,
      onProgress,
      signal
    );
  } finally {
    session.dispose();
  }
}
