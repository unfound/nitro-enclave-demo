package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

const defaultURL = "http://localhost:8080/v1/chat/completions"

type Client struct {
	baseURL string
	model   string
	client  *http.Client
}

func NewClient() *Client {
	baseURL := os.Getenv("LLM_BASE_URL")
	if baseURL == "" {
		baseURL = defaultURL
	}
	model := os.Getenv("LLM_MODEL")
	if model == "" {
		model = "qwen3.5"
	}
	return &Client{
		baseURL: baseURL,
		model:   model,
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
	Stream   bool      `json:"stream"`
}

type ChatResponse struct {
	ID      string   `json:"id"`
	Choices []Choice `json:"choices"`
}

type Choice struct {
	Message Message `json:"message"`
}

type StreamChunk struct {
	Choices []StreamChoice `json:"choices"`
}

type StreamChoice struct {
	Delta struct {
		Content string `json:"content"`
	} `json:"delta"`
}

// ── 日志辅助 ────────────────────────────────────────────────────────────────

func logRequest(method, url string, body []byte) {
	preview := string(body)
	if len(preview) > 200 {
		preview = preview[:200] + "..."
	}
	log.Printf("[LLM   OUT] %s %s | bodylen=%d | %.200s", method, url, len(body), preview)
}

func logResponse(status int, body []byte) {
	preview := string(body)
	if len(preview) > 200 {
		preview = preview[:200] + "..."
	}
	log.Printf("[LLM   IN ] status=%d | bodylen=%d | %.200s", status, len(body), preview)
}

// ── Stream ──────────────────────────────────────────────────────────────────

// Stream calls the LLM and yields text chunks via the given callback.
func (c *Client) Stream(prompt string, cb func(string) error) error {
	reqBody := ChatRequest{
		Model: c.model,
		Messages: []Message{
			{Role: "user", Content: prompt},
		},
		Stream: true,
	}
	body, _ := json.Marshal(reqBody)
	logRequest("POST", c.baseURL, body)

	req, err := http.NewRequest("POST", c.baseURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer not-needed")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := c.client.Do(req)
	if err != nil {
		log.Printf("[LLM   ERR] 连接失败: %v", err)
		return fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	log.Printf("[LLM   IN ] status=%d", resp.StatusCode)

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		logResponse(resp.StatusCode, respBody)
		return fmt.Errorf("LLM returned %d: %s", resp.StatusCode, respBody)
	}

	reader := io.Reader(resp.Body)
	buf := make([]byte, 0, 4096)
	lineBuf := make([]byte, 0, 4096)
	chunks := 0

	log.Printf("[LLM   IN ] 开始读取流...")

	for {
		n, err := reader.Read(buf[:cap(buf)])
		if n > 0 {
			for _, b := range buf[:n] {
				if b == '\n' {
					line := string(lineBuf)
					lineBuf = lineBuf[:0]
					if len(line) > 0 && len(line) < 10000 {
						if len(line) > 5 && line[:5] == "data:" {
							data := line[5:]
							if data == "[DONE]" {
								log.Printf("[LLM   IN ] 流结束，共 %d chunks", chunks)
								return nil
							}
							var chunk StreamChunk
							if json.Unmarshal([]byte(data), &chunk) == nil {
								if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
									chunks++
									if err := cb(chunk.Choices[0].Delta.Content); err != nil {
										log.Printf("[LLM   ERR] callback error: %v", err)
										return err
									}
								}
							}
						}
					}
				} else {
					lineBuf = append(lineBuf, b)
				}
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Printf("[LLM   ERR] 读取流失败: %v", err)
			return fmt.Errorf("read body: %w", err)
		}
	}
	log.Printf("[LLM   IN ] 流正常结束，共 %d chunks", chunks)
	return nil
}

// ── Complete (non-streaming) ────────────────────────────────────────────────

// Complete sends a non-streaming completion request.
func (c *Client) Complete(prompt string) (string, error) {
	reqBody := ChatRequest{
		Model: c.model,
		Messages: []Message{
			{Role: "user", Content: prompt},
		},
		Stream: false,
	}
	body, _ := json.Marshal(reqBody)
	logRequest("POST", c.baseURL, body)

	req, err := http.NewRequest("POST", c.baseURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer not-needed")

	resp, err := c.client.Do(req)
	if err != nil {
		log.Printf("[LLM   ERR] 连接失败: %v", err)
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		logResponse(resp.StatusCode, respBody)
		return "", fmt.Errorf("LLM returned %d: %s", resp.StatusCode, respBody)
	}

	var cr ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	if len(cr.Choices) == 0 {
		return "", fmt.Errorf("no choices in response")
	}
	log.Printf("[LLM   IN ] 完成，非流式响应 length=%d", len(cr.Choices[0].Message.Content))
	return cr.Choices[0].Message.Content, nil
}
