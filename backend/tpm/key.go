package tpm

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/crypto/curve25519"
)

// KeyPair HPKE 密钥对。
type KeyPair struct {
	PublicKey  []byte `json:"publicKey"`  // 32 bytes
	PrivateKey []byte `json:"-"`          // 永不序列化到磁盘
}

type keyJSON struct {
	PublicKey string `json:"pk"` // hex
}

const defaultKeyPath = "/var/lib/backend/enclave-key.json"

func GetOrCreateKeyPair() (*KeyPair, error) {
	path := os.Getenv("KEY_PATH")
	if path == "" {
		path = defaultKeyPath
	}

	if data, err := os.ReadFile(path); err == nil {
		var kj keyJSON
		if json.Unmarshal(data, &kj) == nil {
			pk, err := hex.DecodeString(kj.PublicKey)
			if err == nil && len(pk) == 32 {
				return &KeyPair{
					PublicKey:  pk,
					PrivateKey: nil,
				}, nil
			}
		}
	}

	// 生成新密钥对
	var privateKey [32]byte
	if _, err := rand.Read(privateKey[:]); err != nil {
		return nil, fmt.Errorf("rand.Read: %w", err)
	}
	privateKey[0] &= 248
	privateKey[31] &= 127
	privateKey[31] |= 64

	var publicKey [32]byte
	curve25519.ScalarBaseMult(&publicKey, &privateKey)

	kp := &KeyPair{
		PublicKey:  publicKey[:],
		PrivateKey: privateKey[:],
	}

	persistPublicKey(kp, path)
	return kp, nil
}

func persistPublicKey(kp *KeyPair, path string) {
	kj := keyJSON{
		PublicKey: hex.EncodeToString(kp.PublicKey),
	}
	data, _ := json.Marshal(kj)
	os.MkdirAll(filepath.Dir(path), 0700)
	os.WriteFile(path, data, 0600)
}
