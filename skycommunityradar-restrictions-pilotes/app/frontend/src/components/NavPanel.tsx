import { useEffect, useState } from "react";
import { Compass, CornerUpRight, MousePointerClick, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api";
import { useFlightMutation } from "@/lib/hooks";
import type { FlightDetail, VectorInfo } from "@/lib/types";
import type { FlightEditing } from "@/lib/useFlightEditing";
import { cn } from "@/lib/utils";

import { tr } from "@/lib/i18n";
const TURN_CHOICES = [1, 2, 3, 4, 5, 0] as const; // 0 = jusqu'à nouvel ordre

const hdg3 = (h: number) => String(((Math.round(h) % 360) + 360) % 360 || 360).padStart(3, "0");
/** « 080 » / « FL080 » -> 8000 ft ; « 4000 » -> 4000 ft ; empty -> unchanged. */
function parseLevel(s: string): number | null | "bad" {
  const t = s.trim().toUpperCase().replace(/^FL\s*/, "");
  if (!t) return null;
  if (!/^\d{2,5}$/.test(t)) return "bad";
  const n = Number(t), ft = n <= 450 ? n * 100 : n;
  return ft >= 1000 && ft <= 45000 ? ft : "bad";
}
/** First fix of the route still ahead of where the aircraft left it (« reprendre la route »). */
function nextFix(f: FlightDetail): number | null {
  const d = f.position.distance_nm, n = f.route.length;
  const i = f.route.findIndex((w, k) => k > 0 && k < n - 1 && w.cum_nm > d + 0.05 && w.kind !== "apt" && w.kind !== "rwy" && w.ident !== "TOC" && w.ident !== "TOD");
  return i >= 0 ? i : null;
}

/** What the crew has to fly, shown to everyone (the pilot sees it in his panel). */
export function VectorStatus({ v, compact = false }: { v: VectorInfo; compact?: boolean }) {
  return (
    <div className="space-y-1 rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-xs" data-testid="vector-status">
      <p className="flex items-center gap-1.5 font-semibold text-amber-100">
        <Compass className="h-4 w-4 shrink-0 text-amber-300" />{tr("Vecteurs radar")}
        <span className="ml-1 rounded bg-amber-400/20 px-1.5 py-0.5 font-mono text-[12px] tracking-wide text-amber-200" data-testid="vector-label">{v.label}</span>
      </p>
      {!compact && (
        <p className="text-amber-100/80">
          {v.turning ? (v.turning_side === "left" ? tr("Virage à gauche en cours, cap actuel {0}.", [hdg3(v.current_heading)]) : tr("Virage à droite en cours, cap actuel {0}.", [hdg3(v.current_heading)])) : tr("Cap {0} maintenu.", [hdg3(v.heading)])}
          {v.alt_ft != null && v.current_alt_ft != null && Math.abs(v.current_alt_ft - v.alt_ft) > 100 && (" " + (v.current_alt_ft > v.alt_ft ? tr("En descente ({0} ft).", [v.current_alt_ft]) : tr("En montée ({0} ft).", [v.current_alt_ft])))}
        </p>
      )}
      {(v.by || v.by_callsign) && <p className="text-[11px] text-amber-100/70">{tr("Donné par {0}", [[v.by_callsign, v.by].filter(Boolean).join(" · ")])}</p>}
    </div>
  );
}

/** Radar vectors: the controller in charge of the flight only (and administrators), never the pilot. */
function VectorPanel({ flight: f, ed }: { flight: FlightDetail; ed?: FlightEditing }) {
  const m = useFlightMutation(f.id);
  const v = f.vector;
  const [hdg, setHdg] = useState<number>(() => v?.heading ?? (Math.round(f.position.heading) || 360));
  const [turn, setTurn] = useState<"auto" | "left" | "right">("auto");
  const [level, setLevel] = useState("");
  const [speed, setSpeed] = useState("");
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; heading: number }>).detail;
      if (d.id !== f.id) return;
      setHdg(d.heading);
      toast.info(tr("Cap {0} choisi sur la carte : vérifiez puis « Donner le vecteur ».", [hdg3(d.heading)]));
    };
    window.addEventListener("sc-vector-pick", h);
    return () => window.removeEventListener("sc-vector-pick", h);
  }, [f.id]);
  const lvl = parseLevel(level);
  const spd = speed.trim() ? Number(speed) : null;
  const badSpd = spd != null && (!Number.isFinite(spd) || spd < 140 || spd > 450);
  const nxt = nextFix(f);
  const give = () =>
    m.mutate({
      fn: () => apiPost<FlightDetail>(`/flights/${f.id}/nav`, {
        op: "vector", version: f.version, heading: Number(hdg3(hdg)),
        ...(turn !== "auto" ? { turn } : {}), ...(typeof lvl === "number" ? { altitude_ft: lvl } : {}), ...(spd != null ? { speed_kt: Math.round(spd) } : {}),
      }),
      success: tr("Vecteur donné : cap {0}", [hdg3(hdg)]),
    }, { onSuccess: () => { setLevel(""); setSpeed(""); } });
  const step = (d: number) => setHdg((x) => ((Math.round(x + d) % 360) + 360) % 360 || 360);
  const seg = "h-8 flex-1 px-2 text-xs font-semibold transition-colors";
  return (
    <div className="space-y-2.5" data-testid="vector-panel">
      {v && <VectorStatus v={v} />}
      <div className="space-y-2 rounded-lg border border-border bg-background/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{v ? tr("Nouveau vecteur") : tr("Donner un vecteur")}</span>
          {ed && (
            <Button size="xs" variant={ed.mode === "vector" ? "default" : "outline"} onClick={() => ed.setMode(ed.mode === "vector" ? "view" : "vector")} data-testid="vector-pick">
              <MousePointerClick className="h-3.5 w-3.5" />{" "}{ed.mode === "vector" ? tr("Annuler") : tr("Viser sur la carte")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="px-2" onClick={() => step(-10)} data-testid="vector-m10">−10</Button>
          <Button size="sm" variant="outline" className="px-2" onClick={() => step(-5)}>−5</Button>
          <label className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[color:var(--sc-accent)]/50 bg-background px-2">
            <span className="text-[10px] font-semibold text-muted-foreground">{tr("CAP")}</span>
            <input
              value={hdg3(hdg)}
              onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "").slice(-3)); if (Number.isFinite(n)) setHdg(n); }}
              inputMode="numeric"
              className="h-9 w-14 bg-transparent text-center font-mono text-lg font-bold text-amber-200 outline-none"
              data-testid="vector-heading"
            />
          </label>
          <Button size="sm" variant="outline" className="px-2" onClick={() => step(5)}>+5</Button>
          <Button size="sm" variant="outline" className="px-2" onClick={() => step(10)} data-testid="vector-p10">+10</Button>
        </div>
        <div className="flex divide-x divide-border overflow-hidden rounded-md border border-border" role="radiogroup" aria-label={tr("Côté du virage")}>
          {(["left", "auto", "right"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={turn === k} onClick={() => setTurn(k)}
              className={cn(seg, turn === k ? "bg-[color:var(--sc-primary)]/30 text-[color:var(--sc-accent-soft)]" : "text-muted-foreground hover:bg-secondary")}
              data-testid={`vector-turn-${k}`}>
              {k === "left" ? tr("◀ Par la gauche") : k === "right" ? tr("Par la droite ▶") : tr("Au plus court")}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder={tr("Niveau (ex. 080 ou 4000)")}
            className={cn("h-8 rounded-md border bg-background px-2 font-mono text-xs outline-none", lvl === "bad" ? "border-red-500" : "border-border focus:border-[color:var(--sc-accent)]")} data-testid="vector-level" />
          <input value={speed} onChange={(e) => setSpeed(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder={tr("Vitesse kt (facultatif)")} inputMode="numeric"
            className={cn("h-8 rounded-md border bg-background px-2 font-mono text-xs outline-none", badSpd ? "border-red-500" : "border-border focus:border-[color:var(--sc-accent)]")} data-testid="vector-speed" />
        </div>
        <Button size="sm" className="w-full" disabled={m.isPending || lvl === "bad" || badSpd} onClick={give} data-testid="vector-give">
          <Compass className="h-3.5 w-3.5" />{" "}{tr("Donner le vecteur : cap {0}", [hdg3(hdg)])}
        </Button>
        {v && nxt != null && (
          <Button size="sm" variant="outline" className="w-full" disabled={m.isPending}
            onClick={() => m.mutate({ fn: () => apiPost<FlightDetail>(`/flights/${f.id}/nav`, { op: "direct", waypoint_index: nxt, version: f.version }), success: tr("Fin des vecteurs : direct {0}", [f.route[nxt].ident]) })}
            data-testid="vector-resume">
            <CornerUpRight className="h-3.5 w-3.5" />{" "}{tr("Reprendre la route : direct {0}", [f.route[nxt].ident])}
          </Button>
        )}
        <p className="text-[11px] text-muted-foreground">{tr("L'avion quitte sa route, vire au taux standard puis tient le cap ; niveau et vitesse sont facultatifs (vide = inchangé). Il rejoint sa route par un direct (choisi ci-dessous ou « Reprendre la route »).")}</p>
      </div>
    </div>
  );
}

/** Direct to a fix of the route and holding patterns — the controller in charge, or the pilot when uncontrolled. */
export default function NavPanel({ flight: f, ed }: { flight: FlightDetail; ed?: FlightEditing }) {
  const m = useFlightMutation(f.id);
  const [wp, setWp] = useState("");
  const [turns, setTurns] = useState<number>(2);
  const [holdTurn, setHoldTurn] = useState<"right" | "left">("right"); // racetrack: right turns = standard
  if (!f.can_nav) return null;
  const here = f.position.distance_nm;
  const ahead = f.route
    .map((w, i) => ({ w, i }))
    .filter(({ w, i }) => i > 0 && i < f.route.length - 1 && w.cum_nm > here + 0.5 && w.kind !== "apt" && w.kind !== "rwy" && w.ident !== "TOC" && w.ident !== "TOD");
  const send = (body: Record<string, unknown>, success: string) =>
    m.mutate({ fn: () => apiPost<FlightDetail>(`/flights/${f.id}/nav`, { version: f.version, ...body }), success });
  const h = f.holding;
  const tLabel = (n: number | null) => (n ? (n > 1 ? tr("{0} tours", [n]) : tr("1 tour")) : tr("jusqu'à nouvel ordre"));

  return (
    <div className="space-y-3" data-testid="nav-panel">
      {f.can_vector ? <VectorPanel flight={f} ed={ed} /> : f.vector && <VectorStatus v={f.vector} />}
      {h && (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs" data-testid="holding-status">
          <p className="flex items-center gap-1.5 font-semibold text-amber-100">
            <RotateCw className="h-3.5 w-3.5" />{" "}{tr("Hold sur")}{" "}{h.ident} · {tLabel(h.turns)}
          </p>
          <p className="text-amber-100/80">
            {!h.entered
              ? tr("En route vers le point du hold.")
              : h.exit
                ? tr("Sortie demandée : l'avion finit son tour et reprend la route en passant sur le point.")
                : tr(h.turn === "left" ? "Tour {0}{1} — hippodrome à gauche, axe {2}°, branches de {3} min." : "Tour {0}{1} — hippodrome à droite, axe {2}°, branches de {3} min.", [Math.min(h.laps_done + 1, h.turns ?? h.laps_done + 1), h.turns ? ` / ${h.turns}` : "", Math.round(h.inbound), h.leg_s / 60]) +
                  (h.turns ? " " + tr("Sortie automatique à la fin du tour {0}.", [h.turns]) : "")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {h.entered && !h.exit && (
              <Button size="xs" onClick={() => send({ op: "hold_exit" }, tr("Sortie du hold demandée"))} disabled={m.isPending} data-testid="hold-exit">{tr("Sortir du hold")}</Button>
            )}
            {h.entered && (
              <>
                <Button size="xs" variant="outline" disabled={m.isPending}
                  onClick={() => send({ op: "hold_continue", turns: (h.turns ?? h.laps_done) + 1 }, tr("Hold prolongé d'un tour"))} data-testid="hold-more">{tr("+1 tour")}</Button>
                <Button size="xs" variant="outline" disabled={m.isPending}
                  onClick={() => send({ op: "hold_continue" }, "Hold jusqu'à nouvel ordre")} data-testid="hold-forever">{tr("Jusqu'à nouvel ordre")}</Button>
              </>
            )}
            {!h.entered && (
              <Button size="xs" variant="outline" onClick={() => send({ op: "hold_cancel" }, tr("Hold annulé"))} disabled={m.isPending} data-testid="hold-cancel">{tr("Annuler le hold")}</Button>
            )}
          </div>
        </div>
      )}
      <div className="space-y-2">
        <select
          value={wp}
          onChange={(e) => setWp(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-xs"
          data-testid="nav-waypoint"
        >
          <option value="">{tr("Choisir un point de la route…")}</option>
          {ahead.map(({ w, i }) => (
            <option key={i} value={i}>
              {tr("{0} — dans {1} NM", [w.ident, (w.cum_nm - here).toFixed(0)])}</option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" disabled={wp === "" || m.isPending}
            onClick={() => send({ op: "direct", waypoint_index: Number(wp) }, tr("Direct {0}", [f.route[Number(wp)]?.ident]))} data-testid="nav-direct">
            <CornerUpRight className="h-3.5 w-3.5" />{" "}{tr("Direct")}</Button>
          {!h && !f.vector && (
            <>
              <select value={turns} onChange={(e) => setTurns(Number(e.target.value))}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs" data-testid="nav-turns">
                {TURN_CHOICES.map((n) => <option key={n} value={n}>{tLabel(n || null)}</option>)}
              </select>
              <select value={holdTurn} onChange={(e) => setHoldTurn(e.target.value as "right" | "left")}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs" data-testid="nav-hold-turn" title={tr("Sens des virages du hold")}>
                <option value="right">{tr("Virages à droite")}</option>
                <option value="left">{tr("Virages à gauche")}</option>
              </select>
              <Button size="sm" variant="outline" disabled={wp === "" || m.isPending}
                onClick={() => send({ op: "hold", waypoint_index: Number(wp), turn: holdTurn, ...(turns ? { turns } : {}) }, tr("Hold sur {0}", [f.route[Number(wp)]?.ident]))}
                data-testid="nav-hold">
                <RotateCw className="h-3.5 w-3.5" />{" "}{tr("Hold")}</Button>
            </>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{tr("Hold : hippodrome (virages à droite en standard, ou à gauche si la procédure le demande ; branches d'1 min sous le FL140). L'avion sort tout seul à la fin des tours prévus ; « Sortir du hold » le fait sortir plus tôt, à la fin du tour en cours.")}</p>
      </div>
    </div>
  );
}
