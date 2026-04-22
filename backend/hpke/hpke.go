package hpke

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/curve25519"
)

// Suite: X25519 + HKDF-SHA256 + AES-256-GCM

// hkdfExpand 实现了 RFC 5869 HKDF-Expand。
func hkdfExpand(prk, info []byte, length int) []byte {
	n := (length + 31) / 32
	out := make([]byte, 0, n*32)

	var t []byte
	for i := 1; i <= n; i++ {
		h := sha256.New()
		h.Write(t)
		h.Write(info)
		h.Write([]byte{byte(i)})
		t = h.Sum(nil)
		out = append(out, t...)
	}
	return out[:length]
}

// hkdfExtract 实现了 RFC 5869 HKDF-Extract。
func hkdfExtract(salt, ikm []byte) []byte {
	if salt == nil {
		salt = make([]byte, 32)
	}
	h := sha256.New()
	h.Write(ikm)
	h.Write(salt)
	return h.Sum(nil)
}

// deriveKeys 与前端 crypto.ts deriveSessionKeys 完全一致。
func deriveKeys(sharedSecret []byte, encB64, serverPkB64 string) (requestKey, responseKey []byte) {
	info := "hpke-context:" + encB64 + ":" + serverPkB64
	prk := hkdfExtract(nil, sharedSecret)
	full := hkdfExpand(prk, []byte(info), 64)
	return full[0:32], full[32:64]
}

// KeyExchange 执行 HPKE 密钥交换。
// serverSK:   服务器 X25519 私钥（32 bytes）
// clientPK:   客户端 X25519 公钥（32 bytes）
// 返回: sessionID, enc(ephemeral公钥), responseKey
func KeyExchange(serverSK []byte, clientPK []byte) (sessionID, enc, responseKey []byte, err error) {
	// 生成临时密钥对
	ephemeralSK := make([]byte, 32)
	if _, err := rand.Read(ephemeralSK); err != nil {
		return nil, nil, nil, fmt.Errorf("rand.Read: %w", err)
	}

	var ephemeralSKFixed [32]byte
	copy(ephemeralSKFixed[:], ephemeralSK)
	var ephemeralPK [32]byte
	curve25519.ScalarBaseMult(&ephemeralPK, &ephemeralSKFixed)

	// DH = ephemeralSK * serverPK
	var serverSKFixed [32]byte
	copy(serverSKFixed[:], serverSK)
	var dh [32]byte
	curve25519.ScalarMult(&dh, &ephemeralSKFixed, &serverSKFixed)

	// serverPK = serverSK * G
	var serverPK [32]byte
	curve25519.ScalarBaseMult(&serverPK, &serverSKFixed)

	encB64 := base64.StdEncoding.EncodeToString(ephemeralPK[:])
	serverPkB64 := base64.StdEncoding.EncodeToString(serverPK[:])

	_, responseKey = deriveKeys(dh[:], encB64, serverPkB64)

	sid := make([]byte, 16)
	rand.Read(sid)

	return sid, ephemeralPK[:], responseKey, nil
}

// Open 解密 HPKE 密文。
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
	return decryptAES256GCM(storedResponseKey, iv, ciphertext)
}

// EncryptChunk 加密单个文本块（server → client）。
func EncryptChunk(text string, responseKey []byte) EncryptedChunk {
	iv := make([]byte, 12)
	rand.Read(iv)
	ciphertext := encryptAES256GCM(responseKey, iv, []byte(text))
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

func encryptAES256GCM(key, iv, plaintext []byte) []byte {
	block, _ := aes.NewCipher(key)
	aead, _ := cipher.NewGCM(block)
	return aead.Seal(nil, iv, plaintext, nil)
}

func decryptAES256GCM(key, iv, ciphertext []byte) ([]byte, error) {
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
