#!/bin/bash

LOGDIR="logs"

mkdir -p "$LOGDIR"

while true; do

    CHOICE=$(dialog \
        --title "Log Management" \
        --menu "Select action" \
        20 70 10 \
        1 "View server.log" \
        2 "View error.log" \
        3 "Tail server.log" \
        4 "Delete Logs" \
        5 "Back" \
        2>&1 >/dev/tty)

    clear

    case "$CHOICE" in

        1)
            less "$LOGDIR/server.log"
            ;;

        2)
            less "$LOGDIR/error.log"
            ;;

        3)
            tail -f "$LOGDIR/server.log"
            ;;

        4)
            rm -f "$LOGDIR"/*.log

            echo "Logs removed."
            read -p "Press enter..."
            ;;

        *)
            break
            ;;
    esac

done