import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiDownload } from "react-icons/fi";
import { LuCircleCheckBig } from "react-icons/lu";

import { useDispatch, useStudioState, Recording } from "../../studio-state";
import { recordingFileName } from "../../util";
import { SHORTCUTS, ShortcutKeys, useShortcut, useShowAvailableShortcuts } from "../../shortcuts";
import { prettyFileSize, sharedButtonStyle } from ".";
import { useColorScheme } from "@opencast/appkit";



export const SaveLocally: React.FC = () => {
  const { recordings } = useStudioState();
  return recordings.map((r, i) => <SaveLocallySingle key={i} idx={i} recording={r} />);
};

type SaveLocallySingleProps = {
  recording: Recording;
  idx: number;
};

const SaveLocallySingle: React.FC<SaveLocallySingleProps> = ({ recording, idx }) => {
  const { t, i18n } = useTranslation();
  const {
    title,
    presenter,
    start,
    end,
    recordingStartTime,
    recordingEndTime,
    finalDisplayCrop,
    finalUserCrop,
  } = useStudioState();
  const { isHighContrast } = useColorScheme();
  const dispatch = useDispatch();
  const showShortcuts = useShowAvailableShortcuts();

  const button = useRef<HTMLAnchorElement>(null);
  useShortcut(SHORTCUTS.finish.download, () => {
    button.current?.click();
  });

  const { deviceType, mimeType, url, downloaded, media: blob } = recording;
  const flavor = deviceType === "desktop" ? t("sources-display") : t("sources-user");
  const downloadName = recordingFileName({ mime: mimeType, flavor, title, presenter });
  const crop = deviceType === "desktop" ? finalDisplayCrop : finalUserCrop;
  const metadata = useMemo(() => ({
    version: 1,
    deviceType,
    mimeType,
    dimensions: recording.dimensions,
    trim: {
      start,
      end,
    },
    crop,
    recordingStartTime: recordingStartTime?.toISOString() ?? null,
    recordingEndTime: recordingEndTime?.toISOString() ?? null,
  }), [
    crop,
    deviceType,
    end,
    mimeType,
    recording.dimensions,
    recordingEndTime,
    recordingStartTime,
    start,
  ]);
  const metadataBlob = useMemo(() => new Blob(
    [JSON.stringify(metadata, null, 2)],
    { type: "application/json" },
  ), [metadata]);
  const [metadataUrl, setMetadataUrl] = useState<string>("");
  const metadataName = useMemo(() => {
    const baseName = downloadName.replace(/\.[^/.]+$/, "");
    return `${baseName || downloadName}.crop.json`;
  }, [downloadName]);

  useEffect(() => {
    setMetadataUrl(prev => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return URL.createObjectURL(metadataBlob);
    });
    return () => {
      setMetadataUrl(prev => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return "";
      });
    };
  }, [metadataBlob]);

  if (!url) {
    return null;
  }

  return (
    <div css={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      ":not(:first-of-type)": {
        marginTop: 32,
      },
    }}>
      <div css={{
        position: "relative",
      }}>
        <video
          tabIndex={-1}
          muted
          src={url}
          // Without this, some browsers show a black video element instead of the first frame.
          onLoadedData={e => e.currentTarget.currentTime = 0}
          preload="auto"
          css={{
            borderRadius: 4,
            display: "block",
            maxHeight: 190,
            maxWidth: "100%",
            margin: "0 auto",
          }}
        />
        {downloaded && (
          <div css={{
            position: "absolute",
            bottom: 0,
            right: 0,
            left: 0,
            color: "white",
            backgroundColor: "rgba(30, 30, 30, 0.85)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            padding: 12,
            borderRadius: "0 0 4px 4px",
          }}>
            <LuCircleCheckBig css={{ fontSize: 22 }} />
            {t("steps.finish.save-locally.recording-saved")}
          </div>
        )}
      </div>
      <a
        ref={button}
        aria-label={t(`steps.finish.save-locally.save-${deviceType}-locally`)}
        target="_blank"
        download={downloadName}
        href={url}
        rel="noopener noreferrer"
        role="button"
        onClick={() => dispatch({ type: "MARK_DOWNLOADED", index: idx })}
        onKeyDown={e => {
          if (e.key === " ") {
            e.preventDefault();
            button.current?.click();
          }
        }}
        css={{
          ...sharedButtonStyle(isHighContrast),
          justifyContent: "center",
          maxWidth: 260,
          margin: "auto",
          marginTop: 8,
        }}
      >
        <FiDownload css={{ fontSize: 20 }} />
        {t("steps.finish.save-locally.label") + " (" + prettyFileSize(blob.size, i18n) + ")"}
        {showShortcuts && (
          <div css={{ position: "absolute", right: -4, bottom: -4 }}>
            <ShortcutKeys shortcut={SHORTCUTS.finish.download} />
          </div>
        )}
      </a>
      <a
        aria-label={t("steps.finish.save-locally.save-crop-metadata")}
        download={metadataName}
        href={metadataUrl}
        role="button"
        css={{
          ...sharedButtonStyle(isHighContrast),
          justifyContent: "center",
          maxWidth: 260,
          margin: "auto",
          marginTop: 8,
        }}
      >
        <FiDownload css={{ fontSize: 20 }} />
        {t("steps.finish.save-locally.save-crop-metadata")}
        {" (" + prettyFileSize(metadataBlob.size, i18n) + ")"}
      </a>
    </div>
  );
};
