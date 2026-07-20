// Message-table naming and WCDB row interpretation are derived from
// r266-tech/wechat-cli commit 065778319ca4a77debd265e65df913891d49ad58
// under the MIT license. HUMHUM keeps only bounded read paths.

package source

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/edible999999999-jpg/humhum/native/humhum-wechat/internal/wcdb"
	"github.com/klauspost/compress/zstd"
)

const connectorVersion = "0.1.0"

var (
	messageShardPattern = regexp.MustCompile(`^message_[0-9]+\.db$`)
	messageTablePattern = regexp.MustCompile(`^Msg_[a-f0-9]{32}$`)
	groupSenderPrefix   = regexp.MustCompile(`^\s*[a-zA-Z0-9_@-]+:\s*\r?\n\s*`)
)

const sessionsQuery = `SELECT username, unread_count, summary,
       last_timestamp, sort_timestamp,
       last_msg_sender AS last_sender_wxid,
       last_sender_display_name, last_msg_type, last_msg_sub_type
FROM SessionTable
WHERE COALESCE(is_hidden, 0) = 0
  AND (
    username LIKE '%@chatroom'
    OR (
      username NOT LIKE '%@chatroom'
      AND username NOT LIKE 'gh!_%' ESCAPE '!'
      AND username NOT LIKE '%@openim'
      AND username NOT LIKE '%@weclaw'
      AND username NOT LIKE '%@stranger'
    )
  )
ORDER BY sort_timestamp DESC, username DESC
LIMIT ?`

type accountPaths struct {
	Root         string
	SelfWXID     string
	ContactPath  string
	SessionPath  string
	MessagePaths []string
}

type WcdbSource struct {
	account accountPaths
	build   wechatBuild
	keys    map[string]string
}

type orderedMessage struct {
	Message Message
	SortSeq int64
}

type appMessageXML struct {
	AppMessage struct {
		Title string `xml:"title"`
	} `xml:"appmsg"`
}

func OpenLocal(keys map[string]string) (DataSource, error) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil, &Error{
			Code:    "wechat_not_logged_in",
			Message: "Unable to locate the local WeChat account",
			Cause:   err,
		}
	}
	dataRoot := filepath.Join(
		home,
		"Library",
		"Containers",
		"com.tencent.xinWeChat",
		"Data",
		"Documents",
		"xwechat_files",
	)
	account, err := discoverAccount(dataRoot)
	if err != nil {
		return nil, &Error{
			Code:       "wechat_not_logged_in",
			Message:    "No single active local WeChat account was found",
			NextAction: "Open and sign in to WeChat on this Mac",
			Cause:      err,
		}
	}
	build, err := discoverWeChatBuild("/Applications/WeChat.app")
	if err != nil {
		return nil, &Error{
			Code:       "wechat_not_running",
			Message:    "The supported local WeChat application was not found",
			NextAction: "Install and open WeChat on this Mac",
			Cause:      err,
		}
	}
	libraryPath, err := discoverWCDBLibrary()
	if err != nil {
		return nil, &Error{
			Code:       "wcdb_unavailable",
			Message:    "The bundled WeChat database reader is unavailable",
			NextAction: "Use a HUMHUM build that includes the verified WCDB runtime",
			Cause:      err,
		}
	}
	if err := wcdb.Bootstrap(libraryPath); err != nil {
		return nil, &Error{
			Code:    "wcdb_unavailable",
			Message: "The bundled WeChat database reader could not be loaded",
			Cause:   err,
		}
	}
	return &WcdbSource{
		account: account,
		build:   build,
		keys:    cloneKeys(keys),
	}, nil
}

func (data *WcdbSource) Status(ctx context.Context) (Status, error) {
	if err := ctx.Err(); err != nil {
		return Status{}, err
	}
	covered, total := data.keyCoverage()
	status := Status{
		ConnectorVersion: connectorVersion,
		WeChatBuild:      data.build.PublicFingerprint(),
		Compatibility:    "supported",
		KeyCoverage:      fmt.Sprintf("%d/%d", covered, total),
		WCDBAvailable:    true,
		LiveReadOK:       data.build.Supported() && total > 0 && covered == total,
		Warnings:         []string{},
	}
	if !data.build.Supported() {
		status.Compatibility = "unsupported"
		status.BlockedBy = "unsupported_wechat_build"
		status.NextAction = "Wait for a fixture-backed HUMHUM compatibility update"
	} else if !status.LiveReadOK {
		status.BlockedBy = "key_coverage_incomplete"
		status.NextAction = "Complete one explicit local key setup"
	}
	return status, nil
}

func (data *WcdbSource) Sessions(
	ctx context.Context,
	kinds []ConversationKind,
	limit int,
) ([]Session, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := data.ensureCompatible(); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 || !containsOnlyPrivateAndGroup(kinds) {
		return nil, &Error{Code: "schema_unsupported", Message: "Session request is invalid"}
	}
	database, err := data.open(data.account.SessionPath)
	if err != nil {
		return nil, err
	}
	defer database.Close()
	rows, err := database.Query(sessionsQuery, limit)
	if err != nil {
		return nil, &Error{
			Code:    "schema_unsupported",
			Message: "The local WeChat session schema is unsupported",
			Cause:   err,
		}
	}
	talkers := make([]string, 0, len(rows))
	for _, row := range rows {
		if talker := rowString(row, "username"); talker != "" {
			talkers = append(talkers, talker)
		}
	}
	displayNames := data.loadDisplayNames(talkers)
	sessions := make([]Session, 0, len(rows))
	for _, row := range rows {
		talker := rowString(row, "username")
		if talker == "" {
			continue
		}
		kind := Private
		if strings.HasSuffix(talker, "@chatroom") {
			kind = Group
		}
		sessions = append(sessions, Session{
			Talker:        talker,
			DisplayName:   resolvedDisplayName(talker, kind, displayNames),
			Kind:          kind,
			LastTimestamp: rowInt64(row, "last_timestamp"),
		})
	}
	return sessions, nil
}

func (data *WcdbSource) Timeline(
	ctx context.Context,
	talker string,
	after int64,
	limit int,
) ([]Message, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := data.ensureCompatible(); err != nil {
		return nil, err
	}
	if talker == "" || strings.HasPrefix(talker, "-") || limit < 1 || limit > 100 {
		return nil, &Error{Code: "schema_unsupported", Message: "Timeline request is invalid"}
	}
	tableName := messageTableName(talker)
	if !validMessageTableName(tableName) {
		return nil, &Error{Code: "schema_unsupported", Message: "Message table name is invalid"}
	}
	query := fmt.Sprintf(`SELECT local_id, server_id, local_type, sort_seq,
       real_sender_id, create_time, message_content, source
FROM %s
WHERE create_time >= ?
ORDER BY sort_seq ASC, local_id ASC
LIMIT ?`, tableName)

	ordered := make([]orderedMessage, 0, limit+1)
	foundTable := false
	for _, path := range data.account.MessagePaths {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		database, err := data.open(path)
		if err != nil {
			return nil, err
		}
		exists, err := tableExists(database, tableName)
		if err != nil {
			_ = database.Close()
			return nil, &Error{
				Code:    "schema_unsupported",
				Message: "The local WeChat message schema is unsupported",
				Cause:   err,
			}
		}
		if !exists {
			_ = database.Close()
			continue
		}
		foundTable = true
		senders, err := loadName2ID(database)
		if err != nil {
			_ = database.Close()
			return nil, &Error{
				Code:    "schema_unsupported",
				Message: "The local WeChat sender schema is unsupported",
				Cause:   err,
			}
		}
		rows, err := database.Query(query, after, limit+1)
		_ = database.Close()
		if err != nil {
			return nil, &Error{
				Code:    "schema_unsupported",
				Message: "The local WeChat timeline schema is unsupported",
				Cause:   err,
			}
		}
		for _, row := range rows {
			message, err := normalizeMessageRow(talker, data.account.SelfWXID, senders, row)
			if err != nil {
				continue
			}
			ordered = append(ordered, message)
		}
	}
	if !foundTable {
		return []Message{}, nil
	}
	sort.SliceStable(ordered, func(left, right int) bool {
		if ordered[left].SortSeq == ordered[right].SortSeq {
			return ordered[left].Message.LocalID < ordered[right].Message.LocalID
		}
		return ordered[left].SortSeq < ordered[right].SortSeq
	})
	if len(ordered) > limit {
		ordered = ordered[:limit]
	}
	contactUsernames := make([]string, 0, len(ordered)+1)
	contactUsernames = append(contactUsernames, talker)
	for _, item := range ordered {
		if item.Message.SenderWXID != "" {
			contactUsernames = append(contactUsernames, item.Message.SenderWXID)
		}
	}
	displayNames := data.loadDisplayNames(contactUsernames)
	conversationKind := Private
	if strings.HasSuffix(talker, "@chatroom") {
		conversationKind = Group
	}
	talkerDisplayName := resolvedDisplayName(talker, conversationKind, displayNames)
	messages := make([]Message, len(ordered))
	for index := range ordered {
		message := ordered[index].Message
		switch {
		case message.SenderWXID == data.account.SelfWXID:
			message.Sender = "我"
		case displayNames[message.SenderWXID] != "":
			message.Sender = displayNames[message.SenderWXID]
		case conversationKind == Group:
			message.Sender = "群成员"
		default:
			message.Sender = talkerDisplayName
		}
		messages[index] = message
	}
	return messages, nil
}

func (data *WcdbSource) Close() error {
	for salt := range data.keys {
		data.keys[salt] = strings.Repeat("0", len(data.keys[salt]))
		delete(data.keys, salt)
	}
	return nil
}

func (data *WcdbSource) open(path string) (*wcdb.DB, error) {
	database, err := wcdb.OpenAccount(data.account.Root, path, data.keys)
	if err == nil {
		return database, nil
	}
	switch {
	case errors.Is(err, wcdb.ErrKeyUnavailable):
		return nil, &Error{
			Code:       "key_coverage_incomplete",
			Message:    "A local WeChat database key is missing",
			NextAction: "Refresh keys with one explicit local setup",
			Cause:      err,
		}
	case errors.Is(err, wcdb.ErrKeyInvalid):
		return nil, &Error{
			Code:       "key_validation_failed",
			Message:    "A local WeChat database key no longer validates",
			NextAction: "Refresh keys after confirming WeChat is running",
			Cause:      err,
		}
	default:
		return nil, &Error{
			Code:    "schema_unsupported",
			Message: "A local WeChat database could not be opened safely",
			Cause:   err,
		}
	}
}

func (data *WcdbSource) ensureCompatible() error {
	if data.build.Supported() {
		return nil
	}
	return &Error{
		Code:       "unsupported_wechat_build",
		Message:    "This WeChat build has not passed fixture compatibility checks",
		NextAction: "Wait for a HUMHUM compatibility update",
	}
}

func (data *WcdbSource) keyCoverage() (int, int) {
	paths := append([]string{data.account.SessionPath}, data.account.MessagePaths...)
	covered := 0
	for _, path := range paths {
		salt, err := wcdb.ReadSaltHex(path)
		if err != nil {
			continue
		}
		if _, exists := data.keys[salt]; exists {
			covered++
		}
	}
	return covered, len(paths)
}

func discoverAccount(root string) (accountPaths, error) {
	info, err := os.Lstat(root)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return accountPaths{}, errors.New("WeChat account root is unavailable")
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return accountPaths{}, errors.New("resolve WeChat account root")
	}
	entries, err := os.ReadDir(canonicalRoot)
	if err != nil {
		return accountPaths{}, errors.New("read WeChat account root")
	}
	candidates := make([]accountPaths, 0, 1)
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		accountRoot := filepath.Join(canonicalRoot, entry.Name())
		contactPath := filepath.Join(accountRoot, "db_storage", "contact", "contact.db")
		sessionPath := filepath.Join(accountRoot, "db_storage", "session", "session.db")
		messageDirectory := filepath.Join(accountRoot, "db_storage", "message")
		if !regularFile(sessionPath) || !realDirectory(messageDirectory) {
			continue
		}
		messageEntries, err := os.ReadDir(messageDirectory)
		if err != nil {
			continue
		}
		messagePaths := make([]string, 0)
		for _, messageEntry := range messageEntries {
			if messageEntry.Type()&os.ModeSymlink != 0 ||
				!messageEntry.Type().IsRegular() ||
				!messageShardPattern.MatchString(messageEntry.Name()) {
				continue
			}
			messagePaths = append(messagePaths, filepath.Join(messageDirectory, messageEntry.Name()))
		}
		if len(messagePaths) == 0 {
			continue
		}
		sort.Strings(messagePaths)
		candidates = append(candidates, accountPaths{
			Root:         accountRoot,
			SelfWXID:     entry.Name(),
			ContactPath:  contactPath,
			SessionPath:  sessionPath,
			MessagePaths: messagePaths,
		})
	}
	if len(candidates) != 1 {
		return accountPaths{}, fmt.Errorf("found %d active account roots", len(candidates))
	}
	return candidates[0], nil
}

func (data *WcdbSource) loadDisplayNames(usernames []string) map[string]string {
	if !regularFile(data.account.ContactPath) || len(usernames) == 0 {
		return nil
	}
	unique := make(map[string]bool, len(usernames))
	for _, username := range usernames {
		if username != "" {
			unique[username] = true
		}
	}
	if len(unique) == 0 {
		return nil
	}
	database, err := data.open(data.account.ContactPath)
	if err != nil {
		return nil
	}
	defer database.Close()
	placeholders := make([]string, 0, len(unique))
	arguments := make([]any, 0, len(unique))
	for username := range unique {
		placeholders = append(placeholders, "?")
		arguments = append(arguments, username)
	}
	rows, err := database.Query(
		fmt.Sprintf(
			`SELECT username, remark, nick_name FROM contact WHERE username IN (%s)`,
			strings.Join(placeholders, ","),
		),
		arguments...,
	)
	if err != nil {
		return nil
	}
	return contactDisplayNames(rows)
}

func contactDisplayNames(rows []wcdb.Row) map[string]string {
	names := make(map[string]string, len(rows))
	for _, row := range rows {
		username := strings.TrimSpace(rowString(row, "username"))
		if username == "" {
			continue
		}
		name := strings.TrimSpace(rowString(row, "remark"))
		if name == "" {
			name = strings.TrimSpace(rowString(row, "nick_name"))
		}
		if name != "" && name != username && len([]rune(name)) <= 160 {
			names[username] = name
		}
	}
	return names
}

func resolvedDisplayName(
	username string,
	kind ConversationKind,
	names map[string]string,
) string {
	if name := strings.TrimSpace(names[username]); name != "" && name != username {
		return name
	}
	if kind == Group || strings.HasSuffix(username, "@chatroom") {
		return "未命名群聊"
	}
	return "微信联系人"
}

func discoverWCDBLibrary() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", errors.New("locate reader executable")
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return "", errors.New("resolve reader executable")
	}
	candidates := []string{
		filepath.Clean(filepath.Join(
			filepath.Dir(executable),
			"..",
			"Resources",
			"wechat",
			"libWCDB.dylib",
		)),
		filepath.Clean(filepath.Join(
			filepath.Dir(executable),
			"..",
			"resources",
			"wechat",
			"libWCDB.dylib",
		)),
		filepath.Join(filepath.Dir(executable), "wechat", "libWCDB.dylib"),
	}
	for _, candidate := range candidates {
		if regularFile(candidate) {
			return candidate, nil
		}
	}
	return "", errors.New("bundled WCDB library not found")
}

func messageTableName(talker string) string {
	hash := md5.Sum([]byte(talker))
	return "Msg_" + hex.EncodeToString(hash[:])
}

func validMessageTableName(name string) bool {
	return messageTablePattern.MatchString(name)
}

func tableExists(database *wcdb.DB, tableName string) (bool, error) {
	rows, err := database.Query(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
		tableName,
	)
	return len(rows) == 1, err
}

func loadName2ID(database *wcdb.DB) (map[int64]string, error) {
	rows, err := database.Query("SELECT rowid AS rid, user_name FROM Name2Id")
	if err != nil {
		return nil, err
	}
	senders := make(map[int64]string, len(rows))
	for _, row := range rows {
		identifier := rowInt64(row, "rid")
		username := rowString(row, "user_name")
		if identifier != 0 && username != "" {
			senders[identifier] = username
		}
	}
	return senders, nil
}

func normalizeMessageRow(
	talker string,
	selfWXID string,
	senders map[int64]string,
	row wcdb.Row,
) (orderedMessage, error) {
	localID := rowInt64(row, "local_id")
	timestamp := rowInt64(row, "create_time")
	if localID == 0 || timestamp <= 0 {
		return orderedMessage{}, errors.New("message identity is incomplete")
	}
	senderWXID := senders[rowInt64(row, "real_sender_id")]
	baseKind, subtype, kind := unpackMessageType(rowInt64(row, "local_type"))
	content := decodeMessageContent(row["message_content"])
	text := summarizeMessage(baseKind, subtype, content)
	serverID := ""
	if value := rowInt64(row, "server_id"); value != 0 {
		serverID = strconv.FormatInt(value, 10)
	}
	sender := senderWXID
	if sender == "" {
		sender = talker
	}
	return orderedMessage{
		SortSeq: rowInt64(row, "sort_seq"),
		Message: Message{
			Talker:     talker,
			LocalID:    localID,
			ServerID:   serverID,
			Timestamp:  timestamp,
			Sender:     sender,
			SenderWXID: senderWXID,
			Incoming:   senderWXID != "" && senderWXID != selfWXID,
			Kind:       kind,
			Text:       text,
		},
	}, nil
}

func unpackMessageType(localType int64) (int32, int32, string) {
	baseKind := int32(localType & 0xffffffff)
	subtype := int32(localType >> 32)
	if baseKind == 49 {
		switch subtype {
		case 5, 49:
			return baseKind, subtype, "link"
		case 6, 8, 24:
			return baseKind, subtype, "file"
		case 33, 36:
			return baseKind, subtype, "miniprogram"
		case 57:
			return baseKind, subtype, "quote"
		}
	}
	names := map[int32]string{
		1: "text", 3: "image", 34: "voice", 42: "card", 43: "video",
		47: "sticker", 48: "location", 49: "app", 50: "voip", 10000: "system",
	}
	if name := names[baseKind]; name != "" {
		return baseKind, subtype, name
	}
	return baseKind, subtype, "unknown"
}

func summarizeMessage(baseKind, subtype int32, content string) string {
	switch baseKind {
	case 1, 10000:
		return groupSenderPrefix.ReplaceAllString(content, "")
	case 3:
		return "[图片]"
	case 34:
		return "[语音]"
	case 42:
		return "[名片]"
	case 43:
		return "[视频]"
	case 47:
		return "[表情]"
	case 48:
		return "[位置]"
	case 49:
		title := appMessageTitle(content)
		switch subtype {
		case 5, 49:
			return withTitle("[链接]", title)
		case 6, 8, 24:
			return withTitle("[文件]", title)
		case 33, 36:
			return withTitle("[小程序]", title)
		case 57:
			return withTitle("[引用]", title)
		default:
			return withTitle("[应用消息]", title)
		}
	case 50:
		return "[通话]"
	default:
		return "[非文本消息]"
	}
}

func appMessageTitle(content string) string {
	var message appMessageXML
	if err := xml.Unmarshal([]byte(content), &message); err != nil {
		return ""
	}
	return strings.TrimSpace(message.AppMessage.Title)
}

func withTitle(prefix, title string) string {
	if title == "" {
		return prefix
	}
	return prefix + " " + title
}

func decodeMessageContent(value any) string {
	switch typed := value.(type) {
	case string:
		if strings.HasPrefix(typed, "KLUv/") {
			raw, err := base64.StdEncoding.DecodeString(typed)
			if err == nil {
				if decoded := decodeZstd(raw); decoded != "" {
					return decoded
				}
			}
		}
		return typed
	case []byte:
		if decoded := decodeZstd(typed); decoded != "" {
			return decoded
		}
		return string(typed)
	default:
		return ""
	}
}

func decodeZstd(raw []byte) string {
	if len(raw) < 4 || raw[0] != 0x28 || raw[1] != 0xb5 || raw[2] != 0x2f || raw[3] != 0xfd {
		return ""
	}
	decoder, err := zstd.NewReader(nil, zstd.WithDecoderConcurrency(1))
	if err != nil {
		return ""
	}
	defer decoder.Close()
	decoded, err := decoder.DecodeAll(raw, nil)
	if err != nil {
		return ""
	}
	return string(decoded)
}

func containsOnlyPrivateAndGroup(kinds []ConversationKind) bool {
	if len(kinds) != 2 {
		return false
	}
	return kinds[0] == Private && kinds[1] == Group
}

func rowString(row wcdb.Row, key string) string {
	value, _ := row[key].(string)
	return value
}

func rowInt64(row wcdb.Row, key string) int64 {
	switch value := row[key].(type) {
	case int64:
		return value
	case int:
		return int64(value)
	default:
		return 0
	}
}

func regularFile(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode()&os.ModeSymlink == 0 && info.Mode().IsRegular()
}

func realDirectory(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode()&os.ModeSymlink == 0 && info.IsDir()
}

func cloneKeys(keys map[string]string) map[string]string {
	cloned := make(map[string]string, len(keys))
	for salt, key := range keys {
		cloned[salt] = key
	}
	return cloned
}
