package contract

import (
	"encoding/json"
	"io"
)

type Failure struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	NextAction string `json:"nextAction,omitempty"`
}

type Envelope struct {
	OK      bool     `json:"ok"`
	Version int      `json:"version"`
	Action  string   `json:"action"`
	Data    any      `json:"data,omitempty"`
	Error   *Failure `json:"error,omitempty"`
}

func NewFailure(code, message string) *Failure {
	return &Failure{Code: code, Message: message}
}

func Success(action string, data any) Envelope {
	return Envelope{
		OK:      true,
		Version: 1,
		Action:  action,
		Data:    data,
	}
}

func Failed(action string, failure *Failure) Envelope {
	return Envelope{
		OK:      false,
		Version: 1,
		Action:  action,
		Error:   failure,
	}
}

func Write(output io.Writer, envelope Envelope) error {
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(true)
	return encoder.Encode(envelope)
}
