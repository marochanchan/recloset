import { ImageResponse } from "next/og";

// SNS等で共有されたときの画像（Open Graph）。
// 日本語フォントの外部取得を避けるため、英字のみで構成する。
// twitter:image を個別に用意しない場合、Xはog:imageを使用する。

export const alt = "Re:Closet — Wear it again. Pass it on.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          background: "#ffffff",
          color: "#171717",
        }}
      >
        <svg
          width="180"
          height="180"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#171717"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 13V5h4.5a3 3 0 0 1 0 6H7" />
          <path d="M10.5 11l8.7 6.1c.9.6.5 1.9-.6 1.9H8" />
          <path d="M8 19a3.5 3.5 0 0 1-3.17-4.98" />
          <path d="M5.58 16.09l-.75-2.07-2.07.75" />
        </svg>
        <div style={{ fontSize: 88, fontWeight: 600, letterSpacing: -2 }}>
          Re:Closet
        </div>
        <div style={{ fontSize: 36, color: "#737373" }}>
          Wear it again. Pass it on.
        </div>
      </div>
    ),
    size,
  );
}
