package session

import (
	"sync"

	"github.com/google/uuid"
)

// Manager 管理每个 session 的数据。
// 存储从 key-exchange 得到的 response key，用于解密和加密响应。
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*sessionData
}

type sessionData struct {
	responseKey  []byte // 对称响应密钥
	serverSK    []byte // 服务器私钥（临时存这里，session 结束后清除）
}

// New 创建一个新的 session manager。
func New() *Manager {
	return &Manager{
		sessions: make(map[string]*sessionData),
	}
}

// Store 保存一个 session 的密钥数据。
func (m *Manager) Store(sessionID string, responseKey []byte, serverSK []byte, enc []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[sessionID] = &sessionData{
		responseKey: responseKey,
		serverSK:    serverSK,
	}
}

// Get 获取 session 的响应密钥。
func (m *Manager) Get(sessionID string) ([]byte, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	d, ok := m.sessions[sessionID]
	if !ok {
		return nil, false
	}
	return d.responseKey, true
}

// GetPrivateKey 获取 session 的服务器私钥。
func (m *Manager) GetPrivateKey(sessionID string) ([]byte, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	d, ok := m.sessions[sessionID]
	if !ok || d.serverSK == nil {
		return nil, false
	}
	return d.serverSK, true
}

// Remove 删除一个 session（使用后清理）。
func (m *Manager) Remove(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, sessionID)
}
