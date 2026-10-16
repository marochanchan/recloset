import { ImageResponse } from "next/og";

// ホーム画面に追加したときのアイコン（iOS）。アイボリーの面にセージのマーク。
// マークは app/icon.svg・components/brand-mark.tsx と同じ形（R × ハンガー × 循環）
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FAF8F4",
        }}
      >
        <svg
          width="128"
          height="128"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#476354"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 13V5h4.5a3 3 0 0 1 0 6H7" />
          <path d="M10.5 11l8.7 6.1c.9.6.5 1.9-.6 1.9H8a3.5 3.5 0 0 1-3.4-4.4" />
        </svg>
      </div>
    ),
    size,
  );
}
