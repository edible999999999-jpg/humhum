package source

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type FixtureSource struct {
	root     string
	sessions []Session
	messages map[string][]Message
}

type fixtureTimeline struct {
	Talker   string    `json:"talker"`
	Messages []Message `json:"messages"`
}

func NewFixture(root string) (*FixtureSource, error) {
	info, err := os.Lstat(root)
	if err != nil {
		return nil, fmt.Errorf("inspect fixture root: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return nil, errors.New("fixture root must be a real directory")
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, fmt.Errorf("resolve fixture root: %w", err)
	}

	var sessions []Session
	if err := decodeFixtureFile(canonicalRoot, filepath.Join(canonicalRoot, "session.json"), &sessions); err != nil {
		return nil, err
	}
	sort.SliceStable(sessions, func(left, right int) bool {
		if sessions[left].LastTimestamp == sessions[right].LastTimestamp {
			return sessions[left].Talker < sessions[right].Talker
		}
		return sessions[left].LastTimestamp > sessions[right].LastTimestamp
	})

	messageFiles, err := filepath.Glob(filepath.Join(canonicalRoot, "messages", "*.json"))
	if err != nil {
		return nil, fmt.Errorf("list fixture timelines: %w", err)
	}
	messages := make(map[string][]Message, len(messageFiles))
	for _, path := range messageFiles {
		var timeline fixtureTimeline
		if err := decodeFixtureFile(canonicalRoot, path, &timeline); err != nil {
			return nil, err
		}
		if !validFixtureTalker(timeline.Talker) {
			return nil, errors.New("fixture timeline contains invalid talker")
		}
		for index := range timeline.Messages {
			if timeline.Messages[index].Talker != timeline.Talker {
				return nil, errors.New("fixture message talker mismatch")
			}
		}
		sort.SliceStable(timeline.Messages, func(left, right int) bool {
			if timeline.Messages[left].Timestamp == timeline.Messages[right].Timestamp {
				return timeline.Messages[left].LocalID < timeline.Messages[right].LocalID
			}
			return timeline.Messages[left].Timestamp < timeline.Messages[right].Timestamp
		})
		messages[timeline.Talker] = timeline.Messages
	}

	return &FixtureSource{
		root:     canonicalRoot,
		sessions: sessions,
		messages: messages,
	}, nil
}

func (fixture *FixtureSource) Status(context.Context) (Status, error) {
	return Status{
		ConnectorVersion: "fixture",
		WeChatBuild:      "fixture-build",
		Compatibility:    "supported",
		KeyCoverage:      "fixture",
		WCDBAvailable:    true,
		LiveReadOK:       true,
		Warnings:         []string{},
	}, nil
}

func (fixture *FixtureSource) Sessions(
	ctx context.Context,
	kinds []ConversationKind,
	limit int,
) ([]Session, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 {
		return nil, &Error{Code: "invalid_limit", Message: "Session limit is invalid"}
	}
	allowed := make(map[ConversationKind]bool, len(kinds))
	for _, kind := range kinds {
		allowed[kind] = true
	}
	sessions := make([]Session, 0, min(limit, len(fixture.sessions)))
	for _, session := range fixture.sessions {
		if !allowed[session.Kind] {
			continue
		}
		sessions = append(sessions, session)
		if len(sessions) == limit {
			break
		}
	}
	return sessions, nil
}

func (fixture *FixtureSource) Timeline(
	ctx context.Context,
	talker string,
	after int64,
	limit int,
) ([]Message, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !validFixtureTalker(talker) {
		return nil, &Error{Code: "invalid_talker", Message: "Talker is invalid"}
	}
	if limit < 1 || limit > 100 {
		return nil, &Error{Code: "invalid_limit", Message: "Timeline limit is invalid"}
	}
	all, exists := fixture.messages[talker]
	if !exists {
		return nil, &Error{Code: "schema_unsupported", Message: "Fixture talker is unknown"}
	}
	messages := make([]Message, 0, min(limit, len(all)))
	for _, message := range all {
		if message.Timestamp < after {
			continue
		}
		messages = append(messages, message)
		if len(messages) == limit {
			break
		}
	}
	return messages, nil
}

func (fixture *FixtureSource) Close() error {
	return nil
}

func decodeFixtureFile(root, path string, target any) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect fixture file: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return errors.New("fixture file must be a regular file")
	}
	canonicalPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return fmt.Errorf("resolve fixture file: %w", err)
	}
	if !pathWithin(root, canonicalPath) {
		return errors.New("fixture path escapes fixture root")
	}
	raw, err := os.ReadFile(canonicalPath)
	if err != nil {
		return fmt.Errorf("read fixture file: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode fixture file: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("fixture file contains trailing JSON")
	}
	return nil
}

func pathWithin(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator))
}

func validFixtureTalker(talker string) bool {
	return talker != "" &&
		filepath.Base(talker) == talker &&
		!strings.HasPrefix(talker, "-") &&
		!strings.ContainsAny(talker, `/\`)
}
