# Humi Host-Agent Brain Design

## Summary

Humi will stop treating Pi Agent as its identity and mandatory runtime. HUMHUM will
become the local control plane for a persistent personal identity, while a
user-selected host Agent provides reasoning and execution.

During initialization, HUMHUM detects which supported Agents are actually callable
on the Mac and asks the user to choose a primary brain. The first supported primary
brains are Codex, Qoder CLI, and Claude Code. Pi remains an optional, explicitly
configured fallback. Humi's identity continues across providers because its soul,
preferences, rules, memories, skills, and module context remain owned by HUMHUM.

The design follows the useful boundary demonstrated by Happy: a local daemon owns
provider detection, session lifecycle, normalized events, persistence, and routing;
provider adapters drive the real installed Agents. HUMHUM adds a cross-provider
personal identity, Hype/Hush/Hexa context, and a local Pi fallback rather than
adopting Happy's account, relay, or coding-session product model.

## Goals

- Let the user choose Codex, Qoder CLI, or Claude Code as Humi's primary brain.
- Preserve one Humi identity when the primary brain changes.
- Keep Pi available as a visible fallback instead of the mandatory foundation.
- Run Humi work in an isolated provider session that does not contaminate development
  sessions.
- Give every supported provider the same bounded context and structured result
  contracts.
- Automatically analyze new messages from Hush conversations that the user has
  explicitly marked as special attention.
- Distinguish direct-message reply decisions from group-chat observation.
- Keep original Hush messages read-only and never send a reply automatically.
- Show accurate relative dates in the Hush conversation list.
- Recover queued analysis after a provider crash or HUMHUM restart.

## Non-Goals

- Building another general-purpose Agent runtime inside HUMHUM.
- Replacing Codex, Qoder, Claude Code, or their native authentication.
- Sending messages or approving actions without the user.
- Reusing an arbitrary active development session as Humi's brain.
- Supporting every detected hook client as a callable brain in the first version.
- Adding a hosted HUMHUM account, Happy relay, or cloud session store.
- Making Pi fallback invisible or silently changing providers without attribution.
- Allowing a provider to write HUMHUM memories or preferences without the existing
  explicit confirmation boundary.

## Product Model

HUMHUM owns the identity and nervous system:

```text
HUMHUM local control plane
  observe, queue, route, authorize, persist, recover
                  |
                  v
Humi identity packet
  soul, preferences, rules, memories, skills, relevant module evidence
                  |
                  v
Selected host Agent
  Codex, Qoder CLI, or Claude Code
                  |
                  v
Normalized result written back to HUMHUM
```

Pi is a fourth adapter used only when fallback is enabled and the primary adapter is
unavailable or fails at the transport/runtime boundary.

Humi is therefore not a model. It is the durable identity, context-selection policy,
and user-facing conversational surface that temporarily uses a registered Agent's
reasoning ability.

## Brain Configuration

`AppConfig` gains a versioned `brain` section:

```json
{
  "brain": {
    "schema_version": 1,
    "initialized": true,
    "primary_provider": "qoder",
    "fallback_provider": "pi",
    "fallback_enabled": true,
    "attention_analysis_enabled": true
  }
}
```

Rules:

- `primary_provider` is one of `codex`, `qoder`, or `claude`.
- A provider is selectable only when its executable, transport, authentication, and
  managed Humi skill are ready.
- Detected but non-callable clients may be shown as unavailable with an exact next
  step; they are never presented as working brains.
- `fallback_provider` is initially fixed to `pi`.
- Existing `config.pi` URL, token, and model fields remain backward compatible and
  become the Pi fallback configuration.
- Existing users with Pi configured are not silently marked initialized and are not
  silently assigned Pi as their primary brain.
- Tokens are not copied into the brain configuration or provider session records.

## Initialization Experience

New installations and existing profiles without `brain.initialized` see a one-time
brain setup in Humi. Other HUMHUM rooms remain available.

The setup:

1. Detects Codex, Qoder CLI, and Claude Code.
2. Shows each provider's readiness as `ready`, `login required`,
   `skill installation required`, `transport unsupported`, or `not installed`.
3. Lets the user select one ready provider as the primary brain.
4. Explains that the provider uses its existing account/model and that relevant Humi
   context is shared with that provider when a task runs.
5. Offers Pi fallback and shows whether its URL, token, and model are usable.
6. Separately asks whether special-attention Hush messages may be analyzed
   automatically.
7. Runs a bounded handshake and saves the configuration only after it succeeds.

The setup has a "later" path. Until configured, Humi can display local state but its
composer explains that a brain must be selected before reasoning is available.

Settings replaces the current "Pi Agent is Humi's only model" card with "Humi brain":

- primary provider and health;
- change-provider action;
- managed skill health and repair;
- Pi fallback toggle and configuration;
- special-attention automatic analysis toggle;
- last successful provider, last fallback reason, and bounded diagnostics.

## Brain Registry

A provider-neutral registry exposes capability records rather than names alone:

```text
BrainProviderStatus
  provider
  display_name
  installed
  authenticated
  transport_ready
  skill_ready
  supports_resume
  supports_streaming
  supports_structured_output
  supports_cancellation
  status
  next_step
```

The registry is separate from `client_registry`. Hook support means HUMHUM can
observe an Agent; brain support means HUMHUM can start or resume an isolated session,
send a prompt, receive a complete result, and cancel or time out the task. A hook-only
client is not automatically a brain provider.

## Provider Adapter Contract

Each adapter implements the same logical operations:

```text
detect()
ensure_managed_skill()
open_or_resume_brain_session()
run_task(context_packet, response_contract)
cancel(task_id)
health()
```

The persistent Humi session is logical rather than necessarily a permanently running
child process. HUMHUM stores a provider-native session/thread identifier and resumes
it on demand. The isolated working directory is `~/.humhum/brain-workspace`; it is
not a user project and is not used for code editing.

The first delivery uses real transports with an explicit implementation status:

| Provider | Callable surface | First-version work |
| --- | --- | --- |
| Codex | existing app-server bridge | adapt the current bridge to the brain contract |
| Qoder | `qodercli` ACP mode | add a new ACP adapter; IDE/Client/Worker remain distinct |
| Claude Code | supported streaming/resume interface | add a new Claude adapter |
| Pi | existing embedded Pi Agent runtime | move lifecycle to the app coordinator |

Detection of an IDE process, hook configuration, log directory, or product brand is
not sufficient evidence that the corresponding callable surface is ready.

### Codex

- Reuse the existing `CodexBridgeState` app-server transport.
- Create a dedicated thread in the brain workspace.
- Store and resume its real Codex thread ID.
- Use explicit read-oriented sandbox and approval policy for Humi/Hush analysis.
- Collect normalized assistant output by turn ID and reject output from another
  thread or stale turn.

### Qoder CLI

- Detect `qodercli`, not the Qoder IDE launcher named `qoder`.
- Use Qoder CLI's ACP mode for a bidirectional managed session.
- Store and resume the real Qoder session ID.
- Start in plan/read-only permission mode with no project editing tools.
- Keep Qoder IDE, Qoder Client, Qoder CLI, and Qoder Worker as distinct surfaces in
  status and analytics even when they share the Qoder brand.

### Claude Code

- Use Claude Code's supported streaming/session-resume interface.
- Store and resume the real Claude session ID.
- Run with read-oriented permissions and the managed Humi skill.
- Treat hook installation as observability only; it does not prove the brain
  transport is callable.

### Pi Fallback

- Reuse the existing embedded Pi Agent runtime and OpenAI-compatible configuration.
- Move its lifecycle out of the lazily mounted Humi room into an app-level brain
  coordinator so fallback can run while another Hub room is open.
- Give Pi the same context packet and response contract as host Agents.
- Do not use the legacy Pi CLI laboratory session as the fallback.
- Attribute every Pi result as fallback and retain the primary failure category
  without exposing tokens, URLs, prompts, or raw provider errors.

## Managed Humi Skill

HUMHUM installs a managed `humhum-humi` skill for supported providers using the same
collision and ownership rules as the managed Hexa skill:

- never overwrite an unmanaged user skill;
- reject unsafe symlinks;
- write only to known provider skill roots;
- include a version marker and content hash;
- allow repair or upgrade without touching unrelated provider files.

The skill defines:

- Humi's role and response style;
- how to interpret the supplied identity packet;
- the difference between Humi, Hype, Hush, and Hexa;
- the direct-message and group-chat analysis contracts;
- the prohibition on automatic sending or unconfirmed durable writes;
- the requirement to return only the requested structured result envelope.

The skill does not contain the user's private soul or memory. Those remain in
`~/.humhum` and are selected into a bounded task-specific packet at runtime.

## Humi Context Packet

Every task receives a versioned packet:

```text
request_id
task_kind
user_input
identity
  soul
  presentation_preferences
  workflow_preferences
relevant_context
  memories
  rules
  skills
  module_evidence
response_contract
privacy_labels
```

Context selection is local and evidence-based:

- query Hype for relevant assets rather than sending the entire index;
- prefer user-created and user-installed skills over marketplace inventories;
- bound item counts and text length;
- exclude API keys, credentials, hidden reasoning, absolute private paths, and
  unrelated conversation content;
- include source labels and confidence so the host Agent can distinguish evidence
  from inferred context.

Humi chat history shown in the UI and the provider-native session must share a stable
HUMHUM conversation ID. A UI transcript must not pretend provider context survived
when the provider session was replaced or could not be resumed.

## Brain Task Queue

Rust owns a durable, owner-only queue under `~/.humhum/brain/`. Queue records contain:

- opaque task and conversation IDs;
- task kind;
- provider selection;
- creation and update times;
- bounded input references;
- attempt count and state;
- fallback attribution;
- redacted failure category.

States are `queued`, `running`, `completed`, `failed`, and `cancelled`.

Queue rules:

- one active task per logical Humi brain session;
- deduplicate by task kind, conversation, and latest source revision;
- recover interrupted `running` tasks as retryable after restart;
- retry the primary once for a transient transport failure;
- use Pi only after a primary transport/runtime failure when fallback is enabled;
- do not fallback merely because the primary returned a cautious or low-confidence
  answer;
- never run primary and fallback concurrently for the same task;
- cap retries, queue length, context size, output size, and execution time.

The app-level brain coordinator drains the queue while HUMHUM is running. Rust emits
new-job events, and startup also polls for recoverable jobs so events missed during
sleep or restart are not lost.

## Hush Special-Attention Analysis

The existing attention state must move from browser `localStorage` into an
owner-only Rust store because background routing cannot depend on one mounted React
component. The migration imports the current versioned local state once and preserves
legacy conversation ID migrations.

Only conversations explicitly marked as special attention are eligible for automatic
analysis. Enabling automatic analysis is a separate user consent.

New-message flow:

1. Hush imports and normalizes the message without modifying its content.
2. It resolves the stable conversation ID.
3. If the conversation is special attention and automatic analysis is enabled, Hush
   schedules a debounced analysis job.
4. The job receives a bounded chronological window ending at the newest message.
5. The selected brain returns a structured result.
6. HUMHUM stores the result separately from the immutable inbox message.
7. Hush displays the result, provider, analysis time, and fallback state.

Debouncing groups a short burst of messages from one conversation into one task.
Marking an existing conversation as special attention schedules one analysis of its
latest bounded window.

### Direct Message Result

```text
summary
needs_reply
reason
urgency
suggested_reply
open_questions
confidence
```

The suggested reply is absent when no reply is needed. Hush never sends it
automatically.

### Group Chat Result

```text
summary
topics
related_to_user
relevance_reason
mentioned_people
action_items
should_speak
suggested_message
confidence
```

Group chat defaults to observation. A suggested message is present only when the
Agent finds a concrete reason for the user to participate.

Rule-based legacy suggestions remain available only as a clearly labeled local
fallback when no brain analysis exists. They are not presented as AI conclusions.

## Hush Time Presentation

The conversation list uses calendar-aware labels:

- today: `HH:mm`;
- yesterday: `昨天 HH:mm`;
- earlier in the current year: `M月D日`;
- another year: `YYYY年M月D日`.

The `datetime` attribute retains the original timestamp. Sidebar preview, sidebar
time, message order, and detail view continue to use the same parsed latest message.
Tests use an injected current time so yesterday and year boundaries are deterministic.

## Persistence

New or changed local records:

- `~/.humhum/config.json`: versioned brain selection and consent.
- `~/.humhum/brain/sessions.json`: logical Humi session to provider session mapping.
- `~/.humhum/brain/queue.json`: bounded durable tasks.
- `~/.humhum/brain/results.json`: bounded structured task results and attribution.
- `~/.humhum/hush-conversations.json`: attention and read-through state.
- Existing `~/.humhum/hush-inbox.json`: immutable imported messages.
- Existing `~/.humhum/knowledge.json`: Hype identity and knowledge sources.

All files use atomic writes, owner-only permissions, symlink rejection, bounded
deserialization, and backward-compatible defaults. Provider tokens and raw
credentials never enter session, queue, result, or diagnostics files.

## Failure Handling

- Primary not installed: block selection and show the exact installation requirement.
- Authentication missing: preserve selection but pause jobs with a login next step.
- Managed skill collision: do not overwrite; show the conflicting target.
- Provider session missing: create a new isolated session and mark the continuity
  boundary in Humi history.
- Provider crash or malformed stream: fail the attempt, restart with bounded backoff,
  then use Pi if enabled and configured.
- Pi unavailable: leave the task failed/retryable and show that no fallback is ready.
- Invalid structured output: request one bounded repair turn from the same provider;
  do not invent missing fields locally.
- Queue full: coalesce newer Hush jobs per conversation and preserve interactive Humi
  tasks.
- Hush source preview limited: never claim complete understanding; return a
  limited-evidence result or skip analysis.
- App restart: recover queue and provider session mappings without duplicating a
  completed result.

## Privacy And Permission Invariants

- Selecting a brain is explicit and records which provider receives future context.
- Automatic Hush analysis requires separate explicit consent.
- Only special-attention conversation windows are sent for automatic analysis.
- Original chat content is never rewritten.
- No brain result can send a message, approve an Agent action, or save durable memory
  without a separate user action and existing confirmation checks.
- Host Agents use their existing authentication; HUMHUM does not extract their
  credentials.
- Diagnostics expose provider, state, versions, and redacted failure categories, not
  prompts, chat text, tokens, URLs, or absolute private paths.
- Changing the primary provider does not copy provider-native hidden history. HUMHUM
  supplies the durable identity packet to the new provider and marks the transition.

## Testing

### Registry And Configuration

- migration from the current Pi-only configuration;
- readiness detection for IDE launchers versus callable CLI/ACP transports;
- only transport-ready providers are selectable;
- no token leakage in serialized status;
- provider change and Pi fallback toggle persistence.

### Provider Adapters

- fake executable fixtures for startup, handshake, streaming, completion, timeout,
  cancellation, crash, and resume;
- argument separation and workspace/path validation;
- real session/thread ID persistence;
- stale and cross-session output rejection;
- bounded structured-output repair;
- optional installed-provider smoke tests in a disposable brain workspace.

### Queue And Fallback

- deduplication, serialization, restart recovery, retry, cancellation, and limits;
- primary success never invokes Pi;
- primary transport failure invokes Pi once when enabled;
- low-confidence primary output does not invoke Pi;
- fallback attribution and redacted error persistence.

### Humi And Hush

- Humi identity remains stable across provider changes;
- provider continuity breaks are visible rather than hidden;
- attention state migrates from local storage without loss;
- only new special-attention messages enqueue analysis;
- direct and group response contracts render differently;
- no result path can invoke a send-message operation;
- time labels cover today, yesterday, current-year, prior-year, invalid timestamp, and
  timezone-offset boundaries.

### End-To-End

- choose each installed provider during initialization;
- complete one Humi chat turn and inspect provider attribution;
- trigger one direct and one group special-attention Hush analysis;
- stop the primary provider and observe an attributed Pi fallback;
- restart HUMHUM during a queued task and verify exactly one final result;
- verify the original Hush inbox bytes are unchanged by analysis.

## Delivery Order

1. Add brain configuration, provider capability registry, managed Humi skill, and
   initialization/settings UI; ship the independent Hush calendar-time correction
   in the same low-risk slice.
2. Route interactive Humi chat through the selected provider with Pi fallback.
3. Move attention state to Rust and add the durable brain task queue.
4. Add direct/group Hush analysis and result presentation.
5. Remove Pi-only wording and keep legacy Pi CLI controls behind diagnostics until a
   later deletion decision.

Each stage must keep current Humi chat usable through the existing Pi path until the
new selected-provider path has passed its adapter and end-to-end tests.

## Acceptance Criteria

- A user can initialize Humi with Codex, Qoder CLI, or Claude Code when that provider
  is truly callable.
- Humi chat uses the selected provider and visibly identifies Pi only when fallback
  occurs.
- Changing providers preserves Humi's durable identity without reusing a development
  session.
- New messages in a consented special-attention conversation produce one structured,
  provider-attributed analysis.
- Direct messages and group chats receive different decisions and UI.
- No automatic message send, hidden provider switch, or unconfirmed durable write is
  possible.
- Hush accurately distinguishes today's, yesterday's, and older latest messages.
- Full frontend and Rust test suites, production frontend build, Rust check, and
  provider smoke tests pass before completion is claimed.
