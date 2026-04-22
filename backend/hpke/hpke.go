package hpke

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/hkdf"
)

// Suite: X25519 + HKDF-SHA256 + AES-128-GCM

// KeyExchange 执行 HPKE 密钥交换。
// serverSK: 服务器 X25519 私钥（32 bytes）
// clientPK: 客户端 X25519 公钥（32 bytes）
// 返回: sessionID, enc(ephemeral公钥), responseKey
func KeyExchange(serverSK []byte, clientPK []byte) (sessionID, enc, responseKey []byte, err error) {
	// 生成临时密钥对
	ephemeralSK := make([]byte, 32)
	if _, err := rand.Read(ephemeralSK); err != nil {
		return nil, nil, nil, fmt.Errorf("rand.Read: %w", err)
	}

	// ephemeralPK = ephemeralSK * G
	var ephemeralSKFixed [32]byte
	copy(ephemeralSKFixed[:], ephemeralSK)
	var ephemeralPK [32]byte
	curve25519.ScalarBaseMult(&ephemeralPK, &ephemeralSKFixed)

	// DH1 = ephemeralSK * serverPK
	var serverSKFixed [32]byte
	copy(serverSKFixed[:], serverSK)
	var dh1 [32]byte
	curve25519.ScalarMult(&dh1, &ephemeralSKFixed, &serverSKFixed)

	// DH2 = serverSK * clientPK
	var clientPKFixed [32]byte
	copy(clientPKFixed[:], clientPK)
	var dh2 [32]byte
	curve25519.ScalarMult(&dh2, &serverSKFixed, &clientPKFixed)

	// 组合两个 DH 结果
	var combined [64]byte
	copy(combined[:32], dh1[:])
	copy(combined[32:], dh2[:])

	// HKDF 派生对称密钥
	h := hkdf.New(sha256.New, combined[:])
	discard := make([]byte, 16)
	h.Read(discard) // 丢弃 request key

	responseKey = make([]byte, 32)
	h.Read(responseKey)

	return ephemeralPK[:], ephemeralPK[:], responseKey, nil
}

// Open 解密 HPKE 密文。
// ct: base64(IV || ciphertext)
// storedResponseKey: session 中存储的 response key
func Open(ctB64 string, storedResponseKey []byte) ([]byte, error) {
	ct, err := base64.StdEncoding.DecodeString(ctB64)
	if err != nil {
		return nil, fmt.Errorf("decode ct: %w", err)
	}
	if len(ct) < 12 {
		return nil, fmt.Errorf("ct too short")
	}
	iv := ct[:12]
	ciphertext := ct[12:]
	return decryptAES128GCM(storedResponseKey, iv, ciphertext)
}

// EncryptChunk 加密单个文本块。
func EncryptChunk(text string, responseKey []byte) EncryptedChunk {
	iv := make([]byte, 12)
	rand.Read(iv)
	ciphertext := encryptAES128GCM(responseKey, iv, []byte(text))
	return EncryptedChunk{
		IV: base64.StdEncoding.EncodeToString(iv),
		Ct: base64.StdEncoding.EncodeToString(ciphertext),
	}
}

// EncryptedChunk 加密块。
type EncryptedChunk struct {
	IV string `json:"iv"` // base64
	Ct string `json:"ct"` // base64
}

// BytesToBase64 字节转 base64。
func BytesToBase64(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}

// PublicKeyFromBase64 解码公钥。
func PublicKeyFromBase64(b64 string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, err
	}
	if len(b) != 32 {
		return nil, fmt.Errorf("invalid key length: %d", len(b))
	}
	return b, nil
}

// ============================================================
// 内部
// ============================================================

func encryptAES128GCM(key, iv, plaintext []byte) []byte {
	block, _ := aes.NewCipher(key)
	aead, _ := cipher.NewGCM(block)
	return aead.Seal(nil, iv, plaintext, nil)
}

func decryptAES128GCM(key, iv, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return aead.Open(nil, iv, ciphertext, nil)
}
