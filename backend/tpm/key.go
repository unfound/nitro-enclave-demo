package tpm

import (
	"crypto/x25519"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/google/go-tpm/legacy/tpm2"
)

// KeyPair holds an X25519 keypair.
type KeyPair struct {
	PublicKey  x25519.PublicKey  `json:"publicKey"`  // 32 bytes, hex
	PrivateKey x25519.PrivateKey `json:"-"`          // never serialized to disk
}

type keyJSON struct {
	PublicKey string `json:"pk"` // hex
	Sealed    bool   `json:"sealed"`
}

const defaultKeyPath = "/var/lib/backend/enclave-key.json"

// GetOrCreateKeyPair loads or creates the HPKE keypair.
// In mock mode (no TPM available), falls back to a plain in-memory key.
func GetOrCreateKeyPair() (KeyPair, x25519.PrivateKey, error) {
	path := os.Getenv("KEY_PATH")
	if path == "" {
		path = defaultKeyPath
	}

	// Try to load existing key from disk
	if data, err := os.ReadFile(path); err == nil {
		var kj keyJSON
		if json.Unmarshal(data, &kj) == nil {
			pk, err := hex.DecodeString(kj.PublicKey)
			if err == nil && len(pk) == 32 {
				// Found a persisted key — return public only (private can't be recovered without TPM)
				return KeyPair{
					PublicKey: x25519.X25519PublicKey(pk),
					sealed:    kj.Sealed,
				}, nil, nil
			}
		}
	}

	// Generate new keypair
	_, sk := x25519.GenerateKey(make([]byte, 32))
	kp := KeyPair{
		PublicKey:  sk.PublicKey(),
		PrivateKey: sk,
		sealed:     false,
	}

	tpmPath := os.Getenv("TPM_DEVICE")
	if tpmPath == "" {
		tpmPath = "/dev/tpm0"
	}

	// Check if TPM is available
	rwc, err := tpm2.OpenTPM(tpmPath)
	if err == nil {
		rwc.Close()
		// TPM available — TODO: implement real seal/unseal
		fmt.Fprintf(os.Stderr, "note: TPM available at %s, real sealing TBD\n", tpmPath)
	} else {
		fmt.Fprintf(os.Stderr, "note: TPM unavailable at %s: %v (using plain key)\n", tpmPath, err)
	}

	persistKey(kp, path)
	return kp, sk, nil
}

func persistKey(kp KeyPair, path string) {
	kj := keyJSON{
		PublicKey: hex.EncodeToString(kp.PublicKey),
		Sealed:    kp.sealed,
	}
	data, _ := json.Marshal(kj)
	os.MkdirAll(filepath.Dir(path), 0700)
	os.WriteFile(path, data, 0600)
}
