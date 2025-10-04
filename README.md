# 🚀 AsterDx-Backpack 套利交易系统

## 📋 系统概述

专业的双交易所套利机器人，支持 AsterDx 和 Backpack 之间的自动化套利交易。系统采用模块化架构，集成 WebSocket 实时数据推送，提供完整的交易记录和统计功能。

## ✨ 核心功能

### 🎯 自动套利
- **实时价差监控**: WebSocket 双交易所价格流
- **智能开仓**: 价差 > 150 USDT 自动开仓
- **智能平仓**: 价差 < 60 USDT 自动平仓
- **并发交易**: Promise.allSettled 确保双边同步

### 📈 实时数据推送
- **📊 成交记录推送**: 实时显示成交价格、数量、手续费
- **📋 订单状态更新**: 订单创建、执行、完成状态
- **💰 账户余额变化**: 实时资产变动监控

### 📊 完整统计系统
- **交易记录**: 本地持久化存储所有交易数据
- **盈亏统计**: 实时计算开仓、平仓盈亏
- **手续费追踪**: 自动计算交易成本
- **日度报告**: 交易量、笔数、总盈亏统计

## 📊 当前配置

```typescript
// 交易参数 (config.ts)
开仓阈值: 150 USDT       // 价差达到150 USDT开仓
平仓阈值: 60 USDT        // 价差低于60 USDT平仓
交易量: 0.02 BTC         // 每次交易0.02 BTC
模式: 简化版套利          // 精简200行核心逻辑
统计: 完整本地记录        // 实时盈亏和费用统计
```

## 🏗️ 核心架构

```
├── simplified-trading-bot.ts       # 🎯 主程序 (200行精简版)
├── real-trading-bot.ts             # 📚 完整版机器人 (功能参考)
├── utils/
│   ├── enhanced-websocket-manager.ts  # 📡 WebSocket管理器
│   ├── simple-trader.ts               # 🔧 交易执行器
│   ├── trade-history.ts               # 📊 交易历史管理
│   ├── log.ts                         # 📝 日志工具
│   └── helper.ts                      # 🛠️ 辅助函数
├── exchanges/aster.ts              # 📈 AsterDx SDK
├── aster-api.ts                    # 🔌 AsterDx API接口
├── config.ts                       # ⚙️ 配置参数
├── data/
│   └── trade-history.json          # 💾 交易记录存储
└── .env                            # 🔐 API密钥配置
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
pm2 start simplified-trading-bot.ts --name simple-bot --interpreter tsx

# 查看日志
pm2 logs simple-bot

# 停止机器人
pm2 stop simple-bot

# 查看状态
pm2 status
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

## 📊 数据存储

### 交易记录格式
```json
{
  "id": "trade_1759587561438",
  "openTime": 1759587561438,
  "direction": "buy_aster_sell_backpack",
  "asterOpenPrice": 122284.6,
  "backpackOpenPrice": 122368.225,
  "amount": 0.02,
  "spread": 83.625,
  "status": "open"
}
```

### 统计报告
```
=== 📊 今日交易统计 ===
交易量: 2445.69 / ∞ USDT (100.0%)
交易笔数: 1 / ∞ (100.0%)
当前持仓: 1
今日盈亏: 0.0000 USDT
手续费: 1.835 USDT
========================
```

## 🔧 系统扩展

### 🌐 添加新交易所

**1. 创建交换器适配器**
```typescript
// exchanges/binance.ts
export class BinanceAdapter {
  async createMarketOrder(symbol: string, side: string, amount: number) {
    // 实现Binance下单逻辑
  }

  async fetchPositions() {
    // 实现仓位查询
  }
}
```

**2. 扩展WebSocket管理器**
```typescript
// utils/enhanced-websocket-manager.ts
class EnhancedWebSocketManager {
  private binanceWS: WebSocket | null = null;

  async initializeBinance() {
    // 添加Binance WebSocket连接
  }
}
```

**3. 更新交易器**
```typescript
// utils/simple-trader.ts
export class SimpleTrader {
  constructor(
    private asterPrivate: AsterAPI,
    private backpackPrivate: ccxt.backpack,
    private binancePrivate: BinanceAdapter  // 新增
  ) {}
}
```

### 📈 高级功能扩展

**1. 多币种支持**
```typescript
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const configs = SYMBOLS.map(symbol => ({
  symbol,
  amount: getAmountForSymbol(symbol),
  threshold: getThresholdForSymbol(symbol)
}));
```

**2. 动态阈值调整**
```typescript
class DynamicThreshold {
  calculateThreshold(volatility: number, volume: number): number {
    return baseThreshold + (volatility * volatilityFactor);
  }
}
```

**3. 风险管理模块**
```typescript
class RiskManager {
  checkPositionLimits(currentPositions: number): boolean {
    return currentPositions < MAX_POSITIONS;
  }

  calculateMaxAmount(balance: number, riskRatio: number): number {
    return balance * riskRatio;
  }
}
```

### 🔌 API接口扩展

**1. REST API服务**
```typescript
// api/server.ts
app.get('/api/positions', (req, res) => {
  res.json(tradeHistory.getOpenTrades());
});

app.get('/api/stats', (req, res) => {
  res.json(tradeHistory.getTodayStats());
});
```

**2. WebSocket推送服务**
```typescript
// 实时推送交易状态给前端
wsServer.broadcast({
  type: 'position_update',
  data: tradeData
});
```

## 🛡️ 安全最佳实践

### 🔐 API密钥管理
```bash
# .env 文件
ASTER_API_KEY=你的AsterDx_API_KEY
ASTER_API_SECRET=你的AsterDx_SECRET
BACKPACK_API_KEY=你的Backpack_API_KEY
BACKPACK_SECRET_KEY=你的Backpack_SECRET
```

### 🚨 风险控制
- **仓位限制**: 单次最大0.02 BTC
- **止损机制**: 异常情况自动平仓
- **资金隔离**: 专用交易账户
- **监控告警**: 异常情况邮件/短信通知

## 🔍 故障排除

### 常见问题

**1. WebSocket连接失败**
```bash
# 检查网络连接
ping api.asterdx.com
ping api.backpack.exchange

# 重启机器人
pm2 restart simple-bot
```

**2. API认证失败**
```bash
# 检查API密钥权限
# 确保开启现货交易和仓位查询权限
```

**3. 仓位不同步**
```bash
# 清理本地数据重新开始
rm /root/v/data/trade-history.json
pm2 restart simple-bot
```

## 📞 技术支持

- **项目架构**: 模块化TypeScript + Node.js
- **数据库**: 本地JSON文件存储
- **WebSocket**: 双交易所实时数据流
- **进程管理**: PM2守护进程

## 🎯 路线图

- [ ] 多币种套利支持
- [ ] 图形化监控界面
- [ ] 移动端推送通知
- [ ] 机器学习价格预测
- [ ] 去中心化交易所支持

## 📝 更新日志

### v4.0 (当前版本) - 简化架构
- ✅ **精简核心**: 从600行缩减到200行核心逻辑
- ✅ **模块化设计**: 清晰的组件分离
- ✅ **完整统计**: 本地交易记录和盈亏统计
- ✅ **实时推送**: 📈成交记录 📊订单状态 💰余额变化
- ✅ **稳定运行**: Promise.allSettled 并发处理

### v3.0
- ✅ CCXT统一架构 (AsterDx直接API + Backpack CCXT)
- ✅ 双WebSocket实时价格系统
- ✅ 禁用加仓，专注单次套利
- ✅ 优化交易参数 (150/60 USDT, 0.02 BTC)
- ✅ 完善错误处理和重连机制

---

**💡 系统优势**: 简洁、稳定、可扩展，从600行复杂代码精简为200行核心逻辑，保持所有关键功能的同时大幅提升可维护性。

**免责声明**: 本项目仅供学习研究使用。交易有风险，请确保遵守相关法规并谨慎投资。