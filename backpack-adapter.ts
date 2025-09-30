import { createHash, createHmac } from 'crypto';
import axios from 'axios';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const nacl = require('tweetnacl');
import * as bs58 from 'bs58';

interface BackpackConfig {
  apiKey: string;
  secretKey: string;
  baseURL?: string;
}

interface OrderParams {
  symbol: string;
  side: 'Bid' | 'Ask';
  orderType: 'Market' | 'Limit';
  quantity: string;
  price?: string;
  reduceOnly?: boolean;
  postOnly?: boolean;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  clientId?: number;
}

export class BackpackAdapter {
  private config: BackpackConfig;
  private baseURL: string;
  private keyPair: any;

  constructor(config: BackpackConfig) {
    this.config = config;
    this.baseURL = config.baseURL || 'https://api.backpack.exchange';

    // 初始化密钥对
    const secretBytes = this.parseSecretKey(config.secretKey);
    this.keyPair = nacl.sign.keyPair.fromSeed(secretBytes.slice(0, 32));
  }

  private parseSecretKey(secretKey: string): Uint8Array {
    try {
      // 尝试 base64 格式（Backpack常用格式）
      if (secretKey.includes('/') || secretKey.includes('+') || secretKey.includes('=')) {
        return new Uint8Array(Buffer.from(secretKey, 'base64'));
      }
      // 尝试 hex 格式
      if (secretKey.startsWith('0x') || secretKey.length === 64) {
        const hexKey = secretKey.startsWith('0x') ? secretKey.slice(2) : secretKey;
        return new Uint8Array(Buffer.from(hexKey, 'hex'));
      }
      // 尝试 bs58 格式
      return bs58.decode(secretKey);
    } catch (error) {
      console.error('Secret key parse error:', error);
      console.log('Secret key format:', secretKey.slice(0, 10) + '...');
      throw new Error('Invalid secret key format. Support hex, base64, or bs58');
    }
  }

  private sign(instruction: string, params: any = {}, timestamp?: number): any {
    const ts = timestamp || Date.now();
    const window = 5000;

    // 构建签名字符串
    let message = `instruction=${instruction}`;

    // 添加参数
    const sortedParams = Object.keys(params).sort();
    for (const key of sortedParams) {
      if (params[key] !== undefined) {
        message += `&${key}=${params[key]}`;
      }
    }

    message += `&timestamp=${ts}&window=${window}`;

    // 使用 nacl 签名
    const messageBytes = new TextEncoder().encode(message);
    const signature = nacl.sign.detached(messageBytes, this.keyPair.secretKey);

    return {
      'X-API-KEY': this.config.apiKey,
      'X-SIGNATURE': Buffer.from(signature).toString('base64'),
      'X-TIMESTAMP': ts.toString(),
      'X-WINDOW': window.toString(),
      'Content-Type': 'application/json',
    };
  }

  // 设置杠杆
  async setLeverage(symbol: string, leverage: number): Promise<any> {
    const headers = this.sign('leverageSet', { symbol, leverage });

    try {
      const response = await axios.post(
        `${this.baseURL}/api/v1/leverage`,
        { symbol, leverage },
        { headers }
      );
      return response.data;
    } catch (error: any) {
      console.error('Backpack setLeverage error:', error.response?.data || error.message);
      throw error;
    }
  }

  // 下单
  async placeOrder(params: OrderParams): Promise<any> {
    const headers = this.sign('orderExecute', params);

    try {
      const response = await axios.post(
        `${this.baseURL}/api/v1/order`,
        params,
        { headers }
      );
      console.log(`[Backpack] ${params.side} ${params.quantity} @ ${params.price || 'Market'} | ID: ${response.data?.id}`);
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || 'Unknown error';
      console.error('Backpack placeOrder error:', errorMsg);
      throw new Error(`Backpack order failed: ${errorMsg}`);
    }
  }

  // 撤单
  async cancelOrder(symbol: string, orderId: string): Promise<any> {
    const params = { symbol, orderId };
    const headers = this.sign('orderCancel', params);

    try {
      const response = await axios.delete(
        `${this.baseURL}/api/v1/order`,
        { headers, data: params }
      );
      console.log(`[Backpack] Cancelled order: ${orderId}`);
      return response.data;
    } catch (error: any) {
      console.error('Backpack cancelOrder error:', error.response?.data || error.message);
      return null;
    }
  }

  // 获取持仓
  async getPositions(): Promise<any> {
    const headers = this.sign('positionQuery');

    try {
      const response = await axios.get(
        `${this.baseURL}/api/v1/position`,
        { headers }
      );
      return response.data || [];
    } catch (error: any) {
      console.error('Backpack getPositions error:', error.response?.data || error.message);
      return [];
    }
  }

  // 获取账户信息
  async getAccount(): Promise<any> {
    const headers = this.sign('accountQuery');

    try {
      const response = await axios.get(
        `${this.baseURL}/api/v1/account`,
        { headers }
      );
      return response.data;
    } catch (error: any) {
      console.error('Backpack getAccount error:', error.response?.data || error.message);
      return null;
    }
  }

  // 获取价格 ticker
  async getTicker(symbol: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseURL}/api/v1/ticker`,
        { params: { symbol } }
      );
      return response.data;
    } catch (error: any) {
      console.error('Backpack getTicker error:', error.response?.data || error.message);
      return null;
    }
  }

  // 获取订单簿
  async getOrderBook(symbol: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseURL}/api/v1/depth`,
        { params: { symbol } }
      );
      return response.data;
    } catch (error: any) {
      console.error('Backpack getOrderBook error:', error.response?.data || error.message);
      return null;
    }
  }

  // 市价平仓
  async closePosition(symbol: string, side: 'Bid' | 'Ask', quantity: string): Promise<any> {
    return this.placeOrder({
      symbol,
      side,
      orderType: 'Market',
      quantity,
      reduceOnly: true
    });
  }
}

export default BackpackAdapter;