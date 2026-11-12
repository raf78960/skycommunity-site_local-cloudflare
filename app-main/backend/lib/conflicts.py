"""Un membre ne peut pas être pilote en vol ET contrôleur en même temps.

- vol actif (phase dans ACTIVE)         -> pas d'accès ATC (mode ATC, ouverture de position)
- position ATC ouverte (heartbeat < 10 min) -> pas d'accès Pilote (mode Pilote, création de vol)

Règle appliquée côté serveur (jamais seulement dans le navigateur), y compris pour les administrateurs sur les
actions (ouvrir une position / créer un vol).
"""

from datetime import timedelta

from fastapi import HTTPException

from lib.control import ONLINE_S
from lib.db import db
from lib.engine import ACTIVE, utcnow


async def open_positions_of(user_id: str) -> list[dict]:
    since = utcnow() - timedelta(seconds=ONLINE_S)
    return await db.atc_positions.find({"user_id": user_id, "last_seen": {"$gte": since}}, {"_id": 0}).to_list(10)


async def active_flight_of(user_id: str) -> dict | None:
    return await db.flights.find_one({"pilot_id": user_id, "phase": {"$in": ACTIVE}}, {"_id": 0, "callsign": 1})


def _atc_msg(f: dict) -> str:
    return (f"Vous avez un vol actif ({f['callsign']}) : l'accès ATC est indisponible tant qu'il n'est pas "
            "terminé ou annulé.")


def _pilot_msg(positions: list[dict]) -> str:
    return ("Vous contrôlez actuellement (" + ", ".join(p["callsign"] for p in positions) + ") : l'accès Pilote est "
            "indisponible tant que vous n'avez pas fermé votre position ATC.")


async def mode_lock(user: dict) -> dict[str, str | None]:
    """Raison (français) pour laquelle chaque mode est verrouillé, ou None s'il est libre."""
    f = await active_flight_of(user["id"])
    pos = await open_positions_of(user["id"])
    return {"atc": _atc_msg(f) if f else None, "pilote": _pilot_msg(pos) if pos else None}


async def ensure_not_flying(user: dict) -> None:
    f = await active_flight_of(user["id"])
    if f:
        raise HTTPException(409, _atc_msg(f))


async def ensure_not_controlling(user: dict) -> None:
    pos = await open_positions_of(user["id"])
    if pos:
        raise HTTPException(409, _pilot_msg(pos))