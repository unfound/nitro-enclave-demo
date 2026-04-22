package tpm

import (
	"crypto/x25519"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/google/go-tpm/legacy/tpm2"
)

// KeyPair HPKE 密钥对。
// 用途：前端用公钥加密消息，后端用私钥解密。
// 注意：这是通信加密密钥，不是 attestation 身份密钥。
type KeyPair struct {
	PublicKey  []byte `json:"publicKey"`  // 32 bytes, hex 编码
	PrivateKey []byte `json:"-"`          // 永不序列化到磁盘
}

type keyJSON struct {
	PublicKey string `json:"pk"` // hex
}

// 默认密钥持久化路径。
// 生产环境建议挂载 emptyDir 或 hostPath，避免 Pod 重建后丢失。
const defaultKeyPath = "/var/lib/backend/enclave-key.json"

// GetOrCreateKeyPair 加载或生成 HPKE 密钥对。
// - 有持久化密钥 → 直接加载
// - 无则生成新的 X25519 密钥对并保存
func GetOrCreateKeyPair() (*KeyPair, error) {
	path := os.Getenv("KEY_PATH")
	if path == "" {
		path = defaultKeyPath
	}

	// 尝试从磁盘加载
	if data, err := os.ReadFile(path); err == nil {
		var kj keyJSON
		if json.Unmarshal(data, &kj) == nil {
			pk, err := hex.DecodeString(kj.PublicKey)
			if err == nil && len(pk) == 32 {
				return &KeyPair{
					PublicKey:  pk,
					PrivateKey: nil, // 私钥已不在磁盘上
				}, nil
			}
		}
	}

	// 生成新密钥对
	priv := make([]byte, 32)
	_, sk := x25519.GenerateKey(priv)

	kp := &KeyPair{
		PublicKey:  sk.PublicKey(),
		PrivateKey: priv,
	}

	// 持久化公钥
	persistPublicKey(kp, path)

	// 检查 TPM 是否可用（用于记录日志，不影响密钥生成）
	tpmPath := os.Getenv("TPM_DEVICE")
	if tpmPath == "" {
		tpmPath = "/dev/tpm0"
	}
	if rwc, err := tpm2.OpenTPM(tpmPath); err == nil {
		rwc.Close()
		// TPM 在线，后续可扩展：用 TPM seal attestation 密钥
	} else {
		// 无 TPM，但我们的 HPKE 密钥本来就不需要 TPM
	}

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
