import { pro as ccxt } from "ccxt";
import "dotenv/config";
import { TRADE_SYMBOL, TRADE_AMOUNT, LOSS_LIMIT } from "./config";

const asterPrivate = new ccxt.binance({
  apiKey: process.env.ASTER_API_KEY,
  secret: process.env.ASTER_API_SECRET,
  options: {
    defaultType: "swap",
  },
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
  options: {
    defaultType: "swap",
  },
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

let position: "long" | "short" | "none" = "none";
let entryPrice = 0;
let orderBuy: any = null;
let orderSell: any = null;
let wsOrderbook: any = null;
let recentUnrealizedProfit = 0;
let lastPositionAmt = 0;
let lastEntryPrice = 0;

// 全局订单状态监听队列
let pendingOrders: { orderId: string | number, lastStatus?: string }[] = [];

// 异步订单状态监听器
async function orderStatusWatcher() {
  while (true) {
    if (pendingOrders.length === 0) {
      await new Promise(r => setTimeout(r, 500));
      continue;
    }
    for (let i = pendingOrders.length - 1; i >= 0; i--) {
      const { orderId, lastStatus } = pendingOrders[i];
      try {
        const order = await asterPrivate.fapiPrivateGetOrder({ symbol: TRADE_SYMBOL, orderId });
        if (order) {
          if (order.status !== lastStatus) {
            console.log(`[订单状态变化] 订单ID: ${orderId}，新状态: ${order.status}`);
            pendingOrders[i].lastStatus = order.status;
          }
          if (["FILLED", "CANCELED", "REJECTED", "EXPIRED"].includes(order.status)) {
            pendingOrders.splice(i, 1); // 移除已终结订单
          }
        }
      } catch (e) {
        // 网络异常等，忽略
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

// 启动订单状态监听
orderStatusWatcher();

// 修改 placeOrder 只负责下单并返回订单对象
async function placeOrder(side: "BUY" | "SELL", price: number, amount: number, reduceOnly = false): Promise<any> {
  try {
    const params: any = {
      symbol: TRADE_SYMBOL,
      side,
      type: "LIMIT",
      quantity: amount,
      price,
      timeInForce: "GTX",
    };
    if (reduceOnly) params.reduceOnly = true;
    const order = await asterPrivate.fapiPrivatePostOrder(params);
    if (order && order.orderId) {
      console.log(`[下单成功] ${side} ${amount} @ ${price} reduceOnly=${reduceOnly}，订单ID: ${order.orderId}`);
      pendingOrders.push({ orderId: order.orderId }); // 加入监听队列
      return order;
    } else {
      console.log(`[下单失败] ${side} ${amount} @ ${price} reduceOnly=${reduceOnly}`);
      return null;
    }
  } catch (e) {
    console.log(`[下单异常] ${side} ${amount} @ ${price} reduceOnly=${reduceOnly}`, e);
    return null;
  }
}

async function getPosition() {
  try {
    const account = await asterPrivate.fapiPrivateV2GetAccount();
    if (account && typeof account.totalUnrealizedProfit === 'string') {
      recentUnrealizedProfit = parseFloat(account.totalUnrealizedProfit);
    }
    if (!account || !account.positions || !Array.isArray(account.positions)) return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
    const pos = account.positions.find((p: any) => p.symbol === TRADE_SYMBOL);
    if (!pos) return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
    const positionAmt = parseFloat(pos.positionAmt);
    const entryPrice = parseFloat(pos.entryPrice);
    if (positionAmt !== lastPositionAmt || entryPrice !== lastEntryPrice) {
      console.log(`[仓位变化] 持仓数量: ${lastPositionAmt} => ${positionAmt}，开仓价: ${lastEntryPrice} => ${entryPrice}`);
      lastPositionAmt = positionAmt;
      lastEntryPrice = entryPrice;
    }
    return {
      positionAmt,
      entryPrice,
      unrealizedProfit: parseFloat(pos.unrealizedProfit)
    };
  } catch (e) {
    return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
  }
}

async function marketClose(side: "SELL" | "BUY") {
  try {
    await asterPrivate.fapiPrivatePostOrder({
      symbol: TRADE_SYMBOL,
      side,
      type: "MARKET",
      quantity: TRADE_AMOUNT,
      reduceOnly: true
    });
  } catch (e) {
    console.log("市价平仓失败", e);
  }
}

function watchOrderBookWS(symbol: string) {
  (async () => {
    while (true) {
      try {
        wsOrderbook = await aster.watchOrderBook(symbol, 5);
      } catch (e) {
        console.log("WS orderbook error", e);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  })();
}

// 启动WS订阅
watchOrderBookWS(TRADE_SYMBOL);

async function ensureNoPendingReduceOnly(side: "BUY" | "SELL", price: number) {
  // 检查当前是否有未成交的reduceOnly单
  const openOrders = await asterPrivate.fapiPrivateGetOpenOrders({ symbol: TRADE_SYMBOL });
  return !openOrders.some((o: any) => o.side === side && o.reduceOnly && parseFloat(o.price) === price);
}

async function cancelAllOrders() {
  try {
    await asterPrivate.fapiPrivateDeleteAllOpenOrders({ symbol: TRADE_SYMBOL });
  } catch (e) {
    console.log("撤销订单失败", e);
  }
}

async function makerStrategy() {
  while (true) {
    try {
      // 1. 获取盘口（用wsOrderbook）
      const ob = wsOrderbook;
      if (!ob) {
        await new Promise(r => setTimeout(r, 200));
        continue;
      }
      let buy1 = ob.bids[0]?.[0];
      let sell1 = ob.asks[0]?.[0];
      if (typeof buy1 !== 'number' || typeof sell1 !== 'number') {
        await new Promise(r => setTimeout(r, 200));
        continue;
      }
      // 2. 检查当前持仓
      const pos = await getPosition();
      // 3. 获取当前挂单
      const openOrders = await asterPrivate.fapiPrivateGetOpenOrders({ symbol: TRADE_SYMBOL });
      // 4. 无持仓时，保证双边挂单都成功且未被取消
      if (pos.positionAmt > -0.00001 && pos.positionAmt < 0.00001) {
        // 撤销所有订单，重新挂双边单
        await cancelAllOrders();
        let orderBuy = await placeOrder("BUY", buy1, TRADE_AMOUNT, false);
        let orderSell = await placeOrder("SELL", sell1, TRADE_AMOUNT, false);
        let filled = false;
        let lastBuy1 = buy1;
        let lastSell1 = sell1;
        while (!filled) {
          await new Promise(r => setTimeout(r, 1000));
          // 检查盘口是否变化
          const ob2 = wsOrderbook;
          if (!ob2) continue;
          const newBuy1 = ob2.bids[0]?.[0];
          const newSell1 = ob2.asks[0]?.[0];
          if (typeof newBuy1 !== 'number' || typeof newSell1 !== 'number') continue;
          let needReplace = false;
          if (newBuy1 !== lastBuy1 || newSell1 !== lastSell1) {
            needReplace = true;
          }
          // 检查订单状态
          const buyOrderStatus = orderBuy ? await asterPrivate.fapiPrivateGetOrder({ symbol: TRADE_SYMBOL, orderId: orderBuy.orderId }) : null;
          const sellOrderStatus = orderSell ? await asterPrivate.fapiPrivateGetOrder({ symbol: TRADE_SYMBOL, orderId: orderSell.orderId }) : null;
          if (!buyOrderStatus || !sellOrderStatus ||
            !["NEW", "PARTIALLY_FILLED"].includes(buyOrderStatus.status) ||
            !["NEW", "PARTIALLY_FILLED"].includes(sellOrderStatus.status)) {
            needReplace = true;
          }
          if (needReplace) {
            await cancelAllOrders();
            // 重新获取盘口
            const ob3 = wsOrderbook;
            if (!ob3) continue;
            buy1 = ob3.bids[0]?.[0];
            sell1 = ob3.asks[0]?.[0];
            if (typeof buy1 !== 'number' || typeof sell1 !== 'number') continue;
            lastBuy1 = buy1;
            lastSell1 = sell1;
            orderBuy = await placeOrder("BUY", buy1, TRADE_AMOUNT, false);
            orderSell = await placeOrder("SELL", sell1, TRADE_AMOUNT, false);
            continue;
          }
          // 查询成交
          const pos2 = await getPosition();
          if (pos2.positionAmt > 0.00001) {
            // 买单成交，持有多头
            position = "long";
            entryPrice = pos2.entryPrice;
            filled = true;
            console.log(`[开仓] 买单成交，持有多头 ${TRADE_AMOUNT} @ ${entryPrice}`);
            break;
          } else if (pos2.positionAmt < -0.00001) {
            // 卖单成交，持有空头
            position = "short";
            entryPrice = pos2.entryPrice;
            filled = true;
            console.log(`[开仓] 卖单成交，持有空头 ${TRADE_AMOUNT} @ ${entryPrice}`);
            break;
          }
        }
      } else {
        // 有持仓时，只挂平仓方向的单，撤销所有不符的挂单
        let closeSide: "SELL" | "BUY" = pos.positionAmt > 0 ? "SELL" : "BUY";
        let closePrice = pos.positionAmt > 0 ? sell1 : buy1;
        // 先撤销所有不是平仓方向的挂单
        for (const o of openOrders) {
          if (o.side !== closeSide || o.reduceOnly !== true || parseFloat(o.price) !== closePrice) {
            await asterPrivate.fapiPrivateDeleteOrder({ symbol: TRADE_SYMBOL, orderId: o.orderId });
            console.log(`[撤销非平仓方向挂单] 订单ID: ${o.orderId} side: ${o.side} price: ${o.price}`);
          }
        }
        // 检查是否已挂平仓方向的单
        const stillOpenOrders = await asterPrivate.fapiPrivateGetOpenOrders({ symbol: TRADE_SYMBOL });
        const hasCloseOrder = stillOpenOrders.some((o: any) => o.side === closeSide && o.reduceOnly === true && parseFloat(o.price) === closePrice);
        if (!hasCloseOrder && Math.abs(pos.positionAmt) > 0.00001) {
          // 只在没有未成交reduceOnly单且持仓未平时才下单
          if (await ensureNoPendingReduceOnly(closeSide, closePrice)) {
            await placeOrder(closeSide, closePrice, TRADE_AMOUNT, true);
          }
        }
        // 平仓止损逻辑保持不变
        let pnl = 0;
        if (position === "long") {
          pnl = (buy1 - entryPrice) * TRADE_AMOUNT;
        } else if (position === "short") {
          pnl = (entryPrice - sell1) * TRADE_AMOUNT;
        }
        if (pnl < -LOSS_LIMIT || recentUnrealizedProfit < -LOSS_LIMIT || pos.unrealizedProfit < -LOSS_LIMIT) {
          await cancelAllOrders();
          await marketClose(closeSide);
          let waitCount = 0;
          while (true) {
            const posCheck = await getPosition();
            if ((position === "long" && posCheck.positionAmt < 0.00001) || (position === "short" && posCheck.positionAmt > -0.00001)) {
              break;
            }
            await new Promise(r => setTimeout(r, 500));
            waitCount++;
            if (waitCount > 20) break;
          }
          console.log(`[强制平仓] 亏损超限，方向: ${position}，开仓价: ${entryPrice}，现价: ${position === "long" ? buy1 : sell1}，估算亏损: ${pnl.toFixed(4)} USDT，账户浮亏: ${recentUnrealizedProfit.toFixed(4)} USDT，持仓浮亏: ${pos.unrealizedProfit.toFixed(4)} USDT`);
          position = "none";
        }
        // 检查是否已平仓
        const pos2 = await getPosition();
        if (position === "long" && pos2.positionAmt < 0.00001) {
          console.log(`[平仓] 多头平仓，开仓价: ${entryPrice}，平仓价: ${sell1}，盈亏: ${(sell1 - entryPrice) * TRADE_AMOUNT} USDT`);
          position = "none";
        } else if (position === "short" && pos2.positionAmt > -0.00001) {
          console.log(`[平仓] 空头平仓，开仓价: ${entryPrice}，平仓价: ${buy1}，盈亏: ${(entryPrice - buy1) * TRADE_AMOUNT} USDT`);
          position = "none";
        }
      }
      // 下一轮
    } catch (e) {
      console.log("策略异常", e);
      await cancelAllOrders();
      position = "none";
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

makerStrategy(); 