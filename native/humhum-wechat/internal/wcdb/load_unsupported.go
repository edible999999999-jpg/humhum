//go:build !darwin

package wcdb

import "errors"

func loadLibrary(string) (uintptr, error) {
	return 0, errors.New("WCDB loading is supported only on macOS")
}
