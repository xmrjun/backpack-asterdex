import WebSocket from 'ws';
import { Aster } from "./exchanges/aster.js";

// 价格数据接口
interface PriceData {
  bid: number;
  ask: number;
  lastPrice: number;
  updateTime: number;
  isValid: boolean;
  source: 'WebSocket' | 'REST API';
}

// WebSocket价格管理器
export class WebSocketPriceManager {
  private asterSDK: Aster;
  private backpackWS: WebSocket | null = null;

  // 价格缓存
  private asterPrice: PriceData = {
    bid: 0, ask: 0, lastPrice: 0, updateTime: 0, isValid: false, source: 'WebSocket'
  };

  private backpackPrice: PriceData = {
    bid: 0, ask: 0, lastPrice: 0, updateTime: 0, isValid: false, source: 'WebSocket'
  };

  constructor(asterApiKey: string, asterApiSecret: string) {
    this.asterSDK = new Aster(asterApiKey, asterApiSecret, 'BTCUSDT');
  }

  // 初始化所有WebSocket连接
  async initializeAll(): Promise<void> {
    console.log('🚀 初始化双WebSocket价格系统...');

    await Promise.all([
      this.initAsterWebSocket(),
      this.initBackpackWebSocket()
    ]);

    console.log('✅ 双WebSocket价格系统初始化完成');
  }

  // 初始化AsterDx WebSocket
  private async initAsterWebSocket(): Promise<void> {
    try {
      console.log('🔗 初始化 AsterDx WebSocket...');

      // 智能等待WebSocket连接建立 (最多5秒)
      await this.waitForWebSocketConnection();

      // 使用watchTicker获取实时价格数据
      this.asterSDK.watchTicker('BTCUSDT', (ticker: any) => {
        if (ticker && ticker.symbol === 'BTCUSDT') {
          this.asterPrice.lastPrice = parseFloat(ticker.lastPrice || 0);
          this.asterPrice.updateTime = Date.now();

          // 每30秒打印一次AsterDx价格更新
          if (Date.now() % 30000 < 1000) {
            console.log(`📡 AsterDx价格: ${ticker.lastPrice} (Ticker)`);
          }
        }
      });

      // 使用watchDepth获取实时bid/ask数据
      this.asterSDK.watchDepth('BTCUSDT', (depth: any) => {
        if (depth && depth.symbol === 'BTCUSDT' && depth.bids.length > 0 && depth.asks.length > 0) {
          this.asterPrice.bid = parseFloat(depth.bids[0][0]);
          this.asterPrice.ask = parseFloat(depth.asks[0][0]);
          this.asterPrice.updateTime = Date.now();
          this.asterPrice.isValid = true;

          // 每30秒打印一次深度更新
          if (Date.now() % 30000 < 1000) {
            console.log(`📊 AsterDx深度: ${this.asterPrice.bid}/${this.asterPrice.ask}`);
          }
        }
      });

      console.log('✅ AsterDx WebSocket连接成功');
    } catch (error) {
      console.error('❌ AsterDx WebSocket初始化失败:', error);
      setTimeout(() => this.initAsterWebSocket(), 5000);
    }
  }

  // 初始化Backpack WebSocket - 基于mading2项目实现
  private async initBackpackWebSocket(): Promise<void> {
    try {
      console.log('🔗 初始化 Backpack WebSocket...');

      // 使用mading2项目验证的WebSocket URL
      const wsUrl = 'wss://ws.backpack.exchange';  // 不带斜杠
      this.backpackWS = new WebSocket(wsUrl);

      this.backpackWS.on('open', () => {
        console.log('🔗 Backpack WebSocket连接成功');

        // 使用mading2项目的订阅格式
        const subscribeMessage = {
          method: 'SUBSCRIBE',
          params: [`ticker.BTC_USDC`],  // ticker.符号格式
          id: Date.now()
        };

        console.log('📡 订阅Backpack价格流:', JSON.stringify(subscribeMessage));
        this.backpackWS!.send(JSON.stringify(subscribeMessage));

        // 启动心跳保持连接
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

          // 处理PING响应
          if (message.id && message.result === 'PONG') {
            return;
          }

          // 处理订阅确认
          if (message.id && message.result === null) {
            console.log('✅ Backpack订阅确认成功');
            return;
          }

          // 处理ticker数据 - 基于mading2项目的格式
          if (message.data && message.data.e === 'ticker') {
            const tickerData = message.data;
            const price = parseFloat(tickerData.c || 0);  // c = current price

            if (price > 0) {
              // 使用实际的bid/ask如果有，否则模拟价差
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

              // 每30秒打印一次价格更新
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
        console.log(`🔌 Backpack WebSocket连接关闭 (${code}: ${reason})，5秒后重连`);
        this.backpackPrice.isValid = false;
        setTimeout(() => this.initBackpackWebSocket(), 5000);
      });

      console.log('✅ Backpack WebSocket初始化完成');
    } catch (error) {
      console.error('❌ Backpack WebSocket初始化失败:', error);
      setTimeout(() => this.initBackpackWebSocket(), 5000);
    }
  }

  // 智能等待WebSocket连接建立
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

  // 获取AsterDx价格 (纯WebSocket)
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

  // 获取Backpack价格 (纯WebSocket)
  getBackpackPrice(): PriceData | null {
    const now = Date.now();
    const dataAge = now - this.backpackPrice.updateTime;

    // 检查数据是否在30秒内更新且有效
    if (this.backpackPrice.isValid && dataAge < 30000 &&
        this.backpackPrice.bid > 0 && this.backpackPrice.ask > 0) {
      return { ...this.backpackPrice };
    }

    return null; // 无效数据返回null
  }

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

  // 清理连接
  cleanup(): void {
    if (this.backpackWS) {
      this.backpackWS.close();
    }
    // AsterDx SDK会自动处理清理
  }
}