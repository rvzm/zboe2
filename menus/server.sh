#!/bin/bash
# Server Management submenu. --cli = plain console menu instead of dialog
# (passed down from zboe.sh --cli; forwarded on to server_launch.sh).

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$BASE_DIR/logs/zboe.pid"

CLI_MODE=0
for arg in "$@"; do [ "$arg" = "--cli" ] && CLI_MODE=1; done
SUBFLAG=""
[ "$CLI_MODE" = 1 ] && SUBFLAG="--cli"

server_status() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
        echo "running (pid $(cat "$PID_FILE"))"
    else
        echo "stopped"
    fi
}

pause() { [ "$CLI_MODE" = 1 ] || read -p "Press enter..."; }

while true; do

    if [ "$CLI_MODE" = 1 ]; then
        echo ""
        echo "=== Server Management (status: $(server_status)) ==="
        echo "  1) Start (background)"
        echo "  2) Stop"
        echo "  3) Restart"
        echo "  4) Status"
        echo "  5) Manual Launch"
        echo "  6) Back"
        read -rp "> " CHOICE || break
    else
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
    fi

    case "$CHOICE" in

        1)
            ( cd "$BASE_DIR" && node server.js )
            pause
            ;;

        2)
            ( cd "$BASE_DIR" && node server.js --stop )
            pause
            ;;

        3)
            ( cd "$BASE_DIR" && node server.js --stop; node server.js )
            pause
            ;;

        4)
            echo "Server is $(server_status)."
            pause
            ;;

        5)
            "$BASE_DIR/menus/server_launch.sh" $SUBFLAG
            ;;

        6|q|b|back)
            break
            ;;

        "")
            # Dialog cancel goes back; console bare-enter just re-prompts.
            [ "$CLI_MODE" = 1 ] || break
            ;;

        *)
            if [ "$CLI_MODE" = 1 ]; then echo "Unknown option '$CHOICE' — pick 1-6."; else break; fi
            ;;
    esac

done
