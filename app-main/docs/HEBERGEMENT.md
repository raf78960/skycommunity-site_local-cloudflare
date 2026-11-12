# Hébergement M-Heberge — site + bot sur le même réseau local

## Qui parle à qui
```
Navigateur ──HTTPS──► nginx (443) ──► backend site  :8001 ──► MongoDB :27017 (local, jamais public)
                                          │   ▲
   DISCORD_BOT_API_URL  (site → bot)      │   │  SITE_API_URL  (bot → site, toutes les 30 s)
                                          ▼   │
                                      API du bot :8080  ◄──►  Discord
```
- **bot → site** : lit `/api/bot/outbox` (messages à publier), confirme, décide des annulations de pré-ouverture, crée les comptes ATC.
- **site → bot** : ouvre / ferme les fréquences (salons vocaux) quand un ATC prend une position.
- Les deux appels utilisent **le même secret** : `BOT_API_SECRET` (identique dans les deux `.env`).

## Deux montages possibles
| | A. Même machine (le plus simple) | B. Deux machines, même réseau privé |
|---|---|---|
| Backend site écoute | `127.0.0.1:8001` | IP privée du site, ex. `10.0.0.11:8001` |
| API du bot écoute (`BOT_API_HOST`) | `127.0.0.1` | IP privée du bot, ex. `10.0.0.12` |
| `SITE_API_URL` (.env du bot) | `http://127.0.0.1:8001/api` | `http://10.0.0.11:8001/api` |
| `DISCORD_BOT_API_URL` (.env du site) | `http://127.0.0.1:8080` | `http://10.0.0.12:8080` |
| Pare-feu | 80/443 seulement | + 8001 ouvert **uniquement** à l'IP du bot, 8080 **uniquement** à l'IP du site |

En B, si nginx n'est pas sur la même machine que le backend : `TRUST_PROXY=true` dans `backend/.env`.
Ne jamais mettre `0.0.0.0` sans pare-feu, et ne jamais exposer 8001 / 8080 / 27017 sur Internet.

## Installation (Linux, exemple Ubuntu/Debian)
**Site** (`/srv/skycommunity/app`)
1. `apt install python3-venv nginx certbot python3-certbot-nginx` + MongoDB 6+ (bindIp 127.0.0.1, authentification activée).
2. `cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
3. `cp backend/.env.example backend/.env` → remplir (JWT_SECRET, APP_URL, Discord, BOT_API_SECRET, DISCORD_BOT_API_URL).
4. `.venv/bin/python seed.py` (index) · `cd ../frontend && npm ci && npm run build` → `frontend/dist`.
5. Copier `deploy/skyradar-backend.service` dans `/etc/systemd/system/`, puis `systemctl enable --now skyradar-backend`.
6. Copier `deploy/nginx-skyradar.conf`, remplacer le domaine, `certbot --nginx`, `systemctl reload nginx`.
7. Discord Developer Portal → OAuth2 → Redirect : `https://<domaine>/api/auth/discord/callback`.

**Bot** (`/srv/skycommunity/SkyBot`)
1. `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` (+ `apt install ffmpeg` pour l'ATIS vocal).
2. `cp .env.example .env` → remplir (même `BOT_API_SECRET` que le site, `SITE_API_URL`, `BOT_API_HOST`).
3. Copier `deploy/skybot.service`, puis `systemctl enable --now skybot`.
4. Portail Discord : activer **Server Members Intent** et **Message Content Intent**.

## Vérifier la liaison
```bash
backend/../deploy/check-liaison.sh http://IP_SITE:8001/api http://IP_BOT:8080 "<BOT_API_SECRET>"
```
Les 5 lignes doivent afficher `[OK]`. Ensuite, côté site, créer une pré-ouverture ATC : le message doit apparaître dans le salon d'annonces en moins de 30 s.

## Pièges rencontrés dans les fichiers reçus
- Les deux `.env` avaient **deux secrets différents** (`BOT_API_SECRET` ≠ `SITE_API_SECRET`). Le code accepte maintenant un seul secret (`BOT_API_SECRET`) des deux côtés.
- `DISCORD_BOT_TOKEN` du site doit être le **même jeton** que `DISCORD_TOKEN` du bot.
- `SITE_API_URL` doit finir par `/api` ; `DISCORD_BOT_API_URL` ne doit **pas** finir par `/api`.
- Une seule instance du backend (`--workers 1`) : le moteur de progression tourne dans le processus.
- Sauvegardes : `backend/scripts/backup.sh` (cron) pour MongoDB, et copier `training_bot.db` (SQLite du bot) régulièrement.
