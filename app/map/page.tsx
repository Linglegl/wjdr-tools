"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import quickTemplateOneData from "./data/quick-template-one.json";
import quickTemplateTwoData from "./data/quick-template-two.json";
import {
  embedMapDataInPng,
  extractMapDataFromPng,
} from "./png-map-metadata";

type MarkerType = "bear" | "town" | "flag" | "mine";
type PlaceableMarkerType = Exclude<MarkerType, "bear">;
type Tool = "select" | PlaceableMarkerType | "erase";
type Ring = 1 | 2 | 3 | 4 | 5;
type QuickTemplateId = "template-one" | "template-two";
type ImageView = "vertical" | "game";

type Marker = {
  id: string;
  type: MarkerType;
  x: number;
  y: number;
  name: string;
  ring?: Ring;
};

type SavedTemplate = {
  id: string;
  name: string;
  markers: Marker[];
  version?: number;
};

type MapData = {
  markers?: Marker[];
  worldX?: number;
  worldY?: number;
  version?: number;
};

const GRID_SIZE = 25;
const STORAGE_KEY = "bear-map-editor-v1";
const TEMPLATE_KEY = "bear-map-templates-v1";
const DATA_VERSION = 2;
const MAX_IMAGE_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORTED_MARKERS = 500;
const MAX_MARKER_ID_LENGTH = 100;
const MAX_MARKER_NAME_LENGTH = 18;
const MAX_WORLD_COORDINATE = 1_000_000_000;
const MARKER_TYPES: MarkerType[] = ["bear", "town", "flag", "mine"];
const FLAG_RANGE = 3;
const TILT_YAW_DEGREES = -45;
const TILT_COUNTER_YAW_DEGREES = -TILT_YAW_DEGREES;
const TILT_SCALE = 1 / Math.SQRT2;
const TILT_INSET_PERCENT = (1 - TILT_SCALE) * 50;
const EXPORT_BOARD_SIZE = 1200;
const EXPORT_AXIS_GUTTER = 44;
const EXPORT_FOOTER_HEIGHT = 108;
const EXPORT_FONT_FAMILY =
  '"Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
const RINGS: Ring[] = [1, 2, 3, 4, 5];
const DEFAULT_RING_COLORS: Record<Ring, string> = {
  1: "#ff6b4a",
  2: "#f3b84b",
  3: "#70d6a3",
  4: "#64a8ff",
  5: "#a980ff",
};
const FOOTPRINT: Record<MarkerType, { width: number; height: number }> = {
  flag: { width: 1, height: 1 },
  town: { width: 2, height: 2 },
  bear: { width: 3, height: 3 },
  mine: { width: 2, height: 2 },
};

const TOOL_ITEMS: { id: Tool; label: string; symbol: string; hint: string }[] = [
  { id: "select", label: "选择", symbol: "↖", hint: "移动与编辑" },
  { id: "town", label: "城镇", symbol: "▦", hint: "放置联盟成员" },
  { id: "flag", label: "旗帜", symbol: "⚑", hint: "标记覆盖范围" },
  { id: "mine", label: "联盟矿", symbol: "⛏", hint: "放置资源点" },
  { id: "erase", label: "擦除", symbol: "×", hint: "点击删除" },
];

const TYPE_LABEL: Record<MarkerType, string> = {
  bear: "熊坑",
  town: "城镇",
  flag: "联盟旗帜",
  mine: "联盟矿",
};

const FIXED_BEAR: Marker = {
  id: "bear-center",
  type: "bear",
  x: 11,
  y: 11,
  name: "熊坑",
};

const QUICK_TEMPLATE_ONE_MARKERS = (
  quickTemplateOneData as unknown as { markers: Marker[] }
).markers;
const QUICK_TEMPLATE_TWO_MARKERS = (
  quickTemplateTwoData as unknown as { markers: Marker[] }
).markers;
const INITIAL_MARKERS = normalizeMarkers(QUICK_TEMPLATE_ONE_MARKERS);

function clamp(value: number, max = GRID_SIZE - 1) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function snapMarker(type: MarkerType, x: number, y: number) {
  const footprint = FOOTPRINT[type];
  return {
    x: clamp(x, GRID_SIZE - footprint.width),
    y: clamp(y, GRID_SIZE - footprint.height),
  };
}

function centeredAt(type: MarkerType, x: number, y: number) {
  const footprint = FOOTPRINT[type];
  const snappedX =
    footprint.width % 2 === 0
      ? Math.round(x) - footprint.width / 2
      : Math.floor(x) - Math.floor(footprint.width / 2);
  const snappedY =
    footprint.height % 2 === 0
      ? Math.round(y) - footprint.height / 2
      : Math.floor(y) - Math.floor(footprint.height / 2);
  return snapMarker(
    type,
    snappedX,
    snappedY,
  );
}

function overlaps(a: Marker, b: Marker) {
  const aSize = FOOTPRINT[a.type];
  const bSize = FOOTPRINT[b.type];
  return (
    a.x < b.x + bSize.width &&
    a.x + aSize.width > b.x &&
    a.y < b.y + bSize.height &&
    a.y + aSize.height > b.y
  );
}

function containsCell(marker: Marker, x: number, y: number) {
  const footprint = FOOTPRINT[marker.type];
  return (
    x >= marker.x &&
    x < marker.x + footprint.width &&
    y >= marker.y &&
    y < marker.y + footprint.height
  );
}

function normalizeMarkers(markers: Marker[], legacy = false) {
  const normalized = markers
    .filter((marker) => marker.type !== "bear")
    .map((marker) => {
      const footprint = FOOTPRINT[marker.type];
      const position = snapMarker(
        marker.type,
        marker.x - (legacy ? Math.floor(footprint.width / 2) : 0),
        marker.y - (legacy ? Math.floor(footprint.height / 2) : 0),
      );
      const withoutLevel = { ...marker } as Marker & { level?: number };
      delete withoutLevel.level;
      const ring =
        marker.type === "town" && RINGS.includes(Number(marker.ring) as Ring)
          ? (Number(marker.ring) as Ring)
          : 1;
      return {
        ...withoutLevel,
        ...position,
        ...(marker.type === "town" ? { ring } : {}),
      } as Marker;
    });
  return [{ ...FIXED_BEAR }, ...normalized];
}

function deepCopy(markers: Marker[]) {
  return markers.map((marker) => ({ ...marker }));
}

function nextName(type: MarkerType, markers: Marker[]) {
  const count = markers.filter((marker) => marker.type === type).length + 1;
  return `${TYPE_LABEL[type]} ${String(count).padStart(2, "0")}`;
}

function markerSymbol(type: MarkerType) {
  if (type === "bear") return "◎";
  if (type === "flag") return "⚑";
  if (type === "mine") return "⛏";
  return "▦";
}

function drawFlagIcon(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number,
) {
  const poleX = centerX - size * 0.2;
  const top = centerY - size * 0.38;
  const bottom = centerY + size * 0.38;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#eafff6";
  ctx.fillStyle = "#eafff6";
  ctx.lineWidth = Math.max(2, size * 0.1);
  ctx.beginPath();
  ctx.moveTo(poleX, top);
  ctx.lineTo(poleX, bottom);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(poleX, top);
  ctx.lineTo(centerX + size * 0.38, centerY - size * 0.22);
  ctx.lineTo(poleX, centerY - size * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(poleX - size * 0.16, bottom);
  ctx.lineTo(poleX + size * 0.16, bottom);
  ctx.stroke();
  ctx.restore();
}

function fitCanvasLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2,
) {
  const lines: string[] = [];
  let current = "";

  for (const character of Array.from(text.trim())) {
    const candidate = `${current}${character}`;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (!lines.length) return [""];
  if (lines.length <= maxLines) return lines;

  const visible = lines.slice(0, maxLines);
  let lastLine = visible[maxLines - 1];
  while (lastLine && ctx.measureText(`${lastLine}…`).width > maxWidth) {
    lastLine = lastLine.slice(0, -1);
  }
  visible[maxLines - 1] = `${lastLine}…`;
  return visible;
}

function drawCenteredMarkerText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  maxWidth: number,
  fontSize: number,
) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = `650 ${fontSize}px ${EXPORT_FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, .86)";
  ctx.shadowBlur = 4;
  const lineHeight = fontSize * 1.18;
  const lines = fitCanvasLines(ctx, text, maxWidth, 2);
  const firstLineY = centerY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    ctx.fillText(line, centerX, firstLineY + index * lineHeight);
  });
  ctx.restore();
}

type ScreenPoint = {
  x: number;
  y: number;
};

function unprojectFromQuad(
  corners: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  point: ScreenPoint,
) {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const deltaX1 = topRight.x - bottomRight.x;
  const deltaX2 = bottomLeft.x - bottomRight.x;
  const deltaX3 =
    topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const deltaY1 = topRight.y - bottomRight.y;
  const deltaY2 = bottomLeft.y - bottomRight.y;
  const deltaY3 =
    topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  const denominator = deltaX1 * deltaY2 - deltaX2 * deltaY1;

  let projectiveX = 0;
  let projectiveY = 0;
  if (Math.abs(denominator) > Number.EPSILON) {
    projectiveX =
      (deltaX3 * deltaY2 - deltaX2 * deltaY3) / denominator;
    projectiveY =
      (deltaX1 * deltaY3 - deltaX3 * deltaY1) / denominator;
  }

  const matrix = [
    topRight.x - topLeft.x + projectiveX * topRight.x,
    bottomLeft.x - topLeft.x + projectiveY * bottomLeft.x,
    topLeft.x,
    topRight.y - topLeft.y + projectiveX * topRight.y,
    bottomLeft.y - topLeft.y + projectiveY * bottomLeft.y,
    topLeft.y,
    projectiveX,
    projectiveY,
    1,
  ];
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const determinant =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);
  if (Math.abs(determinant) <= Number.EPSILON) return null;

  const inverse = [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ];
  const weight =
    inverse[6] * point.x + inverse[7] * point.y + inverse[8];
  if (Math.abs(weight) <= Number.EPSILON) return null;

  return {
    x: (inverse[0] * point.x + inverse[1] * point.y + inverse[2]) / weight,
    y: (inverse[3] * point.x + inverse[4] * point.y + inverse[5]) / weight,
  };
}

function preset(type: QuickTemplateId): Marker[] {
  return deepCopy(
    type === "template-one"
      ? QUICK_TEMPLATE_ONE_MARKERS
      : QUICK_TEMPLATE_TWO_MARKERS,
  );
}

export default function Home() {
  const [markers, setMarkers] = useState<Marker[]>(INITIAL_MARKERS);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ringColors = DEFAULT_RING_COLORS;
  const [activeTownRing, setActiveTownRing] = useState<Ring>(1);
  const [showTowns, setShowTowns] = useState(true);
  const [showCoverage, setShowCoverage] = useState(true);
  const [isTilted, setIsTilted] = useState(false);
  const [worldX, setWorldX] = useState(512);
  const [worldY, setWorldY] = useState(512);
  const [history, setHistory] = useState<Marker[][]>([]);
  const [future, setFuture] = useState<Marker[][]>([]);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [dialog, setDialog] = useState<"import" | "export" | null>(null);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [transferText, setTransferText] = useState("");
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [nativeDragEnabled, setNativeDragEnabled] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const imageImportRef = useRef<HTMLInputElement | null>(null);

  const selected = markers.find((marker) => marker.id === selectedId) ?? null;
  const bear = markers.find((marker) => marker.type === "bear") ?? null;
  const towns = markers.filter((marker) => marker.type === "town");
  const flags = markers.filter((marker) => marker.type === "flag");
  const draggingMarker =
    markers.find((marker) => marker.id === draggingId) ?? null;
  const coverageFlags = flags.map((flag) =>
    flag.id === draggingId && dragPreview
      ? { ...flag, ...dragPreview }
      : flag,
  );
  const coordinateRows = useMemo(
    () =>
      towns.map((town) => ({
        ...town,
        worldX:
          worldX +
          Math.round(
            (town.x +
              FOOTPRINT.town.width / 2 -
              ((bear?.x ?? 11) + FOOTPRINT.bear.width / 2)) *
              2,
          ),
        worldY:
          worldY +
          Math.round(
            (town.y +
              FOOTPRINT.town.height / 2 -
              ((bear?.y ?? 11) + FOOTPRINT.bear.height / 2)) *
              2,
          ),
      })),
    [bear, towns, worldX, worldY],
  );

  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2200);
  }

  function commit(next: Marker[]) {
    setHistory((items) => [...items.slice(-39), deepCopy(markers)]);
    setFuture([]);
    setMarkers(next);
  }

  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setFuture((items) => [deepCopy(markers), ...items].slice(0, 40));
    setMarkers(deepCopy(previous));
    setHistory((items) => items.slice(0, -1));
    setSelectedId(null);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items, deepCopy(markers)].slice(-40));
    setMarkers(deepCopy(next));
    setFuture((items) => items.slice(1));
    setSelectedId(null);
  }

  function placeAt(
    x: number,
    y: number,
    snappedPosition?: { x: number; y: number },
  ) {
    if (tool === "select") {
      setSelectedId(null);
      return;
    }

    const occupied = markers.find((marker) => containsCell(marker, x, y));
    if (tool === "erase") {
      if (occupied) {
        if (occupied.type === "bear") {
          notify("熊坑固定在地图中心，无法删除");
          return;
        }
        commit(markers.filter((marker) => marker.id !== occupied.id));
        if (selectedId === occupied.id) setSelectedId(null);
      }
      return;
    }

    const position =
      snappedPosition ?? centeredAt(tool, x + 0.5, y + 0.5);
    const marker: Marker = {
      // IDs are created only in response to a placement event.
      // eslint-disable-next-line react-hooks/purity
      id: `${tool}-${Date.now()}`,
      type: tool,
      ...position,
      name: nextName(tool, markers),
      ...(tool === "town" ? { ring: activeTownRing } : {}),
    };
    if (markers.some((item) => overlaps(marker, item))) {
      notify("目标占地与其他对象重叠");
      return;
    }
    commit([...markers, marker]);
    setSelectedId(marker.id);
    setTool("select");
  }

  function boardPoint(
    event:
      | React.MouseEvent<HTMLDivElement>
      | React.DragEvent<HTMLDivElement>,
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (isTilted) {
      const cornerElements =
        event.currentTarget.querySelectorAll<HTMLElement>(".board-corner");
      if (cornerElements.length === 4) {
        const corners = Array.from(cornerElements).map((element) => {
          const cornerRect = element.getBoundingClientRect();
          return {
            x: cornerRect.left + cornerRect.width / 2,
            y: cornerRect.top + cornerRect.height / 2,
          };
        }) as [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint];
        const projected = unprojectFromQuad(corners, {
          x: event.clientX,
          y: event.clientY,
        });
        if (projected) {
          return {
            x: Math.max(0, Math.min(GRID_SIZE, projected.x * GRID_SIZE)),
            y: Math.max(0, Math.min(GRID_SIZE, projected.y * GRID_SIZE)),
          };
        }
      }
    }
    return {
      x: Math.max(
        0,
        Math.min(
          GRID_SIZE,
          ((event.clientX - rect.left) / rect.width) * GRID_SIZE,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          GRID_SIZE,
          ((event.clientY - rect.top) / rect.height) * GRID_SIZE,
        ),
      ),
    };
  }

  function updateSelected(patch: Partial<Marker>) {
    if (!selected) return;
    if (selected.type === "bear") {
      notify("熊坑固定在地图中心");
      return;
    }
    const position = snapMarker(
      selected.type,
      patch.x ?? selected.x,
      patch.y ?? selected.y,
    );
    const nextMarker = { ...selected, ...patch, ...position };
    if (
      markers.some(
        (marker) => marker.id !== selected.id && overlaps(nextMarker, marker),
      )
    ) {
      notify("目标占地与其他对象重叠");
      return;
    }
    commit(
      markers.map((marker) =>
        marker.id === selected.id ? nextMarker : marker,
      ),
    );
  }

  function removeSelected() {
    if (!selected) return;
    if (selected.type === "bear") {
      notify("熊坑固定在地图中心，无法删除");
      return;
    }
    commit(markers.filter((marker) => marker.id !== selected.id));
    setSelectedId(null);
  }

  function loadTemplate(next: Marker[]) {
    commit(normalizeMarkers(next));
    setSelectedId(null);
    notify("模板已应用");
  }

  function saveTemplate() {
    const name = window.prompt("给这份布阵起个名字（最多 12 个字）");
    if (!name?.trim()) return;
    const item: SavedTemplate = {
      // IDs are created only in response to the save action.
      // eslint-disable-next-line react-hooks/purity
      id: `template-${Date.now()}`,
      name: name.trim().slice(0, 12),
      markers: deepCopy(markers),
      version: DATA_VERSION,
    };
    setTemplates((items) => [...items, item]);
    notify("已保存到本机");
  }

  function openExport() {
    setTransferText(mapDataJson());
    setDialog("export");
  }

  function mapDataJson() {
    return JSON.stringify(
      { version: DATA_VERSION, worldX, worldY, markers },
      null,
      2,
    );
  }

  function restoreMapData(data: unknown, successMessage: string) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("invalid-map-data");
    }
    const candidate = data as MapData;
    if (
      !Array.isArray(candidate.markers) ||
      candidate.markers.length > MAX_IMPORTED_MARKERS
    ) {
      throw new Error("invalid-marker-count");
    }
    if (
      candidate.version !== undefined &&
      (!Number.isInteger(candidate.version) ||
        candidate.version < 1 ||
        candidate.version > DATA_VERSION)
    ) {
      throw new Error("unsupported-version");
    }

    const markerIds = new Set<string>();
    const sanitizedMarkers = candidate.markers.map((rawMarker) => {
      if (!rawMarker || typeof rawMarker !== "object") {
        throw new Error("invalid-marker");
      }
      const marker = rawMarker as Partial<Marker>;
      if (
        typeof marker.id !== "string" ||
        marker.id.length < 1 ||
        marker.id.length > MAX_MARKER_ID_LENGTH ||
        markerIds.has(marker.id) ||
        typeof marker.type !== "string" ||
        !MARKER_TYPES.includes(marker.type as MarkerType) ||
        typeof marker.name !== "string" ||
        marker.name.length > MAX_MARKER_NAME_LENGTH ||
        !Number.isInteger(marker.x) ||
        !Number.isInteger(marker.y) ||
        Number(marker.x) < 0 ||
        Number(marker.x) >= GRID_SIZE ||
        Number(marker.y) < 0 ||
        Number(marker.y) >= GRID_SIZE
      ) {
        throw new Error("invalid-marker");
      }
      markerIds.add(marker.id);
      const type = marker.type as MarkerType;
      let ring: Ring | undefined;
      if (type === "town") {
        if (
          marker.ring !== undefined &&
          !RINGS.includes(Number(marker.ring) as Ring)
        ) {
          throw new Error("invalid-ring");
        }
        ring = marker.ring === undefined ? 1 : (Number(marker.ring) as Ring);
      }
      return {
        id: marker.id,
        type,
        x: Number(marker.x),
        y: Number(marker.y),
        name: marker.name,
        ...(type === "town" ? { ring } : {}),
      } as Marker;
    });

    const validateWorldCoordinate = (value: unknown) => {
      if (value === undefined) return undefined;
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > MAX_WORLD_COORDINATE
      ) {
        throw new Error("invalid-world-coordinate");
      }
      return value;
    };
    const importedWorldX = validateWorldCoordinate(candidate.worldX);
    const importedWorldY = validateWorldCoordinate(candidate.worldY);

    commit(
      normalizeMarkers(
        sanitizedMarkers,
        candidate.version !== DATA_VERSION,
      ),
    );
    if (importedWorldX !== undefined) setWorldX(importedWorldX);
    if (importedWorldY !== undefined) setWorldY(importedWorldY);
    setSelectedId(null);
    notify(successMessage);
  }

  function applyImport() {
    try {
      restoreMapData(JSON.parse(transferText) as MapData, "地图数据已导入");
      setDialog(null);
    } catch {
      notify("数据格式不正确，请检查后重试");
    }
  }

  async function importMapImage(file: File) {
    try {
      if (file.size > MAX_IMAGE_IMPORT_BYTES) throw new Error("file-too-large");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const json = extractMapDataFromPng(bytes);
      if (!json) throw new Error("missing-map-data");
      restoreMapData(JSON.parse(json) as MapData, "已从图片恢复地图");
    } catch {
      notify("导入失败：仅支持本站生成的原始 PNG，微信、QQ 传输可能导致数据丢失");
    }
  }

  async function copyCoordinates() {
    const text = coordinateRows
      .map(
        (town) =>
          `${town.name}  X:${town.worldX}  Y:${town.worldY}（格 ${town.x + 1},${town.y + 1}）`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text || "当前没有城镇");
      notify("坐标已复制");
    } catch {
      notify("复制失败，请手动复制");
    }
  }

  async function downloadImage(view: ImageView) {
    const boardSize = EXPORT_BOARD_SIZE;
    const cell = boardSize / GRID_SIZE;
    const boardCanvas = document.createElement("canvas");
    boardCanvas.width = boardSize;
    boardCanvas.height = boardSize;
    const ctx = boardCanvas.getContext("2d");
    if (!ctx) return;

    const gradient = ctx.createLinearGradient(0, 0, boardSize, boardSize);
    gradient.addColorStop(0, "#0a121b");
    gradient.addColorStop(1, "#101d28");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, boardSize, boardSize);
    ctx.strokeStyle = "rgba(143, 164, 181, .14)";
    ctx.lineWidth = 1;
    for (let index = 0; index <= GRID_SIZE; index += 1) {
      ctx.beginPath();
      ctx.moveTo(index * cell, 0);
      ctx.lineTo(index * cell, boardSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, index * cell);
      ctx.lineTo(boardSize, index * cell);
      ctx.stroke();
    }

    if (showCoverage) {
      ctx.setLineDash([8, 7]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(112, 214, 163, .42)";
      ctx.fillStyle = "rgba(112, 214, 163, .04)";
      flags.forEach((flag) => {
        const rangeX = (flag.x - FLAG_RANGE) * cell;
        const rangeY = (flag.y - FLAG_RANGE) * cell;
        const rangeSize = (FLAG_RANGE * 2 + 1) * cell;
        ctx.fillRect(rangeX, rangeY, rangeSize, rangeSize);
        ctx.strokeRect(rangeX, rangeY, rangeSize, rangeSize);
      });
      ctx.setLineDash([]);
    }

    markers
      .filter((marker) => showTowns || marker.type !== "town")
      .forEach((marker) => {
        const footprint = FOOTPRINT[marker.type];
        const markerX = marker.x * cell;
        const markerY = marker.y * cell;
        const markerWidth = footprint.width * cell;
        const markerHeight = footprint.height * cell;
        const cx = markerX + markerWidth / 2;
        const cy = markerY + markerHeight / 2;
        const inset = 1;
        const left = markerX + inset;
        const top = markerY + inset;
        const width = markerWidth - inset * 2;
        const height = markerHeight - inset * 2;

        ctx.save();
        if (marker.type === "town") {
          ctx.fillStyle = ringColors[marker.ring ?? 1];
          ctx.strokeStyle = "#526675";
        } else if (marker.type === "flag") {
          ctx.fillStyle = "#10251f";
          ctx.strokeStyle = "rgba(112, 214, 163, .5)";
        } else if (marker.type === "mine") {
          ctx.fillStyle = "#282214";
          ctx.strokeStyle = "rgba(240, 196, 109, .54)";
        } else {
          const bearGradient = ctx.createRadialGradient(
            cx,
            cy,
            0,
            cx,
            cy,
            Math.max(markerWidth, markerHeight) * 0.58,
          );
          bearGradient.addColorStop(0, "rgba(255, 99, 50, .23)");
          bearGradient.addColorStop(1, "#261712");
          ctx.fillStyle = bearGradient;
          ctx.strokeStyle = "#ff6332";
        }
        ctx.fillRect(left, top, width, height);
        ctx.lineWidth = 2;
        ctx.strokeRect(left, top, width, height);

        if (marker.type === "town" || marker.type === "mine") {
          ctx.strokeStyle =
            marker.type === "town"
              ? "rgba(219, 228, 234, .16)"
              : "rgba(240, 196, 109, .16)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx, top);
          ctx.lineTo(cx, top + height);
          ctx.moveTo(left, cy);
          ctx.lineTo(left + width, cy);
          ctx.stroke();
        }
        ctx.restore();
      });

    const gameContentSize = Math.ceil(
      boardSize * Math.SQRT2 + EXPORT_AXIS_GUTTER * 2,
    );
    const contentSize =
      view === "game" ? gameContentSize : boardSize + EXPORT_AXIS_GUTTER;
    const canvas = document.createElement("canvas");
    canvas.width = contentSize;
    canvas.height = contentSize + EXPORT_FOOTER_HEIGHT;
    const output = canvas.getContext("2d");
    if (!output) return;

    const outputGradient = output.createLinearGradient(
      0,
      0,
      canvas.width,
      contentSize,
    );
    outputGradient.addColorStop(0, "#08121b");
    outputGradient.addColorStop(1, "#111f2b");
    output.fillStyle = outputGradient;
    output.fillRect(0, 0, canvas.width, contentSize);

    const drawAxes = (
      axisContext: CanvasRenderingContext2D,
      boardLeft: number,
      boardTop: number,
    ) => {
      axisContext.save();
      axisContext.font = `600 12px ${EXPORT_FONT_FAMILY}`;
      axisContext.fillStyle = "rgba(118, 144, 160, .9)";
      axisContext.textAlign = "center";
      axisContext.textBaseline = "middle";
      for (let index = 0; index < GRID_SIZE; index += 1) {
        axisContext.fillText(
          String(index + 1),
          boardLeft + (index + 0.5) * cell,
          boardTop - EXPORT_AXIS_GUTTER / 2,
        );
      }
      axisContext.textAlign = "right";
      for (let index = 0; index < GRID_SIZE; index += 1) {
        axisContext.fillText(
          String(index + 1),
          boardLeft - EXPORT_AXIS_GUTTER / 2,
          boardTop + (index + 0.5) * cell,
        );
      }
      axisContext.restore();
    };

    if (view === "game") {
      output.save();
      output.translate(contentSize / 2, contentSize / 2);
      output.rotate(-Math.PI / 4);
      output.drawImage(boardCanvas, -boardSize / 2, -boardSize / 2);
      drawAxes(output, -boardSize / 2, -boardSize / 2);
      output.restore();
    } else {
      output.drawImage(
        boardCanvas,
        EXPORT_AXIS_GUTTER,
        EXPORT_AXIS_GUTTER,
      );
      drawAxes(output, EXPORT_AXIS_GUTTER, EXPORT_AXIS_GUTTER);
    }

    const markerScreenCenter = (marker: Marker) => {
      const footprint = FOOTPRINT[marker.type];
      const boardX = (marker.x + footprint.width / 2) * cell;
      const boardY = (marker.y + footprint.height / 2) * cell;
      if (view === "vertical") {
        return {
          x: EXPORT_AXIS_GUTTER + boardX,
          y: EXPORT_AXIS_GUTTER + boardY,
        };
      }
      const offsetX = boardX - boardSize / 2;
      const offsetY = boardY - boardSize / 2;
      const cosine = Math.SQRT1_2;
      const sine = -Math.SQRT1_2;
      return {
        x: contentSize / 2 + offsetX * cosine - offsetY * sine,
        y: contentSize / 2 + offsetX * sine + offsetY * cosine,
      };
    };

    markers
      .filter((marker) => showTowns || marker.type !== "town")
      .forEach((marker) => {
        const center = markerScreenCenter(marker);
        const footprint = FOOTPRINT[marker.type];
        const markerWidth = footprint.width * cell;
        const markerHeight = footprint.height * cell;
        if (marker.type === "flag") {
          drawFlagIcon(
            output,
            center.x,
            center.y,
            Math.min(markerWidth, markerHeight) * 0.72,
          );
        } else if (marker.type === "mine") {
          output.save();
          output.fillStyle = "#ffe39a";
          output.font = `700 ${Math.round(Math.min(markerWidth, markerHeight) * 0.42)}px "Segoe UI Symbol", Arial, sans-serif`;
          output.textAlign = "center";
          output.textBaseline = "middle";
          output.shadowColor = "rgba(0, 0, 0, .78)";
          output.shadowBlur = 4;
          output.fillText("⛏", center.x, center.y + 2);
          output.restore();
        } else if (marker.type === "bear") {
          output.save();
          output.textAlign = "center";
          output.textBaseline = "middle";
          output.fillStyle = "#ff7a4f";
          output.font = `700 34px ${EXPORT_FONT_FAMILY}`;
          output.fillText("◎", center.x, center.y - 15);
          output.restore();
          drawCenteredMarkerText(
            output,
            marker.name,
            center.x,
            center.y + 19,
            markerWidth - 12,
            20,
          );
        } else {
          drawCenteredMarkerText(
            output,
            marker.name,
            center.x,
            center.y,
            markerWidth - 12,
            20,
          );
        }
      });

    const footerTop = contentSize;
    output.fillStyle = "rgba(6, 12, 18, .96)";
    output.fillRect(0, footerTop, canvas.width, EXPORT_FOOTER_HEIGHT);
    output.strokeStyle = "rgba(37, 55, 70, .92)";
    output.beginPath();
    output.moveTo(0, footerTop + 0.5);
    output.lineTo(canvas.width, footerTop + 0.5);
    output.stroke();
    const watermarkTitleSize = 20;
    output.font = `700 ${watermarkTitleSize}px ${EXPORT_FONT_FAMILY}`;
    output.textAlign = "left";
    output.fillStyle = "#ffffff";
    output.fillText(
      "熊坑地图编辑器 · Powered by Linglegl",
      28,
      footerTop + 42,
    );
    output.font = `600 24px ${EXPORT_FONT_FAMILY}`;
    output.fillStyle = "#8194a1";
    output.fillText("https://tools.burgerl.com", 28, footerTop + 78);
    output.textAlign = "right";
    output.font = `600 17px ${EXPORT_FONT_FAMILY}`;
    output.fillStyle = "#9babb7";
    output.fillText(
      `熊坑坐标 X:${worldX} Y:${worldY} · ${view === "game" ? "游戏内视角" : "垂直视角"}`,
      canvas.width - 28,
      footerTop + 55,
    );

    try {
      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("png-export-failed"));
        }, "image/png");
      });
      const pngWithMapData = embedMapDataInPng(
        new Uint8Array(await pngBlob.arrayBuffer()),
        mapDataJson(),
      );
      const downloadUrl = URL.createObjectURL(
        new Blob([pngWithMapData.buffer as ArrayBuffer], { type: "image/png" }),
      );
      const link = document.createElement("a");
      // The timestamp is only used for the user-triggered download filename.
      // eslint-disable-next-line react-hooks/purity
      link.download = `熊坑布阵-${view === "game" ? "游戏内视角" : "垂直视角"}-${Date.now()}.png`;
      link.href = downloadUrl;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setImageDialogOpen(false);
      notify("图片已生成，并已写入可恢复的地图数据");
    } catch {
      notify("图片生成失败，请重试");
    }
  }

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const savedTemplates = window.localStorage.getItem(TEMPLATE_KEY);
      if (stored) {
        const data = JSON.parse(stored) as {
          markers?: Marker[];
          worldX?: number;
          worldY?: number;
          activeTownRing?: Ring;
          isTilted?: boolean;
          version?: number;
        };
        if (Array.isArray(data.markers)) {
          // Hydrate once from the browser's persisted editor state.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setMarkers(
            normalizeMarkers(data.markers, data.version !== DATA_VERSION),
          );
        }
        if (Number.isFinite(data.worldX)) setWorldX(Number(data.worldX));
        if (Number.isFinite(data.worldY)) setWorldY(Number(data.worldY));
        if (RINGS.includes(Number(data.activeTownRing) as Ring)) {
          setActiveTownRing(Number(data.activeTownRing) as Ring);
        }
        if (typeof data.isTilted === "boolean") {
          setIsTilted(data.isTilted);
        }
      }
      if (savedTemplates) {
        const items = JSON.parse(savedTemplates) as SavedTemplate[];
        setTemplates(
          items.map((item) => ({
            ...item,
            version: DATA_VERSION,
            markers: normalizeMarkers(
              item.markers,
              item.version !== DATA_VERSION,
            ),
          })),
        );
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(TEMPLATE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: DATA_VERSION,
        markers,
        worldX,
        worldY,
        activeTownRing,
        isTilted,
      }),
    );
  }, [
    hydrated,
    markers,
    worldX,
    worldY,
    activeTownRing,
    isTilted,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
  }, [hydrated, templates]);

  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    // Native HTML dragging can swallow taps on touch screens, so only enable it
    // for mouse-like pointers. Mobile users can still select and edit markers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNativeDragEnabled(finePointer.matches);
  }, []);

  useEffect(() => {
    const viewport = mapViewportRef.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(
        0,
        (viewport.scrollWidth - viewport.clientWidth) / 2,
      );
      viewport.scrollTop = Math.max(
        0,
        (viewport.scrollHeight - viewport.clientHeight) / 2,
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isTilted]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="brand-mark"
            src="/logo.jpg"
            alt="Linglegl"
          />
          <div>
            <p>WJDR · 联盟作战工具</p>
            <h1>熊坑地图编辑器</h1>
          </div>
        </div>
        <div className="header-actions">
          <span className="autosave">
            <i />
            已自动保存
          </span>
          <div className="image-actions">
            <input
              ref={imageImportRef}
              type="file"
              accept=".png,image/png"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void importMapImage(file);
              }}
            />
            <div className="image-action-buttons">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  const confirmed = window.confirm(
                    "仅支持本站生成的原始 PNG 文件。通过微信、QQ 传输或图片压缩后，隐藏地图数据可能丢失，导致无法导入。是否继续选择图片？",
                  );
                  if (confirmed) imageImportRef.current?.click();
                }}
              >
                导入图片
              </button>
              <button
                type="button"
                className="signal-button"
                onClick={() => setImageDialogOpen(true)}
              >
                生成图片
              </button>
            </div>
            <small className="image-import-note">
              <span>仅支持原始PNG文件导入</span>
              <span>微信、QQ 传输或压缩后可能无法使用</span>
            </small>
          </div>
        </div>
      </header>

      <section className="workspace" aria-label="熊坑地图编辑器">
        <aside className="tool-rail" aria-label="地图工具">
          <p className="rail-label">工具</p>
          {TOOL_ITEMS.map((item) => (
            <Fragment key={item.id}>
              <button
                type="button"
                className={tool === item.id ? "active" : ""}
                onClick={() => setTool(item.id)}
                aria-pressed={tool === item.id}
                title={item.hint}
              >
                <strong>{item.symbol}</strong>
                <span>{item.label}</span>
              </button>
              {item.id === "town" && tool === "town" && (
                <div className="town-ring-picker" aria-label="城镇环线颜色">
                  <span>城镇颜色</span>
                  <div>
                    {RINGS.map((ring) => (
                      <button
                        key={ring}
                        type="button"
                        className={activeTownRing === ring ? "active" : ""}
                        style={
                          {
                            "--ring-color": ringColors[ring],
                          } as React.CSSProperties
                        }
                        onClick={() => setActiveTownRing(ring)}
                        aria-label={`选择 ${ring} 环颜色`}
                        aria-pressed={activeTownRing === ring}
                        title={`${ring} 环`}
                      >
                        {ring}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Fragment>
          ))}
          <div className="rail-divider" />
          <button type="button" onClick={undo} disabled={!history.length}>
            <strong>↶</strong>
            <span>撤销</span>
          </button>
          <button type="button" onClick={redo} disabled={!future.length}>
            <strong>↷</strong>
            <span>重做</span>
          </button>
        </aside>

        <section className="map-panel">
          <div className="map-toolbar">
            <div>
              <span className="status-dot" />
              <strong>编辑中</strong>
              <em>25 × 25 网格</em>
            </div>
            <div className="view-switches">
              <button
                type="button"
                className={showTowns ? "on" : ""}
                onClick={() => setShowTowns((value) => !value)}
              >
                {showTowns ? "隐藏" : "显示"}城镇
              </button>
              <button
                type="button"
                className={showCoverage ? "on" : ""}
                onClick={() => setShowCoverage((value) => !value)}
              >
                {showCoverage ? "隐藏" : "显示"}旗帜范围
              </button>
              <button
                type="button"
                className={isTilted ? "on" : ""}
                onClick={() => setIsTilted((value) => !value)}
                aria-pressed={isTilted}
                title="切换垂直视角与游戏内视角"
              >
                {isTilted ? "垂直视角" : "游戏内视角"}
              </button>
            </div>
          </div>

          <div className="map-viewport" ref={mapViewportRef}>
            <div
              className={`map-stage ${isTilted ? "tilted" : ""}`}
              style={
                {
                  "--tilt-yaw": `${TILT_YAW_DEGREES}deg`,
                  "--tilt-counter-yaw": `${TILT_COUNTER_YAW_DEGREES}deg`,
                  "--tilt-inset": `${TILT_INSET_PERCENT}%`,
                } as React.CSSProperties
              }
            >
            <div className="axis axis-x" aria-hidden="true">
              {Array.from({ length: GRID_SIZE }, (_, index) => (
                <span key={index}>{index + 1}</span>
              ))}
            </div>
            <div className="axis axis-y" aria-hidden="true">
              {Array.from({ length: GRID_SIZE }, (_, index) => (
                <span key={index}>{index + 1}</span>
              ))}
            </div>
            <div
              className={`map-board tool-${tool}`}
              onClick={(event) => {
                if (event.target !== event.currentTarget) return;
                const point = boardPoint(event);
                const cell = {
                  x: clamp(Math.floor(point.x)),
                  y: clamp(Math.floor(point.y)),
                };
                const snappedPosition =
                  tool !== "select" && tool !== "erase"
                    ? centeredAt(tool, point.x, point.y)
                    : undefined;
                placeAt(cell.x, cell.y, snappedPosition);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!draggingMarker) return;
                const point = boardPoint(event);
                const position = centeredAt(
                  draggingMarker.type,
                  point.x,
                  point.y,
                );
                if (
                  dragPreview?.x !== position.x ||
                  dragPreview?.y !== position.y
                ) {
                  setDragPreview(position);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const id =
                  draggingId || event.dataTransfer.getData("text/plain");
                const moving = markers.find((marker) => marker.id === id);
                if (!moving) {
                  setDraggingId(null);
                  setDragPreview(null);
                  return;
                }
                if (moving.type === "bear") {
                  notify("熊坑固定在地图中心");
                  setDraggingId(null);
                  setDragPreview(null);
                  return;
                }
                const point = boardPoint(event);
                const position =
                  dragPreview ?? centeredAt(moving.type, point.x, point.y);
                const candidate = { ...moving, ...position };
                const occupied = markers.find(
                  (marker) =>
                    marker.id !== id && overlaps(candidate, marker),
                );
                if (occupied) {
                  notify("目标占地与其他对象重叠");
                  setDraggingId(null);
                  setDragPreview(null);
                  return;
                }
                commit(
                  markers.map((marker) =>
                    marker.id === id ? { ...marker, ...position } : marker,
                  ),
                );
                setDraggingId(null);
                setDragPreview(null);
              }}
            >
              <span
                className="board-corner corner-top-left"
                aria-hidden="true"
              />
              <span
                className="board-corner corner-top-right"
                aria-hidden="true"
              />
              <span
                className="board-corner corner-bottom-right"
                aria-hidden="true"
              />
              <span
                className="board-corner corner-bottom-left"
                aria-hidden="true"
              />
              {(showCoverage || draggingMarker?.type === "flag") &&
                coverageFlags
                  .filter(
                    (flag) => showCoverage || flag.id === draggingMarker?.id,
                  )
                  .map((flag) => (
                  <span
                    key={`${flag.id}-coverage`}
                    className={`flag-coverage ${
                      flag.id === draggingMarker?.id ? "dragging" : ""
                    }`}
                    style={{
                      left: `${((flag.x - FLAG_RANGE) / GRID_SIZE) * 100}%`,
                      top: `${((flag.y - FLAG_RANGE) / GRID_SIZE) * 100}%`,
                      width: `${((FLAG_RANGE * 2 + 1) / GRID_SIZE) * 100}%`,
                      height: `${((FLAG_RANGE * 2 + 1) / GRID_SIZE) * 100}%`,
                    }}
                  />
                  ))}
              {markers
                .filter((marker) => showTowns || marker.type !== "town")
                .map((marker) => {
                  const footprint = FOOTPRINT[marker.type];
                  return (
                  <button
                    key={marker.id}
                    type="button"
                    draggable={
                      nativeDragEnabled &&
                      tool === "select" &&
                      marker.type !== "bear"
                    }
                    className={`marker marker-${marker.type} ${
                      selectedId === marker.id ? "selected" : ""
                    } ${draggingId === marker.id ? "dragging" : ""}`}
                    style={{
                      left: `${(marker.x / GRID_SIZE) * 100}%`,
                      top: `${(marker.y / GRID_SIZE) * 100}%`,
                      width: `${(footprint.width / GRID_SIZE) * 100}%`,
                      height: `${(footprint.height / GRID_SIZE) * 100}%`,
                      ...(marker.type === "town"
                        ? {
                            "--town-color":
                              ringColors[marker.ring ?? 1],
                          }
                        : {}),
                    } as React.CSSProperties}
                    onDragStart={(event) => {
                      if (marker.type === "bear") {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.setData("text/plain", marker.id);
                      event.dataTransfer.effectAllowed = "move";
                      setDraggingId(marker.id);
                      setDragPreview({ x: marker.x, y: marker.y });
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDragPreview(null);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (tool === "erase") {
                        if (marker.type === "bear") {
                          notify("熊坑固定在地图中心，无法删除");
                          return;
                        }
                        commit(
                          markers.filter((item) => item.id !== marker.id),
                        );
                        if (selectedId === marker.id) setSelectedId(null);
                        return;
                      }
                      setSelectedId(marker.id);
                      setTool("select");
                    }}
                    aria-label={`${marker.type === "flag" ? "联盟旗帜" : marker.name}，左上角第 ${marker.x + 1} 列第 ${marker.y + 1} 行，占地 ${footprint.width} × ${footprint.height}`}
                  >
                    {marker.type === "flag" ? (
                      <span className="marker-flag-glyph" aria-hidden="true" />
                    ) : marker.type === "mine" ? (
                      <span className="marker-mine-glyph" aria-hidden="true">
                        ⛏
                      </span>
                    ) : marker.type === "bear" ? (
                      <span className="marker-bear-content">
                        <span className="marker-bear-symbol" aria-hidden="true">
                          ◎
                        </span>
                        <small>{marker.name}</small>
                      </span>
                    ) : null}
                    {marker.type === "town" && <small>{marker.name}</small>}
                  </button>
                  );
                })}
            </div>
            </div>
          </div>

          <div className="map-caption">
            <span>
              当前工具：<strong>{TOOL_ITEMS.find((item) => item.id === tool)?.label}</strong>
            </span>
            <span>拖动元素可调整位置 · 点击空白网格放置</span>
          </div>
        </section>

        <aside className="inspector">
          <section className="panel-section">
            <div className="section-heading">
              <span>01</span>
              <div>
                <h2>对象属性</h2>
                <p>选择地图元素后编辑</p>
              </div>
            </div>
            {selected?.type === "bear" ? (
              <div className="fixed-bear-state">
                <span>◎</span>
                <strong>熊坑已固定</strong>
                <p>熊坑始终位于 25 × 25 地图中心，不可移动或删除。</p>
              </div>
            ) : selected ? (
              <div className="selection-form">
                <div className={`selection-icon ${selected.type}`}>
                  {markerSymbol(selected.type)}
                </div>
                {selected.type === "town" && (
                  <label>
                    <span>名称</span>
                    <input
                      value={selected.name}
                      maxLength={18}
                      onChange={(event) =>
                        updateSelected({ name: event.target.value })
                      }
                    />
                  </label>
                )}
                {selected.type === "town" && (
                  <div className="ring-choice">
                    <span>所属环线</span>
                    <div className="ring-buttons">
                      {RINGS.map((ring) => (
                        <button
                          key={ring}
                          type="button"
                          className={selected.ring === ring ? "active" : ""}
                          style={
                            {
                              "--ring-color": ringColors[ring],
                            } as React.CSSProperties
                          }
                          onClick={() => updateSelected({ ring })}
                        >
                          {ring} 环
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="coordinate-pair">
                  <label>
                    <span>左上列 X</span>
                    <input
                      type="number"
                      min="1"
                      max={GRID_SIZE - FOOTPRINT[selected.type].width + 1}
                      value={selected.x + 1}
                      onChange={(event) =>
                        updateSelected({
                          x: snapMarker(
                            selected.type,
                            Number(event.target.value) - 1,
                            selected.y,
                          ).x,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>左上行 Y</span>
                    <input
                      type="number"
                      min="1"
                      max={GRID_SIZE - FOOTPRINT[selected.type].height + 1}
                      value={selected.y + 1}
                      onChange={(event) =>
                        updateSelected({
                          y: snapMarker(
                            selected.type,
                            selected.x,
                            Number(event.target.value) - 1,
                          ).y,
                        })
                      }
                    />
                  </label>
                </div>
                <p className="footprint-note">
                  占地 {FOOTPRINT[selected.type].width} ×{" "}
                  {FOOTPRINT[selected.type].height}
                  {selected.type === "flag" ? " · 覆盖范围 7 × 7" : ""}
                </p>
                <button
                  type="button"
                  className="delete-button"
                  onClick={removeSelected}
                >
                  删除这个对象
                </button>
              </div>
            ) : (
              <div className="no-selection">
                <span>↖</span>
                <strong>尚未选择对象</strong>
                <p>点击地图中的城镇、旗帜或熊坑查看属性。</p>
              </div>
            )}
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <span>02</span>
              <div>
                <h2>熊坑坐标</h2>
                <p>用于换算所有城镇坐标</p>
              </div>
            </div>
            <div className="coordinate-pair world-coordinate">
              <label>
                <span>世界 X</span>
                <input
                  type="number"
                  value={worldX}
                  onChange={(event) => setWorldX(Number(event.target.value))}
                />
              </label>
              <label>
                <span>世界 Y</span>
                <input
                  type="number"
                  value={worldY}
                  onChange={(event) => setWorldY(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="coordinate-summary">
              <div>
                <strong>{towns.length}</strong>
                <span>城镇</span>
              </div>
              <div>
                <strong>{flags.length}</strong>
                <span>旗帜</span>
              </div>
              <div>
                <strong>{markers.length}</strong>
                <span>对象</span>
              </div>
            </div>
            <button
              type="button"
              className="wide-button"
              onClick={copyCoordinates}
            >
              复制城镇坐标
            </button>
          </section>

          <section className="panel-section templates">
            <div className="section-heading">
              <span>03</span>
              <div>
                <h2>快速模板</h2>
                <p>一键载入常用布局</p>
              </div>
            </div>
            <div className="template-grid">
              <button
                type="button"
                onClick={() => loadTemplate(preset("template-one"))}
              >
                <strong>方形模板</strong>
                <small>106 个对象</small>
              </button>
              <button
                type="button"
                onClick={() => loadTemplate(preset("template-two"))}
              >
                <strong>十字模板</strong>
                <small>105 个对象</small>
              </button>
            </div>
            {templates.map((template) => (
              <div className="saved-template" key={template.id}>
                <button
                  type="button"
                  onClick={() => loadTemplate(template.markers)}
                >
                  {template.name}
                </button>
                <button
                  type="button"
                  aria-label={`删除模板 ${template.name}`}
                  onClick={() =>
                    setTemplates((items) =>
                      items.filter((item) => item.id !== template.id),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="wide-button" onClick={saveTemplate}>
              保存当前布局为模板
            </button>
          </section>

          <section className="panel-section compact-actions">
            <button type="button" onClick={openExport}>
              导出数据
            </button>
            <button
              type="button"
              onClick={() => {
                setTransferText("");
                setDialog("import");
              }}
            >
              导入模板数据
            </button>
            <button
              type="button"
              className="danger-link"
              onClick={() => {
                if (!window.confirm("确认清空地图上的全部内容吗？")) return;
                commit([{ ...FIXED_BEAR }]);
                setSelectedId(null);
              }}
            >
              清空地图
            </button>
          </section>
        </aside>
      </section>

      <footer>
        <p>
          <span>使用提示</span>
          熊坑固定在中心；添加旗帜与城镇后，拖动对象即可微调布阵。
        </p>
        <p>Powered by Linglegl</p>
      </footer>

      {dialog && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="data-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-modal-title"
          >
            <div className="modal-heading">
              <div>
                <span>{dialog === "export" ? "EXPORT" : "IMPORT"}</span>
                <h2 id="data-modal-title">
                  {dialog === "export" ? "导出地图数据" : "导入地图数据"}
                </h2>
              </div>
              <button type="button" onClick={() => setDialog(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <textarea
              value={transferText}
              readOnly={dialog === "export"}
              placeholder="请粘贴完整的地图 JSON 数据"
              onChange={(event) => setTransferText(event.target.value)}
              autoFocus
            />
            <div className="modal-actions">
              <button type="button" onClick={() => setDialog(null)}>
                取消
              </button>
              {dialog === "export" ? (
                <button
                  type="button"
                  className="signal-button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(transferText);
                    notify("地图数据已复制");
                  }}
                >
                  复制数据
                </button>
              ) : (
                <button
                  type="button"
                  className="signal-button"
                  onClick={applyImport}
                >
                  确认导入
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {imageDialogOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="data-modal image-view-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="image-view-modal-title"
          >
            <div className="modal-heading">
              <div>
                <span>IMAGE VIEW</span>
                <h2 id="image-view-modal-title">选择图片视角</h2>
              </div>
              <button
                type="button"
                onClick={() => setImageDialogOpen(false)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <p className="image-export-note">
              <span>导出的原始PNG文件可导入重新编辑</span>
              <span>微信、QQ 传输或压缩后可能无法使用</span>
            </p>
            <div className="image-view-grid">
              <button type="button" onClick={() => downloadImage("vertical")}>
                <strong>垂直视角</strong>
                <small>完整 25 × 25 正方形地图</small>
              </button>
              <button type="button" onClick={() => downloadImage("game")}>
                <strong>游戏内视角</strong>
                <small>逆时针 45° 的垂直地图</small>
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setImageDialogOpen(false)}>
                取消
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
