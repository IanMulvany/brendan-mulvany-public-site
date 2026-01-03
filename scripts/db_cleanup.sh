#!/bin/bash
# Remove SQLite WAL mode temporary files

cd "$(dirname "$0")/.." || exit 1

rm -f public_site.db-shm public_site.db-wal

echo "Cleaned up SQLite WAL files"
