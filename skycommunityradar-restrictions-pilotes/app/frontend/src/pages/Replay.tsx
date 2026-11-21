import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FastForward, LocateFixed, Pause, Play, Rewind, RotateCcw } from "lucide-react";
import AppShell from "@/components/AppShell";
import RadarMap from "@/components/RadarMap";
import { apiGet } from "@/lib/api";
import { errMsg, useGround } from "@/lib/hooks";
import { PHASE_COLORS, PHASE_LABELS, fmtAlt } from "@/lib/phases";
import type { FlightReplay, FlightSummary, ReplaySample } from "@/lib/types";
import { cn } from "@/lib/utils";
import { tr, trServer } from "@/lib/i18n";

const SPEEDS = [1, 2, 5, 10, 30, 60];

const utc = (ms: number) => new Date(ms).toISOString().slice(11, 19);
const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const nm = (a: number[], b: number[]) => {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.sqrt(h));
};

/** Index of the last sample at or before t (binary search). */
function indexAt(s: ReplaySample[], t: number): number {
  let lo = 0, hi = s.length - 1;
  if (!s.length || t <= s[0][0]) return 0;
  if (t >= s[hi][0]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Aircraft state at time t, interpolated between the two recorded points around it. */
function stateAt(s: ReplaySample[], t: number) {
  const i = indexAt(s, t);
  const a = s[i], b = s[Math.min(i + 1, s.length - 1)];
  const k = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0;
  const dh = ((b[4] - a[4] + 540) % 360) - 180; // heading by the shortest turn
  const gs = b[0] > a[0] ? (nm([a[1], a[2]], [b[1], b[2]]) / ((b[0] - a[0]) / 3_600_000)) : 0;
  return {
    i,
    lat: a[1] + (b[1] - a[1]) * k,
    lon: a[2] + (b[2] - a[2]) * k,
    alt: Math.round(a[3] + (b[3] - a[3]) * k),
    hdg: (a[4] + dh * k + 360) % 360,
    phase: k < 0.5 ? a[5] : b[5],
    ground: k < 0.5 ? a[6] : b[6],
    gs: Math.round(gs),
  };
}

function ReplayView({ id }: { id: string }) {
  const q = useQuery<FlightReplay>({ queryKey: ["replay", id], queryFn: () => apiGet<FlightReplay>(`/flights/${id}/replay`), retry: false });
  const r = q.data;
  const s = useMemo(() => r?.samples ?? [], [r]);
  const dep = useGround(r?.departure);
  const arr = useGround(r?.arrival);
  const t0 = s[0]?.[0] ?? 0;
  const t1 = s[s.length - 1]?.[0] ?? 0;
  const span = Math.max(1, t1 - t0);

  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    tRef.current = t0;
    setT(t0);
  }, [t0]);

  // playback: the replay clock advances `speed` times faster than real time; React redraws ~12 times a second
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let painted = 0;
    const step = (now: number) => {
      tRef.current = Math.min(t1, tRef.current + (now - last) * speed);
      last = now;
      const end = tRef.current >= t1;
      if (now - painted > 80 || end) {
        painted = now;
        setT(tRef.current);
      }
      if (end) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, t1]);

  const seek = (v: number) => {
    tRef.current = Math.min(t1, Math.max(t0, v));
    setT(tRef.current);
  };
  const togglePlay = () => {
    if (!playing && tRef.current >= t1) seek(t0); // at the end: start again
    setPlaying(!playing);
  };

  const cur = s.length ? stateAt(s, t) : null;
  const trail = useMemo(() => (cur ? [...s.slice(0, cur.i + 1).map((x) => [x[1], x[2]]), [cur.lat, cur.lon]] : undefined), [s, cur?.i, cur?.lat, cur?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const ahead = useMemo(
    () => (cur ? [[cur.lat, cur.lon], ...s.slice(cur.i + 1).map((x) => [x[1], x[2]])] : r?.route.map((w) => [w[0], w[1]])),
    [s, r, cur?.i, cur?.lat, cur?.lon], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // phases along the timeline (coloured band under the slider)
  const bands = useMemo(() => {
    const out: { from: number; to: number; phase: string }[] = [];
    for (const x of s) {
      const lastBand = out[out.length - 1];
      if (lastBand && lastBand.phase === x[5]) lastBand.to = x[0];
      else out.push({ from: x[0], to: x[0], phase: x[5] });
    }
    return out;
  }, [s]);
  const events = r?.events ?? [];
  const currentEvent = events.reduce((acc, e, i) => (new Date(e.at).getTime() <= t ? i : acc), -1);
  const evRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (playing) evRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentEvent, playing]);

  if (q.isError) {
    return <div className="p-6 text-sm text-red-300" data-testid="replay-error">{trServer(errMsg(q.error))}</div>;
  }
  if (!r) return <div className="p-6 text-sm text-muted-foreground" data-testid="replay-loading">{tr("Chargement du replay…")}</div>;

  const plane = cur
    ? ({
        id: r.id, callsign: r.callsign, pilot_id: r.pilot_id, pilot_name: r.pilot_name ?? "", aircraft_type: r.aircraft_type ?? "",
        departure: r.departure, arrival: r.arrival, phase: cur.phase, prev_phase: null, source: "simbrief", version: 0, hold: false,
        dep_gate: null, arr_gate: null, arr_gate_by: null, created_at: "", updated_at: "", controller_callsign: null,
        position: {
          lat: cur.lat, lon: cur.lon, heading: cur.hdg, on_ground: cur.ground, track: null, distance_nm: 0, total_nm: 0,
          progress_pct: 0, prev_wp: null, next_wp: null, wp_index: 0, alt_ft: cur.alt, kind: "estimee", paused: false,
        },
      } as FlightSummary)
    : null;
  const grounds = [dep.data, arr.data].filter((g) => !!g).map((g) => g!);
  const start = s[0] ? [s[0][1], s[0][2]] as [number, number] : r.route[0] ? [r.route[0][0], r.route[0][1]] as [number, number] : undefined;
  const phaseColor = cur ? PHASE_COLORS[cur.phase] ?? "#94A3B8" : "#94A3B8";
  const btn = "inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-border bg-background/60 px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40";

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <aside className="order-2 w-full shrink-0 space-y-4 border-r border-border bg-card p-4 lg:order-none lg:w-[28rem] lg:overflow-y-auto" data-testid="replay-panel">
        <div className="flex items-center justify-between gap-2">
          <Link to={`/flights/${r.id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="replay-back">
            <ArrowLeft className="h-3.5 w-3.5" /> {tr("Page du vol")}
          </Link>
          <span className="rounded-md border border-[color:var(--sc-accent)]/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--sc-accent)]">{tr("Replay")}</span>
        </div>
        <div>
          <div className="font-mono text-2xl font-bold text-[color:var(--sc-accent)]" data-testid="replay-callsign">{r.callsign}</div>
          <div className="text-xs text-muted-foreground">
            {r.departure} → {r.arrival} · {r.aircraft_type} · {r.pilot_name}
          </div>
        </div>

        {!s.length ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100" data-testid="replay-empty">
            {tr("Pas d'enregistrement de trajectoire pour ce vol : le replay existe pour les vols effectués depuis sa mise en service. La route prévue et l'historique du vol restent visibles.")}
          </p>
        ) : (
          <div className="space-y-3 rounded-xl border border-border bg-background/40 p-3" data-testid="replay-controls">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{tr("Heure")}</div>
                <div className="font-mono text-sm font-semibold" data-testid="replay-time">{utc(t)} UTC</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{tr("Écoulé")}</div>
                <div className="font-mono text-sm font-semibold">{dur(t - t0)} / {dur(span)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{tr("Phase")}</div>
                <div className="truncate text-sm font-semibold" style={{ color: phaseColor }} data-testid="replay-phase">{cur ? PHASE_LABELS[cur.phase] ?? cur.phase : "—"}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs text-muted-foreground">
              <span>{tr("ALT")} <b className="text-foreground">{cur?.ground ? tr("SOL") : fmtAlt(cur?.alt ?? null)}</b></span>
              <span>{tr("CAP")} <b className="text-foreground">{String(Math.round(cur?.hdg ?? 0) % 360 || 360).padStart(3, "0")}°</b></span>
              <span>{tr("VITESSE")} <b className="text-foreground">{cur?.gs ?? 0} kt</b></span>
            </div>

            {/* timeline: slider + coloured phases + marks for the journal events */}
            <div className="space-y-1">
              <input
                type="range" min={t0} max={t1} step={1000} value={t}
                onChange={(e) => seek(Number(e.target.value))}
                className="w-full accent-[color:var(--sc-accent)]" aria-label={tr("Position dans le vol")} data-testid="replay-slider"
              />
              <div className="relative h-2 overflow-hidden rounded-full bg-border/60">
                {bands.map((b, i) => (
                  <div key={i} className="absolute inset-y-0" title={PHASE_LABELS[b.phase] ?? b.phase}
                    style={{ left: `${((b.from - t0) / span) * 100}%`, width: `${Math.max(0.4, ((b.to - b.from) / span) * 100)}%`, background: PHASE_COLORS[b.phase] ?? "#94A3B8" }} />
                ))}
              </div>
              <div className="relative h-3">
                {events.map((e, i) => {
                  const at = new Date(e.at).getTime();
                  if (at < t0 || at > t1) return null;
                  return (
                    <button key={i} type="button" onClick={() => seek(at)} title={`${utc(at)} — ${e.label}`}
                      className="absolute top-0 h-3 w-0.5 -translate-x-1/2 bg-muted-foreground/70 hover:bg-[color:var(--sc-accent)]"
                      style={{ left: `${((at - t0) / span) * 100}%` }} />
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className={btn} onClick={() => seek(t0)} title={tr("Début")} data-testid="replay-restart"><RotateCcw className="h-3.5 w-3.5" /></button>
              <button type="button" className={btn} onClick={() => seek(tRef.current - 60_000)} title={tr("-1 min")}><Rewind className="h-3.5 w-3.5" /> 1 min</button>
              <button type="button" onClick={togglePlay} data-testid="replay-play"
                className="inline-flex h-9 min-w-24 items-center justify-center gap-1.5 rounded-lg bg-[color:var(--sc-primary)] px-3 text-sm font-semibold text-white hover:bg-[color:var(--sc-primary-hover)]">
                {playing ? <><Pause className="h-4 w-4" /> {tr("Pause")}</> : <><Play className="h-4 w-4" /> {tr("Lecture")}</>}
              </button>
              <button type="button" className={btn} onClick={() => seek(tRef.current + 60_000)} title={tr("+1 min")}>1 min <FastForward className="h-3.5 w-3.5" /></button>
            </div>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={tr("Vitesse de lecture")}>
              {SPEEDS.map((x) => (
                <button key={x} type="button" role="radio" aria-checked={speed === x} onClick={() => setSpeed(x)} data-testid={`replay-speed-${x}`}
                  className={cn("h-8 min-w-11 rounded-md border px-2 font-mono text-xs font-semibold transition-colors",
                    speed === x ? "border-[color:var(--sc-accent)] bg-[color:var(--sc-primary)] text-white" : "border-border text-muted-foreground hover:text-foreground")}>
                  ×{x}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tr("Historique du vol")}</h2>
          <ol className="space-y-1" data-testid="replay-events">
            {events.map((e, i) => {
              const at = new Date(e.at).getTime();
              const past = !s.length || at <= t;
              return (
                <li key={i} ref={i === currentEvent ? evRef : undefined}>
                  <button type="button" disabled={!s.length} onClick={() => seek(at)}
                    className={cn("w-full rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                      i === currentEvent ? "border-[color:var(--sc-accent)]/60 bg-[color:var(--sc-primary)]/15" : "border-transparent hover:border-border",
                      !past && "opacity-40")}>
                    <span className="font-mono text-muted-foreground">{utc(at)}</span> <b>{e.label}</b>
                    {e.details && <span className="text-muted-foreground"> — {e.details}</span>}
                    <span className="block text-[10px] text-muted-foreground">{e.actor_name}</span>
                  </button>
                </li>
              );
            })}
            {!events.length && <li className="text-xs text-muted-foreground">{tr("Aucun événement enregistré.")}</li>}
          </ol>
        </div>
      </aside>
      <section className="replay-map relative order-1 h-[50vh] shrink-0 lg:order-none lg:h-auto lg:flex-1 lg:shrink">
        <RadarMap
          testId="replay-map"
          flights={plane ? [plane] : []}
          selectedId={r.id}
          trail={trail}
          trailAhead={ahead}
          grounds={grounds}
          center={start}
          zoom={s[0]?.[6] ? 15 : 9}
          focusKey={r.id}
          followPos={follow && cur ? [cur.lat, cur.lon] : undefined}
          followAnimate={false}
          onUserPan={() => setFollow(false)}
        />
        {cur && (
          <button
            onClick={() => setFollow(!follow)}
            className={`absolute bottom-6 right-3 z-[500] inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium backdrop-blur transition-colors duration-150 ${follow ? "border-[color:var(--sc-accent)]/60 bg-[color:var(--sc-primary)]/30 text-[color:var(--sc-accent-soft)]" : "border-border bg-background/90 text-foreground hover:border-[color:var(--sc-accent)]/60"}`}
            data-testid="replay-follow"
          >
            <LocateFixed className="h-3.5 w-3.5" />
            {follow ? tr("Suivi de l'avion") : tr("Centrer sur l'avion")}
          </button>
        )}
      </section>
    </div>
  );
}

function ReplayRoute() {
  const { id } = useParams();
  return <AppShell>{() => <ReplayView id={id ?? ""} />}</AppShell>;
}

export default ReplayRoute;
