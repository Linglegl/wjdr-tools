"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Rally = {
  id: string;
  name: string;
  minutes: number;
  seconds: number;
};

type RallyPlan = Rally & {
  durationSeconds: number;
  launchAt: number;
  remainingMs: number;
};

const STORAGE_KEY = "wjdr-rally-timer-v1";
const MERGE_WINDOW_MS = 5000;
const VOICE_LEAD_MS = 300;
const QUICK_ARRIVAL_PRESETS = [
  { label: "+1 分钟", seconds: 60 },
  { label: "+90 秒", seconds: 90 },
  { label: "+2 分钟", seconds: 120 },
  { label: "+3 分钟", seconds: 180 },
  { label: "+5 分钟", seconds: 300 },
];
const DEFAULT_RALLIES: Rally[] = [
  { id: "rally-1", name: "一队 · 主力集结", minutes: 2, seconds: 36 },
  { id: "rally-2", name: "二队 · 侧翼集结", minutes: 1, seconds: 48 },
  { id: "rally-3", name: "三队 · 支援集结", minutes: 0, seconds: 58 },
];

function pad(value: number) {
  return String(Math.max(0, Math.floor(value))).padStart(2, "0");
}

function toLocalDateTimeValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

function getDefaultArrival(now = Date.now()) {
  const date = new Date(now + 10 * 60 * 1000);
  date.setSeconds(0, 0);
  return toLocalDateTimeValue(date);
}

function formatClock(timestamp: number, withDate = false) {
  if (!Number.isFinite(timestamp)) return "--:--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    ...(withDate
      ? { month: "2-digit", day: "2-digit" }
      : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function formatRemaining(milliseconds: number) {
  if (!Number.isFinite(milliseconds)) return "--:--";
  const sign = milliseconds < 0 ? "-" : "";
  return `${sign}${formatDuration(Math.abs(milliseconds) / 1000)}`;
}

function getStatus(plan: RallyPlan, now: number, announceSeconds: number) {
  const delta = plan.launchAt - now;
  if (delta > announceSeconds * 1000) {
    return {
      label: formatRemaining(delta),
      tone: "waiting",
      detail: "等待发出",
    };
  }
  if (delta > 0) {
    return {
      label: `${Math.max(1, Math.ceil(delta / 1000))} 秒`,
      tone: "counting",
      detail: "准备发出",
    };
  }
  return { label: "发出", tone: "launch", detail: "现在发出集结" };
}

export default function Home() {
  const [arrivalValue, setArrivalValue] = useState("");
  const [announceSeconds, setAnnounceSeconds] = useState(5);
  const [rallies, setRallies] = useState<Rally[]>(DEFAULT_RALLIES);
  const [running, setRunning] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [finishedRallyIds, setFinishedRallyIds] = useState<string[]>([]);
  const [now, setNow] = useState(0);
  const [liveClockTime, setLiveClockTime] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const spokenRef = useRef(new Set<string>());
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const arrivalAt = new Date(arrivalValue).getTime();
  const plans = useMemo<RallyPlan[]>(
    () =>
      rallies
        .map((rally) => {
          const durationSeconds =
            Math.max(0, rally.minutes) * 60 + Math.max(0, rally.seconds);
          const launchAt = arrivalAt - durationSeconds * 1000;
          return {
            ...rally,
            durationSeconds,
            launchAt,
            remainingMs: launchAt - now,
          };
        })
        .sort((a, b) => a.launchAt - b.launchAt),
    [arrivalAt, now, rallies],
  );

  const pendingPlans = useMemo(
    () => plans.filter((plan) => !finishedRallyIds.includes(plan.id)),
    [finishedRallyIds, plans],
  );
  const activePlan =
    pendingPlans.find((plan) => plan.launchAt > now) ?? pendingPlans[0];
  const activeGroup = useMemo(() => {
    if (!activePlan) return [];

    const anchorIndex = plans.findIndex((plan) => plan.id === activePlan.id);
    let startIndex = anchorIndex;
    let endIndex = anchorIndex;

    while (startIndex > 0) {
      const currentPlan = plans[startIndex];
      const previousPlan = plans[startIndex - 1];
      if (currentPlan.launchAt - previousPlan.launchAt >= MERGE_WINDOW_MS) break;
      startIndex -= 1;
    }

    while (endIndex < plans.length - 1) {
      const currentPlan = plans[endIndex];
      const nextPlan = plans[endIndex + 1];
      if (nextPlan.launchAt - currentPlan.launchAt >= MERGE_WINDOW_MS) break;
      endIndex += 1;
    }

    return plans.slice(startIndex, endIndex + 1);
  }, [activePlan, plans]);
  const visiblePlans = useMemo(() => {
    if (sessionComplete) return pendingPlans;
    if (!running) return plans;

    const visibleIds = new Set([
      ...pendingPlans.map((plan) => plan.id),
      ...activeGroup
        .filter((plan) => finishedRallyIds.includes(plan.id))
        .map((plan) => plan.id),
    ]);
    return plans.filter((plan) => visibleIds.has(plan.id));
  }, [
    activeGroup,
    finishedRallyIds,
    pendingPlans,
    plans,
    running,
    sessionComplete,
  ]);
  const activeStatus = activePlan
    ? getStatus(activePlan, now, announceSeconds)
    : null;
  const completedCount = finishedRallyIds.length;

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 1.08;
    utterance.pitch = 1;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => {
    const mountedAt = Date.now();
    setNow(mountedAt);
    setLiveClockTime(mountedAt);
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved) as {
          arrivalValue?: string;
          announceSeconds?: number;
          rallies?: Rally[];
        };
        setArrivalValue(
          data.arrivalValue || getDefaultArrival(mountedAt),
        );
        if (typeof data.announceSeconds === "number") {
          setAnnounceSeconds(data.announceSeconds);
        }
        if (Array.isArray(data.rallies) && data.rallies.length) {
          setRallies(data.rallies);
        }
      } else {
        setArrivalValue(getDefaultArrival(mountedAt));
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      setArrivalValue(getDefaultArrival(mountedAt));
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ arrivalValue, announceSeconds, rallies }),
    );
  }, [announceSeconds, arrivalValue, hydrated, rallies]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const timestamp = Date.now();
      setNow(timestamp);
      setLiveClockTime(timestamp);
    }, running ? 80 : 500);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running) return;

    const voiceLaunches = pendingPlans.filter((plan) => {
      const delta = plan.launchAt - now;
      if (delta <= VOICE_LEAD_MS) {
        const key = `${plan.id}:launch`;
        if (!spokenRef.current.has(key)) {
          spokenRef.current.add(key);
          return true;
        }
      }
      return false;
    });

    if (voiceLaunches.length) {
      speak("发出");
    }

    const completedLaunches = pendingPlans.filter(
      (plan) => plan.launchAt - now <= 0,
    );
    if (completedLaunches.length) {
      const completedIds = completedLaunches.map((plan) => plan.id);
      const nextFinishedIds = Array.from(
        new Set([...finishedRallyIds, ...completedIds]),
      );
      setFinishedRallyIds(nextFinishedIds);

      if (nextFinishedIds.length >= plans.length) {
        setRunning(false);
        setSessionComplete(true);
        wakeLockRef.current?.release().catch(() => undefined);
        wakeLockRef.current = null;
      }
      return;
    }

    const nextGroup = activeGroup.filter((plan) => plan.launchAt > now);
    const nextPlan = nextGroup[0];
    if (nextPlan) {
      const delta = nextPlan.launchAt - now;
      if (
        delta > VOICE_LEAD_MS &&
        delta <= announceSeconds * 1000 + VOICE_LEAD_MS
      ) {
        const unannouncedPlans = nextGroup.filter(
          (plan) => !spokenRef.current.has(`${plan.id}:prepare`),
        );
        if (unannouncedPlans.length) {
          nextGroup.forEach((plan) =>
            spokenRef.current.add(`${plan.id}:prepare`),
          );
          speak(`${nextGroup.map((plan) => plan.name).join("、")}，准备`);
        }
      }
    }
  }, [
    activeGroup,
    announceSeconds,
    finishedRallyIds,
    now,
    pendingPlans,
    plans.length,
    running,
  ]);

  useEffect(() => {
    return () => {
      wakeLockRef.current?.release().catch(() => undefined);
      window.speechSynthesis?.cancel();
    };
  }, []);

  function updateRally(id: string, changes: Partial<Rally>) {
    setRallies((current) =>
      current.map((rally) =>
        rally.id === id ? { ...rally, ...changes } : rally,
      ),
    );
    setSessionComplete(false);
    setFinishedRallyIds([]);
    if (running) stopTimer();
  }

  function addRally() {
    const nextNumber = rallies.length + 1;
    setRallies((current) => [
      ...current,
      {
        id: `rally-${Date.now()}`,
        name: `${nextNumber}队 · 新集结`,
        minutes: 1,
        seconds: 30,
      },
    ]);
    setSessionComplete(false);
    setFinishedRallyIds([]);
  }

  function removeRally(id: string) {
    if (rallies.length <= 1) return;
    setRallies((current) => current.filter((rally) => rally.id !== id));
    setSessionComplete(false);
    setFinishedRallyIds([]);
    if (running) stopTimer();
  }

  async function startTimer() {
    const timestamp = Date.now();
    setNow(timestamp);
    if (!Number.isFinite(arrivalAt)) {
      setError("请先设置有效的统一到达时间");
      return;
    }
    if (!rallies.length) {
      setError("请至少添加一条集结");
      return;
    }
    if (plans.some((plan) => plan.durationSeconds <= 0)) {
      setError("每条集结的行军时长必须大于 0 秒");
      return;
    }
    if (plans.some((plan) => plan.launchAt <= timestamp)) {
      setError("该时间已无法到达，请检查时间是否设置正确");
      return;
    }

    setError("");
    spokenRef.current.clear();
    setFinishedRallyIds([]);
    setSessionComplete(false);
    setRunning(true);

    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      // The timer still works if the device does not support wake lock.
    }

  }

  function stopTimer() {
    setRunning(false);
    setSessionComplete(false);
    setFinishedRallyIds([]);
    spokenRef.current.clear();
    wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
    window.speechSynthesis?.cancel();
  }

  function setQuickArrival(secondsFromNow: number) {
    const target = new Date(Date.now() + secondsFromNow * 1000);
    target.setMilliseconds(0);
    setArrivalValue(toLocalDateTimeValue(target));
    setSessionComplete(false);
    setFinishedRallyIds([]);
    if (running) stopTimer();
  }

  function prepareNextRound() {
    setSessionComplete(false);
    setFinishedRallyIds([]);
    setQuickArrival(300);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/logo.jpg" alt="" />
          <div>
            <p>WJDR · 联盟作战工具</p>
            <h1>同抵集结计时器</h1>
          </div>
        </div>
        <div
          className="live-clock"
          aria-label={
            liveClockTime === null
              ? "当前时间加载中"
              : `当前时间 ${formatClock(liveClockTime)}`
          }
        >
          <span className="live-dot" />
          <span>当前时间</span>
          <strong>
            {liveClockTime === null ? "--:--:--" : formatClock(liveClockTime)}
          </strong>
        </div>
      </header>

      <section className="hero-grid" aria-label="计时总览">
        <article
          className={`command-panel ${
            running && activeStatus ? `is-${activeStatus.tone}` : ""
          }`}
        >
          <div className="panel-kicker">
            <span>{running ? "计时进行中" : "作战准备"}</span>
            {running && (
              <span className="progress-label">
                {completedCount}/{plans.length} 已发出
              </span>
            )}
          </div>

          {sessionComplete ? (
            <div className="idle-state complete-state" aria-live="assertive">
              <p>本轮完成</p>
              <h2>全部集结已发出</h2>
              <span>各队将于 {formatClock(arrivalAt)} 同时到达目标。</span>
            </div>
          ) : !running ? (
            <div className="idle-state">
              <p>下一步</p>
              <h2>设定同一到达时间</h2>
              <span>
                系统会根据每队行军时长，自动反推出准确的发车时刻。
              </span>
            </div>
          ) : (
            <div className="countdown-state" aria-live="polite">
              <p className="active-name">
                {activeGroup.length > 1
                  ? `${activeGroup.length} 队近距集结 · 合并显示`
                  : activePlan?.name}
              </p>
              {activeGroup.length > 1 ? (
                <div className="merged-countdowns">
                  {activeGroup.map((plan, index) => {
                    const status = getStatus(plan, now, announceSeconds);
                    const isFinished = finishedRallyIds.includes(plan.id);
                    return (
                      <div
                        className={`merged-countdown-item tone-${
                          isFinished ? "finished" : status.tone
                        }`}
                        key={plan.id}
                      >
                        <span className="merged-countdown-meta">
                          <span className="merged-countdown-index">
                            {pad(index + 1)}
                          </span>
                          <span className="merged-countdown-name">
                            {plan.name}
                          </span>
                        </span>
                        <strong>
                          {isFinished
                            ? "已出发"
                            : status.tone === "launch"
                            ? "发出"
                            : status.tone === "counting"
                              ? status.label
                              : formatRemaining(plan.remainingMs)}
                        </strong>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="hero-countdown">
                  {activeStatus?.tone === "launch"
                    ? "发出"
                    : activeStatus?.tone === "counting"
                      ? activeStatus.label
                      : formatRemaining(activePlan?.remainingMs ?? 0)}
                </div>
              )}
              <p className="active-hint">
                {activeGroup.length > 1
                  ? "相隔不足 5 秒，按各自倒计时依次发出"
                  : activeStatus?.tone === "counting"
                  ? "准备点击游戏内集结按钮"
                  : activeStatus?.detail}
              </p>
            </div>
          )}

          <div className="arrival-strip">
            <div>
              <span>统一到达</span>
              <strong>{formatClock(arrivalAt, true)}</strong>
            </div>
            <div className="arrival-line" aria-hidden="true">
              <span />
            </div>
            <div>
              <span>语音提醒</span>
              <strong>提前 {announceSeconds} 秒</strong>
            </div>
          </div>
        </article>

        <aside className="setup-panel">
          <div className="section-title">
            <div>
              <span>01</span>
              <h2>作战参数</h2>
            </div>
            <span className={`mode-badge ${running ? "active" : ""}`}>
              {running ? "已锁定" : sessionComplete ? "已完成" : "可编辑"}
            </span>
          </div>

          <label className="field-label" htmlFor="arrival-time">
            统一到达时间
          </label>
          <input
            id="arrival-time"
            className="datetime-input"
            type="datetime-local"
            step="1"
            value={arrivalValue}
            disabled={running}
            onChange={(event) => {
              setArrivalValue(event.target.value);
              setError("");
            }}
          />

          <div className="quick-times" aria-label="快捷设置到达时间">
            {QUICK_ARRIVAL_PRESETS.map((preset) => (
              <button
                key={preset.seconds}
                type="button"
                disabled={running}
                onClick={() => setQuickArrival(preset.seconds)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="compact-settings">
            <label>
              <span>
                <strong>出发前语音提示</strong>
                <small>仅提醒一次，不进行语音读秒</small>
              </span>
              <span className="number-control">
                <input
                  type="number"
                  inputMode="numeric"
                  min="3"
                  max="30"
                  value={announceSeconds}
                  disabled={running}
                  aria-label="出发前语音提醒秒数"
                  onChange={(event) =>
                    setAnnounceSeconds(
                      Math.min(30, Math.max(3, Number(event.target.value) || 3)),
                    )
                  }
                />
                <em>秒</em>
              </span>
            </label>
          </div>

          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}

          <button
            className={`primary-action ${running ? "stop" : ""}`}
            type="button"
            onClick={
              sessionComplete
                ? prepareNextRound
                : running
                  ? stopTimer
                  : startTimer
            }
          >
            <span aria-hidden="true">
              {sessionComplete ? "↻" : running ? "■" : "▶"}
            </span>
            {sessionComplete
              ? "准备下一轮"
              : running
                ? "停止并重新校准"
                : "开始同步计时"}
          </button>
          <p className="action-note">
            点击开始即启用屏幕常亮；建议保持本页面在前台。
          </p>
        </aside>
      </section>

      <section className="rallies-section">
        <div className="rallies-heading">
          <div className="section-title">
            <div>
              <span>02</span>
              <h2>集结队列</h2>
            </div>
          </div>
          <button
            className="add-button"
            type="button"
            disabled={running}
            onClick={addRally}
          >
            <span aria-hidden="true">＋</span>
            添加集结
          </button>
        </div>

        <div className="table-header" aria-hidden="true">
          <span>集结名称</span>
          <span>行军时长</span>
          <span>发车时刻</span>
          <span>状态</span>
          <span />
        </div>

        <div className="rally-list">
          {visiblePlans.map((plan, index) => {
            const status = getStatus(plan, now, announceSeconds);
            const isFinished = finishedRallyIds.includes(plan.id);
            return (
              <article
                className={`rally-row ${
                  running
                    ? `status-${isFinished ? "finished" : status.tone}`
                    : ""
                }`}
                key={plan.id}
              >
                <div className="rally-name-cell">
                  <span className="queue-number">{pad(index + 1)}</span>
                  <input
                    type="text"
                    value={plan.name}
                    disabled={running}
                    aria-label={`第 ${index + 1} 条集结名称`}
                    onChange={(event) =>
                      updateRally(plan.id, { name: event.target.value })
                    }
                  />
                </div>

                <div className="duration-cell">
                  <label>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      inputMode="numeric"
                      value={plan.minutes}
                      disabled={running}
                      aria-label={`${plan.name}行军分钟`}
                      onChange={(event) =>
                        updateRally(plan.id, {
                          minutes: Math.min(
                            59,
                            Math.max(0, Number(event.target.value) || 0),
                          ),
                        })
                      }
                    />
                    <span>分</span>
                  </label>
                  <b>:</b>
                  <label>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      inputMode="numeric"
                      value={plan.seconds}
                      disabled={running}
                      aria-label={`${plan.name}行军秒数`}
                      onChange={(event) =>
                        updateRally(plan.id, {
                          seconds: Math.min(
                            59,
                            Math.max(0, Number(event.target.value) || 0),
                          ),
                        })
                      }
                    />
                    <span>秒</span>
                  </label>
                </div>

                <div className="launch-time-cell">
                  <strong>{formatClock(plan.launchAt)}</strong>
                  <span>反推发车</span>
                </div>

                <div
                  className={`status-cell tone-${
                    isFinished ? "finished" : status.tone
                  }`}
                >
                  <strong>
                    {isFinished ? "已出发" : running ? status.label : "就绪"}
                  </strong>
                  <span>
                    {isFinished
                      ? `发出于 ${formatClock(plan.launchAt)}`
                      : running
                      ? status.detail
                      : `行军 ${formatDuration(plan.durationSeconds)}`}
                  </span>
                </div>

                <button
                  className="remove-button"
                  type="button"
                  disabled={running || rallies.length <= 1}
                  onClick={() => removeRally(plan.id)}
                  aria-label={`删除${plan.name}`}
                >
                  ×
                </button>
              </article>
            );
          })}
          {sessionComplete && pendingPlans.length === 0 && (
            <div className="empty-queue">
              本轮集结均已结束，点击“准备下一轮”重新载入。
            </div>
          )}
        </div>

        <div className="sync-note">
          <span className="sync-icon" aria-hidden="true">
            ◎
          </span>
          <p>
            <strong>同抵校验通过</strong>
            <span>
              所有集结均按各自行军时长反推，预计于{" "}
              {formatClock(arrivalAt)} 同时抵达。
            </span>
          </p>
        </div>
      </section>

      <footer>
        <p>Powered by Linglegl</p>
      </footer>
    </main>
  );
}
