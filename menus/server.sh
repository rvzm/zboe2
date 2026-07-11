#!/bin/bash

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$BASE_DIR/logs/zboe.pid"

server_status() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
        echo "running (pid $(cat "$PID_FILE"))"
    else
        echo "stopped"
    fi
}

while true; do

    CHOICE=$(dialog \
        --title "Server Management" \
        --menu "Status: $(server_status)" \
        20 70 10 \
        1 "Start (background)" \
        2 "Stop" \
        3 "Restart" \
        4 "Status" \
        5 "Manual Launch" \
        6 "Back" \
        2>&1 >/dev/tty)

    clear

    case "$CHOICE" in

        1)
            ( cd "$BASE_DIR" && node server.js )
            read -p "Press enter..."
            ;;

        2)
            ( cd "$BASE_DIR" && node server.js --stop )
            read -p "Press enter..."
            ;;

        3)
            ( cd "$BASE_DIR" && node server.js --stop; node server.js )
            read -p "Press enter..."
            ;;

        4)
            echo "Server is $(server_status)."
            read -p "Press enter..."
            ;;

        5)
            "$BASE_DIR/menus/server_launch.sh"
            ;;

        *)
            break
            ;;
    esac

done
