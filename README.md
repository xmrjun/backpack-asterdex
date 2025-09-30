# AsterDx ↔ Backpack 实时套利交易机器人

## 🎯 项目介绍

这是一个专为 AsterDx 和 Backpack 交易所间进行实时套利交易的自动化机器人。采用**双WebSocket实时价格** + **CCXT统一API**架构，实现毫秒级价差捕捉和自动对冲交易，主要用于BTC合约的高频套利。

## 🚀 核心特性

- **实时价格**: 双WebSocket并行获取AsterDx + Backpack实时价格
- **极速套利**: 120 USD价差开仓，80 USD价差平仓，0.02 BTC交易量
- **智能风控**: 完善的单边风险管理，对冲失败自动清理
- **混合API**: AsterDx直接API + Backpack CCXT，稳定可靠
- **自动重连**: 网络断开自动重连，保持价格流连续性

## 📊 当前配置

```typescript
// 交易参数 (config.ts)
开仓阈值: 120 USD        // 价差达到120 USD开仓
平仓阈值: 80 USD         // 价差低于80 USD平仓
交易量: 0.02 BTC         // 每次交易0.02 BTC
加仓: 禁用               // 只做单次交易，不加仓
杠杆: 5倍               // 双交易所5倍杠杆
```

## 📂 目录结构

```
aster-bot/
├── real-trading-bot.ts          # 🎯 主交易程序
├── websocket-price-manager.ts   # 📡 双WebSocket价格管理
├── aster-api.ts                 # 🔌 AsterDx直接API封装
├── backpack-adapter.ts          # 📦 Backpack适配器(备用)
├── config.ts                    # ⚙️ 交易配置中心
├── exchanges/
│   └── aster.ts                 # 📈 AsterDx完整SDK
├── .env                         # 🔐 API密钥配置
├── package.json                 # 📦 项目依赖
└── docs/                        # 📖 文档目录
```

## ⚡ 快速启动

### 1. 配置API密钥

```bash
# 编辑 .env 文件
nano .env

# 内容示例:
ASTER_API_KEY=your_aster_api_key
ASTER_API_SECRET=your_aster_secret
BACKPACK_API_KEY=your_backpack_api_key
BACKPACK_SECRET_KEY=your_backpack_secret
```

### 2. 启动交易机器人

```bash
# 使用PM2管理进程 (推荐)
pm2 start real-trading-bot.ts --name aster-bot --interpreter npx --interpreter-args "tsx"

# 查看日志
pm2 logs aster-bot

# 停止机器人
pm2 stop aster-bot
```

## 🔧 技术架构

### WebSocket价格管理系统

**AsterDx WebSocket**:
```typescript
// exchanges/aster.ts - 完整SDK实现
- 连接: wss://fstream.asterdex.com/ws
- 数据流: miniTicker + depth5@100ms
- 心跳: ping/pong自动处理
- 重连: 2秒间隔自动重连
```

**Backpack WebSocket**:
```typescript
// websocket-price-manager.ts
- 连接: wss://ws.backpack.exchange
- 订阅: ticker.BTC_USDC
- 心跳: 30秒PING保活
- 重连: 5秒间隔重连机制
```

### 混合API架构

```typescript
// AsterDx: 直接API (解决CCXT兼容问题)
const asterPrivate = new AsterAPI({
  apiKey: process.env.ASTER_API_KEY!,
  secret: process.env.ASTER_API_SECRET!
});

// Backpack: CCXT原生支持
const backpackPrivate = new ccxt.backpack({
  apiKey: process.env.BACKPACK_API_KEY,
  secret: process.env.BACKPACK_SECRET_KEY
});
```

## 📈 交易逻辑

### 实时价差监控
```typescript
// 每3秒显示价格和价差
AsterDx: 112804.70/112804.80 (112804.75) 📡
Backpack: 112886.63/112999.57 (112943.10) 📡
价差: 138.35 USD
```

### 套利执行
1. **价差检测**: 价差 > 120 USD 触发开仓
2. **方向判断**: 自动选择套利方向
3. **同步下单**: 双交易所并发执行
4. **风控保护**: 单边失败自动清理
5. **平仓条件**: 价差 < 80 USD 自动平仓

### 日志监控
```
📊 今日交易统计
交易量: 9024.11 / ∞ USDT
交易笔数: 2 / ∞
当前持仓: 1
盈亏: 0.00 USDT
```

## 🛡️ 安全特性

### 私钥管理
- ✅ API密钥存储在`.env`文件 (权限600)
- ✅ 代码中无硬编码密钥
- ✅ `.env`已在`.gitignore`中
- ✅ 环境变量规范引用

### 风险控制
- ✅ 单边风险自动清理
- ✅ 价格数据30秒有效期验证
- ✅ WebSocket断线自动重连
- ✅ 交易失败错误处理

## 📋 配置参数

### 核心参数调整 (config.ts)
```typescript
export const TRADE_AMOUNT = 0.02;        // 交易量: 0.02 BTC
export const ARB_THRESHOLD = 120;        // 开仓: 120 USD价差
export const CLOSE_DIFF = 80;           // 平仓: 80 USD价差
export const MAX_ADD_POSITIONS = 1;      // 禁用加仓
export const ADD_POSITION_SPREAD = 9999; // 加仓阈值设为极高
```

### 性能参数
```typescript
export const TRADE_INTERVAL = 50;        // 50ms检查间隔
export const MIN_TRADE_INTERVAL = 100;   // 100ms最小交易间隔
export const FORCE_CLOSE_TIME = 30 * 60 * 1000; // 30分钟强制平仓
```

## 🔍 监控指标

### 连接状态
```typescript
📊 价格状态: AsterDx ✅ | Backpack ✅
📡 AsterDx价格: 112804.8 (Ticker)
📡 Backpack价格: 112886.6/112999.6 (112943.1)
```

### 交易执行
```typescript
✅ [AsterDex] 市价买入 0.02 | 订单ID: 5764982397
✅ [Backpack] 市价卖出 0.02 | 订单ID: 11197446312
✅ 对冲成功: buy_aster_sell_backpack
```

## ⚠️ 重要提示

### 资金准备
- 确保两个交易所都有充足USDT余额
- 建议测试环境先运行验证
- 监控账户余额变化

### 网络要求
- 稳定的网络连接 (建议云服务器)
- 低延迟网络环境
- 监控WebSocket连接状态

### 风险警示
- 套利交易存在滑点风险
- 极端行情可能导致单边风险
- 交易所维护时间需要停止机器人

## 🔧 故障排除

### 常见问题

**API认证失败**:
```bash
# 检查API密钥配置
cat .env | grep API_KEY
```

**WebSocket连接失败**:
```bash
# 检查网络连接
ping ws.backpack.exchange
```

**交易失败**:
```bash
# 检查账户余额和交易权限
pm2 logs aster-bot | grep "余额"
```

## 📚 技术文档

- [AsterDx WebSocket实现说明](./docs/asterdx-websocket-guide.md)
- [API密钥配置指南](./docs/api-setup.md)
- [风险管理机制](./docs/risk-management.md)

## 📝 更新日志

### v3.0 (当前版本)
- ✅ CCXT统一架构 (AsterDx直接API + Backpack CCXT)
- ✅ 双WebSocket实时价格系统
- ✅ 禁用加仓，专注单次套利
- ✅ 优化交易参数 (120/80 USD, 0.02 BTC)
- ✅ 完善错误处理和重连机制

### v2.0
- ✅ 双WebSocket价格管理
- ✅ 切换BTC交易
- ✅ 市价单执行
- ✅ 单边风险管理

### v1.0
- ✅ 基础套利功能
- ✅ 加仓策略
- ✅ ETH交易支持

---

**免责声明**: 本项目仅供学习研究使用。交易有风险，请确保遵守相关法规并谨慎投资。