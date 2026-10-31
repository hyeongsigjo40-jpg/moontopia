import "./globals.css";
import type { Metadata } from "next";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "점포 실사 에이전트",
  description: "AI 점포 양도양수 실사 에이전트 MVP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Nav />
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
