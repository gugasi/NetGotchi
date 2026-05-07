/*
   DaemonCreature.jsx
   ------------------
   All SVG. No sprites. No assets. Just coordinate math and bezier curves.
   Every number in here was placed by hand on a 200x220 grid sketch.

   The visual direction is somewhere between the spirit companions in Garden Story
   and the follower creatures in Cult of the Lamb -- that cozy-but-eerie energy
   I've always wanted to bring into a security tool. Functional dashboards don't
   have to feel cold.

   I built something similar (functionally, not aesthetically) at one company --
   real-time security monitoring visualized over Grafana. It worked fine.
   But nobody ever smiled looking at it. This is the version that fixes that.

   Blink timing note: constant-interval blinks are the uncanny valley of UI.
   Real eyes blink every 3-7 seconds with natural variance. The irregular
   setTimeout chain here is the same trick Disney's animators figured out
   in the 40s -- life comes from imperfect timing.

   State-driven expression system:
     NOMINAL  -> idle breath, happy eyes, floating data particles, cozy blush
     DEGRADED -> furrowed brows, worried pupils shifted up, faster agitation
     CRITICAL -> wide dilated eyes, open distress mouth, electrical discharge sparks

   SVG animateTransform handles the floating particles -- keeps React render
   loop clean (no JS-driven state for purely decorative motion).
*/

import React, { useState, useEffect } from 'react';

// Palette mirrors App.jsx design tokens.
// Intentional duplication -- this component should be portable without imports.
const P = {
  bg:     '#020c02',
  body:   '#04120a',
  stroke: '#33ff33',
  dim:    '#1a7a1a',
  ghost:  '#071a07',
  white:  '#d8ffd8',
  warn:   '#ffb300',
  alert:  '#ff2442',
};

export default function DaemonCreature({ status = 'NOMINAL' }) {
  const [blinking,  setBlinking]  = useState(false);
  const [shakeTick, setShakeTick] = useState(0);

  // Irregular blink scheduling.
  // 3-7 second window with small random offset per cycle.
  // Anything robotic-feeling breaks the illusion immediately.
  useEffect(() => {
    let handle;
    const schedule = () => {
      handle = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => { setBlinking(false); schedule(); }, 110);
      }, 3000 + Math.random() * 4000);
    };
    schedule();
    return () => clearTimeout(handle);
  }, []);

  // High-frequency tick for the critical shake effect.
  // Sinusoidal displacement -- looks intentional, not glitchy.
  useEffect(() => {
    if (status !== 'CRITICAL') { setShakeTick(0); return; }
    const id = setInterval(() => setShakeTick(t => t + 1), 52);
    return () => clearInterval(id);
  }, [status]);

  const isCritical = status === 'CRITICAL';
  const isDegraded = status === 'DEGRADED';
  const isNominal  = !isCritical && !isDegraded;

  // Sinusoidal shake. Two frequencies combined for less mechanical feel.
  const sx = isCritical ? Math.sin(shakeTick * 0.85) * 3.2 + Math.sin(shakeTick * 1.9) * 1.1 : 0;
  const sy = isCritical ? Math.cos(shakeTick * 1.20) * 1.8 : 0;

  // State-keyed values
  const glowColor = isCritical ? P.alert : isDegraded ? P.warn : P.stroke;
  const blinkRy   = blinking ? 1.4 : isCritical ? 13.5 : isDegraded ? 10 : 12;
  // Pupil offset -- degraded looks up (scared), critical looks outward (panicked)
  const lPx = isDegraded ? 1  : isCritical ? -1.5 : 0;
  const lPy = isDegraded ? -3 : isCritical ?  0.5 : 0.5;
  const rPx = isDegraded ? -1 : isCritical ?  1.5 : 0;
  const rPy = lPy;
  // Dilated pupils in critical state -- pupil dilation is a fear response
  const pupilR = isCritical ? 5 : 3.5;
  // Arm rotation -- raised = distressed, relaxed = calm
  const lArmRot = isCritical ? -42 : isDegraded ? -22 : 0;
  const rArmRot = isCritical ?  42 : isDegraded ?  22 : 0;

  // Heartbeat pulse speed
  const pulseDur = isCritical ? '0.33s' : isDegraded ? '0.7s' : '2.2s';

  return (
    <>
      <style>{`
        /* ---- Creature CSS animation library ---- */

        /* Body animations -- keyed on status */
        @keyframes ng-bob {
          0%,100% { transform: translateY(0px);  }
          50%      { transform: translateY(-5px); }
        }
        @keyframes ng-breathe {
          0%,100% { transform: scale(1, 1);        }
          48%      { transform: scale(0.968, 1.034); }
        }
        @keyframes ng-agitate {
          0%,100% { transform: translate(0,0) rotate(0deg);        }
          18%     { transform: translate(-2.5px, 1px) rotate(-1.4deg); }
          36%     { transform: translate(2.5px,-1px)  rotate( 1.4deg); }
          54%     { transform: translate(-1px,  1px)  rotate(-0.7deg); }
          72%     { transform: translate(1px,  -1px)  rotate( 0.7deg); }
        }

        /* Glow filters -- separate from position animation */
        @keyframes ng-glow-green {
          0%,100% { filter: drop-shadow(0 0 4px #33ff33) drop-shadow(0 0 10px #33ff3320); }
          50%      { filter: drop-shadow(0 0 9px #33ff33) drop-shadow(0 0 22px #33ff3338); }
        }
        @keyframes ng-glow-warn {
          0%,100% { filter: drop-shadow(0 0 6px #ffb300) drop-shadow(0 0 14px #ffb30030); }
          50%      { filter: drop-shadow(0 0 13px #ffb300) drop-shadow(0 0 28px #ffb30050); }
        }
        @keyframes ng-glow-alert {
          0%,100% { filter: drop-shadow(0 0 8px #ff2442) drop-shadow(0 0 18px #ff244240); }
          50%      { filter: drop-shadow(0 0 20px #ff2442) drop-shadow(0 0 40px #ff244265); }
        }

        /* Antenna sway */
        @keyframes ng-sway-l {
          0%,100% { transform: rotate(-5deg); }
          50%      { transform: rotate(6deg);  }
        }
        @keyframes ng-sway-r {
          0%,100% { transform: rotate(5deg);  }
          50%      { transform: rotate(-6deg); }
        }

        /* Eye detail */
        @keyframes ng-limbal-pulse {
          0%,100% { opacity: 0.22; }
          50%      { opacity: 0.45; }
        }

        /* Critical sparks */
        @keyframes ng-spark {
          0%,100% { opacity: 0;   stroke-width: 0; }
          50%      { opacity: 0.9; stroke-width: 1.8; }
        }

        /* Status classes applied to the root <g> */
        .ng-nominal  {
          animation: ng-bob 3.3s ease-in-out infinite,
                     ng-glow-green 2.9s ease-in-out infinite;
        }
        .ng-degraded {
          animation: ng-agitate 0.68s ease-in-out infinite,
                     ng-glow-warn 0.88s ease-in-out infinite;
        }
        .ng-critical {
          animation: ng-glow-alert 0.36s ease-in-out infinite;
        }

        /* Body breathes independently of translate -- no conflict */
        .ng-breathe {
          animation: ng-breathe 3.7s ease-in-out infinite;
          transform-origin: 100px 127px;
        }
        .ng-antenna-l {
          animation: ng-sway-l 2.3s ease-in-out infinite;
          transform-origin: 84px 85px;
        }
        .ng-antenna-r {
          animation: ng-sway-r 2.3s ease-in-out infinite;
          transform-origin: 116px 85px;
        }
      `}</style>

      <svg
        viewBox="0 0 200 220"
        width="185"
        height="185"
        style={{ overflow: 'visible', display: 'block', flexShrink: 0 }}
        aria-label={`NetGotchi daemon spirit -- status: ${status}`}
      >

        {/* Ground shadow. Scales with critical state intensity. */}
        <ellipse
          cx="100" cy="194"
          rx={isCritical ? 44 : 38} ry={isCritical ? 8 : 6}
          fill={glowColor} opacity="0.07"
          style={{ transition: 'rx 0.4s ease, fill 0.5s ease' }}
        />

        {/* ----------------------------------------------------------------
            Root group -- shake transform lives here so it applies to
            everything uniformly without fighting individual animations.
        ---------------------------------------------------------------- */}
        <g
          className={isCritical ? 'ng-critical' : isDegraded ? 'ng-degraded' : 'ng-nominal'}
          style={{ transform: `translate(${sx}px, ${sy}px)` }}
        >

          {/* ---- LEFT ANTENNA ------------------------------------------ */}
          <g className="ng-antenna-l">
            {/* Stem */}
            <line x1="84" y1="85" x2="72" y2="57"
              stroke={glowColor} strokeWidth="2.2" strokeLinecap="round" opacity="0.85"
            />
            {/* Outer glow halo on the tip -- pulses with state */}
            <circle cx="70" cy="53" r="8"
              fill={glowColor}
              opacity={isCritical ? 0.35 : isDegraded ? 0.22 : 0.1}
              style={{ transition: 'opacity 0.5s ease' }}
            />
            {/* Tip ring */}
            <circle cx="70" cy="53" r="5"
              fill={P.body} stroke={glowColor} strokeWidth="1.6"
            />
            {/* Inner fill dot */}
            <circle cx="70" cy="53" r="2.2" fill={glowColor} opacity="0.9" />
          </g>

          {/* ---- RIGHT ANTENNA ----------------------------------------- */}
          <g className="ng-antenna-r">
            <line x1="116" y1="85" x2="128" y2="57"
              stroke={glowColor} strokeWidth="2.2" strokeLinecap="round" opacity="0.85"
            />
            <circle cx="130" cy="53" r="8"
              fill={glowColor}
              opacity={isCritical ? 0.35 : isDegraded ? 0.22 : 0.1}
              style={{ transition: 'opacity 0.5s ease' }}
            />
            <circle cx="130" cy="53" r="5"
              fill={P.body} stroke={glowColor} strokeWidth="1.6"
            />
            <circle cx="130" cy="53" r="2.2" fill={glowColor} opacity="0.9" />
          </g>

          {/* ---- BODY -------------------------------------------------- */}
          <g className="ng-breathe">

            {/* Outer soft halo layer -- expands/contracts with state */}
            <path
              d="M 52 117 C 52 84, 148 84, 148 117 C 148 152, 134 172, 100 174 C 66 172, 52 152, 52 117 Z"
              fill={glowColor} opacity="0.055"
              style={{ transition: 'fill 0.5s ease' }}
            />

            {/* Main body blob.
                The bezier handles are placed to give a gentle pear shape --
                slightly wider at the base than the top.
                Not perfectly symmetric. That's intentional. ---- */}
            <path
              d="M 57 117
                 C 57 87, 143 87, 143 117
                 C 143 150, 130 169, 100 171
                 C 70  169, 57  150, 57  117 Z"
              fill={P.body}
              stroke={glowColor}
              strokeWidth="2.2"
              style={{ transition: 'stroke 0.5s ease' }}
            />

            {/* Top highlight arc -- implies convexity, fakes 3D */}
            <path d="M 74 98 C 87 89, 113 89, 126 98"
              fill="none" stroke={glowColor} strokeWidth="1" opacity="0.14"
            />

            {/* Circuit trace texture. Purely decorative depth.
                The kind of thing you only notice on the second look. ---- */}
            <g stroke={glowColor} strokeWidth="0.9" fill="none" opacity="0.065">
              <line x1="100" y1="146" x2="100" y2="164" />
              <line x1="90"  y1="152" x2="110" y2="152" />
              <line x1="83"  y1="146" x2="83"  y2="164" />
              <line x1="117" y1="146" x2="117" y2="164" />
              <line x1="86"  y1="158" x2="114" y2="158" />
            </g>

            {/* Face plate -- very subtle lighter region behind eyes
                helps them read cleanly against the body ---- */}
            <ellipse cx="100" cy="112" rx="44" ry="32"
              fill={glowColor} opacity="0.022"
            />

          </g>
          {/* end body */}


          {/* ================================================================
              EYES
              Most of the emotional weight is carried here.
              Blink, pupil position, iris color, and dilation all shift
              independently based on status.
              ================================================================ */}

          {/* ---- LEFT EYE ---------------------------------------------- */}
          <g transform="translate(82, 111)">

            {/* Outer glow halo -- subtle depth cue */}
            <circle cx="0" cy="0" r="17" fill={glowColor} opacity="0.06" />

            {/* Sclera
                ry changes: normal (12) / worried squint (10) / wide scared (13.5) / blink (1.4)
                Transition on ry gives a natural squint vs. instant blink feel ---- */}
            <ellipse
              cx="0" cy="0" rx="12" ry={blinkRy}
              fill={P.white}
              style={{ transition: 'ry 0.08s linear, fill 0.3s ease' }}
            />

            {!blinking && (
              <>
                {/* Iris */}
                <circle cx={lPx} cy={lPy} r="7.5"
                  fill={glowColor} opacity="0.90"
                  style={{ transition: 'fill 0.4s ease, cx 0.3s ease, cy 0.3s ease, r 0.3s ease' }}
                />
                {/* Pupil -- dilates in critical state */}
                <circle cx={lPx} cy={lPy} r={pupilR}
                  fill={P.bg}
                  style={{ transition: 'r 0.4s ease' }}
                />
                {/* Primary shine -- top-right quadrant, classic cartoon eye */}
                <circle cx={lPx + 3.8} cy={lPy - 3.8} r="2.4" fill="white" opacity="0.90" />
                {/* Secondary fill-light -- smaller, top-left */}
                <circle cx={lPx - 2.8} cy={lPy - 2.5} r="1.2" fill="white" opacity="0.45" />
                {/* Limbal ring -- thin stroke at iris edge, pulses gently */}
                <circle cx="0" cy="0" r="10.8"
                  fill="none" stroke={glowColor} strokeWidth="0.7"
                  style={{ animation: 'ng-limbal-pulse 2.8s ease-in-out infinite' }}
                />
              </>
            )}

            {/* Furrowed brow -- appears only in worried/critical states.
                Left brow angles: outer-high inner-low = angry.
                Mirrored on right eye = classic concern read. ---- */}
            {(isDegraded || isCritical) && (
              <line
                x1={-11} y1={isDegraded ? -15 : -17}
                x2={  7} y2={isDegraded ? -17 : -21}
                stroke={glowColor} strokeWidth="2.4" strokeLinecap="round"
              />
            )}
          </g>

          {/* ---- RIGHT EYE (mirrored) ---------------------------------- */}
          <g transform="translate(118, 111)">
            <circle cx="0" cy="0" r="17" fill={glowColor} opacity="0.06" />
            <ellipse
              cx="0" cy="0" rx="12" ry={blinkRy}
              fill={P.white}
              style={{ transition: 'ry 0.08s linear, fill 0.3s ease' }}
            />
            {!blinking && (
              <>
                <circle cx={rPx} cy={rPy} r="7.5"
                  fill={glowColor} opacity="0.90"
                  style={{ transition: 'fill 0.4s ease' }}
                />
                <circle cx={rPx} cy={rPy} r={pupilR}
                  fill={P.bg}
                  style={{ transition: 'r 0.4s ease' }}
                />
                <circle cx={rPx + 3.8} cy={rPy - 3.8} r="2.4" fill="white" opacity="0.90" />
                <circle cx={rPx - 2.8} cy={rPy - 2.5} r="1.2" fill="white" opacity="0.45" />
                <circle cx="0" cy="0" r="10.8"
                  fill="none" stroke={glowColor} strokeWidth="0.7"
                  style={{ animation: 'ng-limbal-pulse 2.8s ease-in-out 0.45s infinite' }}
                />
              </>
            )}
            {(isDegraded || isCritical) && (
              <line
                x1={-7} y1={isDegraded ? -17 : -21}
                x2={ 11} y2={isDegraded ? -15 : -17}
                stroke={glowColor} strokeWidth="2.4" strokeLinecap="round"
              />
            )}
          </g>


          {/* ---- MOUTH ------------------------------------------------- */}

          {isNominal && (
            // Content upward curve. Control point sits above midpoint.
            <path d="M 88 132 Q 100 142 112 132"
              fill="none" stroke={glowColor} strokeWidth="2.4" strokeLinecap="round"
              opacity="0.9"
            />
          )}

          {isDegraded && (
            // Slight downward pull -- worried but not panicked
            <path d="M 88 135 Q 100 130 112 135"
              fill="none" stroke={glowColor} strokeWidth="2.4" strokeLinecap="round"
              opacity="0.9"
            />
          )}

          {isCritical && (
            // Open O-mouth distress. Darkness inside reads as depth.
            <>
              <ellipse cx="100" cy="135" rx="12" ry="10"
                fill="none" stroke={glowColor} strokeWidth="2.4"
                opacity="0.9"
              />
              <ellipse cx="100" cy="136" rx="9" ry="7.5" fill="#000a00" opacity="0.95" />
              {/* Little tear drops / sweat -- stress tell */}
              <path d="M 73 116 Q 71 122 74 124" fill="none"
                stroke={P.alert} strokeWidth="1.5" strokeLinecap="round" opacity="0.7"
              />
              <path d="M 70 112 Q 68 117 70 119" fill="none"
                stroke={P.alert} strokeWidth="1.2" strokeLinecap="round" opacity="0.45"
              />
            </>
          )}

          {/* ---- BLUSH ---- Cozy warmth, only in NOMINAL. ---- */}
          {isNominal && (
            <>
              <ellipse cx="67" cy="124" rx="8.5" ry="5" fill={P.stroke} opacity="0.055" />
              <ellipse cx="133" cy="124" rx="8.5" ry="5" fill={P.stroke} opacity="0.055" />
            </>
          )}

          {/* ---- ARMS ---- */}
          {/* Left arm stub -- rotates upward when distressed */}
          <ellipse cx="51" cy="123" rx="10.5" ry="6.5"
            fill={P.body} stroke={glowColor} strokeWidth="1.9"
            transform={`rotate(${lArmRot}, 51, 123)`}
            style={{ transition: 'transform 0.4s ease' }}
          />
          {/* Right arm stub */}
          <ellipse cx="149" cy="123" rx="10.5" ry="6.5"
            fill={P.body} stroke={glowColor} strokeWidth="1.9"
            transform={`rotate(${rArmRot}, 149, 123)`}
            style={{ transition: 'transform 0.4s ease' }}
          />

          {/* ---- FEET ---- Two little nubs */}
          <ellipse cx="87"  cy="171" rx="12.5" ry="7"
            fill={P.body} stroke={glowColor} strokeWidth="1.9"
          />
          <ellipse cx="113" cy="171" rx="12.5" ry="7"
            fill={P.body} stroke={glowColor} strokeWidth="1.9"
          />


          {/* ================================================================
              PARTICLE EFFECTS -- state-specific ambient fx
              All driven by SVG animateTransform, no JS animation loop.
              ================================================================ */}

          {/* NOMINAL: soft data motes drifting upward around the creature */}
          {isNominal && (
            <g>
              {/* Each mote has a slightly different size, position, and duration
                  so they don't look like they're on a loop. ---- */}
              <circle cx="41" cy="110" r="2" fill={P.stroke}>
                <animateTransform attributeName="transform" type="translate"
                  from="0 0" to="-5 -24" dur="2.7s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.55;0" dur="2.7s" repeatCount="indefinite" />
              </circle>
              <circle cx="159" cy="115" r="2" fill={P.stroke}>
                <animateTransform attributeName="transform" type="translate"
                  from="0 0" to="5 -20" dur="2.2s" begin="0.9s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.55;0" dur="2.2s" begin="0.9s" repeatCount="indefinite" />
              </circle>
              <circle cx="58" cy="150" r="1.4" fill={P.stroke}>
                <animateTransform attributeName="transform" type="translate"
                  from="0 0" to="-7 -26" dur="3.3s" begin="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0" dur="3.3s" begin="1.6s" repeatCount="indefinite" />
              </circle>
              <circle cx="143" cy="152" r="1.4" fill={P.stroke}>
                <animateTransform attributeName="transform" type="translate"
                  from="0 0" to="6 -22" dur="2.9s" begin="0.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0" dur="2.9s" begin="0.4s" repeatCount="indefinite" />
              </circle>
              <circle cx="100" cy="75" r="1.2" fill={P.stroke}>
                <animateTransform attributeName="transform" type="translate"
                  from="0 0" to="0 -16" dur="3.8s" begin="2.1s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.3;0" dur="3.8s" begin="2.1s" repeatCount="indefinite" />
              </circle>
            </g>
          )}

          {/* CRITICAL: electrical discharge sparks at body perimeter.
              8 spokes at 45-degree intervals, each staggered by ~0.05s
              so they fire sequentially rather than simultaneously.
              The sequential fire looks like voltage, not a spinner. ---- */}
          {isCritical && [0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
            const rad = deg * Math.PI / 180;
            const x1  = 100 + Math.cos(rad) * 62;
            const y1  = 127 + Math.sin(rad) * 57;
            const x2  = 100 + Math.cos(rad) * 78;
            const y2  = 127 + Math.sin(rad) * 72;
            return (
              <line key={deg}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={P.alert} strokeLinecap="round"
                style={{
                  animation: `ng-spark 0.44s ease-in-out ${(i * 0.055).toFixed(3)}s infinite`,
                }}
              />
            );
          })}

          {/* DEGRADED: two subtle static flickers on either side of body */}
          {isDegraded && (
            <>
              <circle cx="46" cy="130" r="2.5" fill={P.warn}
                style={{ animation: 'ng-spark 0.9s ease-in-out 0s infinite' }}
              />
              <circle cx="154" cy="130" r="2.5" fill={P.warn}
                style={{ animation: 'ng-spark 0.9s ease-in-out 0.45s infinite' }}
              />
            </>
          )}

          {/* ---- STATUS HEARTBEAT DOT
              Pulse speed mirrors the urgency of the current state.
              It's also a connectivity indicator -- if it stops, something is wrong. ---- */}
          <circle cx="100" cy="188" r="3.2" fill={glowColor}
            style={{ transition: 'fill 0.5s ease' }}
          >
            <animate attributeName="opacity"
              values="0.85;0.1;0.85" dur={pulseDur} repeatCount="indefinite"
            />
            <animate attributeName="r"
              values={isCritical ? '3.2;5;3.2' : '3.2;4;3.2'} dur={pulseDur} repeatCount="indefinite"
            />
          </circle>

        </g>
      </svg>
    </>
  );
}
