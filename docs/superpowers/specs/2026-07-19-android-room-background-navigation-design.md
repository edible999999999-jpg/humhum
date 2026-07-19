# Android Room Background Navigation Design

## Goal

Bring the Android companion into the same visual system as the Mac app:

- characters belong to each room's background composition;
- navigation is a quiet functional control, not a row of mascot stickers;
- Chinese typography feels intentional and consistent;
- the existing four-role data and privacy boundaries remain unchanged.

## Current Problems

The current Android shell still uses the old four-tab structure. Its only meaningful
visual changes were reducing the navigation height and mascot size.

The four Android mascot resources are RGB images without transparency. They are
scaled and clipped inside small boxes, which leaves visible white edges and makes
the characters look pasted onto the interface.

The typography uses the generic Android sans-serif family without a deliberate CJK
font or complete type scale. Chinese text therefore relies on device fallback and
looks inconsistent beside the Latin role names.

## Chosen Direction

The user selected a minimal functional navigation. Mascots must not appear in the
bottom navigation or as square images beside room titles.

Android will reuse the same room background assets as Mac:

| Room | Shared background |
| --- | --- |
| Humi | `public/mascots/hub-backgrounds/humi-room.webp` |
| Hype | `public/mascots/hub-backgrounds/hype-room.webp` |
| Hush | `public/mascots/hub-backgrounds/hush-room.webp` |
| Hexa | `public/mascots/hub-backgrounds/hexa-room-v2.png` |

These assets are decorative. They do not receive accessibility labels and cannot
intercept input.

## Room Composition

The selected room owns the entire content background below the shared top bar and
above the bottom navigation.

`RoleRoomBackground` renders the matching shared asset behind the room content:

- fill the available content viewport;
- use crop positioning tuned per room so important artwork remains visible;
- use a restrained opacity that preserves the Mac artwork without reducing text
  contrast;
- keep the scrolling content transparent so the room remains spatially present;
- keep content cards translucent white where separation is necessary.

Hush uses end alignment to preserve its peeking character. Humi, Hype, and Hexa use
center alignment. The image remains fixed while content scrolls.

`RoomIntro` becomes typography-only:

- role and purpose eyebrow;
- one clear room headline;
- one supporting sentence;
- no mascot thumbnail;
- no colored rectangular banner behind the entire intro.

This makes the character part of the room rather than a UI badge.

## Bottom Navigation

The navigation remains four fixed destinations for predictable switching, but its
visual language changes completely.

Each destination uses an outlined Material icon:

- Humi: conversation;
- Hype: knowledge/library;
- Hush: inbox/messages;
- Hexa: Agent supervision.

The navigation has:

- a plain white surface with a subtle upward shadow;
- no mascot images;
- no filled selected rectangle;
- no border surrounding the whole bar;
- one role-colored two-pixel active marker;
- role-colored active icon and label;
- muted inactive icons and labels;
- fixed destination dimensions so selection never shifts layout.

Role names remain visible because the four brands are not yet familiar enough to be
icon-only. Icons are decorative inside a destination whose accessibility label is
the role name and purpose.

## Typography

Bundle the OFL-licensed Noto Sans SC variable font for consistent Chinese and Latin
rendering across supported Android devices. Do not apply one undifferentiated font
style everywhere: each information level receives its own deliberate size, weight,
and line height.

| Content | Size | Weight | Line height |
| --- | ---: | --- | ---: |
| Room headline | 22sp | Semibold | 30sp |
| Section title | 17sp | Semibold | 24sp |
| Primary item title | 16sp | Medium | 23sp |
| User-facing body | 15sp | Regular | 23sp |
| Control label | 13sp | Medium | 19sp |
| Metadata and bottom navigation | 12sp | Medium | 16sp |
| Health and other headline numbers | 17sp | Semibold, tabular figures | 22sp |

The mobile type system will:

- use Noto Sans SC for both Chinese text and the Latin role names so the two scripts
  do not look like separate interfaces;
- keep role names in title case and never add artificial tracking or all caps;
- use regular and medium weights for body and controls;
- reserve semibold for room titles, section titles, and headline values;
- set letter spacing to zero at every level;
- disable extra platform font padding;
- never reduce user-facing body content below 15sp;
- keep 12sp text secondary, short, and nonessential;
- allow titles to wrap naturally instead of shrinking them to fit;
- use tabular figures only for comparable numeric summaries, not prose.

The font license is stored with the Android resources. The download-size increase
is accepted in exchange for consistent CJK rendering.

## Existing Product Boundaries

This redesign does not change data ownership:

- Humi keeps companion interpretation and Health Connect summaries;
- Hype keeps skills, preferences, memories, and reusable knowledge;
- Hush keeps authorized message summaries and never shows health data;
- Hexa keeps Agent observation and control according to pairing scope.

No new data source, permission, network path, or background reader is introduced.

## Accessibility And Layout

- Four navigation destinations retain `Role.Tab` semantics and selected state.
- Every destination has a minimum 48dp touch target.
- Decorative room backgrounds have no semantics.
- Text must remain legible at 1.3x font scale.
- The bottom navigation remains inside system insets.
- No title, setting action, card, or navigation label may overlap at 390x844.
- Reduced-motion behavior does not depend on animation.

## Test Strategy

Compose tests verify:

- exactly four role destinations remain;
- each destination exposes an icon and role label;
- navigation contains no mascot image;
- selection changes the active role without changing destination bounds;
- each room renders its correct decorative background;
- `RoomIntro` contains no mascot thumbnail;
- large-font and system-inset contracts still pass.

Visual QA captures Humi, Hype, Hush, and Hexa at 390x844 and checks:

- no white-edged mascot stickers;
- clear room-specific background identity;
- readable Chinese hierarchy;
- complete top and bottom controls;
- no overlap or clipping.

## Acceptance Criteria

1. The bottom bar is visibly different from the previous mascot-tab design.
2. No Android navigation or room intro uses `mascot_humi`, `mascot_hype`,
   `mascot_hush`, or `mascot_hexa`.
3. The four room backgrounds are sourced from the same files used by Mac.
4. Hush's peeking character remains visible in the mobile crop.
5. All existing role, privacy, pairing, health, and Agent-control tests pass.
6. Android unit tests, APK assembly, connected tests, and four visual captures pass.
