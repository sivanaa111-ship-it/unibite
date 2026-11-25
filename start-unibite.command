#!/bin/bash
# Mac: double-click to start UniBite from THIS folder.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
[ -f data/unibite.db ] || npm run seed:reset
echo "Open http://localhost:3000 in your browser. Close this window to stop the server."
(sleep 2; open http://localhost:3000/student/login) &
npm start
