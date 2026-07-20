package main

import (
	"context"
	"io"
	"os"

	"github.com/edible999999999-jpg/humhum/native/humhum-wechat/internal/contract"
	"github.com/edible999999999-jpg/humhum/native/humhum-wechat/internal/reader"
	"github.com/edible999999999-jpg/humhum/native/humhum-wechat/internal/source"
)

func main() {
	os.Exit(run(os.Stdin, os.Stdout, os.Stderr, os.Getenv))
}

func run(
	input io.Reader,
	output io.Writer,
	stderr io.Writer,
	getenv func(string) string,
) int {
	request, failure := contract.Decode(input)
	if failure != nil {
		_ = contract.Write(output, contract.Failed("", failure))
		return 2
	}

	data, err := source.Open(request, getenv)
	if err != nil {
		_ = contract.Write(output, reader.Failure(request.Action, err))
		return 3
	}
	defer data.Close()

	envelope := reader.Handle(context.Background(), request, data)
	if err := contract.Write(output, envelope); err != nil {
		_, _ = io.WriteString(stderr, "reader output failed\n")
		return 4
	}
	if !envelope.OK {
		return 3
	}
	return 0
}
