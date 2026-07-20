package source

func OpenLocal(_ map[string]string) (DataSource, error) {
	return nil, &Error{
		Code:       "wcdb_unavailable",
		Message:    "The bundled WeChat database reader is unavailable",
		NextAction: "Install a build that includes the verified WCDB runtime",
	}
}
