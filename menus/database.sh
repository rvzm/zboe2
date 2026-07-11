#!/bin/bash

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB="$BASE_DIR/data/zboe.sqlite"
BACKUP_DIR="$BASE_DIR/backups"

mkdir -p "$BACKUP_DIR"

while true; do

    CHOICE=$(dialog \
        --title "Database Management" \
        --menu "Database Tools" \
        20 70 10 \
        1 "Backup Database" \
        2 "Vacuum Database" \
        3 "Database Size" \
        4 "Reset Inventory" \
        5 "Back" \
        2>&1 >/dev/tty)

    clear

    case "$CHOICE" in

        1)
            sqlite3 "$DB" \
                ".backup '$BACKUP_DIR/zboe-$(date +%F-%H%M%S).sqlite'"

            echo "Backup complete."
            read -p "Press enter..."
            ;;

        2)
            sqlite3 "$DB" "VACUUM;"

            echo "Vacuum complete."
            read -p "Press enter..."
            ;;

        3)
            du -h "$DB"
            read -p "Press enter..."
            ;;

        4)
            sqlite3 "$DB" \
                "DELETE FROM player_inventory;"

            echo "Inventory cleared."
            read -p "Press enter..."
            ;;

        *)
            break
            ;;
    esac

done