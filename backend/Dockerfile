# netgotchi/backend/Dockerfile
# Multi-stage would be cleaner long-term, but single-stage keeps the MVP
# build surface small and the layer cache fast during iteration.
# Note: slim base keeps the image lean. libpcap is included now even though
# we're using raw AF_PACKET sockets -- reserved for Phase 2 BPF filter expressions.

FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    libpcap-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first so Docker layer cache survives main.py edits
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Compile the sniffer. -O3 for aggressive optimization. -Wall catches silent bugs.
COPY sniffer.cpp .
RUN g++ -O3 -Wall -Wextra -o sniffer sniffer.cpp

COPY main.py .

EXPOSE 8000

# Lightweight health check -- just pings the /health endpoint
HEALTHCHECK --interval=10s --timeout=5s --start-period=8s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
