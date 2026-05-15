package llm

import (
    "bytes"
    "context"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "strings"
    "time"
)

type ToolDef struct {
    Name string
}

type ToolExecution struct {
    Tool     string
    Success  bool
    Output   string
    FilePath string
}

type RunInput struct {
    SystemPrompt string
    UserPrompt   string
    Model        string
    Tools        []ToolDef
    WithTools    bool
}

type RunOutput struct {
    FinalText      string
    ToolExecutions []ToolExecution
    TokensUsed     int
}

type Client interface {
    Run(ctx context.Context, in RunInput) (*RunOutput, error)
}

type Config struct {
    BaseURL string
    APIKey  string
    Timeout time.Duration
}

type OpenAICompatibleClient struct {
    baseURL    string
    apiKey     string
    httpClient *http.Client
}

func NewOpenAICompatibleClient(cfg Config) *OpenAICompatibleClient {
    timeout := cfg.Timeout
    if timeout <= 0 {
        timeout = 60 * time.Second
    }
    return &OpenAICompatibleClient{
        baseURL: strings.TrimRight(cfg.BaseURL, "/"),
        apiKey:  cfg.APIKey,
        httpClient: &http.Client{
            Timeout: timeout,
        },
    }
}

type chatCompletionsRequest struct {
    Model    string              `json:"model"`
    Messages []chatMessage       `json:"messages"`
    MaxTokens int                `json:"max_tokens,omitempty"`
}

type chatMessage struct {
    Role    string `json:"role"`
    Content string `json:"content"`
}

type chatCompletionsResponse struct {
    Choices []struct {
        Message struct {
            Content string `json:"content"`
        } `json:"message"`
    } `json:"choices"`
    Usage struct {
        TotalTokens int `json:"total_tokens"`
    } `json:"usage"`
}

func (c *OpenAICompatibleClient) Run(ctx context.Context, in RunInput) (*RunOutput, error) {
    if c.apiKey == "" {
        return nil, fmt.Errorf("llm api key is empty")
    }
    if in.Model == "" {
        return nil, fmt.Errorf("llm model is required")
    }

    reqBody := chatCompletionsRequest{
        Model: in.Model,
        Messages: []chatMessage{
            {Role: "system", Content: in.SystemPrompt},
            {Role: "user", Content: in.UserPrompt},
        },
        MaxTokens: 4096,
    }

    body, err := json.Marshal(reqBody)
    if err != nil {
        return nil, err
    }

    req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
    if err != nil {
        return nil, err
    }
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Authorization", "Bearer "+c.apiKey)

    resp, err := c.httpClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    raw, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, err
    }
    if resp.StatusCode < 200 || resp.StatusCode >= 300 {
        return nil, fmt.Errorf("llm api %d: %s", resp.StatusCode, string(raw))
    }

    var parsed chatCompletionsResponse
    if err := json.Unmarshal(raw, &parsed); err != nil {
        return nil, err
    }
    if len(parsed.Choices) == 0 {
        return nil, fmt.Errorf("llm returned no choices")
    }

    return &RunOutput{
        FinalText:      parsed.Choices[0].Message.Content,
        ToolExecutions: nil,
        TokensUsed:     parsed.Usage.TotalTokens,
    }, nil
}
