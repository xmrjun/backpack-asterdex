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
import chalk from "chalk";
import {
  TRADE_SYMBOL,
  TRADE_AMOUNT,
  LOSS_LIMIT,
  TRAILING_CALLBACK_RATE,
  TRAILING_PROFIT,
} from "./config";

const aster = new Aster(
  process.env.ASTER_API_KEY!,
  process.env.ASTER_API_SECRET!
);

// 类型定义
interface TradeLogItem {
  time: string;
  type: string;
  detail: string;
}

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
let isOperating = false;
let pendingOrderId: string | null = null;
let unlockTimer: NodeJS.Timeout | null = null;

function logTrade(type: string, detail: string) {
  tradeLog.push({ time: new Date().toLocaleString(), type, detail });
  if (tradeLog.length > 1000) tradeLog.shift();
}

function printStatus({
  ticker,
  ob,
  sma,
  trend,
  openOrder,
  closeOrder,
  stopOrder,
  pos,
  pnl,
  unrealized,
  tradeLog,
  totalProfit,
  totalTrades,
  openOrders
}: {
  ticker: AsterTicker;
  ob: AsterDepth;
  sma: number | null;
  trend: string;
  openOrder: { side: "BUY" | "SELL"; price: number; amount: number } | null;
  closeOrder: { side: "BUY" | "SELL"; price: number; amount: number } | null;
  stopOrder: { side: "BUY" | "SELL"; stopPrice: number } | null;
  pos: { positionAmt: number; entryPrice: number; unrealizedProfit: number };
  pnl: number;
  unrealized: number;
  tradeLog: TradeLogItem[];
  totalProfit: number;
  totalTrades: number;
  openOrders: AsterOrder[];
}) {
  process.stdout.write('\x1Bc');
  console.log(chalk.bold.bgCyan("  趋势策略机器人  "));
  console.log(
    chalk.yellow(
      `最新价格: ${ticker?.lastPrice ?? "-"} | SMA30: ${sma?.toFixed(2) ?? "-"}`
    )
  );
  if (ob) {
    console.log(
      chalk.green(
        `盘口 买一: ${ob.bids?.[0]?.[0] ?? "-"} 卖一: ${
          ob.asks?.[0]?.[0] ?? "-"
        }`
      )
    );
  }
  console.log(chalk.magenta(`当前趋势: ${trend}`));
  if (openOrder) {
    console.log(
      chalk.blue(
        `当前开仓挂单: ${openOrder.side} @ ${openOrder.price} 数量: ${openOrder.amount}`
      )
    );
  }
  if (closeOrder) {
    console.log(
      chalk.blueBright(
        `当前平仓挂单: ${closeOrder.side} @ ${closeOrder.price} 数量: ${closeOrder.amount}`
      )
    );
  }
  if (stopOrder) {
    console.log(
      chalk.red(
        `止损单: ${stopOrder.side} STOP_MARKET @ ${stopOrder.stopPrice}`
      )
    );
  }
  if (pos && Math.abs(pos.positionAmt) > 0.00001) {
    console.log(
      chalk.bold(
        `持仓: ${pos.positionAmt > 0 ? "多" : "空"} 开仓价: ${
          pos.entryPrice
        } 当前浮盈亏: ${pnl?.toFixed(4) ?? "-"} USDT 账户浮盈亏: ${
          unrealized?.toFixed(4) ?? "-"
        }`
      )
    );
  } else {
    console.log(chalk.gray("当前无持仓"));
  }
  console.log(
    chalk.bold(
      `累计交易次数: ${totalTrades}  累计收益: ${totalProfit.toFixed(4)} USDT`
    )
  );
  console.log(chalk.bold("最近交易/挂单记录："));
  tradeLog.slice(-10).forEach((log) => {
    let color = chalk.white;
    if (log.type === "open") color = chalk.green;
    if (log.type === "close") color = chalk.blue;
    if (log.type === "stop") color = chalk.red;
    if (log.type === "order") color = chalk.yellow;
    if (log.type === "error") color = chalk.redBright;
    console.log(color(`[${log.time}] [${log.type}] ${log.detail}`));
  });
  if (openOrders && openOrders.length > 0) {
    console.log(chalk.bold("当前挂单："));
    const tableData = openOrders.map(o => ({
      orderId: o.orderId,
      side: o.side,
      type: o.type,
      price: o.price,
      origQty: o.origQty,
      executedQty: o.executedQty,
      status: o.status
    }));
    console.table(tableData);
  } else {
    console.log(chalk.gray("无挂单"));
  }
  console.log(chalk.gray("按 Ctrl+C 退出"));
}

// 订阅所有推送
aster.watchAccount((data) => {
  accountSnapshot = data;
  // 账户更新不再直接解锁
});
aster.watchOrder((orders: AsterOrder[]) => {
  // 先用原始 orders 判断 pendingOrderId 是否需要解锁
  if (pendingOrderId) {
    const pendingOrder = orders.find(o => String(o.orderId) === String(pendingOrderId));
    if (pendingOrder) {
      if (pendingOrder.status && pendingOrder.status !== "NEW") {
        unlockOperating();
      }
    } else {
      // orders 里没有 pendingOrderId 对应的订单，说明已成交或撤销
      unlockOperating();
    }
  } else if (orders.length === 0) {
    unlockOperating();
  }
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

// 工具函数
function toPrice1Decimal(price: number) {
  return Math.floor(price * 10) / 10;
}
function toQty3Decimal(qty: number) {
  return Math.floor(qty * 1000) / 1000;
}

function getPosition() {
  if (!accountSnapshot)
    return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
  const pos = accountSnapshot.positions?.find((p) => p.symbol === TRADE_SYMBOL);
  if (!pos) return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
  return {
    positionAmt: parseFloat(pos.positionAmt),
    entryPrice: parseFloat(pos.entryPrice),
    unrealizedProfit: parseFloat(pos.unrealizedProfit),
  };
}

function getSMA30() {
  if (!klineSnapshot || klineSnapshot.length < 30) return null;
  const closes = klineSnapshot.slice(-30).map((k) => parseFloat(k.close));
  return closes.reduce((a, b) => a + b, 0) / closes.length;
}

function lockOperating(timeout = 3000) {
  isOperating = true;
  if (unlockTimer) clearTimeout(unlockTimer);
  unlockTimer = setTimeout(() => {
    isOperating = false;
    pendingOrderId = null;
    logTrade("error", "操作超时自动解锁");
  }, timeout);
}
function unlockOperating() {
  isOperating = false;
  pendingOrderId = null;
  if (unlockTimer) clearTimeout(unlockTimer);
  unlockTimer = null;
}

async function deduplicateOrders(type: string, side: string) {
  // 找出同类型同方向的订单
  const sameTypeOrders = openOrders.filter(o => o.type === type && o.side === side);
  if (sameTypeOrders.length <= 1) return;
  // 按时间排序，保留最新
  sameTypeOrders.sort((a, b) => {
    // updateTime 优先，没有就用 time
    const ta = b.updateTime || b.time || 0;
    const tb = a.updateTime || a.time || 0;
    return ta - tb;
  });
  const toCancel = sameTypeOrders.slice(1); // 除最新外的都撤销
  const orderIdList = toCancel.map(o => o.orderId);
  if (orderIdList.length > 0) {
    try {
      lockOperating();
      await aster.cancelOrders({ symbol: TRADE_SYMBOL, orderIdList });
      logTrade("order", `去重撤销重复${type}单: ${orderIdList.join(",")}`);
    } catch (e) {
      logTrade("error", `去重撤单失败: ${e}`);
    } finally {
      unlockOperating();
    }
  }
}

async function placeOrder(
  side: "BUY" | "SELL",
  price: number,
  amount: number,
  reduceOnly = false
) {
  const params: CreateOrderParams = {
    symbol: TRADE_SYMBOL,
    side,
    type: "LIMIT",
    quantity: toQty3Decimal(amount),
    price: toPrice1Decimal(price),
    timeInForce: "GTX",
  };
  if (reduceOnly) params.reduceOnly = "true";
  // 强制只保留1位小数
  params.price = toPrice1Decimal(params.price!);
  await deduplicateOrders("LIMIT", side);
  lockOperating();
  try {
    const order = await aster.createOrder(params);
    pendingOrderId = order.orderId;
    logTrade(
      "order",
      `挂单: ${side} @ ${params.price} 数量: ${params.quantity} reduceOnly: ${reduceOnly}`
    );
    return order;
  } catch (e) {
    unlockOperating();
    throw e;
  }
}

async function placeStopLossOrder(side: "BUY" | "SELL", stopPrice: number) {
  if (!tickerSnapshot) {
    logTrade("error", `止损单挂单失败：无法获取最新价格`);
    return;
  }
  const last = parseFloat(tickerSnapshot.lastPrice);
  if (side === "SELL" && stopPrice >= last) {
    logTrade(
      "error",
      `止损单价格(${stopPrice})高于或等于当前价(${last})，不挂单`
    );
    return;
  }
  if (side === "BUY" && stopPrice <= last) {
    logTrade(
      "error",
      `止损单价格(${stopPrice})低于或等于当前价(${last})，不挂单`
    );
    return;
  }
  const params: CreateOrderParams = {
    symbol: TRADE_SYMBOL,
    side,
    type: "STOP_MARKET",
    stopPrice: toPrice1Decimal(stopPrice),
    closePosition: "true",
    timeInForce: "GTC",
    quantity: toQty3Decimal(TRADE_AMOUNT),
  };
  // 强制只保留1位小数
  params.stopPrice = toPrice1Decimal(params.stopPrice!);
  await deduplicateOrders("STOP_MARKET", side);
  lockOperating();
  try {
    const order = await aster.createOrder(params);
    pendingOrderId = order.orderId;
    logTrade("stop", `挂止损单: ${side} STOP_MARKET @ ${params.stopPrice}`);
    return order;
  } catch (e) {
    unlockOperating();
    throw e;
  }
}

async function marketClose(side: "SELL" | "BUY") {
  const params: CreateOrderParams = {
    symbol: TRADE_SYMBOL,
    side,
    type: "MARKET",
    quantity: toQty3Decimal(TRADE_AMOUNT),
    reduceOnly: "true",
  };
  await deduplicateOrders("MARKET", side);
  lockOperating();
  try {
    const order = await aster.createOrder(params);
    pendingOrderId = order.orderId;
    logTrade("close", `市价平仓: ${side}`);
  } catch (e) {
    unlockOperating();
    throw e;
  }
}

function calcStopLossPrice(
  entryPrice: number,
  qty: number,
  side: "long" | "short",
  loss: number
) {
  if (side === "long") {
    return entryPrice - loss / qty;
  } else {
    return entryPrice + loss / Math.abs(qty);
  }
}
function calcTrailingActivationPrice(
  entryPrice: number,
  qty: number,
  side: "long" | "short",
  profit: number
) {
  if (side === "long") {
    return entryPrice + profit / qty;
  } else {
    return entryPrice - profit / Math.abs(qty);
  }
}

async function placeTrailingStopOrder(
  side: "BUY" | "SELL",
  activationPrice: number,
  quantity: number
) {
  const params: CreateOrderParams = {
    symbol: TRADE_SYMBOL,
    side,
    type: "TRAILING_STOP_MARKET",
    quantity: toQty3Decimal(quantity),
    reduceOnly: "true",
    activationPrice: toPrice1Decimal(activationPrice),
    callbackRate: TRAILING_CALLBACK_RATE,
    timeInForce: "GTC",
  };
  // 强制只保留1位小数
  params.activationPrice = toPrice1Decimal(params.activationPrice!);
  await deduplicateOrders("TRAILING_STOP_MARKET", side);
  lockOperating();
  try {
    const order = await aster.createOrder(params);
    pendingOrderId = order.orderId;
    logTrade(
      "order",
      `挂动态止盈单: ${side} TRAILING_STOP_MARKET activationPrice=${params.activationPrice} callbackRate=${TRAILING_CALLBACK_RATE}`
    );
    return order;
  } catch (e) {
    unlockOperating();
    throw e;
  }
}

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
    if (isOperating) continue;
    // 快照数据未准备好
    if (
      !accountSnapshot ||
      !tickerSnapshot ||
      !depthSnapshot ||
      !klineSnapshot.length
    )
      continue;
    lastSMA30 = getSMA30();
    if (lastSMA30 === null) continue;
    const ob = depthSnapshot;
    const ticker = tickerSnapshot;
    const price = parseFloat(ticker.lastPrice);
    const buy1 = ob.bids[0]?.[0];
    const sell1 = ob.asks[0]?.[0];
    const pos = getPosition();
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
        isOperating = true;
        await aster.cancelAllOrders({ symbol: TRADE_SYMBOL });
        pendingOrderId = null;
      }
      lastStopOrderSide = null;
      lastStopOrderPrice = null;
      pendingCloseOrder = null;
      // 仅在价格穿越SMA30时下市价单
      if (lastPrice !== null) {
        if (lastPrice > lastSMA30 && price < lastSMA30) {
          if (openOrders.length > 0) {
            isOperating = true;
            const orderIdList = openOrders.map(o => o.orderId);
            await aster.cancelOrders({ symbol: TRADE_SYMBOL, orderIdList });
            pendingOrderId = null;
          }
          isOperating = true;
          const params: CreateOrderParams = {
            symbol: TRADE_SYMBOL,
            side: "SELL",
            type: "MARKET",
            quantity: TRADE_AMOUNT,
          };
          await aster.createOrder(params);
          logTrade("open", `下穿SMA30，市价开空: SELL @ ${price}`);
          lastOpenOrderSide = "SELL";
          lastOpenOrderPrice = price;
        } else if (lastPrice < lastSMA30 && price > lastSMA30) {
          if (openOrders.length > 0) {
            isOperating = true;
            const orderIdList = openOrders.map(o => o.orderId);
            await aster.cancelOrders({ symbol: TRADE_SYMBOL, orderIdList });
            pendingOrderId = null;
          }
          isOperating = true;
          const params: CreateOrderParams = {
            symbol: TRADE_SYMBOL,
            side: "BUY",
            type: "MARKET",
            quantity: TRADE_AMOUNT,
          };
          await aster.createOrder(params);
          logTrade("open", `上穿SMA30，市价开多: BUY @ ${price}`);
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
          isOperating = true;
          pendingOrderId = null;
          await placeStopLossOrder(stopSide, profitMoveStopPrice);
          hasStop = true;
          logTrade(
            "stop",
            `盈利大于0.1u，挂盈利0.05u止损单: ${stopSide} @ ${profitMoveStopPrice}`
          );
        } else {
          let curStopPrice = parseFloat(currentStopOrder.stopPrice);
          if (Math.abs(curStopPrice - profitMoveStopPrice) > 0.01) {
            isOperating = true;
            pendingOrderId = String(currentStopOrder.orderId);
            await aster.cancelOrder({
              symbol: TRADE_SYMBOL,
              orderId: currentStopOrder.orderId,
            });
            isOperating = true;
            pendingOrderId = null;
            await placeStopLossOrder(stopSide, profitMoveStopPrice);
            logTrade(
              "stop",
              `盈利大于0.1u，移动止损单到盈利0.05u: ${stopSide} @ ${profitMoveStopPrice}`
            );
            hasStop = true;
          }
        }
      }
      if (!hasStop) {
        isOperating = true;
        pendingOrderId = null;
        await placeStopLossOrder(stopSide, toPrice1Decimal(stopPrice));
      }
      if (!hasTrailing) {
        isOperating = true;
        pendingOrderId = null;
        await placeTrailingStopOrder(
          stopSide,
          toPrice1Decimal(activationPrice),
          Math.abs(pos.positionAmt)
        );
      }
      if (pnl < -LOSS_LIMIT || pos.unrealizedProfit < -LOSS_LIMIT) {
        if (openOrders.length > 0) {
          isOperating = true;
          const orderIdList = openOrders.map(o => o.orderId);
          await aster.cancelOrders({ symbol: TRADE_SYMBOL, orderIdList });
          pendingOrderId = null;
        }
        isOperating = true;
        await marketClose(direction === "long" ? "SELL" : "BUY");
        lastOpenOrderPrice = null;
        lastOpenOrderSide = null;
        lastCloseOrderPrice = null;
        lastCloseOrderSide = null;
        lastStopOrderSide = null;
        lastStopOrderPrice = null;
        pendingCloseOrder = null;
        logTrade("close", `止损平仓: ${direction === "long" ? "SELL" : "BUY"}`);
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
              isOperating = true;
              await aster.cancelAllOrders({ symbol: TRADE_SYMBOL });
              pendingOrderId = null;
            }
            isOperating = true;
            await placeOrder(
              closeSide,
              closePrice,
              Math.abs(pos.positionAmt),
              true
            );
            lastCloseOrderSide = closeSide;
            lastCloseOrderPrice = closePrice;
            closeOrder = {
              side: closeSide,
              price: closePrice,
              amount: Math.abs(pos.positionAmt),
            };
            logTrade("order", `动态挂平仓单: ${closeSide} @ ${closePrice}`);
          }
        } else {
          if (pendingCloseOrder) {
            if (openOrders.length > 0) {
              isOperating = true;
              await aster.cancelAllOrders({ symbol: TRADE_SYMBOL });
              pendingOrderId = null;
            }
            pendingCloseOrder = null;
            lastCloseOrderSide = null;
            lastCloseOrderPrice = null;
            logTrade("order", `撤销平仓挂单`);
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
