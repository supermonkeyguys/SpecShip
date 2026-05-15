package llm

func IsRetryableError(_ error) bool {
    return false
}
