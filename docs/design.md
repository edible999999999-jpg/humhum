# HUMHUM Design Direction

HUMHUM is a personal Agent hub. Its interface should feel like a soft companion space, not an engineering console.

The system may know a lot: local skills, agent rules, memory files, YAML configs, sessions, tool usage, message sources, and project traces. The user should not have to look at all of that. HUMHUM's job is to turn the mess into a small number of kind, useful observations.

## 1. Experience Principle

Default product surface:

> Humi noticed something about you and explains it gently.

Not:

> Here are 1,753 files, 47 Bash calls, 42 Read calls, and a list of roots.

Every screen should prefer interpreted meaning over raw evidence.

### What We Show

- "Your current work direction"
- "Skills you seem to rely on"
- "Preferences I should remember"
- "Things that may need your attention"
- "A small next step"

### What We Hide By Default

- raw file paths
- scan roots
- asset counts
- tool call tables
- JSON, YAML, markdown internals
- long debug explanations

Raw details may exist behind `Details`, `Debug`, or developer mode. They should never be the first thing a normal user sees.

## 2. Visual Personality

HUMHUM should visually match Humi:

- warm white
- pale blue
- soft lavender
- mint
- peach
- translucent glass
- gentle shadows
- rounded surfaces
- calm spacing

The UI should feel like morning light on a desk, not a dark hacker dashboard.

### Palette

| Token | Color | Use |
| --- | --- | --- |
| `paper` | `#fffaf7` | main warm surface |
| `milk` | `#f7fbff` | secondary surface |
| `mist` | `#eaf7ff` | pale blue background |
| `lavender` | `#eee8ff` | Humi accent |
| `mint` | `#dff8ef` | calm success |
| `peach` | `#ffe4d6` | warmth and emotion |
| `ink` | `#263241` | primary text |
| `soft-ink` | `#64748b` | secondary text |
| `line` | `rgba(116, 143, 165, 0.18)` | borders |

Avoid dominant black, cyberpunk neon, terminal green, heavy purple gradients, or dense slate panels.

## 3. Layout Rules

HUMHUM windows should look like conversation spaces.

- Lead with a friendly sentence.
- Use one primary text input or chat box.
- Keep scan and setup controls visually secondary.
- Use small insight cards, not dashboards.
- Do not make users configure roots before the screen feels useful.
- Keep technical status in a quiet footer or collapsed details.

### Humi Page

Humi is a warm interpreter.

Primary surface:

- Humi avatar or soft identity mark
- conversational input
- answer bubble
- three small cards:
  - work direction
  - remembered preferences
  - next step

Hidden details:

- local asset count
- top tools
- indexed skills
- memory path
- roots
- Pi/Qoder technical status

### Hype Page

Hype is the organizer of the user's personal Agent knowledge base.

It should show:

- what knowledge exists
- what is duplicated
- what should become long-term memory
- what skill/rule categories are missing

It should not start as a file explorer.

### Hush Page

Hush is a message relationship helper.

It should show:

- family, friends, work, and signal summaries
- what needs a response
- suggested tone, not automatic replies
- bridge status only as a trust indicator

Local source scanning must remain user-approved and read-only.

### Hexa Page

Hexa is the Agent supervisor.

It should show:

- what each Agent is doing
- where user confirmation is needed
- what went well
- what drifted
- what should be remembered

It should not become a multi-agent orchestration dashboard.

## 4. Copywriting Rules

Use human language.

Prefer:

- "I noticed..."
- "You seem to be..."
- "I can remember this for next time."
- "This may be worth checking."
- "A gentle next step..."

Avoid:

- "Local kernel indexed..."
- "Asset mix..."
- "Bridge mode..."
- "Root diagnostics..."
- "Top tools..."

If technical terms are necessary, put them in details.

## 5. Interaction Rules

- One clear primary action per section.
- Suggested prompts should feel like questions to Humi, not commands to a scanner.
- Details should be collapsible.
- User-owned local data should be described with trust language.
- Never imply private messages are connected until they are actually indexed with user approval.

## 6. Character Alignment

HUMHUM's character source is the immortal jellyfish.

The jellyfish has many tentacles, so it can connect many tools and life streams. It can return to a younger state, so it becomes a metaphor for restoring order when apps, messages, tasks, and Agents make life feel scattered.

The character should feel soft, quiet, and reliable. It is not a cold robot and not a pleasing assistant that blindly agrees. It helps the user keep their own center.

## 7. Implementation Checklist

Before finishing a UI change, check:

- Does the first screen explain value without showing raw internals?
- Does it look close to Humi's white/pastel character style?
- Are technical details hidden by default?
- Does the copy make the user feel understood?
- Is there a clear next step?
- Is private/local data handled with explicit trust boundaries?

If a screen mainly says "we found files", it is not finished.
