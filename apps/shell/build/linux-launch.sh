#!/bin/sh
# Starts the app with the open-file soft limit raised to the hard limit.
# Chromium forks its zygote before any app code runs and every renderer keeps
# the zygote's limit, so a desktop session's default of 1024 stays on each
# editor. The Hangul editor holds one open file per font it has touched; on a
# PC with thousands of fonts it reaches the limit and the renderer then waits
# forever on a blob registration (#488). The browser process raises its own
# limit, which comes too late for the zygote, so the limit is raised here.
# The deb/rpm post-install step points the desktop entry at this file.
ulimit -Sn "$(ulimit -Hn)" 2>/dev/null || true
self="$(readlink -f "$0" 2>/dev/null)" || self="$0"
exec "${self%/*}/../ieumoffice" "$@"
