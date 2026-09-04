import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "WJDR 联盟工具",
    template: "%s | WJDR",
  },
  description:
    "无尽冬日联盟作战工具，集成同抵集结计时器与熊坑地图编辑器。",
  applicationName: "WJDR 联盟工具",
  icons: {
    icon: "/logo.jpg",
    shortcut: "/logo.jpg",
    apple: "/logo.jpg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a111c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <nav className="suite-nav" aria-label="WJDR 工具导航">
          <div className="suite-links">
            <Link href="/map">熊坑地图</Link>
            <Link href="/rally">集结计时</Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
