import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  embedMapDataInPng,
  extractMapDataFromPng,
  MAX_PNG_MAP_DATA_BYTES,
} from "../app/map/png-map-metadata.ts";

const MINIMAL_PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("redirects the root route to the bear map editor", async () => {
  const response = await render();
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location")).pathname, "/map");
});

test("uses an active, text-only segmented tool navigation", async () => {
  const [navigationSource, globalStyles] = await Promise.all([
    readFile(new URL("../app/tool-navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(navigationSource, /href: "\/map"/);
  assert.match(navigationSource, /href: "\/rally"/);
  assert.match(navigationSource, /usePathname/);
  assert.match(navigationSource, /aria-current=\{active \? "page" : undefined\}/);
  assert.doesNotMatch(navigationSource, /<img|logo\.jpg/);
  assert.match(globalStyles, /border-radius: 14px/);
  assert.match(globalStyles, /\.suite-link\.is-active/);
});

test("renders the WJDR rally timer shell", async () => {
  const response = await render("/rally");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  const normalizedHtml = html.replaceAll("<!-- -->", "");
  assert.match(html, /<title>同抵集结计时器 \| WJDR<\/title>/i);
  assert.match(normalizedHtml, /同抵集结计时器/);
  assert.match(normalizedHtml, /统一到达时间/);
  assert.match(normalizedHtml, /开始同步计时/);
  assert.match(normalizedHtml, /\+1 分钟/);
  assert.match(normalizedHtml, /\+90 秒/);
  assert.match(normalizedHtml, /\+2 分钟/);
  assert.match(normalizedHtml, /\+3 分钟/);
  assert.match(normalizedHtml, /\+5 分钟/);
  assert.match(normalizedHtml, /仅提醒一次，不进行语音读秒/);
  assert.match(normalizedHtml, /Powered by Linglegl/);
  assert.match(html, /href="\/logo\.jpg"/);
  assert.doesNotMatch(html, /逐秒中文报数|开启语音提醒/);
  assert.doesNotMatch(html, /WJDR BRANCH PROJECT/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("keeps voice alerts concise and completes launched rallies", async () => {
  const source = await readFile(
    new URL("../app/rally/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /nextGroup\.map\(\(plan\) => plan\.name\)\.join\("、"\)/);
  assert.match(source, /spokenRef\.current\.add\(`\$\{plan\.id\}:prepare`\)/);
  assert.match(source, /speak\("发出"\)/);
  assert.match(source, /const VOICE_LEAD_MS = 300/);
  assert.match(source, /delta <= VOICE_LEAD_MS/);
  assert.match(
    source,
    /announceSeconds \* 1000 \+ VOICE_LEAD_MS/,
  );
  assert.match(
    source,
    /useState<number \| null>\(null\)/,
  );
  assert.match(
    source,
    /liveClockTime === null \? "--:--:--" : formatClock\(liveClockTime\)/,
  );
  assert.match(source, /setFinishedRallyIds\(nextFinishedIds\)/);
  assert.match(source, /const MERGE_WINDOW_MS = 5000/);
  assert.match(
    source,
    /currentPlan\.launchAt - previousPlan\.launchAt >= MERGE_WINDOW_MS/,
  );
  assert.match(
    source,
    /nextPlan\.launchAt - currentPlan\.launchAt >= MERGE_WINDOW_MS/,
  );
  assert.match(source, /return plans\.slice\(startIndex, endIndex \+ 1\)/);
  assert.match(source, /isFinished \? "已出发"/);
  assert.match(source, /发出于 \$\{formatClock\(plan\.launchAt\)\}/);
  assert.match(source, /相隔不足 5 秒，按各自倒计时依次发出/);
  assert.match(source, /该时间已无法到达，请检查时间是否设置正确/);
  assert.doesNotMatch(source, /voiceEnabled|AudioContext|count:\$\{countdown\}/);
});

test("renders the bear map editor with touch-friendly marker editing", async () => {
  const [response, source, styles] = await Promise.all([
    render("/map"),
    readFile(new URL("../app/map/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/map/map.css", import.meta.url), "utf8"),
  ]);
  assert.equal(response.status, 200);
  const html = (await response.text()).replaceAll("<!-- -->", "");

  assert.match(html, /熊坑地图编辑器/);
  assert.match(html, /地图工具/);
  assert.match(html, /生成图片/);
  assert.match(html, /导入图片/);
  assert.match(html, /障碍/);
  assert.match(source, /type MarkerType = "bear" \| "town" \| "flag" \| "mine" \| "obstacle"/);
  assert.match(source, /obstacle: \{ width: 1, height: 1 \}/);
  assert.match(source, /MAX_IMPORTED_MARKERS = GRID_SIZE \* GRID_SIZE \+ 1/);
  assert.match(source, /绘制山地或水域/);
  assert.match(source, /function townWorldCoordinate/);
  assert.match(source, /const townBottomLeftX = town\.x/);
  assert.match(source, /const townBottomLeftY = town\.y \+ FOOTPRINT\.town\.height - 1/);
  assert.match(source, /const bearBottomLeftX = bearMarker\.x/);
  assert.match(source, /const bearBottomLeftY = bearMarker\.y \+ FOOTPRINT\.bear\.height - 1/);
  assert.match(source, /熊坑占地 3×3，固定取左下角第一格/);
  assert.match(source, /对应熊坑换算的城镇坐标/);
  assert.match(source, /固定取左下角第一个坐标/);
  assert.match(styles, /\.marker-obstacle/);
  assert.match(styles, /\.town-world-coordinate/);
  assert.match(source, /导出的原始PNG文件可导入重新编辑/);
  assert.match(source, /微信、QQ 传输或压缩后可能无法使用/);
  assert.match(source, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(source, /nativeDragEnabled &&/);
  assert.match(styles, /\.map-viewport[\s\S]*?overflow: hidden/);
  assert.match(styles, /touch-action: pan-y pinch-zoom/);
  assert.doesNotMatch(source, /mapViewportRef|scrollWidth|scrollHeight/);
  assert.match(styles, /\.marker[\s\S]*?touch-action: manipulation/);
  assert.doesNotMatch(source, /TILT_SCALE|TILT_INSET_PERCENT|--tilt-inset/);
  assert.match(source, /const footerTop = contentSize/);
  assert.match(source, /fitCanvasLines/);
  assert.match(source, /markerScreenCenter/);
  assert.match(source, /https:\/\/tools\.burgerl\.com/);
  assert.doesNotMatch(source, /https:\/\/map\.burgerl\.com/);
  assert.doesNotMatch(source, /mapZoom|ZOOM_MIN|ZOOM_MAX|ZOOM_STEP/);
  assert.doesNotMatch(source, /地图缩放|放大地图|缩小地图/);
  assert.doesNotMatch(styles, /zoom-controls/);
  assert.match(styles, /--tilt-fit: 70\.710678%/);
  assert.match(styles, /\.map-stage\.tilted \.map-board[\s\S]*?width: var\(--tilt-fit\)/);
  assert.doesNotMatch(styles, /scale\(var\(--tilt-scale\)\)/);
  assert.doesNotMatch(styles, /translateZ\(|backface-visibility/);
  assert.doesNotMatch(source, /output\.scale\(0\.88/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("PNG metadata preserves Unicode map JSON", () => {
  const json = JSON.stringify({
    version: 2,
    worldX: 512,
    worldY: 512,
    markers: [{ id: "bear-center", type: "bear", name: "熊坑", x: 11, y: 11 }],
  });
  const embedded = embedMapDataInPng(MINIMAL_PNG, json);

  assert.equal(extractMapDataFromPng(MINIMAL_PNG), null);
  assert.equal(extractMapDataFromPng(embedded), json);

  const corrupted = embedded.slice();
  corrupted[20] ^= 1;
  assert.throws(() => extractMapDataFromPng(corrupted), /invalid-png-crc/);
  assert.throws(
    () => embedMapDataInPng(MINIMAL_PNG, "x".repeat(MAX_PNG_MAP_DATA_BYTES + 1)),
    /map-data-too-large/,
  );
});

test("startup scripts bind all interfaces and support allowed domain hosts", async () => {
  const [packageSource, viteSource, envExample] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(
    packageJson.scripts.dev,
    "vinext dev --hostname 0.0.0.0 --port 3000",
  );
  assert.equal(
    packageJson.scripts.start,
    "vinext start --hostname 0.0.0.0 --port 3000",
  );
  assert.match(viteSource, /loadEnv/);
  assert.match(viteSource, /ALLOWED_HOSTS/);
  assert.match(viteSource, /allowedHosts/);
  assert.match(viteSource, /"rally\.burgerl\.com"/);
  assert.match(viteSource, /"map\.burgerl\.com"/);
  assert.match(viteSource, /"tools\.burgerl\.com"/);
  assert.match(envExample, /^ALLOWED_HOSTS=/m);
});
