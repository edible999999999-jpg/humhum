# Editorial Mobile Preview Design QA

- Source visual truth: local-only user reference video (not committed)
- Source comparison frame: local-only extracted frame (not committed)
- HTML implementation: `design/mobile-editorial-preview/index.html`
- HTML full board: `design/mobile-editorial-preview/preview-board.png`
- Compose full board: `design/mobile-editorial-preview/compose-board.png`
- Compose screenshots:
  - `design/mobile-editorial-preview/compose-screenshots/living-signals-first-viewport.png`
  - `design/mobile-editorial-preview/compose-screenshots/hype-first-viewport.png`
  - `design/mobile-editorial-preview/compose-screenshots/hush-first-viewport.png`
  - `design/mobile-editorial-preview/compose-screenshots/hexa-first-viewport.png`
- Normalized reference comparison: local-only (not committed)
- State: four connected role rooms with production-shaped HUMHUM fixture data
- CSS viewport: each phone is 390 x 844 px
- Device scale factor: 1
- Source pixels: 288 x 640, normalized by proportional scale and center crop
  to 390 x 844 for style comparison
- Implementation CSS viewport: 390 x 844 per phone
- Captured PNG pixels: 390 x 845 per phone (the extra pixel is the rendered border edge)
- Compose screenshot pixels: 390 x 844 per phone on API 36

## Full-View Comparison

The source and implementation were combined in
`comparison-humi.png` before evaluation. The comparison is intentionally at the
visual-language level because the user requested the source's typography and
design character, not its diary, relationship, health, decorative overlays, or
social features.

The implementation preserves the source's visible strengths:

- high-contrast serif page titles paired with quiet sans-serif body text;
- warm near-white paper rather than a tinted dashboard canvas;
- one dark focal surface near the top of the reading flow;
- thin rules and whitespace in place of repeated bordered cards;
- editorial number treatment and persistent compact navigation.

The implementation intentionally omits source-specific avatars, hearts,
decorative overlays, engagement controls, and diary features. HUMHUM role
icons, real room labels, privacy language, and Agent controls replace them.

## Focused Region Comparison

No separate crop was required. The 780 x 844 normalized comparison keeps the
headline, dark focus surface, section title, list rows, metrics, and navigation
readable at one-to-one density.

## Required Fidelity Surfaces

### Fonts And Typography

The HTML preview and Android app load the same checked-in variable font files:
Noto Serif SC for editorial display, Noto Sans SC for product text, and Roboto
Mono for technical metadata. Letter spacing is zero in both implementations.
There is no Xiaomi or browser system-font fallback in the approved surfaces, so
line wrapping and glyph metrics stay stable across the preview and APK.

### Spacing And Layout Rhythm

Phone frames are exactly 390 x 844. Major sections use 22-24 px separation,
list rules start at the text column, and bottom navigation keeps a stable 70 px
height. There are no nested cards or clipped first-viewport actions.

### Colors And Tokens

The implementation uses warm paper, near-black focus surfaces, restrained role
accents, and role-specific soft fields. Contrast remains visibly strong in the
reference states. Automated contrast checks remain required in Compose.

### Image Quality And Asset Fidelity

No reference imagery was copied. The prototype uses the Phosphor icon font for
standard interface icons and text-based sender initials already supported by
HUMHUM. It does not substitute CSS drawings, emoji, placeholder images, or
generated decorative art for source assets.

### Copy And Content

All visible product copy is HUMHUM-specific and reflects existing Humi, Hype,
Hush, and Hexa responsibilities. No diary, relationship, anniversary, or
engagement feature from the reference was introduced.

## Interaction And Runtime Checks

- The All filter shows all four phone screens.
- Humi, Hype, Hush, and Hexa filter controls each isolate one screen.
- All four phone elements measure 390 x 844 CSS px.
- 52 Phosphor interface icons loaded.
- No empty role/list icon marks remain.
- Chrome console errors: none.
- Android API 36 instrumented tests: 37 passed, 0 failed.
- Compose screenshots are 390 x 844 with no visible overlap or clipped primary
  action in the four approved role states.

## Comparison History

### Pass 1

- P2: Hype's second capability used an unavailable Phosphor icon name and
  rendered as an empty role mark.
- Fix: replaced it with the available `ph-circuitry` icon.

### Pass 2

- Post-fix evidence: zero empty row marks and zero browser console errors.
- No actionable P0, P1, or P2 differences remain for the approved
  visual-language preview.

### Pass 3

- P2: all four roles still inherited too much of the same light app template,
  so their personalities read mainly as color changes.
- Fix: introduced an asymmetric issue masthead for Humi, an indexed folio count
  for Hype, a warmer correspondence layout for Hush, and a full dark yellow-black
  mission surface with mono telemetry for Hexa.
- Post-fix evidence: four distinct compositions at the same stable viewport,
  role filtering remains correct, and Chrome still reports zero console errors.

### Pass 4

- P1: the approved visual language existed only in HTML and the production
  Compose rooms still used the earlier shared light dashboard shell.
- Fix: moved the four distinct editorial compositions into Compose, made the
  role canvas drive the shared header and navigation, retained Hush filters and
  Hexa follow-up controls, and added role-spec regression coverage.
- Post-fix evidence: four API 36 Compose screenshots at 390 x 844, all 36
  instrumented tests passing, unit tests passing, and a successful debug build.

### Pass 5

- P1: the preview and production app still used different platform font
  resolution, so Chinese glyph widths, wrapping, and vertical rhythm could
  diverge on Xiaomi.
- Fix: bundled Noto Serif SC, Noto Sans SC, and Roboto Mono; loaded those exact
  files in both HTML and Compose; fixed display typography to 29/36, section
  typography to 20/27, and all letter spacing to zero.
- Post-fix evidence: four regenerated 390 x 844 Compose screenshots, 37/37 API
  36 instrumented tests, Android lint, Android debug APK build, and typography
  metric unit tests all passing.

final result: passed
