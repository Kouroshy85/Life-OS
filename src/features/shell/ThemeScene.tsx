/**
 * The illustrated world behind each theme. Everything is drawn here as vector shapes,
 * so it stays sharp at any window size and adds nothing to download. Scenes sit at the
 * edges of the screen, behind panels that are made solid enough to keep text readable.
 */

import { useApp } from "../../state/store";

const VIEW = { viewBox: "0 0 1600 900", preserveAspectRatio: "xMidYMax slice" } as const;

// ---- shared drawings --------------------------------------------------------------

function Fern({ x, y, scale = 1, flip = false, color }: { x: number; y: number; scale?: number; flip?: boolean; color: string }) {
  const leaves = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    const len = 62 * (1 - t * 0.7);
    const py = -i * 24;
    return (
      <g key={i} transform={`translate(${Math.sin(t * 1.4) * 36} ${py})`}>
        <path d={`M0 0 Q ${len * 0.5} -22 ${len} -8 Q ${len * 0.45} 2 0 0Z`} fill={color} />
        <path d={`M0 0 Q ${-len * 0.5} -22 ${-len} -8 Q ${-len * 0.45} 2 0 0Z`} fill={color} />
      </g>
    );
  });
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}>
      <path d="M0 0 Q 16 -110 36 -200" stroke={color} strokeWidth="4" fill="none" />
      {leaves}
    </g>
  );
}

function BroadTree({ x, y, s = 1, trunk, leaf, leaf2 }: { x: number; y: number; s?: number; trunk: string; leaf: string; leaf2: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-20 0 Q -12 -110 -16 -210 L 16 -210 Q 12 -110 24 0Z" fill={trunk} />
      <path d="M-6 -150 Q -46 -180 -70 -220 M8 -130 Q 42 -170 76 -196" stroke={trunk} strokeWidth="11" fill="none" strokeLinecap="round" />
      <circle cx="-74" cy="-250" r="66" fill={leaf} />
      <circle cx="74" cy="-234" r="72" fill={leaf} />
      <circle cx="0" cy="-306" r="94" fill={leaf2} />
      <circle cx="-34" cy="-224" r="58" fill={leaf2} />
      <circle cx="40" cy="-290" r="50" fill={leaf} />
    </g>
  );
}

function Pine({ x, y, s = 1, color, trunk }: { x: number; y: number; s?: number; color: string; trunk: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-10" y="-46" width="20" height="46" fill={trunk} />
      <path d="M0 -360 L 62 -240 L 32 -240 L 86 -140 L 46 -140 L 104 -40 L -104 -40 L -46 -140 L -86 -140 L -32 -240 L -62 -240Z" fill={color} />
    </g>
  );
}

function Deer({ x, y, s = 1, color, belly }: { x: number; y: number; s?: number; color: string; belly: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {/* far legs */}
      <path d="M58 -74 L 52 -6 L 60 -6 L 72 -74Z M128 -72 L 138 -6 L 146 -6 L 142 -76Z" fill={belly} />
      {/* antlers */}
      <g stroke={color} strokeWidth="4" fill="none" strokeLinecap="round">
        <path d="M34 -158 Q 26 -190 44 -212 M31 -180 L 14 -196 M36 -196 L 56 -204" />
        <path d="M24 -156 Q 8 -182 14 -210 M11 -178 L -6 -188 M12 -196 L -2 -214" />
      </g>
      {/* body, neck and head */}
      <path d="M46 -112 Q 44 -136 30 -150 L 22 -146 Q 6 -146 -6 -134 Q -12 -128 -2 -124 L 18 -122 Q 28 -102 36 -84 Q 60 -66 112 -68 Q 158 -66 160 -104 Q 158 -128 122 -128 Q 80 -128 46 -112Z" fill={color} />
      <path d="M26 -152 Q 38 -168 44 -168 Q 44 -156 36 -146Z" fill={color} />
      <path d="M150 -116 Q 170 -122 168 -104 Q 160 -104 154 -100Z" fill={belly} />
      {/* near legs */}
      <path d="M44 -78 L 38 0 L 47 0 L 62 -72Z M138 -80 L 152 0 L 161 0 L 158 -86Z" fill={color} />
      <circle cx="8" cy="-138" r="2.4" fill="#000" opacity="0.7" />
    </g>
  );
}

function Rabbit({ x, y, s = 1, color, ear }: { x: number; y: number; s?: number; color: string; ear: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="-22" cy="-92" rx="9" ry="30" fill={color} transform="rotate(-12 -22 -92)" />
      <ellipse cx="-4" cy="-94" rx="9" ry="30" fill={color} transform="rotate(10 -4 -94)" />
      <ellipse cx="-4" cy="-94" rx="4" ry="22" fill={ear} transform="rotate(10 -4 -94)" />
      <ellipse cx="30" cy="-30" rx="38" ry="30" fill={color} />
      <circle cx="-12" cy="-54" r="23" fill={color} />
      <ellipse cx="4" cy="-4" rx="24" ry="8" fill={color} />
      <circle cx="68" cy="-34" r="11" fill="#f1ead8" opacity="0.85" />
      <circle cx="-22" cy="-58" r="2.6" fill="#000" opacity="0.7" />
    </g>
  );
}

// ---- scenes ------------------------------------------------------------------------

function JungleScene() {
  const dark = "#16261a";
  const green = "#1a3020";
  const green2 = "#203a27";
  const trunk = "#3a2618";
  return (
    <svg className="scene scene--jungle" {...VIEW}>
      <path d="M0 900 V 760 Q 300 690 620 770 T 1200 760 T 1600 730 V 900Z" fill="#1a130b" />
      <g opacity="0.55">
        <Pine x={330} y={800} s={0.72} color={dark} trunk={trunk} />
        <Pine x={1120} y={790} s={0.8} color={dark} trunk={trunk} />
        <Pine x={1290} y={780} s={0.62} color={dark} trunk={trunk} />
      </g>
      <BroadTree x={110} y={860} s={1.5} trunk={trunk} leaf={green} leaf2={green2} />
      <BroadTree x={1490} y={870} s={1.65} trunk={trunk} leaf={green} leaf2={green2} />
      <path d="M0 900 V 830 Q 400 790 800 835 T 1600 815 V 900Z" fill="#241a0f" />
      <g className="scene__sway">
        <Fern x={18} y={900} scale={1.1} color={green2} />
        <Fern x={1580} y={900} scale={1.2} flip color={green2} />
        <Fern x={1320} y={896} scale={0.6} color={green} />
        <Fern x={430} y={896} scale={0.55} flip color={green} />
      </g>
      <Deer x={980} y={858} s={1.1} color="#6b4729" belly="#4e331c" />
      <Rabbit x={520} y={868} s={0.62} color="#8d6d4b" ear="#b98f73" />
      <Rabbit x={630} y={872} s={0.42} color="#755a3d" ear="#a07c62" />
      {[[240, 520], [420, 640], [640, 700], [980, 610], [1210, 500], [1400, 620], [800, 560]].map(([cx, cy], i) => (
        <circle key={i} className="scene__fly" style={{ animationDelay: `${i * -0.9}s` }} cx={cx} cy={cy} r="3.4" fill="#d8e68a" />
      ))}
    </svg>
  );
}

function ShadowScene() {
  return (
    <svg className="scene scene--shadow" {...VIEW}>
      <defs>
        <radialGradient id="shadow-light" cx="0.68" cy="0.3" r="0.72">
          <stop offset="0" stopColor="#fff" stopOpacity="0.19" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id="shadow-soft"><feGaussianBlur stdDeviation="9" /></filter>
        <filter id="shadow-softer"><feGaussianBlur stdDeviation="26" /></filter>
      </defs>
      <rect width="1600" height="900" fill="url(#shadow-light)" />
      {/* light through blinds, falling across the wall */}
      <g className="scene__blinds" filter="url(#shadow-soft)" transform="rotate(-14 800 450)">
        {Array.from({ length: 11 }, (_, i) => (
          <rect key={i} x="420" y={-40 + i * 62} width="1500" height="24" fill="#fff" opacity="0.055" />
        ))}
      </g>
      {/* a long cast shadow stretching from a figure at the edge */}
      <g filter="url(#shadow-softer)" opacity="0.95">
        <path d="M1540 900 L 1400 900 L 560 330 L 610 290 Z" fill="#000" />
        <circle cx="548" cy="282" r="62" fill="#000" />
      </g>
      <g fill="#000">
        <path d="M1454 900 V 700 Q 1454 640 1496 626 Q 1466 604 1472 566 Q 1480 528 1520 528 Q 1560 528 1566 568 Q 1570 606 1542 626 Q 1590 642 1590 700 V 900Z" />
      </g>
      <g className="scene__drift" filter="url(#shadow-softer)">
        <ellipse cx="240" cy="780" rx="320" ry="110" fill="#000" />
        <ellipse cx="900" cy="60" rx="420" ry="90" fill="#000" opacity="0.8" />
      </g>
    </svg>
  );
}

function StrawberryScene() {
  const colors = ["#ff7eb6", "#ffa36c", "#ffe06c", "#8ee6a8", "#7cc8ff", "#b48cff"];
  return (
    <svg className="scene scene--strawberry" {...VIEW}>
      <g className="scene__rainbow" fill="none" strokeWidth="26" opacity="0.6">
        {colors.map((c, i) => (
          <path key={c} d={`M ${500 + i * 26} 900 A ${620 - i * 26} ${620 - i * 26} 0 0 1 ${1740 - i * 26} 900`} stroke={c} />
        ))}
      </g>
      <g fill="#fff" className="scene__drift">
        <ellipse cx="570" cy="858" rx="130" ry="48" />
        <ellipse cx="500" cy="870" rx="84" ry="36" />
        <ellipse cx="650" cy="874" rx="90" ry="34" />
      </g>
      {/* unicorn */}
      <g className="scene__shift">
      <g transform="translate(1130 880) scale(1.3)">
        <path d="M172 -112 Q 214 -128 208 -60 Q 206 -30 192 -18 Q 200 -62 170 -78Z" fill="#b48cff" />
        <path d="M170 -92 Q 202 -100 196 -50 Q 192 -30 186 -24 Q 188 -60 164 -74Z" fill="#ff7eb6" />
        <path d="M60 -70 L 52 0 L 64 0 L 80 -66Z M150 -70 L 164 0 L 176 0 L 170 -80Z" fill="#f3d9ec" />
        <path d="M60 -116 Q 54 -150 36 -172 L 18 -166 Q -8 -160 -26 -142 Q -34 -130 -20 -126 L 8 -124 Q 24 -104 34 -78 Q 66 -54 126 -56 Q 180 -56 182 -100 Q 178 -128 134 -130 Q 92 -132 60 -116Z" fill="#ffffff" />
        <path d="M42 -74 L 32 0 L 44 0 L 66 -66Z M132 -74 L 144 0 L 156 0 L 152 -80Z" fill="#ffffff" />
        <path d="M32 -172 L 44 -194 L 48 -168Z" fill="#ffffff" />
        <path d="M18 -168 L 34 -232 L 34 -164Z" fill="#ffd166" />
        <path d="M24 -192 L 32 -196 M21 -180 L 33 -184 M27 -208 L 33 -210" stroke="#f0a020" strokeWidth="2.4" />
        <path d="M34 -172 Q 66 -168 76 -128 Q 82 -108 66 -92 Q 60 -128 40 -146 Q 58 -112 44 -92 Q 40 -128 26 -150Z" fill="#ff7eb6" />
        <path d="M30 -168 Q 56 -160 62 -130 Q 50 -146 28 -156Z" fill="#b48cff" />
        <circle cx="4" cy="-146" r="3.4" fill="#43164a" />
        <path d="M0 -142 Q 4 -138 8 -142" stroke="#43164a" strokeWidth="1.4" fill="none" />
        <ellipse cx="-14" cy="-136" rx="7" ry="4" fill="#ffc2dd" />
      </g>
      </g>
      {[[520, 640], [640, 480], [380, 400], [1040, 300], [1380, 170], [760, 250], [240, 300], [1500, 420]].map(([x, y], i) => (
        <path key={i} className="scene__twinkle" style={{ animationDelay: `${i * -0.7}s`, transformOrigin: `${x}px ${y}px` }} d={`M${x} ${y - 14} L${x + 4} ${y - 4} L${x + 14} ${y} L${x + 4} ${y + 4} L${x} ${y + 14} L${x - 4} ${y + 4} L${x - 14} ${y} L${x - 4} ${y - 4}Z`} fill={i % 2 ? "#b48cff" : "#ff7eb6"} />
      ))}
    </svg>
  );
}

function NeutralScene() {
  return (
    <svg className="scene scene--neutral" {...VIEW}>
      {/* broad dry strokes of paint */}
      <g fill="none" strokeLinecap="round">
        <path d="M-40 780 Q 300 660 620 740 T 1240 680" stroke="#ccbeb1" strokeWidth="96" opacity="0.5" />
        <path d="M-40 850 Q 340 760 700 820 T 1320 780" stroke="#997e67" strokeWidth="44" opacity="0.32" />
      </g>
      {[[1090, 690, 9], [1130, 650, 5], [1062, 640, 6], [1040, 690, 3]].map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="#997e67" opacity="0.5" />
      ))}
      {/* the brush, resting across the corner */}
      <g transform="translate(1180 700) rotate(32) scale(1.25)">
        <rect x="118" y="-13" width="420" height="26" rx="13" fill="#664930" />
        <path d="M118 -13 L 300 -7 V 7 L 118 13Z" fill="#7a5a3f" />
        <rect x="58" y="-19" width="68" height="38" rx="5" fill="#ccbeb1" />
        <rect x="68" y="-19" width="7" height="38" fill="#997e67" />
        <rect x="108" y="-19" width="7" height="38" fill="#997e67" />
        <path d="M60 -19 Q 10 -24 -66 0 Q 10 24 60 19Z" fill="#997e67" />
        <path d="M18 -14 Q -26 -10 -66 0 Q -26 10 18 14 Q 2 0 18 -14Z" fill="#664930" />
        <path d="M50 -9 L 2 -5 M50 9 L 2 5 M50 0 L -18 0" stroke="#ffdbbb" strokeWidth="1.6" opacity="0.5" />
      </g>
    </svg>
  );
}

function Cloud({ x, y, s, color, shade, className }: { x: number; y: number; s: number; color: string; shade: string; className?: string }) {
  return (
    <g className={className} filter="url(#cloud-soft)" transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="18" rx="146" ry="30" fill={shade} opacity="0.75" />
      <circle cx="-70" cy="-6" r="50" fill={color} />
      <circle cx="0" cy="-30" r="66" fill={color} />
      <circle cx="74" cy="-8" r="48" fill={color} />
      <ellipse cx="0" cy="6" rx="146" ry="32" fill={color} />
    </g>
  );
}

function SkyScene() {
  const drops = Array.from({ length: 70 }, (_, i) => ({
    x: (i * 137) % 1640,
    y: (i * 71) % 520,
    len: 18 + (i % 4) * 8,
    delay: (i * 0.137) % 1.6,
    dur: 1.1 + (i % 5) * 0.14,
  }));
  return (
    <svg className="scene scene--sky" {...VIEW}>
      <defs>
        <filter id="cloud-soft"><feGaussianBlur stdDeviation="3.5" /></filter>
      </defs>
      <g className="scene__rain" stroke="#7fa3c0" strokeWidth="1.3" strokeLinecap="round">
        {drops.map((d, i) => (
          <line key={i} x1={d.x} y1={d.y} x2={d.x - d.len * 0.22} y2={d.y + d.len} style={{ animationDelay: `-${d.delay}s`, animationDuration: `${d.dur}s` }} />
        ))}
      </g>
      <g className="scene__cloud-a"><Cloud x={260} y={150} s={1.25} color="#ffffff" shade="#b9c9d6" /></g>
      <g className="scene__cloud-b"><Cloud x={1320} y={110} s={1.5} color="#f4f8fb" shade="#a9bbc9" /></g>
      <g className="scene__cloud-c"><Cloud x={780} y={70} s={0.8} color="#dfe8ef" shade="#a9bbc9" /></g>
      <g className="scene__cloud-a"><Cloud x={1500} y={760} s={1.1} color="#ffffff" shade="#c6d3dd" /></g>
      <g className="scene__cloud-b"><Cloud x={80} y={800} s={1.3} color="#f4f8fb" shade="#b9c9d6" /></g>
    </svg>
  );
}

function WineScene() {
  return (
    <svg className="scene scene--wine" {...VIEW}>
      <defs>
        <linearGradient id="wine-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8e1b2e" />
          <stop offset="1" stopColor="#4a0a15" />
        </linearGradient>
        <linearGradient id="blood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d0a14" />
          <stop offset="1" stopColor="#6a1222" />
        </linearGradient>
      </defs>
      {/* running down from the top edge */}
      <path d="M0 0 H1600 V 16 Q 1560 24 1538 18 Q 1522 120 1506 20 Q 1450 12 1400 22 Q 1386 70 1372 20 Q 1260 10 1180 24 Q 1164 210 1146 22 Q 1040 12 960 20 Q 948 62 934 20 Q 780 10 640 24 Q 626 100 610 22 Q 470 12 380 20 Q 364 270 346 22 Q 220 12 150 20 Q 138 80 122 20 Q 60 12 0 20Z" fill="url(#blood)" />
      {[[1155, 216, 0], [355, 276, 1.6], [1515, 128, 3.1], [618, 108, 4.4]].map(([cx, cy, delay], i) => (
        <path key={i} className="scene__drop" style={{ animationDelay: `${delay}s` }} d={`M${cx} ${cy} q 7 15 0 22 q -7 -7 0 -22Z`} fill="#a01f34" />
      ))}
      {/* the glass */}
      <g className="scene__shift">
      <g transform="translate(1340 900)">
        <ellipse cx="0" cy="-6" rx="84" ry="12" fill="#3a1a20" />
        <rect x="-5" y="-210" width="10" height="200" fill="#3a1a20" />
        <path d="M-96 -470 Q -112 -300 -20 -226 Q 0 -212 20 -226 Q 112 -300 96 -470Z" fill="#f6e9ea" opacity="0.07" />
        <path d="M-101 -360 Q -92 -272 -20 -226 Q 0 -212 20 -226 Q 92 -272 101 -360 Q 0 -336 -101 -360Z" fill="url(#wine-fill)" />
        <ellipse cx="0" cy="-360" rx="101" ry="14" fill="#a82a3f" />
        <path d="M-96 -470 Q -112 -300 -20 -226 Q 0 -212 20 -226 Q 112 -300 96 -470" fill="none" stroke="#f6e9ea" strokeOpacity="0.3" strokeWidth="3" />
        <ellipse cx="0" cy="-470" rx="96" ry="12" fill="none" stroke="#f6e9ea" strokeOpacity="0.3" strokeWidth="3" />
        <path d="M-74 -448 Q -84 -340 -40 -282" fill="none" stroke="#f6e9ea" strokeOpacity="0.22" strokeWidth="6" strokeLinecap="round" />
      </g>
      </g>
      {/* a crumpled tissue, with a stain */}
      <g transform="translate(1080 862) rotate(-6) scale(0.72)" opacity="0.8">
        <path d="M-120 34 L -92 -46 L -38 -84 L 18 -62 L 72 -92 L 118 -30 L 104 34 Q 0 56 -120 34Z" fill="#e9dcdc" opacity="0.9" />
        <path d="M-92 -46 L -30 -8 L -38 -84 Z M18 -62 L -30 -8 L 34 12 Z M72 -92 L 34 12 L 118 -30Z" fill="#fff" opacity="0.62" />
        <path d="M-120 34 L -30 -8 L 34 12 L 104 34Z" fill="#cdbcbc" opacity="0.72" />
        <path d="M-8 -26 Q 22 -40 40 -18 Q 54 2 30 12 Q 6 22 -12 6 Q -26 -12 -8 -26Z" fill="#8e1b2e" opacity="0.82" />
        <circle cx="58" cy="-22" r="6" fill="#8e1b2e" opacity="0.7" />
      </g>
    </svg>
  );
}

const SCENES: Record<string, () => React.JSX.Element> = {
  jungle: JungleScene,
  shadow: ShadowScene,
  strawberry: StrawberryScene,
  neutral: NeutralScene,
  sky: SkyScene,
  wine: WineScene,
};

export function ThemeScene() {
  const theme = useApp((s) => s.theme);
  const Scene = SCENES[theme];
  return Scene ? (
    <div className="scene-layer" aria-hidden="true" key={theme}>
      <Scene />
    </div>
  ) : null;
}
