# HUMHUM Android Companion Rooms Design

## Status

Approved for implementation on 2026-07-19.

Desktop visual baseline: `origin/main` at `ad438aa`.

## Goal

Rebuild the Android app as a mobile companion to the HUMHUM character-room
system:

- Humi keeps the Mac conversation role and adds mobile companion capabilities.
- Hype, Hush, and Hexa keep the same product roles as the Mac app.
- Mac remains the source of truth for user-owned knowledge and Agent state.
- Android receives only bounded, user-authorized projections rather than raw
  files, paths, transcripts, or private stores.

## Product Roles

### Humi

Humi is the Android home and companion. It combines:

- a concise daily brief;
- confirmed habits and preferences;
- selected recent memories;
- phone-local health summaries;
- a direct conversation entry;
- clearly separated suggestions that require user acceptance.

### Hype

Hype is the mobile view of the user's personal Agent knowledge:

- created, installed, and recently used skills;
- rules, preferences, memories, and Obsidian summaries;
- search and scope filters;
- no raw file bodies or absolute paths.

### Hush

Hush is the mobile inbox:

- authorized conversation summaries;
- unread and special-attention state;
- bounded message excerpts;
- source-specific permission and privacy state.

Health permissions are not a Hush product surface. They move to Humi's data
sources and app settings.

### Hexa

Hexa remains the Agent supervisor:

- active and watched Agent sessions;
- goals, current steps, blockers, and waiting confirmations;
- recent safe conversation excerpts;
- approve, reject, and follow-up controls when the device has control scope.

## Data Sources

| Mobile surface | Source of truth | Projection rule |
| --- | --- | --- |
| Humi today | active `HexaGoalStore` goals, `HexaWatchStore` work items, explicitly selected Obsidian tasks | Include only explicit, incomplete items. Suggestions remain separate until accepted. |
| Humi health | Android Health Connect; phone step counter fallback for steps | Daily step, resting heart-rate, and sleep summaries only. Raw samples remain on the phone. |
| Humi preferences | `~/.humhum/vault/preferences/` through `KnowledgeStore` | Include only user-saved or user-confirmed preferences. |
| Humi memories | `~/.humhum/vault/memory/` through `KnowledgeStore` | Include a small relevant set of summaries, never the originating transcript. |
| Humi habits | new structured habit store | Agents may create suggestions; only confirmed habits enter the mobile snapshot. |
| Hype | `KnowledgeStore`, `skill_index`, enabled Obsidian index | Include name, human summary, type, ownership, and update time. Remove file paths and bodies. |
| Hush | `HushStore` and explicitly authorized message bridges | Include conversation summary, unread state, attention state, and bounded safe excerpts. |
| Hexa | `HexaGoalStore`, `HexaWatchStore`, existing mobile session projection | Preserve the existing read/control split and safe transcript projection. |

## Personal Context Contract

The desktop creates a versioned `MobilePersonalContext`:

```json
{
  "schema_version": 1,
  "generated_at": "2026-07-19T12:00:00Z",
  "expires_at": "2026-07-20T12:00:00Z",
  "today": [],
  "suggestions": [],
  "preferences": [],
  "habits": [],
  "memories": [],
  "knowledge": [],
  "inbox": []
}
```

Global bounds:

- at most 5 confirmed today items;
- at most 3 suggestions;
- at most 8 preferences;
- at most 8 confirmed habits;
- at most 6 recent memories;
- at most 40 Hype knowledge summaries;
- at most 30 Hush conversation summaries;
- at most 500 Unicode scalar values per visible summary;
- default expiry after 24 hours.

Every item carries a stable opaque ID, reader-facing title, bounded summary,
updated time, source category, and confirmation state where applicable. Mobile
payloads never contain absolute paths, local usernames, raw Agent files,
credentials, complete transcripts, or unconfirmed inferred habits.

## Habit Lifecycle

HUMHUM currently has no trustworthy habit record, so the redesign introduces a
separate structured lifecycle:

1. Evidence may produce a `suggested` habit on Mac.
2. Humi shows the suggestion separately from facts.
3. The user may confirm, dismiss, or retire it.
4. Only `confirmed` habits enter `MobilePersonalContext`.
5. Rejected evidence cannot immediately recreate the same suggestion.

Habit records contain a stable ID, title, plain-language summary, category,
cadence, status, confirmation time, update time, and bounded evidence
references. Evidence references identify source categories and opaque records,
not raw text or file paths.

## Transport And Privacy

- Pairing remains explicit.
- Agent `read` and `control` scopes remain unchanged.
- Personal context requires a separate `personal_context` device capability.
- LAN and Anywhere use the same logical snapshot contract.
- Existing authenticated encryption is reused; relay wake messages carry only a
  change signal, never personal content.
- Android stores the latest accepted snapshot in encrypted app-private storage.
- Device revocation, disconnect, or local-data deletion removes the encrypted
  snapshot.
- Expired data may remain visible offline with a clear "last synced" label, but
  time-sensitive suggestions and actions are disabled.
- Parsing fails closed: an invalid version, oversized list, unknown critical
  field, invalid timestamp, or non-bounded string rejects the new snapshot and
  retains the last valid one.

## Android Information Architecture

The app keeps four destinations, but the mobile layouts are not scaled-down
desktop windows.

### Shared shell

- Compact top identity row with current room, connection freshness, and settings.
- Bottom navigation uses stable Material/Lucide-equivalent symbols and labels,
  not four full mascot portraits.
- Every room uses the desktop room accent tokens and a low-contrast,
  text-free raster background crop.
- One small full mascot may appear near the room title or a meaningful state.
- Primary controls meet a 48dp touch target.
- Cards are reserved for selected objects, permissions, or actionable decisions.
  Lists use spacing and dividers.

### Humi room

- First viewport: Humi brief, data freshness, and one direct conversation action.
- Continuous sections: Today, Humi suggestions, I remember, Confirmed habits.
- Phone health appears as a compact personal-signal row, not as the entire Humi
  identity.
- Suggestions use an explicit "Add to today" command and never resemble confirmed
  items.

### Hype room

- Search is the dominant top action.
- Segmented scopes: Skills, Rules, Memories, Obsidian.
- Dense list rows show title, one-line purpose, source category, type, and update
  time.
- Default scope is user-created and explicitly installed knowledge.

### Hush room

- Conversation list is the default phone view.
- Selecting a conversation navigates to a full-screen message detail.
- Filters: All, Special attention, Unread.
- Message excerpts are grouped chronologically rather than rendered as a card
  for every message.
- Permission or unavailable-source states explain what the user must authorize.

### Hexa room

- Session/goal list is the default view.
- Selecting an item opens a supervision detail with current step, blockers,
  evidence, and waiting decisions.
- The intervention composer stays at the bottom of the detail screen.
- Approval controls clearly distinguish read-only devices from control devices.

## Visual Direction

- Pearl white base with per-room accents from the Mac character-room design.
- Humi: pale aqua, lilac, and restrained coral.
- Hype: orange-red and purple.
- Hush: mint, warm attention orange, and source-specific messaging colors.
- Hexa: yellow attention and sky-blue progress.
- Avoid gradients as the primary surface, oversized mascots, portrait-filled
  navigation, nested cards, dark dashboards, and hero-scale mobile headings.
- Use native system typography with clear 12sp metadata, 14-16sp body, and
  20-24sp room titles.

## State And Error Handling

- Unpaired: pairing remains the only primary task.
- Connecting: retain the last valid encrypted snapshot and show refresh state.
- Offline: show cached content and age; disable operations that require Mac.
- Empty: explain which source is empty or unauthorized rather than displaying a
  generic blank screen.
- Partial: each room can render independently when another projection is
  unavailable.
- Revoked: remove personal context immediately and return to pairing.
- Health unavailable: Humi continues without health data and links to data
  source settings.

## Component Boundaries

Desktop:

- `mobile_personal_context.rs`: bounded projection and redaction.
- `habit_store.rs`: structured habit lifecycle and private persistence.
- `mobile_bridge.rs`: authenticated endpoints and Anywhere action routing only.

Android:

- `PersonalContextModels.kt`: strict wire and UI models.
- `PersonalContextProtocol.kt`: parsing and request construction.
- `EncryptedPersonalContextStore.kt`: encrypted offline snapshot.
- `CompanionContextRepository.kt`: refresh and transport coordination.
- `ui/rooms/`: one screen per role.
- `ui/components/`: shared room shell, compact navigation, freshness state, and
  list primitives.

The existing `MobileCompanionRepository` remains the single network lane. UI
components never access transport or persistent stores directly.

## Testing And Acceptance

- Rust unit tests cover bounds, redaction, capability checks, projection
  determinism, habit confirmation, and fail-closed serialization.
- Android JVM tests cover strict parsing, expiry, last-valid fallback,
  revocation, and reducer transitions.
- Compose tests cover all four destinations, navigation semantics, empty,
  offline, unauthorized, and populated states.
- Screenshot tests capture phone viewports at 360x800 and 412x915.
- Text must not clip at Android font scales 1.0 and 1.3.
- No horizontal scrolling is permitted.
- Existing pairing, relay, session control, health upload, and device-revocation
  tests must continue to pass.

