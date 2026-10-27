#!/usr/bin/env bash
# Read the Caddy access log on the server, one request per line:
#   sudo deploy/tools/access-log.sh            last 50 requests
#   sudo deploy/tools/access-log.sh 200        last 200 requests
#   sudo deploy/tools/access-log.sh --ips      requests and failed logins per client IP
# Rolled files (access-*.log.gz, one per day, gzipped by Caddy) are read
# too, oldest first.
set -euo pipefail
dir="${CLOSE_KNIT_LOG_DIR:-/var/log/close-knit}"
mode="tail"; count=50
case "${1:-}" in --ips) mode="ips" ;; "") ;; *) count="$1" ;; esac
ls "$dir"/access* >/dev/null 2>&1 || { echo "access-log: no logs in $dir" >&2; exit 1; }
zcat -f $(ls -tr "$dir"/access*) | python3 -c '
import collections, datetime, json, sys
mode, count = sys.argv[1], int(sys.argv[2])
rows = []
for line in sys.stdin:
    try:
        e = json.loads(line)
    except ValueError:
        continue
    r = e.get("request", {})
    rows.append((e.get("ts", 0), r.get("client_ip") or r.get("remote_ip", "?"), e.get("user_id") or "-",
                 r.get("method", "?"), r.get("uri", "?"), e.get("status", 0),
                 (r.get("headers", {}).get("User-Agent") or ["-"])[0]))
if mode == "ips":
    seen = collections.defaultdict(lambda: [0, 0, 0.0, set()])
    for ts, ip, user, *_rest in rows:
        s = seen[ip]; s[0] += 1; s[1] += _rest[2] == 401; s[2] = max(s[2], ts); s[3].add(user)
    print("%-40s %8s %6s  %-19s  users" % ("client ip", "requests", "401s", "last seen (UTC)"))
    for ip, (n, denied, last, users) in sorted(seen.items(), key=lambda kv: -kv[1][0]):
        when = datetime.datetime.fromtimestamp(last, datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        users_text = " ".join(sorted(users))
        print(f"{ip:<40} {n:>8} {denied:>6}  {when}  {users_text}")
else:
    for ts, ip, user, method, uri, status, agent in rows[-count:]:
        when = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        print(f"{when} {ip:<39} {user:<10} {status} {method:<6} {uri[:90]}  {agent[:60]}")
' "$mode" "$count"
