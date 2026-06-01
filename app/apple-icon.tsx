import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          // Opaque solid background — iOS requires opaque apple-touch-icons
          // (iOS applies its own rounded mask; don't add border-radius here)
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1e40af",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 100,
            fontWeight: 900,
            color: "white",
            letterSpacing: "-4px",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          CR
        </div>
      </div>
    ),
    { ...size }
  );
}
