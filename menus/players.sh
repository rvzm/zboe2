#!/bin/bash

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$BASE_DIR/menus/lib.sh"

cli() { node "$BASE_DIR/util/index.mjs" "$@"; }

# Interactive "set equipped gun": lists all guns, marking unowned ones
# [Force Ownership]; picking one equips it (force-granting if unowned).
equip_gun() {
    local user="$1"
    local lines
    lines=$(cli players guns "$user")
    case "$lines" in
        "No such user:"*) dialog --msgbox "$lines" 6 50 2>&1 >/dev/tty; return ;;
    esac

    local args=() name owned eq label
    while IFS='|' read -r name owned eq; do
        [ -z "$name" ] && continue
        label=""
        [ "$eq" = "1" ] && label="(equipped) "
        if [ "$owned" = "1" ]; then label="${label}owned"; else label="${label}[Force Ownership]"; fi
        args+=("$name" "$label")
    done <<< "$lines"

    local choice
    choice=$(dialog --title "Set Equipped Gun: $user" --menu "Select a gun" 15 55 8 "${args[@]}" 2>&1 >/dev/tty)
    [ -z "$choice" ] && return

    local sel_owned
    sel_owned=$(printf '%s\n' "$lines" | awk -F'|' -v g="$choice" '$1==g{print $2}')

    clear
    if [ "$sel_owned" = "1" ]; then
        cli players setgun "$user" "$choice"
    else
        cli players setgun "$user" "$choice" force
    fi
    read -p "Press enter..."
}

# Level control: +/-1/5/10 as full-stack forced level changes (stat + XP gains),
# mirroring the web admin's level control. Distinct from a raw 'level' set.
level_control() {
    local user="$1"
    while true; do
        local cur
        cur=$(cli players getstat "$user" level)
        local step
        step=$(dialog --title "Force Level: $user (level $cur)" \
            --menu "Adjust level — full stack: applies stat + XP gains" 18 55 9 \
            "+1" " " "+5" " " "+10" " " "-1" " " "-5" " " "-10" " " "back" "Return" \
            2>&1 >/dev/tty)
        { [ -z "$step" ] || [ "$step" = "back" ]; } && break
        clear
        cli players forcelevel "$user" "$step"
        read -p "Press enter..."
    done
}

# Interactive stats editor: pick a stat, then +/-1/5/10 or set an exact value.
# 'level' is special-cased to the full-stack level control above.
stats_menu() {
    local user="$1"
    while true; do
        local raw
        raw=$(cli players statsraw "$user")
        case "$raw" in
            "No such user:"*) dialog --msgbox "$raw" 6 50 2>&1 >/dev/tty; return ;;
        esac

        local args=() f v
        while IFS='|' read -r f v; do
            [ -n "$f" ] && args+=("$f" "$v")
        done <<< "$raw"

        local field
        field=$(dialog --title "Player Stats: $user" --menu "Select a stat to edit (Cancel to exit)" 24 55 16 "${args[@]}" 2>&1 >/dev/tty)
        [ -z "$field" ] && break

        if [ "$field" = "level" ]; then
            level_control "$user"
            continue
        fi

        local cur
        cur=$(cli players getstat "$user" "$field")

        local op
        op=$(dialog --title "$field = $cur" --menu "Adjust $field" 18 45 9 \
            "+1" " " "-1" " " "+5" " " "-5" " " "+10" " " "-10" " " "set" "Enter exact value" \
            2>&1 >/dev/tty)
        [ -z "$op" ] && continue

        local newval
        if [ "$op" = "set" ]; then
            newval=$(dialog --inputbox "New value for $field" 8 40 "$cur" 2>&1 >/dev/tty)
            [ -z "$newval" ] && continue
        else
            newval=$(( cur + op ))
        fi

        clear
        cli players setstat "$user" "$field" "$newval"
        read -p "Press enter..."
    done
}

while true; do

    CHOICE=$(dialog \
        --title "Player Management" \
        --menu "Select action" \
        22 75 15 \
        1  "View / Edit Player Stats" \
        2  "Show Inventory" \
        3  "Add Inventory Item" \
        4  "Remove Inventory Item" \
        5  "Set Equipped Gun" \
        6  "Back" \
        2>&1 >/dev/tty)

    clear

    case "$CHOICE" in

        1)
            PLAYER=$(pick_user)
            [ -n "$PLAYER" ] && stats_menu "$PLAYER"
            ;;

        2)
            PLAYER=$(pick_user)
            clear
            [ -n "$PLAYER" ] && cli inventory show "$PLAYER"
            read -p "Press enter..."
            ;;

        3)
            PLAYER=$(pick_user)
            ITEM=$(dialog --inputbox "Item Name" 8 40 2>&1 >/dev/tty)
            QTY=$(dialog --inputbox "Quantity" 8 40 "1" 2>&1 >/dev/tty)
            CONDITION=$(dialog --inputbox "Condition" 8 40 "100" 2>&1 >/dev/tty)
            AMMO=$(dialog --inputbox "Ammo" 8 40 "0" 2>&1 >/dev/tty)
            CLIPS=$(dialog --inputbox "Clips" 8 40 "0" 2>&1 >/dev/tty)

            clear
            [ -n "$PLAYER" ] && [ -n "$ITEM" ] &&
                cli inventory add "$PLAYER" "$ITEM" "$QTY" "$CONDITION" "$AMMO" "$CLIPS"
            read -p "Press enter..."
            ;;

        4)
            PLAYER=$(pick_user)
            ITEM=$(dialog --inputbox "Item Name" 8 40 2>&1 >/dev/tty)
            QTY=$(dialog --inputbox "Quantity (blank = all)" 8 45 2>&1 >/dev/tty)

            clear
            [ -n "$PLAYER" ] && [ -n "$ITEM" ] &&
                cli inventory remove "$PLAYER" "$ITEM" "$QTY"
            read -p "Press enter..."
            ;;

        5)
            PLAYER=$(pick_user)
            [ -n "$PLAYER" ] && equip_gun "$PLAYER"
            ;;

        *)
            break
            ;;
    esac

done
