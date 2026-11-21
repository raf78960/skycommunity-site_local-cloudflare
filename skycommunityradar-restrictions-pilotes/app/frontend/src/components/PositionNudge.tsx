import { useState } from "react";
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Crosshair, SkipBack, SkipForward } from "lucide-react";
import { apiPost } from "@/lib/api";
import { useFlightMutation } from "@/lib/hooks";
import type { FlightDetail } from "@/lib/types";
import { fmtMeters } from "@/lib/phases";

import { tr } from "@/lib/i18n";
/** Move the aircraft back/forward along its current track (taxi or route). Owner pilot or ATC/admin. */
export default function PositionNudge({ flight: f }: { flight: FlightDetail }) {
  const m = useFlightMutation(f.id);
  // recalage « l'avion est à X NM avant / après tel point de sa route »
  const [fromIdx, setFromIdx] = useState<string>("");
  const [fromNm, setFromNm] = useState<string>("");
  const [after, setAfter] = useState(false);
  const track = f.position.track;
  if (!track || f.position.total_nm <= 0) return null;
  const air = track === "air";
  // take-off: steps in metres and no jump to the next point (5 NM would skip the whole climb to « en route »)
  const takeoff = f.phase === "decollage";
  const inHold = air && !!f.holding?.entered;
  const inVector = air && !!f.vector;
  // on the ground the steps are round distances in metres (40 m / 200 m), not 0.02 NM = 37 m
  const M = 1 / 1852;
  const small = takeoff ? 200 * M : air ? 5 : 40 * M;
  const big = takeoff ? 1 : air ? 25 : 200 * M;
  const locked = f.pilot_moves_left === 0;
  const send = (body: { delta_nm?: number; waypoint?: "prev" | "next"; from_index?: number; from_nm?: number }, success?: string) =>
    m.mutate({ fn: () => apiPost<FlightDetail>(`/flights/${f.id}/nudge`, { ...body, version: f.version }), ...(success ? { success } : {}) });
  const nm = Number(fromNm.replace(",", "."));
  const nmOk = fromNm.trim() !== "" && Number.isFinite(nm) && nm >= 0 && nm <= 500;
  const canFix = air && !takeoff && !inVector && !inHold;
  const fixPoint = fromIdx === "" ? null : f.route[Number(fromIdx)];
  const recaler = () => {
    if (!fixPoint || !nmOk) return;
    send({ from_index: Number(fromIdx), from_nm: after ? nm : -nm },
      nm === 0 ? tr("Avion recalé sur {0}", [fixPoint.ident]) : tr("Avion recalé à {0} NM {1} {2}", [nm, after ? tr("après") : tr("avant"), fixPoint.ident]));
  };
  const fmt = (v: number) => (air && v >= 1 ? `${v} NM` : fmtMeters(v));
  const seg = "flex h-8 flex-1 items-center justify-center gap-1 whitespace-nowrap px-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50";
  return (
    <div className="space-y-1.5" data-testid="position-nudge">
      <div className="text-[11px] text-muted-foreground">{takeoff ? tr("Au décollage") : inVector ? tr("En vecteurs") : inHold ? tr("Dans le hold") : air ? tr("Sur la route") : tr("Sur le roulage")}</div>
      {f.pilot_moves_left != null && (
        <div className={`text-[11px] ${locked ? "font-semibold text-destructive" : "text-muted-foreground"}`} data-testid="pilot-moves-left">
          {locked
            ? tr("Déplacements épuisés : prochain possible dans {n} min", { n: f.pilot_moves_wait_min })
            : tr("Déplacements restants : {n}", { n: f.pilot_moves_left })}
        </div>
      )}
      <div className="flex divide-x divide-border overflow-hidden rounded-lg border border-border bg-background/40">
        {air && !takeoff && !inVector && (
          <button className={seg} disabled={m.isPending || locked} onClick={() => send({ waypoint: "prev" })} data-testid="nudge-prev-wp" title={inHold ? tr("Tour précédent") : tr("Point préc.")}>
            <SkipBack className="h-3 w-3" />
          </button>
        )}
        <button className={seg} disabled={m.isPending || locked} onClick={() => send({ delta_nm: -big })} data-testid="nudge-back-big" title={`-${fmt(big)}`}>
          <ChevronsLeft className="h-3 w-3" /> {fmt(big)}
        </button>
        <button className={seg} disabled={m.isPending || locked} onClick={() => send({ delta_nm: -small })} data-testid="nudge-back" title={`-${fmt(small)}`}>
          <ChevronLeft className="h-3 w-3" /> {fmt(small)}
        </button>
        <button className={seg} disabled={m.isPending || locked} onClick={() => send({ delta_nm: small })} data-testid="nudge-forward" title={`+${fmt(small)}`}>
          {fmt(small)} <ChevronRight className="h-3 w-3" />
        </button>
        <button className={seg} disabled={m.isPending || locked} onClick={() => send({ delta_nm: big })} data-testid="nudge-forward-big" title={`+${fmt(big)}`}>
          {fmt(big)} <ChevronsRight className="h-3 w-3" />
        </button>
        {air && !takeoff && (
          <button className={seg} disabled={m.isPending || locked} onClick={() => send({ waypoint: "next" })} data-testid="nudge-next-wp" title={inVector ? tr("Reprendre la route : direct vers le point suivant") : inHold ? tr("Quitter le hold : direct vers le point suivant") : tr("Point suiv.")}>
            <SkipForward className="h-3 w-3" />
          </button>
        )}
      </div>
      {canFix && (
        <div className="space-y-1.5 rounded-lg border border-border bg-background/40 p-2" data-testid="position-fix">
          <div className="text-[11px] font-semibold text-muted-foreground">{tr("Recaler depuis un point de la route")}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="number" inputMode="decimal" min={0} max={500} step={0.5}
              value={fromNm} onChange={(e) => setFromNm(e.target.value)} placeholder="NM"
              className="h-8 w-16 rounded-md border border-border bg-background px-2 font-mono text-xs"
              data-testid="position-fix-nm" aria-label={tr("Distance en NM")}
            />
            <div className="flex overflow-hidden rounded-md border border-border text-[11px] font-semibold" role="radiogroup">
              {([false, true] as const).map((a) => (
                <button key={String(a)} type="button" role="radio" aria-checked={after === a} onClick={() => setAfter(a)}
                  className={`h-8 px-2 ${after === a ? "bg-[color:var(--sc-primary)] text-white" : "text-muted-foreground hover:bg-secondary"}`}
                  data-testid={`position-fix-${a ? "after" : "before"}`}>
                  {a ? tr("après") : tr("avant")}
                </button>
              ))}
            </div>
            <select value={fromIdx} onChange={(e) => setFromIdx(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs" data-testid="position-fix-point">
              <option value="">{tr("Point…")}</option>
              {f.route.map((w, i) => (w.ident ? <option key={i} value={i}>{w.ident}</option> : null))}
            </select>
            <button type="button" onClick={recaler} disabled={!fixPoint || !nmOk || m.isPending || locked}
              className="flex h-8 items-center gap-1 rounded-md bg-[color:var(--sc-primary)] px-2.5 text-[11px] font-semibold text-white hover:bg-[color:var(--sc-primary-hover)] disabled:opacity-50"
              data-testid="position-fix-go">
              <Crosshair className="h-3 w-3" /> {tr("Recaler")}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">{tr("Ex. : 12 NM avant LUL. 0 NM = sur le point. L'avion continue sa route depuis là.")}</p>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">{inVector ? tr("En vecteurs, l'avion avance ou recule le long de son cap ; ⏭ lui fait reprendre sa route, en direct vers le point suivant.") : inHold ? tr("Reculer ou avancer l'avion dans le hold (⏮ : tour précédent). Il sort à la fin des tours prévus ; ⏭ le fait partir tout de suite, en direct vers le point suivant.") : air ? tr("Reculer ou avancer l'avion sur sa route (⏮ ⏭ : point précédent / suivant).") : tr("Reculer ou avancer l'avion sur son roulage.")}</p>
    </div>
  );
}
