# Android Editorial Agent OS Design

## Goal

Move the Android companion from a conventional Material utility appearance to
the editorial visual language defined in `/DESIGN.md`, using the user's
reference video as visual grounding without copying its features, data,
branding, or illustrations.

The redesign must make typography and composition carry the experience. Humi,
Hype, Hush, and Hexa keep their current responsibilities, callbacks, data
models, privacy behavior, and test semantics.

## Reference Findings

The reference succeeds because it uses:

- high-contrast serif display type paired with quiet sans-serif body text;
- a warm paper-like canvas and very little chrome;
- one dark focal element instead of many equally weighted cards;
- thin rules, generous section rhythm, and content-led composition;
- restrained accent marks and persistent navigation;
- transitions that preserve spatial continuity.

HUMHUM currently depends more heavily on Material component shapes, filled
role-color surfaces, and repeated cards. Its information is useful, but the
typography does not create enough hierarchy and the repeated containers make
the rooms feel like separate dashboards instead of one personal product.

## Scope

This iteration changes:

- global Android typography and neutral color tokens;
- shared room headers, section headers, list rows, and bottom navigation;
- composition of the first viewport in Humi, Hype, Hush, and Hexa;
- design documentation and visual QA fixtures;
- subtle destination and disclosure motion where it does not affect behavior.

This iteration does not change:

- pairing, relay, authentication, or connection behavior;
- health permissions or health data collection;
- Hush message ingestion, storage, filtering, or reply behavior;
- Hexa session discovery, approval, conversation, or follow-up behavior;
- Hype indexing and Humi interpretation data;
- settings, background services, notification policy, or release networking;
- production data or empty-state semantics.

## Typography Architecture

`HumHumTheme.kt` will expose an editorial Material type scale:

- `displaySmall`: 31/38 sp serif semibold;
- `headlineMedium`: 27/34 sp serif semibold;
- `titleLarge`: 21/28 sp serif semibold;
- `titleMedium`: 16/23 sp sans-serif semibold;
- `bodyLarge`: 15/23 sp sans-serif regular;
- `bodyMedium`: 14/21 sp sans-serif regular;
- labels remain 12-14 sp sans-serif;
- technical metadata is applied locally with monospace.

The first implementation uses Android's platform serif family. This preserves
full Chinese coverage on Xiaomi devices and avoids a large APK font payload or
a network-loaded font. Device screenshots will determine whether a bundled
font is necessary in a later, separately measured change.

App-bar role names remain sans-serif product labels. Serif is used for
page-level meaning, prominent dates and numbers, and major section headings.
Dense messages, controls, inputs, and Agent metadata remain sans-serif or
monospace.

## Shared Composition

### Page Intro

Each room begins with unframed temporal or contextual metadata, a serif
headline, and no more than two lines of supporting copy. The current data is
reused; no new greeting or summary is invented.

### Focus Surface

Each first viewport has at most one visually dominant surface:

- Humi: the strongest current suggestion or active today item;
- Hype: the strongest reusable insight from existing preferences, memory, or
  knowledge;
- Hush: no dark message card; the compact active filter and attention marks
  provide focus so correspondence remains calm;
- Hexa: the existing primary session control surface.

### Lists

Repeated content becomes flat editorial rows separated by short dividers.
Cards remain only where the content is a true focus surface, input tool,
permission state, or repeated object that needs a bounded hit target.

### Navigation

The four-role bottom navigation retains stable destination count, labels,
content descriptions, and callbacks. Active state becomes lighter and relies
on role color plus a compact indicator rather than a large filled tile.

## Role Designs

### Humi

The first viewport reads as a personal morning page:

1. temporal context;
2. serif interpretation of the current direction;
3. one high-contrast next-step surface;
4. today's items as editorial rows;
5. body signals as a restrained number strip.

Health permission and freshness behavior remains unchanged.

### Hype

Hype reads as a personal index:

1. search remains at the top;
2. the orientation statement becomes the serif page headline;
3. category controls become compact text destinations;
4. the strongest existing item becomes one focus surface;
5. remaining knowledge becomes divided rows.

No raw paths, roots, or file counts are promoted.

### Hush

Hush keeps its warm correspondence composition:

1. compact filters;
2. serif section heading and summary count;
3. sender-led rows with short dividers;
4. deterministic warm avatar tones;
5. mint privacy strip.

The redesign must not imply access to message content that the source does not
provide.

### Hexa

Hexa keeps the approved graphite and engineering-yellow primary session:

1. serif task headline above the panel;
2. dark primary session with monospace technical metadata;
3. visible progress, conversation access, approvals, and composer;
4. light secondary session rows below.

No terminal decoration, fake logs, or cyberpunk effects are added.

## Components

Existing shared components in `RoomComponents.kt` and
`components/RoleNavigation.kt` will be refined before adding new components.
Small role-local components remain role-local.

New shared abstractions are allowed only for repeated composition:

- editorial page intro;
- focus surface treatment;
- section header;
- short-divider list row.

They must accept content and colors without knowing Humi, Hype, Hush, or Hexa
data models.

## Motion

Motion is subordinate to reading:

- role destination content may fade and settle vertically over 220 ms;
- disclosure changes use 180-240 ms;
- presses use color or opacity response without resizing controls;
- all fixed-format elements preserve their dimensions.

No continuous decoration or mascot animation is part of this iteration.

## Error And Empty States

Current error messages, authorization prompts, empty states, and retry actions
remain behaviorally unchanged. Styling follows the editorial hierarchy:

- clear serif state title;
- one plain-language explanation;
- one primary action;
- technical details behind explicit disclosure.

## Testing

Implementation uses behavior-preserving tests:

- theme tests cover the new neutral and focal contrast pairs;
- Compose instrumentation tests retain all current navigation, filtering,
  permission, approval, conversation, and follow-up assertions;
- first-viewport tests verify the focus surface and required actions remain
  visible;
- 1.3x font scale tests guard serif headline clipping;
- Android 16 screenshots are captured for all four roles at 390 x 844;
- full JVM tests, lint, connected tests, and signed release build run before
  delivery.

## Acceptance Criteria

- The app is recognizably HUMHUM but has the editorial confidence of the
  reference.
- Typography, not decorative imagery, creates the first impression.
- Each room shares one design language while preserving its role signature.
- There is no new product functionality or invented user data.
- Hush messages and Hexa controls remain useful in the first viewport.
- No page becomes a nested-card dashboard.
- All text and controls remain readable on a Xiaomi-class Android device.
