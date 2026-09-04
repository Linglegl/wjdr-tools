import type { Metadata, Viewport } from "next";
import "./globals.css";
import ToolNavigation from "./tool-navigation";

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
        <ToolNavigation />
        {children}
      </body>
    </html>
  );
}
