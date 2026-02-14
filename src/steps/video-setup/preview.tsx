import { JSX, MouseEvent, useEffect, useRef, useState, useMemo } from "react";
import { Spinner, WithTooltip, match, unreachable, useColorScheme } from "@opencast/appkit";
import { Trans, useTranslation } from "react-i18next";
import { LuInfo, LuVolume2, LuVolumeX } from "react-icons/lu";

import { COLORS, dimensionsOf } from "../../util";
import { VideoBox, useVideoBoxResize } from "../../ui/VideoBox";
import { ErrorBox } from "../../ui/ErrorBox";
import { StreamSettings } from "./prefs";
import { Input } from ".";
import CropControls, { AspectMode, CropRect } from "./CropControls";
import { useDispatch, useStudioState } from "../../studio-state";

export type SourcePreviewProps = {
  inputs: Input[];
};

/**
 * Shows the preview for one or two input streams. The previews also show
 * preferences allowing the user to change the webcam and the like.
 */
export const SourcePreview: React.FC<SourcePreviewProps> = ({ inputs }) => {
  const children = match(inputs.length, {
    1: () => [{
      body: <StreamPreview input={inputs[0]} />,
      dimensions: () => dimensionsOf(inputs[0].stream),
      autoSize: inputHasError(inputs[0]),
    }],
    2: () => [
      {
        body: <StreamPreview input={inputs[0]} />,
        dimensions: () => dimensionsOf(inputs[0].stream),
        autoSize: inputHasError(inputs[0]),
      },
      {
        body: <StreamPreview input={inputs[1]} />,
        dimensions: () => dimensionsOf(inputs[1].stream),
        autoSize: inputHasError(inputs[1]),
      },
    ],
  }) ?? unreachable();

  return (
    <div css={{
      flex: "1 1 0",
      minHeight: 0,
      width: "100%",
      display: "flex",
      flexDirection: "column",
      alignSelf: "stretch",
    }}>
      <div css={{
        flex: "1 1 0",
        minHeight: 0,
        width: "100%",
        marginBottom: inputs.length === 2 ? 72 : 56,
      }}>
        <VideoBox gap={20} minHeight={320}>{children}</VideoBox>
      </div>
    </div>
  );
};

const inputHasError = (input: Input): boolean =>
  input.allowed === false || !!input.unexpectedEnd;

/** Shows a single stream as preview, deals with potential errors and shows preferences UI */
const StreamPreview: React.FC<{ input: Input }> = ({ input }) => {
  const { isHighContrast } = useColorScheme();
  const dispatch = useDispatch();
  const state = useStudioState();
  const [aspectMode, setAspectMode] = useState<AspectMode>("source");

  // Determine which crop to use based on input type
  const currentCrop = input.isDesktop ? state.displayCrop : state.userCrop;

  const handleCropApply = (crop: CropRect | null) => {
    const action = input.isDesktop
      ? { type: "SET_DISPLAY_CROP" as const, crop }
      : { type: "SET_USER_CROP" as const, crop };
    dispatch(action);
  };

  const streamDims = dimensionsOf(input.stream) || [1280, 720];
  const fullFrameCrop = {
    x: 0,
    y: 0,
    width: streamDims[0],
    height: streamDims[1],
  };

  const ratioForMode = (mode: AspectMode): number | null => {
    if (mode === "source") {
      return streamDims[0] / streamDims[1];
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
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    let width = crop.width;
    let height = width / ratio;
    if (height > crop.height) {
      height = crop.height;
      width = height * ratio;
    }
    width = Math.min(width, streamDims[0]);
    height = Math.min(height, streamDims[1]);
    let x = centerX - width / 2;
    let y = centerY - height / 2;
    x = Math.max(0, Math.min(x, streamDims[0] - width));
    y = Math.max(0, Math.min(y, streamDims[1] - height));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  };

  const handleCropReset = () => {
    const ratio = ratioForMode(aspectMode);
    if (ratio) {
      handleCropApply(fitCropToAspect(fullFrameCrop, ratio));
      return;
    }
    handleCropApply(fullFrameCrop);
  };

  useEffect(() => {
    if (!input.stream) {
      return;
    }
    if (!currentCrop) {
      const ratio = ratioForMode(aspectMode);
      if (ratio) {
        handleCropApply(fitCropToAspect(fullFrameCrop, ratio));
        return;
      }
      handleCropApply(fullFrameCrop);
    }
  }, [input.stream, currentCrop, streamDims[0], streamDims[1], aspectMode]);
  const aspectRatio = ratioForMode(aspectMode);

  const supportsAdvancedCrop = useMemo(() => {
    try {
      const g = globalThis as unknown as Record<string, unknown>;
      const hasProcessor = typeof g.MediaStreamTrackProcessor === "function";
      const hasGenerator = typeof g.MediaStreamTrackGenerator === "function";
      const hasOffscreen = typeof g.OffscreenCanvas !== "undefined";
      return !!(hasProcessor && hasGenerator && hasOffscreen);
    } catch (e) {
      return false;
    }
  }, []);

  const handleAspectModeChange = (mode: AspectMode) => {
    setAspectMode(mode);
    if (mode === "free") {
      return;
    }
    const ratio = ratioForMode(mode);
    if (!ratio) {
      handleCropApply(fullFrameCrop);
      return;
    }
    handleCropApply(fitCropToAspect(fullFrameCrop, ratio));
  };

  return (
    <div css={{
      height: "100%",
      backgroundColor: COLORS.neutral05,
      borderRadius: 0,
      position: "relative",
      overflow: "visible",
      ...!inputHasError(input) && {
        boxShadow: isHighContrast ? "none" : "0 6px 16px rgba(0, 0, 0, 0.2)",
      },
      ...isHighContrast && {
        outline: `1px solid ${COLORS.neutral90}`,
      },
    }}>
      <div css={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        borderRadius: 0,
      }}>
        <PreviewVideo
          input={input}
          crop={currentCrop}
          onCropDone={crop => {
            handleCropApply(crop);
          }}
          streamDims={streamDims}
          aspectRatio={aspectRatio}
        />
      </div>
      {input.stream && <>
        {input.isDesktop && <DisplayAudioInfo stream={input.stream} />}
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
            supportsAdvancedCrop={supportsAdvancedCrop}
            rightSlot={<StreamSettings isDesktop={input.isDesktop} stream={input.stream} inline />}
          />
        </div>
      </>}
    </div>
  );
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const MIN_CROP_SIZE = 50;

type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

const PreviewVideo: React.FC<{
  input: Input;
  crop: CropRect | null;
  onCropDone: (crop: CropRect) => void;
  streamDims: [number, number];
  aspectRatio: number | null;
}> = ({ input, crop, onCropDone, streamDims, aspectRatio }) => {
  const { t } = useTranslation();
  const { allowed, stream, unexpectedEnd } = input;
  const resizeVideoBox = useVideoBoxResize();

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [draftCrop, setDraftCrop] = useState<CropRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragModeRef = useRef<{
    mode: "move" | "resize";
    handle?: ResizeHandle;
    start: { x: number; y: number };
    startRect: CropRect;
  } | null>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      if (!v.srcObject) {
        v.srcObject = stream;
      }
      v.addEventListener("resize", resizeVideoBox);
    }

    return () => {
      if (v) {
        v.removeEventListener("resize", resizeVideoBox);
      }
    };
  }, [stream, resizeVideoBox]);

  if (!stream) {
    let inner: JSX.Element;
    if (allowed === false || unexpectedEnd) {
      inner = <div>
        {allowed === false && <ErrorBox
          css={{ margin: 0 }}
          title={t(`steps.video.${input.isDesktop ? "display" : "user"}-not-allowed-title`)}
          body={t(`steps.video.${input.isDesktop ? "display" : "user"}-not-allowed-text`)}
        />}
        {/* TODO: differentiate between desktop and camera for better error */}
        {unexpectedEnd && <ErrorBox css={{ margin: 0 }} body={t("error-lost-video-stream")} />}
      </div>;
    } else {
      inner = <Spinner size={75} css={{ color: COLORS.neutral60 }} />;
    }

    return (
      <div css={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
      }}>
        <div css={{
          flex: "1",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}>
          {inner}
        </div>
      </div>
    );
  }

  const clampRectWithMin = (rect: CropRect, minSize: number) => {
    const maxW = streamDims[0];
    const maxH = streamDims[1];
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

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!isDragging) {
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
    if (!drag) {
      return;
    }
    const scaleX = streamDims[0] / rect.width;
    const scaleY = streamDims[1] / rect.height;
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

  const handleMouseUp = (_event: MouseEvent<HTMLDivElement>) => {
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

  const startMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!crop) {
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

  const startResize = (event: MouseEvent<HTMLDivElement>, handle: ResizeHandle) => {
    if (!crop) {
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
  const overlayMetrics = overlayCrop ? {
    leftPct: (overlayCrop.x / streamDims[0]) * 100,
    topPct: (overlayCrop.y / streamDims[1]) * 100,
    widthPct: (overlayCrop.width / streamDims[0]) * 100,
    heightPct: (overlayCrop.height / streamDims[1]) * 100,
    rightPct: ((overlayCrop.x + overlayCrop.width) / streamDims[0]) * 100,
    bottomPct: ((overlayCrop.y + overlayCrop.height) / streamDims[1]) * 100,
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
        autoPlay
        muted
        playsInline
        css={{
          minHeight: 0,
          display: "block",
          width: "100%",
          height: "100%",
          borderRadius: 0,
        }}
      />
      {overlayCrop && overlayMetrics && (
        <>
          {/* Darkened areas outside crop region */}
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
          {/* Crop border */}
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
          borderRadius: 0,
          zIndex: 4,
        }}
      />
    </div>
  );
};

export const DisplayAudioInfo: React.FC<{ stream: MediaStream }> = ({ stream }) => {
  const hasAudio = stream.getAudioTracks().length;

  return (
    <div css={{
      position: "absolute",
      top: 8,
      right: 8,
    }}>
      <WithTooltip
        placement="top"
        tooltip={
          <Trans i18nKey={
            `steps.video.${hasAudio ? "display-audio-shared" : "display-audio-not-shared"}`
          }>
            <strong>Note:</strong> Explanation.
          </Trans>
        }
      >
        <div css={{ ...OVERLAY_STYLE, fontSize: 15 }}>
          <LuInfo /> {hasAudio ? <LuVolume2 /> : <LuVolumeX />}
        </div>
      </WithTooltip>
    </div>
  );
};

export const OVERLAY_STYLE = {
  border: "none",
  display: "inline-block",
  backgroundColor: "rgba(0, 0, 0, 0.3)",
  color: "white",
  padding: 8,
  backdropFilter: "invert(0.3) blur(4px)",
  lineHeight: 0,
  borderRadius: 10,
  cursor: "pointer",
  "&:hover, &:focus-visible": {
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  "&:focus-visible": {
    outline: "5px dashed white",
    outlineOffset: -2.5,
  },
};
