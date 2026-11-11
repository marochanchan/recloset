// 再生中の動画の、いま見えているコマを JPEG の Blob にする（ブラウザ専用）。
// 反転も回転もしない生のコマ。回転は写真と同じく process 側で行う。

export async function frameFromVideo(video: HTMLVideoElement): Promise<Blob> {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error("video has no frame");
  }
  const canvas = document.createElement("canvas");
  try {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.98,
      );
    });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
