# 🔌 交易所扩展快速指南

## 当前支持的交易所

### ✅ Backpack (完美集成)
- 实时WebSocket ✅
- ED25519认证 ✅
- 手续费优化 ✅

### 🟡 AsterDx (基础功能)
- 基础API ✅
- WebSocket连接 ✅
- 待优化认证 ⚠️

## 🚀 添加新交易所 3步法

### 第1步: 创建适配器
```bash
# 例如添加币安
touch /root/v/exchanges/binance.ts
touch /root/v/binance-adapter.ts
```

### 第2步: 实现核心接口
```typescript
// binance-adapter.ts
export class BinanceAdapter {
  // 必须实现的方法:
  async authenticate(): Promise<boolean>        // 认证
  async initWebSocket(): Promise<void>          // WebSocket
  async placeOrder(...): Promise<Order>         // 下单
  async getBalance(): Promise<Balance>          // 余额
  async getPositions(): Promise<Position[]>     // 仓位
  async getTicker(symbol: string): Promise<Ticker> // 行情
}
```

### 第3步: 集成到主系统
```typescript
// real-trading-bot.ts
import { BinanceAdapter } from './binance-adapter.ts';

const exchanges = {
  aster: new AsterAdapter(),
  backpack: new BackpackAdapter(),
  binance: new BinanceAdapter()  // ← 新增这行
};
```

## 📋 常见交易所模板

### 🏛️ 中心化交易所 (CEX)
```typescript
class CEXAdapter {
  private apiKey: string;
  private secretKey: string;
  private baseURL: string;

  // HMAC-SHA256签名认证 (通用)
  private generateSignature(params: string): string {
    return crypto.createHmac('sha256', this.secretKey)
                 .update(params).digest('hex');
  }

  // REST API调用模板
  private async request(endpoint: string, params: any) {
    const signature = this.generateSignature(queryString);
    // 发送请求...
  }
}
```

### 🌐 去中心化交易所 (DEX)
```typescript
class DEXAdapter {
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;

  // Web3钱包签名
  private async signTransaction(txData: any) {
    return await this.wallet.signTransaction(txData);
  }

  // 智能合约交互
  private async executeSwap(tokenA: string, tokenB: string, amount: number) {
    const tx = await this.contract.swap(tokenA, tokenB, amount);
    return await tx.wait();
  }
}
```

## 🔧 配置文件更新

### 环境变量
```bash
# .env 文件添加
BINANCE_API_KEY=your_api_key
BINANCE_SECRET_KEY=your_secret_key
BINANCE_TESTNET=false
```

### 配置代码
```typescript
// config.ts 添加
export const BINANCE_CONFIG = {
  API_KEY: process.env.BINANCE_API_KEY!,
  SECRET_KEY: process.env.BINANCE_SECRET_KEY!,
  BASE_URL: process.env.BINANCE_TESTNET === 'true'
    ? 'https://testnet.binance.vision'
    : 'https://api.binance.com',
  WS_URL: 'wss://stream.binance.com:9443/ws'
};
```

## 📡 WebSocket集成模板

```typescript
class ExchangeWebSocket {
  private ws: WebSocket;
  private callbacks = {
    onTrade: [] as Function[],
    onOrder: [] as Function[],
    onBalance: [] as Function[]
  };

  async connect() {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('message', (data) => {
      const message = JSON.parse(data);

      switch(message.type) {
        case 'trade':
          this.callbacks.onTrade.forEach(cb => cb(message.data));
          break;
        case 'order':
          this.callbacks.onOrder.forEach(cb => cb(message.data));
          break;
        case 'balance':
          this.callbacks.onBalance.forEach(cb => cb(message.data));
          break;
      }
    });
  }

  // 注册回调函数
  onTradeExecution(callback: (trade: any) => void) {
    this.callbacks.onTrade.push(callback);
  }
}
```

## 🎯 快速集成清单

### ✅ 基础功能
- [ ] API认证方式确定
- [ ] 基础下单功能
- [ ] 余额查询
- [ ] 仓位查询
- [ ] 行情数据获取

### ✅ WebSocket功能
- [ ] 连接建立
- [ ] 成交记录推送
- [ ] 订单状态更新
- [ ] 余额变化通知

### ✅ 错误处理
- [ ] 网络异常重连
- [ ] API限频处理
- [ ] 认证失败重试

### ✅ 测试验证
- [ ] 单元测试编写
- [ ] 沙盒环境测试
- [ ] 小额真实交易测试

## 🔍 常见交易所API特点

| 交易所 | 认证方式 | WebSocket | 特殊要求 |
|--------|----------|-----------|----------|
| Binance | HMAC-SHA256 | ✅ | 权重限制 |
| OKX | HMAC-SHA256 | ✅ | 模拟盘 |
| Bybit | HMAC-SHA256 | ✅ | 多环境 |
| Huobi | HMAC-SHA256 | ✅ | 压缩数据 |
| Uniswap | Web3签名 | GraphQL | Gas费用 |

## 📞 集成测试命令

```bash
# 测试新交易所连接
tsx test-[exchange]-connection.ts

# 验证WebSocket功能
tsx test-[exchange]-websocket.ts

# 完整功能测试
npm run test exchanges/[exchange].test.ts
```

## 🚨 注意事项

1. **🔒 安全第一**: 永远不要硬编码API密钥
2. **🧪 先测试**: 使用测试网络和沙盒环境
3. **📊 监控**: 集成到现有监控系统
4. **💰 小额开始**: 真实环境先用小额资金
5. **🔄 错误处理**: 实现完善的重试机制

---
*每个新交易所集成都要经过完整的测试流程，确保稳定可靠后再投入生产使用。*