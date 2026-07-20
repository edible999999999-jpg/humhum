package reader

import (
	"context"
	"errors"
	"time"

	"github.com/edible999999999-jpg/humhum/native/humhum-wechat/internal/contract"
	"github.com/edible999999999-jpg/humhum/native/humhum-wechat/internal/source"
)

var publicSourceErrorCodes = map[string]bool{
	"full_disk_access_required": true,
	"wechat_not_running":        true,
	"wechat_not_logged_in":      true,
	"unsupported_wechat_build":  true,
	"key_coverage_incomplete":   true,
	"key_validation_failed":     true,
	"wcdb_unavailable":          true,
	"schema_unsupported":        true,
	"query_timeout":             true,
}

type statusData struct {
	Status source.Status `json:"status"`
}

type sessionsData struct {
	Sessions []sessionOutput `json:"sessions"`
}

type sessionOutput struct {
	Username      string                  `json:"username"`
	DisplayName   string                  `json:"display_name"`
	ChatType      source.ConversationKind `json:"chat_type"`
	LastTimestamp int64                   `json:"last_timestamp"`
}

type timelineQuery struct {
	Talker      string `json:"talker"`
	DisplayName string `json:"display_name"`
	After       int64  `json:"after"`
	Limit       int    `json:"limit"`
}

type messageID struct {
	Talker      string `json:"talker"`
	LocalID     int64  `json:"local_id"`
	ServerIDStr string `json:"server_id_str,omitempty"`
}

type messageOutput struct {
	ID         messageID `json:"id"`
	TimeISO    string    `json:"time_iso"`
	Sender     string    `json:"sender"`
	SenderWXID string    `json:"sender_wxid,omitempty"`
	IsFromMe   bool      `json:"is_from_me"`
	Kind       string    `json:"kind"`
	Text       string    `json:"text"`
}

type timelineData struct {
	Query    timelineQuery   `json:"query"`
	Messages []messageOutput `json:"messages"`
}

func Handle(
	ctx context.Context,
	request contract.Request,
	data source.DataSource,
) contract.Envelope {
	switch request.Action {
	case "status":
		status, err := data.Status(ctx)
		if err != nil {
			return Failure(request.Action, err)
		}
		return contract.Success(request.Action, statusData{Status: status})
	case "sessions":
		sessions, err := data.Sessions(
			ctx,
			[]source.ConversationKind{source.Private, source.Group},
			request.Limit,
		)
		if err != nil {
			return Failure(request.Action, err)
		}
		output := make([]sessionOutput, len(sessions))
		for index, session := range sessions {
			output[index] = sessionOutput{
				Username:      session.Talker,
				DisplayName:   session.DisplayName,
				ChatType:      session.Kind,
				LastTimestamp: session.LastTimestamp,
			}
		}
		return contract.Success(request.Action, sessionsData{Sessions: output})
	case "timeline":
		messages, err := data.Timeline(ctx, request.Talker, request.After, request.Limit)
		if err != nil {
			return Failure(request.Action, err)
		}
		output := make([]messageOutput, len(messages))
		for index, message := range messages {
			output[index] = messageOutput{
				ID: messageID{
					Talker:      message.Talker,
					LocalID:     message.LocalID,
					ServerIDStr: message.ServerID,
				},
				TimeISO:    time.Unix(message.Timestamp, 0).UTC().Format(time.RFC3339),
				Sender:     message.Sender,
				SenderWXID: message.SenderWXID,
				IsFromMe:   !message.Incoming,
				Kind:       message.Kind,
				Text:       message.Text,
			}
		}
		return contract.Success(request.Action, timelineData{
			Query: timelineQuery{
				Talker:      request.Talker,
				DisplayName: request.Talker,
				After:       request.After,
				Limit:       request.Limit,
			},
			Messages: output,
		})
	default:
		return contract.Failed(
			request.Action,
			contract.NewFailure("unknown_action", "Action is not allowed"),
		)
	}
}

func Failure(action string, err error) contract.Envelope {
	var sourceError *source.Error
	if errors.As(err, &sourceError) && publicSourceErrorCodes[sourceError.Code] {
		return contract.Failed(action, &contract.Failure{
			Code:       sourceError.Code,
			Message:    sourceError.Message,
			NextAction: sourceError.NextAction,
		})
	}
	return contract.Failed(
		action,
		contract.NewFailure("reader_failed", "Local WeChat read failed"),
	)
}
