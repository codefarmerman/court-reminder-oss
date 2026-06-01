import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #2563eb 0%, #1e40af 100%)",
          borderRadius: "22%",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 104,
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
