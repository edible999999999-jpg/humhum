package reader

import (
	"context"
	"errors"

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
	Sessions []source.Session `json:"sessions"`
}

type timelineQuery struct {
	Talker string `json:"talker"`
	After  int64  `json:"after"`
	Limit  int    `json:"limit"`
}

type timelineData struct {
	Query    timelineQuery    `json:"query"`
	Messages []source.Message `json:"messages"`
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
		return contract.Success(request.Action, sessionsData{Sessions: sessions})
	case "timeline":
		messages, err := data.Timeline(ctx, request.Talker, request.After, request.Limit)
		if err != nil {
			return Failure(request.Action, err)
		}
		return contract.Success(request.Action, timelineData{
			Query: timelineQuery{
				Talker: request.Talker,
				After:  request.After,
				Limit:  request.Limit,
			},
			Messages: messages,
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
