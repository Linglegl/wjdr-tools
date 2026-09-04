import type { Metadata } from "next";
import "./rally.css";

export const metadata: Metadata = {
  title: "同抵集结计时器",
  description:
    "为无尽冬日多队集结反推发车时刻，提供出发前与发出时语音提醒，确保所有集结同时到达。",
};

export default function RallyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
