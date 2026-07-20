// Portions derived from r266-tech/wechat-cli commit
// 065778319ca4a77debd265e65df913891d49ad58 (MIT).
// HUMHUM intentionally retains only read-only open, query, and close paths.

package wcdb

import (
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"unsafe"

	"github.com/ebitengine/purego"
)

var (
	ErrKeyUnavailable = errors.New("database key is unavailable")
	ErrKeyInvalid     = errors.New("database key validation failed")
)

const (
	sqliteOK            = 0
	sqliteRow           = 100
	sqliteDone          = 101
	sqliteOpenReadOnly  = 0x00000001
	sqliteOpenNoMutex   = 0x00008000
	columnInteger       = 1
	columnFloat         = 2
	columnText          = 3
	columnBlob          = 4
	columnNull          = 5
	sqliteTransient     = ^uintptr(0)
	maxCStringBytes     = 1_048_576
	sqliteMasterProbe   = "SELECT count(*) AS table_count FROM sqlite_master"
	queryOnlyPragma     = "PRAGMA query_only = ON"
	pragmaTableInfoLead = "PRAGMA TABLE_INFO("
)

var (
	libraryMutex sync.Mutex
	loadedPath   string

	sqlite3OpenV2       func(filename string, database *uintptr, flags int32, vfs *byte) int32
	sqlite3CloseV2      func(database uintptr) int32
	sqlite3KeyV2        func(database uintptr, schema string, key unsafe.Pointer, keyLength int32) int32
	sqlite3PrepareV2    func(database uintptr, sql string, sqlLength int32, statement *uintptr, tail *uintptr) int32
	sqlite3Step         func(statement uintptr) int32
	sqlite3Finalize     func(statement uintptr) int32
	sqlite3ColumnCount  func(statement uintptr) int32
	sqlite3ColumnName   func(statement uintptr, index int32) unsafe.Pointer
	sqlite3ColumnText   func(statement uintptr, index int32) unsafe.Pointer
	sqlite3ColumnInt64  func(statement uintptr, index int32) int64
	sqlite3ColumnDouble func(statement uintptr, index int32) float64
	sqlite3ColumnBytes  func(statement uintptr, index int32) int32
	sqlite3ColumnBlob   func(statement uintptr, index int32) unsafe.Pointer
	sqlite3ColumnType   func(statement uintptr, index int32) int32
	sqlite3BindText     func(statement uintptr, index int32, value string, length int32, destructor uintptr) int32
	sqlite3BindBlob     func(statement uintptr, index int32, value unsafe.Pointer, length int32, destructor uintptr) int32
	sqlite3BindInt64    func(statement uintptr, index int32, value int64) int32
	sqlite3BindNull     func(statement uintptr, index int32) int32
	sqlite3Errmsg       func(database uintptr) unsafe.Pointer
)

type Row map[string]any

type DB struct {
	handle uintptr
}

func Bootstrap(dylibPath string) error {
	canonicalPath, err := canonicalRegularFile(dylibPath)
	if err != nil {
		return fmt.Errorf("invalid WCDB library: %w", err)
	}

	libraryMutex.Lock()
	defer libraryMutex.Unlock()
	if loadedPath != "" {
		if loadedPath != canonicalPath {
			return errors.New("a different WCDB library is already loaded")
		}
		return nil
	}

	handle, err := loadLibrary(canonicalPath)
	if err != nil {
		return fmt.Errorf("load WCDB library: %w", err)
	}
	for _, registration := range []struct {
		target any
		name   string
	}{
		{&sqlite3OpenV2, "sqlite3_open_v2"},
		{&sqlite3CloseV2, "sqlite3_close_v2"},
		{&sqlite3KeyV2, "sqlite3_key_v2"},
		{&sqlite3PrepareV2, "sqlite3_prepare_v2"},
		{&sqlite3Step, "sqlite3_step"},
		{&sqlite3Finalize, "sqlite3_finalize"},
		{&sqlite3ColumnCount, "sqlite3_column_count"},
		{&sqlite3ColumnName, "sqlite3_column_name"},
		{&sqlite3ColumnText, "sqlite3_column_text"},
		{&sqlite3ColumnInt64, "sqlite3_column_int64"},
		{&sqlite3ColumnDouble, "sqlite3_column_double"},
		{&sqlite3ColumnBytes, "sqlite3_column_bytes"},
		{&sqlite3ColumnBlob, "sqlite3_column_blob"},
		{&sqlite3ColumnType, "sqlite3_column_type"},
		{&sqlite3BindText, "sqlite3_bind_text"},
		{&sqlite3BindBlob, "sqlite3_bind_blob"},
		{&sqlite3BindInt64, "sqlite3_bind_int64"},
		{&sqlite3BindNull, "sqlite3_bind_null"},
		{&sqlite3Errmsg, "sqlite3_errmsg"},
	} {
		purego.RegisterLibFunc(registration.target, handle, registration.name)
	}
	loadedPath = canonicalPath
	return nil
}

func OpenAccount(root, databasePath string, keys map[string]string) (*DB, error) {
	path, err := CanonicalContainedFile(root, databasePath)
	if err != nil {
		return nil, err
	}
	saltHex, err := ReadSaltHex(path)
	if err != nil {
		return nil, err
	}
	keyHex, exists := keys[saltHex]
	if !exists {
		return nil, ErrKeyUnavailable
	}
	if err := validateKeyMapEntry(saltHex, keyHex); err != nil {
		return nil, err
	}
	return openWithKey(path, keyHex, saltHex)
}

func ReadSaltHex(databasePath string) (string, error) {
	path, err := canonicalRegularFile(databasePath)
	if err != nil {
		return "", fmt.Errorf("invalid database file: %w", err)
	}
	file, err := os.Open(path)
	if err != nil {
		return "", errors.New("open database header")
	}
	defer file.Close()
	salt := make([]byte, 16)
	if _, err := io.ReadFull(file, salt); err != nil {
		return "", errors.New("read database salt")
	}
	return hex.EncodeToString(salt), nil
}

func CanonicalContainedFile(root, path string) (string, error) {
	rootInfo, err := os.Lstat(root)
	if err != nil {
		return "", errors.New("inspect database root")
	}
	if rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir() {
		return "", errors.New("database root must be a real directory")
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", errors.New("resolve database root")
	}
	canonicalPath, err := canonicalRegularFile(path)
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(canonicalRoot, canonicalPath)
	if err != nil || relative == ".." ||
		strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return "", errors.New("database path escapes account root")
	}
	return canonicalPath, nil
}

func (database *DB) Query(sql string, args ...any) ([]Row, error) {
	if database == nil || database.handle == 0 {
		return nil, errors.New("query on closed database")
	}
	if err := validateQuerySQL(sql); err != nil {
		return nil, err
	}
	var statement uintptr
	if code := sqlite3PrepareV2(database.handle, sql, -1, &statement, nil); code != sqliteOK {
		return nil, fmt.Errorf("prepare read query: %s", databaseError(database.handle))
	}
	defer sqlite3Finalize(statement)
	if err := bindArguments(statement, args); err != nil {
		return nil, err
	}

	columnCount := sqlite3ColumnCount(statement)
	names := make([]string, columnCount)
	for index := int32(0); index < columnCount; index++ {
		names[index] = readCString(sqlite3ColumnName(statement, index))
	}

	rows := make([]Row, 0)
	for {
		code := sqlite3Step(statement)
		if code == sqliteDone {
			return rows, nil
		}
		if code != sqliteRow {
			return nil, fmt.Errorf("step read query: %s", databaseError(database.handle))
		}
		row := make(Row, columnCount)
		for index := int32(0); index < columnCount; index++ {
			row[names[index]] = readColumn(statement, index)
		}
		rows = append(rows, row)
	}
}

func (database *DB) Close() error {
	if database == nil || database.handle == 0 {
		return nil
	}
	code := sqlite3CloseV2(database.handle)
	database.handle = 0
	if code != sqliteOK {
		return errors.New("close database")
	}
	return nil
}

func openWithKey(path, keyHex, saltHex string) (*DB, error) {
	libraryMutex.Lock()
	isLoaded := loadedPath != ""
	libraryMutex.Unlock()
	if !isLoaded {
		return nil, errors.New("WCDB library is not loaded")
	}

	keyBlob := []byte("x'" + keyHex + saltHex + "'")
	defer zeroBytes(keyBlob)
	var handle uintptr
	flags := int32(sqliteOpenReadOnly | sqliteOpenNoMutex)
	if code := sqlite3OpenV2(path, &handle, flags, nil); code != sqliteOK {
		message := databaseError(handle)
		if handle != 0 {
			_ = sqlite3CloseV2(handle)
		}
		return nil, fmt.Errorf("open database read-only: %s", message)
	}
	if code := sqlite3KeyV2(
		handle,
		"main",
		unsafe.Pointer(unsafe.SliceData(keyBlob)),
		int32(len(keyBlob)),
	); code != sqliteOK {
		_ = sqlite3CloseV2(handle)
		return nil, errors.New("apply database key")
	}
	runtime.KeepAlive(keyBlob)

	database := &DB{handle: handle}
	if err := database.enableQueryOnly(); err != nil {
		_ = database.Close()
		return nil, err
	}
	if _, err := database.Query(sqliteMasterProbe); err != nil {
		_ = database.Close()
		return nil, ErrKeyInvalid
	}
	return database, nil
}

func (database *DB) enableQueryOnly() error {
	var statement uintptr
	if code := sqlite3PrepareV2(
		database.handle,
		queryOnlyPragma,
		-1,
		&statement,
		nil,
	); code != sqliteOK {
		return errors.New("prepare query-only mode")
	}
	defer sqlite3Finalize(statement)
	code := sqlite3Step(statement)
	if code != sqliteDone && code != sqliteRow {
		return errors.New("enable query-only mode")
	}
	return nil
}

func validateQuerySQL(sql string) error {
	trimmed := strings.TrimSpace(sql)
	upper := strings.ToUpper(trimmed)
	if strings.Contains(trimmed, ";") || strings.HasPrefix(trimmed, "--") ||
		strings.HasPrefix(trimmed, "/*") {
		return errors.New("read query contains forbidden syntax")
	}
	if strings.HasPrefix(upper, "SELECT ") ||
		(strings.HasPrefix(upper, pragmaTableInfoLead) && strings.HasSuffix(trimmed, ")")) {
		return nil
	}
	return errors.New("only fixed read queries are allowed")
}

func validateKeyMapEntry(saltHex, keyHex string) error {
	if !isLowerHex(saltHex, 32) || !isLowerHex(keyHex, 64) {
		return errors.New("database key map entry is invalid")
	}
	return nil
}

func isLowerHex(value string, expectedLength int) bool {
	if len(value) != expectedLength {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') &&
			(character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func canonicalRegularFile(path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", errors.New("inspect file")
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return "", errors.New("path must be a regular file")
	}
	canonicalPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", errors.New("resolve file")
	}
	return canonicalPath, nil
}

func bindArguments(statement uintptr, args []any) error {
	for offset, argument := range args {
		index := int32(offset + 1)
		var code int32
		switch value := argument.(type) {
		case nil:
			code = sqlite3BindNull(statement, index)
		case string:
			code = sqlite3BindText(statement, index, value, int32(len(value)), sqliteTransient)
		case []byte:
			if len(value) == 0 {
				code = sqlite3BindBlob(statement, index, nil, 0, sqliteTransient)
			} else {
				code = sqlite3BindBlob(
					statement,
					index,
					unsafe.Pointer(unsafe.SliceData(value)),
					int32(len(value)),
					sqliteTransient,
				)
				runtime.KeepAlive(value)
			}
		case int:
			code = sqlite3BindInt64(statement, index, int64(value))
		case int32:
			code = sqlite3BindInt64(statement, index, int64(value))
		case int64:
			code = sqlite3BindInt64(statement, index, value)
		case bool:
			bound := int64(0)
			if value {
				bound = 1
			}
			code = sqlite3BindInt64(statement, index, bound)
		default:
			return fmt.Errorf("unsupported read bind type %T", argument)
		}
		if code != sqliteOK {
			return errors.New("bind read query argument")
		}
	}
	return nil
}

func readColumn(statement uintptr, index int32) any {
	switch sqlite3ColumnType(statement, index) {
	case columnInteger:
		return sqlite3ColumnInt64(statement, index)
	case columnFloat:
		return sqlite3ColumnDouble(statement, index)
	case columnText:
		return readCString(sqlite3ColumnText(statement, index))
	case columnBlob:
		length := sqlite3ColumnBytes(statement, index)
		if length <= 0 {
			return []byte{}
		}
		pointer := sqlite3ColumnBlob(statement, index)
		value := make([]byte, int(length))
		copy(value, unsafe.Slice((*byte)(pointer), int(length)))
		return value
	case columnNull:
		return nil
	default:
		return nil
	}
}

func readCString(pointer unsafe.Pointer) string {
	if pointer == nil {
		return ""
	}
	length := 0
	for length < maxCStringBytes && *(*byte)(unsafe.Add(pointer, length)) != 0 {
		length++
	}
	if length == 0 {
		return ""
	}
	return string(unsafe.Slice((*byte)(pointer), length))
}

func databaseError(handle uintptr) string {
	if handle == 0 {
		return "unavailable"
	}
	message := readCString(sqlite3Errmsg(handle))
	if message == "" {
		return "unavailable"
	}
	return message
}

func zeroBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
	runtime.KeepAlive(value)
}
