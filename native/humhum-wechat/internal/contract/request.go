package contract

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"unicode/utf8"
)

const MaxRequestBytes = 256 * 1024

const maxTalkerBytes = 512

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
	raw, err := io.ReadAll(io.LimitReader(input, MaxRequestBytes+1))
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
	if err := decoder.Decode(&trailing); err != io.EOF {
		return Request{}, NewFailure("invalid_request", "Trailing JSON is forbidden")
	}
	if failure := request.Validate(); failure != nil {
		return Request{}, failure
	}
	return request, nil
}

func (request Request) Validate() *Failure {
	if request.Version != 1 {
		return NewFailure("unsupported_version", "Only reader contract version 1 is supported")
	}
	if failure := validateKeyMap(request.Keys); failure != nil {
		return failure
	}

	switch request.Action {
	case "status":
		if request.Types != nil || request.Limit != 0 || request.Talker != "" ||
			request.After != 0 || request.IncludeMediaPaths != nil {
			return NewFailure("invalid_request", "Status accepts no action-specific fields")
		}
	case "sessions":
		if len(request.Types) != 2 || request.Types[0] != "private" || request.Types[1] != "group" {
			return NewFailure("invalid_types", "Sessions types must be private then group")
		}
		if failure := validateLimit(request.Limit); failure != nil {
			return failure
		}
		if request.Talker != "" || request.After != 0 || request.IncludeMediaPaths != nil {
			return NewFailure("invalid_request", "Sessions contains timeline-only fields")
		}
	case "timeline":
		if request.Types != nil {
			return NewFailure("invalid_request", "Timeline contains session-only fields")
		}
		if failure := validateTalker(request.Talker); failure != nil {
			return failure
		}
		if request.After < 0 {
			return NewFailure("invalid_after", "Timeline after must be a non-negative Unix timestamp")
		}
		if failure := validateLimit(request.Limit); failure != nil {
			return failure
		}
		if request.IncludeMediaPaths == nil || *request.IncludeMediaPaths {
			return NewFailure("media_paths_forbidden", "Timeline media paths must be explicitly disabled")
		}
	default:
		return NewFailure("unknown_action", "Action is not allowed")
	}
	return nil
}

func validateLimit(limit int) *Failure {
	if limit < 1 || limit > 100 {
		return NewFailure("invalid_limit", "Limit must be between 1 and 100")
	}
	return nil
}

func validateTalker(talker string) *Failure {
	if talker == "" || !utf8.ValidString(talker) || len([]byte(talker)) > maxTalkerBytes ||
		strings.HasPrefix(talker, "-") || strings.TrimSpace(talker) != talker {
		return NewFailure("invalid_talker", "Talker is invalid")
	}
	return nil
}

func validateKeyMap(keys map[string]string) *Failure {
	for salt, key := range keys {
		if !isLowerHex(salt, 32) || !isLowerHex(key, 64) {
			return NewFailure("invalid_key_map", "Key map entries must use fixed lowercase hexadecimal")
		}
	}
	return nil
}

func isLowerHex(value string, length int) bool {
	if len(value) != length {
		return false
	}
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}
