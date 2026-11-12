#!/usr/bin/env bash
# Teste la liaison site <-> bot. Usage : deploy/check-liaison.sh <URL_SITE_API> <URL_BOT_API> <BOT_API_SECRET>
# Ex. (même machine) : deploy/check-liaison.sh http://127.0.0.1:8001/api http://127.0.0.1:8080 "$SECRET"
set -u
SITE="${1:?URL site (finit par /api)}"; BOT="${2:?URL bot}"; SECRET="${3:?secret}"
ok(){ echo "  [OK]  $*"; }; ko(){ echo "  [KO]  $*"; }
code(){ curl -s -o /dev/null -m 8 -w '%{http_code}' "$@" || true; }

echo "1. Site -> sante";             [ "$(code "$SITE/health")" = 200 ] && ok "backend du site repond" || ko "backend du site injoignable ($SITE)"
echo "2. Bot -> sante";              [ "$(code "$BOT/health")" = 200 ]  && ok "API du bot repond"      || ko "API du bot injoignable ($BOT)"
echo "3. Bot lit l'outbox du site";  c=$(code -H "Authorization: Bearer $SECRET" "$SITE/bot/outbox?limit=1")
  case $c in 200) ok "secret accepte par le site";; 401) ko "secret refuse (BOT_API_SECRET different du site)";; *) ko "HTTP $c";; esac
echo "4. Site appelle le bot";       c=$(code -H "X-Bot-Secret: $SECRET" "$BOT/api/frequencies")
  case $c in 200) ok "secret accepte par le bot";; 401) ko "secret refuse (different cote bot)";; *) ko "HTTP $c";; esac
echo "5. Secret invalide rejete";    [ "$(code -H "Authorization: Bearer faux" "$SITE/bot/outbox")" = 401 ] && ok "401 sans bon secret" || ko "l'outbox n'est pas protegee !"
