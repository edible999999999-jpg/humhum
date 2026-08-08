# HUMHUM Vanguard Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone, responsive HUMHUM promotional preview at `/vanguard` without changing the existing `/intro` experience.

**Architecture:** `App.tsx` selects a new self-contained `VanguardPreviewPage` for the `/vanguard` pathname. The component holds only the mobile navigation state; all visual rules remain under `vanguard-*` CSS selectors so desktop windows and the existing introductory site retain their current styles.

**Tech Stack:** React 18, TypeScript, Vite, CSS, Lucide React.

## Global Constraints

- Keep `/intro`, desktop-window views, Tauri commands, and persistent data unchanged.
- Use the supplied CloudFront MP4 as decorative autoplay-safe hero media with an opaque visual fallback.
- Use HUMHUM copy and soft mint, lavender, and peach accents; do not reuse VANGUARD brand text or claims.
- Make all navigation and controls usable at mobile and desktop widths, with visible keyboard focus.
- Do not add dependencies or a routing library.

---

### Task 1: Add the Isolated Preview Route and Page

**Files:**
- Create: `src/components/Vanguard/VanguardPreviewPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `VanguardPreviewPage(): JSX.Element`.
- Consumes: the browser pathname and Lucide `ArrowUpRight`, `Menu`, `Sparkles`, and `X` icons.

- [ ] **Step 1: Confirm the current route does not recognize the preview**

Run: `npm run build`

Expected: PASS before the change; `/vanguard` is not selected by `App`.

- [ ] **Step 2: Create the page component**

Implement `VanguardPreviewPage` with:

```tsx
const [menuOpen, setMenuOpen] = useState(false);
const roles = [
  { name: "Humi", summary: "Understands your rhythm." },
  { name: "Hype", summary: "Keeps your knowledge close." },
  { name: "Hush", summary: "Helps you stay in touch." },
  { name: "Hexa", summary: "Keeps your Agents in view." },
];
```

Render the decorative video, overlay, desktop navigation, mobile dialog-style menu, hero copy, two action links, three proof points, and four role articles. Every mobile-menu action must set `menuOpen` to `false`.

- [ ] **Step 3: Select the route from the root application**

Add the import and route condition before the existing intro condition:

```tsx
const isVanguardRoute = window.location.pathname === "/vanguard";

if (isVanguardRoute) {
  return <VanguardPreviewPage />;
}
```

- [ ] **Step 4: Verify type and bundle output**

Run: `npm run build`

Expected: PASS and Vite emits a production bundle without TypeScript errors.

- [ ] **Step 5: Commit the route and component**

```bash
git add src/App.tsx src/components/Vanguard/VanguardPreviewPage.tsx
git commit -m "feat: add vanguard promotional preview"
```

### Task 2: Add Scoped Responsive Presentation Styles

**Files:**
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: `vanguard-*` class names from `VanguardPreviewPage`.
- Produces: desktop and mobile layouts, hero motion, background fallback, menu transitions, and visible focus treatment.

- [ ] **Step 1: Add a complete scoped style block**

Append CSS under the `/* ===== HUMHUM Vanguard Preview ===== */` heading. Define these selectors:

```css
.vanguard-page { min-height: 100vh; background: #11171a; }
.vanguard-video { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.vanguard-scrim { position: fixed; inset: 0; background: linear-gradient(90deg, rgba(8, 13, 16, .88), rgba(8, 13, 16, .24)); }
.vanguard-mobile-menu[data-open="true"] { opacity: 1; pointer-events: auto; }
.vanguard-page :focus-visible { outline: 2px solid #c7f5e8; outline-offset: 4px; }
```

Add complementary layout rules for the navigation, hero, calls to action, proof points, and role strip. Include a `@media (max-width: 767px)` block that hides desktop navigation, shows the menu control, stacks proof points, and constrains headings so no text overflows.

- [ ] **Step 2: Verify styles compile**

Run: `npm run build`

Expected: PASS with the Tailwind/PostCSS pipeline processing the scoped CSS successfully.

- [ ] **Step 3: Commit the visual treatment**

```bash
git add src/styles/global.css
git commit -m "style: add vanguard preview presentation"
```

### Task 3: Verify the Local Preview

**Files:**
- Modify: no source files unless verification reveals a scoped presentation defect.

**Interfaces:**
- Consumes: the `/vanguard` route created in Task 1 and styles from Task 2.
- Produces: local preview evidence at `http://localhost:1420/vanguard`.

- [ ] **Step 1: Run the production check**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 2: Start the local Vite server**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite reports `http://127.0.0.1:1420/`.

- [ ] **Step 3: Check desktop and mobile behavior**

Open `http://127.0.0.1:1420/vanguard` at a desktop width and at 390px width. Confirm the video/scrim or fallback renders, the heading and actions remain visible, desktop links change to the menu control below 768px, the full-screen menu opens and closes, and every anchor stays within the preview page.

- [ ] **Step 4: Final whitespace check**

Run: `git diff --check`

Expected: no output.
