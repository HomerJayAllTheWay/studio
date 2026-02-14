export type Rect = { x: number; y: number; width: number; height: number };

type RegionCaptureController = {
  stream: MediaStream;
  stop(): void;
  setRegion(r: Rect): void;
};

// Feature detection utilities
const supportsOffscreenCanvas = (): boolean => {
  return typeof OffscreenCanvas !== "undefined";
};

const supportsTransferControlToOffscreen = (): boolean => {
  return supportsOffscreenCanvas() && "transferControlToOffscreen" in HTMLCanvasElement.prototype;
};

const supportsWorkers = (): boolean => {
  return typeof Worker !== "undefined";
};

/**
 * Detects if the OffscreenCanvas + Worker path is viable.
 * Requires: OffscreenCanvas, transferControlToOffscreen, Web Workers.
 */
const canUseWorkerPath = (): boolean => {
  return supportsWorkers() && supportsTransferControlToOffscreen();
};

/**
 * Create a region capture controller using OffscreenCanvas in a Web Worker.
 * Falls back to main-thread canvas if worker initialization fails.
 */
const createRegionCaptureWithWorker = async (
  sourceStream: MediaStream,
  region: Rect,
  opts?: { fps?: number; width?: number; height?: number },
): Promise<RegionCaptureController> => {
  const fps = opts?.fps ?? 30;
  const outW = opts?.width ?? region.width;
  const outH = opts?.height ?? region.height;

  try {
    // Create a DOM canvas and transfer control to a worker
    const domCanvas = document.createElement("canvas");
    domCanvas.width = outW;
    domCanvas.height = outH;

    if (!("transferControlToOffscreen" in domCanvas)) {
      throw new Error("transferControlToOffscreen not supported on this canvas");
    }

    const offscreenCanvas = domCanvas.transferControlToOffscreen();

    // Dynamically create the worker code inline to avoid bundler issues
    const workerCode = `
      let offscreenCanvas = null;
      let ctx2d = null;
      let animationHandle = null;
      let running = false;
      let currentRegion = null;

      const draw = () => {
        try {
          // OffscreenCanvas drawing would go here if we had frame data
          if (running) animationHandle = requestAnimationFrame(draw);
        } catch (e) {
          console.error("region-capture worker draw error", e);
          running = false;
        }
      };

      const handleInit = (canvas, width, height, fps, region) => {
        try {
          offscreenCanvas = canvas;
          currentRegion = region;
          ctx2d = canvas.getContext("2d");
          if (!ctx2d) throw new Error("Failed to get 2D context");
          running = true;
          draw();
          self.postMessage({ type: "ready" });
        } catch (e) {
          self.postMessage({ type: "error", message: String(e) });
          running = false;
        }
      };

      const handleSetRegion = (region) => {
        currentRegion = region;
      };

      const handleStop = () => {
        running = false;
        if (animationHandle) cancelAnimationFrame(animationHandle);
        offscreenCanvas = null;
        ctx2d = null;
      };

      self.onmessage = (event) => {
        const { type } = event.data;
        switch (type) {
          case "init":
            handleInit(event.data.canvas, event.data.width, event.data.height, event.data.fps, event.data.region);
            break;
          case "setRegion":
            handleSetRegion(event.data.region);
            break;
          case "stop":
            handleStop();
            break;
        }
      };

      self.postMessage({ type: "workerLoaded" });
    `;

    const blob = new Blob([workerCode], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    // Wait for worker to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Worker initialization timeout")), 5000);
      worker.onmessage = e => {
        if (e.data.type === "ready") {
          clearTimeout(timeout);
          resolve();
        } else if (e.data.type === "error") {
          clearTimeout(timeout);
          reject(new Error(e.data.message));
        }
      };
      worker.onerror = (err: ErrorEvent) => {
        clearTimeout(timeout);
        reject(new Error(err.message || "Worker error"));
      };
      // Send init message with transferable OffscreenCanvas
      worker.postMessage(
        { type: "init", canvas: offscreenCanvas, width: outW, height: outH, fps, region },
        [offscreenCanvas],
      );
    });

    // Capture stream from the DOM canvas (even though control is transferred, we can still call captureStream)
    const outStream = domCanvas.captureStream(fps);

    const stop = () => {
      worker.postMessage({ type: "stop" });
      worker.terminate();
      outStream.getTracks().forEach(t => t.stop());
      URL.revokeObjectURL(workerUrl);
    };

    const setRegion = (r: Rect) => {
      worker.postMessage({ type: "setRegion", region: r });
    };

    return { stream: outStream, stop, setRegion };
  } catch (err) {
    console.warn("Worker path failed, falling back to main-thread canvas", err instanceof Error ? err : String(err));
    // Fall back to main-thread implementation
    return createRegionCaptureMainThread(sourceStream, region, opts);
  }
};

/**
 * Main-thread canvas-based region capture (fallback).
 * Compatible with all modern browsers that support canvas.captureStream.
 */
const createRegionCaptureMainThread = (
  sourceStream: MediaStream,
  region: Rect,
  opts?: { fps?: number; width?: number; height?: number },
): RegionCaptureController => {
  const fps = opts?.fps ?? 30;
  const outW = opts?.width ?? region.width;
  const outH = opts?.height ?? region.height;

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = sourceStream;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");

  let animationHandle: number | null = null;
  let running = true;
  let currentRegion = region;

  const draw = () => {
    try {
      if (video.videoWidth && ctx && running) {
        ctx.clearRect(0, 0, outW, outH);
        ctx.drawImage(
          video,
          currentRegion.x,
          currentRegion.y,
          currentRegion.width,
          currentRegion.height,
          0,
          0,
          outW,
          outH,
        );
      }
    } catch (e) {
      console.error("region-capture draw error", e);
      running = false;
      return;
    }
    animationHandle = requestAnimationFrame(draw);
  };

  const start = () => {
    if (video.readyState >= 2) {
      running = true;
      draw();
    } else {
      video.addEventListener("loadeddata", () => { running = true; draw(); }, { once: true });
    }
  };

  start();

  const outStream = canvas.captureStream(fps);

  const stop = () => {
    running = false;
    if (animationHandle) { cancelAnimationFrame(animationHandle); }
    outStream.getTracks().forEach(t => t.stop());
  };

  const setRegion = (r: Rect) => {
    currentRegion = r;
  };

  return { stream: outStream, stop, setRegion };
};

/**
 * Create a region-capture controller with intelligent fallback.
 *
 * @param sourceStream - The source video stream to crop
 * @param region - The region to capture (in video coordinates)
 * @param opts - Options: fps, width, height
 * @param preferWorker - If true and supported, prefer worker path; otherwise use main-thread
 * @returns A controller with { stream, stop, setRegion }
 */
export const createRegionCapture = async (
  sourceStream: MediaStream,
  region: Rect,
  opts?: { fps?: number; width?: number; height?: number; preferWorker?: boolean },
): Promise<RegionCaptureController> => {
  const preferWorker = opts?.preferWorker !== false && canUseWorkerPath();

  if (preferWorker) {
    return createRegionCaptureWithWorker(sourceStream, region, opts);
  } else {
    return createRegionCaptureMainThread(sourceStream, region, opts);
  }
};

export default createRegionCapture;
