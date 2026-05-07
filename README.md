# NetGotchi

```
  _   _      _    ___      _       _     _ 
 | \ | | ___| |_ / __| ___| |_ ___| |__ (_)
 |  \| |/ _ \ __| (_  / _ \ __/ __| '_ \| |
 | |\  |  __/ |_ \__ \ (_) | || (__| | | | |
 |_| \_|\___|\__|___/\___/ \__\___|_| |_|_|
```
**Author:** Guram Sikharulidze  
**Built:** May 2026 | Portfolio Project for Cybersecurity Engineering Interview 
**NetGotchi** is a minimalist, terminal-driven network security monitoring daemon. It combines a low-level C++ packet sniffer with a FastAPI heuristic engine and WebSocket-streamed React frontend to provide real-time network threat classification and synthetic entity state decay.

## Architecture Overview

### System Design Philosophy

NetGotchi follows a **three-layer, horizontally decoupled architecture**:

1. **Packet Capture Layer** (C++ daemon)
2. **Heuristic Processing Layer** (FastAPI broker)
3. **Visualization Layer** (React frontend)

This separation ensures:
- **Performance isolation**: The sniffer runs independently and can be swapped for alternative implementations without rebuilding the entire stack
- **Security principle of least privilege**: Each component runs with only the capabilities it requires
- **Stateless frontend**: UI remains decoupled from backend logic, enabling horizontal scaling

### Layer 1: Raw Socket Sniffer (`sniffer.cpp`)

The C++ daemon operates via raw Linux sockets to capture Ethernet frames directly from the interface. It:

- **Initializes a raw socket** via `AF_PACKET` (layer 2) bound to `ETH_P_ALL`
- **Filters at userland** for IP packets (avoiding kernel overhead)
- **Extracts L3/L4 metadata** (src/dst IP, protocol, ports)
- **Streams JSON** to stdout for asynchronous consumption by the Python broker

**Design Note:** This MVP uses userland parsing for simplicity and portability. For production deployments at scale, this will be ported to **eBPF/XDP** (extended Berkeley Packet Filter / eXpress Data Path) to bypass the kernel network stack entirely, eliminating the syscall overhead of `recvfrom()`. This is a known bottleneck in high-throughput network monitoring.

**Capability Model:** The sniffer **requires only `CAP_NET_RAW`**, not full `--privileged` mode. This demonstrates adherence to the principle of least privilege—a critical concern for security-conscious organizations evaluating infrastructure components.

### Layer 2: Heuristic Engine (`main.py`)

The FastAPI broker is the **orchestration hub**:

- **Subprocess Management**: Spawns the C++ sniffer as a child process and consumes its stdout asynchronously
- **IPC Strategy**: Leverages Python's `asyncio.create_subprocess_exec()` with line-buffered JSON parsing. This lightweight decoupling avoids shared memory (preventing race conditions) and allows independent lifecycle management
- **Threat Classification**: Applies mock ML heuristics (suspicious port detection, ICMP anomaly detection). In production, this feeds tensors to pre-trained neural network anomaly detectors
- **State Mutation**: Adjusts synthetic daemon state metrics:
  - `integrity` (0-100): Decrements on malicious packets, increments on safe traffic
  - `corruption` (0-100): Inverse of integrity; triggers status escalation
  - `status`: Tri-state (NOMINAL, DEGRADED, CRITICAL) based on corruption thresholds
- **WebSocket Multiplexing**: Maintains a client registry and broadcasts state + packet metadata to all connected UI subscribers

**Zero Hardcoded Credentials:** Environment variables are used for future API integrations (pfSense, iptables, AWS Security Groups). The `.env` file is excluded from version control.

### Layer 3: Frontend (`App.jsx`)

A React component with **inline styling** (no external CSS frameworks) for a strict phosphor-monitor aesthetic:

- **WebSocket Consumer**: Subscribes to `/ws/feed` and renders a scrolling packet log
- **Real-time State Sync**: Live updates to integrity, corruption, and status
- **Terminal CLI Emulation**: Input field accepts firewall rules (e.g., `DROP tcp dst port 4444`)
- **Color Coding**: Malicious packets rendered in alert red, safe packets in terminal green
- **Memory-Safe Scrolling**: Limits feed buffer to 60 packets to prevent DOM bloat

---

## Docker Containerization

### Backend Container (`backend/Dockerfile`)

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y g++ libpcap-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn websockets pydantic

COPY sniffer.cpp .
RUN g++ -O3 sniffer.cpp -o sniffer

COPY main.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Design Notes:**
- `-O3` compiler flag enables aggressive optimizations for the sniffer binary
- libpcap is included for future pcap-based packet filtering (currently unused but reserved for enhanced filtering logic)

### Compose Orchestration (`docker-compose.yml`)

```yaml
services:
  backend:
    build:
      context: ./backend
    ports:
      - "8000:8000"
    cap_drop:
      - ALL
    cap_add:
      - NET_RAW
      - NET_ADMIN
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 8s
    environment:
      - PYTHONUNBUFFERED=1

  frontend:
    image: node:18-alpine
    working_dir: /app
    volumes:
      - ./frontend:/app
    command: sh -c "npm install && npm run dev -- --host"
    ports:
      - "5173:5173"
    depends_on:
      backend:
        condition: service_healthy
    environment:
      - VITE_API_HOST=localhost:8000
      - CHOKIDAR_USEPOLLING=true
```

**Key Design Decisions:**

1. **`cap_drop: ALL` then `cap_add`**: Dropping all capabilities first and then re-adding only the two required ones is a CIS Docker Benchmark best practice. The explicit allowlist is narrower and more auditable than the default Docker capability set.

2. **`CAP_NET_RAW` and `CAP_NET_ADMIN`** (not `--privileged`):
   - `CAP_NET_RAW`: Allows raw socket creation
   - `CAP_NET_ADMIN`: Reserved for future iptables/nftables rule injection
   - This is **NOT** equivalent to running as `--privileged`, which grants all 38 Linux capabilities. Explicit capability grants demonstrate production-grade security hardening.

3. **`depends_on` with `service_healthy`**: The frontend container waits for the backend's `/health` endpoint to pass before starting. Prevents the React app from loading against a cold backend and showing spurious WebSocket errors on first open.

4. **Frontend volume mount**: Enables live-reload during development. In production, the frontend should be built to a static artifact and served by a reverse proxy (nginx).

---

## Developer Guide

### Local Setup & Execution

#### Prerequisites
- Docker & Docker Compose installed
- Linux host (raw socket capture is Unix-specific; requires WSL2 on Windows)
- Network interface with sufficient traffic for testing (or run `nmap` to generate synthetic traffic)

#### Directory Structure
```
netgotchi/
├── backend/
│   ├── sniffer.cpp
│   ├── main.py
│   └── Dockerfile
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
├── docker-compose.yml
├── .gitignore
└── README.md
```

#### Spin-Up Instructions

1. **Clone and navigate:**
   ```bash
   git clone <repo>
   cd netgotchi
   ```

2. **Build and run:**
   ```bash
   docker-compose up --build
   ```

   The backend will immediately spawn the sniffer and begin frame capture. Watch for logs like:
   ```
   backend_1  | INFO:     Application startup complete [uvicorn]
   ```

3. **Access the UI:**
   Open your browser to `http://localhost:5173`. You should see the NetGotchi dashboard with live packet telemetry.

4. **Generate Traffic (Testing):**
   In another terminal, run an nmap scan to trigger suspicious port detection:
   ```bash
   nmap -p 22,23,3389,4444,445 localhost
   ```

   Watch the `corruption` metric rise in real-time as the daemon classifies ports 22/23/3389/445 as malicious. Use the terminal CLI to deploy mock firewall rules.

---

## Security Posture & GitHub Publishing

### Credential Management

**Rule: Zero hardcoded credentials in version control.**

While the MVP operates purely locally, future iterations will integrate with:
- **pfSense API** (firewall rule injection)
- **iptables/nftables** (host-level packet filtering)
- **AWS Security Groups** (cloud egress control)
- **Datadog/Splunk** (anomaly telemetry ingestion)

All API keys, tokens, and connection strings **must** be sourced from environment variables. Example:

```python
# main.py
import os
FIREWALL_API_KEY = os.getenv("FIREWALL_API_KEY")
if not FIREWALL_API_KEY:
    raise ValueError("Missing FIREWALL_API_KEY environment variable")
```

**.env files** are gitignored and should be managed via:
- Docker secrets (production)
- GitHub Actions encrypted secrets (CI/CD)
- HashiCorp Vault (enterprise)

### No Packet Captures in Version Control

**Rule: Never commit `.pcap` or `.pcapng` files.**

Packet captures inadvertently leak:
- Session tokens (OAuth, JWT)
- Internal IP topology
- Private DNS queries
- Proprietary application traffic signatures

These files are gitignored. Any infrastructure logs containing traffic data should be redacted before commit.

### README Architecture Defense (For Hiring Managers)

**Capability-Based Security (Not `--privileged`):**

The use of `CAP_NET_RAW` instead of `--privileged` demonstrates:
- Deep understanding of Linux security models
- Commitment to the principle of least privilege
- Production-grade containerization practices
- Alignment with CIS Docker Benchmark recommendations

**IPC Strategy (Subprocess Piping):**

The choice to spawn the sniffer as a subprocess and consume its stdout via `asyncio` demonstrates:
- Understanding of lightweight, stateless decoupling
- Avoidance of shared memory (which introduces race conditions and debugging complexity)
- Architectural flexibility: the sniffer binary can be replaced, restarted, or horizontally scaled without affecting the broker
- This pattern scales naturally to multi-sniffer deployments where multiple binaries feed a single aggregation point

**Future eBPF/XDP Roadmap:**

The MVP explicitly mentions porting the C++ userland sniffer to eBPF/XDP. This signals:
- Awareness of kernel-space vs. userland tradeoffs
- Understanding of modern Linux networking optimization (bypass the full network stack)
- Recognition that `recvfrom()` syscalls become bottlenecks above ~100k pps (packets per second)
- Production-grade thinking about observable-scale infrastructure

---

## Production Roadmap

### Phase 1: Kernel Bypass (eBPF/XDP)
- Replace userland C++ sniffer with eBPF bytecode
- Eliminate syscall overhead; run packet processing in kernel
- Target: 1M+ pps throughput on commodity hardware

### Phase 2: ML Anomaly Detection
- Replace heuristic rule engine with pre-trained neural network
- Ingest pre-computed embeddings from packet metadata
- Support continuous model retraining via feedback loop

### Phase 3: Distributed Architecture
- Deploy multiple sniffers across network segments
- Implement time-series correlation to detect lateral movement
- Add Kubernetes operator for auto-scaling sniffer pods

### Phase 4: Firewall Integration
- Hook into pfSense API for automated rule injection
- Implement nftables backend for Linux hosts
- Support AWS Security Groups, Azure NSGs, GCP firewall policies

---

## Debugging

### Backend Logs
```bash
docker-compose logs backend -f
```

### Frontend Console
Open DevTools (F12) to inspect WebSocket frames and React component state.

### No CAP_NET_RAW Error
If the sniffer fails with "Socket initialization failed", ensure:
1. Docker container has `cap_add: - NET_RAW`
2. Host OS is Linux (raw sockets not available on Windows/macOS Docker Desktop)
3. Sufficient privileges to add capabilities to container

---

## License

MIT — see [LICENSE](./LICENSE).
