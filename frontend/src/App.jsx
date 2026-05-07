/*
   netgotchi :: terminal interface
   note: no CSS framework. all styling is intentional and inline.
   the CRT scanline effect is pure CSS -- no canvas, no WebGL.
   phosphor glow is box-shadow layering. old tricks.
*/

import React, { useState, useEffect, useRef, useCallback } from 'react';
import DaemonCreature from './DaemonCreature.jsx';

// ---------------------------------------------------------------------------
// Config -- Vite exposes VITE_* env vars to the browser bundle at build time.
// Set VITE_API_HOST in your .env to override for prod deployments.
// ---------------------------------------------------------------------------
const API_HOST = import.meta.env.VITE_API_HOST || 'localhost:8000';
const WS_URL   = `ws://${API_HOST}/ws/feed`;
const API_URL  = `http://${API_HOST}`;

// ---------------------------------------------------------------------------
// Design tokens. One place to change the whole palette.
// Phosphor P31 green -- the classic monochrome monitor color.
// ---------------------------------------------------------------------------
const C = {
  bg:         '#020c02',
  surface:    '#040f04',
  fg:         '#33ff33',
  fgDim:      '#1a7a1a',
  fgGhost:    '#0d3d0d',
  alert:      '#ff2442',
  alertDim:   '#7a0f1e',
  warn:       '#ffb300',
  warnDim:    '#7a5500',
  border:     '#0d3d0d',
  font:       '"Courier New", Courier, monospace',
};

// ---------------------------------------------------------------------------
// Glow intensities for each state
// ---------------------------------------------------------------------------
const GLOW = {
  NOMINAL:  `0 0 8px ${C.fg}, 0 0 20px rgba(51,255,51,0.3)`,
  DEGRADED: `0 0 8px ${C.warn}, 0 0 20px rgba(255,179,0,0.3)`,
  CRITICAL: `0 0 8px ${C.alert}, 0 0 20px rgba(255,36,66,0.4)`,
  BOOTING:  `0 0 6px ${C.fgDim}`,
};

const STATUS_COLOR = {
  NOMINAL:  C.fg,
  DEGRADED: C.warn,
  CRITICAL: C.alert,
  BOOTING:  C.fgDim,
};

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------
function StatBar({ label, value, color }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: C.fgDim }}>{label}</span>
        <span style={{ color }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: 6, background: C.fgGhost, border: `1px solid ${C.border}` }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: color,
          boxShadow: `0 0 6px ${color}`,
          transition: 'width 0.4s ease, background 0.4s ease',
        }} />
      </div>
    </div>
  );
}

function PacketRow({ pkt, idx }) {
  const isEvil  = pkt.classification === 'MALICIOUS';
  const color   = isEvil ? C.alert : C.fg;
  const ts      = pkt.ts || new Date().toISOString();
  const timeStr = ts.slice(11, 19); // HH:MM:SS from ISO

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      padding: '2px 0',
      fontSize: 12,
      borderBottom: `1px solid ${C.fgGhost}`,
      opacity: 0.9,
      color,
      animation: 'fadeIn 0.2s ease',
    }}>
      <span style={{ color: C.fgDim, flexShrink: 0 }}>{timeStr}</span>
      <span style={{ flexShrink: 0, minWidth: 64, fontWeight: 'bold' }}>
        [{pkt.classification}]
      </span>
      <span style={{ flexShrink: 0, minWidth: 40, color: isEvil ? C.alertDim : C.fgDim }}>
        {pkt.protocol}
      </span>
      <span style={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {pkt.src_ip}:{pkt.src_port} &gt; {pkt.dst_ip}:{pkt.dst_port}
      </span>
      <span style={{ flexShrink: 0, color: C.fgDim }}>{pkt.size}B</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function App() {
  const [state, setState] = useState({
    integrity: 100, corruption: 0, status: 'BOOTING', packets_analyzed: 0,
  });
  const [feed, setFeed]           = useState([]);
  const [cmd, setCmd]             = useState('');
  const [log, setLog]             = useState(['> netgotchi daemon initializing...']);
  const [wsStatus, setWsStatus]   = useState('CONNECTING');
  const [blink, setBlink]         = useState(true);

  const feedEndRef  = useRef(null);
  const wsRef       = useRef(null);
  const retryRef    = useRef(null);
  const retryCount  = useRef(0);

  // Cursor blink -- pure JS interval, no CSS animation to keep it snappy
  useEffect(() => {
    const id = setInterval(() => setBlink(b => !b), 530);
    return () => clearInterval(id);
  }, []);

  const appendLog = useCallback((msg) => {
    setLog(prev => {
      const next = [...prev, `> ${msg}`];
      return next.length > 20 ? next.slice(next.length - 20) : next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // WebSocket lifecycle with exponential backoff reconnection.
  // Disconnects are expected (container restarts, network hiccups).
  // The UI should never just go dark.
  // ---------------------------------------------------------------------------
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setWsStatus('CONNECTING');

    ws.onopen = () => {
      setWsStatus('LIVE');
      retryCount.current = 0;
      appendLog('websocket established -- receiving telemetry');
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.state) setState(data.state);
        if (data.packet) {
          setFeed(prev => {
            const next = [...prev, data.packet];
            // Hard cap at 60 entries -- prevents DOM bloat over long sessions
            return next.length > 60 ? next.slice(next.length - 60) : next;
          });
        }
      } catch (_) { /* malformed frame -- ignore */ }
    };

    ws.onclose = () => {
      setWsStatus('DISCONNECTED');
      const delay = Math.min(1000 * 2 ** retryCount.current, 15000);
      retryCount.current += 1;
      appendLog(`ws closed. reconnecting in ${(delay / 1000).toFixed(0)}s...`);
      retryRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      appendLog('ws error. check backend container status.');
      ws.close();
    };
  }, [appendLog]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Auto-scroll feed
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feed]);

  // ---------------------------------------------------------------------------
  // Firewall CLI
  // ---------------------------------------------------------------------------
  const executeCommand = async (e) => {
    if (e.key !== 'Enter' || !cmd.trim()) return;
    const rule = cmd.trim();
    setCmd('');
    appendLog(`deploying rule: ${rule}`);

    try {
      const res = await fetch(`${API_URL}/api/firewall`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rule }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      appendLog('rule injected -- daemon integrity boosted');
    } catch (err) {
      appendLog(`rule injection failed: ${err.message}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Derived display values
  // DaemonCreature only understands NOMINAL / DEGRADED / CRITICAL.
  // BOOTING maps to NOMINAL visually -- the creature idles while we wait for
  // the first WS frame to arrive and set a real status.
  // ---------------------------------------------------------------------------
  const status        = state.status || 'BOOTING';
  const creatureStatus = (status === 'BOOTING') ? 'NOMINAL' : status;
  const statusCol     = STATUS_COLOR[status] || C.fgDim;
  const glowStr       = GLOW[status] || GLOW.BOOTING;

  // Critical state makes the whole interface pulse -- subtle red bleed on viewport edge
  const criticalOverlay = status === 'CRITICAL'
    ? `inset 0 0 120px rgba(255,36,66,0.08)`
    : 'none';

  return (
    <>
      {/* Global keyframe for fade-in on new packet rows + scrollbar theming */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateX(-4px); } to { opacity: 0.9; } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.fgGhost}; }
        ::selection { background: ${C.fg}; color: ${C.bg}; }
      `}</style>

      <div style={{
        position: 'relative',
        backgroundColor: C.bg,
        color: C.fg,
        fontFamily: C.font,
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: criticalOverlay,
        transition: 'box-shadow 0.6s ease',
      }}>

        {/* CRT scanline overlay -- purely decorative */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10,
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)',
        }} />

        {/* Vignette */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9,
          background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.6) 100%)',
        }} />

        {/* ---------------------------------------------------------------- */}
        {/* HEADER: Logo + Status Bar                                       */}
        {/* ---------------------------------------------------------------- */}
        <header style={{
          borderBottom: `1px solid ${C.border}`,
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          flexShrink: 0,
          position: 'relative',
          zIndex: 1,
        }}>
          <pre style={{
            margin: '0',
            fontSize: 10,
            color: C.fgDim,
            textShadow: `0 0 6px ${C.fgDim}`,
            lineHeight: 1.2,
          }}>{
`  _   _      _    ___      _       _     _
 | \\ | | ___| |_ / __| ___| |_ ___| |__ (_)
 |  \\| |/ _ \\ __| (_  / _ \\ __/ __| '_ \\| |
 | |\\  |  __| |_ \\__ \\ (_) | || (__| | | | |
 |_| \\_|\\___|\\___|___/\\___/ \\__\\___|_| |_|_|`}
          </pre>

          <div style={{
            display: 'flex',
            gap: 24,
            fontSize: 11,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}>
            <span>
              STATUS:{' '}
              <span style={{ color: statusCol, textShadow: glowStr, fontWeight: 'bold' }}>
                {status}
              </span>
            </span>
            <span style={{ color: C.fgDim }}>
              PACKETS: <span style={{ color: C.fg }}>{state.packets_analyzed.toLocaleString()}</span>
            </span>
            <span style={{ color: C.fgDim }}>
              WS: <span style={{ color: wsStatus === 'LIVE' ? C.fg : C.alert }}>{wsStatus}</span>
            </span>
          </div>
        </header>

        {/* ---------------------------------------------------------------- */}
        {/* LEFT SIDEBAR: Daemon creature + stat bars                       */}
        {/* ---------------------------------------------------------------- */}
        <div style={{
          display: 'flex',
          gap: 0,
          flexGrow: 1,
          overflow: 'hidden',
          position: 'relative',
          zIndex: 1,
        }}>
          <div style={{
            width: '220px',
            flexShrink: 0,
            borderRight: `2px solid ${C.border}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px 12px',
            gap: 12,
          }}>

            {/*
              DaemonCreature -- the whole point of this project.
              SVG-native, no sprites, no asset loading. State-reactive.
              BOOTING is mapped to NOMINAL above -- creature idles on startup.
            */}
            <DaemonCreature status={creatureStatus} />

            {/* Stats bars below the creature */}
            <div style={{ width: '100%', paddingTop: 8, borderTop: `1px solid ${C.fgGhost}` }}>
              <StatBar label="INTEGRITY"  value={state.integrity}  color={C.fg} />
              <StatBar label="CORRUPTION" value={state.corruption} color={
                state.corruption > 75 ? C.alert : state.corruption > 40 ? C.warn : C.fgDim
              } />
            </div>
          </div>


          {/* ---------------------------------------------------------------- */}
          {/* RIGHT SIDE: Packet feed + syslog side by side                  */}
          {/* ---------------------------------------------------------------- */}
          <main style={{
            flexGrow: 1,
            display: 'flex',
            gap: 0,
            overflow: 'hidden',
            flexDirection: 'column',
          }}>
          {/* Packet feed */}
          <div style={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            borderRight: `1px solid ${C.border}`,
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '4px 12px',
              fontSize: 10,
              color: C.fgDim,
              borderBottom: `1px solid ${C.border}`,
              flexShrink: 0,
            }}>
              PACKET FEED  --  {feed.length} frames buffered
            </div>
            <div style={{ flexGrow: 1, overflowY: 'auto', padding: '4px 12px' }}>
              {feed.length === 0 && (
                <div style={{ color: C.fgDim, fontSize: 12, marginTop: 16 }}>
                  waiting for packets... (ensure backend has CAP_NET_RAW)
                </div>
              )}
              {feed.map((pkt, i) => (
                <PacketRow key={i} pkt={pkt} idx={i} />
              ))}
              <div ref={feedEndRef} />
            </div>
          </div>

          {/* System log panel */}
          <div style={{
            width: 280,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '4px 10px',
              fontSize: 10,
              color: C.fgDim,
              borderBottom: `1px solid ${C.border}`,
              flexShrink: 0,
            }}>
              DAEMON LOG
            </div>
            <div style={{ flexGrow: 1, overflowY: 'auto', padding: '4px 10px' }}>
              {log.map((line, i) => (
                <div key={i} style={{ fontSize: 11, color: C.fgDim, marginBottom: 3, wordBreak: 'break-all' }}>
                  {line}
                </div>
              ))}
            </div>
          </div>
          </main>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* FOOTER: terminal input                                           */}
        {/* ---------------------------------------------------------------- */}
        <footer style={{
          borderTop: `1px solid ${C.border}`,
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          position: 'relative',
          zIndex: 1,
          background: C.surface,
        }}>
          <span style={{ color: C.fgDim, marginRight: 8, fontSize: 13, flexShrink: 0 }}>
            root@netgotchi:~#
          </span>
          <input
            type="text"
            value={cmd}
            onChange={e => setCmd(e.target.value)}
            onKeyDown={executeCommand}
            placeholder="deploy rule  (e.g., DROP tcp dst port 4444)"
            autoFocus
            style={{
              flexGrow: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: C.fg,
              fontFamily: C.font,
              fontSize: 13,
              caretColor: 'transparent',  // we draw our own cursor below
            }}
          />
          {/* Blinking block cursor */}
          <span style={{
            display: 'inline-block',
            width: 8,
            height: 14,
            background: blink ? C.fg : 'transparent',
            transition: 'background 0.05s',
            marginLeft: 1,
            verticalAlign: 'middle',
          }} />
        </footer>
      </div>
    </>
  );
}

