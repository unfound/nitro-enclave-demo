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
	req, err := http.NewRequest("POST", c.baseURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer not-needed")
	req.Header.Set("Accept", "text/event-stream")

	log.Printf("[LLM Stream] POST %s | bodylen=%d", c.baseURL, len(body))
	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	log.Printf("LLM Stream: status=%d", resp.StatusCode)

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("LLM returned %d: %s", resp.StatusCode, respBody)
	}

	// Read SSE stream line by line
	log.Printf("LLM Stream: starting to read body")
	reader := io.Reader(resp.Body)
	buf := make([]byte, 0, 4096)
	lineBuf := make([]byte, 0, 4096)

	for {
		n, err := reader.Read(buf[:cap(buf)])
		if n > 0 {
			for _, b := range buf[:n] {
				if b == '\n' {
					line := string(lineBuf)
					lineBuf = lineBuf[:0]
					if len(line) > 0 && len(line) < 10000 {
						// SSE line format: "data: {...}"
						if len(line) > 5 && line[:5] == "data:" {
							data := line[5:]
							if data == "[DONE]" {
								return nil
							}
							var chunk StreamChunk
							if json.Unmarshal([]byte(data), &chunk) == nil {
								if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
									if err := cb(chunk.Choices[0].Delta.Content); err != nil {
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
			return fmt.Errorf("read body: %w", err)
		}
	}
	return nil
}

// Non-streaming call.
func (c *Client) Complete(prompt string) (string, error) {
	reqBody := ChatRequest{
		Model: c.model,
		Messages: []Message{
			{Role: "user", Content: prompt},
		},
		Stream: false,
	}
	body, _ := json.Marshal(reqBody)
	req, err := http.NewRequest("POST", c.baseURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer not-needed")

	resp, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("LLM returned %d: %s", resp.StatusCode, respBody)
	}

	var cr ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	if len(cr.Choices) == 0 {
		return "", fmt.Errorf("no choices in response")
	}
	return cr.Choices[0].Message.Content, nil
}
