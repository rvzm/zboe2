#!/bin/bash

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$BASE_DIR/menus/lib.sh"

while true; do

    CHOICE=$(dialog \
        --title "User Management" \
        --menu "Select action" \
        20 70 10 \
        1 "List Users" \
        2 "Add User" \
        3 "Delete User" \
        4 "Set Password" \
        5 "Grant Admin" \
        6 "Remove Admin" \
        7 "Back" \
        2>&1 >/dev/tty)

    clear

    case "$CHOICE" in

        1)
            node "$BASE_DIR/util/index.mjs" users list
            read -p "Press enter..."
            ;;

        2)
            USER=$(pick_user)
            PASS=$(dialog --passwordbox "Password (leave blank to set later)" 8 50 2>&1 >/dev/tty)

            clear

            [ -n "$USER" ] &&
            node "$BASE_DIR/util/index.mjs" users add "$USER" "$PASS"

            read -p "Press enter..."
            ;;

        3)
            USER=$(pick_user)

            clear

            [ -n "$USER" ] &&
            node "$BASE_DIR/util/index.mjs" users remove "$USER"

            read -p "Press enter..."
            ;;

        4)
            USER=$(pick_user)
            PASS=$(dialog --passwordbox "New Password" 8 50 2>&1 >/dev/tty)

            clear

            [ -n "$USER" ] && [ -n "$PASS" ] &&
            node "$BASE_DIR/util/index.mjs" users setpassword "$USER" "$PASS"

            read -p "Press enter..."
            ;;

        5)
            USER=$(pick_user)

            clear

            [ -n "$USER" ] &&
            node "$BASE_DIR/util/index.mjs" users setadmin "$USER" true

            read -p "Press enter..."
            ;;

        6)
            USER=$(pick_user)

            clear

            [ -n "$USER" ] &&
            node "$BASE_DIR/util/index.mjs" users setadmin "$USER" false

            read -p "Press enter..."
            ;;

        *)
            break
            ;;
    esac

done