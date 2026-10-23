#!/usr/bin/env bash
set -euo pipefail

# Arguments:
#   $1 – BACKEND_PID of the PostgreSQL backend we are monitoring.
#   $2 – LOCK_KEY (the 64‑bit bigint used with pg_advisory_xact_lock).
#   $3 – optional timeout in seconds (default 15).
SESSION_BACKEND_PID="$1"
LOCK_KEY="$2"
TIMEOUT="${3:-15}"

# Verify that the supplied PID looks numeric.
if ! [[ "$SESSION_BACKEND_PID" =~ ^[0-9]+$ ]]; then
  echo "Error: backend PID '$SESSION_BACKEND_PID' is not numeric"
  exit 1
fi

# Split the 64‑bit key into the two 32‑bit components used by pg_locks.
# PostgreSQL stores the high‑order 32 bits in classid and the low‑order
# 32 bits in objid.  objsubid = 1 for the transaction‑level lock.
HIGH=$(( LOCK_KEY >> 32 ))
LOW=$(( LOCK_KEY & 0xFFFFFFFF ))

elapsed=0
while true; do
  BLOCKED=$(psql -t -c "\
    SELECT EXISTS (\
      SELECT 1\
      FROM pg_stat_activity a\
      JOIN pg_locks l ON a.pid = l.pid\
      WHERE a.pid = $SESSION_BACKEND_PID\
        AND l.locktype='advisory'\
        AND l.classid = $HIGH\
        AND l.objid = $LOW\
        AND l.objsubid = 1\
        AND a.wait_event_type='Lock'\
    );\
  " | tr -d ' \n')

  if [ "$BLOCKED" = "t" ]; then
    echo "Session $SESSION_BACKEND_PID is waiting on advisory lock $LOCK_KEY (high=$HIGH low=$LOW)."
    exit 0
  fi

  if [ $elapsed -ge $TIMEOUT ]; then
    echo "Timeout after $TIMEOUT seconds waiting for session $SESSION_BACKEND_PID to block on advisory lock $LOCK_KEY."
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed+1))
done
