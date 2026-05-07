"""
    _   _      _    ___      _       _     _
   | \\ | | ___| |_ / __| ___| |_ ___| |__ (_)
   |  \\| |/ _ \\ __| (_  / _ \\ __/ __| '_ \\| |
   | |\\  |  __/ |_ \\__ \\ (_) | || (__| | | | |
   |_| \\_|\\___|\\___|___/\\___/ \\__\\___|_| |_|_|

   netgotchi :: heuristic broker API
   note: @app.on_event("startup") is deprecated in FastAPI >= 0.93.
         using lifespan context manager instead -- cleaner and future-proof.
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("netgotchi")

# ---------------------------------------------------------------------------
# Config -- pull from env so nothing sensitive lives in source control.
# .env file is gitignored; docker-compose injects these at runtime.
# ---------------------------------------------------------------------------
SNIFFER_BIN   = os.getenv("SNIFFER_BIN", "./sniffer")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")   # lock down in prod: http://localhost:5173
RESTART_DELAY  = float(os.getenv("SNIFFER_RESTART_DELAY_S", "3.0"))

# ---------------------------------------------------------------------------
# Mutable daemon state. A single asyncio event loop means no data races
# here -- Python's GIL + cooperative multitasking keeps this safe without locks.
# In a multi-worker deployment, migrate this to Redis.
# ---------------------------------------------------------------------------
daemon_state: dict = {
    "integrity":         100.0,
    "corruption":        0.0,
    "status":            "NOMINAL",
    "packets_analyzed":  0,
    "sniffer_alive":     False,
}

# Using a set for O(1) add/remove vs list's O(n) remove.
# Mutated only from the single asyncio thread -- no lock needed.
active_connections: Set[WebSocket] = set()

# Demo/test hook: when set to a future timestamp, mutate_state skips the
# safe-packet healing branch. Lets injected corruption stay visible long
# enough to actually see in the UI. The sniffer generates enough traffic
# to heal any corruption in milliseconds otherwise.
_healing_paused_until: float = 0.0


# ---------------------------------------------------------------------------
# Heuristic classifier
# Note: mock implementation. Production feeds packet metadata tensors into
# a pre-trained LSTM anomaly detector with sliding-window baseline comparison.
# ---------------------------------------------------------------------------
SUSPICIOUS_PORTS = frozenset({21, 22, 23, 25, 445, 1433, 3389, 4444, 5900, 6666, 31337})

def analyze_heuristic(packet: dict) -> str:
    dst = packet.get("dst_port", 0)
    src = packet.get("src_port", 0)
    proto = packet.get("protocol", "")
    size  = packet.get("size", 0)

    if dst in SUSPICIOUS_PORTS or src in SUSPICIOUS_PORTS:
        return "MALICIOUS"

    # Oversized ICMP -- classic ping-of-death signature / covert channel
    if proto == "ICMP" and size > 1000:
        return "MALICIOUS"

    # Port 0 in TCP/UDP almost never appears in legitimate traffic
    if proto in ("TCP", "UDP") and (dst == 0 or src == 0):
        return "MALICIOUS"

    return "SAFE"


def mutate_state(classification: str) -> None:
    """Apply classification result to daemon vitals."""
    if classification == "MALICIOUS":
        daemon_state["integrity"]  = max(0.0,   daemon_state["integrity"]  - 0.5)
        daemon_state["corruption"] = min(100.0,  daemon_state["corruption"] + 0.5)
    elif time.time() > _healing_paused_until:
        # Only heal during normal operation -- suppressed while a demo inject
        # is active so the state change is actually visible in the UI.
        daemon_state["integrity"]  = min(100.0,  daemon_state["integrity"]  + 0.1)
        daemon_state["corruption"] = max(0.0,    daemon_state["corruption"] - 0.1)

    daemon_state["packets_analyzed"] += 1

    c = daemon_state["corruption"]
    if   c > 75.0: daemon_state["status"] = "CRITICAL"
    elif c > 40.0: daemon_state["status"] = "DEGRADED"
    else:          daemon_state["status"] = "NOMINAL"


async def broadcast(payload: str) -> None:
    """
    Fan-out to all connected WebSocket clients.
    Stale connections are culled silently -- the client-side reconnect
    loop handles the reconnection cycle.
    """
    dead: Set[WebSocket] = set()
    for ws in active_connections:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    active_connections.difference_update(dead)


# ---------------------------------------------------------------------------
# Sniffer subprocess lifecycle
# Restart loop with fixed delay -- exponential backoff is overkill for a
# single binary that fails fast on missing capabilities.
# ---------------------------------------------------------------------------
async def consume_network_stream() -> None:
    while True:
        logger.info("spawning sniffer binary: %s", SNIFFER_BIN)
        try:
            proc = await asyncio.create_subprocess_exec(
                SNIFFER_BIN,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            daemon_state["sniffer_alive"] = True

            while True:
                line = await proc.stdout.readline()
                if not line:
                    break  # EOF -- process exited

                raw = line.decode("utf-8", errors="replace").strip()
                if not raw:
                    continue

                try:
                    packet = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("unparseable sniffer line: %s", raw[:120])
                    continue

                if "error" in packet:
                    logger.error("sniffer reported error: %s", packet["error"])
                    continue

                classification  = analyze_heuristic(packet)
                packet["classification"] = classification
                mutate_state(classification)

                await broadcast(json.dumps({
                    "state":  daemon_state,
                    "packet": packet,
                }))

            rc = await proc.wait()
            logger.warning("sniffer exited with code %d, restarting in %.1fs", rc, RESTART_DELAY)

        except FileNotFoundError:
            logger.error("sniffer binary not found at '%s'. Was it compiled?", SNIFFER_BIN)
        except Exception as e:
            logger.error("unexpected error in sniffer loop: %s", e)
        finally:
            daemon_state["sniffer_alive"] = False

        await asyncio.sleep(RESTART_DELAY)


# ---------------------------------------------------------------------------
# FastAPI app with lifespan (replaces deprecated @app.on_event)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(consume_network_stream())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="NetGotchi Daemon API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "POST"],   # don't allow PUT/DELETE/PATCH -- not needed
    allow_headers=["Content-Type"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    """Docker HEALTHCHECK + external liveness probe target."""
    return {
        "status":         "ok",
        "sniffer_alive":  daemon_state["sniffer_alive"],
        "uptime_packets": daemon_state["packets_analyzed"],
    }


@app.get("/api/state")
async def get_state():
    """Snapshot endpoint -- useful for initial page load before WS connects."""
    return daemon_state


class FirewallRule(BaseModel):
    rule: str

    # Basic sanitization. Real iptables injection would need much stricter parsing.
    @validator("rule")
    def rule_must_not_be_blank(cls, v):
        if not v.strip():
            raise ValueError("rule cannot be blank")
        if len(v) > 256:
            raise ValueError("rule exceeds max length of 256 chars")
        return v.strip()

@app.post("/api/demo/inject")
async def demo_inject_threat():
    """
    Simulation hook for demos and local testing.
    Cycles NOMINAL → DEGRADED → CRITICAL on successive calls.
    Sets state directly (not incrementally) and suppresses auto-healing
    for 20 seconds so the UI has time to actually show the transition.
    Gate behind auth or remove before any real deployment.
    """
    global _healing_paused_until
    _healing_paused_until = time.time() + 20.0  # hold state for 20s

    current = daemon_state["status"]
    if current in ("NOMINAL", "BOOTING"):
        daemon_state["corruption"] = 52.0   # solidly DEGRADED
        daemon_state["integrity"]  = 48.0
    elif current == "DEGRADED":
        daemon_state["corruption"] = 85.0   # solidly CRITICAL
        daemon_state["integrity"]  = 15.0
    else:
        # CRITICAL → reset to clean
        daemon_state["corruption"] = 0.0
        daemon_state["integrity"]  = 100.0
        _healing_paused_until      = 0.0    # re-enable healing immediately on reset

    c = daemon_state["corruption"]
    if   c > 75.0: daemon_state["status"] = "CRITICAL"
    elif c > 40.0: daemon_state["status"] = "DEGRADED"
    else:          daemon_state["status"] = "NOMINAL"

    await broadcast(json.dumps({"state": daemon_state, "packet": None}))
    return {"daemon_state": daemon_state}

@app.post("/api/firewall")
async def deploy_countermeasure(payload: FirewallRule):
    """
    Placeholder for iptables/nftables/pfSense rule injection.
    Simulates a firewall intervention healing the daemon.
    Note: in production, this parses `payload.rule` into a structured
    nftables command and calls subprocess with a strict argument list
    (never shell=True). Shell injection is a classic footgun here.
    """
    logger.info("countermeasure deployed: %s", payload.rule)
    daemon_state["integrity"]  = min(100.0, daemon_state["integrity"]  + 15.0)
    daemon_state["corruption"] = max(0.0,   daemon_state["corruption"] - 15.0)

    # Re-evaluate status after manual intervention
    c = daemon_state["corruption"]
    if   c > 75.0: daemon_state["status"] = "CRITICAL"
    elif c > 40.0: daemon_state["status"] = "DEGRADED"
    else:          daemon_state["status"] = "NOMINAL"

    return {"status": "rule_injected", "daemon_state": daemon_state}


@app.websocket("/ws/feed")
async def websocket_feed(ws: WebSocket):
    await ws.accept()
    active_connections.add(ws)
    logger.info("ws client connected | active=%d", len(active_connections))

    # Send current state immediately on connect so the UI doesn't show stale
    # data during the first few seconds before a packet arrives.
    await ws.send_text(json.dumps({"state": daemon_state, "packet": None}))

    try:
        while True:
            # Keepalive: reading prevents the connection from going stale.
            # Clients can send arbitrary strings (e.g., "ping") -- we ignore them.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        active_connections.discard(ws)
        logger.info("ws client disconnected | active=%d", len(active_connections))