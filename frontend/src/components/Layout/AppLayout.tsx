import type { ReactNode } from "react";
import Sidebar from "../Nav/Sidebar";
import BottomNav from "../Nav/BottomNav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-base text-text-primary">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-8">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
