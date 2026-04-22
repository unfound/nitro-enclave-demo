# K8s 部署指南：Frontend + Backend（含 TPM）

> 华为云 CCE 集群，TPM 节点运行 Backend+LLM，普通节点运行 Frontend。

## 集群拓扑

```
Browser
   │
   ▼
┌─────────────────────────────┐
│  华为云 CCE LoadBalancer    │
│  → Frontend Pod (:3000)    │
└─────────────────────────────┘
         │ 集群内 DNS
         ▼
┌─────────────────────────────┐
│  Node B: TPM 节点           │
│  /dev/tpm0 ✓               │
│                             │
│  Pod: backend-llm          │
│   ├── backend :8000        │
│   └── llm      :8001       │
└─────────────────────────────┘
```

## 1. 给 Node B 打标签

Node B 需要标记为 TPM 节点，后续 Pod 用 `nodeSelector` 调度：

```bash
# 找到 TPM 节点名称
kubectl get nodes

# 给它打标签
kubectl label node <node-b-name> hardware=tpm-enabled

# 验证
kubectl get nodes --show-labels | grep tpm
```

## 2. 编写 Backend+LLM Deployment

```yaml
# backend-llm.yaml
apiVersion: v1
kind: Pod
metadata:
  name: backend-llm
  labels:
    app: backend-llm
spec:
  # 调度到 TPM 节点
  nodeSelector:
    hardware: tpm-enabled

  containers:
    # ── Backend ──────────────────────────────
    - name: backend
      image: <your-backend-image>
      ports:
        - containerPort: 8000
      securityContext:
        privileged: true
      volumeDevices:
        - name: tpm
          devicePath: /dev/tpm0
      env:
        - name: LLM_BASE_URL
          value: "http://localhost:8001"
        - name: LLM_MODEL
          value: "qwen3.5-0.8b"
      resources:
        memory: "4Gi"
        cpu: "2"

    # ── LLM (CPU 推理) ─────────────────────
    - name: llm
      image: <your-ollama-or-llama-cpp-image>
      ports:
        - containerPort: 8001
      resources:
        memory: "4Gi"
        cpu: "4"

  volumes:
    - name: tpm
      hostPath:
        path: /dev/tpm0

  restartPolicy: Never
```

**说明：**
- `llm` 容器和 `backend` 容器在**同一个 Pod**，所以 backend 用 `localhost:8001` 调用 LLM，无需跨网络
- `/dev/tpm0` 通过 `hostPath` 挂载，容器内可直接访问 TPM 设备
- `privileged: true` 是因为访问 `/dev/tpm0` 需要权限（生产环境建议用 device plugin 替代）

## 3. 编写 Backend Service

让 Frontend 能通过 DNS 找到 Backend：

```yaml
# backend-svc.yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-svc
spec:
  selector:
    app: backend-llm
  ports:
    - port: 8000
      targetPort: 8000
  # ClusterIP 类型，集群内 DNS 解析
  type: ClusterIP
```

```bash
kubectl apply -f backend-llm.yaml
kubectl apply -f backend-svc.yaml

# 验证 Pod 运行状态
kubectl get pods -o wide

# 验证 Service
kubectl get svc backend-svc
```

## 4. 编写 Frontend Deployment

Frontend 跑在**普通节点**，不需要 TPM：

```yaml
# frontend.yaml
apiVersion: v1
kind: Deployment
metadata:
  name: frontend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: frontend
          image: <your-frontend-image>
          ports:
            - containerPort: 3000
          env:
            # 指向 Backend Service 的 DNS 名称
            - name: NEXT_PUBLIC_API_BASE
              value: "http://backend-svc.default.svc.cluster.local:8000"
```

## 5. 暴露 Frontend（华为云 CCE）

华为云 CCE 提供 `LoadBalancer` 类型的 Service，直接创建公网入口：

```yaml
# frontend-svc.yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend-svc
spec:
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 3000
  type: LoadBalancer
```

```bash
kubectl apply -f frontend-svc.yaml

# 查看外部 IP，等 ELB 分配完成
kubectl get svc frontend-svc -w
```

输出类似：
```
NAME           TYPE           CLUSTER-IP     EXTERNAL-IP     PORT(S)
frontend-svc   LoadBalancer   10.96.x.x      114.x.x.x       80:3000/TCP
```

浏览器访问 `http://114.x.x.x` 即可。

## 6. 验证通信链路

### 6.1 Frontend Pod 内验证 Backend可达

```bash
# 进入 Frontend Pod
kubectl exec -it deploy/frontend -- /bin/sh

# 测试 Backend DNS 解析
curl http://backend-svc.default.svc.cluster.local:8000/attestation

# 或者用简短名称（同一 namespace 下）
curl http://backend-svc:8000/attestation
```

### 6.2 Backend Pod 内验证 TPM 可访问

```bash
# 进入 Backend Pod
kubectl exec -it backend-llm -- /bin/sh

# 确认 TPM 设备存在
ls -l /dev/tpm0

# 如果用 tpm2-tools（容器内不一定有）
tpm2_pcrread sha256:1,4

# 或者写个 Go 小工具验证
go run github.com/google/go-tpm-tools/cmd/gotpm@latest pcr read --pcrs 1,4
```

## 7. Pod 调度优先级

如果 Node B（ TPM 节点）资源紧张，可能需要控制调度策略：

```yaml
# 用 nodeAffinity 替代 nodeSelector（更灵活）
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: hardware
                operator: In
                values:
                  - tpm-enabled
```

## 8. 常见问题

### Q：Pod 一直 Pending

通常是 `nodeSelector` 匹配的节点不存在或资源不足。检查：

```bash
kubectl describe pod backend-llm
# 找 "Events" 部分，看调度失败原因
```

### Q：/dev/tpm0 permission denied

容器内访问 `/dev/tpm0` 需要 `privileged` 或特定 CAP：

```yaml
securityContext:
  privileged: true
  # 或者更细粒度
  capabilities:
    add:
      - SYS_RAWIO
```

### Q：LLM 推理太慢 / OOM

纯 CPU 推理 qwen3.5-0.8B 约需 4-6GB 内存，CPU 4核以上：

```yaml
resources:
  memory: "6Gi"
  cpu: "4"
```

### Q：Frontend 访问 Backend 报 503

检查 Backend Pod 是否在 Running 状态，Service 是否正确匹配 selector：

```bash
kubectl get pods -o wide
kubectl get svc backend-svc -o yaml | grep selector
```

## 9. 部署顺序（按顺序执行）

```bash
# 1. 标记 TPM 节点
kubectl label node <node-b-name> hardware=tpm-enabled

# 2. 部署 Backend+LLM
kubectl apply -f backend-llm.yaml
kubectl apply -f backend-svc.yaml

# 3. 验证 Backend 正常运行
kubectl get pods -w

# 4. 部署 Frontend
kubectl apply -f frontend.yaml
kubectl apply -f frontend-svc.yaml

# 5. 等待 ELB 分配外部 IP
kubectl get svc frontend-svc -w
```

## 10. 清理

```bash
kubectl delete -f frontend-svc.yaml
kubectl delete -f frontend.yaml
kubectl delete -f backend-svc.yaml
kubectl delete -f backend-llm.yaml
```
