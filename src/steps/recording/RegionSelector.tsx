import React, { useEffect, useRef, useState } from "react";

type Rect = { x: number; y: number; width: number; height: number };

type Props = {
  sourceStream: MediaStream | null;
  initialRegion?: Rect;
  onChange?: (r: Rect) => void;
  onConfirm?: (r: Rect) => void;
  onCancel?: () => void;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const minDim = 50; // Minimum region width/height

type DragMode = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w" | null;

export const RegionSelector: React.FC<Props> = ({ sourceStream, initialRegion, onChange, onConfirm, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [region, setRegion] = useState<Rect | null>(initialRegion || null);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number }>({ w: 1280, h: 720 });
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [aspectLock, setAspectLock] = useState(false);

  // Update video dimensions when metadata loads
  useEffect(() => {
    const v = videoRef.current;
    if (!v) { return; }
    const updateDims = () => {
      if (v.videoWidth && v.videoHeight) {
        setVideoDims({ w: v.videoWidth, h: v.videoHeight });
      }
    };
    if (v.readyState >= 1) {
      updateDims();
    } else {
      v.addEventListener("loadedmetadata", updateDims, { once: true });
    }
  }, []);

  // Set up stream and initialize default region
  useEffect(() => {
    const v = videoRef.current;
    if (v && sourceStream) {
      v.srcObject = sourceStream;
      v.play().catch(() => {});
    }
  }, [sourceStream]);

  useEffect(() => {
    if (!region && videoDims.w > 0 && videoDims.h > 0) {
      // Default: centered half-size region
      const rw = Math.floor(videoDims.w / 2);
      const rh = Math.floor(videoDims.h / 2);
      setRegion({
        x: Math.floor((videoDims.w - rw) / 2),
        y: Math.floor((videoDims.h - rh) / 2),
        width: rw,
        height: rh,
      });
    }
  }, [videoDims, region]);

  useEffect(() => {
    if (region && onChange) { onChange(region); }
  }, [region, onChange]);

  // Get display-space coordinates from viewport coordinates
  const getDisplayCoords = (viewportX: number, viewportY: number): [number, number] => {
    if (!containerRef.current) { return [0, 0]; }
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = videoDims.w / rect.width;
    const scaleY = videoDims.h / rect.height;
    const displayX = (viewportX - rect.left) * scaleX;
    const displayY = (viewportY - rect.top) * scaleY;
    return [displayX, displayY];
  };

  // Map viewport position to display coordinates
  const viewportToDisplay = (vx: number, vy: number) => getDisplayCoords(vx, vy);

  const onMouseDown = (e: React.MouseEvent, mode: DragMode) => {
    if (!region || !containerRef.current) { return; }
    e.preventDefault();
    const [dx, dy] = viewportToDisplay(e.clientX, e.clientY);
    setDragMode(mode);
    setDragStart({ x: dx, y: dy });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragMode || !dragStart || !region) { return; }
    const [dx, dy] = viewportToDisplay(e.clientX, e.clientY);
    const deltaX = dx - dragStart.x;
    const deltaY = dy - dragStart.y;

    const newRegion = { ...region };

    if (dragMode === "move") {
      newRegion.x = clamp(region.x + deltaX, 0, videoDims.w - region.width);
      newRegion.y = clamp(region.y + deltaY, 0, videoDims.h - region.height);
    } else if (dragMode === "nw") {
      const newW = region.width - deltaX;
      const newH = region.height - deltaY;
      if (newW >= minDim && newH >= minDim) {
        newRegion.x = clamp(region.x + deltaX, 0, region.x + region.width - minDim);
        newRegion.y = clamp(region.y + deltaY, 0, region.y + region.height - minDim);
        newRegion.width = newW;
        newRegion.height = newH;
      }
    } else if (dragMode === "ne") {
      const newW = region.width + deltaX;
      const newH = region.height - deltaY;
      if (newW >= minDim && newH >= minDim) {
        newRegion.width = clamp(newW, minDim, videoDims.w - region.x);
        newRegion.y = clamp(region.y + deltaY, 0, region.y + region.height - minDim);
        newRegion.height = newH;
      }
    } else if (dragMode === "sw") {
      const newW = region.width - deltaX;
      const newH = region.height + deltaY;
      if (newW >= minDim && newH >= minDim) {
        newRegion.x = clamp(region.x + deltaX, 0, region.x + region.width - minDim);
        newRegion.width = newW;
        newRegion.height = clamp(newH, minDim, videoDims.h - region.y);
      }
    } else if (dragMode === "se") {
      const newW = region.width + deltaX;
      const newH = region.height + deltaY;
      if (newW >= minDim && newH >= minDim) {
        newRegion.width = clamp(newW, minDim, videoDims.w - region.x);
        newRegion.height = clamp(newH, minDim, videoDims.h - region.y);
      }
    } else if (dragMode === "n") {
      const newH = region.height - deltaY;
      if (newH >= minDim) {
        newRegion.y = clamp(region.y + deltaY, 0, region.y + region.height - minDim);
        newRegion.height = newH;
      }
    } else if (dragMode === "s") {
      const newH = region.height + deltaY;
      if (newH >= minDim) {
        newRegion.height = clamp(newH, minDim, videoDims.h - region.y);
      }
    } else if (dragMode === "w") {
      const newW = region.width - deltaX;
      if (newW >= minDim) {
        newRegion.x = clamp(region.x + deltaX, 0, region.x + region.width - minDim);
        newRegion.width = newW;
      }
    } else if (dragMode === "e") {
      const newW = region.width + deltaX;
      if (newW >= minDim) {
        newRegion.width = clamp(newW, minDim, videoDims.w - region.x);
      }
    }

    setRegion(newRegion);
    setDragStart({ x: dx, y: dy });
  };

  const onMouseUp = () => {
    setDragMode(null);
    setDragStart(null);
  };

  // Preset regions
  const applyPreset = (preset: Rect) => {
    setRegion(preset);
  };

  const presets = {
    full: { x: 0, y: 0, width: videoDims.w, height: videoDims.h },
    half_h: { x: 0, y: 0, width: videoDims.w, height: Math.floor(videoDims.h / 2) },
    half_v: { x: 0, y: 0, width: Math.floor(videoDims.w / 2), height: videoDims.h },
    center: {
      x: Math.floor(videoDims.w / 4),
      y: Math.floor(videoDims.h / 4),
      width: Math.floor(videoDims.w / 2),
      height: Math.floor(videoDims.h / 2),
    },
  };

  // Numeric input handlers
  const updateCoord = (key: keyof Rect, val: number) => {
    if (!region) { return; }
    const newVal = Math.max(0, Math.min(val,
      key === "x" ? videoDims.w - region.width :
        key === "y" ? videoDims.h - region.height :
          key === "width" ? videoDims.w - region.x :
            videoDims.h - region.y,
    ));
    setRegion({ ...region, [key]: newVal });
  };

  // Percentage display for reference
  const pctDisplay = region ? {
    pctW: ((region.width / videoDims.w) * 100).toFixed(0),
    pctH: ((region.height / videoDims.h) * 100).toFixed(0),
  } : null;

  // Viewport dimensions for scaling the overlay
  const containerRect = containerRef.current?.getBoundingClientRect();
  const scaleX = containerRect ? containerRect.width / videoDims.w : 1;
  const scaleY = containerRect ? containerRect.height / videoDims.h : 1;

  const regionViewport = region ? {
    left: region.x * scaleX,
    top: region.y * scaleY,
    width: region.width * scaleX,
    height: region.height * scaleY,
  } : null;

  return (
    <div
      ref={containerRef}
      css={{ position: "relative", width: "100%", height: "100%", background: "black", overflow: "hidden" }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <video ref={videoRef} autoPlay muted playsInline css={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />

      {/* Darkened areas outside region */}
      {regionViewport && (
        <>
          <div css={{ position: "absolute", inset: 0, pointerEvents: "none", background: "rgba(0,0,0,0.4)" }} />
          <div css={{ position: "absolute", inset: 0, clipPath: `inset(${regionViewport.top}px ${containerRect!.width - regionViewport.left - regionViewport.width}px ${containerRect!.height - regionViewport.top - regionViewport.height}px ${regionViewport.left}px)`, pointerEvents: "none" }} />
        </>
      )}

      {/* Region selection box with handles */}
      {regionViewport && (
        <div
          css={{
            position: "absolute",
            left: regionViewport.left,
            top: regionViewport.top,
            width: regionViewport.width,
            height: regionViewport.height,
            border: "2px solid rgba(255,255,255,0.9)",
            boxSizing: "border-box",
            touchAction: "none",
            cursor: "move",
          }}
          onMouseDown={e => onMouseDown(e, "move")}
        >
          {/* Corner handles */}
          <div css={{ position: "absolute", left: -6, top: -6, width: 12, height: 12, bg: "white", borderRadius: "50%", cursor: "nwse-resize" }} onMouseDown={(e: React.MouseEvent) => onMouseDown(e, "nw")} />
          <div css={{ position: "absolute", right: -6, top: -6, width: 12, height: 12, bg: "white", borderRadius: "50%", cursor: "nesw-resize" }} onMouseDown={(e: React.MouseEvent) => onMouseDown(e, "ne")} />
          <div css={{ position: "absolute", left: -6, bottom: -6, width: 12, height: 12, bg: "white", borderRadius: "50%", cursor: "nesw-resize" }} onMouseDown={(e: React.MouseEvent) => onMouseDown(e, "sw")} />
          <div css={{ position: "absolute", right: -6, bottom: -6, width: 12, height: 12, bg: "white", borderRadius: "50%", cursor: "nwse-resize" }} onMouseDown={(e: React.MouseEvent) => onMouseDown(e, "se")} />

          {/* Edge handles */}
          <div css={{ position: "absolute", left: "50%", top: -6, transform: "translateX(-50%)", width: 8, height: 12, bg: "rgba(255,255,255,0.7)", cursor: "ns-resize" }} onMouseDown={(e: React.MouseEvent) => onMouseDown(e, "n")} />
          <div css={{ position: "absolute", left: "50%", bottom: -6, transform: "translateX(-50%)", width: 8, height: 12, bg: "rgba(255,255,255,0.7)", cursor: "ns-resize" }} onMouseDown={(e: React.MouseEvent) => onMouseDown(e, "s")} />
          <div css={{ position: "absolute", left: -6, top: "50%", transform: "translateY(-50%)", width: 12, height: 8, bg: "rgba(255,255,255,0.7)", cursor: "ew-resize" }} onMouseDown={(e: React.MouseEvent) => onMouseDown(e, "w")} />
          <div css={{ position: "absolute", right: -6, top: "50%", transform: "translateY(-50%)", width: 12, height: 8, bg: "rgba(255,255,255,0.7)", cursor: "ew-resize" }} onMouseDown={(e: React.MouseEvent) => onMouseDown(e, "e")} />
        </div>
      )}

      {/* Control panel */}
      <div css={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.8)", color: "white", padding: "12px", borderTop: "1px solid rgba(255,255,255,0.3)" }}>
        {/* Numeric inputs */}
        <div css={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12, fontSize: 12 }}>
          <div>
            <label css={{ display: "block", marginBottom: 4 }}>X:</label>
            <input
              type="number"
              value={region?.x ?? 0}
              onChange={e => updateCoord("x", parseInt(e.target.value) || 0)}
              css={{ width: "100%", padding: "4px", background: "#333", color: "white", border: "1px solid #666", borderRadius: 4 }}
            />
          </div>
          <div>
            <label css={{ display: "block", marginBottom: 4 }}>Y:</label>
            <input
              type="number"
              value={region?.y ?? 0}
              onChange={e => updateCoord("y", parseInt(e.target.value) || 0)}
              css={{ width: "100%", padding: "4px", background: "#333", color: "white", border: "1px solid #666", borderRadius: 4 }}
            />
          </div>
          <div>
            <label css={{ display: "block", marginBottom: 4 }}>W:</label>
            <input
              type="number"
              value={region?.width ?? 0}
              onChange={e => updateCoord("width", parseInt(e.target.value) || 0)}
              css={{ width: "100%", padding: "4px", background: "#333", color: "white", border: "1px solid #666", borderRadius: 4 }}
            />
          </div>
          <div>
            <label css={{ display: "block", marginBottom: 4 }}>H:</label>
            <input
              type="number"
              value={region?.height ?? 0}
              onChange={e => updateCoord("height", parseInt(e.target.value) || 0)}
              css={{ width: "100%", padding: "4px", background: "#333", color: "white", border: "1px solid #666", borderRadius: 4 }}
            />
          </div>
        </div>

        {/* Info and presets */}
        <div css={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, fontSize: 11 }}>
          <div >
            {pctDisplay && <span>{pctDisplay.pctW}% × {pctDisplay.pctH}%</span>}
          </div>
          <div css={{ display: "flex", gap: 6 }}>
            <button onClick={() => applyPreset(presets.full)} css={{ padding: "4px 8px", fontSize: 11, background: "#666", color: "white", border: "none", borderRadius: 3, cursor: "pointer", ":hover": { background: "#777" } }}>Full</button>
            <button onClick={() => applyPreset(presets.half_h)} css={{ padding: "4px 8px", fontSize: 11, background: "#666", color: "white", border: "none", borderRadius: 3, cursor: "pointer", ":hover": { background: "#777" } }}>Half H</button>
            <button onClick={() => applyPreset(presets.half_v)} css={{ padding: "4px 8px", fontSize: 11, background: "#666", color: "white", border: "none", borderRadius: 3, cursor: "pointer", ":hover": { background: "#777" } }}>Half V</button>
            <button onClick={() => applyPreset(presets.center)} css={{ padding: "4px 8px", fontSize: 11, background: "#666", color: "white", border: "none", borderRadius: 3, cursor: "pointer", ":hover": { background: "#777" } }}>Center</button>
          </div>
        </div>

        {/* Action buttons */}
        <div css={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={() => onCancel?.()}
            css={{ padding: "8px 16px", background: "#666", color: "white", border: "none", borderRadius: 4, cursor: "pointer", ":hover": { background: "#777" } }}
          >
            Cancel
          </button>
          <button
            onClick={() => region && onConfirm?.(region)}
            css={{ padding: "8px 16px", background: "#007bff", color: "white", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: "bold", ":hover": { background: "#0056b3" } }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default RegionSelector;
