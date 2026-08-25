#!/bin/sh
# NetBreaker2 elevation wrapper. Invoked only after an explicit OS prompt
# (pkexec / osascript). Never call this from an unattended path.
# Usage: elevate-launch.sh <kernel> <config> <workdir> <pidfile> <logfile>
set -eu
kernel=$1
config=$2
workdir=$3
pidfile=$4
logfile=$5
mkdir -p "$(dirname "$pidfile")" "$(dirname "$logfile")" "$workdir"
if command -v setsid >/dev/null 2>&1; then
  setsid "$kernel" -d "$workdir" -f "$config" >> "$logfile" 2>&1 < /dev/null &
else
  "$kernel" -d "$workdir" -f "$config" >> "$logfile" 2>&1 < /dev/null &
fi
echo $! > "$pidfile"
