package contract

import (
	"strings"
	"testing"
)

func TestDecodeAcceptsProductionActions(t *testing.T) {
	t.Parallel()

	cases := []string{
		`{"version":1,"action":"status"}`,
		`{"version":1,"action":"sessions","types":["private","group"],"limit":100,"keys":{"00112233445566778899aabbccddeeff":"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"}}`,
		`{"version":1,"action":"timeline","talker":"friend-alpha","after":1784471400,"limit":100,"includeMediaPaths":false,"keys":{"00112233445566778899aabbccddeeff":"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"}}`,
	}
	for _, input := range cases {
		request, failure := Decode(strings.NewReader(input))
		if failure != nil || request.Version != 1 {
			t.Fatalf("Decode(%s) = %#v, %#v", input, request, failure)
		}
	}
}

func TestDecodeRejectsUnknownTrailingAndOversizedInput(t *testing.T) {
	t.Parallel()

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

func TestDecodeRejectsActionSpecificFieldsAndInvalidKeys(t *testing.T) {
	t.Parallel()

	cases := []struct {
		input string
		code  string
	}{
		{`{"version":2,"action":"status"}`, "unsupported_version"},
		{`{"version":1,"action":"status","limit":1}`, "invalid_request"},
		{`{"version":1,"action":"sessions","types":["group","private"],"limit":100}`, "invalid_types"},
		{`{"version":1,"action":"sessions","types":["private","group"],"limit":0}`, "invalid_limit"},
		{`{"version":1,"action":"timeline","talker":"","after":0,"limit":100,"includeMediaPaths":false}`, "invalid_talker"},
		{`{"version":1,"action":"timeline","talker":"x","after":-1,"limit":100,"includeMediaPaths":false}`, "invalid_after"},
		{`{"version":1,"action":"timeline","talker":"x","after":0,"limit":100}`, "media_paths_forbidden"},
		{`{"version":1,"action":"status","keys":{"ABC":"00"}}`, "invalid_key_map"},
	}
	for _, tc := range cases {
		_, failure := Decode(strings.NewReader(tc.input))
		if failure == nil || failure.Code != tc.code {
			t.Fatalf("Decode(%s) failure = %#v; want %s", tc.input, failure, tc.code)
		}
	}
}
