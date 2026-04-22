package session

import (
	"encoding/hex"
	"sync"
)

// Manager 管理每个 session 的密钥数据。
// 只存 responseKey（解密 client 请求 / 加密 server 响应）。
type Manager struct {
	mu       sync.RWMutex
	sessions map[string][]byte // sessionID(string) -> responseKey
}

// New creates a new session manager.
func New() *Manager {
	return &Manager{
		sessions: make(map[string][]byte),
	}
}

// Store saves a session's response key.
// sessionID: hex-encoded session ID from hpke.KeyExchange
// responseKey: 32-byte response key
func (m *Manager) Store(sessionID string, responseKey []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[sessionID] = responseKey
}

// Get retrieves a session's response key.
func (m *Manager) Get(sessionID string) ([]byte, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	k, ok := m.sessions[sessionID]
	return k, ok
}

// Remove deletes a session after use.
func (m *Manager) Remove(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, sessionID)
}

// HexToSessionID converts a hex string to a session ID byte slice.
func HexToSessionID(hexStr string) (string, error) {
	// Just validate hex
	_, err := hex.DecodeString(hexStr)
	if err != nil {
		return "", err
	}
	return hexStr, nil
}
