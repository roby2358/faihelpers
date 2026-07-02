# Fai Helpers — static browser app served over HTTP (ES modules need HTTP, not file://)
#
# Uses normal (non-shebang) recipes so `just` doesn't write an executable temp
# file — shebang recipes fail with "Permission denied" on WSL / NTFS mounts.

set shell := ["bash", "-cu"]

port := "8000"
pidfile := ".server.pid"

# List available recipes
default:
    @just --list

# Start a local HTTP server in the background
up:
    @if [ -f "{{pidfile}}" ] && kill -0 "$(cat {{pidfile}})" 2>/dev/null; then \
        echo "Server already running (pid $(cat {{pidfile}})) at http://localhost:{{port}}"; \
    else \
        nohup python3 -m http.server {{port}} >/dev/null 2>&1 & \
        echo $! > "{{pidfile}}"; \
        echo "Serving http://localhost:{{port}} (pid $(cat {{pidfile}}))"; \
    fi

# Stop the local HTTP server
down:
    @if [ ! -f "{{pidfile}}" ]; then \
        echo "No server pidfile found; nothing to stop."; \
    else \
        pid="$(cat {{pidfile}})"; \
        if kill "$pid" 2>/dev/null; then \
            echo "Stopped server (pid $pid)"; \
        else \
            echo "No running process for pid $pid"; \
        fi; \
        rm -f "{{pidfile}}"; \
    fi
