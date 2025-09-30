# AsterDx WebSocket实现完整指南

## 🎯 概述

AsterDx WebSocket系统是aster-bot项目的核心组件，提供毫秒级的实时价格数据流。本文档详细介绍了AsterDx WebSocket的实现原理、架构设计和使用方法。

## 🏗️ 架构设计

### 双层WebSocket架构

```
📡 实时价格流
├── 🔧 Aster SDK (底层WebSocket实现)
│   ├── 连接管理: wss://fstream.asterdx.com/ws
│   ├── 心跳保活: ping/pong机制
│   ├── 自动重连: 2秒间隔重连
│   └── 事件分发: ticker、depth、账户更新
│
└── 🎯 WebSocketPriceManager (高层价格管理)
    ├── 价格缓存: bid/ask/lastPrice
    ├── 有效性验证: 30秒数据过期检查
    ├── 智能等待: 连接就绪检测
    └── 统一接口: 标准价格获取API
```

## 🔧 核心实现

### 1. Aster SDK WebSocket核心 (`exchanges/aster.ts`)

#### 连接建立
```typescript
private initWebSocket() {
    this.ws = new WebSocket(this.websocketURL); // wss://fstream.asterdx.com/ws

    this.ws.onmessage = (event: MessageEvent) => {
        // 处理 ping 帧
        if (event.data === 'ping') {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send('pong'); // 立即响应pong
            }
            return;
        }

        // 解析JSON消息
        const data = JSON.parse(event.data);
        this.handleWebSocketMessage(data);
    };
}
```

#### 心跳保活机制
```typescript
// 每4分钟发送pong保持连接
this.pongIntervalId = setInterval(() => {
    if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('pong');
    }
}, 4 * 60 * 1000); // 240秒间隔
```

#### 智能重连机制
```typescript
this.ws.onclose = () => {
    console.log('WebSocket连接关闭，准备重连...');
    if (!this.reconnectTimeoutId) {
        this.reconnectTimeoutId = setTimeout(() => {
            this.reconnectTimeoutId = undefined;
            this.initWebSocket(); // 2秒后重连
        }, 2000);
    }
};
```

### 2. 数据流订阅

#### Ticker价格流订阅
```typescript
public async watchTicker(symbol?: string, cb?: (data: any) => void) {
    const useSymbol = (symbol || this.defaultMarket).toUpperCase();
    const channel = `${useSymbol.toLowerCase()}@miniTicker`;

    if (cb) this.tickerUpdateCallbacks.push(cb);

    this.subscribe({
        params: [channel],
        id: Math.floor(Math.random() * 10000)
    });
}
```

#### Depth深度数据订阅
```typescript
public watchDepth(symbol: string, cb: (data: any) => void) {
    const channel = `${symbol.toLowerCase()}@depth5@100ms`; // 5档深度，100ms更新
    this.depthUpdateCallbacks.push(cb);
    this.subscribe({
        params: [channel],
        id: Math.floor(Math.random() * 10000)
    });
}
```

### 3. 高层价格管理 (`websocket-price-manager.ts`)

#### AsterDx WebSocket集成
```typescript
// 初始化AsterDx WebSocket
private async initAsterWebSocket(): Promise<void> {
    try {
        console.log('🔗 初始化 AsterDx WebSocket...');

        // 智能等待WebSocket连接建立
        await this.waitForWebSocketConnection();

        // 订阅ticker价格流
        this.asterSDK.watchTicker('BTCUSDT', (ticker: any) => {
            if (ticker && ticker.symbol === 'BTCUSDT') {
                this.asterPrice.lastPrice = parseFloat(ticker.lastPrice || 0);
                this.asterPrice.updateTime = Date.now();
            }
        });

        // 订阅depth深度数据
        this.asterSDK.watchDepth('BTCUSDT', (depth: any) => {
            if (depth && depth.bids.length > 0 && depth.asks.length > 0) {
                this.asterPrice.bid = parseFloat(depth.bids[0][0]);
                this.asterPrice.ask = parseFloat(depth.asks[0][0]);
                this.asterPrice.updateTime = Date.now();
                this.asterPrice.isValid = true;
            }
        });

        console.log('✅ AsterDx WebSocket连接成功');
    } catch (error) {
        console.error('❌ AsterDx WebSocket初始化失败:', error);
        setTimeout(() => this.initAsterWebSocket(), 5000);
    }
}
```

#### 智能连接等待机制
```typescript
private async waitForWebSocketConnection(): Promise<void> {
    const maxWaitTime = 5000; // 最多等待5秒
    const checkInterval = 100; // 每100ms检查一次
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
        // 检查WebSocket连接状态
        if (this.asterSDK.ws && this.asterSDK.ws.readyState === WebSocket.OPEN) {
            console.log(`⚡ AsterDx WebSocket连接就绪 (用时: ${Date.now() - startTime}ms)`);
            return;
        }

        // 等待100ms后重新检查
        await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    console.log('⚠️ WebSocket连接等待超时，继续初始化...');
}
```

## 📊 数据结构

### 价格数据接口
```typescript
interface PriceData {
    bid: number;         // 买一价
    ask: number;         // 卖一价
    lastPrice: number;   // 最新成交价
    updateTime: number;  // 更新时间戳
    isValid: boolean;    // 数据有效性
    source: 'WebSocket' | 'REST API'; // 数据来源
}
```

### Ticker数据格式
```typescript
// AsterDx ticker数据示例
{
    "e": "24hrMiniTicker",     // 事件类型
    "E": 1703123456789,        // 事件时间
    "s": "BTCUSDT",           // 交易对
    "c": "112804.80",         // 最新价格
    "o": "112500.00",         // 开盘价格
    "h": "113000.00",         // 最高价格
    "l": "112000.00",         // 最低价格
    "v": "1234.56789",        // 成交量
    "q": "138456789.12"       // 成交额
}
```

### Depth数据格式
```typescript
// AsterDx depth数据示例
{
    "e": "depthUpdate",           // 事件类型
    "E": 1703123456789,          // 事件时间
    "s": "BTCUSDT",             // 交易对
    "U": 157,                   // 第一个updateId
    "u": 160,                   // 最后一个updateId
    "b": [                      // 买单深度
        ["112804.70", "0.025"],   // [价格, 数量]
        ["112804.60", "0.100"]
    ],
    "a": [                      // 卖单深度
        ["112804.80", "0.030"],
        ["112804.90", "0.075"]
    ]
}
```

## 🔍 价格获取API

### 获取实时价格
```typescript
// 获取AsterDx价格 (带有效性验证)
getAsterPrice(): PriceData | null {
    const now = Date.now();
    const dataAge = now - this.asterPrice.updateTime;

    // 检查数据是否在30秒内更新且有效
    if (this.asterPrice.isValid && dataAge < 30000 &&
        this.asterPrice.bid > 0 && this.asterPrice.ask > 0) {
        return { ...this.asterPrice };
    }

    return null; // 无效数据返回null
}
```

### 连接状态监控
```typescript
// 检查连接状态
getConnectionStatus(): { aster: boolean; backpack: boolean } {
    return {
        aster: this.asterPrice.isValid,
        backpack: this.backpackPrice.isValid
    };
}

// 获取价格统计
getPriceStats(): string {
    const asterValid = this.asterPrice.isValid ? '✅' : '❌';
    const backpackValid = this.backpackPrice.isValid ? '✅' : '❌';

    return `📊 价格状态: AsterDx ${asterValid} | Backpack ${backpackValid}`;
}
```

## 💡 使用示例

### 基本集成
```typescript
import { WebSocketPriceManager } from './websocket-price-manager.js';

// 创建价格管理器实例
const priceManager = new WebSocketPriceManager(
    process.env.ASTER_API_KEY!,
    process.env.ASTER_API_SECRET!
);

// 初始化WebSocket连接
await priceManager.initializeAll();

// 价格监控循环
setInterval(() => {
    const asterPrice = priceManager.getAsterPrice();
    const backpackPrice = priceManager.getBackpackPrice();

    if (asterPrice && backpackPrice) {
        const spread = Math.abs(asterPrice.lastPrice - backpackPrice.lastPrice);
        console.log(`价差: ${spread.toFixed(2)} USDT`);

        // 套利逻辑
        if (spread > 120) {
            console.log('🚀 套利机会！');
        }
    } else {
        console.log('⚠️ 价格数据无效');
    }
}, 3000); // 每3秒检查一次
```

### 高级监控
```typescript
// 连接状态监控
const monitorConnection = () => {
    const status = priceManager.getConnectionStatus();
    const stats = priceManager.getPriceStats();

    console.log(stats);

    if (!status.aster) {
        console.log('❌ AsterDx WebSocket连接异常');
    }

    if (!status.backpack) {
        console.log('❌ Backpack WebSocket连接异常');
    }
};

// 每10秒监控一次连接状态
setInterval(monitorConnection, 10000);
```

## ⚡ 性能优化

### 数据缓存策略
```typescript
// 智能缓存更新 - 只在有效变化时更新
if (Math.abs(newPrice - this.asterPrice.lastPrice) > 0.1) {
    this.asterPrice.lastPrice = newPrice;
    this.asterPrice.updateTime = Date.now();
}
```

### 内存管理
```typescript
// 清理连接资源
cleanup(): void {
    if (this.backpackWS) {
        this.backpackWS.close();
    }

    // 清理定时器
    if (this.pongIntervalId) {
        clearInterval(this.pongIntervalId);
    }

    // AsterDx SDK会自动处理清理
}
```

## 🛡️ 错误处理

### WebSocket错误处理
```typescript
this.ws.onerror = (error) => {
    console.error('WebSocket错误:', error);

    // 标记数据无效
    this.asterPrice.isValid = false;

    // 触发重连
    if (this.ws.readyState !== WebSocket.CONNECTING) {
        this.initWebSocket();
    }
};
```

### 数据验证
```typescript
// 价格数据合理性检查
const isValidPrice = (price: number): boolean => {
    return price > 0 && price < 1000000 && !isNaN(price);
};

// 深度数据验证
const isValidDepth = (depth: any): boolean => {
    return depth &&
           Array.isArray(depth.bids) &&
           Array.isArray(depth.asks) &&
           depth.bids.length > 0 &&
           depth.asks.length > 0;
};
```

## 📈 监控指标

### 关键性能指标
```typescript
interface WebSocketMetrics {
    connectionUptime: number;     // 连接持续时间
    messagesReceived: number;     // 接收消息数
    reconnectCount: number;       // 重连次数
    lastPingLatency: number;      // 最近ping延迟
    dataFreshness: number;        // 数据新鲜度(ms)
}
```

### 实时监控输出
```
📊 AsterDx WebSocket状态:
├── 连接状态: ✅ 在线 (运行时间: 1h 23m)
├── 数据流: 📡 ticker + depth (更新: 0.1s前)
├── 重连次数: 0
└── 延迟: 15ms
```

## 🔧 故障排除

### 常见问题

**1. 连接失败**
```bash
# 检查网络连接
ping fstream.asterdx.com

# 检查域名解析
nslookup fstream.asterdx.com
```

**2. 认证错误**
```typescript
// 检查API密钥格式
console.log('API Key length:', process.env.ASTER_API_KEY?.length);
console.log('API Secret length:', process.env.ASTER_API_SECRET?.length);
```

**3. 数据异常**
```typescript
// 启用详细日志
const DEBUG_MODE = true;

if (DEBUG_MODE) {
    console.log('Raw ticker data:', ticker);
    console.log('Parsed price:', parseFloat(ticker.lastPrice));
}
```

## 🚀 部署建议

### 生产环境配置
```typescript
// 生产环境优化参数
const PRODUCTION_CONFIG = {
    heartbeatInterval: 30000,    // 30秒心跳
    reconnectDelay: 2000,        // 2秒重连延迟
    dataValidityPeriod: 30000,   // 30秒数据有效期
    maxReconnectAttempts: 50,    // 最大重连次数
    logLevel: 'info'             // 日志级别
};
```

### 监控告警
```typescript
// 连接异常告警
const alertOnConnectionLoss = () => {
    if (!this.asterPrice.isValid) {
        // 发送告警通知
        console.error('🚨 AsterDx WebSocket连接丢失！');
        // 可以集成到监控系统 (如 Prometheus, DataDog等)
    }
};
```

---

## 📚 相关文档

- [Backpack WebSocket集成](./backpack-websocket-guide.md)
- [价格管理API参考](./price-manager-api.md)
- [性能优化指南](./performance-optimization.md)
- [监控与告警配置](./monitoring-setup.md)

---

**技术支持**: 如遇问题请检查控制台日志，大多数WebSocket连接问题都会有详细错误信息输出。