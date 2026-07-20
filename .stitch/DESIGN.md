# Design System: HUMHUM Quiet Rooms
**Project ID:** 17103155804088058110

## 1. Visual Theme & Atmosphere

HUMHUM is a calm personal Agent workspace, not a dashboard and not a mascot gallery. The interface should feel like a bright, quiet room where one role is present and useful. It is soft without becoming childish, operational without becoming technical, and personal without becoming decorative.

Each role has a distinct environmental image, but the character is never a sticker, floating badge, tab icon, or replacement for information. Treat the supplied character artwork as immutable brand art: place it as a cropped background composition with a protected empty area for content, and never redraw, restyle, or invent a new character.

The foreground uses a restrained editorial hierarchy, generous breathing room, and very little visible chrome. Information appears in full-width sections and compact rows. Cards are reserved for a discrete conversation, approval, message, or reusable knowledge object.

## 2. Color Palette & Roles

- **Quiet Paper (#F7FAFC):** Main application canvas and calm reading surface.
- **Clear White (#FFFFFF):** Focused inputs, conversations, approvals, and repeated object cards.
- **Deep Ink (#1F2937):** Primary text and important icons.
- **Soft Slate (#657386):** Supporting copy, source labels, and timestamps.
- **Hairline Mist (#DCE4ED):** Dividers, input outlines, and low-contrast boundaries.
- **Humi Aqua (#298DA8):** Conversation, personal interpretation, and primary action.
- **Hype Coral (#E85D37):** Knowledge, reusable skills, and memory organization.
- **Hush Jade (#278665):** Relationships, message attention, and privacy trust.
- **Hexa Blue (#2779B9):** Agent supervision, control, and confirmed action.
- **Companion Lavender (#8F68D8):** Rare secondary emphasis and Hype relationship signals.
- **Attention Yellow (#EABF31):** User confirmation and items requiring review, never decorative.
- **Risk Rose (#B94154):** Destructive actions and genuine errors only.

Role colors identify responsibility, not entire pages. Keep the canvas neutral so all four roles feel like one product rather than four unrelated themes.

## 3. Typography Rules

Use **Noto Sans SC** as the primary Chinese interface family and **Inter** for Latin role names, numerals, and compact status data. Letter spacing is always zero.

- Page titles: 24px, 700 weight, short and literal.
- Section titles: 17px, 700 weight.
- Object titles: 15px, 600 weight.
- Body copy: 14px, 400 weight, comfortable line height.
- Labels and sources: 12px, 500 weight.
- Numeric summaries: 22px, 650 weight, tabular numerals where supported.

Avoid condensed display fonts, novelty fonts, all-caps Chinese text, oversized headings inside panels, and decorative type treatments.

## 4. Component Stylings

* **Navigation:** Four stable destinations using the same role symbols as the Mac app: microphone for Humi, radio tower for Hype, eye for Hush, and wrench for Hexa. Use icon plus short label, a thin active marker, and no mascot thumbnails or pill-shaped tab backgrounds.
* **Buttons:** 48px minimum touch height, 8px corners, solid role color for the one primary action, outlined or text treatment for secondary actions. Icon-only buttons use familiar symbols, 48px targets, 6px corners, and tooltips or accessibility labels.
* **Cards/Containers:** Maximum 8px corners, hairline border, clear white fill, and either no shadow or a whisper-soft shadow. Never nest cards and never wrap an entire page section in a floating card.
* **Rows:** Full-width, scan-friendly objects separated by hairline dividers. Use a small source/status label at the trailing edge; keep raw paths and diagnostics behind disclosure.
* **Inputs/Forms:** Clear white fill, 8px corners, quiet outline, persistent label when needed. Humi's composer is a primary conversation surface, not a generic search box.
* **Status:** Compact text with a small semantic icon. Pills are limited to short states such as “需要你” or “只读”.
* **Privacy Signals:** Show source, freshness, and permission state beside the data they qualify. Use plain language and never imply access that has not been granted.

## 5. Layout Principles

Use a mobile-first single-column frame with a stable 60px utility header and 68px bottom role navigation. Preserve safe areas and a predictable 16px horizontal content inset.

The first viewport must answer three questions: which role is active, what matters now, and what the user can do next. Do not start every page with the same title-summary-card pattern.

- **Pairing:** Brand and trust first, one primary QR action, paste as secondary, manual recovery collapsed.
- **Humi:** Conversation composer and interpreted “today” response first; memory and body signals support the conversation rather than competing as dashboard metrics.
- **Hype:** Search and reusable knowledge first; organize skills, preferences, habits, and confirmed memory by meaning rather than file type.
- **Hush:** People and messages needing attention first; relationship context and suggested tone are visible, while reply remains user-controlled and source access remains read-only by default.
- **Hexa:** Items requiring user decision first, then active Agent work and recent outcomes; controls appear only when the current permission scope allows them.
- **Settings:** Quiet utility list grouped by connection, data sources, background behavior, privacy, and diagnostics. No character background is required.

Character art occupies one deliberate edge or upper field of the room image. Foreground content must remain legible without a large translucent sheet covering the art. On compact screens, crop the image rather than shrinking the character into a pasted thumbnail.

## 6. Motion & Feedback

Use motion only to preserve context: short crossfades between rooms, a subtle active navigation transition, and local progress indicators for pairing, refresh, approval, and sending. Respect reduced-motion settings. Avoid continuous mascot movement, parallax, bouncing, and decorative particle effects.
