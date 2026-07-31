# HUMHUM Android Role Visual Personality

## Goal

Strengthen the emotional identity of Hexa and Hush without changing their
information architecture, behavior, permissions, or the shared HUMHUM shell.

## Shared Boundary

- Keep the current top app bar, four-role bottom navigation, spacing scale,
  typography hierarchy, and 8 dp component radius.
- Keep all existing actions, test tags, data sources, privacy copy, and empty
  states.
- Do not add mascot images, gradients, decorative blobs, fake terminal output,
  or invented message data.
- Role styling applies to the room content and its task-specific components.
  The app must still feel like one product.

## Hexa

Hexa should feel like a calm engineering control surface rather than a generic
yellow dashboard.

- Use a near-black graphite surface for the primary Agent session.
- Use engineering yellow for status, progress, focus rings, and the send action.
- Keep body copy high-contrast warm white and secondary metadata cool gray.
- Use monospace typography only for Agent, status, time, and command metadata.
- Present the follow-up field as a command composer joined visually to the
  primary session.
- Secondary sessions stay light to preserve hierarchy and scanning speed.
- Avoid neon, matrix effects, full-screen black, and dense terminal decoration.

## Hush

Hush should feel like a private, warm correspondence room rather than a system
notification list.

- Use warm white as the room canvas and pale peach for the segmented filter.
- Keep mint as the privacy and trusted-source color.
- Use soft peach or rose accents for messages that need attention.
- Replace hard full-width separators with shorter, lower-contrast dividers.
- Give sender avatars subtle warm variations while preserving deterministic
  initials and readable contrast.
- Keep sender, time, source, and preview visible; warmth must not reduce message
  density or privacy clarity.

## Components

- Add role-specific semantic colors to `HumHumTheme.kt`.
- Add a dark primary variant to the Hexa session panel while preserving the
  existing light secondary variant.
- Add warm message-tone selection and softer filter styling to Hush.
- Update the high-fidelity board and Android visual fixtures to match.

## Verification

- Existing JVM, UI, privacy, permission, and follow-up behavior tests remain
  green.
- Add assertions that the Hexa primary session exposes the command composer and
  that Hush filters continue to work after styling changes.
- Capture Hush and Hexa at 390 x 844 on Android 16 and inspect contrast,
  clipping, bottom navigation separation, and large-font behavior.
- Run `testDebugUnitTest`, `lintDebug`, `connectedDebugAndroidTest`, and a signed
  release build before delivery.
