package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"backend/hpke"
	"backend/llm"
	"backend/session"
	"backend/tpm"
)

// ============================================================
// 环境变量读取
// ============================================================

// PCR_INDICES: 逗号分隔的 PCR 索引，如 "1,4" 或 "1,4,7"
// 为空或 "mock" → 使用模拟 PCR（无需真实 TPM）
func getPCRIndices() []int {
	s := os.Getenv("PCR_INDICES")
	if s == "" || s == "mock" {
		return nil
	}
	var pcrs []int
	for _, p := range strings.Split(s, ",") {
		var n int
		if _, err := fmt.Sscanf(p, "%d", &n); err == nil {
			pcrs = append(pcrs, n)
		}
	}
	return pcrs
}

// PCR_GOLDEN_BASELINE: 黄金基线，格式 "1:sha256:abc...,4:sha256:def..."
// 可选。后端不强制检查，前端一定检查。
func getGoldenBaseline() map[int]string {
	s := os.Getenv("PCR_GOLDEN_BASELINE")
	if s == "" {
		return nil
	}
	baseline := make(map[int]string)
	for _, pair := range strings.Split(s, ",") {
		kv := strings.SplitN(pair, ":", 2)
		if len(kv) != 2 {
			continue
		}
		var idx int
		if _, err := fmt.Sscanf(kv[0], "%d", &idx); err == nil {
			baseline[idx] = kv[1]
		}
	}
	return baseline
}

// ============================================================
// API 类型
// ============================================================

type AttestationResponse struct {
	PCRs      map[string]string `json:"pcrs"`       // "1" -> "sha256:abc..."
	PublicKey string            `json:"publicKey"` // base64 X25519 公钥
	Mock      bool              `json:"mock"`       // true = 模拟模式
}

type KeyExchangeRequest struct {
	ClientPublicKey string `json:"clientPublicKey"` // base64
}

type KeyExchangeResponse struct {
	SessionID       string `json:"sessionId"`
	Enc            string `json:"enc"`             // base64 ephemeral pk
	ServerPublicKey string `json:"serverPublicKey"` // base64
}

type ChatRequest struct {
	SessionID string `json:"sessionId"`
	Enc       string `json:"enc"` // base64 ephemeral pk
	Ct        string `json:"ct"`  // base64 IV+ciphertext
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ============================================================
// 主入口
// ============================================================

func main() {
	pcrIndices := getPCRIndices()
	goldenBaseline := getGoldenBaseline()
	sm := session.NewManager()
	llmClient := llm.NewClient()

	// 加载或生成 HPKE 密钥对（通信用）
	kp, err := tpm.GetOrCreateKeyPair()
	if err != nil {
		log.Fatalf("密钥加载失败: %v", err)
	}

	log.Printf("后端启动")
	log.Printf("PCR_INDICES=%s -> 读取: %v", os.Getenv("PCR_INDICES"), pcrIndices)
	log.Printf("PCR_GOLDEN_BASELINE: %v", len(goldenBaseline) > 0)
	log.Printf("公钥指纹: %x", kp.PublicKey[:8])

	// ── GET /attestation ──────────────────────────────────────
	http.HandleFunc("GET /attestation", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var pcrs map[string]string
		var publicKey string
		var mock bool

		if len(pcrIndices) == 0 {
			// 模拟模式：返回假的 PCR
			mock = true
			pcrs = map[string]string{
				"1": "sha256:mock_pcr1_value_for_demo",
				"4": "sha256:mock_pcr4_value_for_demo",
			}
			if len(kp.PublicKey) > 0 {
				publicKey = hpke.BytesToBase64(kp.PublicKey)
			} else {
				publicKey = "mock_public_key_base64"
			}
		} else {
			// 真实 TPM 模式
			pcrMap, err := tpm.ReadPCRs(pcrIndices)
			if err != nil {
				http.Error(w, fmt.Sprintf(`{"error":"TPM_ERROR","message":%q}`, err.Error()), 500)
				return
			}
			pcrs = pcrMap
			publicKey = hpke.BytesToBase64(kp.PublicKey)

			// 可选：后端检查 PCR 基线（仅记录日志）
			if len(goldenBaseline) > 0 {
				for idx, golden := range goldenBaseline {
					idxStr := fmt.Sprintf("%d", idx)
					if got, ok := pcrs[idxStr]; ok && got != golden {
						log.Printf("警告: PCR%d 不匹配 — 收到 %s，期望 %s", idx, got, golden)
					}
				}
			}
		}

		json.NewEncoder(w).Encode(AttestationResponse{
			PCRs:      pcrs,
			PublicKey: publicKey,
			Mock:      mock,
		})
	})

	// ── POST /key-exchange ─────────────────────────────────────
	// 前端发送临时公钥，完成 DH 密钥交换，建立加密 session
	http.HandleFunc("POST /key-exchange", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"METHOD_NOT_ALLOWED"}`, 405)
			return
		}
		w.Header().Set("Content-Type", "application/json")

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"BAD_REQUEST","message":%q}`, err.Error()), 400)
			return
		}
		var req KeyExchangeRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"BAD_JSON","message":%q}`, err.Error()), 400)
			return
		}

		if len(kp.PublicKey) == 0 {
			http.Error(w, `{"error":"KEY_NOT_INITIALIZED"}`, 500)
			return
		}

		clientPK, err := hpke.PublicKeyFromBase64(req.ClientPublicKey)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"INVALID_KEY","message":%q}`, err.Error()), 400)
			return
		}

		// DH 密钥交换
		sessionID, enc, responseKey, err := hpke.KeyExchange(kp.PrivateKey, clientPK)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"HPKE_ERROR","message":%q}`, err.Error()), 500)
			return
		}

		// 存储 session
		sm.Store(sessionID, responseKey, kp.PrivateKey, enc)

		json.NewEncoder(w).Encode(KeyExchangeResponse{
			SessionID:       sessionID,
			Enc:             hpke.BytesToBase64(enc),
			ServerPublicKey: hpke.BytesToBase64(kp.PublicKey),
		})
	})

	// ── POST /chat ──────────────────────────────────────────────
	// 接收加密消息，解密 → 调用 LLM → 加密响应
	http.HandleFunc("POST /chat", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"METHOD_NOT_ALLOWED"}`, 405)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"BAD_REQUEST","message":%q}`, err.Error()), 400)
			return
		}
		var req ChatRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"BAD_JSON","message":%q}`, err.Error()), 400)
			return
		}

		responseKey, ok := sm.Get(req.SessionID)
		if !ok {
			http.Error(w, `{"error":"SESSION_NOT_FOUND","message":"Invalid or expired sessionId"}`, 400)
			return
		}

		// 解密
		messages, err := hpke.Open(req.Ct, responseKey)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"DECRYPT_FAILED","message":%q}`, err.Error()), 400)
			return
		}

		prompt := buildPrompt(messages)
		log.Printf("收到加密请求，prompt 长度: %d 字符", len(prompt))

		// 流式 LLM 响应，逐块加密
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Transfer-Encoding", "chunked")
		w.Header().Set("Cache-Control", "no-cache")

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", 500)
			return
		}

		err = llmClient.Stream(prompt, func(text string) error {
			encrypted := hpke.EncryptChunk(text, responseKey)
			line, _ := json.Marshal(encrypted)
			fmt.Fprintf(w, "%s\n", line)
			flusher.Flush()
			return nil
		})
		if err != nil {
			log.Printf("LLM 流式错误: %v", err)
		}

		// session 只用一次
		sm.Remove(req.SessionID)
	})

	// ── GET /health ────────────────────────────────────────────
	http.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}
	log.Printf("监听端口 :%s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}

func buildPrompt(messages []ChatMessage) string {
	var sb strings.Builder
	for _, m := range messages {
		sb.WriteString(fmt.Sprintf("%s: %s\n", m.Role, m.Content))
	}
	return sb.String()
}
