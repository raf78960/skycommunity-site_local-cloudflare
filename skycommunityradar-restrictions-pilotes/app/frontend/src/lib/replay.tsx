import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import type { User } from "@/lib/types";
import { tr } from "@/lib/i18n";

/** Responsables (ATC / pilotes) and administrators: they can replay every flight. Same rule as the server (lib/tracks). */
export const isStaff = (u?: User | null) => !!u && !!(u.access?.admin || u.access?.creator || u.access?.atc_lead || u.access?.pilot_lead);

/** The pilot of the flight, the responsables and the administrators — not the other members. */
export const canReplay = (u: User | null | undefined, pilotId: string) => !!u && (u.id === pilotId || isStaff(u));

export function ReplayLink({ flightId, label = false }: { flightId: string; label?: boolean }) {
  return (
    <Link
      to={`/flights/${flightId}/replay`}
      title={tr("Revoir le vol (replay)")}
      className="inline-flex items-center gap-1 rounded-md border border-[color:var(--sc-accent)]/40 px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--sc-accent)] hover:bg-[color:var(--sc-primary)]/15"
      data-testid={`replay-link-${flightId}`}
    >
      <Play className="h-3 w-3" />
      {label && tr("Replay")}
    </Link>
  );
}
