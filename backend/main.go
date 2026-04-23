// Nitro Enclave Attestation Backend — Go 1.24
package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"backend/hpke"
	"backend/llm"
	"backend/session"
	"backend/tpm"
)

//go:generate go run gen_keys.go

// ── Types ──────────────────────────────────────────────────────────────────

type AttestationResponse struct {
	PCRs      map[string]string `json:"pcrs"`
	PublicKey string            `json:"publicKey"`
	Trusted   bool              `json:"trusted"`
	Mock      bool              `json:"mock"`
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type KeyExchangeRequest struct {
	ClientPublicKey string `json:"clientPublicKey"`
}

type KeyExchangeResponse struct {
	SessionID       string `json:"sessionId"`
	Enc             string `json:"enc"`
	ResponseKey     string `json:"responseKey"`
	ServerPublicKey string `json:"serverPublicKey"`
}

type ChatRequest struct {
	SessionID string `json:"sessionId"`
	Ct        string `json:"ct"`
}

type Chunk struct {
	Ct string `json:"ct"`
}

// ── Flags ──────────────────────────────────────────────────────────────────

var (
	useMockTPM    = os.Getenv("USE_MOCK_TPM") == "true"
	useMockLLM    = os.Getenv("USE_MOCK_LLM") == "true"
	enclaveMode   = os.Getenv("ENCLAVE_MODE") == "true"
	pcrIndices    []int
	goldenBaseline map[int]string
	llmClient     *llm.Client
)

func parseEnv() {
	if idx := os.Getenv("PCR_INDICES"); idx != "" {
		for _, s := range strings.Split(idx, ",") {
			var i int
			if _, err := fmt.Sscanf(s, "%d", &i); err == nil {
				pcrIndices = append(pcrIndices, i)
			}
		}
	}
	if baseline := os.Getenv("PCR_GOLDEN_BASELINE"); baseline != "" {
		goldenBaseline = make(map[int]string)
		for _, pair := range strings.Split(baseline, ";") {
			var idx int
			var val string
			if _, err := fmt.Sscanf(pair, "%d:%s", &idx, &val); err == nil {
				goldenBaseline[idx] = val
			}
		}
	}
}

// ── buildPrompt ─────────────────────────────────────────────────────────────

func buildPrompt(messages []ChatMessage) string {
	var sb strings.Builder
	for _, m := range messages {
		sb.WriteString(fmt.Sprintf("%s: %s\n", m.Role, m.Content))
	}
	sb.WriteString("assistant: ")
	return sb.String()
}

// ── main ───────────────────────────────────────────────────────────────────

func main() {
	log.SetFlags(log.Lshortfile)
	parseEnv()

	llmClient = llm.NewClient()
	kp, err := tpm.GetOrCreateKeyPair()
	if err != nil {
		log.Fatalf("密钥生成失败: %v", err)
	}

	sm := session.New()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	log.Printf("═══════════════════════════════════════")
	log.Printf("Nitro Enclave Attestation Server")
	log.Printf("═══════════════════════════════════════")
	log.Printf("Mock TPM:  %v", useMockTPM)
	log.Printf("Mock LLM:  %v", useMockLLM)
	log.Printf("Enclave:   %v", enclaveMode)
	log.Printf("PCR 索引:  %v", pcrIndices)
	log.Printf("Golden:    %v", len(goldenBaseline) > 0)
	log.Printf("公钥指纹:  %x", kp.PublicKey[:8])

	// ── GET /attestation ──────────────────────────────────────
	http.HandleFunc("/attestation", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"METHOD_NOT_ALLOWED"}`, 405)
			return
		}
		w.Header().Set("Content-Type", "application/json")

		var pcrs map[string]string
		var publicKey string
		var mock bool

		if useMockTPM || len(pcrIndices) == 0 {
			mock = true
			pcrs = map[string]string{
				"1": "sha256:mock_pcr1_value_for_demo",
				"4": "sha256:mock_pcr4_value_for_demo",
			}
			publicKey = hpke.BytesToBase64(kp.PublicKey)
		} else {
			pcrMap, err := tpm.ReadPCRs(pcrIndices)
			if err != nil {
				http.Error(w, fmt.Sprintf(`{"error":"TPM_ERROR","message":%q}`, err.Error()), 500)
				return
			}
			pcrs = pcrMap
			publicKey = hpke.BytesToBase64(kp.PublicKey)

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
			Trusted:   len(kp.PublicKey) > 0,
			Mock:      mock,
		})
	})

	// ── POST /key-exchange ─────────────────────────────────────
	http.HandleFunc("/key-exchange", func(w http.ResponseWriter, r *http.Request) {
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

		clientPK, err := hpke.PublicKeyFromBase64(req.ClientPublicKey)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"INVALID_KEY","message":%q}`, err.Error()), 400)
			return
		}

		sessionID, enc, responseKey, err := hpke.KeyExchange(kp.PrivateKey, clientPK)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"HPKE_ERROR","message":%q}`, err.Error()), 500)
			return
		}

		sm.Store(hex.EncodeToString(sessionID), responseKey)

		json.NewEncoder(w).Encode(KeyExchangeResponse{
			SessionID:       hex.EncodeToString(sessionID),
			Enc:             hpke.BytesToBase64(enc),
			ResponseKey:     hex.EncodeToString(responseKey),
			ServerPublicKey: hpke.BytesToBase64(kp.PublicKey),
		})
	})

	// ── POST /chat ──────────────────────────────────────────────
	http.HandleFunc("/chat", func(w http.ResponseWriter, r *http.Request) {
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
			http.Error(w, `{"error":"SESSION_NOT_FOUND"}`, 400)
			return
		}

		plaintext, err := hpke.Open(req.Ct, responseKey)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"DECRYPT_FAILED","message":%q}`, err.Error()), 400)
			return
		}
		var messages []ChatMessage
		if err := json.Unmarshal(plaintext, &messages); err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"BAD_JSON","message":%q}`, err.Error()), 400)
			return
		}

		prompt := buildPrompt(messages)
		log.Printf("收到加密请求，prompt 长度: %d 字符", len(prompt))

		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Transfer-Encoding", "chunked")
		w.Header().Set("Cache-Control", "no-cache")

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", 500)
			return
		}

		log.Printf("调用 LLM Stream，prompt 长度: %d", len(prompt))
		err = func() error {
			if useMockLLM {
				// Mock 流式响应
				mockResp := "这是一条来自 Nitro Enclave 的加密回复。你的消息已安全解密并处理。"
				for i := 0; i < len(mockResp); i += 5 {
					end := i + 5
					if end > len(mockResp) {
						end = len(mockResp)
					}
					chunk := mockResp[i:end]
					encrypted := hpke.EncryptChunk(chunk, responseKey)
					line, _ := json.Marshal(encrypted)
					fmt.Fprintf(w, "%s\n", line)
					flusher.Flush()
					time.Sleep(10 * time.Millisecond)
				}
				return nil
			}
			return llmClient.Stream(prompt, func(text string) error {
				encrypted := hpke.EncryptChunk(text, responseKey)
				line, _ := json.Marshal(encrypted)
				fmt.Fprintf(w, "%s\n", line)
				flusher.Flush()
				return nil
			})
		}()
		if err != nil {
			log.Printf("LLM 流式错误: %v", err)
		}
	})

	// ── GET /health ────────────────────────────────────────────
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"METHOD_NOT_ALLOWED"}`, 405)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	log.Printf("启动: http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
