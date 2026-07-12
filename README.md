# Spherse

中文｜[EN](README.en.md)

一个本地运行、开箱即用的AI辅助文字创作与演绎工具。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 简介

Spherse 是一个基于 Electron + React + Fastify 的桌面应用。它提供了基础的 Agent 运行框架与核心功能，能支持用户不同的文字创作需求——包括但不限于世界观创作、角色扮演，或是个人的生活记录台。

所有数据存储在用户本地。

## 核心特性

- **本地运行，数据自主**：开箱即用，只需配置 LLM API 密钥即可使用。全本地运行，用户完全拥有自己的数据
- **多 Agent 系统**：可创建多个 Agent，各 Agent 可设置专属设定、工具、技能和聊天主题。Agent 配置和聊天记录以文件形式存在，可一键复制与迁移
- **触发器与自动化**：支持定时触发与事件触发对话，可实现 AI 自动执行任务
- **用户 HTML 与 App 双向通信**：UI SDK 支持 HTML 卡片与 App 双向通信，Agent 可渲染交互式 HTML 卡片，可实现从用户 HTML 调用 App 功能
- **高度可定制化 UI**：用户可利用 AI 打造完全属于自己的界面

## 下载与安装

前往 [Releases 页面](https://github.com/mengrru/Spherse/releases) 下载最新版本：

- **macOS**：下载 `.dmg` 文件，拖拽安装
- **Windows**：下载 `.exe` 安装包，运行安装

## 开发指南

参见 AGENTS.md。

## License

[MIT](LICENSE)
