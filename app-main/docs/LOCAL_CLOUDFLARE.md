# Héberger en local (ton PC) avec Cloudflare Tunnel

Tout tourne sur ta machine ; Cloudflare publie le site en HTTPS **sans ouvrir de port sur ta box**.
Le bot et le site se parlent en `127.0.0.1` : l'API du bot (8080) et MongoDB (27017) ne sont jamais exposés.

```
Internet ─HTTPS─► Cloudflare ─tunnel─► cloudflared ─► backend+site 127.0.0.1:8001 ─► MongoDB 127.0.0.1:27017
                                                          ▲ │
                                          bot (127.0.0.1:8080) ◄─► Discord
```
Un seul port est exposé : **8001**. Le backend sert aussi le site compilé (`frontend/dist`), donc pas de nginx.

## 1. Prérequis (Windows)
- Python 3.11+, Node 20+, MongoDB Community (installé comme service Windows), `winget install Cloudflare.cloudflared`.
- Un compte Cloudflare **et un nom de domaine ajouté à Cloudflare** (sans domaine, seul le tunnel « rapide » existe :
  adresse `xxxx.trycloudflare.com` différente à chaque lancement → la connexion Discord ne marche pas de façon durable).

## 2. Configuration
1. `backend\.env` (copie de `.env.example`) :
   ```
   MONGO_URL=mongodb://127.0.0.1:27017
   DB_NAME=skycommunity
   JWT_SECRET=<48+ caractères aléatoires>
   APP_URL=https://radar.exemple.fr
   COOKIE_SECURE=true
   DISCORD_CLIENT_ID=…  DISCORD_CLIENT_SECRET=…  DISCORD_BOT_TOKEN=<= DISCORD_TOKEN du bot>
   BOT_API_SECRET=<même valeur que dans le .env du bot>
   DISCORD_BOT_API_URL=http://127.0.0.1:8080
   ```
   (ne PAS mettre `ALLOW_TEST_LOGIN`)
2. `.env` du bot : `SITE_API_URL=http://127.0.0.1:8001/api`, `BOT_API_HOST=127.0.0.1`, `BOT_API_SECRET` identique.
3. Backend : `cd backend && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt && .venv\Scripts\python seed.py`
4. Bot : `pip install -r requirements.txt` (dans `C:\SkyBot`, ou définis la variable `SKYBOT_DIR`).
5. Discord Developer Portal → OAuth2 → Redirect : `https://radar.exemple.fr/api/auth/discord/callback`.

## 3. Créer le tunnel (une seule fois)
```
cloudflared tunnel login
cloudflared tunnel create skyradar
cloudflared tunnel route dns skyradar radar.exemple.fr
```
Copie `deploy\cloudflared-config.example.yml` en `deploy\cloudflared-config.yml` et renseigne l'ID du tunnel,
le chemin du `.json` généré et ton domaine.

## 4. Lancer
Double-clic sur **`start-prod.bat`** : MongoDB → build du site (1re fois ; `start-prod.bat -rebuild` après une mise à jour du code)
→ backend → bot → tunnel. Ouvre ensuite `https://radar.exemple.fr`.
Vérification de la liaison : `deploy/check-liaison.sh http://127.0.0.1:8001/api http://127.0.0.1:8080 <BOT_API_SECRET>` (Git Bash / WSL).

## 5. À savoir
- Le site n'est en ligne **que si le PC est allumé** et les fenêtres ouvertes ; coupure internet = site coupé.
- Dans Cloudflare : SSL/TLS en mode « Full », laisse « Always use HTTPS » activé ; désactive Rocket Loader / minification automatique (CSP stricte).
- Les protections du site (limites par IP, anti-raid, CSRF) fonctionnent derrière Cloudflare : l'IP réelle vient de `X-Forwarded-For`.
- Sauvegardes : `mongodump --db skycommunity --archive=backup.gz --gzip` régulièrement + copie de `training_bot.db` du bot.
- Migration vers M-Heberge plus tard : `docs/HEBERGEMENT.md` (mêmes variables, il suffit de changer les URL).
