#!/bin/bash

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$BASE_DIR/menus/lib.sh"

cli() { node "$BASE_DIR/util/index.mjs" "$@"; }

# True if the user is currently an admin (parsed from `users list`).
user_is_admin() {
    cli users list | grep -qE "^[0-9]+ \| $1 \| admin=1$"
}

# Per-user management: set password, grant/revoke admin, delete (confirmed).
manage_user() {
    local user="$1"
    while true; do
        local admin_label
        if user_is_admin "$user"; then admin_label="Revoke Admin"; else admin_label="Grant Admin"; fi

        local action
        action=$(dialog --title "Manage: $user" --menu "Select action" 15 50 8 \
            pass   "Set Password" \
            admin  "$admin_label" \
            delete "Delete User" \
            back   "Return" \
            2>&1 >/dev/tty)

        case "$action" in
            pass)
                local pw
                pw=$(dialog --passwordbox "New password for $user" 8 50 2>&1 >/dev/tty)
                if [ -n "$pw" ]; then clear; cli users setpassword "$user" "$pw"; read -p "Press enter..."; fi
                ;;
            admin)
                clear
                if user_is_admin "$user"; then cli users setadmin "$user" false; else cli users setadmin "$user" true; fi
                read -p "Press enter..."
                ;;
            delete)
                dialog --yesno "Delete user \"$user\" and ALL their data?\nThis cannot be undone." 8 60 2>&1 >/dev/tty
                if [ $? -eq 0 ]; then
                    clear; cli users remove "$user"; read -p "Press enter..."
                    return  # user gone — leave this menu
                fi
                ;;
            *) break ;;
        esac
    done
}

# List Users: menu of all users → pick one → manage it.
list_users() {
    local args=() u
    while IFS= read -r u; do
        [ -n "$u" ] && args+=("$u" "$u")
    done < <(cli users names)

    if [ ${#args[@]} -eq 0 ]; then
        dialog --msgbox "No users in the database." 6 40 2>&1 >/dev/tty
        return
    fi

    local sel
    sel=$(dialog --title "Users" --menu "Select a user to manage" 20 50 12 "${args[@]}" 2>&1 >/dev/tty)
    [ -n "$sel" ] && manage_user "$sel"
}

while true; do

    CHOICE=$(dialog \
        --title "User Management" \
        --menu "Select action" \
        20 70 10 \
        1 "List Users" \
        2 "Add User" \
        3 "Back" \
        2>&1 >/dev/tty)

    clear

    case "$CHOICE" in

        1)
            list_users
            ;;

        2)
            USER=$(dialog --inputbox "Username" 8 40 2>&1 >/dev/tty)
            PASS=$(dialog --passwordbox "Password (leave blank to set later)" 8 50 2>&1 >/dev/tty)

            clear
            [ -n "$USER" ] && cli users add "$USER" "$PASS"
            read -p "Press enter..."
            ;;

        *)
            break
            ;;
    esac

done
