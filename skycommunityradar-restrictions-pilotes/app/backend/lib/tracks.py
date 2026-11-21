"""Flight tracks for the replay: the position of every active flight is recorded every 10 s by the engine tick.

Positions are otherwise computed on the fly from timestamps and the (changing) route, so a finished flight cannot be
re-flown from its route alone (directs, vectors, holds, go-arounds rewrite it): this record is what the replay reads.
About 360 small documents per hour of flight; they are deleted with the flight (routers.common.delete_flights_data).
"""

from datetime import datetime

from lib.db import db
from lib.discord_roles import access_of
from lib.engine import ACTIVE, compute_position

SAMPLE_S = 10.0  # one point every 10 s while the aircraft moves
IDLE_S = 60.0  # and at least one per minute while it stands still (the timeline keeps going)

# flight_id -> (time, lat, lon, phase) of the last point written; single backend instance (see DEPLOIEMENT.md)
_last: dict[str, tuple[float, float, float, str]] = {}


async def record_tracks(now: datetime) -> None:
    t = now.timestamp()
    seen: set[str] = set()
    async for f in db.flights.find({"phase": {"$in": list(ACTIVE)}}, {"_id": 0}):
        fid = f["id"]
        seen.add(fid)
        last = _last.get(fid)
        if last and t - last[0] < SAMPLE_S:
            continue
        pos = compute_position(f, now)
        lat, lon = pos.get("lat"), pos.get("lon")
        if lat is None or lon is None:
            continue
        moved = not last or abs(lat - last[1]) > 1e-6 or abs(lon - last[2]) > 1e-6 or f["phase"] != last[3]
        if last and not moved and t - last[0] < IDLE_S:
            continue
        await db.flight_tracks.insert_one({
            "flight_id": fid, "t": now, "lat": round(lat, 6), "lon": round(lon, 6),
            "alt": round(float(pos.get("alt_ft") or 0)), "hdg": round(float(pos.get("heading") or 0)),
            "phase": f["phase"], "ground": bool(pos.get("on_ground")),
        })
        _last[fid] = (t, lat, lon, f["phase"])
    for fid in [k for k in _last if k not in seen]:  # finished / cancelled flights
        _last.pop(fid, None)


def is_staff(user: dict) -> bool:
    a = access_of(user)
    return bool(a["admin"] or a["creator"] or a["atc_lead"] or a["pilot_lead"])


def can_replay(user: dict, f: dict) -> bool:
    """The pilot of the flight, the responsables (ATC / pilotes) and the administrators — not the other members."""
    return f.get("pilot_id") == user["id"] or is_staff(user)
