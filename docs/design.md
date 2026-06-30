# Hum Design System

> 会哼唱的水母 · Turritopsis dohrnii · DevPod AI Companion Mascot

---

## 1. Design Philosophy

Hum lives in the deep sea between user and AI. The visual language draws from **deep-sea bioluminescence** — translucent bodies, inner glow, organic motion, soft pulsing light. Everything feels like it's underwater: drifting, breathing, glowing from within.

### Core Principles

| Principle | Rule |
|-----------|------|
| **Translucent & Luminous** | No hard outlines. Shapes are defined by layered gradients and opacity. Bodies glow from the inside like deep-sea creatures under blacklight. |
| **Ocean Motion** | Every movement follows fluid dynamics — drift, pulse, contract, flow. Easing is always soft (`ease-in-out`). Nothing is linear or mechanical. |
| **Cute but Not Childish** | Big expressive eyes, soft round shapes, gentle colors. But proportions stay realistic to the creature type — no chibi, no exaggerated features. |
| **Absorbed Ecosystem** | Connected agents live INSIDE Hum's translucent body as tiny glowing sea creatures — visible through the dome like bioluminescent plankton under a microscope. |
| **Detail in Simplicity** | Each creature has layered rendering: body gradient → highlight shimmer → face details → ambient glow. Even at small sizes, the layering creates richness. |

### Rendering Style
- **Smooth vector SVG** with radial/linear gradients
- **Multiple opacity layers** stacked to create depth
- **Soft inner glow** (feGaussianBlur + low-opacity color fills)
- **Specular highlights** — white ellipses at upper-left, like light through water
- **No hard strokes** on bodies — edges defined by gradient fade-to-transparent
- **Subtle animations** — continuous gentle drift, pulse, shimmer

### Anti-Patterns
- No pixel art, no aliased edges
- No hard 1px outlines around bodies
- No solid flat fills without gradient
- No mechanical animations (gears, springs, bouncing)
- No text/letter labels on or inside creatures
- No chibi proportions (baby ≠ chibi — just smaller version of adult)

---

## 2. Hum — The Jellyfish (主角)

### Character Profile
- **Species**: Turritopsis dohrnii (灯塔水母 / immortal jellyfish)
- **Role**: DevPod's AI companion — monitors coding agents, delivers voice summaries
- **Personality**: Gentle, curious, hardworking. Gets flustered when busy but never gives up.
- **Special ability**: Reverts to juvenile form under pressure (≥4 sessions)

### Anatomy Diagram

```
            ·  ·  ·                ← Specular highlight (white, 0.2 opacity)
        ╭──────────╮               ← Dome top (smooth bezier curve)
       ╱  ◖  ◗      ╲              ← Eyes (round, with pupil + highlight dot)
      │   ∵  ∵        │            ← Blush spots (pink, low opacity)
      │  ⊙  ⊙  ⊙     │            ← Absorbed agent creatures (floating)
       ╲     ‿       ╱             ← Mouth (tiny upward curve)
        ╰┬┬┬┬┬┬┬┬┬┬╯              ← Frill / 裙边 (scalloped wave edge)
         ╎╎╎╎╎╎╎╎╎╎               ← Tentacles (gradient-opacity strokes)
          ∿ ∿ ∿ ∿ ∿               ← Tips drift with sine-wave offset
```

### Dome (伞盖 / 钟体)

| Property | Spec |
|----------|------|
| **Shape** | Smooth half-ellipse, width:height ≈ 1.8:1.5. Top is rounded, bottom has slight outward flare. |
| **Fill** | 3-layer stack: (1) Radial gradient from bright center (0.6 opacity) fading to transparent edge (0.06). (2) Inner glow ellipse at 40% from top (0.3–0.5 opacity). (3) Specular white ellipse at upper-left 30% position (0.2 opacity). |
| **Frill** | Scalloped edge along dome bottom — 7 small sine bumps. Subtle independent wave animation (0.3s offset per bump). |
| **Breath** | Gentle scaleX/scaleY pulse: `1.0 → 1.015/0.985 → 1.0` over 3.5–4s. Creates living, breathing feel. |
| **State variants** | Completed: spiky "exploded hair" dome. Waiting: squished/compressed. Error: tilted 5°. Speaking: stronger pulse. |

### Eyes

| Property | Spec |
|----------|------|
| **Position** | Horizontal center ± R×0.3, vertical at dome center – R×0.06 |
| **Structure** | 4 layers per eye: (1) White fill circle r=3.5 (main eye). (2) Dark pupil circle r=1.5 at center+0.5 down. (3) White highlight dot r=0.8 at upper-left of eye. (4) Optional: pink blush ellipse 4×2.5 below eye, opacity 0.18. |
| **Blink** | Every ~5s: squish ry from 3.5→0.4→3.5 over 0.4s. Natural timing with keyTimes `0;0.46;0.5;0.54;1`. |
| **State variants** | Completed: happy arcs (^_^). Error: spiral + X-cross. Waiting: wide circles with centered pupils. Processing: slow vertical drift. |

### Mouth

| Property | Spec |
|----------|------|
| **Position** | Center x, dome center + R×0.26 |
| **Default** | Tiny upward bezier curve, 9px wide, stroke 1.2px, opacity 0.35 |
| **Speaking** | Ellipse that animates ry: `1→4→1.5→3→1` over 0.8s |
| **Completed** | Wide happy curve, 12px, stroke 1.5px |
| **Error** | Wavy off-center line |

### Tentacles (触手)

| Property | Spec |
|----------|------|
| **Count** | 5 for most states. Distributed from -0.7 to +0.7 of dome bottom width. |
| **Style** | Stroke with linear gradient: agent's state color at 0.55 opacity → 0.03 opacity at tip. Width 2.2px, round caps. |
| **Motion** | Each tentacle sways independently. Bezier control points animate with sine offsets. Period: 3–5s per tentacle. Phase offset: +0.3s per tentacle for organic stagger. |
| **Length** | 38–52px at 180px Hum size. Middle tentacle longest. |
| **State expression** | Idle: gentle seaweed sway. Processing: converge toward center (weaving). Speaking: flare out (megaphone). Completed: burst outward like fireworks. Error: two middle ones tangle/knot. Waiting: curl inward tight. |

---

## 3. Absorbed Agent Creatures (吸收态生物)

When an AI coding agent connects to DevPod, Hum "absorbs" it — the agent appears as a **tiny glowing sea creature floating inside Hum's translucent dome**. This is the core visual metaphor: Hum eats its helpers and they glow inside like bioluminescent prey.

### Universal Creature Design Rules

| Rule | Detail |
|------|--------|
| **Proportion** | Head:body ≈ 1:1.2. Eyes are large relative to head (~30% of face width). This creates natural cuteness without chibi distortion. |
| **Color layering** | Each creature uses 3 shades of its brand color: light (highlight), medium (body), dark (shadow/outline). Plus white for eye highlights. |
| **Glow halo** | Every creature has a soft feGaussianBlur glow halo at 0.06–0.14 opacity behind it, pulsing slowly. |
| **Face details** | Every creature (at ≥100px Hum size) has: at least 1 eye with white highlight dot, and either a mouth or a distinguishing facial feature. |
| **Translucency** | Bodies at 0.5–0.7 opacity. Overlap with Hum's inner gradient creates depth. |
| **Floating drift** | Each creature drifts in a lazy figure-8 path: `translateX ±2px, translateY ±1.5px` over 4–5s. Each creature has different phase offset. |

### Size Tiers

| Hum render size | Creature render | Detail level |
|-----------------|-----------------|--------------|
| < 80px | 4–6px | Color dot + glow only |
| 80–120px | 8–12px | Body silhouette + eye dot |
| 120–180px | 14–18px | Full creature: body gradient, eye with highlight, mouth, details |
| > 180px | 20–24px | All above + blush, texture, secondary features |

---

### 🦐 Claude Code — Fire Shrimp (火虾)

> "The warm one. Always curled up cozy, always busy."

#### Character Sheet

| Property | Detail |
|----------|--------|
| **Species** | 深海火虾 — a deep-sea shrimp that glows orange |
| **Brand color** | `#f97316` (Orange) |
| **Gradient** | Body: `#fbbf24` (light amber belly) → `#f97316` (orange back) → `#ea580c` (deep orange tail) |
| **Personality** | Warm, reliable, industrious. Curls tighter when shy, stretches when confident. |

#### Anatomy (at full detail tier)

```
         ╱╲ ╱╲            ← Two antennae: thin curved lines with tiny luminous dots at tips
        ◕                  ← Eye: big round, white fill, dark pupil, tiny white highlight at 10 o'clock
       ╭───╮               ← Head: rounded, slightly larger than body (cute ratio)
      ╭┤   ├╮              ← Body segment 1: plump, lighter orange belly
      │╰───╯│              ← Body segment 2: 2-3 subtle curved segment lines
       ╰─╮╭─╯              ← Body segment 3: tapers toward tail
         ╰╯ 〉             ← Tail fan: small translucent fan shape, 3 feathered strokes
        ┆┆┆                ← Legs: 3 tiny hairline strokes underneath, barely visible (0.25 opacity)
```

#### Color Breakdown

| Layer | Color | Opacity | Purpose |
|-------|-------|---------|---------|
| Glow halo | `#f97316` | 0.06–0.14 | Ambient warmth around creature |
| Body fill | `#fbbf24` → `#f97316` | 0.65 | Main body gradient (light belly to orange back) |
| Segment lines | `#ea580c` | 0.3 | 2–3 curved lines along body for shell texture |
| Belly highlight | `#fef3c7` | 0.25 | Light cream ellipse on belly area |
| Eye white | `#ffffff` | 0.9 | Main eye circle |
| Pupil | `#1c1917` | 0.75 | Dark center dot |
| Eye highlight | `#ffffff` | 0.95 | Tiny dot at upper-left of eye |
| Antennae | `#f97316` | 0.6 | Two thin bezier curves from head top |
| Antenna tips | `#fbbf24` | 0.8 | Tiny glowing dots at antenna ends |
| Tail fan | `#fdba74` | 0.35 | Translucent fan at tail end |
| Legs | `#f97316` | 0.25 | 3 tiny lines under body |
| Blush | `#fda4af` | 0.2 | Faint pink under eye (at largest size tier) |

#### Shape Description (SVG path logic)
1. Body: Single bezier path curving like a comma/C-shape. Start from head top, curve outward for the plump body section, then curve back in and down for the tapering tail.
2. Head: Slightly larger circle area at the top of the C-curve.
3. Antennae: Two thin quadratic bezier strokes from the top of the head, curving outward and up. Each ends with a circle r=1 dot.
4. Eye: Positioned at the upper-front of the head. Circle r=2 white, circle r=0.8 dark pupil, circle r=0.4 white highlight.
5. Tail fan: 3 short thin lines fanning from the tail end, slightly translucent.
6. Segment lines: 2 subtle curved lines following the body contour, creating shell segment look.

---

### ☁️ Codex — Cloud Puff (云团)

> "Soft, formless, always adapting. A little cloud that wandered into the deep sea."

#### Character Sheet

| Property | Detail |
|----------|--------|
| **Species** | 深海云团 — an amorphous bioluminescent jelly blob |
| **Brand color** | `#22c55e` (Green) |
| **Gradient** | `#86efac` (light mint top) → `#22c55e` (green center) → `#16a34a` (deeper green bottom) |
| **Personality** | Bouncy, wobbly, cheerful. Jiggles when excited. Shape shifts slightly with each drift cycle. |

#### Anatomy

```
          ○                ← Top bump: small circle overlapping main body
        ╭○─○╮              ← Mid bumps: 2 overlapping circles forming cloud shape
       │ ✦  ✦ │            ← Eyes: big round with star-shaped highlight (sparkly eyes)
       │  ω   │            ← Mouth: tiny cat-mouth "ω" shape
        ╰─┬─╯             ← Bottom: soft wavy underside
          ╷╷╷              ← Droplets: 2-3 tiny teardrop shapes hanging from bottom
```

#### Color Breakdown

| Layer | Color | Opacity | Purpose |
|-------|-------|---------|---------|
| Glow halo | `#22c55e` | 0.06–0.14 | Green ambient aura |
| Main body | `#22c55e` | 0.5 | Central large ellipse |
| Top bump | `#86efac` | 0.45 | Lighter smaller circle overlapping top-left |
| Side bump | `#4ade80` | 0.4 | Medium circle overlapping top-right |
| Belly highlight | `#dcfce7` | 0.2 | White-green shimmer moving across surface |
| Inner fluff | `#bbf7d0` | 0.15 | 2 subtle lighter ellipses inside body |
| Eyes | `#ffffff` | 0.9 | Two round circles, slightly larger than other creatures' eyes |
| Pupils | `#14532d` | 0.65 | Dark green center dots |
| Eye sparkle | `#ffffff` | 0.95 | Star-shaped or double-dot highlight (✦ shape: 4 tiny dots around the highlight) |
| Mouth | `#16a34a` | 0.4 | Cat-mouth "ω": two small arcs side by side |
| Droplets | `#86efac` | 0.3 | 2-3 tiny tear/ellipse shapes hanging below body |

#### Shape Description
1. Body: 3 overlapping ellipses of decreasing size — largest at center-bottom, medium at upper-right, smallest at top — forming a cloud silhouette.
2. Eyes: Positioned on the largest ellipse. Slightly larger than other creatures' eyes to give a round innocent look. Star-highlight: instead of single dot, use 4 tiny circles in a + pattern around the main highlight.
3. Mouth: Two small arcs forming "ω" — a cat-like content expression.
4. Droplets: 2 tiny ellipses (stretched vertically) hanging from the bottom edge, like condensation.
5. Wobble: Slight scaleX variation in animation (`0.97 → 1.03`) to suggest squishiness.

---

### 🐴 Qwen Code — Blue Seahorse (蓝海马)

> "Elegant, precise, holding its ground. The dignified one."

#### Character Sheet

| Property | Detail |
|----------|--------|
| **Species** | 深海海马 — a miniature seahorse |
| **Brand color** | `#3b82f6` (Blue) |
| **Gradient** | `#93c5fd` (light sky belly) → `#3b82f6` (blue body) → `#1d4ed8` (deep blue back) |
| **Personality** | Upright, calm, dignified. Gentle sway. Tail curls tighter when focused. |

#### Anatomy

```
         ♔                 ← Crown: 3-point tiny dorsal crest (like a tiara)
        ╭─╮                ← Head: small rounded with slight forward snout
       ◕│ │                ← Eye: large round, side-view, with gentle lash line above
        │ ╰╮               ← Neck: graceful S-curve begins
        ╰╮ │               ← Body: plump midsection with lighter belly
         │╭╯               ← Lower body: 4–5 horizontal segment lines (belly rings)
         ╰╮  ⌇             ← Fin: tiny translucent dorsal fin, subtle flutter
          ╰╮               ← Tail: elegant spiral curl
           @               ← Tail tip: tight curl, like a cinnamon roll
```

#### Color Breakdown

| Layer | Color | Opacity | Purpose |
|-------|-------|---------|---------|
| Glow halo | `#3b82f6` | 0.06–0.14 | Cool blue ambient glow |
| Body back | `#3b82f6` → `#1d4ed8` | 0.6 | Main S-curve body |
| Belly | `#93c5fd` | 0.35 | Lighter fill on inner/front side of body |
| Belly rings | `#bfdbfe` | 0.25 | 4–5 thin horizontal lines across belly area |
| Crown | `#60a5fa` | 0.7 | 3 tiny triangular points on head top |
| Snout | `#3b82f6` | 0.6 | Slight forward protrusion from head |
| Eye | `#ffffff` | 0.9 | Large round, positioned at head upper-front |
| Pupil | `#1e3a5f` | 0.7 | Dark blue center |
| Eye highlight | `#ffffff` | 0.95 | Small dot at 10 o'clock |
| Lash line | `#1d4ed8` | 0.3 | Thin arc above eye, creating gentle expression |
| Dorsal fin | `#93c5fd` | 0.2 | Small translucent fin on the back curve |
| Tail | `#3b82f6` | 0.55 | Tapers and curls into a tight spiral |

#### Shape Description
1. Body: Single continuous S-curve bezier path. Starts at head (rounded bump), curves forward for snout, curves back for the plump belly, curves forward again and tapers into the spiraling tail.
2. Crown: 3 tiny triangle points at head top, drawn as a zigzag path.
3. Eye: Positioned high on the head. Larger than other creatures — takes up ~35% of the head. Single gentle arc stroke above it for the "eyelash line."
4. Belly rings: 4–5 very thin horizontal strokes across the plump midsection, evenly spaced.
5. Fin: Small translucent ellipse or leaf shape at the back midpoint, with subtle flutter animation (scaleX oscillation).
6. Tail: Continues the S-curve into a logarithmic spiral, tightening to a small circle at the end.

---

### ✨ Gemini CLI — Crystal Starfish (水晶海星)

> "Bright, sharp, multi-talented. Always twinkling."

#### Character Sheet

| Property | Detail |
|----------|--------|
| **Species** | 水晶海星 — a crystalline starfish that refracts light |
| **Brand color** | `#06b6d4` (Cyan) |
| **Gradient** | `#22d3ee` (bright cyan center) → `#06b6d4` (teal body) → `#0891b2` (deep teal tips) |
| **Personality** | Cheerful, sparkly, energetic. Slowly rotates. Twinkles when active. |

#### Anatomy

```
           ╱╲              ← Top arm: rounded, chubby (not sharp)
      ╲  ╱    ╲  ╱         ← Side arms: soft rounded points
       ╲╱ ·  · ╲╱          ← Eyes: two tiny happy dots
        │  ‿    │          ← Mouth: small "u" smile
       ╱╲      ╱╲          ← Lower arms
      ╱  ╰────╯  ╲        ← Each arm tip has tiny suction-cup circle
         ◇ ◇ ◇            ← Facet lines: subtle lines from center to tips
           ✦               ← Prismatic sparkle: rainbow shimmer that moves
```

#### Color Breakdown

| Layer | Color | Opacity | Purpose |
|-------|-------|---------|---------|
| Glow halo | `#06b6d4` | 0.06–0.14 | Cyan ambient sparkle |
| Body fill | `#06b6d4` | 0.55 | 4-pointed rounded star shape |
| Center glow | `#22d3ee` | 0.4 | Bright inner circle at center |
| Arm tips | `#0891b2` | 0.3 | Slightly darker circles at each arm end (suction cups) |
| Facet lines | `#22d3ee` | 0.15 | 4 thin lines from center to each arm tip |
| Prismatic shimmer | `#ffffff` + hue rotate | 0.2 | Small ellipse that slowly moves position, cycles through rainbow tint |
| Eyes | `#ffffff` | 0.9 | Two tiny dots near center |
| Mouth | `#0e7490` | 0.4 | Small upward curve below eyes |
| Sparkle particles | `#67e8f9` | 0.3–0.7 | 2–3 tiny dots near body that fade in and out at random positions |

#### Shape Description
1. Body: 4-pointed star polygon, but with ROUNDED corners on each point. Think of 4 overlapping ellipses arranged in a cross pattern, merged. Each "arm" is bulbous and chubby, not sharp.
2. Center: Brighter inner circle, like a gem's table facet.
3. Facet lines: 4 very thin semi-transparent lines from center outward to each arm tip.
4. Arm tip circles: Small circles at each arm end, slightly darker, like suction cups or gem facets.
5. Eyes & mouth: Positioned at center of the star. Eyes are simple dots. Mouth is a tiny arc.
6. Sparkle: 2–3 tiny circles that appear near the body at random offsets, fade in (0→0.7) and out over 1.5s each, staggered timing.
7. Rotation: Slow continuous rotation, ~15° per cycle over 6s, very gentle.

---

### 🌙 Kimi K1 — Moon Jelly (月亮水母)

> "The dreamy night owl. Serene, mysterious, always half-asleep."

#### Character Sheet

| Property | Detail |
|----------|--------|
| **Species** | 月光水母 — a crescent-shaped luminescent jelly |
| **Brand color** | `#a855f7` (Purple) |
| **Gradient** | `#d8b4fe` (light lavender inner) → `#a855f7` (purple body) → `#7c3aed` (deep violet tips) |
| **Personality** | Dreamy, serene, contemplative. Floats with a gentle rotation. Often looks half-asleep. |

#### Anatomy

```
         ╭────╮            ← Crescent outer curve: thick, soft, plump
        │ ◕    ╲           ← Eye: big round, half-closed (sleepy lids), long lash curve
        │  ‿    ╲          ← Mouth: tiny peaceful closed smile
        │ ∴      │         ← Inner texture: subtle swirl pattern (galaxy-like)
         ╰────╯            ← Crescent inner curve
            ☆ ✦            ← Star companions: 2-3 tiny star shapes floating near crescent tips
              💤           ← Sleep particles: tiny "z" dots trailing occasionally
```

#### Color Breakdown

| Layer | Color | Opacity | Purpose |
|-------|-------|---------|---------|
| Glow halo | `#a855f7` | 0.06–0.14 | Purple ethereal aura, strongest at tips |
| Body fill | `#a855f7` | 0.5 | Main crescent path |
| Inner gradient | `#d8b4fe` | 0.35 | Lighter lavender fill on inner concave side |
| Outer shadow | `#7c3aed` | 0.2 | Darker violet along outer convex edge |
| Swirl texture | `#c084fc` | 0.1 | 1-2 subtle spiral paths inside body (galaxy swirl) |
| Eye white | `#ffffff` | 0.85 | Round eye in the inner curve area |
| Pupil | `#3b0764` | 0.7 | Dark purple center |
| Sleepy lid | `#a855f7` | 0.6 | Arc covering top 30% of eye (half-closed effect) |
| Lash line | `#7c3aed` | 0.3 | Thin long curve above the sleepy lid |
| Mouth | `#7c3aed` | 0.3 | Tiny closed-smile arc, very small and peaceful |
| Star companions | `#e9d5ff` | 0.4–0.6 | 2-3 tiny 4-point stars near crescent tips, slowly orbiting |
| Tip glow | `#c084fc` | 0.25 | Brighter circles at both crescent tips |

#### Shape Description
1. Body: Crescent/croissant shape — two concentric arcs. Outer arc is larger radius, inner arc is smaller. The shape is thick and plump, not thin like a sliver moon. Think of a curved sausage.
2. Eye: Positioned in the concave inner area. Large round white circle, but with a half-circle overlay on the top (the "sleepy lid" in body color) that covers the top 30%, creating a drowsy expression. A thin arc stroke above the lid for the lash.
3. Mouth: Very tiny arc below and to the side of the eye. Peaceful, not wide.
4. Swirl: 1-2 very faint logarithmic spiral path strokes inside the body, suggesting galaxy/dream energy.
5. Stars: 2-3 tiny 4-point star shapes (path with 8 vertices, alternating in/out radius) positioned near the crescent tips. They slowly orbit the crescent with ~8s period.
6. Tip glow: Both pointed tips of the crescent have slightly brighter fill, as if emitting light.

---

### 🪸 QoderWork — Coral Polyp (珊瑚虫)

> "The builder. Rooted, constructive, quietly growing something beautiful."

#### Character Sheet

| Property | Detail |
|----------|--------|
| **Species** | 深海珊瑚虫 — a branching soft coral with polyp tips |
| **Brand color** | `#f43f5e` (Rose) |
| **Gradient** | `#fda4af` (light pink tips) → `#f43f5e` (rose body) → `#e11d48` (deep rose base) |
| **Personality** | Steady, constructive, nurturing. Sways gently like an underwater plant. Each tip seems to have its own curious personality. |

#### Anatomy

```
          ⊙     ⊙          ← Tip faces: each branch tip has a tiny dot-eye
         ╭╯     ╰╮         ← Branch petals: 2-3 tiny petal shapes at each tip
        ╱         ╲         ← Branches: 2 arms splitting from main stem
       ╱     ⊙     ╲       ← Center tip: middle branch, slightly taller
      │    ╭──╯──╮   │     ← Fork point: where stem splits
      │    │     │   │
       ╰───┤     ├──╯      ← Stem: thick rounded base, with 2-3 texture bumps
            ╰───╯           ← Base: rounded bottom, anchored feeling
             ○ ○            ← Bubbles: 2-3 tiny circles floating upward from tips
```

#### Color Breakdown

| Layer | Color | Opacity | Purpose |
|-------|-------|---------|---------|
| Glow halo | `#f43f5e` | 0.06–0.14 | Warm rose ambient |
| Stem fill | `#f43f5e` | 0.6 | Main trunk path, thick rounded |
| Stem texture | `#e11d48` | 0.2 | 2-3 small bumps/ridges along stem |
| Branch fills | `#fb7185` | 0.55 | Two side branches, thinner than stem |
| Tip petals | `#fda4af` | 0.4 | 2-3 tiny petal/tentacle shapes at each branch tip |
| Tip glow | `#fecdd3` | 0.3 | Lighter circles at branch tips |
| Tip eyes | `#ffffff` | 0.8 | Tiny dot eyes on 1-2 of the branch tips |
| Tip pupils | `#881337` | 0.6 | Even tinier dark dots inside the tip eyes |
| Bubbles | `#fecdd3` | 0.2–0.4 | 2-3 tiny circles floating upward, staggered timing |
| Base | `#e11d48` | 0.35 | Slightly darker rounded bottom |

#### Shape Description
1. Stem: Thick rounded line from bottom center upward, tapering slightly.
2. Fork: At ~60% height, the stem splits into 3 branches — one center (slightly taller) and two angling outward at ~40° each side.
3. Branch tips: Each branch ends with a rounded bulb. At each bulb, 2-3 tiny petal shapes (small ellipses arranged radially) suggest the polyp's feeding tentacles.
4. Tip faces: 1-2 of the branch tips have tiny dot-eyes (white circle + dark center), making them look like curious little faces peering outward.
5. Bubbles: 2-3 tiny circles that spawn at random tip positions and drift upward, fading out. Staggered timing (each on different 3-5s cycle).
6. Texture: The stem has 2-3 small circular bumps (overlapping circles at 0.2 opacity) suggesting organic coral texture.
7. Sway: The two side branches gently sway outward and back in, offset from each other. The center tip has subtle vertical bob.

---

## 4. Color Palette

### Hum Body Colors (by state)

| State | Primary | Secondary | Highlight | Eye Color | Glow |
|-------|---------|-----------|-----------|-----------|------|
| Idle | `#818cf8` | `#6366f1` | `#a5b4fc` | `#eef2ff` | `#6366f1` |
| Processing | `#60a5fa` | `#3b82f6` | `#93c5fd` | `#dbeafe` | `#3b82f6` |
| Speaking | `#a78bfa` | `#7c3aed` | `#c4b5fd` | `#ede9fe` | `#8b5cf6` |
| Listening | `#34d399` | `#059669` | `#6ee7b7` | `#d1fae5` | `#10b981` |
| Waiting | `#fbbf24` | `#d97706` | `#fde68a` | `#fef9c3` | `#f59e0b` |
| Completed | `#34d399` | `#059669` | `#6ee7b7` | `#d1fae5` | `#10b981` |
| Error | `#f9a8d4` | `#ec4899` | `#fbcfe8` | `#fce7f3` | `#f472b6` |

### Agent Brand Colors (3-shade system)

| Agent | Light (highlight) | Medium (body) | Dark (shadow) |
|-------|-------------------|---------------|---------------|
| Claude Code | `#fbbf24` | `#f97316` | `#ea580c` |
| Codex | `#86efac` | `#22c55e` | `#16a34a` |
| Qwen Code | `#93c5fd` | `#3b82f6` | `#1d4ed8` |
| Gemini CLI | `#22d3ee` | `#06b6d4` | `#0891b2` |
| Kimi K1 | `#d8b4fe` | `#a855f7` | `#7c3aed` |
| QoderWork | `#fda4af` | `#f43f5e` | `#e11d48` |

---

## 5. Juvenile Mode (幼体 · 返老还童)

### Biological Reference
> Turritopsis dohrnii (灯塔水母) — the only known biologically immortal animal.
> Under environmental stress (starvation, physical damage, disease), the adult medusa
> reverts its cells to their polyp stage and begins its life cycle anew.

### Trigger
`activeSessions >= 4` (BABY_THRESHOLD = 4)

### Visual Rules
- **Same jellyfish**, scaled to **65%** via SVG group transform
- **Same proportions** — no chibi eyes, no rounder dome, no different art style
- **Same creatures** inside — just packed tighter in the smaller dome
- **Same animations** — just appears smaller and cuter naturally
- **Only difference**: size + mode label color change

### Mode Labels
| Mode | Badge color | Text |
|------|-------------|------|
| Adult | Purple `rgba(139,92,246,.15)` | 成体 MEDUSA |
| Juvenile | Amber `rgba(251,191,36,.15)` | 幼体 POLYP |

### Transition
- CSS `transform: scale()` with `transition: 0.4s ease-in-out`
- No morphing, no shape change — pure proportional scale

---

## 6. Jet Propulsion Drag (喷水推进 · 拖拽交互)

### Biological Reference
> Real jellyfish move by muscular contraction of their bell (钟体), which expels water
> and propels them in the opposite direction. The bell then relaxes and re-fills, creating
> a rhythmic pulse-jet cycle. Direction is controlled by asymmetric contraction.

### Drag Interaction Design

| Phase | Bell (dome) | Bubbles | Tilt | Description |
|-------|-------------|---------|------|-------------|
| **Grab** | Slight squeeze (scaleY 0.95) | None | None | User grabs Hum |
| **Drag slow** | Gentle pulse (scaleY 0.92–1.0, 0.8s) | 1-2 per frame, small (2-4px) | 5–10° toward direction | Leisurely swim |
| **Drag fast** | Rapid pulse (scaleY 0.88–1.0, 0.4s) | 3-4 per frame, mixed sizes (2-8px) | 15–25° toward direction | Urgent propulsion |
| **Release** | Final squeeze → slow relaxation (0.6s) | Burst of 6-8 bubbles | Slowly returns to 0° | Coasting to stop |
| **Idle after** | Normal breath (3.5s cycle) | None | 0° | Back to floating |

### Bubble Particle Spec

| Property | Value |
|----------|-------|
| Shape | Circle |
| Size range | 2–8px radius |
| Color | `rgba(139, 92, 246, 0.35)` (matches Hum's violet) |
| Blur | `filter: blur(1px)` — soft underwater feel |
| Spawn position | Behind Hum (opposite to movement vector), offset ±15px random |
| Velocity | Opposite to drag velocity × 0.25, plus random jitter ±1.5px/frame |
| Float | Slight upward drift (`vy -= 0.02/frame`) — bubbles rise |
| Lifetime | ~1s (opacity 0.55 → 0, scale 1.0 → 0.3) |
| Max on screen | ~30 (older ones removed first) |

### Direction Physics
- **Tilt angle** = `atan2(velX, -velY) × 0.35` — Hum leans into movement direction
- **Tilt smoothing** = exponential ease: `angle += (target - angle) × 0.12` — prevents jerky rotation
- **Bell pulse** = `sin(phase) × intensity` where intensity is proportional to drag speed

---

## 7. Animation Timing Reference

### Hum Breath Cycle

| State | Duration | Scale Range | Character |
|-------|----------|-------------|-----------|
| Idle | 3.5–4s | 1.0 ↔ 1.015 | Slow, relaxed, meditative |
| Processing | 2–2.5s | 1.0 ↔ 0.98 | Focused, slight compression |
| Speaking | 0.8s | 1.0 ↔ 1.04 | Rhythmic pulse with voice |
| Listening | 3.5s | 1.0 ↔ 1.015 | Same as idle + head tilt |
| Waiting | — | Paused at 0.92 | Tense, compressed |
| Completed | 1s (once) | 0.9 → 1.1 → 1.05 | Burst then settle |
| Error | — | Paused at 1.0 | Tilted 5° |

### Tentacle Animation

| State | Style | Period | Character |
|-------|-------|--------|-----------|
| Idle | Independent sine sway | 4–5s per tentacle | Lazy seaweed drift |
| Processing | Converge toward center | 2s | Weaving/knitting motion |
| Speaking | Flare outward wide | 1.5s | Megaphone broadcasting |
| Listening | Mostly still, slight sway | 5s | Attentive, calm |
| Waiting | Curl inward, tight | 1.5s | Nervous, anxious |
| Completed | Burst outward like fireworks | 1.2s (once) | Celebration explosion |
| Error | Two middle ones tangle/knot | 0.7s (once) | Confused, tangled |

### Eye Blink
- **Period**: ~5s natural cycle
- **Mechanic**: `ry: 3.5 → 0.4 → 3.5` over 0.4s
- **Timing**: keyTimes `0; 0.46; 0.50; 0.54; 1.0` (fast blink at midpoint)
- **Skip**: No blink during speaking, processing, error states

### Absorbed Creature Drift
- **Path**: Lazy figure-8: `translate(±2px, ±1.5px)` over 4–5s
- **Phase offset**: Each creature offset by `i × 0.5s` for organic stagger
- **Glow pulse**: `opacity: 0.03 → 0.14 → 0.03` over 2.5–3s

---

## 8. App Icon Variants

| Variant | Style | Use Case |
|---------|-------|----------|
| **Glow Silhouette** | Radial gradient dome + gradient tentacles + ambient glow | Primary app icon (dark background) |
| **Minimal Outline** | Single-color stroke, no fill | App icon on light backgrounds |
| **Filled Cute** | Solid fill + eyes + highlight + blush | Marketing materials, about page |
| **Tray States** | Tiny filled silhouette + state color coding | System tray (16–24px) |

### Tray State Meanings

| State | Color | Tray detail |
|-------|-------|-------------|
| Idle | `#818cf8` | Normal eyes |
| Active/Working | `#22c55e` | Inner dot (processing) |
| Speaking | `#a78bfa` | Sound wave arcs |
| Error | `#f472b6` | X-cross eyes |
| Notification | `#f59e0b` | Exclamation mark |

---

## 9. Style Comparison: Hum vs Ping Island

| Dimension | Ping Island | Hum (DevPod) |
|-----------|-------------|--------------|
| **Render style** | Pixel art GIF (8-bit aesthetic) | Smooth vector SVG with gradients & blur |
| **Agent representation** | Each agent = standalone animal mascot (pig, cloud, diamond, capybara, whale) | Agents = tiny sea creatures absorbed inside jellyfish hub |
| **Color approach** | Solid flat fills, 2-3 colors per sprite | Multi-layer gradients with 3-shade system + opacity stacking |
| **Visual feel** | Retro, nostalgic, gameboy charm | Bioluminescent, ethereal, deep-sea wonder |
| **Animation** | Frame-by-frame sprite sheets (GIF) | Continuous parametric SVG/CSS animation |
| **Detail density** | Deliberately low (pixel constraint) | High — gradient layers, blur, shimmer, glow halos |
| **Central metaphor** | Each agent has its own pet identity | Jellyfish is the hub; agents are prey it consumed |
| **Cuteness approach** | Chunky, blocky, charming through constraint | Smooth, glowing, charming through luminosity and softness |

### What We Learn From Ping Island
- Each agent MUST have a distinct, recognizable visual identity (not just a color dot)
- Personality descriptor matters ("Approval guardian", "Thread runner") — gives character depth
- Animated GIF presence makes agents feel alive — our creatures need continuous drift animation
- The mascot system scales across UI contexts (notch, list, hover) — our creatures must work at multiple sizes
