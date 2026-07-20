package reader

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/edible999999999-jpg/humhum/native/humhum-wechat/internal/contract"
	"github.com/edible999999999-jpg/humhum/native/humhum-wechat/internal/source"
)

func TestHandleProducesStableActionShapes(t *testing.T) {
	t.Parallel()

	fixture, err := source.NewFixture("../../testdata/account")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = fixture.Close() })
	includeMediaPaths := false
	cases := []struct {
		request contract.Request
		key     string
	}{
		{contract.Request{Version: 1, Action: "status"}, "status"},
		{
			contract.Request{
				Version: 1,
				Action:  "sessions",
				Types:   []string{"private", "group"},
				Limit:   100,
			},
			"sessions",
		},
		{
			contract.Request{
				Version:           1,
				Action:            "timeline",
				Talker:            "friend-alpha",
				After:             1784471400,
				Limit:             100,
				IncludeMediaPaths: &includeMediaPaths,
			},
			"messages",
		},
	}

	for _, tc := range cases {
		envelope := Handle(context.Background(), tc.request, fixture)
		if !envelope.OK || envelope.Version != 1 || envelope.Action != tc.request.Action {
			t.Fatalf("envelope = %#v", envelope)
		}
		encoded, err := json.Marshal(envelope.Data)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(encoded, []byte(`"`+tc.key+`"`)) {
			t.Fatalf("%s missing from %s", tc.key, encoded)
		}
	}
}

func TestHandleMapsTypedAndUnknownErrorsWithoutLeakingCause(t *testing.T) {
	t.Parallel()

	typed := Handle(
		context.Background(),
		contract.Request{Version: 1, Action: "status"},
		errorSource{err: &source.Error{
			Code:       "wcdb_unavailable",
			Message:    "WCDB is unavailable",
			NextAction: "Use the bundled runtime",
		}},
	)
	if typed.OK || typed.Error == nil || typed.Error.Code != "wcdb_unavailable" {
		t.Fatalf("typed envelope = %#v", typed)
	}

	unknown := Handle(
		context.Background(),
		contract.Request{Version: 1, Action: "status"},
		errorSource{err: assertiveError("secret path and key")},
	)
	encoded, err := json.Marshal(unknown)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte("secret path and key")) ||
		unknown.Error == nil || unknown.Error.Code != "reader_failed" {
		t.Fatalf("unknown envelope = %s", encoded)
	}
}

type errorSource struct {
	err error
}

func (fixture errorSource) Status(context.Context) (source.Status, error) {
	return source.Status{}, fixture.err
}

func (fixture errorSource) Sessions(
	context.Context,
	[]source.ConversationKind,
	int,
) ([]source.Session, error) {
	return nil, fixture.err
}

func (fixture errorSource) Timeline(
	context.Context,
	string,
	int64,
	int,
) ([]source.Message, error) {
	return nil, fixture.err
}

func (errorSource) Close() error {
	return nil
}

type assertiveError string

func (failure assertiveError) Error() string {
	return string(failure)
}
