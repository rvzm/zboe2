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

# Interactive "equip armor": pick a paperdoll slot, then an item that fits it
# (unowned ones marked [Force Ownership]); picking equips it (force-granting
# if unowned). Mirrors equip_gun's shape.
equip_armor() {
    local user="$1"
    local slot
    slot=$(dialog --title "Equip Armor: $user" --menu "Select a slot" 15 55 6 \
        head " " torso " " legs " " boots " " hands " " shield " " \
        2>&1 >/dev/tty)
    [ -z "$slot" ] && return

    local lines
    lines=$(cli players armoritems "$user" "$slot")
    case "$lines" in
        "No such user:"*|"Unknown armor slot:"*|"(no "*)
            dialog --msgbox "$lines" 6 55 2>&1 >/dev/tty; return ;;
    esac

    local args=("(clear slot)" "unequip") name owned eq ap def label
    while IFS='|' read -r name owned eq ap def; do
        [ -z "$name" ] && continue
        label=""
        [ "$eq" = "1" ] && label="(equipped) "
        if [ "$owned" = "1" ]; then label="${label}owned, AP $ap, Def $def"; else label="${label}[Force] AP $ap, Def $def"; fi
        args+=("$name" "$label")
    done <<< "$lines"

    local choice
    choice=$(dialog --title "Equip Armor: $user ($slot)" --menu "Select an item" 20 65 10 "${args[@]}" 2>&1 >/dev/tty)
    [ -z "$choice" ] && return

    clear
    if [ "$choice" = "(clear slot)" ]; then
        cli players setarmor "$user" "$slot" ""
    else
        local sel_owned
        sel_owned=$(printf '%s\n' "$lines" | awk -F'|' -v n="$choice" '$1==n{print $2}')
        if [ "$sel_owned" = "1" ]; then
            cli players setarmor "$user" "$slot" "$choice"
        else
            cli players setarmor "$user" "$slot" "$choice" force
        fi
    fi
    read -p "Press enter..."
}

# Interactive "equip weapon wheel slot": same shape as equip_armor, over the
# 5 melee/fist/ranged/throwing/zombie slots. Equipping also makes the slot
# active (setweapon calls setSelectedSlot), matching in-game behavior.
equip_weapon() {
    local user="$1"
    local slot
    slot=$(dialog --title "Equip Weapon: $user" --menu "Select a slot" 15 55 6 \
        melee " " fist " " ranged " " throwing " " zombie " " \
        2>&1 >/dev/tty)
    [ -z "$slot" ] && return

    local lines
    lines=$(cli players weaponitems "$user" "$slot")
    case "$lines" in
        "No such user:"*|"Unknown weapon slot:"*|"(no weapons"*)
            dialog --msgbox "$lines" 6 55 2>&1 >/dev/tty; return ;;
    esac

    local args=("(clear slot)" "unequip") name owned eq label
    while IFS='|' read -r name owned eq; do
        [ -z "$name" ] && continue
        label=""
        [ "$eq" = "1" ] && label="(equipped) "
        if [ "$owned" = "1" ]; then label="${label}owned"; else label="${label}[Force Ownership]"; fi
        args+=("$name" "$label")
    done <<< "$lines"

    local choice
    choice=$(dialog --title "Equip Weapon: $user ($slot)" --menu "Select an item" 20 65 10 "${args[@]}" 2>&1 >/dev/tty)
    [ -z "$choice" ] && return

    clear
    if [ "$choice" = "(clear slot)" ]; then
        cli players setweapon "$user" "$slot" ""
    else
        local sel_owned
        sel_owned=$(printf '%s\n' "$lines" | awk -F'|' -v n="$choice" '$1==n{print $2}')
        if [ "$sel_owned" = "1" ]; then
            cli players setweapon "$user" "$slot" "$choice"
        else
            cli players setweapon "$user" "$slot" "$choice" force
        fi
    fi
    read -p "Press enter..."
}

# Teleport a player to any location, bypassing the travel graph.
teleport_player() {
    local user="$1"
    local args=() key name
    while IFS='|' read -r key name; do
        [ -n "$key" ] && args+=("$key" "$name")
    done < <(cli players locations)

    local choice
    choice=$(dialog --title "Teleport: $user" --menu "Select a destination" 20 55 12 "${args[@]}" 2>&1 >/dev/tty)
    [ -z "$choice" ] && return

    clear
    cli players teleport "$user" "$choice"
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
        6  "Equip Armor" \
        7  "Equip Weapon Wheel Slot" \
        8  "Teleport Player" \
        9  "Back" \
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

        6)
            PLAYER=$(pick_user)
            [ -n "$PLAYER" ] && equip_armor "$PLAYER"
            ;;

        7)
            PLAYER=$(pick_user)
            [ -n "$PLAYER" ] && equip_weapon "$PLAYER"
            ;;

        8)
            PLAYER=$(pick_user)
            [ -n "$PLAYER" ] && teleport_player "$PLAYER"
            ;;

        *)
            break
            ;;
    esac

done
