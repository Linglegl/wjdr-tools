import type { Metadata } from "next";
import "./map.css";

export const metadata: Metadata = {
  title: "熊坑地图编辑器",
  description:
    "为无尽冬日联盟快速规划熊坑、旗帜与城镇位置，支持模板、坐标换算、数据导入导出与图片生成。",
  openGraph: {
    title: "熊坑地图编辑器 | WJDR",
    description: "规划阵型、换算坐标、一键出图。",
    images: ["/map-og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "熊坑地图编辑器 | WJDR",
    description: "规划阵型、换算坐标、一键出图。",
    images: ["/map-og.png"],
  },
};

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
