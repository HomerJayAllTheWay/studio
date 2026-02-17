import {
  forwardRef,
  MouseEvent as ReactMouseEvent,
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  SyntheticEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { notNullish, useColorScheme } from "@opencast/appkit";

import { useDispatch, useStudioState, Recording } from "../../studio-state";
import CutOutIcon from "./cut-out-icon.svg";
import { VideoBox } from "../../ui/VideoBox";
import { SHORTCUTS, useShortcut } from "../../shortcuts";
import CropControls, { AspectMode, CropRect } from "../video-setup/CropControls";


type PreviewProps = {
  onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement, Event>) => void;
  onPausePlay: (paused: boolean) => void;
  onReady: () => void;
};

export type PreviewHandle = {
  currentTime: number;
  readonly duration: number;
  readonly isPlaying: boolean;
  readonly isReadyToPlay: boolean;
  play(): void;
  pause(): void;
};

export const Preview = forwardRef<PreviewHandle, PreviewProps>((
  { onTimeUpdate, onReady, onPausePlay },
  ref,
) => {
  const { recordings, start, end } = useStudioState();
  const { t } = useTranslation();
  const { isHighContrast } = useColorScheme();

  const videoRefs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const allVideos = videoRefs.slice(0, recordings.length);

  const [previewDims, setPreviewDims] = useState<Array<[number, number] | null>>(
    recordings.map(() => null),
  );
  useEffect(() => {
    setPreviewDims(prev => recordings.map((_r, i) => prev[i] ?? null));
  }, [recordings.length]);

  const handleDimsChange = (index: number, dims: [number, number]) => {
    setPreviewDims(prev => {
      const existing = prev[index];
      if (existing && existing[0] === dims[0] && existing[1] === dims[1]) {
        return prev;
      }
      const next = [...prev];
      next[index] = dims;
      return next;
    });
  };


  // When updating the currenTime, i.e. the play position, we want to throttle
  // this somehow. Just always setting `currentTime` is not ideal: consider
  // `onMouseMove`, which would set a new value very frequently. Chrome and
  // Firefox don't seem to handle that very well: every new time set will
  // cancel the in-progress seeking, leading to quite large delays.
  //
  // What we do instead is: if we are not currently seeking, just set the time
  // as normal. But if a seek operation is in progress, we just queue the time.
  // Further below, the `onSeeked` event handler is the second part of the
  // solution: when a seek operation has ended and a new time is queued, we
  // seek to that time again. Put simply: we just wait for seek operations to
  // finish before changing `currenTime` again.
  const queuedSeek = useRef<number | null>(null);
  const setTime = (newTime: number) => {
    const isSeeking = allVideos.some(v => v.current?.seeking);
    if (isSeeking) {
      queuedSeek.current = newTime;
    } else {
      allVideos.forEach(r => {
        if (r.current) {
          r.current.currentTime = Math.max(0, Math.min(newTime, r.current.duration));
        }
      });
    }
  };

  useImperativeHandle(ref, () => ({
    get currentTime() {
      return notNullish(videoRefs[0].current?.currentTime);
    },
    set currentTime(newTime) {
      setTime(newTime);
    },
    get duration() {
      return notNullish(videoRefs[0].current?.duration);
    },
    get isPlaying() {
      const v = videoRefs[0].current;
      return v != null && v.currentTime > 0 && !v.paused && !v.ended;
    },
    get isReadyToPlay() {
      // State 2 means "at least enough data to play one frame"
      return allVideos.every(r => (r.current?.readyState ?? 0) >= 2);
    },
    play() {
      allVideos.forEach(r => r.current?.play());
      onPausePlay(false);
    },
    pause() {
      allVideos.forEach(r => r.current?.pause());
      onPausePlay(true);
    },
  }));

  // Some logic to decide whether we currently are in a part of the video that
  // will be removed. The state will be updated in `onTimeUpdate` below and is
  // only here to trigger a rerender: the condition for rendering the overlay is
  // below.
  const isInCutRegion = (time: number) =>
    (start !== null && time < start) || (end !== null && time > end);
  const currentTime = videoRefs[0].current?.currentTime || 0;
  const overlayVisible = isInCutRegion(currentTime);
  const [, setOverlayVisible] = useState(overlayVisible);


  const jumpInTime = (diff: number) =>
    setTime(notNullish(videoRefs[0].current?.currentTime) + diff);

  // TODO: This is obviously not always correct. Finding out the FPS of the
  // recording is surprisingly tricky. And actually, browsers seem to record
  // with 30fps almost all of the time right now anway.
  const fps = 30;
  useShortcut(SHORTCUTS.review.forwards5secs, () => jumpInTime(5));
  useShortcut(SHORTCUTS.review.backwards5secs, () => jumpInTime(-5));
  useShortcut(SHORTCUTS.review.forwardsFrame, () => jumpInTime(1 / fps), { useKey: true });
  useShortcut(SHORTCUTS.review.backwardsFrame, () => jumpInTime(-1 / fps), { useKey: true });


  const children = recordings.map((recording, index) => ({
    dimensions: () => previewDims[index] ?? recording.dimensions ?? [16, 9] as [number, number],
    body: (
      <RecordingPreview
        key={index}
        recording={recording}
        overlayVisible={overlayVisible}
        onReady={onReady}
        onTimeUpdate={event => {
          setOverlayVisible(isInCutRegion(event.currentTarget.currentTime));
          onTimeUpdate(event);
        }}
        onSeeked={() => {
          const isOtherSeeking = videoRefs[index == 0 ? 1 : 0].current?.seeking;
          const queued = queuedSeek.current;
          if (!isOtherSeeking && queued != null) {
            allVideos.forEach(r => {
              if (r.current) {
                r.current.currentTime = queued;
              }
            });
            queuedSeek.current = null;
          }
        }}
        onDimsChange={dims => handleDimsChange(index, dims)}
        videoRef={videoRefs[index]}
        isHighContrast={isHighContrast}
      />
    ),
  }));

  return <VideoBox gap={20}>{children}</VideoBox>;
});

const MIN_CROP_SIZE = 50;

type RecordingPreviewProps = {
  recording: Recording;
  overlayVisible: boolean;
  onReady: () => void;
  onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement, Event>) => void;
  onSeeked: () => void;
  onDimsChange: (dims: [number, number]) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  isHighContrast: boolean;
};

const RecordingPreview: React.FC<RecordingPreviewProps> = ({
  recording,
  overlayVisible,
  onReady,
  onTimeUpdate,
  onSeeked,
  onDimsChange,
  videoRef,
  isHighContrast,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { finalDisplayCrop, finalUserCrop } = useStudioState();
  const [aspectMode, setAspectMode] = useState<AspectMode>("source");
  const [videoDims, setVideoDims] = useState<[number, number] | null>(recording.dimensions);

  const isDesktop = recording.deviceType === "desktop";
  const currentCrop = isDesktop ? finalDisplayCrop : finalUserCrop;
  const setCrop = (crop: CropRect | null) => dispatch({
    type: isDesktop ? "SET_FINAL_DISPLAY_CROP" : "SET_FINAL_USER_CROP",
    crop,
  });

  const fullFrameCrop = useMemo(() => {
    const dims = videoDims ?? recording.dimensions ?? [1280, 720];
    return { x: 0, y: 0, width: dims[0], height: dims[1] };
  }, [videoDims, recording.dimensions]);

  const ratioForMode = (mode: AspectMode): number | null => {
    const dims = videoDims ?? recording.dimensions;
    if (!dims) {
      return null;
    }
    if (mode === "source") {
      return dims[0] / dims[1];
    }
    switch (mode) {
      case "16:9":
        return 16 / 9;
      case "9:16":
        return 9 / 16;
      case "4:3":
        return 4 / 3;
      case "1:1":
        return 1;
      case "free":
        return null;
      default:
        return null;
    }
  };

  const fitCropToAspect = (crop: CropRect, ratio: number): CropRect => {
    const dims = videoDims ?? recording.dimensions ?? [1280, 720];
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    let width = crop.width;
    let height = width / ratio;
    if (height > crop.height) {
      height = crop.height;
      width = height * ratio;
    }
    width = Math.min(width, dims[0]);
    height = Math.min(height, dims[1]);
    let x = centerX - width / 2;
    let y = centerY - height / 2;
    x = Math.max(0, Math.min(x, dims[0] - width));
    y = Math.max(0, Math.min(y, dims[1] - height));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  };

  const handleCropReset = () => {
    const ratio = ratioForMode(aspectMode);
    if (ratio) {
      setCrop(fitCropToAspect(fullFrameCrop, ratio));
      return;
    }
    setCrop(fullFrameCrop);
  };

  const handleAspectModeChange = (mode: AspectMode) => {
    setAspectMode(mode);
    if (mode === "free") {
      return;
    }
    const ratio = ratioForMode(mode);
    if (!ratio) {
      setCrop(fullFrameCrop);
      return;
    }
    setCrop(fitCropToAspect(fullFrameCrop, ratio));
  };

  useEffect(() => {
    if (!videoDims && recording.dimensions) {
      setVideoDims(recording.dimensions);
    }
  }, [recording.dimensions, videoDims]);

  const aspectRatio = ratioForMode(aspectMode);
  const displayCrop = currentCrop ?? fullFrameCrop;

  return (
    <div css={{
      position: "relative",
      width: "100%",
      height: "100%",
    }}>
      <div css={{ position: "relative", width: "100%", height: "100%" }}>
        <CropOverlayVideo
          src={recording.url}
          crop={displayCrop}
          onCropDone={crop => setCrop(crop)}
          aspectRatio={aspectRatio}
          videoDims={videoDims ?? recording.dimensions}
          onReady={onReady}
          onTimeUpdate={onTimeUpdate}
          onSeeked={onSeeked}
          videoRef={videoRef}
          onDimsChange={dims => {
            setVideoDims(dims);
            onDimsChange(dims);
          }}
          isHighContrast={isHighContrast}
        />
        {overlayVisible && (
          <div css={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            color: "white",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "start",
            paddingTop: 16,
            pointerEvents: "none",
            borderRadius: 16,
          }}>
            <CutOutIcon css={{ fontSize: "3em" }}/>
            <p css={{ margin: "8px 0" }}>{t("steps.review.part-will-be-removed")}</p>
          </div>
        )}
      </div>
      <div css={{
        position: "absolute",
        left: 0,
        right: 0,
        top: "100%",
        marginTop: 10,
        zIndex: 5,
      }}>
        <CropControls
          onReset={handleCropReset}
          aspectMode={aspectMode}
          onAspectModeChange={handleAspectModeChange}
          supportsAdvancedCrop
        />
      </div>
    </div>
  );
};

type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const CropOverlayVideo: React.FC<{
  src: string;
  crop: CropRect | null;
  onCropDone: (crop: CropRect) => void;
  aspectRatio: number | null;
  videoDims: [number, number] | null | undefined;
  onReady: () => void;
  onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement, Event>) => void;
  onSeeked: () => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  onDimsChange: (dims: [number, number]) => void;
  isHighContrast: boolean;
}> = ({
  src,
  crop,
  onCropDone,
  aspectRatio,
  videoDims,
  onReady,
  onTimeUpdate,
  onSeeked,
  videoRef,
  onDimsChange,
  isHighContrast,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draftCrop, setDraftCrop] = useState<CropRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragModeRef = useRef<{
    mode: "move" | "resize";
    handle?: ResizeHandle;
    start: { x: number; y: number };
    startRect: CropRect;
  } | null>(null);

  const clampRectWithMin = (rect: CropRect, minSize: number) => {
    const dims = videoDims ?? [1280, 720];
    const maxW = dims[0];
    const maxH = dims[1];
    const width = clamp(rect.width, minSize, maxW);
    const height = clamp(rect.height, minSize, maxH);
    const x = clamp(rect.x, 0, Math.max(0, maxW - width));
    const y = clamp(rect.y, 0, Math.max(0, maxH - height));
    return { x, y, width, height };
  };

  const clampRect = (rect: CropRect) => clampRectWithMin(rect, MIN_CROP_SIZE);

  const applyAspectToRect = (rect: CropRect, anchor: "center" | "corner", handle?: ResizeHandle) => {
    if (!aspectRatio) {
      return rect;
    }
    const width = rect.width;
    const height = rect.height;
    if (width <= 0 || height <= 0) {
      return rect;
    }
    const targetRatio = aspectRatio;
    let nextWidth = width;
    let nextHeight = height;
    if (width / height > targetRatio) {
      nextWidth = height * targetRatio;
    } else {
      nextHeight = width / targetRatio;
    }

    if (anchor === "center") {
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      return {
        x: centerX - nextWidth / 2,
        y: centerY - nextHeight / 2,
        width: nextWidth,
        height: nextHeight,
      };
    }

    if (!handle) {
      return rect;
    }
    const next = { ...rect, width: nextWidth, height: nextHeight };
    if (handle.includes("w")) {
      next.x = rect.x + (rect.width - nextWidth);
    }
    if (handle.includes("n")) {
      next.y = rect.y + (rect.height - nextHeight);
    }
    return next;
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isDragging || !videoDims) {
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const end = {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    };

    const drag = dragModeRef.current;
    if (!drag || !videoDims) {
      return;
    }
    const scaleX = videoDims[0] / rect.width;
    const scaleY = videoDims[1] / rect.height;
    const deltaX = (end.x - drag.start.x) * scaleX;
    const deltaY = (end.y - drag.start.y) * scaleY;

    if (drag.mode === "move") {
      const moved = clampRect({
        ...drag.startRect,
        x: drag.startRect.x + deltaX,
        y: drag.startRect.y + deltaY,
      });
      setDraftCrop(moved);
      return;
    }

    if (drag.mode === "resize") {
      let next = { ...drag.startRect };
      const handle = drag.handle;
      if (!handle) {
        return;
      }

      if (handle.includes("e")) {
        next.width = drag.startRect.width + deltaX;
      }
      if (handle.includes("s")) {
        next.height = drag.startRect.height + deltaY;
      }
      if (handle.includes("w")) {
        next.x = drag.startRect.x + deltaX;
        next.width = drag.startRect.width - deltaX;
      }
      if (handle.includes("n")) {
        next.y = drag.startRect.y + deltaY;
        next.height = drag.startRect.height - deltaY;
      }

      next = clampRect(next);
      next = applyAspectToRect(next, handle.length === 2 ? "corner" : "center", handle);
      next = clampRect(next);
      setDraftCrop(next);
    }
  };

  const handleMouseUp = (_event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isDragging) {
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const finalCrop = draftCrop;
    dragModeRef.current = null;
    setIsDragging(false);
    setDraftCrop(null);
    if (finalCrop && finalCrop.width >= MIN_CROP_SIZE && finalCrop.height >= MIN_CROP_SIZE) {
      onCropDone(finalCrop);
    }
  };

  const startMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!crop || !videoDims) {
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const start = {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    };
    dragModeRef.current = { mode: "move", start, startRect: crop };
    setIsDragging(true);
    setDraftCrop(crop);
  };

  const startResize = (event: ReactMouseEvent<HTMLDivElement>, handle: ResizeHandle) => {
    if (!crop || !videoDims) {
      return;
    }
    event.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const start = {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    };
    dragModeRef.current = {
      mode: "resize",
      handle,
      start,
      startRect: crop,
    };
    setIsDragging(true);
    setDraftCrop(crop);
  };

  const overlayCrop = draftCrop || crop;
  
  const overlayMetrics = overlayCrop && videoDims ? {
    leftPct: (overlayCrop.x / videoDims[0]) * 100,
    topPct: (overlayCrop.y / videoDims[1]) * 100,
    widthPct: (overlayCrop.width / videoDims[0]) * 100,
    heightPct: (overlayCrop.height / videoDims[1]) * 100,
    rightPct: ((overlayCrop.x + overlayCrop.width) / videoDims[0]) * 100,
    bottomPct: ((overlayCrop.y + overlayCrop.height) / videoDims[1]) * 100,
  } : null;

  return (
    <div
      ref={containerRef}
      css={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      <video
        ref={videoRef}
        src={src}
        onLoadedData={() => onReady()}
        onLoadedMetadata={event => {
          const width = event.currentTarget.videoWidth;
          const height = event.currentTarget.videoHeight;
          if (width && height) {
            onDimsChange([width, height]);
          }
        }}
        onSeeked={onSeeked}
        onTimeUpdate={onTimeUpdate}
        autoPlay={/iPad|iPhone|iPod/.test(navigator.userAgent)}
        playsInline
        preload="auto"
        tabIndex={-1}
        css={{
          width: "100%",
          height: "100%",
          outline: "none",
          boxShadow: isHighContrast ? "none" : "0 4px 16px var(--shadow-color)",
          display: "block",
        }}
      />
      {overlayCrop && overlayMetrics && (
        <>
          <div css={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: `${overlayMetrics.topPct}%`,
            background: "rgba(0, 0, 0, 0.45)",
            pointerEvents: "none",
          }} />
          <div css={{
            position: "absolute",
            left: 0,
            top: `${overlayMetrics.bottomPct}%`,
            width: "100%",
            height: `${100 - overlayMetrics.bottomPct}%`,
            background: "rgba(0, 0, 0, 0.45)",
            pointerEvents: "none",
          }} />
          <div css={{
            position: "absolute",
            left: 0,
            top: `${overlayMetrics.topPct}%`,
            width: `${overlayMetrics.leftPct}%`,
            height: `${overlayMetrics.heightPct}%`,
            background: "rgba(0, 0, 0, 0.45)",
            pointerEvents: "none",
          }} />
          <div css={{
            position: "absolute",
            left: `${overlayMetrics.rightPct}%`,
            top: `${overlayMetrics.topPct}%`,
            width: `${100 - overlayMetrics.rightPct}%`,
            height: `${overlayMetrics.heightPct}%`,
            background: "rgba(0, 0, 0, 0.45)",
            pointerEvents: "none",
          }} />
          <div css={{
            position: "absolute",
            left: `${overlayMetrics.leftPct}%`,
            top: `${overlayMetrics.topPct}%`,
            width: `${overlayMetrics.widthPct}%`,
            height: `${overlayMetrics.heightPct}%`,
            border: "2px solid #4faf80",
            boxSizing: "border-box",
            pointerEvents: "auto",
            cursor: "move",
            zIndex: 1,
          }} />
        </>
      )}
      {overlayCrop && overlayMetrics && (
        <>
          {([
            { key: "nw" as const, x: overlayMetrics.leftPct, y: overlayMetrics.topPct, cursor: "nwse-resize" },
            { key: "ne" as const, x: overlayMetrics.rightPct, y: overlayMetrics.topPct, cursor: "nesw-resize" },
            { key: "se" as const, x: overlayMetrics.rightPct, y: overlayMetrics.bottomPct, cursor: "nwse-resize" },
            { key: "sw" as const, x: overlayMetrics.leftPct, y: overlayMetrics.bottomPct, cursor: "nesw-resize" },
            { key: "n" as const, x: overlayMetrics.leftPct + overlayMetrics.widthPct / 2, y: overlayMetrics.topPct, cursor: "ns-resize" },
            { key: "s" as const, x: overlayMetrics.leftPct + overlayMetrics.widthPct / 2, y: overlayMetrics.bottomPct, cursor: "ns-resize" },
            { key: "w" as const, x: overlayMetrics.leftPct, y: overlayMetrics.topPct + overlayMetrics.heightPct / 2, cursor: "ew-resize" },
            { key: "e" as const, x: overlayMetrics.rightPct, y: overlayMetrics.topPct + overlayMetrics.heightPct / 2, cursor: "ew-resize" },
          ]).map(handle => (
            <div
              key={handle.key}
              onMouseDown={event => startResize(event, handle.key)}
              css={{
                position: "absolute",
                width: handle.key.length === 1 ? 12 : 10,
                height: handle.key.length === 1 ? 12 : 10,
                background: "#4faf80",
                borderRadius: 2,
                cursor: handle.cursor,
                left: `${handle.x}%`,
                top: `${handle.y}%`,
                transform: "translate(-50%, -50%)",
                zIndex: 3,
              }}
            />
          ))}
        </>
      )}
      {overlayCrop && overlayMetrics && (
        <div
          onMouseDown={startMove}
          css={{
            position: "absolute",
            left: `${overlayMetrics.leftPct}%`,
            top: `${overlayMetrics.topPct}%`,
            width: `${overlayMetrics.widthPct}%`,
            height: `${overlayMetrics.heightPct}%`,
            cursor: "move",
            background: "rgba(0, 0, 0, 0.01)",
            zIndex: 2,
          }}
        />
      )}
      <div
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        css={{
          position: "absolute",
          inset: 0,
          cursor: isDragging ? "grabbing" : "default",
          pointerEvents: isDragging ? "auto" : "none",
          background: "transparent",
          zIndex: 4,
        }}
      />
    </div>
  );
};
