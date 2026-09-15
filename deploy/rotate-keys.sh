#!/bin/bash
# Replace the server's Tencent and/or TokenHub key without the values passing through a chat, a clipboard history
# or a command line. It asks for each new value here (the secret halves stay hidden, and each is confirmed with its
# length so a paste can be seen to have arrived), checks every new key against Tencent and TokenHub BEFORE anything is
# written, then rewrites deploy/.env, restarts the app and confirms it is running on the new keys. Leave an answer
# blank to keep that key. The previous file stays as deploy/.env.old until the old keys have been deleted.
#
#   ssh -t subtitle-hk bash rotate-keys.sh
set -euo pipefail
ENV_FILE="${ENV_FILE:-$HOME/SeeSubtitles/deploy/.env}"
RESTART="${RESTART:-1}"
APP="${APP:-deploy-app-1}"

# A paste can bring along a line ending, spaces, or a terminal's paste markers (ESC[200~ … ESC[201~); none belong in a key.
clean() { printf '%s' "$1" | sed -e $'s/\e\\[20[01]~//g' | tr -d '[:cntrl:][:space:]'; }
fp() { printf '%s' "$1" | sha256sum | cut -c1-12; }

# ask VAR PROMPT HIDDEN PATTERN SHAPE — re-asks until the answer is blank or has the shape of that kind of key
ask() {
  local name=$1 prompt=$2 hidden=$3 pattern=$4 shape=$5 value
  while true; do
    if [ "$hidden" = 1 ]; then read -r -s -p "$prompt" value; echo; else read -r -p "$prompt" value; fi
    value=$(clean "$value")
    if [ -z "$value" ]; then echo "   · blank — keeping the current one"; break; fi
    if [[ "$value" =~ $pattern ]]; then echo "   ✔ received ${#value} characters"; break; fi
    echo "   ✖ that does not look like $shape (${#value} characters arrived) — paste it again, or press Enter to keep the current one"
  done
  printf -v "$name" '%s' "$value"
}

echo "What you paste into a hidden prompt does not appear on screen. Paste, press Enter, and the length it received is shown."
ask ID  "New Tencent SecretId: "                  0 '^AKID[A-Za-z0-9]{20,}$'  'a Tencent SecretId (AKID…)'
ask KEY "New Tencent SecretKey (hidden): "        1 '^[A-Za-z0-9]{20,}$'      'a Tencent SecretKey'
ask TH  "New TokenHub API key (hidden): "         1 '^[A-Za-z0-9._-]{20,}$'   'a TokenHub API key'
if [ -z "$ID$KEY$TH" ]; then echo "nothing to change"; exit 0; fi
if { [ -n "$ID" ] && [ -z "$KEY" ]; } || { [ -z "$ID" ] && [ -n "$KEY" ]; }; then
  echo "✖ a Tencent key is a pair: give both the SecretId and the SecretKey, or neither. Nothing was changed." >&2; exit 1
fi

# ---- try the new keys for real before they go anywhere near the running service
VERIFY=$(cat <<'JS'
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const { call } = require('/app/server/lib/tc3');
const tokenhub = require('/app/server/lib/tokenhub');
const hide = (m) => [input.id, input.key, input.tokenhub].filter(Boolean).reduce((s, v) => s.split(v).join('…'), String(m)).slice(0, 180);
const done = (o) => { console.log(JSON.stringify(o)); process.exit(o.ok ? 0 : 1); };
(async () => {
  const out = { ok: true };
  if (input.id) {
    const who = (secretId, secretKey) => call({ secretId, secretKey }, { service: 'sts', version: '2018-08-13', action: 'GetCallerIdentity', payload: {}, region: 'ap-guangzhou' });
    let fresh;
    try { fresh = await who(input.id, input.key); } catch (e) { return done({ ok: false, why: `Tencent refused the new key pair: ${hide(e.message)}` }); }
    let current = null;
    try { current = await who(process.env.TENCENT_SECRET_ID, process.env.TENCENT_SECRET_KEY); } catch { /* the old key may already be gone */ }
    if (current && fresh.UserId !== current.UserId) {
      return done({ ok: false, why: `the new key belongs to user ${fresh.UserId}, but the server's key belongs to user ${current.UserId} — create it on that user (账号ID ${current.UserId}) instead` });
    }
    // A made-up task id is answered "no such task" by a key that may use speech recognition, and AuthFailure by one that may not.
    try { await call({ secretId: input.id, secretKey: input.key }, { service: 'asr', version: '2019-06-14', action: 'DescribeTaskStatus', payload: { TaskId: 1 } }); }
    catch (e) { if (!/NoSuchTask/.test(e.message)) return done({ ok: false, why: `the new Tencent key may not use speech recognition: ${hide(e.message)}` }); }
    out.tencent = `belongs to user ${fresh.UserId}, speech recognition allowed`;
  }
  if (input.tokenhub) {
    try {
      const text = await tokenhub.translate(input.tokenhub, { text: '今日天气好好。', source: 'yue', target: 'zh' }, { timeoutMs: 30000 });
      if (!text) throw new Error('an empty translation came back');
      out.tokenhub = 'a test translation came back';
    } catch (e) { return done({ ok: false, why: `TokenHub refused the new key: ${hide(e.message)}` }); }
  }
  done(out);
})().catch((e) => done({ ok: false, why: hide(e.message) }));
JS
)
echo "Checking the new keys with Tencent and TokenHub…"
RESULT=$(printf '{"id":"%s","key":"%s","tokenhub":"%s"}' "$ID" "$KEY" "$TH" | docker exec -i "$APP" node -e "$VERIFY" 2>&1) || true
case "$RESULT" in
  *'"ok":true'*) ;;
  *) echo "✖ $(printf '%s' "$RESULT" | sed -n 's/.*"why":"\(.*\)"}.*/\1/p' | head -1)${RESULT:+}" >&2
     [ -z "$(printf '%s' "$RESULT" | sed -n 's/.*"why":"\(.*\)"}.*/\1/p')" ] && echo "✖ the check could not run: $(printf '%s' "$RESULT" | tail -1 | cut -c1-160)" >&2
     echo "Nothing was changed." >&2; exit 1 ;;
esac
[ -n "$ID" ] && echo "   ✔ Tencent: $(printf '%s' "$RESULT" | sed -n 's/.*"tencent":"\([^"]*\)".*/\1/p')"
[ -n "$TH" ] && echo "   ✔ TokenHub: $(printf '%s' "$RESULT" | sed -n 's/.*"tokenhub":"\([^"]*\)".*/\1/p')"

# ---- write
cp -p "$ENV_FILE" "$ENV_FILE.old"
umask 077
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    TENCENT_SECRET_ID=*)  if [ -n "$ID" ];  then printf '%s\n' "TENCENT_SECRET_ID=$ID";  else printf '%s\n' "$line"; fi ;;
    TENCENT_SECRET_KEY=*) if [ -n "$KEY" ]; then printf '%s\n' "TENCENT_SECRET_KEY=$KEY"; else printf '%s\n' "$line"; fi ;;
    TOKENHUB_API_KEY=*)   if [ -n "$TH" ];  then printf '%s\n' "TOKENHUB_API_KEY=$TH";   else printf '%s\n' "$line"; fi ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$ENV_FILE.old" > "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "✔ deploy/.env updated (the previous one is kept as deploy/.env.old)"
[ "$RESTART" = 1 ] || exit 0

# ---- restart on the new keys, and prove the app is really running on them
echo "Restarting the app (a few seconds)…"
cd "$HOME/SeeSubtitles" && sudo docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --force-recreate app >/dev/null 2>&1
for i in $(seq 1 30); do curl -sf -o /dev/null https://seesubtitles.com/healthz && break; sleep 2; done
if ! curl -sf -o /dev/null https://seesubtitles.com/healthz; then
  echo "✖ the server did not answer after the restart. Put the old keys back with:" >&2
  echo "  mv ~/SeeSubtitles/deploy/.env.old ~/SeeSubtitles/deploy/.env && cd ~/SeeSubtitles && sudo docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --force-recreate app" >&2
  exit 1
fi
running() { docker exec "$APP" sh -c "printf %s \"\$$1\" | sha256sum | cut -c1-12"; }
[ -z "$ID" ] || [ "$(running TENCENT_SECRET_ID)" = "$(fp "$ID")" ] || { echo "✖ the app restarted but is not using the new Tencent key" >&2; exit 1; }
[ -z "$TH" ] || [ "$(running TOKENHUB_API_KEY)" = "$(fp "$TH")" ] || { echo "✖ the app restarted but is not using the new TokenHub key" >&2; exit 1; }
echo "✔ the server is running on the new keys. Tell Claude, so it can run the release test before you delete the old ones."
