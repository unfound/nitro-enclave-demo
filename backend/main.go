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

// Env: comma-separated PCR indices, e.g. "1,4" or "1,4,7"
// If empty or "mock", use mock mode (returns fake PCRs).
func getPCRIndices() []int {
	s := os.Getenv("PCR_INDICES")
	if s == "" || s == "mock" {
		return nil // nil = mock mode
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

// Env: golden PCR baseline, format "1:sha256:abc...,4:sha256:def..."
// Backend checks PCRs against baseline (optional, frontend always checks).
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
// Types
// ============================================================

type AttestationResponse struct {
	PCRs      map[string]string `json:"pcrs"`
	PublicKey string            `json:"publicKey"`
	Mock      bool              `json:"mock"`
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
// Main
// ============================================================

func main() {
	pcrIndices := getPCRIndices()
	goldenBaseline := getGoldenBaseline()
	sm := session.NewManager()
	llmClient := llm.NewClient()

	// Load or create HPKE keypair
	_, serverSK, err := tpm.GetOrCreateKeyPair()
	if err != nil {
		log.Fatalf("failed to get keypair: %v", err)
	}

	log.Printf("Backend starting...")
	log.Printf("PCR_INDICES=%s -> PCRs: %v", os.Getenv("PCR_INDICES"), pcrIndices)
	log.Printf("PCR_GOLDEN_BASELINE set: %v", len(goldenBaseline) > 0)

	// ── GET /attestation ──────────────────────────────────────
	http.HandleFunc("GET /attestation", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var pcrs map[string]string
		var publicKey string
		var mock bool

		if len(pcrIndices) == 0 {
			// Mock mode
			mock = true
			pcrs = map[string]string{
				"1": "sha256:mock_pcr1_value_for_demo",
				"4": "sha256:mock_pcr4_value_for_demo",
			}
			if serverSK != nil {
				publicKey = hpke.PublicKeyToBase64(serverSK.PublicKey())
			} else {
				publicKey = "mock_public_key_base64"
			}
		} else {
			// Real TPM mode
			pcrMap, err := tpm.ReadPCRs(pcrIndices)
			if err != nil {
				http.Error(w, fmt.Sprintf(`{"error":"TPM_ERROR","message":%q}`, err.Error()), 500)
				return
			}
			pcrs = pcrMap

			if serverSK != nil {
				publicKey = hpke.PublicKeyToBase64(serverSK.PublicKey())
			}

			// Optional backend-side baseline check
			if len(goldenBaseline) > 0 {
				for idx, golden := range goldenBaseline {
					idxStr := fmt.Sprintf("%d", idx)
					if got, ok := pcrs[idxStr]; ok && got != golden {
						log.Printf("WARN: PCR%d mismatch — got %s, want %s", idx, got, golden)
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

		if serverSK == nil {
			http.Error(w, `{"error":"KEY_NOT_INITIALIZED"}`, 500)
			return
		}

		clientPK, err := hpke.PublicKeyFromBase64(req.ClientPublicKey)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"INVALID_KEY","message":%q}`, err.Error()), 400)
			return
		}

		sessionID, enc, responseKey, err := hpke.KeyExchange(serverSK, clientPK)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"HPKE_ERROR","message":%q}`, err.Error()), 500)
			return
		}

		sm.StoreWithSK(sessionID, responseKey, serverSK, enc)

		serverPK := serverSK.PublicKey()
		json.NewEncoder(w).Encode(KeyExchangeResponse{
			SessionID:       sessionID,
			Enc:             hpke.BytesToBase64(enc),
			ServerPublicKey: hpke.PublicKeyToBase64(serverPK),
		})
	})

	// ── POST /chat ──────────────────────────────────────────────
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

		serverSKForSession, ok := sm.GetPrivateKey(req.SessionID)
		if !ok {
			http.Error(w, `{"error":"SESSION_NO_KEY","message":"Session missing private key"}`, 500)
			return
		}

		messages, err := hpke.Open(req.Enc, req.Ct, responseKey)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"DECRYPT_FAILED","message":%q}`, err.Error()), 400)
			return
		}

		// Build prompt from decrypted messages
		prompt := buildPrompt(messages)
		log.Printf("Chat request: %d chars prompt", len(prompt))

		// Stream LLM response, encrypting each chunk
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
			log.Printf("LLM stream error: %v", err)
		}

		sm.Remove(req.SessionID) // session consumed
	})

	// ── Health check ────────────────────────────────────────────
	http.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}
	log.Printf("Listening on :%s", port)
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
