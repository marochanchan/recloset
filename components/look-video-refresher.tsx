"use client";

import { createVideoPollCycle, VIDEO_POLL_INTERVAL_MS } from "@/lib/outfits/video-poll";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// 動画が processing のあいだだけ置く。5秒おきに画面をサーバーで描き直し、最長3分で止める。
// ready / failed になるとサーバーの描画からこの部品が消え、アンマウントで interval も片付く。
// Effect は「表示されているあいだ」の1サイクル：setup で新しく0回から数え、cleanup で止める。
// Activity で隠れると cleanup が走り、再表示されると setup がもう一度走って最初から数え直す
// （隠れている間に状態が変わっていることが多く、数え直しても負担が小さいため）。
// 時間切れの表示は同じサイクルの中で出し、cleanup で消す（表示の切り替えで Effect は再実行されない）。
export function LookVideoRefresher() {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const cycle = createVideoPollCycle();
    const timer = setInterval(() => {
      const step = cycle.tick();
      if (step.refresh) router.refresh();
      if (step.exhausted) {
        clearInterval(timer);
        setTimedOut(true);
      }
    }, VIDEO_POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      setTimedOut(false);
    };
  }, [router]);

  if (!timedOut) return null;
  return (
    <p className="text-center text-xs text-muted-foreground" role="status">
      時間がかかっています。あとで開き直してください
    </p>
  );
}
