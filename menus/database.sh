#!/bin/bash

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB="$BASE_DIR/data/zboe.sqlite"
PID_FILE="$BASE_DIR/logs/zboe.pid"

cli() { node "$BASE_DIR/util/index.mjs" "$@"; }

server_running() {
    [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null
}

while true; do

    CHOICE=$(dialog \
        --title "Database Management" \
        --menu "Database Tools" \
        22 74 12 \
        1 "Backup Database" \
        2 "Restore Backup" \
        3 "Migrate Old Database" \
        4 "Vacuum Database" \
        5 "Database Size" \
        6 "Reset Inventory" \
        7 "Back" \
        2>&1 >/dev/tty)

    clear

    case "$CHOICE" in

        1)  # ---- Backup (new timestamped file) ----
            clear
            cli database backup
            read -p "Press enter..."
            ;;

        2)  # ---- Restore Backup (pick from available backups) ----
            if [ "$(cli database backupexists)" != "yes" ]; then
                dialog --msgbox "No backups found. Run 'Backup Database' first." 7 55 2>&1 >/dev/tty
                continue
            fi
            if server_running; then
                dialog --msgbox "The server is running. Stop it (Server Management → Stop) before restoring." 8 60 2>&1 >/dev/tty
                continue
            fi
            # Build a picker of available backups (newest first).
            ARGS=()
            while IFS= read -r bpath; do
                [ -n "$bpath" ] && ARGS+=("$bpath" "$(basename "$bpath")")
            done < <(cli database backups)
            CHOSEN=$(dialog --title "Restore Backup" --menu "Select a backup to restore" 20 74 12 "${ARGS[@]}" 2>&1 >/dev/tty)
            [ -z "$CHOSEN" ] && continue
            STATUS=$(cli database inspect "$CHOSEN")
            dialog --yesno "Restore will OVERWRITE the current database with:\n$(basename "$CHOSEN")\n\nBackup — $STATUS\n\nProceed?" 13 74 2>&1 >/dev/tty
            [ $? -ne 0 ] && continue
            clear
            cli database restore "$CHOSEN"
            read -p "Press enter..."
            ;;

        3)  # ---- Migrate Old Database ----
            OLD=$(dialog --inputbox "Full path to the old database file:" 8 70 2>&1 >/dev/tty)
            [ -z "$OLD" ] && continue
            STATUS=$(cli database inspect "$OLD")
            case "$STATUS" in
                MISSING*)  dialog --msgbox "File not found:\n$OLD" 8 60 2>&1 >/dev/tty ;;
                INVALID*)  dialog --msgbox "$STATUS\n\nThis file cannot be migrated." 10 70 2>&1 >/dev/tty ;;
                OK*)       dialog --msgbox "That database already matches the current schema." 7 60 2>&1 >/dev/tty ;;
                OUTDATED*)
                    dialog --yesno "$STATUS\n\nMigrate this database up to the current schema? This modifies the file in place." 14 74 2>&1 >/dev/tty
                    if [ $? -eq 0 ]; then
                        clear
                        cli database migrate "$OLD"
                        read -p "Press enter..."
                    fi
                    ;;
            esac
            ;;

        4)
            sqlite3 "$DB" "VACUUM;"
            echo "Vacuum complete."
            read -p "Press enter..."
            ;;

        5)
            du -h "$DB"
            read -p "Press enter..."
            ;;

        6)
            sqlite3 "$DB" "DELETE FROM player_inventory;"
            echo "Inventory cleared."
            read -p "Press enter..."
            ;;

        *)
            break
            ;;
    esac

done
