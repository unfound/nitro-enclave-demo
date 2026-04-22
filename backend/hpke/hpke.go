package hpke

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/hkdf"
	"golang.org/x/crypto/x25519"
)

// Suite: X25519 + HKDF-SHA256 + AES-128-GCM

type Suite struct{}

func (s Suite) KEM()  string { return "X25519" }
func (s Suite) KDF()  string { return "HKDF-SHA256" }
func (s Suite) AEAD() string { return "AES-128-GCM" }

// KeyExchange performs HPKE key exchange.
// Returns sessionId, enc (ephemeral pk), responseKey, and error.
func KeyExchange(serverSK x25519.PrivateKey, clientPK x25519.PublicKey) (sessionID, enc, responseKey []byte, err error) {
	// 1. Generate ephemeral keypair
	ephemeralSK := make([]byte, 32)
	_, _ = rand.Read(ephemeralSK)
	ephemeralPK := x25519.X25519(ephemeralSK, x25519.Point{})

	// 2. DH: server private key × client ephemeral public key
	// Wait, we need two DH computations for proper HPKE.
	// Simplified: ephemeral_sk × server_pk  AND  client_pk × server_sk
	// HPKE mode "base" does: pkEmphem × recipientSK  →  shared secret
	// Then derive keys.

	ss1 := x25519.X25519(ephemeralSK, clientPK) // ephemeral_sk × client_pk
	ss2 := x25519.X25519(serverSK, clientPK)    // server_sk × client_pk

	// Combine shared secrets
	combined := append(ss1[:], ss2[:]...)
	h := hkdf.New(sha256.New, combined)

	// Derive request key (not used in this design) and response key
	requestKey := make([]byte, 16)
	responseKeyBytes := make([]byte, 32)
	_, _ = h.Read(requestKey) // discard
	_, _ = h.Read(responseKeyBytes)

	// sessionId from ephemeral pk
	sessionID = ephemeralPK

	enc = ephemeralPK

	return sessionID, enc, responseKeyBytes, nil
}

// Open decrypts a sealed HPKE message using the stored response key from the session.
// enc: base64 ephemeral public key (not needed for decryption, just for protocol completeness)
// ct: base64(IV || ciphertext)
// storedResponseKey: the response key stored during KeyExchange
func Open(encB64, ctB64 string, storedResponseKey []byte) (plaintext []byte, err error) {
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

// ReDeriveResponseKey re-derives the response key from ephemeral SK and public keys.
// This is kept for reference; the session stores the key directly.
func ReDeriveResponseKey(ephemeralSK []byte, serverPK, clientPK x25519.PublicKey) []byte {
	ss1 := x25519.X25519(ephemeralSK, serverPK)
	ss2 := x25519.X25519(ephemeralSK, clientPK)
	combined := append(ss1[:], ss2[:]...)
	h := hkdf.New(sha256.New, combined)
	h.Read(make([]byte, 16)) // discard request key
	responseKey := make([]byte, 32)
	h.Read(responseKey)
	return responseKey
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

// EncryptChunk encrypts a single text chunk with AES-128-GCM.
func EncryptChunk(text string, responseKey []byte) EncryptedChunk {
	iv := make([]byte, 12)
	_, _ = rand.Read(iv)

	plaintext := []byte(text)
	ciphertext := encryptAES128GCM(responseKey, iv, plaintext)

	packed := append(iv, ciphertext...)
	return EncryptedChunk{
		IV: base64.StdEncoding.EncodeToString(iv),
		Ct: base64.StdEncoding.EncodeToString(ciphertext),
	}
}

func encryptAES128GCM(key, iv, plaintext []byte) []byte {
	block, _ := aes.NewCipher(key)
	aead, _ := cipher.NewGCM(block)
	return aead.Seal(nil, iv, plaintext, nil)
}

type EncryptedChunk struct {
	IV string `json:"iv"` // base64
	Ct string `json:"ct"` // base64
}

// PublicKeyToBase64 encodes a public key to base64.
func PublicKeyToBase64(pk x25519.PublicKey) string {
	return base64.StdEncoding.EncodeToString(pk)
}

// PublicKeyFromBase64 decodes a public key from base64.
func PublicKeyFromBase64(b64 string) (x25519.PublicKey, error) {
	bytes, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, err
	}
	return x25519.PublicKey(bytes), nil
}

// GetPublicKey derives the public key from a private key.
func GetPublicKey(sk x25519.PrivateKey) x25519.PublicKey {
	return sk.PublicKey()
}

// BytesToBase64 encodes raw bytes to base64.
func BytesToBase64(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}
