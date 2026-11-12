"""API for the SkyCommunity Discord bot: read the messages to post, confirm them. Authenticated by BOT_API_SECRET
(header « Authorization: Bearer <secret> »), never by a member session. Disabled while the secret is not set."""

import hmac
import os

from fastapi import APIRouter, HTTPException, Query, Request

from lib.db import db
from lib.engine import aware, utcnow

router = APIRouter(prefix="/bot", tags=["bot"])


def _check(request: Request) -> None:
    secret = os.environ.get("BOT_API_SECRET", "")
    auth = request.headers.get("authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if len(secret) < 24 or not token or not hmac.compare_digest(token.encode(), secret.encode()):
        raise HTTPException(401, "Unauthorized")


@router.get("/outbox")
async def outbox(request: Request, limit: int = Query(50, ge=1, le=200)):
    _check(request)
    docs = await db.bot_outbox.find({"sent_at": None}, {"_id": 0}).sort("created_at", 1).to_list(limit)
    return [{**d, "created_at": aware(d["created_at"])} for d in docs]


@router.post("/outbox/{message_id}/done")
async def done(message_id: str, request: Request):
    _check(request)
    res = await db.bot_outbox.update_one({"id": message_id, "sent_at": None}, {"$set": {"sent_at": utcnow()}})
    return {"ok": True, "updated": res.modified_count}


@router.post("/preopenings/{pre_id}/cancel-decision")
async def bot_cancel_decision(pre_id: str, request: Request):
    """Le bot Discord valide/refuse une demande d'annulation de pré-ouverture (boutons staff)."""
    from pydantic import BaseModel, Field
    from typing import Literal
    from lib.bot import handled, notify
    from lib.events import log_event
    from routers.atc import _cancel, _lead_actor, _pending

    class Body(BaseModel):
        decision: Literal["accept", "refuse"]
        staff_name: str = Field(default="Staff Discord", max_length=80)
        comment: str | None = Field(default=None, max_length=300)

    _check(request)
    data = Body(**(await request.json()))
    d = await _pending(pre_id)
    req = d.get("cancel_request")
    if not req:
        raise HTTPException(409, "Aucune demande d'annulation en attente.")
    actor = {"id": "discord-bot", "display_name": data.staff_name, "role": "admin"}
    when = aware(d["start_at"]).strftime("%d/%m à %H:%M")
    owner = await db.users.find_one({"id": d["user_id"]}, {"_id": 0, "discord_id": 1})
    comment = (data.comment or "").strip() or None
    if data.decision == "accept":
        await _cancel({**d}, actor, req.get("reason") or "Acceptée via Discord", "Annulation de pré-ouverture acceptée")
        dm = (f"✅ Ta demande d'annulation de la pré-ouverture {d['callsign']} du {when} UTC "
              f"a été acceptée par {data.staff_name}.")
        status = "annulee"
    else:
        await db.preopenings.update_one({"id": pre_id}, {"$unset": {"cancel_request": ""}})
        await log_event(
            "atc",
            "Annulation de pré-ouverture refusée",
            actor,
            None,
            f"{d['callsign']} du {when} UTC — refusée par {data.staff_name}"
            + (f" : {comment}" if comment else ""),
            scope="atc",
        )
        dm = (f"⛔ Ta demande d'annulation de la pré-ouverture {d['callsign']} du {when} UTC "
              f"a été refusée par {data.staff_name}"
              + (f" : {comment}" if comment else ".")
              + " La position reste prévue.")
        status = "prevue"
    await notify(
        f"preouverture_annulation_{data.decision}",
        "membre",
        dm,
        {"id": pre_id},
        (owner or {}).get("discord_id"),
    )
    await handled(
        req.get("alert_id"),
        "validation_atc",
        f"{'✅' if data.decision == 'accept' else '⛔'} Traitée par {data.staff_name} : "
        f"annulation de {d['callsign']} du {when} UTC "
        f"{'acceptée' if data.decision == 'accept' else 'refusée'}.",
    )
    return {"ok": True, "status": status, "callsign": d["callsign"]}


@router.post("/frequencies/{freq_id}/closed")
async def bot_frequency_closed(freq_id: int, request: Request):
    """La fréquence a été fermée côté Discord (panel admin, bouton Fermer, commande…) : on libère la position
    ATC correspondante sur le site. Idempotent : sans position liée (fréquence ouverte depuis Discord, ou déjà
    fermée par le site), il ne se passe rien."""
    from lib.handover import close_positions

    _check(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    staff = str((body or {}).get("closed_by_name") or "Staff Discord")[:80]
    docs = await db.atc_positions.find({"discord_freq_id": freq_id}, {"_id": 0}).to_list(10)
    # Le salon Discord est déjà supprimé : on retire le lien pour que le site ne redemande pas au bot de le fermer.
    docs = [{**d, "discord_freq_id": None} for d in docs]
    actor = {"id": "discord-bot", "display_name": staff, "role": "admin"}
    await close_positions(docs, "fermeture", actor)
    return {"ok": True, "closed": [d["callsign"] for d in docs]}