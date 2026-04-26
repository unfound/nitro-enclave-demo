// TPM Attestation Backend — Go 1.24
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
	systemPrompt  = os.Getenv("SYSTEM_PROMPT")
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
	if systemPrompt != "" {
		sb.WriteString("system: " + systemPrompt + "\n")
	}
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
	log.Printf("TPM App Server")
	log.Printf("═══════════════════════════════════════")
	log.Printf("Mock TPM:  %v", useMockTPM)
	log.Printf("Mock LLM:  %v", useMockLLM)
	log.Printf("Enclave:   %v", enclaveMode)
	log.Printf("SystemPrompt: %.50s", systemPrompt)
	log.Printf("PCR 索引:  %v", pcrIndices)
	log.Printf("Golden:    %v", len(goldenBaseline) > 0)
	log.Printf("公钥指纹:  %x", kp.PublicKey[:8])

	// ── GET /attestation ──────────────────────────────────────
	http.HandleFunc("/attestation", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[HTTP   IN ] GET /attestation")
		if r.Method != http.MethodGet {
			log.Printf("[HTTP   OUT] /attestation 405 METHOD_NOT_ALLOWED")
			http.Error(w, `{"error":"METHOD_NOT_ALLOWED"}`, 405)
			return
		}
		w.Header().Set("Content-Type", "application/json")

		var pcrs map[string]string
		var publicKey string
		var mock bool

		if useMockTPM || len(pcrIndices) == 0 {
			mock = true
			log.Printf("[TPM         ] Mock 模式，返回模拟 PCR 值")
			pcrs = map[string]string{
				"1": "sha256:mock_pcr1_value_for_demo",
				"4": "sha256:mock_pcr4_value_for_demo",
			}
			publicKey = hpke.BytesToBase64(kp.PublicKey)
		} else {
			log.Printf("[TPM         ] 读取真实 TPM PCR (indices=%v)", pcrIndices)
			pcrMap, err := tpm.ReadPCRs(pcrIndices)
			if err != nil {
				log.Printf("[TPM         ] PCR 读取失败: %v", err)
				http.Error(w, fmt.Sprintf(`{"error":"TPM_ERROR","message":%q}`, err.Error()), 500)
				return
			}
			pcrs = pcrMap
			publicKey = hpke.BytesToBase64(kp.PublicKey)

			if len(goldenBaseline) > 0 {
				for idx, golden := range goldenBaseline {
					idxStr := fmt.Sprintf("%d", idx)
					if got, ok := pcrs[idxStr]; ok && got != golden {
						log.Printf("[TPM         ] 警告: PCR%d 不匹配 — 收到 %s，期望 %s", idx, got, golden)
					}
				}
			}
		}

		resp := AttestationResponse{
			PCRs:      pcrs,
			PublicKey: publicKey,
			Trusted:   len(kp.PublicKey) > 0,
			Mock:      mock,
		}
		log.Printf("[HTTP   OUT] /attestation trusted=%v mock=%v pcrs=%v", resp.Trusted, resp.Mock, len(resp.PCRs))
		json.NewEncoder(w).Encode(resp)
	})

	// ── POST /key-exchange ─────────────────────────────────────
	http.HandleFunc("/key-exchange", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[HTTP   IN ] POST /key-exchange")
		if r.Method != http.MethodPost {
			log.Printf("[HTTP   OUT] /key-exchange 405 METHOD_NOT_ALLOWED")
			http.Error(w, `{"error":"METHOD_NOT_ALLOWED"}`, 405)
			return
		}
		w.Header().Set("Content-Type", "application/json")

		body, err := io.ReadAll(r.Body)
		if err != nil {
			log.Printf("[HTTP   OUT] /key-exchange 400 BAD_REQUEST: %v", err)
			http.Error(w, fmt.Sprintf(`{"error":"BAD_REQUEST","message":%q}`, err.Error()), 400)
			return
		}
		var req KeyExchangeRequest
		if err := json.Unmarshal(body, &req); err != nil {
			log.Printf("[HTTP   OUT] /key-exchange 400 BAD_JSON: %v", err)
			http.Error(w, fmt.Sprintf(`{"error":"BAD_JSON","message":%q}`, err.Error()), 400)
			return
		}
		log.Printf("[HPKE        ] 收到客户端公钥 len=%d", len(req.ClientPublicKey))

		clientPK, err := hpke.PublicKeyFromBase64(req.ClientPublicKey)
		if err != nil {
			log.Printf("[HPKE        ] 无效客户端公钥: %v", err)
			http.Error(w, fmt.Sprintf(`{"error":"INVALID_KEY","message":%q}`, err.Error()), 400)
			return
		}

		sessionID, enc, responseKey, err := hpke.KeyExchange(kp.PrivateKey, clientPK)
		if err != nil {
			log.Printf("[HPKE        ] 密钥交换失败: %v", err)
			http.Error(w, fmt.Sprintf(`{"error":"HPKE_ERROR","message":%q}`, err.Error()), 500)
			return
		}

		sm.Store(hex.EncodeToString(sessionID), responseKey)
		log.Printf("[HPKE        ] 密钥交换成功，sessionID=%x responseKey=%.10s...", sessionID[:8], hex.EncodeToString(responseKey)[:10])

		resp := KeyExchangeResponse{
			SessionID:       hex.EncodeToString(sessionID),
			Enc:             hpke.BytesToBase64(enc),
			ResponseKey:     hex.EncodeToString(responseKey),
			ServerPublicKey: hpke.BytesToBase64(kp.PublicKey),
		}
		log.Printf("[HTTP   OUT] /key-exchange 200 sessionID=%s", resp.SessionID[:16])
		json.NewEncoder(w).Encode(resp)
	})

	// ── POST /chat ──────────────────────────────────────────────
	http.HandleFunc("/chat", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[HTTP   IN ] POST /chat")
		if r.Method != http.MethodPost {
			log.Printf("[HTTP   OUT] /chat 405 METHOD_NOT_ALLOWED")
			http.Error(w, `{"error":"METHOD_NOT_ALLOWED"}`, 405)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			log.Printf("[HTTP   OUT] /chat 400 BAD_REQUEST: %v", err)
			http.Error(w, fmt.Sprintf(`{"error":"BAD_REQUEST","message":%q}`, err.Error()), 400)
			return
		}
		var req ChatRequest
		if err := json.Unmarshal(body, &req); err != nil {
			log.Printf("[HTTP   OUT] /chat 400 BAD_JSON: %v", err)
			http.Error(w, fmt.Sprintf(`{"error":"BAD_JSON","message":%q}`, err.Error()), 400)
			return
		}
		log.Printf("[HTTP        ] sessionID=%.16s ct_len=%d", req.SessionID, len(req.Ct))

		responseKey, ok := sm.Get(req.SessionID)
		if !ok {
			log.Printf("[HPKE        ] Session 不存在 sessionID=%.16s", req.SessionID)
			http.Error(w, `{"error":"SESSION_NOT_FOUND"}`, 400)
			return
		}

		plaintext, err := hpke.Open(req.Ct, responseKey)
		if err != nil {
			log.Printf("[HPKE        ] 解密失败: %v", err)
			http.Error(w, fmt.Sprintf(`{"error":"DECRYPT_FAILED","message":%q}`, err.Error()), 400)
			return
		}
		log.Printf("[HPKE        ] 解密成功 plaintext_len=%d", len(plaintext))

		var messages []ChatMessage
		if err := json.Unmarshal(plaintext, &messages); err != nil {
			log.Printf("[HTTP        ] 消息解析失败: %v", err)
			http.Error(w, fmt.Sprintf(`{"error":"BAD_JSON","message":%q}`, err.Error()), 400)
			return
		}
		log.Printf("[HTTP        ] 收到消息数=%d", len(messages))

		prompt := buildPrompt(messages)
		if systemPrompt != "" {
			log.Printf("[HTTP        ] 系统提示词已注入 len=%d", len(systemPrompt))
		}

		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Transfer-Encoding", "chunked")
		w.Header().Set("Cache-Control", "no-cache")

		flusher, ok := w.(http.Flusher)
		if !ok {
			log.Printf("[HTTP   ERR] streaming 不支持")
			http.Error(w, "streaming not supported", 500)
			return
		}

		log.Printf("[LLM         ] 调用 LLM prompt_len=%d", len(prompt))
		err = func() error {
			if useMockLLM {
				log.Printf("[LLM         ] Mock LLM 模式")
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
			log.Printf("[LLM         ] LLM 流式错误: %v", err)
		} else {
			log.Printf("[LLM         ] LLM 流正常结束")
		}
		log.Printf("[HTTP   OUT] /chat 完成")
	})

	// ── GET /health ────────────────────────────────────────────
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[HTTP   IN ] GET /health")
		if r.Method != http.MethodGet {
			http.Error(w, `{"error":"METHOD_NOT_ALLOWED"}`, 405)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	log.Printf("═══════════════════════════════════════")
	log.Printf("启动: http://localhost:%s", port)
	log.Printf("═══════════════════════════════════════")
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
