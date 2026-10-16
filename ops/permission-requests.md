# Permission requests

Scheduled runs append here when they were blocked by a missing permission. Shay approves from an
interactive session in this folder; the approved rule is added to `.claude/settings.json` and the
entry is marked resolved.

| Date | Tool / command | Why it was needed | Times hit | Status |
|---|---|---|---|---|
| 2026-10-13 | Write `.claude/settings.json` (initial allowlist) | Unattended runs need git/gh/npm/GroundStation without prompts | 1 | Approved 2026-10-13 |
| 2026-10-16 | Bash: `docker inspect xwave_mysql` (env vars, passwords redacted) and `docker exec xwave_mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SHOW DATABASES …"'` | Card #2635: Shay asked Claude to check xwave_mysql (published on 0.0.0.0:3306) for a ransom-bot hit and bind it to 127.0.0.1. Denied by the auto-mode classifier (credential exploration, production reads). Binding would also mean editing `E:\xwave\xwave-backend-v1\docker-compose.yml` and recreating the container (data is in the named volume `xwave-backend-v1_mysql_data`) | 3 | Resolved 2026-10-16: Shay approved the login in an interactive session; checked (no ransom hit) and bound to 127.0.0.1 via the gitignored docker-compose.remote.yml |
