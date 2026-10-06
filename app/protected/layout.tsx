import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
        <SiteHeader />
        <div className="flex-1 w-full flex flex-col gap-20 max-w-5xl p-5">
          {children}
        </div>

        <SiteFooter />
      </div>
    </main>
  );
}
