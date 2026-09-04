import Link from "next/link";

const tools = [
  {
    href: "/rally",
    index: "01",
    title: "同抵集结计时器",
    description:
      "按各队行军时间反推发车时刻，并在关键节点提供语音提醒，让多支集结同时抵达。",
    action: "进入计时器",
    accent: "signal",
  },
  {
    href: "/map",
    index: "02",
    title: "熊坑地图编辑器",
    description:
      "规划熊坑、城镇、旗帜和联盟矿位置，支持快捷模板、坐标换算、导入导出与一键出图。",
    action: "进入地图编辑器",
    accent: "ice",
  },
];

export default function Home() {
  return (
    <main className="hub-shell">
      <header className="hub-heading">
        <p>WJDR · 联盟作战中心</p>
        <h1>选择本次作战工具</h1>
        <span>计时与地图已整合到同一网站，原有数据仍保存在当前浏览器中。</span>
      </header>

      <section className="tool-grid" aria-label="可用工具">
        {tools.map((tool) => (
          <Link
            className={`tool-card tool-card-${tool.accent}`}
            href={tool.href}
            key={tool.href}
          >
            <span className="tool-index">{tool.index}</span>
            <div>
              <h2>{tool.title}</h2>
              <p>{tool.description}</p>
            </div>
            <strong>{tool.action} →</strong>
          </Link>
        ))}
      </section>

      <footer className="hub-footer">Powered by Linglegl</footer>
    </main>
  );
}
