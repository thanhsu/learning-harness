#!/bin/bash
# Daily launcher — double-click to start learning-harness and open the dashboard.
set -e
cd "$(dirname "$0")/.."
( sleep 3 && open "http://localhost:3456" ) &
npm start
