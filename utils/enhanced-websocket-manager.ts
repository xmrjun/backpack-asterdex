// 增强WebSocket管理器 - 激活AsterDx高级功能
import WebSocket from 'ws';
import { Aster } from "../exchanges/aster.js";
import nacl from 'tweetnacl';

// 扩展价格数据接口
interface EnhancedPriceData {
  bid: number;
  ask: number;
  lastPrice: number;
  updateTime: number;
  isValid: boolean;
  source: 'WebSocket' | 'REST API';
}

// 订单状态数据
interface OrderStatusData {
  orderId: number;
  symbol: string;
  side: string;
  status: string;
  executedQty: string;
  avgPrice: string;
  updateTime: number;
  commission?: string;
  commissionAsset?: string;
}

// 账户余额数据
interface AccountBalanceData {
  asset: string;
  walletBalance: string;
  availableBalance: string;
  unrealizedProfit: string;
  updateTime: number;
}

// 成交记录数据
interface TradeExecutionData {
  orderId: number;
  symbol: string;
  side: string;
  executedQty: string;
  executedPrice: string;
  commission: string;
  commissionAsset: string;
  tradeTime: number;
  isMaker: boolean;
}

// 增强WebSocket管理器
export class EnhancedWebSocketManager {
  public asterSDK: Aster;
  private backpackWS: WebSocket | null = null;
  private backpackApiKey: string;
  private backpackSecretKey: string;

  // 数据缓存
  private asterPrice: EnhancedPriceData = {
    bid: 0, ask: 0, lastPrice: 0, updateTime: 0, isValid: false, source: 'WebSocket'
  };

  private backpackPrice: EnhancedPriceData = {
    bid: 0, ask: 0, lastPrice: 0, updateTime: 0, isValid: false, source: 'WebSocket'
  };

  // 实时数据回调
  private orderStatusCallbacks: Array<(data: OrderStatusData[]) => void> = [];
  private accountBalanceCallbacks: Array<(data: AccountBalanceData[]) => void> = [];
  private tradeExecutionCallbacks: Array<(data: TradeExecutionData) => void> = [];

  // Backpack私有WebSocket回调
  private backpackOrderCallbacks: Array<(data: any) => void> = [];
  private backpackBalanceCallbacks: Array<(data: any) => void> = [];
  private backpackTradeCallbacks: Array<(data: any) => void> = [];

  // 实时费用计算回调
  private realFeeCallbacks: Array<(data: any) => void> = [];

  // 重连管理
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000;

  constructor(asterApiKey: string, asterApiSecret: string, backpackApiKey?: string, backpackSecretKey?: string) {
    this.asterSDK = new Aster(asterApiKey, asterApiSecret, 'BTCUSDT');
    this.backpackApiKey = backpackApiKey || process.env.BACKPACK_API_KEY || '';
    this.backpackSecretKey = backpackSecretKey || process.env.BACKPACK_SECRET_KEY || '';
    console.log('🚀 初始化增强WebSocket管理器...');
  }

  // 🚀 Backpack ED25519签名生成
  private generateBackpackSignature(instruction: string, timestamp: number, window: number = 5000): [string, string] {
    try {
      // 1. 构建签名字符串
      const signatureString = `instruction=${instruction}&timestamp=${timestamp}&window=${window}`;

      // 2. 解码私钥 (Base64) - 转换为Uint8Array
      const secretKeyBytes = new Uint8Array(Buffer.from(this.backpackSecretKey, 'base64'));

      console.log(`🔍 调试信息: 签名字符串=${signatureString}, 私钥长度=${secretKeyBytes.length}`);

      // 3. 验证密钥长度 (ED25519私钥应该是64字节)
      if (secretKeyBytes.length !== 64) {
        console.log(`⚠️ 尝试从32字节种子生成密钥对...`);
        // 如果是32字节，可能是种子而不是完整私钥
        if (secretKeyBytes.length === 32) {
          const keyPair = nacl.sign.keyPair.fromSeed(secretKeyBytes);

          // 4. 签名消息
          const messageBytes = new TextEncoder().encode(signatureString);
          const signature = nacl.sign.detached(messageBytes, keyPair.secretKey);

          // 5. Base64编码
          const encodedSignature = Buffer.from(signature).toString('base64');
          const encodedPublicKey = Buffer.from(keyPair.publicKey).toString('base64');

          console.log(`🔐 Backpack签名生成成功 (种子模式): ${instruction}`);
          return [encodedPublicKey, encodedSignature];
        } else {
          throw new Error(`无效的私钥长度: ${secretKeyBytes.length}字节 (期望: 32或64字节)`);
        }
      }

      // 4. 从完整私钥创建密钥对
      const keyPair = nacl.sign.keyPair.fromSecretKey(secretKeyBytes);

      // 5. 签名消息
      const messageBytes = new TextEncoder().encode(signatureString);
      const signature = nacl.sign.detached(messageBytes, keyPair.secretKey);

      // 6. Base64编码
      const encodedSignature = Buffer.from(signature).toString('base64');
      const encodedPublicKey = Buffer.from(keyPair.publicKey).toString('base64');

      console.log(`🔐 Backpack签名生成成功: ${instruction} | 时间戳: ${timestamp}`);
      return [encodedPublicKey, encodedSignature];
    } catch (error) {
      console.error('❌ Backpack签名生成失败:', error);
      console.error('详细错误:', {
        instruction,
        timestamp,
        secretKeyLength: this.backpackSecretKey.length,
        secretKeyPreview: this.backpackSecretKey.substring(0, 10) + '...',
        errorMessage: error.message
      });
      // 私钥验证失败时不抛出错误，而是返回空值，让系统继续运行
      return ['', ''];
    }
  }

  // 🚀 订阅Backpack私有数据流
  private subscribeBackpackPrivateStream(streamName: string): void {
    if (!this.backpackWS || this.backpackWS.readyState !== WebSocket.OPEN) {
      console.error('❌ Backpack WebSocket未连接，无法订阅私有流');
      return;
    }

    try {
      const timestamp = Date.now() * 1000; // 微秒时间戳
      const window = 5000;
      const [publicKey, signature] = this.generateBackpackSignature('subscribe', timestamp, window);

      // 检查签名是否成功生成
      if (!publicKey || !signature) {
        console.error(`❌ 签名生成失败，跳过订阅 account.${streamName}`);
        return;
      }

      const subscribeMessage = {
        method: 'SUBSCRIBE',
        params: [`account.${streamName}`],
        signature: [publicKey, signature, timestamp, window],
        id: Date.now()
      };

      console.log(`📡 订阅Backpack私有流: account.${streamName}`);
      this.backpackWS.send(JSON.stringify(subscribeMessage));
    } catch (error) {
      console.error(`❌ 订阅Backpack私有流失败 (${streamName}):`, error);
    }
  }

  // 初始化所有WebSocket连接和功能
  async initializeAll(): Promise<void> {
    console.log('🚀 初始化增强双WebSocket系统...');

    await Promise.all([
      this.initAsterWebSocket(),
      this.initBackpackWebSocket()
    ]);

    console.log('✅ 增强双WebSocket系统初始化完成');
  }

  // 初始化AsterDx增强WebSocket功能
  private async initAsterWebSocket(): Promise<void> {
    try {
      console.log('🔗 初始化 AsterDx 增强WebSocket...');

      // 等待WebSocket连接建立
      await this.waitForWebSocketConnection();

      // 1. 价格数据订阅
      this.asterSDK.watchTicker('BTCUSDT', (ticker: any) => {
        if (ticker && ticker.symbol === 'BTCUSDT') {
          this.asterPrice.lastPrice = parseFloat(ticker.lastPrice || 0);
          this.asterPrice.updateTime = Date.now();

          if (Date.now() % 30000 < 1000) {
            console.log(`📡 AsterDx价格: ${ticker.lastPrice} (Ticker)`);
          }
        }
      });

      this.asterSDK.watchDepth('BTCUSDT', (depth: any) => {
        if (depth && depth.symbol === 'BTCUSDT' && depth.bids.length > 0 && depth.asks.length > 0) {
          this.asterPrice.bid = parseFloat(depth.bids[0][0]);
          this.asterPrice.ask = parseFloat(depth.asks[0][0]);
          this.asterPrice.updateTime = Date.now();
          this.asterPrice.isValid = true;

          if (Date.now() % 30000 < 1000) {
            console.log(`📊 AsterDx深度: ${this.asterPrice.bid}/${this.asterPrice.ask}`);
          }
        }
      });

      // 2. 🚀 成交记录实时推送（使用账户数据流）
      console.log('✅ AsterDx成交监听已注册（通过订单状态变化监控）');

      // 2.5 订单状态实时推送（保留原有功能）
      this.asterSDK.watchOrder((orders: any[]) => {
        const orderStatusData: OrderStatusData[] = orders.map(order => ({
          orderId: order.orderId,
          symbol: order.symbol,
          side: order.side,
          status: order.status,
          executedQty: order.executedQty,
          avgPrice: order.avgPrice,
          updateTime: order.updateTime,
          commission: order.commission,
          commissionAsset: order.commissionAsset
        }));

        // 触发所有订单状态回调
        this.orderStatusCallbacks.forEach(cb => cb(orderStatusData));

        // 检查是否有成交记录
        orders.forEach(order => {
          // 更宽松的条件：有执行数量或已成交状态
          if ((order.executedQty && parseFloat(order.executedQty) > 0) ||
              (order.status === 'FILLED' || order.status === 'PARTIALLY_FILLED')) {
            const tradeData: TradeExecutionData = {
              orderId: order.orderId,
              symbol: order.symbol,
              side: order.side,
              executedQty: order.executedQty || order.lastFilledQty || order.cumQuantity,
              executedPrice: order.avgPrice || order.lastFilledPrice || order.price,
              commission: order.commission || order.cumFee || '0',
              commissionAsset: order.commissionAsset || 'USDT',
              tradeTime: order.updateTime || order.matchTime || Date.now(),
              isMaker: order.isMaker || false
            };

            // 触发成交记录回调
            this.tradeExecutionCallbacks.forEach(cb => cb(tradeData));

            // 计算并触发实时费用回调
            const amount = parseFloat(order.executedQty || order.lastFilledQty || order.cumQuantity || '0');
            const price = parseFloat(order.avgPrice || order.lastFilledPrice || order.price || '0');
            const fee = parseFloat(order.commission || order.cumFee || '0');

            const realFeeData = {
              exchange: 'AsterDx',
              orderId: order.orderId,
              symbol: order.symbol,
              side: order.side,
              amount: amount,
              price: price,
              fee: fee,
              feeAsset: order.commissionAsset || 'USDT',
              feeRate: (amount > 0 && price > 0 && fee > 0) ? fee / (amount * price) : 0,
              isMaker: order.isMaker || false,
              timestamp: order.updateTime || order.matchTime || Date.now()
            };

            if (fee > 0 && amount > 0 && price > 0) {
              console.log(`💰 AsterDx成交: ${order.symbol} ${order.side} ${amount} @ ${price}, 手续费: ${fee.toFixed(4)} USDT`);
              console.log(`📊 费率: ${(realFeeData.feeRate * 10000).toFixed(2)}bp (${order.isMaker ? 'Maker' : 'Taker'})`);
              this.realFeeCallbacks.forEach(cb => cb(realFeeData));
            }
          }
        });

        console.log(`📊 AsterDx订单更新: ${orders.length}个订单`);
      });

      // 3. 🚀 账户余额实时推送
      this.asterSDK.watchAccount((account: any) => {
        if (account && account.assets) {
          const balanceData: AccountBalanceData[] = account.assets.map((asset: any) => ({
            asset: asset.asset,
            walletBalance: asset.walletBalance,
            availableBalance: asset.availableBalance,
            unrealizedProfit: asset.unrealizedProfit || '0',
            updateTime: asset.updateTime || Date.now()
          }));

          // 触发账户余额回调
          this.accountBalanceCallbacks.forEach(cb => cb(balanceData));

          console.log(`💰 AsterDx余额更新: ${balanceData.length}个资产`);
        }
      });

      console.log('✅ AsterDx 增强WebSocket连接成功');
    } catch (error) {
      console.error('❌ AsterDx 增强WebSocket初始化失败:', error);
      setTimeout(() => this.initAsterWebSocket(), 5000);
    }
  }

  // 🚀 初始化Backpack增强WebSocket (支持私有数据流)
  private async initBackpackWebSocket(): Promise<void> {
    try {
      console.log('🔗 初始化 Backpack 增强WebSocket...');

      const wsUrl = 'wss://ws.backpack.exchange';
      this.backpackWS = new WebSocket(wsUrl);

      this.backpackWS.on('open', () => {
        console.log('🔗 Backpack WebSocket连接成功');

        // 1. 先订阅公共价格流 (保持兼容性)
        const publicSubscribe = {
          method: 'SUBSCRIBE',
          params: [`ticker.BTC_USDC`],
          id: Date.now()
        };
        this.backpackWS!.send(JSON.stringify(publicSubscribe));
        console.log('📡 订阅Backpack公共价格流');

        // 2. 🚀 订阅私有数据流 (如果有API密钥)
        if (this.backpackApiKey && this.backpackSecretKey) {
          setTimeout(() => {
            try {
              this.subscribeBackpackPrivateStream('orderUpdate');
              this.subscribeBackpackPrivateStream('balance');
              this.subscribeBackpackPrivateStream('tradeExecution');
              console.log('✅ Backpack私有数据流订阅完成');
            } catch (error) {
              console.error('❌ Backpack私有流订阅失败:', error);
            }
          }, 1000); // 延迟1秒确保连接稳定
        } else {
          console.log('⚠️ 未配置Backpack API密钥，仅使用公共数据流');
        }

        // 3. 心跳保持
        setInterval(() => {
          if (this.backpackWS && this.backpackWS.readyState === WebSocket.OPEN) {
            const pingMsg = {
              method: 'PING',
              id: Date.now()
            };
            this.backpackWS.send(JSON.stringify(pingMsg));
          }
        }, 30000);
      });

      this.backpackWS.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          // 🔍 调试：记录所有收到的消息
          if (message.stream && message.stream.startsWith('account.')) {
            console.log('📨 收到Backpack私有消息:', JSON.stringify(message, null, 2));
          }

          // 处理PONG响应
          if (message.id && message.result === 'PONG') {
            return;
          }

          // 处理订阅确认
          if (message.id && message.result === null) {
            console.log('✅ Backpack订阅确认成功');
            return;
          }

          // 🚀 处理私有数据流
          if (message.stream && message.stream.startsWith('account.')) {
            this.handleBackpackPrivateMessage(message);
            return;
          }

          // 🔍 调试：记录其他未处理的消息
          if (!message.data || message.data.e !== 'ticker') {
            console.log('🔍 Backpack其他消息:', JSON.stringify(message, null, 2));
          }

          // 处理公共价格数据 (保持兼容性)
          if (message.data && message.data.e === 'ticker') {
            const tickerData = message.data;
            const price = parseFloat(tickerData.c || 0);

            if (price > 0) {
              const bid = tickerData.b ? parseFloat(tickerData.b) : price - (price * 0.0005);
              const ask = tickerData.a ? parseFloat(tickerData.a) : price + (price * 0.0005);

              this.backpackPrice = {
                bid: bid,
                ask: ask,
                lastPrice: price,
                updateTime: Date.now(),
                isValid: true,
                source: 'WebSocket'
              };

              if (Date.now() % 30000 < 1000) {
                console.log(`📡 Backpack价格: ${bid.toFixed(1)}/${ask.toFixed(1)} (${price.toFixed(1)})`);
              }
            }
          }

        } catch (error) {
          console.error('❌ Backpack WebSocket数据解析失败:', error);
        }
      });

      this.backpackWS.on('error', (error) => {
        console.error('❌ Backpack WebSocket错误:', error);
        this.backpackPrice.isValid = false;
      });

      this.backpackWS.on('close', (code, reason) => {
        console.log(`🔌 Backpack WebSocket连接关闭 (${code}: ${reason})`);
        this.backpackPrice.isValid = false;
        this.backpackWS = null;
        this.handleReconnect();
      });

      console.log('✅ Backpack 增强WebSocket初始化完成');
    } catch (error) {
      console.error('❌ Backpack 增强WebSocket初始化失败:', error);
      this.handleReconnect();
    }
  }

  // 处理重连逻辑
  private handleReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 30000);
      console.log(`⏳ 准备第 ${this.reconnectAttempts}/${this.maxReconnectAttempts} 次重连，延迟 ${delay}ms`);
      setTimeout(() => {
        this.initBackpackWebSocket().then(() => {
          this.reconnectAttempts = 0;
          console.log('✅ Backpack WebSocket重连成功');
        });
      }, delay);
    } else {
      console.error('❌ 达到最大重连次数，停止重连');
    }
  }

  // 🚀 处理Backpack私有消息
  private handleBackpackPrivateMessage(message: any): void {
    try {
      const { stream, data } = message;

      switch (stream) {
        case 'account.orderUpdate':
          console.log(`📊 Backpack订单更新: ${JSON.stringify(data)}`);
          this.backpackOrderCallbacks.forEach(cb => cb(data));
          break;

        case 'account.balance':
          console.log(`💰 Backpack余额更新: ${JSON.stringify(data)}`);
          this.backpackBalanceCallbacks.forEach(cb => cb(data));
          break;

        case 'account.tradeExecution':
          console.log(`📈 Backpack成交执行: ${JSON.stringify(data)}`);
          this.backpackTradeCallbacks.forEach(cb => cb(data));
          break;

        default:
          console.log(`📡 Backpack私有数据: ${stream} - ${JSON.stringify(data)}`);
      }
    } catch (error) {
      console.error('❌ Backpack私有消息处理失败:', error);
    }
  }

  // 智能等待WebSocket连接建立
  private async waitForWebSocketConnection(): Promise<void> {
    const maxWaitTime = 5000;
    const checkInterval = 100;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      if (this.asterSDK.ws && this.asterSDK.ws.readyState === WebSocket.OPEN) {
        console.log(`⚡ AsterDx WebSocket连接就绪 (用时: ${Date.now() - startTime}ms)`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    console.log('⚠️ WebSocket连接等待超时，继续初始化...');
  }

  // 🚀 新功能：注册订单状态更新回调
  onOrderStatusUpdate(callback: (orders: OrderStatusData[]) => void): void {
    this.orderStatusCallbacks.push(callback);
    console.log('📊 订单状态更新回调已注册');
  }

  // 🚀 新功能：注册账户余额变化回调
  onAccountBalanceUpdate(callback: (balances: AccountBalanceData[]) => void): void {
    this.accountBalanceCallbacks.push(callback);
    console.log('💰 账户余额更新回调已注册');
  }

  // 🚀 新功能：注册成交记录推送回调
  onTradeExecution(callback: (trade: TradeExecutionData) => void): void {
    this.tradeExecutionCallbacks.push(callback);
    console.log('📈 成交记录推送回调已注册');
  }

  // 🚀 新功能：注册Backpack订单状态更新回调
  onBackpackOrderUpdate(callback: (data: any) => void): void {
    this.backpackOrderCallbacks.push(callback);
    console.log('📊 Backpack订单状态更新回调已注册');
  }

  // 🚀 新功能：注册Backpack账户余额变化回调
  onBackpackBalanceUpdate(callback: (data: any) => void): void {
    this.backpackBalanceCallbacks.push(callback);
    console.log('💰 Backpack余额更新回调已注册');
  }

  // 🚀 新功能：注册Backpack成交记录推送回调
  onBackpackTradeExecution(callback: (data: any) => void): void {
    this.backpackTradeCallbacks.push(callback);
    console.log('📈 Backpack成交记录推送回调已注册');
  }

  // 获取价格数据 (保持原有接口)
  getAsterPrice(): EnhancedPriceData | null {
    const now = Date.now();
    const dataAge = now - this.asterPrice.updateTime;

    if (this.asterPrice.isValid && dataAge < 30000 &&
        this.asterPrice.bid > 0 && this.asterPrice.ask > 0) {
      return { ...this.asterPrice };
    }

    return null;
  }

  getBackpackPrice(): EnhancedPriceData | null {
    const now = Date.now();
    const dataAge = now - this.backpackPrice.updateTime;

    if (this.backpackPrice.isValid && dataAge < 30000 &&
        this.backpackPrice.bid > 0 && this.backpackPrice.ask > 0) {
      return { ...this.backpackPrice };
    }

    return null;
  }

  // 检查连接状态
  getConnectionStatus(): { aster: boolean; backpack: boolean } {
    return {
      aster: this.asterPrice.isValid,
      backpack: this.backpackPrice.isValid
    };
  }

  // 注册实时费用回调
  onRealFee(callback: (data: any) => void): void {
    this.realFeeCallbacks.push(callback);
  }

  // 获取增强功能状态
  getEnhancedStatus(): string {
    const asterOrderCallbacks = this.orderStatusCallbacks.length;
    const asterBalanceCallbacks = this.accountBalanceCallbacks.length;
    const asterTradeCallbacks = this.tradeExecutionCallbacks.length;

    const backpackOrderCallbacks = this.backpackOrderCallbacks.length;
    const backpackBalanceCallbacks = this.backpackBalanceCallbacks.length;
    const backpackTradeCallbacks = this.backpackTradeCallbacks.length;

    return `🚀 增强功能: AsterDx[订单${asterOrderCallbacks}|余额${asterBalanceCallbacks}|成交${asterTradeCallbacks}] Backpack[订单${backpackOrderCallbacks}|余额${backpackBalanceCallbacks}|成交${backpackTradeCallbacks}]`;
  }

  // 获取价格统计
  getPriceStats(): string {
    const asterValid = this.asterPrice.isValid ? '✅' : '❌';
    const backpackValid = this.backpackPrice.isValid ? '✅' : '❌';

    return `📊 价格状态: AsterDx ${asterValid} | Backpack ${backpackValid}`;
  }

  // 清理连接
  cleanup(): void {
    if (this.backpackWS) {
      this.backpackWS.close();
    }
    if (this.asterSDK) {
      this.asterSDK.close();
    }
  }
}