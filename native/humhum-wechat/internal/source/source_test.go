package source

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestFixtureSourceReturnsBoundedPrivateAndGroupData(t *testing.T) {
	t.Parallel()

	fixture, err := NewFixture("../../testdata/account")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := fixture.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})

	sessions, err := fixture.Sessions(
		context.Background(),
		[]ConversationKind{Private, Group},
		2,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 2 || sessions[0].Talker != "team-alpha@chatroom" {
		t.Fatalf("sessions = %#v", sessions)
	}

	messages, err := fixture.Timeline(
		context.Background(),
		"friend-alpha",
		1784471400,
		100,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 3 || !messages[0].Incoming || messages[0].Text != "fixture hello" {
		t.Fatalf("messages = %#v", messages)
	}
	if messages[2].Incoming {
		t.Fatalf("outgoing fixture message marked incoming: %#v", messages[2])
	}
}

func TestFixtureSourceFiltersKindsBoundsAndTimestamps(t *testing.T) {
	t.Parallel()

	fixture, err := NewFixture("../../testdata/account")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = fixture.Close() })

	sessions, err := fixture.Sessions(context.Background(), []ConversationKind{Group}, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0].Kind != Group {
		t.Fatalf("group sessions = %#v", sessions)
	}

	messages, err := fixture.Timeline(context.Background(), "friend-alpha", 1784471460, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].Timestamp != 1784471460 {
		t.Fatalf("bounded messages = %#v", messages)
	}
}

func TestFixtureSourceRejectsUnknownTalkerAndSymlinkEscape(t *testing.T) {
	t.Parallel()

	fixture, err := NewFixture("../../testdata/account")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = fixture.Close() })
	if _, err := fixture.Timeline(context.Background(), "../outside", 0, 100); err == nil {
		t.Fatal("Timeline accepted path-like talker")
	}

	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "session.json"), []byte("[]"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "account")); err != nil {
		t.Fatal(err)
	}
	if _, err := NewFixture(filepath.Join(root, "account")); err == nil {
		t.Fatal("NewFixture accepted a symlink root")
	}
}
