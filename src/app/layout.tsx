import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '机密医疗助手 — Nitro Enclave Demo',
  description: '基于 AWS Nitro Enclave 机密计算的端到端加密医疗咨询助手',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
