# HUMHUM Android Four-Role UI Design

## Goal

Bring the Android client into the same product family as the desktop hub while keeping the mobile experience focused on quick interpretation and remote action. The paired experience must visibly and meaningfully represent Humi, Hype, Hush, and Hexa.

## Product Structure

The connected screen uses four persistent tabs:

- **Humi** is the default tab. It interprets the real session list into a calm summary of current work and surfaces the most important next action.
- **Hype** explains that personal knowledge remains local to the Mac until a dedicated, scoped mobile summary API exists. It must not invent memories or expose local file paths.
- **Hush** explains the read-only, user-controlled message boundary. It must not imply that private message contents have been synchronized when they have not.
- **Hexa** preserves the existing session list, recent-conversation disclosure, approvals, follow-up messages, background monitoring, and device-care controls.

The pairing screen remains a focused security flow and does not expose unavailable role tabs.

## Mascot Mapping And Themes

The supplied images map by sequence:

| Role | Source image | Character | Accent | Soft surface |
| --- | --- | --- | --- | --- |
| Humi | `已生成图像 1 (4).png` | calm, reflective interpreter | lavender `#8174D6` | `#F1EEFF` |
| Hype | `已生成图像 2.png` | energetic organizer | coral `#EE7B62` | `#FFF0E9` |
| Hush | `已生成图像 3 (1).png` | quiet, privacy-conscious companion | mint `#4FAF98` | `#EAF8F4` |
| Hexa | `已生成图像 4 (1).png` | precise technical supervisor | gold `#C89A24` with sky-blue support | `#FFF7DE` |

Each role page uses the same warm canvas, typography, 8dp card radius, spacing, and navigation geometry. Character identity appears through the mascot image, accent line, status chips, and primary action. Pages must not become four unrelated single-color themes.

## Layout

The root becomes a vertical layout with a weighted scroll area and a bottom role navigation bar. The bottom bar stays outside the scroll area and respects system insets.

Each role tab has:

1. A compact mascot header with role name and one-sentence purpose.
2. Interpreted content rather than raw diagnostics.
3. A role-specific empty or unavailable state grounded in real capabilities.
4. At most one visually dominant action in the first viewport.

Hexa keeps detailed controls below its interpreted header. Reliability controls move behind an explicit disclosure so active sessions remain the primary content.

## Data And Privacy

No new desktop bridge endpoint is introduced in this tranche.

- Humi derives totals and attention state only from the already authorized `/api/sessions` response.
- Hype and Hush show honest capability boundaries until dedicated scoped APIs exist.
- Hexa uses the existing authorized data and control routes without changing TLS pinning, pairing, token storage, or scope checks.
- Switching tabs never triggers new permissions or network requests.

## Accessibility And Resilience

- Every tab target is at least 56dp high and has a role-specific content description.
- Text-bearing controls use `wrap_content` with minimum heights so font scaling does not clip labels.
- Selected state uses color, text weight, and a visible indicator; it never relies on color alone.
- Mascot images are decorative and have null accessibility importance because the tab and heading already name each role.
- Rotation retains the selected role alongside existing draft and send state.
- Conversation privacy behavior and `FLAG_SECURE` remain unchanged.

## Verification

- JVM tests cover Humi summaries and role metadata.
- XML contract tests require four tabs, four mascot resources, minimum touch sizes, a scroll area, and a bottom navigation outside that scroll area.
- Existing Android tests remain green.
- A debug APK is built and inspected.
- The connected UI is captured at a phone viewport when an emulator or physical device is available; without a device, layout contracts and APK resource inspection are recorded as the honest limit.

