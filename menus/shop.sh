#!/bin/bash

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

while true; do

    CHOICE=$(dialog \
        --title "Shop Management" \
        --menu "Select action" \
        22 75 15 \
        1  "List Shop Items" \
        2  "Add Shop Item" \
        3  "Remove Shop Item" \
        4  "Edit Shop Item" \
        5  "Back" \
        2>&1 >/dev/tty)

    clear

    case "$CHOICE" in

        1)
            node "$BASE_DIR/util/index.mjs" shop list
            read -p "Press enter..."
            ;;

        2)
            NAME=$(dialog --inputbox "Item Name" 8 40 2>&1 >/dev/tty)
            COST=$(dialog --inputbox "Cost (gold)" 8 40 "0" 2>&1 >/dev/tty)
            TYPE=$(dialog \
                --title "Item Type" \
                --menu "Select item type" \
                16 50 8 \
                gun        "Weapon" \
                consumable "Single-use item" \
                treasure   "Valuable/collectible" \
                trade      "Tradeable good" \
                crafting   "Crafting material" \
                2>&1 >/dev/tty)
            QTY=$(dialog --inputbox "Quantity granted per purchase" 8 50 "1" 2>&1 >/dev/tty)
            PACKCOST=$(dialog --inputbox "Pack Cost (0 for none)" 8 50 "0" 2>&1 >/dev/tty)
            PACKQTY=$(dialog --inputbox "Pack Quantity (0 for none)" 8 50 "0" 2>&1 >/dev/tty)

            clear

            node "$BASE_DIR/util/index.mjs" \
                shop add \
                "$NAME" \
                "$COST" \
                "$TYPE" \
                "$QTY" \
                "$PACKCOST" \
                "$PACKQTY"

            read -p "Press enter..."
            ;;

        3)
            NAME=$(dialog --inputbox "Item Name" 8 40 2>&1 >/dev/tty)

            clear

            node "$BASE_DIR/util/index.mjs" \
                shop remove \
                "$NAME"

            read -p "Press enter..."
            ;;

        4)
            NAME=$(dialog --inputbox "Item Name" 8 40 2>&1 >/dev/tty)

            FIELD=$(dialog \
                --title "Edit Field" \
                --menu "Which field?" \
                18 60 10 \
                cost         "Item cost (gold)" \
                type         "Item type" \
                quantity     "Quantity per purchase" \
                packcost     "Pack cost" \
                packquantity "Pack quantity" \
                2>&1 >/dev/tty)

            if [ "$FIELD" = "type" ]; then
                VALUE=$(dialog \
                    --title "Item Type" \
                    --menu "Select item type" \
                    16 50 8 \
                    gun        "Weapon" \
                    consumable "Single-use item" \
                    treasure   "Valuable/collectible" \
                    trade      "Tradeable good" \
                    crafting   "Crafting material" \
                    2>&1 >/dev/tty)
            else
                VALUE=$(dialog --inputbox "New value for $FIELD" 8 50 2>&1 >/dev/tty)
            fi

            clear

            node "$BASE_DIR/util/index.mjs" \
                shop edit \
                "$NAME" \
                "$FIELD" \
                "$VALUE"

            read -p "Press enter..."
            ;;

        *)
            break
            ;;
    esac

done
