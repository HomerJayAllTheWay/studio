// Everything related to video stream preferences that the user can modify.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Floating, FloatingContainer, FloatingHandle, FloatingTrigger, ProtoButton,
  WithTooltip, screenWidthAtMost, useColorScheme,
} from "@opencast/appkit";
import { FiSettings, FiX } from "react-icons/fi";
import { CSSObject } from "@emotion/react";

import { useSettings } from "../../settings";
import { COLORS, getUniqueDevices } from "../../util";
import { useDispatch, useStudioState } from "../../studio-state";
import {
  startDisplayCapture,
  startUserCapture,
  stopDisplayCapture,
  stopUserCapture,
} from "../../capturer";
import { Select } from "../../ui/Select";
import { OVERLAY_STYLE } from "./preview";


/**
 * Creates a valid constraints object from the given preferences. The mapping
 * is as follows:
 *
 * - deviceId: falsy values are ignored, any other value is passed on, either as
 *   `ideal` (if `exactDevice` is `false`) or `exact` (if `exactDevice` is
 *   `true`).
 * - aspectRatio: values in `ASPECT_RATIOS` are passed as `ideal`, everything
 *   else is ignored.
 * - quality: valid quality labels are passed on as `ideal` height, invalid ones
 *   are ignored.
 */
export const prefsToConstraints = (
  prefs: CameraPrefs | DisplayPrefs,
  exactDevice = false,
): MediaTrackConstraints => {
  const deviceConstraint = "deviceId" in prefs
    && { deviceId: { [exactDevice ? "exact" : "ideal"]: prefs.deviceId } };

  const aspectRatioConstraint = "aspectRatio" in prefs && {
    aspectRatio: { ideal: prefs.aspectRatio ? parseAspectRatio(prefs.aspectRatio) : undefined },
  };

  const heightConstraint = "quality" in prefs && {
    height: { ideal: prefs.quality ? parseQuality(prefs.quality) : undefined },
  };

  return {
    ...deviceConstraint,
    ...aspectRatioConstraint,
    ...heightConstraint,
  };
};

// Quality/aspect ratio controls are fixed to auto.

// Converts the given aspect ratio label (one of the elements in
// `ASPECT_RATIOS`) into the numerical ratio, e.g. 4/3 = 1.333. If the argument
// is not a valid label, `null` is returned.
const parseAspectRatio = (label: string) => {
  const mapping = {
    "4:3": 4 / 3,
    "16:9": 16 / 9,
  };

  return (mapping as Record<string, number>)[label] ?? undefined;
};

// Converts the given quality label to the actual height as number. If the
// argument is not a valid quality label (e.g. '720p'), `null` is returned.
const parseQuality = (label: string) => {
  if (!/^[0-9]+p$/.test(label)) {
    return undefined;
  }

  return parseInt(label);
};

// Local storage keys
const LAST_VIDEO_DEVICE_KEY = "ocStudioLastVideoDevice";
const CAMERA_ASPECT_RATIO_KEY = "ocStudioCameraAspectRatio";
const CAMERA_QUALITY_KEY = "ocStudioCameraQuality";
const DISPLAY_QUALITY_KEY = "ocStudioDisplayQuality";

type CameraPrefs = {
  deviceId?: string;
  aspectRatio?: string;
  quality?: string;
};

type DisplayPrefs = {
  quality?: string;
};

// Loads the initial camera preferences from local storage.
export const loadCameraPrefs = (): CameraPrefs => ({
  deviceId: window.localStorage.getItem(LAST_VIDEO_DEVICE_KEY) ?? undefined,
  aspectRatio: "auto",
  quality: "auto",
});

// Loads the initial display preferences from local storage.
export const loadDisplayPrefs = (): DisplayPrefs => ({
  quality: "auto",
});

type StreamSettingsProps = {
  isDesktop: boolean;
  stream: MediaStream | null;
  inline?: boolean;
}

export const StreamSettings: React.FC<StreamSettingsProps> = ({ isDesktop, stream, inline = false }) => {
  const dispatch = useDispatch();
  const settings = useSettings();
  const floatRef = useRef<FloatingHandle>(null);
  const { t } = useTranslation();
  const isLight = useColorScheme().scheme === "light";
  const { isHighContrast } = useColorScheme();

  // The current preferences and the callback to update them.
  const prefs = isDesktop ? loadDisplayPrefs() : loadCameraPrefs();
  const updatePrefs = (newPrefs: CameraPrefs | DisplayPrefs) => {
    // Merge and update preferences.
    const merged = { ...prefs, ...newPrefs };
    if ("quality" in merged) {
      merged.quality = "auto";
    }
    if ("aspectRatio" in merged) {
      merged.aspectRatio = "auto";
    }
    const constraints = prefsToConstraints(merged, true);

    const setOpt = (key: string, v: string | undefined) => {
      if (v != null) {
        window.localStorage.setItem(key, v);
      }
    };

    // Update preferences in local storage and re-request stream. The latter
    // will cause the rerender.
    if (isDesktop) {
      setOpt(DISPLAY_QUALITY_KEY, "auto");

      stopDisplayCapture(stream, dispatch);
      startDisplayCapture(dispatch, settings, constraints);
    } else {
      setOpt(LAST_VIDEO_DEVICE_KEY, (merged as Record<string, string>)["deviceId"]);
      setOpt(CAMERA_ASPECT_RATIO_KEY, "auto");
      setOpt(CAMERA_QUALITY_KEY, "auto");

      stopUserCapture(stream, dispatch);
      startUserCapture(dispatch, settings, constraints);
    }
  };

  // Store the camera device ID in local storage. We also do this here, as we
  // also want to remember the device the user initially selected in the browser
  // popup.
  useEffect(() => {
    const cameraDeviceId = deviceIdOf(stream);
    if (!isDesktop && cameraDeviceId) {
      window.localStorage.setItem(LAST_VIDEO_DEVICE_KEY, cameraDeviceId);
    }
  });

  // State about expanding and hiding the settings.
  const [isExpanded, setIsExpanded] = useState(false);
  const label = t(`steps.video.video-settings-${isExpanded ? "close" : "open"}` as const);

  const relaunchDisplayPicker = () => {
    const constraints = prefsToConstraints(loadDisplayPrefs(), true);
    stopDisplayCapture(stream, dispatch);
    startDisplayCapture(dispatch, settings, constraints);
  };

  const inlineContainerCss: CSSObject = {
    position: "relative",
    right: "auto",
    bottom: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: 24,
  };

  const absoluteContainerCss: CSSObject = {
    position: "absolute",
    right: 8,
    bottom: 8,
  };

  const containerCss = inline ? inlineContainerCss : absoluteContainerCss;

  if (isDesktop) {
    return (
      <FloatingContainer
        ref={floatRef}
        placement="top-end"
        ariaRole="dialog"
        open={false}
        onClose={() => setIsExpanded(false)}
        borderRadius={8}
        viewPortMargin={8}
        css={containerCss}
      >
        <FloatingTrigger>
          <WithTooltip placement="bottom" tooltip={t("steps.video.reselect-source")}>
            <ProtoButton
              onClick={relaunchDisplayPicker}
              aria-label={t("steps.video.reselect-source")}
              css={{
                ...OVERLAY_STYLE,
                ...inline && {
                  backgroundColor: "transparent",
                  "&:hover, &:focus-visible": { backgroundColor: "transparent" },
                },
                fontSize: 26,
              }}
            >
              <FiSettings />
            </ProtoButton>
          </WithTooltip>
        </FloatingTrigger>
      </FloatingContainer>
    );
  }

  return <>
    {/* Stream info at the top */}
    <div css={{
      display: isExpanded ? "initial" : "none",
      position: "absolute",
      top: 12,
      left: 0,
      right: 0,
      textAlign: "center",
    }}>
      <span css={{
        color: isLight ? COLORS.neutral70 : COLORS.neutral90,
        backgroundColor: COLORS.neutral05,
        borderRadius: "10px",
        padding: "4px 8px",
        boxShadow: isHighContrast ? "none" : "0 0 12px rgba(0, 0, 0, 30%)",
      }}>
        {streamInfo(stream)}
      </span>
    </div>

    {/* The settings button and the popover dialog */}
    <FloatingContainer
      ref={floatRef}
      placement="top-end"
      ariaRole="dialog"
      open={isExpanded}
      onClose={() => setIsExpanded(false)}
      borderRadius={8}
      viewPortMargin={8}
      css={containerCss}
    >
      <FloatingTrigger>
        <WithTooltip placement="bottom" tooltip={label}>
          <ProtoButton
            onClick={() => setIsExpanded(old => !old)}
            aria-label={label}
            css={{
              ...OVERLAY_STYLE,
              ...inline && {
                backgroundColor: "transparent",
                "&:hover, &:focus-visible": { backgroundColor: "transparent" },
              },
              fontSize: 26,
              "> svg": {
                transition: "transform 0.2s",
              },
              "&:hover > svg, &:focus > svg": {
                transform: isExpanded ? "none" : "rotate(45deg)",
              },
            }}
          >
            {isExpanded ? <FiX /> : <FiSettings />}
          </ProtoButton>
        </WithTooltip>
      </FloatingTrigger>
      <Floating
        css={{ maxWidth: "min(670px, 100vw - 16px)" }}
        borderWidth={isLight ? 0 : 1}
        shadowBlur={16}
        padding={18}
      >
        <div css={{
          display: "grid",
          width: "100%",
          gridTemplateColumns: "auto 1fr",
          gridGap: "14px 32px",
          paddingLeft: 4,
          [screenWidthAtMost(450)]: {
            columnGap: 8,
          },
          [screenWidthAtMost(360)]: {
            gridTemplateColumns: "1fr",
            rowGap: 0,
          },
          fontSize: 14,
          "@media (min-width: 420px) and (min-height: 440px)": {
            fontSize: 16,
          },
        }}>
          {!isDesktop && <UserSettings updatePrefs={updatePrefs} />}
        </div>

      </Floating>
    </FloatingContainer>
  </>;
};

const streamInfo = (stream: MediaStream | null) => {
  const s = stream?.getVideoTracks()?.[0]?.getSettings();
  const sizeInfo = (s && s.width && s.height) ? `${s.width}×${s.height}` : "";
  const fpsInfo = (s && s.frameRate) ? `${s.frameRate} fps` : "";

  return s ? [sizeInfo, fpsInfo].join(", ") : "...";
};

/** Div for the name of a value, e.g. quality, aspect ratio, .. */
const PrefKey: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div css={{
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    [screenWidthAtMost(360)]: {
      marginTop: 4,
    },
  }}>
    { children }
  </div>
);

/** Container for the value selection of an option, e.g. all available qualities. */
const PrefValue: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div css={{
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  }}>
    { children }
  </div>
);


type UserSettingsProps = {
  updatePrefs: (p: CameraPrefs | DisplayPrefs) => void;
};


const UserSettings: React.FC<UserSettingsProps> = ({ updatePrefs }) => {
  const { t } = useTranslation();
  const state = useStudioState();

  const currentDeviceId = deviceIdOf(state.userStream);
  const devices = getUniqueDevices(state.mediaDevices, "videoinput");

  const changeDevice = (id: string) => updatePrefs({ deviceId: id });

  return <>
    <PrefKey>
      <label htmlFor="sources-video-device">{t("steps.video.device")}</label>
    </PrefKey>
    <PrefValue>
      <Select
        id="sources-video-device"
        value={currentDeviceId}
        onChange={e => changeDevice(e.target.value)}
        css={{ width: "100%" }}
      >
        {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
      </Select>
    </PrefValue>

  </>;
};

type RadioButtonProps = {
  id: string;
  name: string;
  value: string;
  checked: boolean;
  label?: string;
  onChange: (v: string) => void;
};

// A styled radio input which looks like a button.
const RadioButton: React.FC<RadioButtonProps> = ({
  id, value, checked, name, onChange, label,
}) => {
  const { isHighContrast } = useColorScheme();

  return <div>
    <input
      type="radio"
      onChange={e => onChange(e.target.value)}
      {...{ id, value, checked, name }}
      css={{
        display: "none",
        "&+label": {
          display: "block",
          border: `1px solid ${COLORS.neutral25}`,
          lineHeight: 1.2,
          padding: "4px 10px",
          borderRadius: 6,
          fontWeight: 500,
          cursor: "pointer",
          ":hover": {
            backgroundColor: COLORS.neutral10,
            borderColor: COLORS.neutral40,
            ...isHighContrast && {
              outline: `2px solid ${COLORS.accent4}`,
              borderColor: "transparent",
            },
          },
        },
        "&:checked+label": {
          backgroundColor: COLORS.accent6,
          borderColor: COLORS.accent6,
          color: COLORS.neutral05,
          cursor: "default",
        },
      }}
    />
    <label
      tabIndex={0}
      onKeyDown={e => (e.key === "Enter" || e.key === " ") && onChange(value)}
      htmlFor={id}
    >{label ?? value}</label>
  </div>;
};

// Returns the devide ID of the video track of the given stream.
export const deviceIdOf = (stream: MediaStream | null) =>
  stream?.getVideoTracks()?.[0]?.getSettings()?.deviceId;
