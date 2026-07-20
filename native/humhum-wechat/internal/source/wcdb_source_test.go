package source

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/edible999999999-jpg/humhum/native/humhum-wechat/internal/wcdb"
)

func TestMessageTableNameMatchesWechatSchema(t *testing.T) {
	t.Parallel()

	if got := messageTableName("friend-alpha"); got != "Msg_76f2aba956808a5d5e47b07d7f1bf246" {
		t.Fatalf("messageTableName() = %s", got)
	}
	if !validMessageTableName(messageTableName("team-alpha@chatroom")) {
		t.Fatal("valid hashed message table rejected")
	}
	if validMessageTableName(`Msg_x"; DELETE FROM SessionTable`) {
		t.Fatal("unsafe message table accepted")
	}
}

func TestNormalizeMessageRowKeepsDirectionAndReadableKinds(t *testing.T) {
	t.Parallel()

	senderMap := map[int64]string{
		1: "friend-alpha",
		2: "fixture-self",
	}
	incoming, err := normalizeMessageRow("friend-alpha", "fixture-self", senderMap, wcdb.Row{
		"local_id":        int64(1),
		"server_id":       int64(10),
		"local_type":      int64(1),
		"sort_seq":        int64(100),
		"real_sender_id":  int64(1),
		"create_time":     int64(1784471400),
		"message_content": "friend-alpha:\nfixture hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !incoming.Message.Incoming || incoming.Message.Text != "fixture hello" ||
		incoming.Message.Kind != "text" {
		t.Fatalf("incoming = %#v", incoming)
	}

	outgoing, err := normalizeMessageRow("friend-alpha", "fixture-self", senderMap, wcdb.Row{
		"local_id":        int64(2),
		"server_id":       int64(11),
		"local_type":      int64(49) | int64(6)<<32,
		"sort_seq":        int64(101),
		"real_sender_id":  int64(2),
		"create_time":     int64(1784471460),
		"message_content": "<msg><appmsg><title>fixture.pdf</title></appmsg></msg>",
	})
	if err != nil {
		t.Fatal(err)
	}
	if outgoing.Message.Incoming || outgoing.Message.Text != "[文件] fixture.pdf" ||
		outgoing.Message.Kind != "file" {
		t.Fatalf("outgoing = %#v", outgoing)
	}
}

func TestDiscoverAccountRequiresExactlyOneRealAccount(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	accountOne := createFixtureAccount(t, root, "fixture-account-one")
	got, err := discoverAccount(root)
	if err != nil {
		t.Fatal(err)
	}
	canonicalAccountOne, err := filepath.EvalSymlinks(accountOne)
	if err != nil {
		t.Fatal(err)
	}
	if got.Root != canonicalAccountOne {
		t.Fatalf("discoverAccount() root = %s", got.Root)
	}

	createFixtureAccount(t, root, "fixture-account-two")
	if _, err := discoverAccount(root); err == nil {
		t.Fatal("discoverAccount accepted multiple account roots")
	}
}

func TestCompatibilityFailsClosedForUnknownBuilds(t *testing.T) {
	t.Parallel()

	known := wechatBuild{
		Version: "4.0.6",
		SHA256:  "a15e701c68cb45aa1c98a631c49eb974d9cd9bff6ae59f16d1a487f202957b98",
	}
	if !known.Supported() {
		t.Fatal("known fixture-backed WeChat build was rejected")
	}
	if (wechatBuild{Version: "4.0.7", SHA256: known.SHA256}).Supported() {
		t.Fatal("unknown WeChat version was accepted")
	}
	if (wechatBuild{Version: known.Version, SHA256: "00"}).Supported() {
		t.Fatal("unknown WeChat executable fingerprint was accepted")
	}
}

func createFixtureAccount(t *testing.T, root, name string) string {
	t.Helper()

	account := filepath.Join(root, name)
	sessionDirectory := filepath.Join(account, "db_storage", "session")
	messageDirectory := filepath.Join(account, "db_storage", "message")
	if err := os.MkdirAll(sessionDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(messageDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		filepath.Join(sessionDirectory, "session.db"),
		filepath.Join(messageDirectory, "message_0.db"),
	} {
		if err := os.WriteFile(path, []byte("0123456789abcdef"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return account
}
