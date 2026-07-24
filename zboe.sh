#!/bin/bash
# ZBOE server-admin TUI. --cli switches to a plain interactive console
# (live.sh style) for terminals/boxes that can't render dialog: the Server
# and Log submenus get --cli passed down, while Users/Players/Database open
# the Admin CLI REPL — the console-native interface to those same command
# groups (try `help users`, `help players`, `help database` inside it).

CLI_MODE=0
for arg in "$@"; do [ "$arg" = "--cli" ] && CLI_MODE=1; done
SUBFLAG=""
[ "$CLI_MODE" = 1 ] && SUBFLAG="--cli"

while true; do

    if [ "$CLI_MODE" = 1 ]; then
        echo ""
        echo "=== ZBOE Server Manager ==="
        echo "  1) Server Management"
        echo "  2) User Management (Admin CLI)"
        echo "  3) Player Management (Admin CLI)"
        echo "  4) Database Management (Admin CLI)"
        echo "  5) Log Management"
        echo "  6) Open Admin CLI"
        echo "  7) Exit"
        # EOF (Ctrl-D / end of piped input) exits like option 7.
        read -rp "> " CHOICE || exit 0
    else
        CHOICE=$(dialog \
            --clear \
            --title "ZBOE Server Manager" \
            --menu "Select an action:" 20 70 10 \
            1 "Server Management" \
            2 "User Management" \
            3 "Player Management" \
            4 "Database Management" \
            5 "Log Management" \
            6 "Open Admin CLI" \
            7 "Exit" \
            2>&1 >/dev/tty)
        clear
    fi

    case "$CHOICE" in
        1) ./menus/server.sh $SUBFLAG ;;
        2)
            if [ "$CLI_MODE" = 1 ]; then
                echo "User management runs in the Admin CLI — try: help users"
                node util/index.mjs
            else
                ./menus/users.sh
            fi
            ;;
        3)
            if [ "$CLI_MODE" = 1 ]; then
                echo "Player management runs in the Admin CLI — try: help players"
                node util/index.mjs
            else
                ./menus/players.sh
            fi
            ;;
        4)
            if [ "$CLI_MODE" = 1 ]; then
                echo "Database management runs in the Admin CLI — try: help database"
                node util/index.mjs
            else
                ./menus/database.sh
            fi
            ;;
        5) ./menus/logs.sh $SUBFLAG ;;
        6) node util/index.mjs ;;
        7|q|quit|exit) exit 0 ;;
        "")
            # Dialog cancel redraws the menu (original behavior); console
            # bare-enter just re-prompts.
            ;;
        *)
            [ "$CLI_MODE" = 1 ] && echo "Unknown option '$CHOICE' — pick 1-7."
            ;;
    esac
done
