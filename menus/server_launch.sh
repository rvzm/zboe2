#!/bin/bash
# Manual server launch: pick flags, then run node server.js with them.
# --cli = console prompt instead of the dialog checklist (passed down from
# menus/server.sh --cli).

CLI_MODE=0
for arg in "$@"; do [ "$arg" = "--cli" ] && CLI_MODE=1; done

if [ "$CLI_MODE" = 1 ]; then
    echo "Flags: dev (--dev), debug (--debug-level=FULL), verbose (--verbose)"
    read -rp "Space-separated flags to enable (enter for none): " OPTIONS || OPTIONS=""
else
    OPTIONS=$(dialog \
        --checklist "Server Options" \
        20 70 10 \
        dev "--dev" off \
        debug "--debug-level=FULL" off \
        verbose "--verbose" off \
        2>&1 >/dev/tty)
    clear
fi

CMD="node server.js"

[[ "$OPTIONS" == *dev* ]] && CMD+=" --dev"
[[ "$OPTIONS" == *debug* ]] && CMD+=" --debug-level=FULL"
[[ "$OPTIONS" == *verbose* ]] && CMD+=" --verbose"

echo
echo "Launching:"
echo "$CMD"
echo

eval "$CMD"
