interface PetMascotProps {
  state: string;
  size?: number;
}

export function PetMascot({ state, size = 56 }: PetMascotProps) {
  const half = size / 2;
  const eyeY = half * 0.38;
  const eyeSpacing = half * 0.28;
  const mouthY = half * 0.62;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="select-none pointer-events-none"
    >
      {/* Body */}
      <circle
        cx={half}
        cy={half}
        r={half - 2}
        className={getBodyClass(state)}
        style={{ transition: "fill 0.3s, opacity 0.3s" }}
      />

      {/* Eyes */}
      <Eyes
        state={state}
        cx1={half - eyeSpacing}
        cx2={half + eyeSpacing}
        cy={eyeY + half * 0.05}
        size={size}
      />

      {/* Mouth */}
      <Mouth state={state} cx={half} cy={mouthY + half * 0.05} size={size} />

      {/* Status indicator */}
      {state === "listening" && (
        <circle
          cx={half}
          cy={half}
          r={half - 1}
          fill="none"
          stroke="rgba(52, 211, 153, 0.4)"
          strokeWidth={2}
          className="animate-ping"
          style={{ animationDuration: "1.5s" }}
        />
      )}
    </svg>
  );
}

function Eyes({
  state,
  cx1,
  cx2,
  cy,
  size,
}: {
  state: string;
  cx1: number;
  cx2: number;
  cy: number;
  size: number;
}) {
  const r = size * 0.045;

  if (state === "processing" || state === "speaking") {
    // Focused eyes — smaller, looking slightly up
    return (
      <>
        <circle cx={cx1} cy={cy - 1} r={r * 0.8} fill="white" opacity={0.9}>
          <animate attributeName="cy" values={`${cy - 1};${cy - 2};${cy - 1}`} dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx={cx2} cy={cy - 1} r={r * 0.8} fill="white" opacity={0.9}>
          <animate attributeName="cy" values={`${cy - 1};${cy - 2};${cy - 1}`} dur="2s" repeatCount="indefinite" />
        </circle>
      </>
    );
  }

  if (state === "completed") {
    // Narrowed scheming eyes — evil squint
    return (
      <>
        <path
          d={`M ${cx1 - r * 1.2} ${cy + r * 0.3} Q ${cx1} ${cy - r * 1.5} ${cx1 + r * 1.2} ${cy + r * 0.3}`}
          fill="none"
          stroke="white"
          strokeWidth={1.8}
          strokeLinecap="round"
          opacity={0.95}
        />
        <path
          d={`M ${cx2 - r * 1.2} ${cy + r * 0.3} Q ${cx2} ${cy - r * 1.5} ${cx2 + r * 1.2} ${cy + r * 0.3}`}
          fill="none"
          stroke="white"
          strokeWidth={1.8}
          strokeLinecap="round"
          opacity={0.95}
        />
      </>
    );
  }

  if (state === "waiting" || state === "error") {
    // Wide eyes
    return (
      <>
        <circle cx={cx1} cy={cy} r={r * 1.3} fill="white" opacity={0.95} />
        <circle cx={cx2} cy={cy} r={r * 1.3} fill="white" opacity={0.95} />
        <circle cx={cx1} cy={cy} r={r * 0.5} fill="black" opacity={0.6} />
        <circle cx={cx2} cy={cy} r={r * 0.5} fill="black" opacity={0.6} />
      </>
    );
  }

  if (state === "listening") {
    // Happy eyes — curved lines
    return (
      <>
        <path
          d={`M ${cx1 - r} ${cy} Q ${cx1} ${cy - r * 2.5} ${cx1 + r} ${cy}`}
          fill="none"
          stroke="white"
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={0.9}
        />
        <path
          d={`M ${cx2 - r} ${cy} Q ${cx2} ${cy - r * 2.5} ${cx2 + r} ${cy}`}
          fill="none"
          stroke="white"
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={0.9}
        />
      </>
    );
  }

  // Default idle — normal dots with blink
  return (
    <>
      <circle cx={cx1} cy={cy} r={r} fill="white" opacity={0.85}>
        <animate
          attributeName="ry"
          values={`${r};${r};0.5;${r};${r}`}
          dur="4s"
          repeatCount="indefinite"
          keyTimes="0;0.45;0.5;0.55;1"
        />
      </circle>
      <circle cx={cx2} cy={cy} r={r} fill="white" opacity={0.85}>
        <animate
          attributeName="ry"
          values={`${r};${r};0.5;${r};${r}`}
          dur="4s"
          repeatCount="indefinite"
          keyTimes="0;0.45;0.5;0.55;1"
        />
      </circle>
    </>
  );
}

function Mouth({
  state,
  cx,
  cy,
  size,
}: {
  state: string;
  cx: number;
  cy: number;
  size: number;
}) {
  const w = size * 0.14;

  if (state === "speaking") {
    // Animated open mouth
    return (
      <ellipse cx={cx} cy={cy} rx={w * 0.6} fill="white" opacity={0.7}>
        <animate
          attributeName="ry"
          values="2;4;2;3;2"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </ellipse>
    );
  }

  if (state === "processing") {
    // Thinking — small line
    return (
      <line
        x1={cx - w * 0.5}
        y1={cy}
        x2={cx + w * 0.5}
        y2={cy}
        stroke="white"
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.6}
      />
    );
  }

  if (state === "completed") {
    // Evil grin — wide toothy smile
    const gw = w * 1.4;
    return (
      <>
        {/* Upper lip curve */}
        <path
          d={`M ${cx - gw} ${cy} Q ${cx} ${cy + 7} ${cx + gw} ${cy}`}
          fill="white"
          opacity={0.85}
        />
        {/* Teeth lines */}
        {[-0.6, -0.2, 0.2, 0.6].map((t, i) => (
          <line
            key={i}
            x1={cx + gw * t}
            y1={cy + 0.5}
            x2={cx + gw * t}
            y2={cy + 3.5}
            stroke="rgba(0,0,0,0.3)"
            strokeWidth={0.6}
          />
        ))}
      </>
    );
  }

  if (state === "error") {
    // Sad mouth — inverted curve
    return (
      <path
        d={`M ${cx - w} ${cy + 2} Q ${cx} ${cy - 3} ${cx + w} ${cy + 2}`}
        fill="none"
        stroke="white"
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.7}
      />
    );
  }

  if (state === "waiting") {
    // Open "o" mouth
    return (
      <circle cx={cx} cy={cy} r={w * 0.4} fill="white" opacity={0.5} />
    );
  }

  // Default — gentle smile
  return (
    <path
      d={`M ${cx - w} ${cy} Q ${cx} ${cy + 5} ${cx + w} ${cy}`}
      fill="none"
      stroke="white"
      strokeWidth={1.5}
      strokeLinecap="round"
      opacity={0.6}
    />
  );
}

function getBodyClass(state: string): string {
  switch (state) {
    case "idle":
      return "fill-indigo-500/30";
    case "processing":
      return "fill-blue-500/40";
    case "speaking":
      return "fill-purple-500/40";
    case "listening":
      return "fill-emerald-500/40";
    case "waiting":
      return "fill-amber-500/40";
    case "completed":
      return "fill-emerald-500/50";
    case "error":
      return "fill-red-500/40";
    default:
      return "fill-indigo-500/30";
  }
}
