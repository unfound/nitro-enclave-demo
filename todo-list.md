# TODO — Nitro Enclave Demo

## 完成

- [x] 修复 mock 模式下 attestation trusted 逻辑（31533b0）
- [x] 调通前后端通信：LLM 端口 8001→8080，加日志
- [x] README 端口和 API 路径更新
- [x] 代码提交（f298fc2）

## 进行中

- [ ] 前端清理：删除不需要的文件，修复 TS 报错

## 待办

- [ ] 前端适配新版后端接口（chat 接口 ct 字段）
- [ ] 前端 attestation badge 组件重构
- [ ] 前端整体 UI 优化
- [ ] 后端：真实 TPM PCR 读取与 golden baseline 对比
- [ ] 后端：服务注册到 K8s
- [ ] 文档：K8s 部署指南完善
