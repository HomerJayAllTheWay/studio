/**
 * Video cropping utility using canvas
 * Captures a cropped region of a video stream and returns a new stream
 */

export type CropRect = { x: number; y: number; width: number; height: number };

export const createCroppedStream = (
  sourceStream: MediaStream,
  crop: CropRect | null,
  fps: number = 30,
): { stream: MediaStream; stop(): void } => {
  if (!crop) {
    // No crop, return the source stream as-is
    return { stream: sourceStream, stop: () => {} };
  }

  const sourceVideoTrack = sourceStream.getVideoTracks()[0] || null;
  const ProcessorCtor = (window as unknown as {
    MediaStreamTrackProcessor?: new (args: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
  }).MediaStreamTrackProcessor;
  const GeneratorCtor = (window as unknown as {
    MediaStreamTrackGenerator?: new (args: { kind: "video" }) => {
      writable: WritableStream<VideoFrame>;
      track: MediaStreamTrack;
    };
  }).MediaStreamTrackGenerator;
  const canUseTrackProcessor = typeof ProcessorCtor === "function"
    && typeof GeneratorCtor === "function"
    && typeof OffscreenCanvas !== "undefined"
    && typeof VideoFrame !== "undefined"
    && sourceVideoTrack;

  if (canUseTrackProcessor && sourceVideoTrack) {
    try {
      console.log("[crop-stream] Using MediaStreamTrackProcessor pipeline for cropping");
      const processor = new ProcessorCtor({ track: sourceVideoTrack });
      const generator = new GeneratorCtor({ kind: "video" });
      const offscreen = new OffscreenCanvas(crop.width, crop.height);
      const offscreenCtx = offscreen.getContext("2d");

      if (!offscreenCtx) {
        throw new Error("Failed to get 2D context from OffscreenCanvas");
      }

      const abortController = new AbortController();
      const transformer = new TransformStream<VideoFrame, VideoFrame>({
        transform: (frame, controller) => {
          try {
            offscreenCtx.clearRect(0, 0, crop.width, crop.height);
            offscreenCtx.drawImage(
              frame,
              crop.x,
              crop.y,
              crop.width,
              crop.height,
              0,
              0,
              crop.width,
              crop.height,
            );
            const outFrame = new VideoFrame(offscreen as unknown as CanvasImageSource, {
              timestamp: frame.timestamp,
              duration: frame.duration ?? undefined,
            });
            controller.enqueue(outFrame);
          } catch (e) {
            console.warn("[crop-stream] Frame transform error:", e);
          } finally {
            frame.close();
          }
        },
      });

      processor.readable
        .pipeThrough(transformer)
        .pipeTo(generator.writable, { signal: abortController.signal })
        .catch(err => {
          if (err && (err as Error).name !== "AbortError") {
            console.warn("[crop-stream] Crop processor pipeline failed:", err);
          }
        });

      // MediaStreamTrackGenerator extends MediaStreamTrack, use it directly
      const stream = new MediaStream([generator as unknown as MediaStreamTrack]);
      console.log("[crop-stream] TrackProcessor pipeline initialized successfully");
      return {
        stream,
        stop: () => {
          abortController.abort();
          (generator as unknown as MediaStreamTrack).stop();
        },
      };
    } catch (err) {
      console.warn("[crop-stream] TrackProcessor failed, falling back to canvas:", err);
    }
  }

  console.log("[crop-stream] Using canvas-based crop pipeline (fallback or no TrackProcessor support)");

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = sourceStream;

  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Failed to get 2D context from canvas");
  }

  let animationHandle: number | null = null;
  let videoFrameHandle: number | null = null;
  let intervalHandle: number | null = null;
  let running = true;

  const ensurePlaying = async () => {
    try {
      await video.play();
    } catch (e) {
      // Autoplay can be blocked; drawing can still work once frames advance.
      console.warn("Crop preview video play was blocked", e);
    }
  };

  const drawOnce = () => {
    try {
      if (video.videoWidth > 0 && running) {
        ctx.clearRect(0, 0, crop.width, crop.height);
        ctx.drawImage(
          video,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          0,
          0,
          crop.width,
          crop.height,
        );
      }
    } catch (e) {
      console.error("Crop draw error (canvas likely tainted):", e);
      running = false;
      return;
    }
  };

  type VideoWithFrameCallback = HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: (now: number, metadata: unknown) => void) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  };

  const scheduleNext = () => {
    // Prefer the video frame callback if available (keeps running when page is backgrounded)
    if (!running) {
      return;
    }
    const v = video as VideoWithFrameCallback;
    if (typeof v.requestVideoFrameCallback === "function") {
      videoFrameHandle = v.requestVideoFrameCallback((_now: number, _metadata: unknown) => {
        drawOnce();
        scheduleNext();
      });
    } else if (typeof requestAnimationFrame === "function") {
      animationHandle = requestAnimationFrame(() => {
        drawOnce();
        scheduleNext();
      });
    } else {
      // As a last resort, use setInterval (may be throttled in background)
      if (intervalHandle == null) {
        intervalHandle = window.setInterval(() => {
          drawOnce();
        }, 1000 / fps);
      }
    }
  };

  // Start drawing when video is ready
  const startDraw = () => {
    const start = () => {
      running = true;
      void ensurePlaying();
      drawOnce();
      scheduleNext();
    };
    if (video.readyState >= 2) {
      start();
      return;
    }
    video.addEventListener("loadedmetadata", () => start(), { once: true });
    video.addEventListener("loadeddata", () => start(), { once: true });
  };

  startDraw();

  const outStream = canvas.captureStream(fps);

  return {
    stream: outStream,
    stop: () => {
      running = false;
      if (animationHandle) {
        cancelAnimationFrame(animationHandle);
        animationHandle = null;
      }
      if (videoFrameHandle != null) {
        const v = video as VideoWithFrameCallback;
        if (typeof v.cancelVideoFrameCallback === "function") {
          v.cancelVideoFrameCallback(videoFrameHandle);
        }
        videoFrameHandle = null;
      }
      if (intervalHandle != null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      outStream.getTracks().forEach(t => t.stop());
    },
  };
};

export default createCroppedStream;
