import type { ReactNode } from "react";
import Sidebar from "../Nav/Sidebar";
import BottomNav from "../Nav/BottomNav";
import NotificationToaster from "../Notifications/NotificationToaster";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen overflow-hidden bg-base text-text-primary">
      <div className="vehicle-grid pointer-events-none fixed inset-0" />
      <div className="pointer-events-none fixed -left-40 top-0 h-96 w-96 rounded-full bg-battery/10 blur-3xl" />
      <div className="pointer-events-none fixed right-0 top-20 h-72 w-72 rounded-full bg-solar/10 blur-3xl" />
      <NotificationToaster />
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-28 pt-4 sm:px-5 md:px-7 md:pb-8 md:pt-6 xl:px-10">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
