#!/bin/sh
# How many talks the running server is carrying, and whose. Prints "0", or "2 a@x.com 12 min, b@y.com 3 min",
# or "unknown" when the server cannot be asked. Used before anything that would restart it (deploy.sh) or
# compete with it for the box (the release test).
docker exec "${APP:-deploy-app-1}" node -e '
fetch("http://127.0.0.1:8080/internal/talks").then((r) => r.json()).then((j) => {
  const t = j.talks || [];
  console.log(t.length + (t.length ? " " + t.map((x) => `${x.email} ${Math.round(x.seconds / 60)} min`).join(", ") : ""));
}).catch(() => console.log("unknown"));' 2>/dev/null || echo unknown
