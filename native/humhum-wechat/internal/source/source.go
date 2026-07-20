package source

import (
	"context"

	"github.com/edible999999999-jpg/humhum/native/humhum-wechat/internal/contract"
)

type ConversationKind string

const (
	Private ConversationKind = "private"
	Group   ConversationKind = "group"
)

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
	Talker     string `json:"talker"`
	LocalID    int64  `json:"localId"`
	ServerID   string `json:"serverId,omitempty"`
	Timestamp  int64  `json:"timestamp"`
	Sender     string `json:"sender"`
	SenderWXID string `json:"senderWxid,omitempty"`
	Incoming   bool   `json:"incoming"`
	Kind       string `json:"kind"`
	Text       string `json:"text"`
}

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

func (failure *Error) Error() string {
	return failure.Code
}

func (failure *Error) Unwrap() error {
	return failure.Cause
}

func Open(request contract.Request, getenv func(string) string) (DataSource, error) {
	if getenv("HUMHUM_WECHAT_FIXTURE_MODE") == "1" {
		root := getenv("HUMHUM_WECHAT_FIXTURE_ROOT")
		if root == "" {
			return nil, &Error{
				Code:    "schema_unsupported",
				Message: "Fixture root is missing",
			}
		}
		return NewFixture(root)
	}
	return OpenLocal(request.Keys)
}
