# Agent Chat 项目规则

## 双端适配

- 手机端和桌面端更新必须同时适配；任何功能、设置、传输、UI、写回或发布变更，都要说明 desktop 与 mobile 的行为。
- desktop 默认保留本地 CLI 执行路径，除非用户明确要求改成 Bridge 或其他远程传输。
- mobile 默认使用桌面 Bridge；如果 Bridge URL/token 不完整，必须保持可读提示和工作台/派单兜底，不能静默失败。
- 涉及执行链路时，测试要覆盖 desktop local 与 mobile Bridge/fallback 两侧。
- Bridge token、局域网真实地址、模型密钥、GitHub token、cookie 等敏感信息不能写入仓库、release 说明或普通 Obsidian 总结页。
