# TODO — Nitro Enclave Demo

## 完成

- [x] 修复 mock 模式下 attestation trusted 逻辑（31533b0）
- [x] 调通前后端通信：LLM 端口 8001→8080，加日志
- [x] README 端口和 API 路径更新
- [x] 前端清理：删除 enclave.ts/llm.ts（未用），简化 AttestationBadge 数据流
- [x] 移除 ai/@ai-sdk/openai 依赖（已迁移到 Go 后端调用 LLM）
- [x] 补全 LLMStreamChunk 类型定义
- [x] attestation loading/error 状态正确传递
- [x] mock 模式 PCR 校验：前端用 MOCK_GOLDEN_PCR 验证后端返回的 mock PCR（bf45932）
- [x] 代码提交（f298fc2, 01cef22, 85595eb, bf45932）

## 进行中

## 待办

- [x] 前端 attestation badge 可收起展示 Key+PCR 详情（a1e70e4）
- [x] 前端 attestation badge 绿色主题样式优化
- [x] 清理误 committed 的截图（b7e1d2e）
- [x] 添加前端 Dockerfile（b7e1d2e）
- [ ] 前端整体 UI 优化（样式、动画）
- [ ] 后端：真实 TPM PCR 读取与 golden baseline 对比
- [ ] 后端：服务注册到 K8s
- [ ] 文档：K8s 部署指南完善
