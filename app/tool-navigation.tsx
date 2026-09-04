"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tools = [
  { href: "/map", index: "01", label: "熊坑地图", tone: "map" },
  { href: "/rally", index: "02", label: "集结计时", tone: "rally" },
];

export default function ToolNavigation() {
  const pathname = usePathname();

  return (
    <nav className="suite-nav" aria-label="WJDR 工具导航">
      <div className="suite-links">
        {tools.map((tool) => {
          const active = pathname === tool.href || pathname.startsWith(`${tool.href}/`);
          return (
            <Link
              className={`suite-link suite-link-${tool.tone}${active ? " is-active" : ""}`}
              href={tool.href}
              aria-current={active ? "page" : undefined}
              key={tool.href}
            >
              <span>{tool.index}</span>
              <strong>{tool.label}</strong>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
