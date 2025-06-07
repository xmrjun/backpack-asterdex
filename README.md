# bitget-aster-bot 说明文档

## 项目简介

bitget-aster-bot 是一个用于在 Bitget 交易所和 AsterDex 之间进行自动化交易和监控的机器人。该项目支持行情监听、自动下单、策略执行等功能，适用于数字货币量化交易和套利等场景。

## 项目原理

本项目通过调用 Bitget 和 AsterDex 的 API，实现以下核心功能：

1. 实时监听行情：通过 WebSocket 或定时轮询方式，获取交易对的最新价格和深度信息。
2. 自动化下单：根据预设策略，自动在 Bitget 或 AsterDex 上进行买入、卖出操作。
3. 策略执行：支持自定义交易策略，如价格差套利、定投等。
4. 风控与日志：内置基础风控逻辑，记录所有操作日志，便于追踪和复盘。

API 文档参考：
- [AsterDex API 文档（中文）](https://github.com/asterdex/api-docs/blob/master/aster-finance-api_CN.md)
- [Bitget API 文档（中文）](https://www.bitget.com/zh-CN/api-doc/)

## 安装与运行

### 依赖环境

- Node.js 16 及以上
- pnpm 包管理器

### 安装依赖

```bash
pnpm install
```

### 配置

请在 .env 文件中配置相关参数，例如 API Key、Secret、监听的交易对等。

```env
BITGET_API_KEY=你的Bitget_API_Key
BITGET_SECRET=你的Bitget_Secret
ASTER_API_KEY=你的AsterDex_API_Key
# 其他配置项
```

### 启动机器人

```bash
pnpm start
```
或
```bash
node bot.ts
```

### 运行测试

```bash
pnpm test
```
或
```bash
node test.ts
```

## 主要文件说明

- bot.ts：主机器人逻辑，包含行情监听、下单、策略等核心功能。
- config.ts：配置文件，填写 API 密钥等参数。
- watch.ts：行情监控与辅助功能。
- test.ts：测试脚本，用于验证各模块功能。

## 使用方法

1. 配置好 API 密钥等参数。
2. 启动机器人，观察日志输出，确认连接正常。
3. 根据需求修改策略逻辑（可在 bot.ts 或 watch.ts 中自定义）。
4. 运行测试脚本，确保功能正常。

## 注意事项

- 请妥善保管 API 密钥，避免泄露。
- 机器人涉及真实资金操作，请先在测试环境验证策略安全性。
- 参考官方 API 文档，确保接口调用方式正确。

---

如需更详细的说明或有其他定制需求，请补充具体问题！

