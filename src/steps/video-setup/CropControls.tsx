import React from "react";

export type CropRect = { x: number; y: number; width: number; height: number };

export type AspectMode = "source" | "16:9" | "4:3" | "9:16" | "1:1" | "free";

type Props = {
  onReset: () => void;
  aspectMode: AspectMode;
  onAspectModeChange: (mode: AspectMode) => void;
  rightSlot?: React.ReactNode;
};

/**
 * Provides crop controls UI for a video preview.
 * Shows as a toolbar overlay with toggle, inputs, and apply/reset buttons.
 */
export const CropControls: React.FC<Props> = ({
  onReset,
  aspectMode,
  onAspectModeChange,
  rightSlot,
}) => {
  return (
    <div css={{
      padding: "6px 10px",
      background: "rgba(0,0,0,0.7)",
      color: "white",
      fontSize: 12,
      borderTop: "1px solid rgba(255,255,255,0.2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      minHeight: 38,
    }}>
      <div css={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        minHeight: 28,
      }}>
        <div css={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          minHeight: 28,
        }}>
          {([
            { key: "source" as const, label: "Original" },
            { key: "16:9" as const, label: "16:9" },
            { key: "4:3" as const, label: "4:3" },
            { key: "9:16" as const, label: "9:16" },
            { key: "1:1" as const, label: "1:1" },
            { key: "free" as const, label: "Freeform" },
          ]).map(option => (
            <button
              key={option.key}
              onClick={() => onAspectModeChange(option.key)}
              css={{
                padding: "3px 8px",
                background: aspectMode === option.key ? "#00b37e" : "#333",
                color: "white",
                border: "1px solid #444",
                borderRadius: 12,
                cursor: "pointer",
                fontSize: 10,
                fontWeight: 600,
                height: 24,
                ":hover": { background: aspectMode === option.key ? "#00a371" : "#3a3a3a" },
              }}
            >
              {option.label}
            </button>
          ))}
          <button
            onClick={onReset}
            css={{
              padding: "3px 8px",
              background: "#555",
              color: "white",
              border: "1px solid #444",
              borderRadius: 12,
              cursor: "pointer",
              fontSize: 10,
              fontWeight: 600,
              height: 24,
              ":hover": { background: "#666" },
            }}
          >
            Reset
          </button>
        </div>
      </div>
      {rightSlot && (
        <div css={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 38,
          padding: "0 6px",
          // Ensure the slot's child (e.g. cog button) matches the button sizing
          
          // child selector
          
          ":where(> *)": {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 24,
            lineHeight: 1,
          },
        }}>
          {rightSlot}
        </div>
      )}
    </div>
  );
};

export default CropControls;
