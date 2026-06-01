import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
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
            fontSize: 280,
            fontWeight: 900,
            color: "white",
            letterSpacing: "-12px",
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
