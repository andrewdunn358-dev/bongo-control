import type { ReactNode } from "react";
import Sidebar from "../Nav/Sidebar";
import BottomNav from "../Nav/BottomNav";
import NotificationToaster from "../Notifications/NotificationToaster";
import AuroraBackground from "./AuroraBackground";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen overflow-hidden text-text-primary">
      {/* Replaces the previous static blobs and grid div - AuroraBackground
          does both, animated and theme-aware. Keeping the old ones as
          well would double the effect and cost render work for nothing. */}
      <AuroraBackground />
      <NotificationToaster />
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-28 pt-4 sm:px-5 md:px-7 md:pb-8 md:pt-6 xl:px-10">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
