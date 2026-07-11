#!/bin/bash

SERVICE="zboe.service"

while true; do

    STATUS=$(systemctl is-active "$SERVICE" 2>/dev/null)

    CHOICE=$(dialog \
        --title "Server Management" \
        --menu "Status: $STATUS" \
        20 70 10 \
        1 "Start" \
        2 "Stop" \
        3 "Restart" \
        4 "Status" \
        5 "Manual Launch" \
        6 "Back" \
        2>&1 >/dev/tty)

    clear

    case "$CHOICE" in

        1)
            sudo systemctl start "$SERVICE"
            ;;

        2)
            sudo systemctl stop "$SERVICE"
            ;;

        3)
            sudo systemctl restart "$SERVICE"
            ;;

        4)
            systemctl status "$SERVICE"
            read -p "Press enter..."
            ;;

        5)
            "$PWD/menus/server_launch.sh"
            ;;

        *)
            break
            ;;
    esac

done