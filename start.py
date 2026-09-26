# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "rich>=13.0.0",
# ]
# ///
"""Start the API server and the web frontend together, from the repo root.

    uv run start.py

Delegates to backend/api's own environment via `uv run --project`, and to
web's own npm project, rather than importing their code here -- each stays
an independent project with its own lockfile/dependencies.

Both bind to 0.0.0.0 by default, so they're reachable from other devices on
the network (phone, another machine, etc), not just localhost.

Env overrides: HOST (default 0.0.0.0), PORT (API, default 8000),
FRONTEND_PORT (web, default 5173).
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from rich.console import Console, Group
from rich.panel import Panel
from rich.table import Table

API_DIR = "backend/api"
WEB_DIR = "web"

console = Console()


def get_lan_ip() -> str:
    """Best-effort LAN-facing IP (doesn't actually send anything)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def get_public_ip(timeout: float = 3.0) -> str | None:
    try:
        with urllib.request.urlopen("https://api.ipify.org", timeout=timeout) as resp:
            return resp.read().decode().strip()
    except Exception:
        return None


def require_executable(name: str) -> str:
    path = shutil.which(name)
    if not path:
        console.print(f"[bold red]Error:[/bold red] `{name}` not found on PATH.")
        sys.exit(1)
    return path


def build_banner(host: str, api_port: str, web_port: str, lan_ip: str, public_ip: str | None) -> Panel:
    table = Table(show_header=True, header_style="bold cyan", box=None, padding=(0, 2, 0, 0))
    table.add_column("Service")
    table.add_column("Local")
    table.add_column("Network")

    table.add_row("[bold]API[/bold]", f"http://localhost:{api_port}", f"http://{lan_ip}:{api_port}")
    table.add_row("[bold]Web[/bold]", f"http://localhost:{web_port}", f"http://{lan_ip}:{web_port}")

    public_line = (
        f"[bold]Public IP:[/bold] {public_ip}  [dim](only reachable if your router forwards these ports)[/dim]"
        if public_ip
        else "[bold]Public IP:[/bold] [dim]unavailable (no internet, or the lookup timed out)[/dim]"
    )

    group = Group(table, "", f"Bound to [bold]{host}[/bold]", public_line)
    return Panel(group, title="[bold]Paw Pages[/bold]", subtitle="Ctrl+C to stop both", expand=False)


def main() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    api_port = os.environ.get("PORT", "8000")
    web_port = os.environ.get("FRONTEND_PORT", "5173")

    uv = require_executable("uv")
    npm = require_executable("npm")

    env_file = Path(API_DIR) / ".env"
    if not env_file.exists():
        console.print(
            f"[bold red]Error:[/bold red] {env_file} is missing, so the API "
            f"fails on startup once uvicorn imports it (a wall of pydantic "
            f"ValidationError, not obviously about a missing file).\n"
            f"Copy {API_DIR}/.env.example to {env_file} and fill it in -- see README.md."
        )
        sys.exit(1)

    lan_ip = get_lan_ip()
    with console.status("[dim]Looking up public IP…[/dim]"):
        public_ip = get_public_ip()
    console.print()
    console.print(build_banner(host, api_port, web_port, lan_ip, public_ip))
    console.print()

    api_cmd = [
        uv, "run", "--project", API_DIR,
        "uvicorn", "main:app",
        "--app-dir", API_DIR,
        "--host", host,
        "--port", api_port,
        "--reload",
    ]
    web_cmd = [
        npm, "--prefix", WEB_DIR,
        "run", "dev", "--",
        "--host", host,
        "--port", web_port,
    ]

    api_proc = subprocess.Popen(api_cmd)
    web_proc = subprocess.Popen(web_cmd)
    procs = {"API": api_proc, "Web": web_proc}

    exit_code = 0
    try:
        while True:
            for name, proc in procs.items():
                ret = proc.poll()
                if ret is not None:
                    console.print(f"[bold red]{name} exited with code {ret}[/bold red]")
                    exit_code = ret or 1
                    raise SystemExit
            time.sleep(0.5)
    except (KeyboardInterrupt, SystemExit):
        console.print("\n[yellow]Shutting down…[/yellow]")
    finally:
        for proc in procs.values():
            if proc.poll() is None:
                proc.terminate()
        for proc in procs.values():
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
