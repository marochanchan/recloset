import { Button } from "@/components/ui/button";
import type { MarketplaceLink } from "@/lib/marketplace-urls";
import { ArrowUpRight } from "lucide-react";

// 外部フリマサービスの出品ページへのリンク一覧（private詳細・Loop詳細で共用）。
// linksはgetMarketplaceLinksで検証済みのものだけを渡すこと。
// ユーザーが登録した外部URLのため、新しいタブで開き、
// opener・referrerを渡さず、検索エンジンにも評価を渡さない。
export function MarketplaceLinks({ links }: { links: MarketplaceLink[] }) {
  return (
    <div className="flex flex-col gap-2">
      {links.map((link) => (
        <Button
          key={link.service}
          asChild
          variant="outline"
          size="sm"
          className="w-full justify-between"
        >
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
          >
            {link.label}で見る
            <span className="sr-only">（新しいタブで開きます）</span>
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </Button>
      ))}
    </div>
  );
}
