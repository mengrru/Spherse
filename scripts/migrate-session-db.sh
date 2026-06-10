#!/bin/bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/migrate-session-db.sh <project-root>"
  exit 1
fi

PROJECT_ROOT="$1"
SPHERSE_DIR="$PROJECT_ROOT/.spherse"
OLD_DB="$SPHERSE_DIR/sessions.db"
AGENTS_DIR="$SPHERSE_DIR/agents"

if [ ! -f "$OLD_DB" ]; then
  echo "No sessions.db found, nothing to migrate."
  exit 0
fi

AGENT_IDS=$(sqlite3 "$OLD_DB" "SELECT DISTINCT agent_id FROM sessions;")
COUNT=$(echo "$AGENT_IDS" | grep -c .)
echo "Found $COUNT agent(s) with sessions."

SCHEMA="
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
"

echo "$AGENT_IDS" | while IFS= read -r AGENT_ID; do
  [ -z "$AGENT_ID" ] && continue

  AGENT_DIR=""
  for d in "$AGENTS_DIR"/*/; do
    PROFILE="$d/profile.md"
    [ -f "$PROFILE" ] || continue
    PROFILE_ID=$(grep "^id:" "$PROFILE" | head -1 | sed 's/id: *//' | tr -d '"' | tr -d "'")
    if [ "$PROFILE_ID" = "$AGENT_ID" ]; then
      AGENT_DIR="$d"
      break
    fi
  done

  if [ -z "$AGENT_DIR" ]; then
    echo "  WARNING: agent directory not found for $AGENT_ID, skipping."
    continue
  fi

  NEW_DB="${AGENT_DIR%/}/sessions.db"
  if [ -f "$NEW_DB" ]; then
    echo "  WARNING: $NEW_DB already exists, skipping."
    continue
  fi

  sqlite3 "$NEW_DB" "$SCHEMA"
  sqlite3 "$NEW_DB" "PRAGMA journal_mode = WAL;"

  SESSION_COUNT=$(sqlite3 "$OLD_DB" "SELECT COUNT(*) FROM sessions WHERE agent_id = '$AGENT_ID';")
  MESSAGE_COUNT=$(sqlite3 "$OLD_DB" "SELECT COUNT(*) FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE agent_id = '$AGENT_ID');")

  ATTACH_QUERY="ATTACH DATABASE '$OLD_DB' AS old;"
  sqlite3 "$NEW_DB" "$ATTACH_QUERY
INSERT INTO sessions SELECT * FROM old.sessions WHERE agent_id = '$AGENT_ID';
INSERT INTO messages SELECT * FROM old.messages WHERE session_id IN (SELECT id FROM old.sessions WHERE agent_id = '$AGENT_ID');
DETACH DATABASE old;"

  echo "  Migrated $SESSION_COUNT session(s), $MESSAGE_COUNT message(s) for $AGENT_ID -> $NEW_DB"
done

BACKUP="$OLD_DB.bak"
if [ -f "$BACKUP" ]; then
  echo ""
  echo "WARNING: $BACKUP already exists. Keeping $OLD_DB alongside .bak."
  echo "You can manually remove $OLD_DB after verifying the migration."
else
  mv "$OLD_DB" "$BACKUP"
  echo ""
  echo "Original DB backed up to $BACKUP"
fi
echo "Migration complete."
