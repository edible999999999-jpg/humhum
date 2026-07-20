# HUMHUM WeChat Native Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a source-controlled, bundled, local-only macOS arm64 reader that exposes strict `status`, `sessions`, and `timeline` JSON actions and can replace the external `wechat-cli` process boundary in HUMHUM production builds.

**Architecture:** A one-shot Go sidecar reads one bounded JSON request from stdin, uses a read-only WCDB adapter, writes one versioned JSON envelope to stdout, and exits. Rust owns process policy, timeouts, environment isolation, Hush normalization, and development-only fallback; this increment accepts an in-memory key map through stdin but does not persist keys or perform privileged extraction.

**Tech Stack:** Go 1.26.5, `github.com/ebitengine/purego` v0.10.0, Tencent WCDB dynamic library, Rust 1.96, Tokio, Serde, Tauri 2.11, Node.js 22 build checks.

## Global Constraints

- Production actions are exactly `status`, `sessions`, and `timeline`.
- The reader accepts exactly one JSON request on stdin, with a maximum size of 262,144 bytes, rejects unknown fields and trailing JSON, and never accepts secrets through argv or environment variables.
- `sessions.limit` and `timeline.limit` are integers from 1 through 100.
- `sessions.types` is exactly `["private","group"]`; `timeline.includeMediaPaths` is exactly `false`.
- `timeline.talker` must be non-empty, at most 512 UTF-8 bytes, and must not begin with `-`.
- The reader has no network client, listener, updater, shell execution, general SQL, export, write-capable database operation, or WeChat UI automation.
- Database opens use read-only WCDB flags and query-only pragmas; WeChat message-table identifiers are derived only from the schema-required lowercase MD5 talker hash and matched against `^Msg_[a-f0-9]{32}$`. MD5 is used only for compatibility with WeChat's table naming, never for security.
- Initial Hush sync remains 24 hours, incremental overlap remains 2 minutes, and auto-sync remains off until the user enables it.
- Only incoming private and group messages are imported; no media files are copied.
- Production builds do not discover or execute `wechat-cli` from `PATH`; external CLI fallback exists only under the Cargo feature `wechat-external-dev`.
- This increment does not add privileged key extraction, sudo use, Keychain persistence, a network endpoint, or an Android capability.
- Derived R266 source keeps MIT provenance at file level; WCDB keeps its license and third-party notice.
- No real wxids, messages, keys, salts, database paths, or user databases are committed.

---

## File Map

### Native module

- `native/humhum-wechat/go.mod`: pins the Go module and purego dependency.
- `native/humhum-wechat/NOTICE.md`: records R266 and WCDB provenance.
- `native/humhum-wechat/internal/contract/request.go`: strict request types and validation.
- `native/humhum-wechat/internal/contract/envelope.go`: stable success and error envelopes.
- `native/humhum-wechat/internal/contract/request_test.go`: malformed, unknown, oversized, and allowlist tests.
- `native/humhum-wechat/internal/source/source.go`: narrow read-only data-source interface.
- `native/humhum-wechat/internal/source/fixture.go`: deterministic fixture source used by native tests only.
- `native/humhum-wechat/internal/wcdb/wcdb.go`: minimal read-only WCDB bindings.
- `native/humhum-wechat/internal/wcdb/load_darwin.go`: purego symbol loading for macOS.
- `native/humhum-wechat/internal/wcdb/wcdb_test.go`: wrong-key, read-only, and close behavior tests.
- `native/humhum-wechat/internal/reader/reader.go`: action dispatch and compatibility status.
- `native/humhum-wechat/internal/reader/sessions.go`: private/group session query and normalization.
- `native/humhum-wechat/internal/reader/timeline.go`: shard lookup, bounded message query, and normalization.
- `native/humhum-wechat/internal/reader/reader_test.go`: deterministic action-schema and pagination tests.
- `native/humhum-wechat/cmd/humhum-wechat-reader/main.go`: one-request process entry point.
- `native/humhum-wechat/cmd/humhum-wechat-reader/main_test.go`: stdin/stdout and secret-leak process tests.
- `native/humhum-wechat/testdata/account/`: generated fixture database layout containing fictional records only.
- `native/humhum-wechat/third_party/r266/LICENSE`: preserved MIT license.
- `native/humhum-wechat/third_party/wcdb/LICENSE`: preserved WCDB license.
- `native/humhum-wechat/third_party/manifest.json`: source revisions and WCDB dylib checksum.

### Build and packaging

- `scripts/build-wechat-reader.mjs`: builds the target-named Tauri sidecar and copies the verified WCDB dylib.
- `scripts/check-wechat-reader-boundary.mjs`: rejects network, shell, server, updater, and write-capable symbols.
- `scripts/wechat-reader-boundary.test.mjs`: tests the boundary checker against allowed and forbidden symbol samples.
- `src-tauri/binaries/humhum-wechat-reader-aarch64-apple-darwin`: generated sidecar, excluded from source review but included in app bundles.
- `src-tauri/resources/wechat/libWCDB.dylib`: verified runtime library included in app bundles.
- `src-tauri/resources/wechat/native-manifest.json`: generated SHA-256 manifest for the reader and WCDB library.
- `package.json`: adds native build, check, and test scripts.
- `.gitignore`: excludes local native staging output while retaining release inputs and manifests.
- `src-tauri/tauri.conf.json`: registers the sidecar and WCDB resource.

### Rust bridge and product integration

- `src-tauri/src/wechat_native_runner.rs`: bounded stdin/stdout sidecar runner and identity checks.
- `src-tauri/src/wechat_hush_bridge.rs`: replaces argv commands with typed reader requests and production native resolution.
- `src-tauri/src/lib.rs`: registers the native runner with the app resource directory.
- `src-tauri/Cargo.toml`: declares the `wechat-external-dev` feature.
- `src/components/Hub/HushModule.tsx`: changes production copy from installing a third-party CLI to preparing the bundled reader.
- `src/components/Hub/HushModule.test.ts`: verifies production copy, unavailable state, and opt-in auto-sync.
- `README.md`: documents bundled-reader status and current signed-preview limitation.
- `README.zh-CN.md`: documents the same behavior in Chinese.

---

### Task 1: Strict Native Action Contract

**Files:**
- Create: `native/humhum-wechat/go.mod`
- Create: `native/humhum-wechat/internal/contract/request.go`
- Create: `native/humhum-wechat/internal/contract/envelope.go`
- Create: `native/humhum-wechat/internal/contract/request_test.go`

**Interfaces:**
- Consumes: one `io.Reader` containing a single JSON object.
- Produces: `contract.Decode(io.Reader) (contract.Request, *contract.Failure)` and `contract.Write(io.Writer, contract.Envelope) error`.

- [ ] **Step 1: Add failing strict-decoder tests**

```go
func TestDecodeAcceptsProductionActions(t *testing.T) {
    cases := []string{
        `{"version":1,"action":"status"}`,
        `{"version":1,"action":"sessions","types":["private","group"],"limit":100,"keys":{"001122":"aabbcc"}}`,
        `{"version":1,"action":"timeline","talker":"friend-alpha","after":1784471400,"limit":100,"includeMediaPaths":false,"keys":{"001122":"aabbcc"}}`,
    }
    for _, input := range cases {
        request, failure := Decode(strings.NewReader(input))
        if failure != nil || request.Version != 1 {
            t.Fatalf("Decode(%s) = %#v, %#v", input, request, failure)
        }
    }
}

func TestDecodeRejectsUnknownTrailingAndOversizedInput(t *testing.T) {
    cases := []struct {
        input string
        code  string
    }{
        {`{"version":1,"action":"export"}`, "unknown_action"},
        {`{"version":1,"action":"status","url":"https://example.test"}`, "invalid_request"},
        {`{"version":1,"action":"status"} {}`, "invalid_request"},
        {`{"version":1,"action":"timeline","talker":"-x","after":0,"limit":100,"includeMediaPaths":false}`, "invalid_talker"},
        {`{"version":1,"action":"timeline","talker":"x","after":0,"limit":101,"includeMediaPaths":false}`, "invalid_limit"},
        {`{"version":1,"action":"timeline","talker":"x","after":0,"limit":100,"includeMediaPaths":true}`, "media_paths_forbidden"},
    }
    for _, tc := range cases {
        _, failure := Decode(strings.NewReader(tc.input))
        if failure == nil || failure.Code != tc.code {
            t.Fatalf("Decode(%s) failure = %#v; want %s", tc.input, failure, tc.code)
        }
    }
    _, failure := Decode(strings.NewReader(strings.Repeat("x", MaxRequestBytes+1)))
    if failure == nil || failure.Code != "request_too_large" {
        t.Fatalf("oversized failure = %#v", failure)
    }
}
```

- [ ] **Step 2: Run the contract tests and verify the missing package failure**

Run: `cd native/humhum-wechat && go test ./internal/contract -run TestDecode -count=1`

Expected: FAIL because `Decode`, `Request`, and `MaxRequestBytes` do not exist.

- [ ] **Step 3: Implement the exact request union and validation**

```go
const MaxRequestBytes = 256 * 1024

type Request struct {
    Version           int               `json:"version"`
    Action            string            `json:"action"`
    Types             []string          `json:"types,omitempty"`
    Limit             int               `json:"limit,omitempty"`
    Talker            string            `json:"talker,omitempty"`
    After             int64             `json:"after,omitempty"`
    IncludeMediaPaths *bool             `json:"includeMediaPaths,omitempty"`
    Keys              map[string]string `json:"keys,omitempty"`
}

func Decode(input io.Reader) (Request, *Failure) {
    limited := io.LimitReader(input, MaxRequestBytes+1)
    raw, err := io.ReadAll(limited)
    if err != nil {
        return Request{}, NewFailure("invalid_request", "Unable to read request")
    }
    if len(raw) > MaxRequestBytes {
        return Request{}, NewFailure("request_too_large", "Request exceeds 262144 bytes")
    }
    decoder := json.NewDecoder(bytes.NewReader(raw))
    decoder.DisallowUnknownFields()
    var request Request
    if err := decoder.Decode(&request); err != nil {
        return Request{}, NewFailure("invalid_request", "Request is not valid JSON")
    }
    var trailing any
    if decoder.Decode(&trailing) != io.EOF {
        return Request{}, NewFailure("invalid_request", "Trailing JSON is forbidden")
    }
    if failure := request.Validate(); failure != nil {
        return Request{}, failure
    }
    return request, nil
}
```

`Request.Validate` must enforce the Global Constraints and reject action-specific fields that are present on another action. Fixture selection is process-test-only through `HUMHUM_WECHAT_FIXTURE_MODE=1`; the production Rust runner never sets fixture variables.

`go.mod` is exact:

```go
module github.com/edible999999999-jpg/humhum/native/humhum-wechat

go 1.26.5

require github.com/ebitengine/purego v0.10.0
```

- [ ] **Step 4: Implement versioned envelopes**

```go
type Failure struct {
    Code       string `json:"code"`
    Message    string `json:"message"`
    NextAction string `json:"nextAction,omitempty"`
}

type Envelope struct {
    OK      bool     `json:"ok"`
    Version int      `json:"version"`
    Action  string   `json:"action"`
    Data    any      `json:"data,omitempty"`
    Error   *Failure `json:"error,omitempty"`
}

func Success(action string, data any) Envelope {
    return Envelope{OK: true, Version: 1, Action: action, Data: data}
}

func Failed(action string, failure *Failure) Envelope {
    return Envelope{OK: false, Version: 1, Action: action, Error: failure}
}

func Write(output io.Writer, envelope Envelope) error {
    encoder := json.NewEncoder(output)
    encoder.SetEscapeHTML(true)
    return encoder.Encode(envelope)
}
```

- [ ] **Step 5: Run all contract tests**

Run: `cd native/humhum-wechat && go test ./internal/contract -count=1`

Expected: PASS, including rejection of unknown fields, trailing JSON, oversized input, option-like talkers, excessive limits, and media paths.

- [ ] **Step 6: Commit the contract**

```bash
git add native/humhum-wechat/go.mod native/humhum-wechat/internal/contract
git commit -m "feat: define native WeChat reader contract"
```

---

### Task 2: Read-Only Source Boundary And Fixture Database

**Files:**
- Create: `native/humhum-wechat/internal/source/source.go`
- Create: `native/humhum-wechat/internal/source/fixture.go`
- Create: `native/humhum-wechat/internal/source/source_test.go`
- Create: `native/humhum-wechat/testdata/account/session.json`
- Create: `native/humhum-wechat/testdata/account/messages/direct-alpha.json`
- Create: `native/humhum-wechat/testdata/account/messages/team-alpha-chatroom.json`

**Interfaces:**
- Consumes: validated `contract.Request`.
- Produces: `source.DataSource` with `Status`, `Sessions`, and `Timeline`; all implementations are read-only.

- [ ] **Step 1: Write failing fixture-source tests**

```go
func TestFixtureSourceReturnsBoundedPrivateAndGroupData(t *testing.T) {
    fixture, err := NewFixture("../../../testdata/account")
    if err != nil {
        t.Fatal(err)
    }
    sessions, err := fixture.Sessions(context.Background(), []ConversationKind{Private, Group}, 2)
    if err != nil {
        t.Fatal(err)
    }
    if len(sessions) != 2 || sessions[0].Talker != "team-alpha@chatroom" {
        t.Fatalf("sessions = %#v", sessions)
    }
    messages, err := fixture.Timeline(context.Background(), "friend-alpha", 1784471400, 100)
    if err != nil {
        t.Fatal(err)
    }
    if len(messages) != 2 || !messages[0].Incoming || messages[0].Text != "fixture hello" {
        t.Fatalf("messages = %#v", messages)
    }
}
```

- [ ] **Step 2: Run the source tests and verify the missing interface failure**

Run: `cd native/humhum-wechat && go test ./internal/source -count=1`

Expected: FAIL because `DataSource`, `ConversationKind`, and `NewFixture` do not exist.

- [ ] **Step 3: Define the narrow read-only source interface**

```go
type DataSource interface {
    Status(context.Context) (Status, error)
    Sessions(context.Context, []ConversationKind, int) ([]Session, error)
    Timeline(context.Context, string, int64, int) ([]Message, error)
    Close() error
}

type Error struct {
    Code       string
    Message    string
    NextAction string
    Cause      error
}

func (e *Error) Error() string { return e.Code }
func (e *Error) Unwrap() error { return e.Cause }

func Open(request contract.Request, getenv func(string) string) (DataSource, error) {
    if getenv("HUMHUM_WECHAT_FIXTURE_MODE") == "1" {
        root := getenv("HUMHUM_WECHAT_FIXTURE_ROOT")
        if root == "" {
            return nil, &Error{Code: "schema_unsupported", Message: "Fixture root is missing"}
        }
        return NewFixture(root)
    }
    return OpenLocal(request.Keys)
}

type Status struct {
    ConnectorVersion string   `json:"connectorVersion"`
    WeChatBuild      string   `json:"wechatBuild"`
    Compatibility    string   `json:"compatibility"`
    KeyCoverage      string   `json:"keyCoverage"`
    WCDBAvailable    bool     `json:"wcdbAvailable"`
    LiveReadOK       bool     `json:"liveReadOk"`
    BlockedBy        string   `json:"blockedBy,omitempty"`
    NextAction       string   `json:"nextAction,omitempty"`
    Warnings         []string `json:"warnings"`
}

type Session struct {
    Talker        string           `json:"talker"`
    DisplayName   string           `json:"displayName"`
    Kind          ConversationKind `json:"kind"`
    LastTimestamp int64            `json:"lastTimestamp"`
}

type Message struct {
    Talker       string `json:"talker"`
    LocalID      int64  `json:"localId"`
    ServerID     string `json:"serverId,omitempty"`
    Timestamp    int64  `json:"timestamp"`
    Sender       string `json:"sender"`
    SenderWXID   string `json:"senderWxid,omitempty"`
    Incoming     bool   `json:"incoming"`
    Kind         string `json:"kind"`
    Text         string `json:"text"`
}
```

- [ ] **Step 4: Add fictional deterministic fixtures and the fixture adapter**

`session.json` contains `friend-alpha`, `team-alpha@chatroom`, and excluded `gh_fixture`; the direct timeline contains one incoming text message, one incoming image summary, and one outgoing text message. The group timeline contains two incoming messages from `member-one` and `member-two`. Every identifier begins with `fixture-`, `friend-`, `member-`, or `team-`.

`NewFixture` must resolve the input with `filepath.EvalSymlinks`, require all files to remain under the fixture root, use `json.Decoder.DisallowUnknownFields`, sort by timestamp descending for sessions and ascending for timelines, apply `after` inclusively, and slice to `limit`.

- [ ] **Step 5: Run source tests and fixture privacy checks**

Run: `cd native/humhum-wechat && go test ./internal/source -count=1`

Expected: PASS.

Run: `rg -n "(wxid_|@chatroom|[A-Fa-f0-9]{64})" native/humhum-wechat/testdata`

Expected: the only `@chatroom` occurrence is `team-alpha@chatroom`; no `wxid_` or 64-hex secret is present.

- [ ] **Step 6: Commit the source contract and fixtures**

```bash
git add native/humhum-wechat/internal/source native/humhum-wechat/testdata
git commit -m "test: add sanitized WeChat reader fixtures"
```

---

### Task 3: Native Reader Dispatch And Stable Output

**Files:**
- Create: `native/humhum-wechat/internal/reader/reader.go`
- Create: `native/humhum-wechat/internal/reader/reader_test.go`
- Create: `native/humhum-wechat/cmd/humhum-wechat-reader/main.go`
- Create: `native/humhum-wechat/cmd/humhum-wechat-reader/main_test.go`

**Interfaces:**
- Consumes: `contract.Request` and `source.DataSource`.
- Produces: `reader.Handle(context.Context, contract.Request, source.DataSource) contract.Envelope` and the one-shot executable.

- [ ] **Step 1: Write failing action-dispatch and schema tests**

```go
func TestHandleProducesStableActionShapes(t *testing.T) {
    fixture, err := source.NewFixture("../../testdata/account")
    if err != nil {
        t.Fatal(err)
    }
    includeMediaPaths := false
    cases := []struct {
        request contract.Request
        key     string
    }{
        {contract.Request{Version: 1, Action: "status"}, "status"},
        {contract.Request{Version: 1, Action: "sessions", Types: []string{"private", "group"}, Limit: 100}, "sessions"},
        {contract.Request{Version: 1, Action: "timeline", Talker: "friend-alpha", After: 1784471400, Limit: 100, IncludeMediaPaths: &includeMediaPaths}, "messages"},
    }
    for _, tc := range cases {
        envelope := Handle(context.Background(), tc.request, fixture)
        if !envelope.OK || envelope.Version != 1 || envelope.Action != tc.request.Action {
            t.Fatalf("envelope = %#v", envelope)
        }
        encoded, _ := json.Marshal(envelope.Data)
        if !bytes.Contains(encoded, []byte(`"`+tc.key+`"`)) {
            t.Fatalf("%s missing from %s", tc.key, encoded)
        }
    }
}
```

- [ ] **Step 2: Run reader tests and verify dispatch is missing**

Run: `cd native/humhum-wechat && go test ./internal/reader ./cmd/humhum-wechat-reader -count=1`

Expected: FAIL because `Handle` and the command entry point do not exist.

- [ ] **Step 3: Implement action dispatch without a general action registry**

```go
func Handle(ctx context.Context, request contract.Request, data source.DataSource) contract.Envelope {
    switch request.Action {
    case "status":
        status, err := data.Status(ctx)
        if err != nil {
            return failureEnvelope(request.Action, err)
        }
        return contract.Success(request.Action, map[string]any{"status": status})
    case "sessions":
        sessions, err := data.Sessions(ctx, []source.ConversationKind{source.Private, source.Group}, request.Limit)
        if err != nil {
            return failureEnvelope(request.Action, err)
        }
        return contract.Success(request.Action, map[string]any{"sessions": sessions})
    case "timeline":
        messages, err := data.Timeline(ctx, request.Talker, request.After, request.Limit)
        if err != nil {
            return failureEnvelope(request.Action, err)
        }
        return contract.Success(request.Action, map[string]any{
            "query": map[string]any{"talker": request.Talker, "after": request.After, "limit": request.Limit},
            "messages": messages,
        })
    default:
        return contract.Failed(request.Action, contract.NewFailure("unknown_action", "Action is not allowed"))
    }
}

func failureEnvelope(action string, err error) contract.Envelope {
    var sourceError *source.Error
    if errors.As(err, &sourceError) {
        return contract.Failed(action, &contract.Failure{
            Code: sourceError.Code, Message: sourceError.Message, NextAction: sourceError.NextAction,
        })
    }
    return contract.Failed(action, contract.NewFailure("reader_failed", "Local WeChat read failed"))
}
```

Map typed source errors only to the approved codes: `wcdb_unavailable`, `unsupported_wechat_build`, `key_coverage_incomplete`, `schema_unsupported`, and `query_timeout`; all unknown errors become `reader_failed` with a generic message and no path.

- [ ] **Step 4: Implement the one-request process entry point**

```go
func run(input io.Reader, output io.Writer, stderr io.Writer, getenv func(string) string) int {
    request, failure := contract.Decode(input)
    if failure != nil {
        _ = contract.Write(output, contract.Failed("", failure))
        return 2
    }
    data, err := source.Open(request, getenv)
    if err != nil {
        _ = contract.Write(output, contract.Failed(request.Action, source.PublicFailure(err)))
        return 3
    }
    defer data.Close()
    if err := contract.Write(output, reader.Handle(context.Background(), request, data)); err != nil {
        _, _ = io.WriteString(stderr, "reader output failed\n")
        return 4
    }
    return 0
}
```

The command must not log the request, key map, paths, messages, or source errors to stderr. `main` calls `os.Exit(run(os.Stdin, os.Stdout, os.Stderr, os.Getenv))`.

- [ ] **Step 5: Add process tests for one envelope and no secret leakage**

Run a fixture request containing key value `fixture-secret-that-must-not-leak`, assert stdout is one JSON object, and assert neither stdout nor stderr contains that string. Add a 262,145-byte stdin test that returns `request_too_large` and exit code 2.

- [ ] **Step 6: Run reader and process tests**

Run: `cd native/humhum-wechat && HUMHUM_WECHAT_FIXTURE_MODE=1 go test ./internal/reader ./cmd/humhum-wechat-reader -count=1`

Expected: PASS.

- [ ] **Step 7: Commit the executable contract**

```bash
git add native/humhum-wechat/internal/reader native/humhum-wechat/cmd
git commit -m "feat: add one-shot WeChat reader actions"
```

---

### Task 4: Minimal Read-Only WCDB Adapter

**Files:**
- Create: `native/humhum-wechat/internal/wcdb/wcdb.go`
- Create: `native/humhum-wechat/internal/wcdb/load_darwin.go`
- Create: `native/humhum-wechat/internal/wcdb/wcdb_test.go`
- Create: `native/humhum-wechat/internal/source/wcdb_source.go`
- Create: `native/humhum-wechat/internal/source/wcdb_source_test.go`
- Create: `native/humhum-wechat/third_party/r266/LICENSE`
- Create: `native/humhum-wechat/third_party/wcdb/LICENSE`
- Create: `native/humhum-wechat/third_party/manifest.json`
- Create: `native/humhum-wechat/NOTICE.md`

**Interfaces:**
- Consumes: a discovered canonical WeChat account root, the WCDB dylib resolved relative to the bundled reader, and a salt-to-key map supplied by Rust over stdin.
- Produces: `wcdb.OpenWithKeyMap(path string, keys map[string]string) (*wcdb.DB, error)`, `(*DB).Query(sql string, args ...any) ([]wcdb.Row, error)`, and a `source.DataSource` backed by local WeChat databases.

- [ ] **Step 1: Add failing read-only API-surface tests**

```go
func TestPackageExposesNoWriteOperation(t *testing.T) {
    forbidden := []string{"Exec", "OpenWritable", "Backup", "Export", "Attach", "Rekey"}
    packageFiles, err := filepath.Glob("*.go")
    if err != nil {
        t.Fatal(err)
    }
    for _, name := range packageFiles {
        source, err := os.ReadFile(name)
        if err != nil {
            t.Fatal(err)
        }
        for _, symbol := range forbidden {
            if regexp.MustCompile(`func\s+(?:\([^)]*\)\s*)?` + symbol + `\b`).Match(source) {
                t.Fatalf("forbidden write API %s in %s", symbol, name)
            }
        }
    }
}
```

Add tests that `OpenWithKeyMap` rejects a salt not present in the key map, a key not exactly 64 hex characters, a symlink database path, and a path outside the canonical account root.

- [ ] **Step 2: Run WCDB tests and verify the package is missing**

Run: `cd native/humhum-wechat && go test ./internal/wcdb ./internal/source -run 'TestPackageExposesNoWriteOperation|TestWCDB' -count=1`

Expected: FAIL because the read-only WCDB adapter is absent.

- [ ] **Step 3: Port only the audited dynamic symbols**

Derive from `r266-tech/wechat-cli` commit `065778319ca4a77debd265e65df913891d49ad58`, preserving its MIT header. Load only:

```go
var (
    sqlite3OpenV2      func(string, *uintptr, int32, string) int32
    sqlite3CloseV2     func(uintptr) int32
    sqlite3Errmsg      func(uintptr) string
    sqlite3PrepareV2   func(uintptr, string, int32, *uintptr, *uintptr) int32
    sqlite3Step        func(uintptr) int32
    sqlite3Finalize    func(uintptr) int32
    sqlite3ColumnCount func(uintptr) int32
    sqlite3ColumnName  func(uintptr, int32) string
    sqlite3ColumnType  func(uintptr, int32) int32
    sqlite3ColumnInt64 func(uintptr, int32) int64
    sqlite3ColumnDouble func(uintptr, int32) float64
    sqlite3ColumnText  func(uintptr, int32) string
    sqlite3ColumnBlob  func(uintptr, int32) uintptr
    sqlite3ColumnBytes func(uintptr, int32) int32
    sqlite3BindInt64   func(uintptr, int32, int64) int32
    sqlite3BindText    func(uintptr, int32, string, int32, uintptr) int32
    sqlite3KeyV2       func(uintptr, string, []byte, int32) int32
)
```

Open with `SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX`, call `sqlite3_key_v2`, then execute only `PRAGMA query_only = ON` and `SELECT`/`PRAGMA table_info` statements. `Query` rejects any trimmed SQL that does not begin with `SELECT ` or `PRAGMA table_info(`.

- [ ] **Step 4: Implement canonical path and key-map validation**

`OpenLocal(keys)` resolves the WCDB library from
`../Resources/wechat/libWCDB.dylib` relative to the packaged reader and the
WeChat account root below
`~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files`.
It chooses only an account directory containing both `db_storage/session/session.db`
and `db_storage/message`, and returns `wechat_not_logged_in` if zero or more
than one active account is discoverable.

`OpenAccount(root, path, keys)` must:

1. canonicalize `root` and `path` with `filepath.EvalSymlinks`;
2. require `filepath.Rel(root, path)` to be neither `..` nor begin with `../`;
3. read exactly the first 16 database bytes as lowercase salt hex;
4. locate an exact lowercase key-map entry for the salt;
5. decode exactly 32 key bytes;
6. open read-only and validate with `SELECT count(*) FROM sqlite_master`.

Use `runtime.KeepAlive` for key buffers and zero the decoded byte slice before return.

- [ ] **Step 5: Implement sessions and timeline queries**

Sessions use this fixed query and no user-controlled SQL fragments:

```sql
SELECT username, unread_count, summary,
       last_timestamp, sort_timestamp,
       last_msg_sender AS last_sender_wxid,
       last_sender_display_name, last_msg_type, last_msg_sub_type
FROM SessionTable
WHERE COALESCE(is_hidden, 0) = 0
  AND (
    username LIKE '%@chatroom'
    OR (
      username NOT LIKE '%@chatroom'
      AND username NOT LIKE 'gh!_%' ESCAPE '!'
      AND username NOT LIKE '%@openim'
      AND username NOT LIKE '%@weclaw'
      AND username NOT LIKE '%@stranger'
    )
  )
ORDER BY sort_timestamp DESC, username DESC
LIMIT ?
```

Timeline table names are `Msg_` plus the schema-required lowercase MD5 of the talker, and are accepted only when they match `^Msg_[a-f0-9]{32}$`. Each known `message_*.db` shard is inspected for that exact table; matching shards run:

```sql
SELECT local_id, server_id, local_type, sort_seq,
       real_sender_id, create_time, message_content, source
FROM Msg_0123456789abcdef0123456789abcdef
WHERE create_time >= ?
ORDER BY sort_seq ASC, local_id ASC
LIMIT ?
```

Fetch `limit + 1` across shards, merge by `sort_seq` then `local_id`, and return at most `limit`. Resolve `real_sender_id` through the shard's `Name2Id` table. Derive `incoming` by comparing the resolved sender wxid to the configured self wxid. Decode only text, image summary, file summary, quote summary, and a generic non-text summary in this increment.

- [ ] **Step 6: Add generated plain-WCDB fixture tests**

Use the verified WCDB dylib to create the fictional schema during test setup, close it, and reopen read-only through `OpenAccount`. Assert:

- private and group filters exclude `gh_fixture`;
- timeline starts at the inclusive `after` timestamp;
- outgoing rows remain present with `incoming=false`;
- image and file records contain summaries but no local paths;
- an `INSERT`, `UPDATE`, `DELETE`, `ATTACH`, or `PRAGMA writable_schema` request is rejected before prepare;
- a wrong key returns `key_validation_failed`.

- [ ] **Step 7: Record provenance and licenses**

`manifest.json` records:

```json
{
  "r266WechatCliCommit": "065778319ca4a77debd265e65df913891d49ad58",
  "r266WxkeyCommit": "9b70eecdde47a7172b19465c3f977c86b6050e8a",
  "wcdbFile": "libWCDB.dylib",
  "wcdbSha256": "bb7602ca165d7edfff58893760f53c2df36202548422c1be517c2de23e224376",
  "goVersion": "1.26.5"
}
```

The checksum must be reverified against the staged runtime library before every release build.

- [ ] **Step 8: Run native adapter tests**

Run: `cd native/humhum-wechat && HUMHUM_WECHAT_WCDB_DYLIB="$HOME/.local/share/wechat-cli/libWCDB.dylib" go test ./internal/wcdb ./internal/source ./internal/reader -count=1`

Expected: PASS. If the local dylib is absent, the fixture-WCDB test skips with the exact reason `verified WCDB test library not installed`; all pure validation tests still pass.

- [ ] **Step 9: Commit the read-only adapter**

```bash
git add native/humhum-wechat/internal/wcdb native/humhum-wechat/internal/source native/humhum-wechat/third_party native/humhum-wechat/NOTICE.md
git commit -m "feat: add read-only WCDB WeChat source"
```

---

### Task 5: Reproducible Build And No-Network Gate

**Files:**
- Create: `scripts/build-wechat-reader.mjs`
- Create: `scripts/check-wechat-reader-boundary.mjs`
- Create: `scripts/wechat-reader-boundary.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `src-tauri/resources/wechat/native-manifest.json`
- Create: `src-tauri/binaries/.gitkeep`

**Interfaces:**
- Consumes: Go 1.26.5, source module, and the checksum-pinned local WCDB dylib.
- Produces: `src-tauri/binaries/humhum-wechat-reader-aarch64-apple-darwin`, `src-tauri/resources/wechat/libWCDB.dylib`, and `src-tauri/resources/wechat/native-manifest.json`.

- [ ] **Step 1: Write failing boundary-checker tests**

```js
test("rejects forbidden dependencies and symbols", () => {
  assert.throws(
    () => assertBoundary({
      packages: ["context", "net/http"],
      symbols: ["main.main"],
      strings: [],
    }),
    /forbidden Go package: net\/http/,
  );
  assert.throws(
    () => assertBoundary({
      packages: ["context", "encoding/json"],
      symbols: ["os/exec.Command"],
      strings: [],
    }),
    /forbidden binary symbol: os\/exec/,
  );
});

test("accepts the reader allowlist", () => {
  assert.doesNotThrow(() => assertBoundary({
    packages: ["bytes", "context", "crypto/md5", "encoding/json", "os"],
    symbols: ["main.main", "purego.Dlopen"],
    strings: ["status", "sessions", "timeline"],
  }));
});
```

- [ ] **Step 2: Run the Node test and verify the checker is missing**

Run: `node --test scripts/wechat-reader-boundary.test.mjs`

Expected: FAIL because `assertBoundary` does not exist.

- [ ] **Step 3: Implement source, dependency, and binary checks**

Reject:

```js
export const forbiddenPackages = [
  "net", "net/http", "net/rpc", "net/smtp", "crypto/tls",
  "os/exec", "plugin"
];

export const forbiddenPatterns = [
  /\bcurl\b/i, /\bwget\b/i, /\bssh\b/i, /\bscp\b/i,
  /http\.ListenAndServe/, /net\.Dial/, /exec\.Command/,
  /sqlite3_exec/, /OpenWithKeyMapWritable/, /\bUPDATE\b/,
  /\bINSERT\b/, /\bDELETE\b/, /\bATTACH\b/, /\bREKEY\b/
];
```

The script runs `go list -deps ./cmd/humhum-wechat-reader`, scans native Go source excluding `_test.go`, and scans `go tool nm` plus `strings` output. It exits non-zero and prints only the matched rule, never binary contents.

- [ ] **Step 4: Implement the deterministic build script**

The build script must:

1. verify `go version` contains `go1.26.5`;
2. verify `process.platform === "darwin"` and `process.arch === "arm64"`;
3. verify the WCDB dylib SHA-256 equals `third_party/manifest.json`;
4. run `go test ./...`;
5. run `go build -trimpath -buildvcs=true -ldflags "-s -w -buildid="`;
6. write the Tauri target filename;
7. copy the verified WCDB dylib;
8. calculate reader and library SHA-256 values;
9. atomically write `native-manifest.json`;
10. call the boundary checker on the built reader.

- [ ] **Step 5: Add package scripts**

```json
{
  "native:wechat:test": "cd native/humhum-wechat && go test ./...",
  "native:wechat:check": "node scripts/check-wechat-reader-boundary.mjs",
  "native:wechat:build": "node scripts/build-wechat-reader.mjs",
  "test:native-boundary": "node --test scripts/wechat-reader-boundary.test.mjs"
}
```

- [ ] **Step 6: Run the boundary and build checks**

Run: `npm run test:native-boundary`

Expected: PASS.

Run: `npm run native:wechat:build`

Expected: PASS and print the reader path plus two lowercase SHA-256 values. `otool -L` lists system libraries and the runtime-loaded WCDB relationship only; no network framework is linked.

- [ ] **Step 7: Commit build controls**

```bash
git add scripts/build-wechat-reader.mjs scripts/check-wechat-reader-boundary.mjs scripts/wechat-reader-boundary.test.mjs package.json .gitignore src-tauri/binaries/.gitkeep src-tauri/resources/wechat/native-manifest.json
git commit -m "build: package audited WeChat reader"
```

---

### Task 6: Rust Native Sidecar Runner

**Files:**
- Create: `src-tauri/src/wechat_native_runner.rs`
- Modify: `src-tauri/src/wechat_hush_bridge.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: `WechatReaderRequest`, bundled reader path, bundled manifest, WCDB resource path, and an in-memory `BTreeMap<String, String>` key map.
- Produces: `WechatReaderRunner::run(&self, request: &WechatReaderRequest, timeout: Duration) -> Result<WechatReaderEnvelope, WechatReaderError>`.

- [ ] **Step 1: Add failing Rust process-boundary tests**

```rust
#[tokio::test]
async fn sends_keys_only_on_stdin_and_clears_environment() {
    let harness = NativeHarness::new(
        r#"{"ok":true,"version":1,"action":"status","data":{"status":{"liveReadOk":false}}}"#,
    );
    let runner = harness.runner();
    let request = WechatReaderRequest::status(keys_with("salt", "secret-key-material"));
    runner.run(&request, Duration::from_secs(2)).await.unwrap();
    let capture = harness.capture();
    assert!(!capture.argv.contains("secret-key-material"));
    assert!(!capture.environment.contains("secret-key-material"));
    assert!(capture.stdin.contains("secret-key-material"));
    assert_eq!(capture.environment.keys().collect::<Vec<_>>(), vec!["HOME", "LANG", "LC_ALL", "TMPDIR"]);
}

#[tokio::test]
async fn rejects_oversized_or_malformed_output() {
    let oversized = NativeHarness::new(&"x".repeat(1_048_577));
    assert_eq!(
        oversized.runner().run(&WechatReaderRequest::status(BTreeMap::new()), Duration::from_secs(2)).await.unwrap_err().code(),
        "malformed_reader_output"
    );
}
```

`NativeHarness` is a test-only shell-free executable fixture written into a
temporary directory. It records argv, the four allowlisted environment
variables, and stdin into owner-only files; `keys_with` returns a one-entry
`BTreeMap<String, String>`. The harness is never compiled into the app.

- [ ] **Step 2: Run the Rust tests and verify the module is missing**

Run: `cargo test --manifest-path src-tauri/Cargo.toml wechat_native_runner -- --nocapture`

Expected: FAIL because `wechat_native_runner` and its request types do not exist.

- [ ] **Step 3: Implement typed requests and redacted errors**

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatReaderRequest {
    version: u8,
    action: WechatReaderAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    types: Option<[String; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    talker: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    after: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    include_media_paths: Option<bool>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    keys: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum WechatReaderAction {
    Status,
    Sessions,
    Timeline,
}
```

Constructors enforce the same limits as Go. `Debug` is implemented manually and prints `key_count`, never key contents.

- [ ] **Step 4: Implement bounded one-shot execution**

Use `tokio::process::Command` with no arguments, `env_clear`, allowlisted environment, piped stdin/stdout/stderr, and `kill_on_drop(true)`. Serialize once, write stdin, close stdin, read stdout and stderr through `take(1_048_577)`, and wrap the full child lifecycle in `tokio::time::timeout`.

On non-zero exit:

- parse a valid failure envelope from stdout;
- ignore stderr content except whether it was non-empty;
- return a stable code and safe message;
- never include request JSON, paths, stdout, stderr, keys, or talkers in `Display`, `Debug`, logs, or audit fields.

- [ ] **Step 5: Verify the bundled manifest before every process launch**

Read `native-manifest.json` once, canonicalize reader and WCDB paths, require both under the app resource/binary roots, reject symlinks, calculate SHA-256, and compare both hashes. Cache only a successful verification keyed by file size and modification time.

- [ ] **Step 6: Replace argv runner calls in `WechatHushBridge`**

Change:

```rust
trait WechatRunner {
    fn run<'a>(
        &'a self,
        request: &'a WechatReaderRequest,
        timeout: Duration,
    ) -> Pin<Box<dyn Future<Output = Result<WechatCommandOutput, String>> + Send + 'a>>;
}
```

Replace `status_args`, `sessions_args`, and `timeline_args` with typed constructors. Preserve status single-flight, sync single-flight, 24-hour initial window, 2-minute overlap, 100-session limit, 100-message limit, incoming-only normalization, deduplication, and auto-sync default false.

Change source metadata from:

```rust
"source_id": format!("wechat-cli:{talker}:{message_key}"),
"source": "wechat_cli",
"wechat_cli": message.raw,
```

to:

```rust
"source_id": format!("wechat-native:{talker}:{message_key}"),
"source": "wechat_native",
"wechat_native": message.raw,
```

- [ ] **Step 7: Keep external fallback development-only**

Add:

```toml
[features]
default = []
wechat-external-dev = []
```

Compile `discover_wechat_cli`, argv validation, external setup script, and external install page only under `#[cfg(feature = "wechat-external-dev")]`. Without that feature, failure to locate the bundled reader returns `reader_not_bundled`; it never searches `PATH` or `~/.local`.

- [ ] **Step 8: Register the sidecar and WCDB resource**

In `tauri.conf.json` add:

```json
{
  "bundle": {
    "externalBin": ["binaries/humhum-wechat-reader"],
    "resources": {
      "resources/wechat/libWCDB.dylib": "wechat/libWCDB.dylib",
      "resources/wechat/native-manifest.json": "wechat/native-manifest.json"
    }
  }
}
```

Construct `WechatHushBridge` during Tauri setup with the resolved app resource directory and sidecar path. Tests use explicit paths and never depend on the app bundle.

- [ ] **Step 9: Run focused and full Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml wechat_native_runner wechat_hush_bridge -- --nocapture`

Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all existing tests pass; platform-dependent tests remain at their existing ignored count.

- [ ] **Step 10: Commit the Rust process boundary**

```bash
git add src-tauri/src/wechat_native_runner.rs src-tauri/src/wechat_hush_bridge.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "feat: run bundled WeChat reader from Hush"
```

---

### Task 7: Hush Product States And Documentation

**Files:**
- Modify: `src/components/Hub/HushModule.tsx`
- Modify: `src/components/Hub/HushModule.test.ts`
- Modify: `src/components/Hub/hushPresentation.ts`
- Modify: `src/components/Hub/hushPresentation.test.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Consumes: existing `WechatHushStatus` plus stable native error codes.
- Produces: clear local-reader states without third-party installation instructions.

- [ ] **Step 1: Add failing UI state tests**

```ts
it("describes the bundled reader without an external install action", async () => {
  mockInvoke.mockImplementation(async (command) => {
    if (command === "get_wechat_hush_status") {
      return {
        state: "setup_required",
        message: "微信本地读取需要完成一次准备",
        live_read_ok: false,
        blocked_by: "key_coverage_incomplete",
        next_action: "本版本尚未启用安全提钥，请保留当前只读预览",
        warnings: [],
        auto_sync_enabled: false,
        sync_interval_minutes: 5,
        syncing: false,
      };
    }
    return {};
  });
  render(<HushModule />);
  expect(await screen.findByText("内置微信读取器")).toBeTruthy();
  expect(screen.queryByText(/安装 wechat-cli/i)).toBeNull();
  expect(screen.getByRole("checkbox", { name: /自动同步/ })).not.toBeChecked();
});
```

- [ ] **Step 2: Run focused frontend tests and verify the old copy fails**

Run: `npx vitest run src/components/Hub/HushModule.test.ts src/components/Hub/hushPresentation.test.ts`

Expected: FAIL because the current product copy still references the external CLI.

- [ ] **Step 3: Implement clear reader states**

Use these exact state labels:

- `reader_not_bundled`: `当前构建未包含微信读取器`
- `reader_identity_invalid`: `微信读取器完整性校验失败`
- `wcdb_unavailable`: `微信数据库读取库不可用`
- `key_coverage_incomplete`: `内置读取器已就绪，安全提钥尚未完成`
- `unsupported_wechat_build`: `当前微信版本还未通过兼容性验证`
- ready: `微信真实消息读取已就绪`

Production UI does not show an install link. It shows `准备微信读取` only when the signed key-helper capability is present; this increment renders the button disabled with the explanation `安全提钥将在签名预览版开放`.

- [ ] **Step 4: Update README status honestly**

Document:

- bundled reader core exists and requires no external CLI at runtime;
- the current source increment uses fixture and development key injection for verification;
- public real-message setup remains disabled until vault, one-shot helper, Developer ID signing, and notarization are complete;
- no send/reply, cloud relay, or background privilege exists;
- release users should not enter an administrator password into HUMHUM.

- [ ] **Step 5: Run frontend and documentation checks**

Run: `npm test`

Expected: all frontend and Node tests pass.

Run: `rg -n "安装 wechat-cli|r266-tech/wechat-cli/releases" src README.md README.zh-CN.md`

Expected: no production UI or README installation instruction remains; a historical/provenance mention is permitted only in `NOTICE.md` and the approved design/spec documents.

- [ ] **Step 6: Commit Hush product states**

```bash
git add src/components/Hub/HushModule.tsx src/components/Hub/HushModule.test.ts src/components/Hub/hushPresentation.ts src/components/Hub/hushPresentation.test.ts README.md README.zh-CN.md
git commit -m "feat: present bundled WeChat reader in Hush"
```

---

### Task 8: End-To-End Verification And Phase-One Gate

**Files:**
- Create: `docs/security/wechat-native-reader.md`
- Create: `docs/testing/wechat-native-reader-phase-1.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Consumes: the completed reader, bundle, Rust bridge, Hush UI, and test evidence.
- Produces: an auditable phase-one evidence record and a locally runnable app build.

- [ ] **Step 1: Run formatting and static checks**

Run: `cd native/humhum-wechat && gofmt -w . && go test ./...`

Expected: PASS.

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Expected: PASS.

Run: `npm run native:wechat:check`

Expected: PASS with zero forbidden packages or symbols.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm test`

Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS with only the repository's existing platform-dependent ignored tests.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Build the app bundle with the reader**

Run: `npm run native:wechat:build`

Expected: PASS.

Run: `npm run tauri build -- --bundles app`

Expected: PASS and create `src-tauri/target/release/bundle/macos/HumHum.app`.

- [ ] **Step 4: Inspect the built app**

Run: `find src-tauri/target/release/bundle/macos/HumHum.app/Contents -type f | rg "humhum-wechat-reader|libWCDB|native-manifest"`

Expected: exactly one reader, one WCDB library, and one native manifest inside the bundle.

Run: `codesign --verify --deep --strict src-tauri/target/release/bundle/macos/HumHum.app`

Expected: PASS for the local ad-hoc build; the evidence document must state that this is not the signed preview gate.

Run: `lsof -nP -iTCP -iUDP -c humhum-wechat-reader`

Expected: no reader-owned socket. The command may exit 1 when no rows exist.

- [ ] **Step 5: Exercise fixture-mode Hush integration**

Launch the app with an explicit test-only fixture configuration, open Hush, run status, list the two fictional conversations, and sync the fictional 24-hour window. Verify:

- only incoming fixture messages appear;
- repeat sync imports zero new messages and reports duplicates;
- auto-sync remains off;
- no external `wechat-cli` process is started;
- no `wechat-cli` path is displayed;
- no real Hush data file is used during this test.

- [ ] **Step 6: Write the security and test evidence**

`docs/security/wechat-native-reader.md` records the allowlist, read-only SQL surface, no-network gate, secret channels, provenance, excluded privileged helper, and the ad-hoc-signing limitation.

`docs/testing/wechat-native-reader-phase-1.md` records:

- exact tested commit;
- Go, Rust, Node, macOS, and architecture versions;
- all commands and pass counts;
- reader and WCDB SHA-256 values;
- bundle file locations;
- socket inspection result;
- fixture identifiers used;
- the remaining vault, helper, real-message, signing, and notarization gates.

- [ ] **Step 7: Review the phase-one diff**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only phase-one files intended for the final commit are staged or modified; unrelated pre-existing files remain untouched and unstaged.

- [ ] **Step 8: Commit verification evidence**

```bash
git add docs/security/wechat-native-reader.md docs/testing/wechat-native-reader-phase-1.md README.md README.zh-CN.md
git commit -m "docs: record WeChat reader phase one evidence"
```

---

## Phase-One Exit Criteria

- The bundled executable accepts only the three approved actions through stdin.
- Unknown fields, trailing JSON, oversized input, unsafe talkers, excessive limits, and media-path requests fail before database access.
- The committed Go source contains no network, shell, updater, server, database-write, or general-SQL capability.
- The reader opens WCDB read-only, uses fixed queries, and returns bounded private/group session and timeline data.
- Fixture tests cover text, image summary, file summary, quote summary, outgoing filtering, pagination, wrong keys, and duplicate overlap.
- Rust sends key material only over stdin, clears the child environment, bounds output, enforces timeouts, verifies hashes, and redacts failures.
- Production builds never search `PATH` or `~/.local` for `wechat-cli`.
- Hush preserves the 24-hour initial window, 2-minute overlap, incoming-only import, deduplication, and opt-in auto-sync.
- The app bundle contains the reader, WCDB library, and hash manifest.
- All native, Rust, frontend, Node, and build tests pass.
- Documentation states plainly that real-message privileged setup is not public until the vault, one-shot helper, Developer ID signing, and notarization phases pass.
