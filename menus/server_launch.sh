#!/bin/bash

OPTIONS=$(dialog \
    --checklist "Server Options" \
    20 70 10 \
    dev "--dev" off \
    debug "--debug-level=FULL" off \
    verbose "--verbose" off \
    2>&1 >/dev/tty)

clear

CMD="node server.js"

[[ "$OPTIONS" == *dev* ]] && CMD+=" --dev"
[[ "$OPTIONS" == *debug* ]] && CMD+=" --debug-level=FULL"
[[ "$OPTIONS" == *verbose* ]] && CMD+=" --verbose"

echo
echo "Launching:"
echo "$CMD"
echo

eval "$CMD"