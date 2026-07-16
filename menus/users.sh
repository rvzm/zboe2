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
        action=$(dialog --title "Manage: $user" --menu "Select action" 17 55 9 \
            pass   "Set Password" \
            admin  "$admin_label" \
            mod    "Ban / Unban / Exile" \
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
            mod)
                manage_moderation "$user"
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

# Ban/unban/exile/un-exile for one user (login_restricted / user_exiled —
# see CLAUDE.md). Same duration presets as the admin page's Actions modal.
manage_moderation() {
    local user="$1"
    while true; do
        local action
        action=$(dialog --title "Ban / Exile: $user" --menu "Select action" 15 55 6 \
            ban     "Temp Ban" \
            unban   "Unban" \
            exile   "Exile (permanent)" \
            unexile "Un-exile" \
            back    "Return" \
            2>&1 >/dev/tty)

        case "$action" in
            ban)
                local dur reason
                dur=$(dialog --title "Ban duration" --menu "How long?" 20 50 11 \
                    1m "1 minute" 5m "5 minutes" 15m "15 minutes" 30m "30 minutes" \
                    1h "1 hour" 2h "2 hours" 5h "5 hours" 12h "12 hours" \
                    24h "24 hours" 72h "72 hours" custom "Custom (e.g. 90m, 3d)" \
                    2>&1 >/dev/tty)
                [ -z "$dur" ] && continue
                if [ "$dur" = "custom" ]; then
                    dur=$(dialog --inputbox "Duration (e.g. 90m, 3d, or seconds)" 8 50 2>&1 >/dev/tty)
                    [ -z "$dur" ] && continue
                fi
                reason=$(dialog --inputbox "Reason (blank = standard notice)" 8 60 2>&1 >/dev/tty)
                clear; cli users ban "$user" "$dur" $reason; read -p "Press enter..."
                ;;
            unban)
                clear; cli users unban "$user"; read -p "Press enter..."
                ;;
            exile)
                dialog --yesno "Permanently exile \"$user\"? This is a permaban." 8 55 2>&1 >/dev/tty
                if [ $? -eq 0 ]; then
                    local reason
                    reason=$(dialog --inputbox "Reason (optional)" 8 60 2>&1 >/dev/tty)
                    clear; cli users exile "$user" $reason; read -p "Press enter..."
                fi
                ;;
            unexile)
                clear; cli users unexile "$user"; read -p "Press enter..."
                ;;
            *) return ;;
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
