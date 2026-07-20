package source

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"io"
	"os"
	"path/filepath"
)

var supportedWechatBuilds = map[string]bool{
	"4.0.6:a15e701c68cb45aa1c98a631c49eb974d9cd9bff6ae59f16d1a487f202957b98": true,
}

type wechatBuild struct {
	Version string
	SHA256  string
}

func (build wechatBuild) Supported() bool {
	return supportedWechatBuilds[build.Version+":"+build.SHA256]
}

func (build wechatBuild) PublicFingerprint() string {
	if len(build.SHA256) < 12 {
		return build.Version
	}
	return build.Version + ":" + build.SHA256[:12]
}

func discoverWeChatBuild(applicationPath string) (wechatBuild, error) {
	info, err := os.Lstat(applicationPath)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return wechatBuild{}, errors.New("WeChat application is unavailable")
	}
	infoPath := filepath.Join(applicationPath, "Contents", "Info.plist")
	executablePath := filepath.Join(applicationPath, "Contents", "MacOS", "WeChat")
	version, err := plistString(infoPath, "CFBundleShortVersionString")
	if err != nil || version == "" {
		return wechatBuild{}, errors.New("read WeChat version")
	}
	executable, err := os.Open(executablePath)
	if err != nil {
		return wechatBuild{}, errors.New("open WeChat executable")
	}
	defer executable.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, executable); err != nil {
		return wechatBuild{}, errors.New("hash WeChat executable")
	}
	return wechatBuild{
		Version: version,
		SHA256:  hex.EncodeToString(hash.Sum(nil)),
	}, nil
}

func plistString(path, targetKey string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	decoder := xml.NewDecoder(file)
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return "", errors.New("plist key not found")
		}
		if err != nil {
			return "", err
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "key" {
			continue
		}
		var key string
		if err := decoder.DecodeElement(&key, &start); err != nil {
			return "", err
		}
		if key != targetKey {
			continue
		}
		for {
			valueToken, err := decoder.Token()
			if err != nil {
				return "", err
			}
			valueStart, ok := valueToken.(xml.StartElement)
			if !ok {
				continue
			}
			if valueStart.Name.Local != "string" {
				return "", errors.New("plist value is not a string")
			}
			var value string
			if err := decoder.DecodeElement(&value, &valueStart); err != nil {
				return "", err
			}
			return value, nil
		}
	}
}
