import crypto from 'crypto';

type StringBoolean = "true" | "false";

type DepthLimit = 5 | 10 | 20 | 50 | 100 | 500 | 1000;

interface KlineParams {
    symbol: string;
    interval: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
}

interface SubscribeParams {
    method?: string;
    params: string[];
    id: number;
}

type MarginType = "ISOLATED" | "CROSSED";

type OrderSide = "BUY" | "SELL";
type PositionSide = "BOTH" | "LONG" | "SHORT";
type OrderType = "LIMIT" | "MARKET" | "STOP" | "STOP_MARKET" | "TAKE_PROFIT" | "TAKE_PROFIT_MARKET" | "TRAILING_STOP_MARKET";
type TimeInForce = "GTC" | "IOC" | "FOK";
type WorkingType = "MARK_PRICE" | "CONTRACT_PRICE";

interface CreateOrderParams {
    symbol: string;
    side: OrderSide;
    positionSide?: PositionSide;
    type: OrderType;
    reduceOnly?: StringBoolean;
    quantity?: number;
    price?: number;
    newClientOrderId?: string;
    stopPrice?: number;
    closePosition?: StringBoolean;
    activationPrice?: number;
    callbackRate?: number;
    timeInForce?: TimeInForce;
    workingType?: WorkingType;
    recvWindow?: number;
    timestamp: number;
}

export class Aster {
    baseURL: string;
    websocketURL: string;
    ws: WebSocket;
    private accountUpdateCallbacks: Array<(data: any) => void> = [];
    private listenKey?: string;
    private pongIntervalId?: ReturnType<typeof setInterval>;

    constructor(private readonly apiKey: string, private readonly apiSecret: string) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.baseURL = 'https://fapi.asterdex.com';
        this.websocketURL = 'wss://fstream.asterdex.com/ws';

        this.ws = new WebSocket(this.websocketURL);
        this.ws.onmessage = (event: MessageEvent) => {
            console.log('onmessage', event.data);
            // 处理 ping 帧和 json 消息
            if (typeof event.data === 'string') {
                const text = event.data.trim();
                // 1. 处理 ping 帧
                if (text === 'ping') {
                    if (this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send('pong');
                    }
                    return;
                }
                // 2. 只尝试解析 json 格式
                if (text.startsWith('{') || text.startsWith('[')) {
                    try {
                        const data = JSON.parse(text);
                        // 只处理账户更新事件
                        if (data.e === 'ACCOUNT_UPDATE') {
                            this.accountUpdateCallbacks.forEach(cb => cb(data));
                        }
                    } catch (e) {
                        // 非法 json 忽略
                    }
                }
                // 其它非 json、非 ping 消息忽略
            }
        };
        // 连接成功后再订阅用户数据流
        this.ws.onopen = () => {
            this.subscribeUserData();
            // 定时发送pong帧，防止被服务端断开
            this.pongIntervalId = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send('pong');
                }
            }, 4 * 60 * 1000); // 每4分钟发一次
        };
        this.ws.onclose = () => {
            if (this.pongIntervalId) {
                clearInterval(this.pongIntervalId);
                this.pongIntervalId = undefined;
            }
        };
    }

    private async publicRequest(path: string, method: string, params: any) {
        const url = `${this.baseURL}${path}`;
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
        });
        const data = await response.json();
        return data;
    }

    private generateSignature(params: any) {
        // 1. 参数按key排序
        const ordered = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
        // 2. HMAC SHA256签名
        return crypto.createHmac('sha256', this.apiSecret).update(ordered).digest('hex');
    }

    private async signedRequest(path: string, method: string, params: any) {
        // 1. 添加timestamp和recvWindow
        const timestamp = Date.now();
        const recvWindow = params.recvWindow || 5000;
        const fullParams = { ...params, timestamp, recvWindow };
        // 2. 生成签名
        const signature = this.generateSignature(fullParams);
        // 3. 拼接参数字符串
        const paramStr = Object.keys(fullParams).sort().map(key => `${key}=${fullParams[key]}`).join('&');
        const bodyStr = `${paramStr}&signature=${signature}`;
        // 4. 发送请求
        const url = `${this.baseURL}${path}`;
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-MBX-APIKEY': this.apiKey,
            },
            body: bodyStr,
        });
        const data = await response.json();
        return data;
    }

    public async ping() {
        const data = await this.publicRequest('/fapi/v1/ping', 'GET', {});
        return data;
    }

    public async time() {
        const data = await this.publicRequest('/fapi/v1/time', 'GET', {});
        return data;
    }

    public async getExchangeInfo() {
        const data = await this.publicRequest('/fapi/v1/exchangeInfo', 'GET', {});
        return data;
    }

    public async getDepth(symbol: string, limit: DepthLimit = 5) {
        const data = await this.publicRequest(`/fapi/v1/depth?symbol=${symbol}&limit=${limit}`, 'GET', {});
        return data;
    }

    public async getRecentTrades(symbol: string, limit: number = 500) {
        const data = await this.publicRequest(`/fapi/v1/trades?symbol=${symbol}&limit=${limit}`, 'GET', {});
        return data;
    }

    public async getHistoricalTrades(symbol: string, limit: number = 500) {
        const data = await this.publicRequest(`/fapi/v1/historicalTrades?symbol=${symbol}&limit=${limit}`, 'GET', {});
        return data;
    }

    public async getAggregatedTrades(params: {
        symbol: string;
        fromId?: number;
        startTime?: number;
        endTime?: number;
        limit?: number;
    }) {
        const data = await this.publicRequest(`/fapi/v1/aggTrades?symbol=${params.symbol}&fromId=${params.fromId}&startTime=${params.startTime}&endTime=${params.endTime}&limit=${params.limit}`, 'GET', {});
        return data;
    }

    public async getKlines(params: KlineParams) {
        const data = await this.publicRequest(`/fapi/v1/klines?symbol=${params.symbol}&interval=${params.interval}&startTime=${params.startTime}&endTime=${params.endTime}&limit=${params.limit}`, 'GET', {});
        return data;
    }

    public async getIndexPriceKlines(params: KlineParams) {
        const data = await this.publicRequest(`/fapi/v1/indexPriceKlines?symbol=${params.symbol}&interval=${params.interval}&startTime=${params.startTime}&endTime=${params.endTime}&limit=${params.limit}`, 'GET', {});
        return data;
    }

    public async getMarkPriceKlines(params: KlineParams) {
        const data = await this.publicRequest(`/fapi/v1/markPriceKlines?symbol=${params.symbol}&interval=${params.interval}&startTime=${params.startTime}&endTime=${params.endTime}&limit=${params.limit}`, 'GET', {});
        return data;
    }

    public async getPremiumIndexPrice(symbol: string) {
        const data = await this.publicRequest(`/fapi/v1/premiumIndexPrice?symbol=${symbol}`, 'GET', {});
        return data;
    }

    public async getFundingRate(params: {
        symbol: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
    }) {
        const data = await this.publicRequest(`/fapi/v1/fundingRate?symbol=${params.symbol}&startTime=${params.startTime}&endTime=${params.endTime}&limit=${params.limit}`, 'GET', {});
        return data;
    }

    public async getTicker(symbol: string) {
        const data = await this.publicRequest(`/fapi/v1/ticker/24hr?symbol=${symbol}`, 'GET', {});
        return data;
    }

    public async getTickerPrice(symbol: string) {
        const data = await this.publicRequest(`/fapi/v1/ticker/price?symbol=${symbol}`, 'GET', {});
        return data;
    }

    public async getTickerBookTicker(symbol: string) {
        const data = await this.publicRequest(`/fapi/v1/ticker/bookTicker?symbol=${symbol}`, 'GET', {});
        return data;
    }

    /**
     * WebSocket
     */

    public async subscribe(params: SubscribeParams) {
        const msg = JSON.stringify({ ...params, method: 'SUBSCRIBE' });
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(msg);
        } else {
            this.ws.addEventListener('open', () => {
                this.ws.send(msg);
            }, { once: true });
        }
    }

    public async unsubscribe(params: SubscribeParams) {
        const msg = JSON.stringify({ ...params, method: 'UNSUBSCRIBE' });
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(msg);
        } else {
            this.ws.addEventListener('open', () => {
                this.ws.send(msg);
            }, { once: true });
        }
    }

    public async close() {
        this.ws.close();
        if (this.pongIntervalId) {
            clearInterval(this.pongIntervalId);
            this.pongIntervalId = undefined;
        }
    }

    public async subscribeAggregatedTrade(symbol: string) {
        this.subscribe({ params: [`${symbol}@aggTrade`], id: 1 });
    }

    public async subscribeMarkPrice(symbol: string) {
        this.subscribe({ params: [`${symbol}@markPrice`], id: 2 });
    }

    public async subscribeKline(symbol: string, interval: string) {
        this.subscribe({ params: [`${symbol}@kline_${interval}`], id: 3 });
    }

    public async subscribeMiniTicker(symbol: string) {
        this.subscribe({ params: [`${symbol}@miniTicker`], id: 4 });
    }

    public async subscribeAllMarketMiniTicker() {
        this.subscribe({ params: [`!miniTicker@arr`], id: 5 });
    }

    public async subscribeTicker(symbol: string) {
        this.subscribe({ params: [`${symbol}@ticker`], id: 6 });
    }

    public async subscribeAllMarketTicker() {
        this.subscribe({ params: [`!ticker@arr`], id: 7 });
    }

    public async subscribeBookTicker(symbol: string) {
        this.subscribe({ params: [`${symbol}@bookTicker`], id: 8 });
    }

    public async subscribeAllMarketBookTicker() {
        this.subscribe({ params: [`!bookTicker`], id: 9 });
    }

    public async subscribeForceOrder(symbol: string) {
        this.subscribe({ params: [`${symbol}@forceOrder`], id: 10 });
    }

    public async subscribeDepth(symbol: string, levels: number) {
        this.subscribe({ params: [`${symbol}@depth${levels}@100ms`], id: 11 });
    }

    public async postPositionSide(params: { dualSidePosition: string; recvWindow?: number; timestamp: number }) {
        const data = await this.signedRequest('/fapi/v1/positionSide/dual', 'POST', params);
        return data;
    }

    public async getPositionSide(timestamp: number) {
        const data = await this.signedRequest('/fapi/v1/positionSide/dual', 'GET', { timestamp });
        return data;
    }

    public async postMargin(params:{
        multiAssetsMargin: "true" | "false",
        recvWindow?: number,
        timestamp: number
    }) {
        const data = await this.signedRequest('/fapi/v1/margin/type', 'POST', params);
        return data;
    }

    public async getMargin(timestamp: number) {
        const data = await this.signedRequest('/fapi/v1/margin/type', 'GET', { timestamp });
        return data;
    }

    public async createOrder(params: CreateOrderParams) {
        const data = await this.signedRequest('/fapi/v1/order', 'POST', params);
        return data;
    }

    public async createTestOrder(params: CreateOrderParams) {
        const data = await this.signedRequest('/fapi/v1/order/test', 'POST', params);
        return data;
    }

    public async createOrders(params: {
        batchOrders: CreateOrderParams[];
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/batchOrders', 'POST', params);
        return data;
    }

    public async getOrder(params: {
        symbol: string;
        orderId?: number;
        origClientOrderId?: string;
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/order', 'GET', params);
        return data;
    }

    public async cancelOrder(params: {
        symbol: string;
        orderId?: number;
        origClientOrderId?: string;
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/order', 'DELETE', params);
        return data;
    }

    public async cancelOrders(params: {
        symbol: string;
        orderIdList?: number[];
        origClientOrderIdList?: string[];
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/batchOrders', 'DELETE', params);
        return data;
    }

    public async cancelAllOrders(params: {
        symbol: string;
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/allOpenOrders', 'DELETE', params);
        return data;
    }

    public async countdownCancelAllOrders(params: {
        symbol: string;
        countdownTime: number;
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/countdownCancelAll', 'POST', params);
        return data;
    }

    public async getOpenOrder(params: {
        symbol: string;
        orderId?: number;
        origClientOrderId?: string;
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/openOrder', 'GET', params);
        return data;
    }

    public async getOpenOrders(params: {
        symbol?: string;
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/openOrders', 'GET', params);
        return data;
    }

    public async getAllOrders(params: {
        symbol?: string;
        orderId?: number;
        startTime?: number;
        endTime?: number;
        limit?: number;
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/allOrders', 'GET', params);
        return data;
    }

    public async getBalance(timestamp: number) {
        const data = await this.signedRequest('/fapi/v2/balance', 'GET', { timestamp });
        return data;
    }

    public async getAccount(timestamp: number) {
        const data = await this.signedRequest('/fapi/v2/account', 'GET', { timestamp });
        return data;
    }

    public async setLeverage(params: {
        symbol: string;
        leverage: number;
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/leverage', 'POST', params);
        return data;
    }

    public async setMarginType(params: {
        symbol: string;
        marginType: MarginType;
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/marginType', 'POST', params);
        return data;
    }

    public async setPositionMargin(params: {
        symbol: string;
        positionSide?: PositionSide;
        amount: number;
        type: 1 | 2;
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/positionMargin', 'POST', params);
        return data;
    }

    public async getPositionMarginHistory(params: {
        symbol: string;
        type: 1 | 2;
        startTime?: number;
        endTime?: number;
        limit?: number;
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/positionMargin/history', 'GET', params);
        return data;
    }

    public async getPositionRisk(params:{
        symbol?: string;
        recvWindow?: number;
        timestamp: number;
    }) {
        const data = await this.signedRequest('/fapi/v2/positionRisk', 'GET', params);
        return data;
    }

    public async getUserTrades(params: {
        symbol?: string;
        startTime?: number;
        endTime?: number;
        fromId?: number;
        limit?: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/userTrades', 'GET', params);
        return data;
    }

    public async getIncome(params: {
        symbol?: string;
        incomeType?: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/income', 'GET', params);
        return data;
    }

    public async getLeverageBracket(symbol?: string) {
        const data = await this.signedRequest('/fapi/v1/leverageBracket', 'GET', { symbol });
        return data;
    }

    public async getAdlQuantile(symbol?: string) {
        const data = await this.signedRequest('/fapi/v1/adlQuantile', 'GET', { symbol });
        return data;
    }

    public async getForceOrders(params: {
        symbol?: string;
        autoCloseType: "LIQUIDATION" | "ADL";
        startTime?: number;
        endTime?: number;
        limit?: number;
    }) {
        const data = await this.signedRequest('/fapi/v1/forceOrders', 'GET', params);
        return data;
    }

    public async getCommissionRate(symbol: string) {
        const data = await this.signedRequest('/fapi/v1/commissionRate', 'GET', { symbol });
        return data;
    }

    private async generateListenKey() {
        const data = await this.signedRequest('/fapi/v1/listenKey', 'POST', { });
        return data;
    }

    private async extendListenKey() {
        const data = await this.signedRequest('/fapi/v1/listenKey', 'PUT', { });
        return data;
    }

    private async closeListenKey() {
        const data = await this.signedRequest('/fapi/v1/listenKey', 'DELETE', {  });
        return data;
    }

    public async subscribeUserData() {
        const {listenKey} = await this.generateListenKey();
        this.subscribe({ params: [listenKey], id: 99 });
    }

    /**
     * 注册账户和仓位实时推送回调
     * @param cb 回调函数，参数为账户推送内容
     */
    public watchAccount(cb: (data: any) => void) {
        this.accountUpdateCallbacks.push(cb);
    }
}