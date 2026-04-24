# Slock 调研报告

> 调研时间：2026-04-07
> 信息来源：X (@istdrc)、slock.ai 官网、公开搜索

---

## 1. 产品概述

**Slock** 是一个 **agent-native IM 协作平台**，核心理念是让 AI agent 成为一等公民（first-class citizen），与人类在同一个即时通讯环境中平等协作。

| 属性 | 信息 |
|------|------|
| 官网 | [slock.ai](https://slock.ai/) |
| 创始人 | **RC**（Richard Chien，X: [@istdrc](https://x.com/istdrc)） |
| 背景 | 前 Moonshot AI，主导开发了 **Kimi CLI**（Kimi 命令行 agent） |
| 定位 | Agent-Human Collaboration Platform / 下一代生产力协作平台 |
| Tagline | "Where humans and AI agents collaborate" |
| 阶段 | 快速迭代中，已初具可用性 |

---

## 2. 创始人背景

**RC (stdrc)** 是一位有深厚 CLI/Agent 工程经验的开发者：

- 在 **Moonshot AI** 主导开发了 [Kimi CLI](https://platform.moonshot.cn/docs/guide/kimi-cli-support) —— Kimi 大模型的命令行 agent
- 开源了 [Kimi Agent SDK](https://github.com/MoonshotAI/kimi-agent-sdk)
- 曾用 **一个周末用 Rust 重写 Kimi CLI**（[slides](https://slides.com/stdrc/rust-kimi-cli)）
- 集成了 [Toad](https://x.com/istdrc/status/2006680412349935794)（@willmcgugan 的 TUI 框架）作为 Kimi CLI 的可选 UI 模式
- 离开 Moonshot 后创建 Slock，定位从 CLI agent 转向 **IM 协作平台**

---

## 3. 产品特性（已发布）

> 来源：[RC 的 X 帖子（2026-04-05）](https://x.com/istdrc/status/2040862482622026076)

### 3.1 近期发布的功能

| 功能 | 说明 |
|------|------|
| **Search** | 全平台搜索 |
| **Thread Inbox** | 线程收件箱 |
| **Saved Messages** | 消息收藏 |
| **Message Permalinks** | 消息永久链接 |
| **Pinned Chats** | 置顶聊天 |
| **Server Join Links** | 服务器邀请链接 |
| **Consistent Color System** | 统一的颜色系统 |
| **Codex CLI Agent** | 支持添加 [Codex CLI](https://x.com/istdrc/status/2028403518244270328) 驱动的 agent |

### 3.2 核心设计理念

从 RC 的公开发言中可以总结出 Slock 的设计哲学：

1. **Agent-native IM** — 不是在传统 IM 上加 AI 插件，而是从第一天就把 agent 作为一等公民设计
2. **下一代生产力协作平台** — 不只是聊天工具，目标是重新定义团队协作方式
3. **开放集成** — 支持接入多种 agent 后端（如 Codex CLI），不绑定单一 AI 提供商
4. **面向 builder 和团队** — 目标用户是开发者和技术团队

---

## 4. 市场定位

### 4.1 与 Slack 的关系

RC 在一条推文中提到：

> "被 Slack 删除 workspace 的中国公司可以试试 Slock，我们正在定义的下一代生产力协作平台，还在疯狂迭代打磨，不过已经初具可用性"
>
> — [@istdrc, 2026-04-03](https://x.com/istdrc/status/2039960951789961401)

这暗示 Slock 有意承接被 Slack 封禁的中国公司用户，同时通过 agent-native 的差异化定位超越传统 IM。

### 4.2 竞品格局

| 产品 | 定位 | Agent 支持 |
|------|------|-----------|
| **Slack** | 企业 IM + AI 插件 | Agentforce（Salesforce 生态），后装式 |
| **Discord** | 社区 IM + Bot 生态 | Bot API，非原生 agent |
| **Basecamp** | 项目管理 + Agent CLI | 新推 agent-native CLI（2026） |
| **Slock** | **Agent-native IM** | 第一天就设计为 agent-human 共存 |

Slock 的差异化在于：**不是在已有 IM 上加 AI，而是为 AI 协作重新设计 IM**。

---

## 5. 技术亮点

基于 RC 的背景和公开信息推断：

1. **Kimi CLI 经验迁移** — RC 在 CLI agent 领域有深入积累，Slock 的 agent 集成可能继承了 Kimi CLI 的架构思路
2. **Rust 工程能力** — RC 曾用 Rust 重写 Kimi CLI，Slock 的后端可能也有 Rust 组件
3. **快速原型** — Slock 的核心功能在春节期间（约 7 天）完成了初版开发
4. **Codex CLI 集成** — 已支持 OpenAI Codex CLI 作为 agent 后端，表明平台的 agent 接入是开放的

---

## 6. 路线图推测

> 注意：以下为基于公开信息的推测，非官方路线图

### 短期（已在推进）
- 持续迭代核心 IM 功能（搜索、线程、消息管理）
- 扩展 agent 接入类型（已有 Codex CLI，可能接入更多 CLI agent）
- 色彩系统和 UI 打磨

### 中期（可能方向）
- 多 agent 协作场景（团队中多个 agent 各司其职）
- Agent marketplace 或 agent 模板
- 企业版 / 私有化部署（针对中国企业市场）
- 权限和审批流（agent 行动的人类审批）

### 长期（愿景推测）
- 成为 "agent 时代的 Slack" —— 人机协作的默认平台
- 从 IM 扩展到工作流自动化
- 跨 agent 框架的统一协作层

---

## 7. 关键 X 帖子索引

| 日期 | 内容 | 链接 |
|------|------|------|
| 2026-04-05 | 大批新功能发布（search, thread inbox, saved messages 等） | [链接](https://x.com/istdrc/status/2040862482622026076) |
| 2026-04-03 | 面向被 Slack 封禁的中国公司推介 Slock | [链接](https://x.com/istdrc/status/2039960951789961401) |
| 2026-03 | Slock 支持 Codex CLI agent | [链接](https://x.com/istdrc/status/2028403518244270328) |
| 2026-03 | "try Slock at slock.ai" | [链接](https://x.com/istdrc/status/2031244380422680845) |
| 2026-02 | 集成 Toad TUI 到 Kimi CLI | [链接](https://x.com/istdrc/status/2006680412349935794) |

---

## 8. 一句话总结

> Slock 是前 Moonshot AI Kimi CLI 开发者 RC 创建的 **agent-native IM 协作平台**，核心差异化在于"不是给 IM 加 AI，而是为 AI 协作重新设计 IM"，目前处于快速迭代阶段，已具备搜索、线程、消息管理等基础 IM 能力，并支持 Codex CLI 等 agent 接入。
