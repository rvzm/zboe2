#!/bin/bash
# Log Management submenu. --cli = plain console menu instead of dialog
# (passed down from zboe.sh --cli). The actions themselves (less/tail/rm)
# were always console commands.

LOGDIR="logs"

mkdir -p "$LOGDIR"

CLI_MODE=0
for arg in "$@"; do [ "$arg" = "--cli" ] && CLI_MODE=1; done

pause() { [ "$CLI_MODE" = 1 ] || read -p "Press enter..."; }

while true; do

    if [ "$CLI_MODE" = 1 ]; then
        echo ""
        echo "=== Log Management ==="
        echo "  1) View server.log"
        echo "  2) View rotated log (server.old.log)"
        echo "  3) Tail server.log"
        echo "  4) Delete Logs"
        echo "  5) Back"
        read -rp "> " CHOICE || break
    else
        CHOICE=$(dialog \
            --title "Log Management" \
            --menu "Select action" \
            20 70 10 \
            1 "View server.log" \
            2 "View rotated log (server.old.log)" \
            3 "Tail server.log" \
            4 "Delete Logs" \
            5 "Back" \
            2>&1 >/dev/tty)
        clear
    fi

    case "$CHOICE" in

        1)
            less "$LOGDIR/server.log"
            ;;

        2)
            less "$LOGDIR/server.old.log"
            ;;

        3)
            tail -f "$LOGDIR/server.log"
            ;;

        4)
            rm -f "$LOGDIR"/*.log
            echo "Logs removed."
            pause
            ;;

        5|q|b|back)
            break
            ;;

        "")
            # Dialog cancel goes back; console bare-enter just re-prompts.
            [ "$CLI_MODE" = 1 ] || break
            ;;

        *)
            if [ "$CLI_MODE" = 1 ]; then echo "Unknown option '$CHOICE' — pick 1-5."; else break; fi
            ;;
    esac

done
