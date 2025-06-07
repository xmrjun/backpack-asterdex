import { pro as ccxt } from "ccxt";
import "dotenv/config";
import {
  TRADE_SYMBOL,
  TRADE_AMOUNT,
  ARB_THRESHOLD,
  CLOSE_DIFF,
  PROFIT_DIFF_LIMIT,
} from "./config";

const asterPrivate = new ccxt.binance({
  apiKey: process.env.ASTER_API_KEY,
  secret: process.env.ASTER_API_SECRET,
  urls: {
    api: {
      fapiPublic: "https://fapi.asterdex.com/fapi/v1",
      fapiPublicV2: "https://fapi.asterdex.com/fapi/v2",
      fapiPublicV3: "https://fapi.asterdex.com/fapi/v2",
      fapiPrivate: "https://fapi.asterdex.com/fapi/v1",
      fapiPrivateV2: "https://fapi.asterdex.com/fapi/v2",
      fapiPrivateV3: "https://fapi.asterdex.com/fapi/v2",
      fapiData: "https://fapi.asterdex.com/futures/data",
      public: "https://fapi.asterdex.com/fapi/v1",
      private: "https://fapi.asterdex.com/fapi/v2",
      v1: "https://fapi.asterdex.com/fapi/v1",
      ws: {
        spot: "wss://fstream.asterdex.com/ws",
        margin: "wss://fstream.asterdex.com/ws",
        future: "wss://fstream.asterdex.com/ws",
        "ws-api": "wss://fstream.asterdex.com/ws",
      },
    },
  },
});

const aster = new ccxt.binance({
  id: "aster",
  urls: {
    api: {
      fapiPublic: "https://fapi.asterdex.com/fapi/v1",
      fapiPublicV2: "https://fapi.asterdex.com/fapi/v2",
      fapiPublicV3: "https://fapi.asterdex.com/fapi/v2",
      fapiPrivate: "https://fapi.asterdex.com/fapi/v1",
      fapiPrivateV2: "https://fapi.asterdex.com/fapi/v2",
      fapiPrivateV3: "https://fapi.asterdex.com/fapi/v2",
      fapiData: "https://fapi.asterdex.com/futures/data",
      public: "https://fapi.asterdex.com/fapi/v1",
      private: "https://fapi.asterdex.com/fapi/v2",
      v1: "https://fapi.asterdex.com/fapi/v1",
      ws: {
        spot: "wss://fstream.asterdex.com/ws",
        margin: "wss://fstream.asterdex.com/ws",
        future: "wss://fstream.asterdex.com/ws",
        "ws-api": "wss://fstream.asterdex.com/ws",
      },
    },
  },
});

const bitget = new ccxt.bitget({
  apiKey: process.env.BITGET_API_KEY,
  secret: process.env.BITGET_API_SECRET,
  password: process.env.BITGET_PASSPHARE,
  options: {
    defaultType: "swap",
  },
});

const EXCHANGES = { aster, bitget };

let asterOrderbook: any = null;
let bitgetOrderbook: any = null;
let asterPosition: "long" | "short" | "none" = "none";
let bitgetPosition: "long" | "short" | "none" = "none";

// 统计与日志结构
interface TradeStats {
  totalTrades: number;
  totalAmount: number;
  totalProfit: number;
}

interface TradeLog {
  time: string;
  type: string;
  detail: string;
}

let stats: TradeStats = {
  totalTrades: 0,
  totalAmount: 0,
  totalProfit: 0,
};
let logs: TradeLog[] = [];

function logEvent(type: string, detail: string) {
  const time = new Date().toLocaleString();
  logs.push({ time, type, detail });
  if (logs.length > 1000) logs.shift();
}

function getStats() {
  return { ...stats };
}
function getLogs() {
  return [...logs];
}
function resetStats() {
  stats = { totalTrades: 0, totalAmount: 0, totalProfit: 0 };
  logs = [];
}

// 事件回调类型
interface BotEventHandlers {
  onOrderbook?: (data: {
    asterOrderbook: any;
    bitgetOrderbook: any;
    diff1: number;
    diff2: number;
  }) => void;
  onTrade?: (data: {
    side: string;
    amount: number;
    price?: number;
    exchange: string;
    type: 'open' | 'close';
    profit?: number;
  }) => void;
  onLog?: (msg: string) => void;
  onStats?: (stats: TradeStats) => void;
}

function watchOrderBookWS(exchangeId: "aster" | "bitget", symbol: string, onUpdate: (ob: any) => void) {
  const exchange = EXCHANGES[exchangeId];
  (async () => {
    while (true) {
      try {
        const orderbook = await exchange.watchOrderBook(symbol, 10, {
          instType: exchangeId === "bitget" ? "USDT-FUTURES" : undefined,
        });
        onUpdate(orderbook);
      } catch (e) {
        console.log(`[${exchangeId}] ws orderbook error:`, e);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  })();
}

watchOrderBookWS("aster", TRADE_SYMBOL, (ob) => { asterOrderbook = ob; });
watchOrderBookWS("bitget", TRADE_SYMBOL, (ob) => { bitgetOrderbook = ob; });

async function placeAsterOrder(side: "BUY" | "SELL", amount: number, price?: number, reduceOnly = false) {
  try {
    const params: any = {
      symbol: TRADE_SYMBOL,
      side,
      type: price ? "LIMIT" : "MARKET",
      quantity: amount,
      price,
      reduceOnly: reduceOnly ? true : false,
    };
    if (price) {
      params.timeInForce = "FOK";
    }
    const order = await asterPrivate.fapiPrivatePostOrder(params);
    if (!reduceOnly && order && order.orderId) {
      if (side === "BUY") asterPosition = "long";
      else if (side === "SELL") asterPosition = "short";
    }
    if (reduceOnly && order && order.orderId) {
      asterPosition = "none";
    }
    return order;
  } catch (e) {
    console.log(`[aster] 下单失败:`, e);
    logEvent('error', `[aster] 下单失败: ${e && e.message ? e.message : e}`);
    return null;
  }
}

async function placeBitgetOrder(side: "buy" | "sell", amount: number, price?: number, reduceOnly = false) {
  try {
    const params: any = {
      productType: "USDT-FUTURES",
      symbol: TRADE_SYMBOL,
      marginMode: "crossed",
      marginCoin: "USDT",
      side,
      orderType: price ? "limit" : "market",
      size: amount,
      force: price ? "fok" : "gtc",
      price,
      reduceOnly: reduceOnly ? 'YES' : 'NO',
    };
    const order = await bitget.privateMixPostV2MixOrderPlaceOrder(params);
    if (!reduceOnly && order && order.data && order.data.orderId) {
      if (side === "buy") bitgetPosition = "long";
      else if (side === "sell") bitgetPosition = "short";
    }
    if (reduceOnly && order && order.data && order.data.orderId) {
      bitgetPosition = "none";
    }
    return order;
  } catch (e) {
    console.log(`[bitget] 下单失败:`, e);
    logEvent('error', `[bitget] 下单失败: ${e && e.message ? e.message : e}`);
    return null;
  }
}

async function waitAsterFilled(orderId: string) {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await asterPrivate.fapiPrivateGetOrder({ symbol: TRADE_SYMBOL, orderId });
      if (res.status === "FILLED") return true;
      if (res.status === "CANCELED" || res.status === "REJECTED") return false;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function waitBitgetFilled(orderId: string) {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await bitget.privateMixGetV2MixOrderDetail({ productType: "USDT-FUTURES", symbol: TRADE_SYMBOL, orderId });
      if (res.data.state === "filled") return true;
      if (res.data.state === "canceled" || res.data.state === "failed") return false;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function closeAllPositions() {
  console.log("[警告] 平掉所有仓位");
  if (asterPosition === "long") {
    await placeAsterOrder("SELL", TRADE_AMOUNT, undefined, true);
  } else if (asterPosition === "short") {
    await placeAsterOrder("BUY", TRADE_AMOUNT, undefined, true);
  }
  if (bitgetPosition === "long") {
    await placeBitgetOrder("sell", TRADE_AMOUNT, undefined, true);
  } else if (bitgetPosition === "short") {
    await placeBitgetOrder("buy", TRADE_AMOUNT, undefined, true);
  }
}

async function startArbBot(handlers: BotEventHandlers = {}) {
  let holding = false;
  let lastAsterSide: "BUY" | "SELL" | null = null;
  let lastBitgetSide: "buy" | "sell" | null = null;
  let entryPriceAster = 0;
  let entryPriceBitget = 0;
  while (true) {
    try {
      if (!holding) {
        if (!asterOrderbook || !bitgetOrderbook) {
          await new Promise(r => setTimeout(r, 100));
          continue;
        }
        const asterAsk = asterOrderbook.asks[0][0];
        const asterBid = asterOrderbook.bids[0][0];
        const bitgetAsk = bitgetOrderbook.asks[0][0];
        const bitgetBid = bitgetOrderbook.bids[0][0];
        const diff1 = bitgetBid - asterAsk;
        const diff2 = asterBid - bitgetAsk;
        handlers.onOrderbook?.({ asterOrderbook, bitgetOrderbook, diff1, diff2 });
        if (diff1 > ARB_THRESHOLD) {
          const asterOrder = await placeAsterOrder("BUY", TRADE_AMOUNT, asterAsk, false);
          if (!asterOrder || !asterOrder.orderId) {
            await closeAllPositions();
            logEvent('error', 'Aster下单失败，已平仓');
            continue;
          }
          const asterFilled = await waitAsterFilled(asterOrder.orderId);
          if (!asterFilled) {
            await closeAllPositions();
            logEvent('error', 'Aster未成交，已平仓');
            continue;
          }
          const bitgetOrder = await placeBitgetOrder("sell", TRADE_AMOUNT, bitgetBid, false);
          if (!bitgetOrder || !bitgetOrder.data || !bitgetOrder.data.orderId) {
            await closeAllPositions();
            logEvent('error', 'Bitget下单失败，已平仓');
            continue;
          }
          const bitgetFilled = await waitBitgetFilled(bitgetOrder.data.orderId);
          if (!bitgetFilled) {
            await closeAllPositions();
            logEvent('error', 'Bitget未成交，已平仓');
            continue;
          }
          lastAsterSide = "BUY";
          lastBitgetSide = "sell";
          holding = true;
          entryPriceAster = asterAsk;
          entryPriceBitget = bitgetBid;
          stats.totalTrades++;
          stats.totalAmount += TRADE_AMOUNT;
          logEvent('open', `Aster买入${TRADE_AMOUNT}@${asterAsk}，Bitget卖出${TRADE_AMOUNT}@${bitgetBid}`);
          handlers.onTrade?.({ side: 'long', amount: TRADE_AMOUNT, price: asterAsk, exchange: 'aster', type: 'open' });
          handlers.onTrade?.({ side: 'short', amount: TRADE_AMOUNT, price: bitgetBid, exchange: 'bitget', type: 'open' });
          handlers.onLog?.('[套利成功] 已持有仓位，等待平仓机会');
          handlers.onStats?.(getStats());
        } else if (diff2 > ARB_THRESHOLD) {
          const bitgetOrder = await placeBitgetOrder("buy", TRADE_AMOUNT, bitgetAsk, false);
          if (!bitgetOrder || !bitgetOrder.data || !bitgetOrder.data.orderId) {
            await closeAllPositions();
            logEvent('error', 'Bitget下单失败，已平仓');
            continue;
          }
          const bitgetFilled = await waitBitgetFilled(bitgetOrder.data.orderId);
          if (!bitgetFilled) {
            await closeAllPositions();
            logEvent('error', 'Bitget未成交，已平仓');
            continue;
          }
          const asterOrder = await placeAsterOrder("SELL", TRADE_AMOUNT, asterBid, false);
          if (!asterOrder || !asterOrder.orderId) {
            await closeAllPositions();
            logEvent('error', 'Aster下单失败，已平仓');
            continue;
          }
          const asterFilled = await waitAsterFilled(asterOrder.orderId);
          if (!asterFilled) {
            await closeAllPositions();
            logEvent('error', 'Aster未成交，已平仓');
            continue;
          }
          lastAsterSide = "SELL";
          lastBitgetSide = "buy";
          holding = true;
          entryPriceAster = asterBid;
          entryPriceBitget = bitgetAsk;
          stats.totalTrades++;
          stats.totalAmount += TRADE_AMOUNT;
          logEvent('open', `Bitget买入${TRADE_AMOUNT}@${bitgetAsk}，Aster卖出${TRADE_AMOUNT}@${asterBid}`);
          handlers.onTrade?.({ side: 'long', amount: TRADE_AMOUNT, price: bitgetAsk, exchange: 'bitget', type: 'open' });
          handlers.onTrade?.({ side: 'short', amount: TRADE_AMOUNT, price: asterBid, exchange: 'aster', type: 'open' });
          handlers.onLog?.('[套利成功] 已持有仓位，等待平仓机会');
          handlers.onStats?.(getStats());
        } else {
          handlers.onOrderbook?.({ asterOrderbook, bitgetOrderbook, diff1, diff2 });
        }
      } else {
        if (!asterOrderbook || !bitgetOrderbook) {
          await new Promise(r => setTimeout(r, 100));
          continue;
        }
        handlers.onLog?.('已持仓，等待平仓，不再开新仓');
        const asterAsk = asterOrderbook.asks[0][0];
        const asterBid = asterOrderbook.bids[0][0];
        const bitgetAsk = bitgetOrderbook.asks[0][0];
        const bitgetBid = bitgetOrderbook.bids[0][0];
        const diff1 = bitgetBid - asterAsk;
        const diff2 = asterBid - bitgetAsk;
        let closeDiff = 0;
        if (lastAsterSide === "BUY" && lastBitgetSide === "sell") {
          closeDiff = Math.abs(asterOrderbook.asks[0][0] - bitgetOrderbook.bids[0][0]);
        } else if (lastAsterSide === "SELL" && lastBitgetSide === "buy") {
          closeDiff = Math.abs(asterOrderbook.bids[0][0] - bitgetOrderbook.asks[0][0]);
        } else {
          closeDiff = Math.abs(bitgetBid - asterAsk);
        }
        handlers.onOrderbook?.({ asterOrderbook, bitgetOrderbook, diff1, diff2 });
        // 计算两个交易所平仓时的收益
        let profitAster = 0, profitBitget = 0, profitDiff = 0;
        if (lastAsterSide === "BUY" && lastBitgetSide === "sell") {
          // Aster买入，Bitget卖出，平仓时Aster卖出，Bitget买入
          profitAster = (asterOrderbook.asks[0][0] - entryPriceAster) * TRADE_AMOUNT;
          profitBitget = (entryPriceBitget - bitgetOrderbook.bids[0][0]) * TRADE_AMOUNT;
        } else if (lastAsterSide === "SELL" && lastBitgetSide === "buy") {
          // Aster卖出，Bitget买入，平仓时Aster买入，Bitget卖出
          profitAster = (entryPriceAster - asterOrderbook.bids[0][0]) * TRADE_AMOUNT;
          profitBitget = (bitgetOrderbook.asks[0][0] - entryPriceBitget) * TRADE_AMOUNT;
        }
        profitDiff = Math.abs(profitAster - profitBitget);
        if (closeDiff < CLOSE_DIFF
          || (profitDiff > PROFIT_DIFF_LIMIT)
        ) {
          let profit = 0;
          if (lastAsterSide === "BUY" && lastBitgetSide === "sell") {
            profit = (bitgetBid - entryPriceBitget) * TRADE_AMOUNT - (asterAsk - entryPriceAster) * TRADE_AMOUNT;
          } else if (lastAsterSide === "SELL" && lastBitgetSide === "buy") {
            profit = (entryPriceBitget - bitgetBid) * TRADE_AMOUNT - (entryPriceAster - asterAsk) * TRADE_AMOUNT;
          }
          stats.totalProfit += profit;
          if (asterPosition === "long") {
            await placeAsterOrder("SELL", TRADE_AMOUNT, undefined, true);
            handlers.onTrade?.({ side: 'long', amount: TRADE_AMOUNT, exchange: 'aster', type: 'close', profit });
          } else if (asterPosition === "short") {
            await placeAsterOrder("BUY", TRADE_AMOUNT, undefined, true);
            handlers.onTrade?.({ side: 'short', amount: TRADE_AMOUNT, exchange: 'aster', type: 'close', profit });
          }
          if (bitgetPosition === "long") {
            await placeBitgetOrder("sell", TRADE_AMOUNT, undefined, true);
            handlers.onTrade?.({ side: 'long', amount: TRADE_AMOUNT, exchange: 'bitget', type: 'close', profit });
          } else if (bitgetPosition === "short") {
            await placeBitgetOrder("buy", TRADE_AMOUNT, undefined, true);
            handlers.onTrade?.({ side: 'short', amount: TRADE_AMOUNT, exchange: 'bitget', type: 'close', profit });
          }
          logEvent('close', `平仓，收益: ${profit.toFixed(2)} USDT` + (profitDiff > PROFIT_DIFF_LIMIT ? `（收益差额超阈值，强制平仓）` : ''));
          handlers.onLog?.(`[平仓] 已同时平仓，收益: ${profit.toFixed(2)} USDT` + (profitDiff > PROFIT_DIFF_LIMIT ? `（收益差额超阈值，强制平仓）` : ''));
          handlers.onStats?.(getStats());
          holding = false;
        }
      }
    } catch (e) {
      logEvent('error', `[主循环异常] ${e}`);
      handlers.onLog?.(`[主循环异常] ${e}`);
      await closeAllPositions();
      holding = false;
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

export { placeAsterOrder, placeBitgetOrder, waitAsterFilled, waitBitgetFilled, closeAllPositions, startArbBot, getStats, getLogs, resetStats }; 