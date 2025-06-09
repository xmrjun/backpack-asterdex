import {
  Aster,
  AsterDepth,
  AsterTicker,
  AsterKline,
  AsterOrder,
  AsterAccountSnapshot,
  CreateOrderParams,
} from "./exchanges/aster";
import "dotenv/config";
import {
  TRADE_SYMBOL,
  TRADE_AMOUNT,
  LOSS_LIMIT,
  TRAILING_PROFIT,
} from "./config";
import {
  toPrice1Decimal,
  isOperating,
  unlockOperating,
  placeOrder,
  placeStopLossOrder,
  marketClose,
  calcStopLossPrice,
  calcTrailingActivationPrice,
  placeTrailingStopOrder
} from "./utils/order";
import { logTrade, printStatus, TradeLogItem } from "./utils/log";
import { getPosition, getSMA30 } from "./utils/helper";

const aster = new Aster(
  process.env.ASTER_API_KEY!,
  process.env.ASTER_API_SECRET!
);

// 快照数据
let accountSnapshot: AsterAccountSnapshot | null = null;
let openOrders: AsterOrder[] = [];
let depthSnapshot: AsterDepth | null = null;
let tickerSnapshot: AsterTicker | null = null;
let klineSnapshot: AsterKline[] = [];

// 交易统计
let tradeLog: TradeLogItem[] = [];
let totalProfit = 0;
let totalTrades = 0;
// 多类型订单锁
let orderTypeLocks: { [key: string]: boolean } = {};
let orderTypePendingOrderId: { [key: string]: string | null } = {};
let orderTypeUnlockTimer: { [key: string]: NodeJS.Timeout | null } = {};

// 订阅所有推送
aster.watchAccount((data) => {
  accountSnapshot = data;
  // 账户更新不再直接解锁
});
aster.watchOrder((orders: AsterOrder[]) => {
  // 针对每种类型分别判断pendingOrderId是否需要解锁
  Object.keys(orderTypePendingOrderId).forEach(type => {
    const pendingOrderId = orderTypePendingOrderId[type];
    if (pendingOrderId) {
      const pendingOrder = orders.find(o => String(o.orderId) === String(pendingOrderId));
      if (pendingOrder) {
        if (pendingOrder.status && pendingOrder.status !== "NEW") {
          unlockOperating(orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type);
        }
      } else {
        // orders 里没有 pendingOrderId 对应的订单，说明已成交或撤销
        unlockOperating(orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type);
      }
    }
  });
  // 过滤掉 market 类型订单再赋值给 openOrders
  openOrders = Array.isArray(orders) ? orders.filter(o => o.type !== 'MARKET') : [];
});
aster.watchDepth(TRADE_SYMBOL, (depth: AsterDepth) => {
  depthSnapshot = depth;
});
aster.watchTicker(TRADE_SYMBOL, (ticker: AsterTicker) => {
  tickerSnapshot = ticker;
});
aster.watchKline(TRADE_SYMBOL, "1m", (klines: AsterKline[]) => {
  klineSnapshot = klines;
});

async function trendStrategy() {
  let lastSMA30: number | null = null;
  let lastPrice: number | null = null;
  let lastOpenOrderSide: "BUY" | "SELL" | null = null;
  let lastOpenOrderPrice: number | null = null;
  let lastCloseOrderSide: "BUY" | "SELL" | null = null;
  let lastCloseOrderPrice: number | null = null;
  let lastStopOrderSide: "BUY" | "SELL" | null = null;
  let lastStopOrderPrice: number | null = null;
  let pendingCloseOrder = null;
  while (true) {
    await new Promise((r) => setTimeout(r, 500));
    if (isOperating(orderTypeLocks, "MARKET")) continue;
    // 快照数据未准备好
    if (
      !accountSnapshot ||
      !tickerSnapshot ||
      !depthSnapshot ||
      !klineSnapshot.length
    )
      continue;
    lastSMA30 = getSMA30(klineSnapshot);
    if (lastSMA30 === null) continue;
    const ob = depthSnapshot;
    const ticker = tickerSnapshot;
    const price = parseFloat(ticker.lastPrice);
    const buy1 = ob.bids[0]?.[0];
    const sell1 = ob.asks[0]?.[0];
    const pos = getPosition(accountSnapshot, TRADE_SYMBOL);
    let trend = "无信号";
    if (price < lastSMA30) trend = "做空";
    if (price > lastSMA30) trend = "做多";
    let openOrder: {
      side: "BUY" | "SELL";
      price: number;
      amount: number;
    } | null = null;
    let closeOrder: {
      side: "BUY" | "SELL";
      price: number;
      amount: number;
    } | null = null;
    let stopOrder: { side: "BUY" | "SELL"; stopPrice: number } | null = null;
    let pnl = 0;
    // 无仓位
    if (Math.abs(pos.positionAmt) < 0.00001) {
      // 撤销所有普通挂单和止损单
      if (openOrders.length > 0) {
        isOperating(orderTypeLocks, "MARKET");
        await aster.cancelAllOrders({ symbol: TRADE_SYMBOL });
      }
      lastStopOrderSide = null;
      lastStopOrderPrice = null;
      pendingCloseOrder = null;
      // 仅在价格穿越SMA30时下市价单
      if (lastPrice !== null) {
        if (lastPrice > lastSMA30 && price < lastSMA30) {
          if (openOrders.length > 0) {
            isOperating(orderTypeLocks, "MARKET");
            const orderIdList = openOrders.map(o => o.orderId);
            await aster.cancelOrders({ symbol: TRADE_SYMBOL, orderIdList });
          }
          isOperating(orderTypeLocks, "MARKET");
          const params: CreateOrderParams = {
            symbol: TRADE_SYMBOL,
            side: "SELL",
            type: "MARKET",
            quantity: TRADE_AMOUNT,
          };
          await aster.createOrder(params);
          logTrade(tradeLog, "open", `下穿SMA30，市价开空: SELL @ ${price}`);
          lastOpenOrderSide = "SELL";
          lastOpenOrderPrice = price;
        } else if (lastPrice < lastSMA30 && price > lastSMA30) {
          if (openOrders.length > 0) {
            isOperating(orderTypeLocks, "MARKET");
            const orderIdList = openOrders.map(o => o.orderId);
            await aster.cancelOrders({ symbol: TRADE_SYMBOL, orderIdList });
          }
          isOperating(orderTypeLocks, "MARKET");
          const params: CreateOrderParams = {
            symbol: TRADE_SYMBOL,
            side: "BUY",
            type: "MARKET",
            quantity: TRADE_AMOUNT,
          };
          await aster.createOrder(params);
          logTrade(tradeLog, "open", `上穿SMA30，市价开多: BUY @ ${price}`);
          lastOpenOrderSide = "BUY";
          lastOpenOrderPrice = price;
        }
      }
    } else {
      // 有仓位
      let direction = pos.positionAmt > 0 ? "long" : "short";
      pnl =
        (direction === "long"
          ? price - pos.entryPrice
          : pos.entryPrice - price) * Math.abs(pos.positionAmt);
      // 检查当前是否有止损/止盈单，没有则补挂
      let stopSide: "SELL" | "BUY" = direction === "long" ? "SELL" : "BUY";
      let stopPrice = calcStopLossPrice(
        pos.entryPrice,
        Math.abs(pos.positionAmt),
        direction as "long" | "short",
        LOSS_LIMIT
      );
      let activationPrice = calcTrailingActivationPrice(
        pos.entryPrice,
        Math.abs(pos.positionAmt),
        direction as "long" | "short",
        TRAILING_PROFIT
      );
      let hasStop = openOrders.some(
        (o: AsterOrder) => o.type === "STOP_MARKET" && o.side === stopSide
      );
      let hasTrailing = openOrders.some(
        (o: AsterOrder) => o.type === "TRAILING_STOP_MARKET" && o.side === stopSide
      );
      // 盈利移动止损单逻辑
      let profitMove = 0.05;
      let profitMoveStopPrice =
        direction === "long"
          ? toPrice1Decimal(
              pos.entryPrice + profitMove / Math.abs(pos.positionAmt)
            )
          : toPrice1Decimal(
              pos.entryPrice - profitMove / Math.abs(pos.positionAmt)
            );
      let currentStopOrder = openOrders.find(
        (o: AsterOrder) => o.type === "STOP_MARKET" && o.side === stopSide
      );
      if (pnl > 0.1 || pos.unrealizedProfit > 0.1) {
        if (!currentStopOrder) {
          isOperating(orderTypeLocks, "MARKET");
          await placeStopLossOrder(aster, openOrders, orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, tickerSnapshot, stopSide, profitMoveStopPrice, (type, detail) => logTrade(tradeLog, type, detail));
          hasStop = true;
          logTrade(tradeLog, "stop", `盈利大于0.1u，挂盈利0.05u止损单: ${stopSide} @ ${profitMoveStopPrice}`);
        } else {
          let curStopPrice = parseFloat(currentStopOrder.stopPrice);
          if (Math.abs(curStopPrice - profitMoveStopPrice) > 0.01) {
            isOperating(orderTypeLocks, "MARKET");
            await aster.cancelOrder({
              symbol: TRADE_SYMBOL,
              orderId: currentStopOrder.orderId,
            });
            isOperating(orderTypeLocks, "MARKET");
            await placeStopLossOrder(aster, openOrders, orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, tickerSnapshot, stopSide, profitMoveStopPrice, (type, detail) => logTrade(tradeLog, type, detail));
            logTrade(tradeLog, "stop", `盈利大于0.1u，移动止损单到盈利0.05u: ${stopSide} @ ${profitMoveStopPrice}`);
            hasStop = true;
          }
        }
      }
      if (!hasStop) {
        isOperating(orderTypeLocks, "MARKET");
        await placeStopLossOrder(aster, openOrders, orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, tickerSnapshot, stopSide, toPrice1Decimal(stopPrice), (type, detail) => logTrade(tradeLog, type, detail));
      }
      if (!hasTrailing) {
        isOperating(orderTypeLocks, "MARKET");
        await placeTrailingStopOrder(
          aster,
          openOrders,
          orderTypeLocks,
          orderTypeUnlockTimer,
          orderTypePendingOrderId,
          stopSide,
          toPrice1Decimal(activationPrice),
          Math.abs(pos.positionAmt),
          (type, detail) => logTrade(tradeLog, type, detail)
        );
      }
      if (pnl < -LOSS_LIMIT || pos.unrealizedProfit < -LOSS_LIMIT) {
        if (openOrders.length > 0) {
          isOperating(orderTypeLocks, "MARKET");
          const orderIdList = openOrders.map(o => o.orderId);
          await aster.cancelOrders({ symbol: TRADE_SYMBOL, orderIdList });
        }
        isOperating(orderTypeLocks, "MARKET");
        await marketClose(aster, openOrders, orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, direction === "long" ? "SELL" : "BUY", (type, detail) => logTrade(tradeLog, type, detail));
        lastOpenOrderPrice = null;
        lastOpenOrderSide = null;
        lastCloseOrderPrice = null;
        lastCloseOrderSide = null;
        lastStopOrderSide = null;
        lastStopOrderPrice = null;
        pendingCloseOrder = null;
        logTrade(tradeLog, "close", `止损平仓: ${direction === "long" ? "SELL" : "BUY"}`);
        totalTrades++;
        totalProfit += pnl;
        continue;
      }
      if (pnl > 0) {
        let needCloseOrder = false;
        let closeSide: "BUY" | "SELL" | null = null;
        let closePrice: number | null = null;
        if (
          (direction === "long" && price < lastSMA30) ||
          (direction === "short" && price > lastSMA30)
        ) {
          if (direction === "long") {
            closeSide = "SELL";
            closePrice = parseFloat(sell1);
          } else {
            closeSide = "BUY";
            closePrice = parseFloat(buy1);
          }
          if (
            lastCloseOrderSide !== closeSide ||
            lastCloseOrderPrice !== closePrice
          ) {
            needCloseOrder = true;
          }
          if (needCloseOrder && closeSide && closePrice) {
            if (openOrders.length > 0) {
              isOperating(orderTypeLocks, "MARKET");
              await aster.cancelAllOrders({ symbol: TRADE_SYMBOL });
            }
            isOperating(orderTypeLocks, "MARKET");
            await placeOrder(
              aster,
              openOrders,
              orderTypeLocks,
              orderTypeUnlockTimer,
              orderTypePendingOrderId,
              closeSide,
              closePrice,
              Math.abs(pos.positionAmt),
              (type, detail) => logTrade(tradeLog, type, detail),
              true
            );
            lastCloseOrderSide = closeSide;
            lastCloseOrderPrice = closePrice;
            closeOrder = {
              side: closeSide,
              price: closePrice,
              amount: Math.abs(pos.positionAmt),
            };
            logTrade(tradeLog, "order", `动态挂平仓单: ${closeSide} @ ${closePrice}`);
          }
        } else {
          if (pendingCloseOrder) {
            if (openOrders.length > 0) {
              isOperating(orderTypeLocks, "MARKET");
              await aster.cancelAllOrders({ symbol: TRADE_SYMBOL });
            }
            pendingCloseOrder = null;
            lastCloseOrderSide = null;
            lastCloseOrderPrice = null;
            logTrade(tradeLog, "order", `撤销平仓挂单`);
          }
        }
      } else {
        lastCloseOrderSide = null;
        lastCloseOrderPrice = null;
      }
    }
    printStatus({
      ticker,
      ob,
      sma: lastSMA30,
      trend,
      openOrder:
        Math.abs(pos.positionAmt) < 0.00001
          ? lastOpenOrderSide && lastOpenOrderPrice
            ? {
                side: lastOpenOrderSide,
                price: lastOpenOrderPrice,
                amount: TRADE_AMOUNT,
              }
            : null
          : null,
      closeOrder:
        Math.abs(pos.positionAmt) > 0.00001
          ? lastCloseOrderSide && lastCloseOrderPrice
            ? {
                side: lastCloseOrderSide,
                price: lastCloseOrderPrice,
                amount: Math.abs(pos.positionAmt),
              }
            : null
          : null,
      stopOrder:
        Math.abs(pos.positionAmt) > 0.00001
          ? lastStopOrderSide && lastStopOrderPrice
            ? { side: lastStopOrderSide, stopPrice: lastStopOrderPrice }
            : null
          : null,
      pos,
      pnl,
      unrealized: pos.unrealizedProfit,
      tradeLog,
      totalProfit,
      totalTrades,
      openOrders
    });
    lastPrice = price;
  }
}

trendStrategy();
