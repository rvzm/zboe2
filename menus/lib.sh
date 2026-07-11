#!/bin/bash
# Shared helpers for the dialog menus. Source this after defining $BASE_DIR.

# Prompt for a username. Typing "list" opens a picker built from the DB.
# Prints the chosen username (empty if cancelled).
pick_user() {
    local input
    input=$(dialog --inputbox "Enter name/list" 8 40 2>&1 >/dev/tty)

    if [ "$input" = "list" ]; then
        local args=() u
        while IFS= read -r u; do
            [ -n "$u" ] && args+=("$u" "$u")
        done < <(node "$BASE_DIR/util/index.mjs" users names)

        if [ ${#args[@]} -eq 0 ]; then
            dialog --msgbox "No users in the database." 6 40 2>&1 >/dev/tty
            input=""
        else
            input=$(dialog --menu "Select user" 20 50 12 "${args[@]}" 2>&1 >/dev/tty)
        fi
    fi

    printf '%s' "$input"
}
