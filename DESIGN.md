# HUMHUM Design Language

HUMHUM is an editorial personal Agent OS. It should feel like opening a calm,
well-composed personal journal that happens to contain powerful Agent controls.
The interface is led by typography, rhythm, and real user context, not by
decoration or a grid of generic cards.

This file is the visual source of truth for desktop and mobile work. Product
behavior remains defined by the code and product specifications.

## Design Promise

Every screen should answer three questions in this order:

1. What matters to me right now?
2. What did HUMHUM understand from my own context?
3. What is the next useful action?

Raw files, paths, token counts, connection internals, and diagnostics must stay
behind explicit detail controls.

## Visual Character

- Editorial, bright, personal, and composed.
- Warm near-white paper rather than a colored app background.
- One high-contrast focal surface per viewport.
- Thin rules and whitespace establish structure before containers do.
- Role color is a signature, not a page-filling theme.
- Mascots are optional signatures for empty states and celebrations. They are
  never the main layout, a wallpaper, or a substitute for information.

## Typography

Typography is the primary visual asset.

### Families

- Editorial display: the platform serif family with full Chinese glyph
  coverage. On Android use `FontFamily.Serif`.
- Product text: the platform sans-serif family. On Android use
  `FontFamily.SansSerif`.
- Technical metadata: the platform monospace family. Use it only for Agent
  names, status, timestamps, identifiers, and command metadata.

The first Android implementation uses platform families so Chinese text remains
complete on Xiaomi and other devices without adding a large downloadable font
or a network dependency.

### Type Scale

| Role | Size / line height | Family | Weight |
| --- | --- | --- | --- |
| Editorial display | 31 / 38 sp | Serif | SemiBold |
| Page headline | 27 / 34 sp | Serif | SemiBold |
| Section title | 21 / 28 sp | Serif | SemiBold |
| Item title | 16 / 23 sp | Sans | SemiBold |
| Body | 15 / 23 sp | Sans | Regular |
| Label | 12 / 17 sp | Sans | Medium |
| Technical metadata | 12 / 18 sp | Mono | Regular |

Letter spacing is always `0`. Serif type is reserved for page-level meaning,
dates, major section titles, and prominent numbers. Dense lists and controls
remain sans-serif.

## Color

### Shared Neutrals

| Token | Value | Use |
| --- | --- | --- |
| `paper` | `#F8F8F5` | Primary canvas |
| `surface` | `#FFFFFF` | Inputs and repeated list surfaces |
| `ink` | `#191B1E` | Primary text |
| `muted` | `#686B70` | Secondary text |
| `faint` | `#96999F` | Tertiary metadata |
| `rule` | `#DFE1DE` | Dividers |
| `focus` | `#1C1E1D` | Primary focal surface |
| `onFocus` | `#F8F6EF` | Text on focal surfaces |

### Role Signatures

| Role | Accent | Soft |
| --- | --- | --- |
| Humi | `#6D5CCC` | `#F1EEFF` |
| Hype | `#B0462F` | `#FFF0EA` |
| Hush | `#287864` | `#E8F5EE` |
| Hexa | `#C08A0A` | `#FFF3CF` |

Do not tint an entire page with one role color. Use role accents for the active
navigation destination, one status mark, one focus action, and small semantic
signals.

## Layout And Rhythm

- Use the 4 dp base grid: `4, 8, 12, 16, 24, 32`.
- Mobile horizontal page padding is 16 dp.
- Major sections are separated by 24-32 dp, not by wrapping each section in a
  card.
- List rows use a minimum 64 dp stable height and a divider aligned to the text
  column.
- Fixed-format controls and navigation use stable dimensions.
- Component radius is at most 8 dp.
- A page may have one dominant focal surface. Repeated items should normally be
  unframed rows or flat white surfaces.
- Never place a card inside another card.

## Core Components

### Editorial Page Intro

A small date or context label, a serif headline, and at most two lines of
supporting sans-serif text. It is not placed in a card.

### Focus Surface

The single strongest surface in a viewport. It uses `focus` or a role-specific
dark treatment, an 8 dp radius, and one clear action. It must contain real
context, never promotional copy or invented activity.

### Section Header

A serif section title with optional compact trailing metadata. It is separated
from the previous section by whitespace, not a container.

### Editorial List Row

An optional 36-40 dp role mark, a strong sans-serif title, one or two lines of
supporting text, and compact metadata. Rows are divided with a short rule
starting at the text column.

### Bottom Navigation

Four stable destinations: Humi, Hype, Hush, and Hexa. The active destination is
shown with accent color and a 2 dp indicator or restrained soft field. Avoid
large filled navigation tiles.

## Role Composition

### Humi

Humi opens like a personal morning page: date or temporal context, a serif
interpretation of what matters, one dark observation or next-step surface, then
today and body signals as editorial rows and number groupings.

### Hype

Hype reads like an index: a serif orientation statement, compact categories,
one featured reusable insight, and knowledge entries separated by rules. It
must not resemble a file browser.

### Hush

Hush reads like private correspondence: warm paper, compact filters, people
first, message previews, source and time. Attention uses a warm rose mark.
Privacy remains visible in a quiet mint strip.

### Hexa

Hexa is the most technical room, but still editorial. Its primary Agent session
is the dark focal surface with engineering yellow signals. Secondary sessions
remain light. Technical metadata may use monospace. The composer belongs to the
primary session.

## Motion

- Content destination change: 220 ms fade with an 8 dp vertical settle.
- Expand and collapse: 180-240 ms.
- Press feedback: 100 ms color or opacity response without layout shift.
- Avoid bounce, continuous ambient motion, and decorative parallax.
- Respect the system reduced-motion setting.

## Accessibility

- Body text contrast is at least 4.5:1.
- Large display text and non-text signals are at least 3:1.
- Interactive targets are at least 48 x 48 dp.
- Important meaning is never communicated by color alone.
- Verify 1.3x font scale and 390 x 844 first-viewport layouts.
- Serif type must not be used below 18 sp for Chinese body copy.

## Do Not

- Do not use gradients, decorative blobs, fake glass, or neon panels.
- Do not use mascots as wallpaper or repeat them on every screen.
- Do not turn every section into a rounded card.
- Do not use raw Agent internals as primary content.
- Do not imitate another product's features, data, branding, or illustrations.
- Do not invent user messages, health records, memories, or Agent progress in
  production UI.

## Definition Of Done

A visual change is complete only when:

- It follows this file's typography and layout hierarchy.
- Existing behavior and privacy boundaries remain unchanged.
- Android Compose tests, lint, and release build pass.
- Humi, Hype, Hush, and Hexa have inspected 390 x 844 device screenshots.
- No text overlaps, clips, or hides the next required action.
