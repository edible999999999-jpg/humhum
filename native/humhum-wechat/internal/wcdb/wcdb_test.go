package wcdb

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

const verifiedTestWCDBSHA256 = "bb7602ca165d7edfff58893760f53c2df36202548422c1be517c2de23e224376"

func TestPackageExposesNoWriteOperation(t *testing.T) {
	t.Parallel()

	forbidden := []string{
		"Exec",
		"OpenWritable",
		"OpenWithKeyMapWritable",
		"Backup",
		"Export",
		"Attach",
		"Rekey",
	}
	packageFiles, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range packageFiles {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		code, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		for _, symbol := range forbidden {
			pattern := regexp.MustCompile(`func\s+(?:\([^)]*\)\s*)?` + symbol + `\b`)
			if pattern.Match(code) {
				t.Fatalf("forbidden write API %s in %s", symbol, name)
			}
		}
	}
}

func TestValidateQuerySQLAllowsOnlyFixedReadForms(t *testing.T) {
	t.Parallel()

	allowed := []string{
		"SELECT count(*) FROM sqlite_master",
		"\n SELECT username FROM SessionTable LIMIT ?",
		"PRAGMA table_info('SessionTable')",
	}
	for _, query := range allowed {
		if err := validateQuerySQL(query); err != nil {
			t.Fatalf("validateQuerySQL(%q) = %v", query, err)
		}
	}

	forbidden := []string{
		"",
		"INSERT INTO x VALUES (1)",
		"UPDATE x SET y = 1",
		"DELETE FROM x",
		"ATTACH DATABASE 'x' AS y",
		"PRAGMA writable_schema = ON",
		"SELECT 1; DELETE FROM x",
		"-- comment\nSELECT 1",
	}
	for _, query := range forbidden {
		if err := validateQuerySQL(query); err == nil {
			t.Fatalf("validateQuerySQL(%q) accepted a forbidden query", query)
		}
	}
}

func TestReadSaltAndContainedPathRejectSymlinksAndEscape(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	database := filepath.Join(root, "session.db")
	salt := []byte("0123456789abcdef")
	if err := os.WriteFile(database, append(salt, []byte("fixture")...), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := ReadSaltHex(database)
	if err != nil {
		t.Fatal(err)
	}
	if got != "30313233343536373839616263646566" {
		t.Fatalf("ReadSaltHex() = %s", got)
	}
	if _, err := CanonicalContainedFile(root, database); err != nil {
		t.Fatalf("CanonicalContainedFile() = %v", err)
	}

	outside := filepath.Join(t.TempDir(), "outside.db")
	if err := os.WriteFile(outside, append(salt, []byte("fixture")...), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := CanonicalContainedFile(root, outside); err == nil {
		t.Fatal("CanonicalContainedFile accepted an escaping path")
	}

	link := filepath.Join(root, "linked.db")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if _, err := CanonicalContainedFile(root, link); err == nil {
		t.Fatal("CanonicalContainedFile accepted a symlink")
	}
}

func TestValidateKeyMapEntryRequiresFixedLowercaseHex(t *testing.T) {
	t.Parallel()

	if err := validateKeyMapEntry(
		"00112233445566778899aabbccddeeff",
		"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
	); err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][2]string{
		{"ABC", "00"},
		{"00112233445566778899aabbccddeeff", "ABCDEF"},
		{"00112233445566778899AABBCCDDEEFF", "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"},
	} {
		if err := validateKeyMapEntry(pair[0], pair[1]); err == nil {
			t.Fatalf("validateKeyMapEntry(%q, %q) accepted invalid input", pair[0], pair[1])
		}
	}
}

func TestBootstrapLoadsOnlyTheVerifiedLocalWCDBLibrary(t *testing.T) {
	path := os.Getenv("HUMHUM_WECHAT_WCDB_DYLIB")
	if path == "" {
		t.Skip("verified WCDB test library not installed")
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if got := hex.EncodeToString(hash.Sum(nil)); got != verifiedTestWCDBSHA256 {
		t.Fatalf("WCDB checksum = %s", got)
	}
	if err := Bootstrap(path); err != nil {
		t.Fatal(err)
	}
}
