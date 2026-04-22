package session

import (
	"crypto/x25519"
	"sync"

	"github.com/google/uuid"
)

// Manager stores per-session data: derived response key.
type Manager struct {
	mu      sync.RWMutex
	sessions map[string]*sessionData
}

type sessionData struct {
	responseKey  []byte
	serverSK     x25519.PrivateKey
	ephemeralPK  []byte
}

// New creates a new session manager.
func New() *Manager {
	return &Manager{
		sessions: make(map[string]*sessionData),
	}
}

// GenerateSession creates a new session and stores the derived keys.
// Returns the session ID.
func (m *Manager) GenerateSession(responseKey []byte, serverSK x25519.PrivateKey, ephemeralPK []byte) string {
	id := uuid.New().String()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[id] = &sessionData{
		responseKey:  responseKey,
		serverSK:     serverSK,
		ephemeralPK:  ephemeralPK,
	}
	return id
}

// Store saves a response key under a session ID.
func (m *Manager) Store(sessionID string, responseKey []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[sessionID] = &sessionData{
		responseKey: responseKey,
	}
}

// StoreWithSK saves a response key along with the server private key for a session.
func (m *Manager) StoreWithSK(sessionID string, responseKey []byte, serverSK x25519.PrivateKey, ephemeralPK []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[sessionID] = &sessionData{
		responseKey: responseKey,
		serverSK:    serverSK,
		ephemeralPK: ephemeralPK,
	}
}

// Get retrieves the response key for a session.
func (m *Manager) Get(sessionID string) ([]byte, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	d, ok := m.sessions[sessionID]
	if !ok {
		return nil, false
	}
	return d.responseKey, true
}

// GetPrivateKey retrieves the server private key for a session.
func (m *Manager) GetPrivateKey(sessionID string) (x25519.PrivateKey, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	d, ok := m.sessions[sessionID]
	if !ok || d.serverSK == nil {
		return nil, false
	}
	return d.serverSK, true
}

// Remove deletes a session after it has been consumed.
func (m *Manager) Remove(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, sessionID)
}
