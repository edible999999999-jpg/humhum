package main

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/edible999999999-jpg/humhum/native/humhum-wechat/internal/contract"
)

func TestRunReadsOneRequestAndDoesNotEchoKeys(t *testing.T) {
	t.Parallel()

	fixtureRoot, err := filepath.Abs("../../testdata/account")
	if err != nil {
		t.Fatal(err)
	}
	const secretKey = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	input := strings.NewReader(
		`{"version":1,"action":"sessions","types":["private","group"],"limit":100,` +
			`"keys":{"00112233445566778899aabbccddeeff":"` + secretKey + `"}}`,
	)
	var output bytes.Buffer
	var stderr bytes.Buffer
	exitCode := run(input, &output, &stderr, fixtureEnvironment(fixtureRoot))
	if exitCode != 0 {
		t.Fatalf("run exit = %d, stdout = %s, stderr = %s", exitCode, output.String(), stderr.String())
	}
	if strings.Contains(output.String(), secretKey) || strings.Contains(stderr.String(), secretKey) {
		t.Fatal("reader output leaked the key map")
	}
	var envelope contract.Envelope
	decoder := json.NewDecoder(bytes.NewReader(output.Bytes()))
	if err := decoder.Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	if !envelope.OK || envelope.Action != "sessions" {
		t.Fatalf("envelope = %#v", envelope)
	}
	var trailing any
	if decoder.Decode(&trailing) == nil {
		t.Fatal("reader wrote more than one JSON value")
	}
}

func TestRunRejectsOversizedInputWithOneSafeEnvelope(t *testing.T) {
	t.Parallel()

	var output bytes.Buffer
	var stderr bytes.Buffer
	exitCode := run(
		strings.NewReader(strings.Repeat("x", contract.MaxRequestBytes+1)),
		&output,
		&stderr,
		func(string) string { return "" },
	)
	if exitCode != 2 {
		t.Fatalf("run exit = %d", exitCode)
	}
	var envelope contract.Envelope
	if err := json.Unmarshal(output.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.OK || envelope.Error == nil || envelope.Error.Code != "request_too_large" {
		t.Fatalf("envelope = %#v", envelope)
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q", stderr.String())
	}
}

func fixtureEnvironment(root string) func(string) string {
	return func(name string) string {
		switch name {
		case "HUMHUM_WECHAT_FIXTURE_MODE":
			return "1"
		case "HUMHUM_WECHAT_FIXTURE_ROOT":
			return root
		default:
			return ""
		}
	}
}
