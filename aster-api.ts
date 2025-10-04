import crypto from 'crypto';
import axios from 'axios';

interface AsterConfig {
  apiKey: string;
  secret: string;
  baseURL?: string;
}

interface OrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quantity: string;
  price?: string;
  reduceOnly?: boolean;
}

export class AsterAPI {
  private config: AsterConfig;
  private baseURL: string;

  constructor(config: AsterConfig) {
    this.config = config;
    this.baseURL = config.baseURL || 'https://fapi.asterdex.com';
  }

  private createSignature(queryString: string): string {
    return crypto.createHmac('sha256', this.config.secret).update(queryString).digest('hex');
  }

  // 获取账户信息
  async fetchBalance(): Promise<any> {
    const timestamp = Date.now().toString();
    const queryString = `timestamp=${timestamp}`;
    const signature = this.createSignature(queryString);

    const url = `${this.baseURL}/fapi/v1/account?${queryString}&signature=${signature}`;

    const response = await axios.get(url, {
      headers: {
        'X-MBX-APIKEY': this.config.apiKey,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  }

  // 获取价格
  async fetchTicker(symbol: string): Promise<any> {
    const response = await axios.get(`${this.baseURL}/fapi/v1/ticker/24hr`, {
      params: { symbol }
    });
    return response.data;
  }

  // 下限价单
  async createOrder(symbol: string, type: 'limit' | 'market', side: 'buy' | 'sell', amount: number, price?: number, params?: any): Promise<any> {
    const orderParams: any = {
      symbol: symbol,
      side: side.toUpperCase(),
      type: type.toUpperCase(),
      quantity: amount.toString(),
      timestamp: Date.now().toString()
    };

    if (type === 'limit' && price) {
      orderParams.price = price.toString();
    }

    if (params?.reduceOnly) {
      orderParams.reduceOnly = 'true';
    }

    const orderQueryString = Object.entries(orderParams)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');

    const signature = this.createSignature(orderQueryString);

    const response = await axios.post(`${this.baseURL}/fapi/v1/order`,
      `${orderQueryString}&signature=${signature}`, {
      headers: {
        'X-MBX-APIKEY': this.config.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const data = response.data;

    // 🔍 调试：打印原始API响应
    console.log('🔍 AsterDx原始API响应:', JSON.stringify(data, null, 2));

    // 直接返回原始数据，保留所有字段
    return data;
  }

  // 下市价单
  async createMarketOrder(symbol: string, side: 'buy' | 'sell', amount: number, price?: number, params?: any): Promise<any> {
    const orderParams: any = {
      symbol: symbol,
      side: side.toUpperCase(),
      type: 'MARKET',
      quantity: amount.toString(),
      timestamp: Date.now().toString()
    };

    if (params?.reduceOnly) {
      orderParams.reduceOnly = 'true';
    }

    const orderQueryString = Object.entries(orderParams)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');

    const signature = this.createSignature(orderQueryString);

    const response = await axios.post(`${this.baseURL}/fapi/v1/order`,
      `${orderQueryString}&signature=${signature}`, {
      headers: {
        'X-MBX-APIKEY': this.config.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const data = response.data;

    // 🔍 调试：打印原始API响应
    console.log('🔍 AsterDx原始API响应:', JSON.stringify(data, null, 2));

    // 直接返回原始数据，保留所有字段
    return data;
  }

  // 查询订单状态（获取成交价格）
  async fetchOrder(orderId: string, symbol: string): Promise<any> {
    const timestamp = Date.now().toString();
    const queryString = `orderId=${orderId}&symbol=${symbol}&timestamp=${timestamp}`;
    const signature = this.createSignature(queryString);

    const url = `${this.baseURL}/fapi/v1/order?${queryString}&signature=${signature}`;

    try {
      const response = await axios.get(url, {
        headers: {
          'X-MBX-APIKEY': this.config.apiKey,
          'Content-Type': 'application/json'
        }
      });

      console.log('📊 订单状态查询:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error('❌ 查询订单失败:', error);
      throw error;
    }
  }

  // 查询持仓
  async fetchPositions(): Promise<any> {
    const timestamp = Date.now().toString();
    const queryString = `timestamp=${timestamp}`;
    const signature = this.createSignature(queryString);

    const url = `${this.baseURL}/fapi/v1/positionRisk?${queryString}&signature=${signature}`;

    try {
      const response = await axios.get(url, {
        headers: {
          'X-MBX-APIKEY': this.config.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('❌ 查询持仓失败:', error);
      throw error;
    }
  }
}

export default AsterAPI;