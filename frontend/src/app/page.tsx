'use client';

import { useState, useEffect } from 'react';
import { LanguageProvider, useLang } from '@/components/LanguageProvider';
import AttestationBadge from '@/components/AttestationBadge';
import ChatPanel from '@/components/ChatPanel';
import type { AttestationResponse } from '@/lib/types';

function useCurrentTime() {
  const [time, setTime] = useState('');

  useEffect(() => {
    function update() {
      const now = new Date();
      setTime(
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      );
    }
    update();
    const id = setInterval(update, 10000);
    return () => clearInterval(id);
  }, []);

  return time;
}

function AppContent() {
  const { t, toggleLang } = useLang();
  const time = useCurrentTime();
  const [attestation, setAttestation] = useState<AttestationResponse | null>(null);
  const [attestationError, setAttestationError] = useState(false);
  const [attestationLoading, setAttestationLoading] = useState(true);

  useEffect(() => {
    fetch('/api/attestation')
      .then((res) => res.json())
      .then((data: AttestationResponse) => {
        setAttestation(data);
        setAttestationLoading(false);
      })
      .catch(() => {
        setAttestationError(true);
        setAttestationLoading(false);
      });
  }, []);

  return (
    <div className="phone-wrapper">
      <div className="phone-frame">
        {/* Status Bar */}
        <div className="status-bar">
          <span className="left-icons">📶 📡</span>
          <span className="right-icons">🔋 {time}</span>
        </div>

        {/* App Content */}
        <div className="app">
          <header className="app-header">
            <div className="app-header-row">
              <h1>{t.app.title}</h1>
              <button className="lang-toggle" onClick={toggleLang}>
                {t.lang.switch}
              </button>
            </div>
            <p className="subtitle">{t.app.subtitle}</p>
          </header>

          <section className="attestation-section">
            <AttestationBadge attestation={attestation} loading={attestationLoading} error={attestationError} />
          </section>

          <section className="chat-section">
            <ChatPanel attestation={attestation} attestationError={attestationError} />
          </section>

          <footer className="app-footer">
            <p>{t.app.footer}</p>
          </footer>
        </div>

        {/* Home Indicator */}
        <div className="home-indicator">
          <div className="bar" />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}
