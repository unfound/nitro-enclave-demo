export type Lang = 'zh' | 'en';

const zh = {
  app: {
    title: '机密运动健康助手',
    subtitle: 'AWS Nitro Enclave · 端到端加密保护',
    footer: '技术演示 — 非医疗建议。生产环境中，敏感数据仅在 Nitro Enclave 内解密。',
  },
  badge: {
    trusted: '可信环境已认证',
    trustedDesc: '服务运行在 AWS Nitro Enclave 中，数据端到端加密保护',
    untrusted: '未在可信环境运行',
    untrustedDesc: '服务未运行在安全飞地中，无法处理加密数据',
    loading: '正在验证环境...',
    loadingDesc: '检查服务可信状态',
    error: '认证失败',
    errorDesc: '无法连接认证服务',
    showDetails: '查看详情',
    hideDetails: '收起详情',
    publicKey: '公钥指纹',
  },
  chat: {
    placeholder: '描述你的运动状态或健康问题...',
    send: '发送',
    encrypted: '加密传输',
    plain: '明文模式',
    encryptedMode: '加密模式',
    plainMode: '明文模式',
    modeToggle: '传输模式',
    emptyTitle: '开始对话',
    emptyHint: '输入你的健康问题，数据将通过端到端加密保护',
    suggestions: [
      '我最近跑步膝盖疼怎么办？',
      '帮我制定一个减脂运动计划',
      '运动后肌肉酸痛怎么缓解？',
    ],
    errorEnclave: '服务未在可信执行环境中运行，无法处理加密数据',
    errorGeneric: '请求失败，请重试',
    attestationFailed: 'TPM 验证未通过，无法进行加密通信',
  },
  lang: {
    switch: 'EN',
  },
};

const en: typeof zh = {
  app: {
    title: 'Confidential Health Assistant',
    subtitle: 'AWS Nitro Enclave · End-to-End Encryption',
    footer: 'Technical demo — not medical advice. In production, sensitive data is only decrypted inside Nitro Enclave.',
  },
  badge: {
    trusted: 'Trusted Environment Verified',
    trustedDesc: 'Service runs in AWS Nitro Enclave, data protected by end-to-end encryption',
    untrusted: 'Not in Trusted Environment',
    untrustedDesc: 'Service is not running in a secure enclave, cannot process encrypted data',
    loading: 'Verifying Environment...',
    loadingDesc: 'Checking service trust status',
    error: 'Verification Failed',
    errorDesc: 'Cannot connect to verification service',
    showDetails: 'Show Details',
    hideDetails: 'Hide Details',
    publicKey: 'Public Key Fingerprint',
  },
  chat: {
    placeholder: 'Describe your exercise or health question...',
    send: 'Send',
    encrypted: 'Encrypted',
    plain: 'Plain Text',
    encryptedMode: 'Encrypted Mode',
    plainMode: 'Plain Mode',
    modeToggle: 'Transfer Mode',
    emptyTitle: 'Start Conversation',
    emptyHint: 'Enter your health question, data will be protected by end-to-end encryption',
    suggestions: [
      'What should I do about knee pain from running?',
      'Help me create a fat-loss exercise plan',
      'How to relieve muscle soreness after exercise?',
    ],
    errorEnclave: 'Service not in trusted execution environment, cannot process encrypted data',
    errorGeneric: 'Request failed, please try again',
    attestationFailed: 'TPM verification failed, cannot establish encrypted communication',
  },
  lang: {
    switch: '中文',
  },
};

export const translations = { zh, en } as const;

export type TranslationKeys = typeof zh;
