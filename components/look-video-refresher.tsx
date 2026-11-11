"use client";

import { nextVideoPoll, VIDEO_POLL_INTERVAL_MS } from "@/lib/outfits/video-poll";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// 動画が processing のあいだだけ置く。5秒おきに画面をサーバーで描き直し、最長3分で止める。
// ready / failed になるとサーバーの描画からこの部品が消え、アンマウントで interval も片付く。
// Activity で隠れたときも cleanup で止まる。再表示されたら回数は最初から数え直す
// （隠れている間に状態が変わっていることが多く、数え直しても負担が小さいため）。
export function LookVideoRefresher() {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (timedOut) return;
    let attempts = 0;
    const timer = setInterval(() => {
      const step = nextVideoPoll(attempts);
      attempts = step.attempts;
      if (step.refresh) router.refresh();
      if (step.exhausted) {
        clearInterval(timer);
        setTimedOut(true);
      }
    }, VIDEO_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [router, timedOut]);

  if (!timedOut) return null;
  return (
    <p className="text-center text-xs text-muted-foreground" role="status">
      時間がかかっています。あとで開き直してください
    </p>
  );
}
