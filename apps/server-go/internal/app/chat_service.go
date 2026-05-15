package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/infra/llm"
)

type ChatService struct {
	Client llm.Client
	Model  string
}

type ChatNodeContext struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

type ChatIntent struct {
	Type     string `json:"type"`
	NodeID   string `json:"nodeId,omitempty"`
	Spec     string `json:"spec,omitempty"`
	RepoPath string `json:"repoPath,omitempty"`
	Reply    string `json:"reply"`
}

type ChatInput struct {
	Message      string            `json:"message"`
	CurrentSpec  string            `json:"currentSpec,omitempty"`
	CurrentNodes []ChatNodeContext `json:"currentNodes,omitempty"`
}

type ChatOutput struct {
	OK     bool       `json:"ok"`
	Intent ChatIntent `json:"intent"`
	Error  string     `json:"error,omitempty"`
}

const chatIntentPrompt = `
You are the AI assistant for Shipyard.

Given the user's message and current task context, output ONLY a JSON object:
{
  "type": "retry_node" | "new_run" | "resume" | "status" | "unknown",
  "nodeId": "<node id if retry_node>",
  "spec": "<full spec string if new_run>",
  "repoPath": "<repo path if provided>",
  "reply": "<helpful reply in the same language as the user>"
}

Rules:
- retry_node only when the user explicitly asks to retry a node and the node id exists in context.
- new_run only when the user clearly wants to start or restart work.
- resume only when the user clearly asks to continue paused work.
- status only for asking progress.
- Otherwise use unknown and answer helpfully.
- Output JSON only.
`

func (s *ChatService) Route(ctx context.Context, in ChatInput) (*ChatOutput, error) {
	message := strings.TrimSpace(in.Message)
	if message == "" {
		return &ChatOutput{OK: false, Intent: ChatIntent{Type: "unknown", Reply: "Empty message"}, Error: "message is required"}, nil
	}

	if intent := routeIntentDeterministically(in); intent != nil {
		return &ChatOutput{OK: true, Intent: *intent}, nil
	}

	if s.Client == nil || strings.TrimSpace(s.Model) == "" {
		return &ChatOutput{OK: true, Intent: ChatIntent{Type: "unknown", Reply: fallbackReply(message)}}, nil
	}

	prompt := buildChatPrompt(in)
	out, err := s.Client.Run(ctx, llm.RunInput{
		SystemPrompt: chatIntentPrompt,
		UserPrompt:   prompt,
		Model:        s.Model,
		WithTools:    false,
	})
	if err != nil {
		return &ChatOutput{OK: false, Intent: ChatIntent{Type: "unknown", Reply: fallbackReply(message)}, Error: err.Error()}, nil
	}

	intent, err := parseChatIntent(out.FinalText)
	if err != nil {
		return &ChatOutput{OK: false, Intent: ChatIntent{Type: "unknown", Reply: fallbackReply(message)}, Error: err.Error()}, nil
	}
	if strings.TrimSpace(intent.Reply) == "" {
		intent.Reply = fallbackReply(message)
	}
	if intent.Type == "" {
		intent.Type = "unknown"
	}
	return &ChatOutput{OK: true, Intent: *intent}, nil
}

func routeIntentDeterministically(in ChatInput) *ChatIntent {
	lower := strings.ToLower(strings.TrimSpace(in.Message))
	if lower == "" {
		return nil
	}

	if isResumeMessage(lower) {
		return &ChatIntent{Type: "resume", Reply: "继续执行当前任务。"}
	}
	if isStatusMessage(lower) {
		return &ChatIntent{Type: "status", Reply: "你可以查看当前节点状态、日志和验证结果。"}
	}

	for _, node := range in.CurrentNodes {
		nodeIDLower := strings.ToLower(node.ID)
		if strings.Contains(lower, "retry") || strings.Contains(lower, "重试") || strings.Contains(lower, "重跑") {
			if strings.Contains(lower, nodeIDLower) {
				return &ChatIntent{Type: "retry_node", NodeID: node.ID, Reply: fmt.Sprintf("准备重试节点 %s。", node.ID)}
			}
		}
	}

	if looksLikeNewRun(lower) {
		return &ChatIntent{Type: "new_run", Spec: strings.TrimSpace(in.Message), Reply: "我会按这个需求启动一个新的任务。"}
	}
	return nil
}

func isResumeMessage(lower string) bool {
	for _, token := range []string{"resume", "继续", "恢复", "继续执行"} {
		if strings.Contains(lower, token) {
			return true
		}
	}
	return false
}

func isStatusMessage(lower string) bool {
	for _, token := range []string{"status", "progress", "how is it going", "状态", "进度", "现在到哪了"} {
		if strings.Contains(lower, token) {
			return true
		}
	}
	return false
}

func looksLikeNewRun(lower string) bool {
	for _, token := range []string{"build ", "create ", "make ", "implement ", "帮我做", "做一个", "新任务", "开始做"} {
		if strings.Contains(lower, token) {
			return true
		}
	}
	return false
}

func buildChatPrompt(in ChatInput) string {
	parts := make([]string, 0, 4+len(in.CurrentNodes))
	if strings.TrimSpace(in.CurrentSpec) != "" {
		parts = append(parts, "Current spec: "+strings.TrimSpace(in.CurrentSpec))
	}
	if len(in.CurrentNodes) > 0 {
		parts = append(parts, "Current nodes:")
		for _, node := range in.CurrentNodes {
			parts = append(parts, fmt.Sprintf("- %s (%s): %s", node.ID, node.Title, node.Status))
		}
	}
	parts = append(parts, "User message: "+strings.TrimSpace(in.Message))
	return strings.Join(parts, "\n")
}

func parseChatIntent(text string) (*ChatIntent, error) {
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("chat response did not contain JSON object")
	}
	var intent ChatIntent
	if err := json.Unmarshal([]byte(text[start:end+1]), &intent); err != nil {
		return nil, err
	}
	return &intent, nil
}

func fallbackReply(message string) string {
	if containsChinese(message) {
		return "我已收到你的消息。如果你想开始新任务，请直接描述需求；如果你想继续或重试，请明确说 resume 或指定节点。"
	}
	return "I got your message. If you want to start a new run, describe the task; if you want to continue or retry, say resume or specify the node."
}

func containsChinese(s string) bool {
	for _, r := range s {
		if r >= 0x4e00 && r <= 0x9fff {
			return true
		}
	}
	return false
}
