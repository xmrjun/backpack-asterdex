import { pro as ccxt } from "ccxt";
import "dotenv/config";
import chalk from "chalk";
import { TRADE_SYMBOL, TRADE_AMOUNT, LOSS_LIMIT, STOP_LOSS_DIST, TRAILING_PROFIT, TRAILING_CALLBACK_RATE } from "../config";

const asterPrivate = new ccxt.binance({
  apiKey: process.env.ASTER_API_KEY,
  secret: process.env.ASTER_API_SECRET,
  options: { defaultType: "swap" },
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
  options: { defaultType: "swap" },
  urls: asterPrivate.urls,
});

let wsOrderbook: any = null;
let wsTicker: any = null;
let lastSMA30 = 0;
let pendingCloseOrder: any = null;
let lastStopOrderSide: "BUY" | "SELL" | null = null;
let lastStopOrderPrice: number | null = null;
let lastStopOrderId: string | number | null = null;

// 交易统计
let tradeLog: any[] = [];
let totalProfit = 0;
let totalTrades = 0;

// 工具函数：价格保留1位小数，数量保留3位小数
function toPrice1Decimal(price: number) {
  return Math.floor(price * 10) / 10;
}
function toQty3Decimal(qty: number) {
  return Math.floor(qty * 1000) / 1000;
}

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
  totalTrades
}: any) {
  console.clear();
  console.log(chalk.bold.bgCyan("  趋势策略机器人  "));
  console.log(chalk.yellow(`最新价格: ${ticker?.last ?? "-"} | SMA30: ${sma?.toFixed(2) ?? "-"}`));
  if (ob) {
    console.log(
      chalk.green(
        `盘口 买一: ${ob.bids?.[0]?.[0] ?? "-"} 卖一: ${ob.asks?.[0]?.[0] ?? "-"}`
      )
    );
  }
  console.log(chalk.magenta(`当前趋势: ${trend}`));
  if (openOrder) {
    console.log(chalk.blue(`当前开仓挂单: ${openOrder.side} @ ${openOrder.price} 数量: ${openOrder.amount}`));
  }
  if (closeOrder) {
    console.log(chalk.blueBright(`当前平仓挂单: ${closeOrder.side} @ ${closeOrder.price} 数量: ${closeOrder.amount}`));
  }
  if (stopOrder) {
    console.log(chalk.red(`止损单: ${stopOrder.side} STOP_MARKET @ ${stopOrder.stopPrice}`));
  }
  if (pos && Math.abs(pos.positionAmt) > 0.00001) {
    console.log(
      chalk.bold(
        `持仓: ${pos.positionAmt > 0 ? "多" : "空"} 开仓价: ${pos.entryPrice} 当前浮盈亏: ${pnl?.toFixed(4) ?? "-"} USDT 账户浮盈亏: ${unrealized?.toFixed(4) ?? "-"}`
      )
    );
  } else {
    console.log(chalk.gray("当前无持仓"));
  }
  console.log(chalk.bold(`累计交易次数: ${totalTrades}  累计收益: ${totalProfit.toFixed(4)} USDT`));
  console.log(chalk.bold("最近交易/挂单记录："));
  tradeLog.slice(-10).forEach(log => {
    let color = chalk.white;
    if (log.type === "open") color = chalk.green;
    if (log.type === "close") color = chalk.blue;
    if (log.type === "stop") color = chalk.red;
    if (log.type === "order") color = chalk.yellow;
    if (log.type === "error") color = chalk.redBright;
    console.log(color(`[${log.time}] [${log.type}] ${log.detail}`));
  });
  console.log(chalk.gray("按 Ctrl+C 退出"));
}

function watchWS(symbol: string) {
  (async () => {
    while (true) {
      try {
        wsOrderbook = await aster.watchOrderBook(symbol, 5);
      } catch (e) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  })();
  (async () => {
    while (true) {
      try {
        wsTicker = await aster.watchTicker(symbol);
      } catch (e) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  })();
}

async function getSMA30() {
  const klines = await asterPrivate.fapiPublicGetKlines({
    symbol: TRADE_SYMBOL,
    interval: "1m",
    limit: 30,
  });
  const closes = klines.map((k: any) => parseFloat(k[4]));
  const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
  return sma;
}

async function getPosition() {
  const account = await asterPrivate.fapiPrivateV2GetAccount();
  const pos = account.positions.find((p: any) => p.symbol === TRADE_SYMBOL);
  if (!pos) return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
  return {
    positionAmt: parseFloat(pos.positionAmt),
    entryPrice: parseFloat(pos.entryPrice),
    unrealizedProfit: parseFloat(pos.unrealizedProfit)
  };
}

async function placeOrder(side: "BUY" | "SELL", price: number, amount: number, reduceOnly = false) {
  const params: any = {
    symbol: TRADE_SYMBOL,
    side,
    type: "LIMIT",
    quantity: toQty3Decimal(amount),
    price: toPrice1Decimal(price),
    timeInForce: "GTX",
  };
  if (reduceOnly) params.reduceOnly = true;
  const order = await asterPrivate.fapiPrivatePostOrder(params);
  logTrade("order", `挂单: ${side} @ ${params.price} 数量: ${params.quantity} reduceOnly: ${reduceOnly}`);
  return order;
}

async function placeStopLossOrder(side: "BUY" | "SELL", stopPrice: number) {
  const ticker = wsTicker; // 获取最新价格
  if (!ticker) {
    logTrade("error", `止损单挂单失败：无法获取最新价格`);
    return;
  }
  const last = ticker.last;
  // 多单止损（SELL），止损价必须低于当前价
  if (side === "SELL" && stopPrice >= last) {
    logTrade("error", `止损单价格(${stopPrice})高于或等于当前价(${last})，不挂单`);
    return;
  }
  // 空单止损（BUY），止损价必须高于当前价
  if (side === "BUY" && stopPrice <= last) {
    logTrade("error", `止损单价格(${stopPrice})低于或等于当前价(${last})，不挂单`);
    return;
  }
  const params: any = {
    symbol: TRADE_SYMBOL,
    side,
    type: "STOP_MARKET",
    stopPrice: toPrice1Decimal(stopPrice),
    closePosition: true,
    timeInForce: "GTC",
    quantity: toQty3Decimal(TRADE_AMOUNT), // closePosition:true时quantity可选，但部分api需要
  };
  const order = await asterPrivate.fapiPrivatePostOrder(params);
  logTrade("stop", `挂止损单: ${side} STOP_MARKET @ ${params.stopPrice}`);
  return order;
}

async function marketClose(side: "SELL" | "BUY") {
  await asterPrivate.fapiPrivatePostOrder({
    symbol: TRADE_SYMBOL,
    side,
    type: "MARKET",
    quantity: toQty3Decimal(TRADE_AMOUNT),
    reduceOnly: true
  });
  logTrade("close", `市价平仓: ${side}`);
}

// 计算止损价和动态止盈激活价
function calcStopLossPrice(entryPrice: number, qty: number, side: "long" | "short", loss: number) {
  if (side === "long") {
    return entryPrice - loss / qty;
  } else {
    return entryPrice + loss / Math.abs(qty);
  }
}
function calcTrailingActivationPrice(entryPrice: number, qty: number, side: "long" | "short", profit: number) {
  if (side === "long") {
    return entryPrice + profit / qty;
  } else {
    return entryPrice - profit / Math.abs(qty);
  }
}

// 新增：抽象动态止盈单下单方法
async function placeTrailingStopOrder(side: "BUY" | "SELL", activationPrice: number, quantity: number) {
  const ticker = wsTicker;
  if (!ticker) {
    logTrade("error", `动态止盈单挂单失败：无法获取最新价格`);
    return;
  }
  const last = ticker.last;
  // 多单动态止盈（SELL），激活价必须高于当前价
  if (side === "SELL" && activationPrice <= last) {
    logTrade("error", `动态止盈单激活价(${activationPrice})低于或等于当前价(${last})，不挂单`);
    return;
  }
  // 空单动态止盈（BUY），激活价必须低于当前价
  if (side === "BUY" && activationPrice >= last) {
    logTrade("error", `动态止盈单激活价(${activationPrice})高于或等于当前价(${last})，不挂单`);
    return;
  }
  const params: any = {
    symbol: TRADE_SYMBOL,
    side,
    type: "TRAILING_STOP_MARKET",
    quantity: toQty3Decimal(quantity),
    reduceOnly: true,
    activationPrice: toPrice1Decimal(activationPrice),
    callbackRate: TRAILING_CALLBACK_RATE,
    timeInForce: "GTC"
  };
  const order = await asterPrivate.fapiPrivatePostOrder(params);
  logTrade("order", `挂动态止盈单: ${side} TRAILING_STOP_MARKET activationPrice=${params.activationPrice} callbackRate=${TRAILING_CALLBACK_RATE}`);
  return order;
}

async function trendStrategy() {
  watchWS(TRADE_SYMBOL);
  let lastDirection: "long" | "short" | "none" = "none";
  let orderObj: any = null;
  let lastOpenOrderPrice: number | null = null;
  let lastOpenOrderSide: "BUY" | "SELL" | null = null;
  let lastCloseOrderPrice: number | null = null;
  let lastCloseOrderSide: "BUY" | "SELL" | null = null;
  let lastPrice: number | null = null; // 新增变量，记录上一次价格
  while (true) {
    try {
      lastSMA30 = await getSMA30();
      for (let i = 0; i < 60; i++) {
        const ob = wsOrderbook;
        const ticker = wsTicker;
        if (!ob || !ticker) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        const price = ticker.last;
        const buy1 = ob.bids[0]?.[0];
        const sell1 = ob.asks[0]?.[0];
        const pos = await getPosition();
        let trend = "无信号";
        if (price < lastSMA30) trend = "做空";
        if (price > lastSMA30) trend = "做多";
        let openOrder: any = null, closeOrder: any = null, stopOrder: any = null;
        let pnl = 0;
        // 无仓位
        if (Math.abs(pos.positionAmt) < 0.00001) {
          // 撤销所有普通挂单和止损单
          await asterPrivate.fapiPrivateDeleteAllOpenOrders({ symbol: TRADE_SYMBOL });
          lastStopOrderSide = null;
          lastStopOrderPrice = null;
          lastStopOrderId = null;
          // 仅在价格穿越SMA30时下市价单
          if (lastPrice !== null) {
            // 上次价格 > SMA30，本次价格 < SMA30，下穿，开空
            if (lastPrice > lastSMA30 && price < lastSMA30) {
              await asterPrivate.fapiPrivateDeleteAllOpenOrders({ symbol: TRADE_SYMBOL });
              orderObj = await asterPrivate.fapiPrivatePostOrder({
                symbol: TRADE_SYMBOL,
                side: "SELL",
                type: "MARKET",
                quantity: TRADE_AMOUNT
              });
              logTrade("open", `下穿SMA30，市价开空: SELL @ ${price}`);
              lastOpenOrderSide = "SELL";
              lastOpenOrderPrice = price;
              lastDirection = "short";
              openOrder = { side: "SELL", price, amount: TRADE_AMOUNT };
              // 在市价单成交后，等待持仓并挂止损单和动态止盈单
              for (let wait = 0; wait < 10; wait++) {
                const posAfter = await getPosition();
                if (Math.abs(posAfter.positionAmt) > 0.00001 && posAfter.entryPrice > 0) {
                  const direction = posAfter.positionAmt > 0 ? "long" : "short";
                  const stopSide = direction === "long" ? "SELL" : "BUY";
                  const stopPrice = toPrice1Decimal(calcStopLossPrice(posAfter.entryPrice, Math.abs(posAfter.positionAmt), direction as 'long' | 'short', LOSS_LIMIT));
                  await placeStopLossOrder(stopSide, stopPrice);
                  const activationPrice = toPrice1Decimal(calcTrailingActivationPrice(posAfter.entryPrice, Math.abs(posAfter.positionAmt), direction, TRAILING_PROFIT));
                  await placeTrailingStopOrder(stopSide, activationPrice, Math.abs(posAfter.positionAmt));
                  logTrade("order", `挂动态止盈单: ${stopSide} TRAILING_STOP_MARKET activationPrice=${activationPrice} callbackRate=${TRAILING_CALLBACK_RATE}`);
                  break;
                }
                await new Promise(r => setTimeout(r, 500));
              }
            }
            // 上次价格 < SMA30，本次价格 > SMA30，上穿，开多
            else if (lastPrice < lastSMA30 && price > lastSMA30) {
              await asterPrivate.fapiPrivateDeleteAllOpenOrders({ symbol: TRADE_SYMBOL });
              orderObj = await asterPrivate.fapiPrivatePostOrder({
                symbol: TRADE_SYMBOL,
                side: "BUY",
                type: "MARKET",
                quantity: TRADE_AMOUNT
              });
              logTrade("open", `上穿SMA30，市价开多: BUY @ ${price}`);
              lastOpenOrderSide = "BUY";
              lastOpenOrderPrice = price;
              lastDirection = "long";
              openOrder = { side: "BUY", price, amount: TRADE_AMOUNT };
              // 在市价单成交后，等待持仓并挂止损单和动态止盈单
              for (let wait = 0; wait < 10; wait++) {
                const posAfter = await getPosition();
                if (Math.abs(posAfter.positionAmt) > 0.00001 && posAfter.entryPrice > 0) {
                  const direction = posAfter.positionAmt > 0 ? "long" : "short";
                  const stopSide = direction === "long" ? "SELL" : "BUY";
                  const stopPrice = toPrice1Decimal(calcStopLossPrice(posAfter.entryPrice, Math.abs(posAfter.positionAmt), direction as 'long' | 'short', LOSS_LIMIT));
                  await placeStopLossOrder(stopSide, stopPrice);
                  const activationPrice = toPrice1Decimal(calcTrailingActivationPrice(posAfter.entryPrice, Math.abs(posAfter.positionAmt), direction, TRAILING_PROFIT));
                  await placeTrailingStopOrder(stopSide, activationPrice, Math.abs(posAfter.positionAmt));
                  logTrade("order", `挂动态止盈单: ${stopSide} TRAILING_STOP_MARKET activationPrice=${activationPrice} callbackRate=${TRAILING_CALLBACK_RATE}`);
                  break;
                }
                await new Promise(r => setTimeout(r, 500));
              }
            }
          }
        } else {
          // 有仓位
          let direction = pos.positionAmt > 0 ? "long" : "short";
          pnl = (direction === "long" ? price - pos.entryPrice : pos.entryPrice - price) * Math.abs(pos.positionAmt);
          // 检查当前是否有止损/止盈单，没有则补挂
          let stopSide: "SELL" | "BUY" = direction === "long" ? "SELL" : "BUY";
          let stopPrice = calcStopLossPrice(pos.entryPrice, Math.abs(pos.positionAmt), direction as 'long' | 'short', LOSS_LIMIT);
          let activationPrice = direction === "long"
            ? (pos.entryPrice + 0.2 / Math.abs(pos.positionAmt))
            : (pos.entryPrice - 0.2 / Math.abs(pos.positionAmt));
          let openOrders = await asterPrivate.fapiPrivateGetOpenOrders({ symbol: TRADE_SYMBOL });
          let hasStop = openOrders.some((o: any) => o.type === "STOP_MARKET" && o.side === stopSide);
          let hasTrailing = openOrders.some((o: any) => o.type === "TRAILING_STOP_MARKET" && o.side === stopSide);

          // ====== 盈利移动止损单逻辑开始 ======
          // 计算盈利0.05u对应的止损价
          let profitMove = 0.05;
          let profitMoveStopPrice = direction === "long"
            ? toPrice1Decimal(pos.entryPrice + profitMove / Math.abs(pos.positionAmt))
            : toPrice1Decimal(pos.entryPrice - profitMove / Math.abs(pos.positionAmt));
          // 查找当前止损单
          let currentStopOrder = openOrders.find((o: any) => o.type === "STOP_MARKET" && o.side === stopSide);
          // 只要盈利大于0.1u就触发
          if (pnl > 0.1 || pos.unrealizedProfit > 0.1) {
            if (!currentStopOrder) {
              // 没有止损单，直接在盈利0.05u处挂止损单
              await placeStopLossOrder(stopSide, profitMoveStopPrice);
              hasStop = true; // 避免后续重复补挂
              logTrade("stop", `盈利大于0.1u，挂盈利0.05u止损单: ${stopSide} @ ${profitMoveStopPrice}`);
            } else {
              // 有止损单，判断价格是否一致
              let curStopPrice = parseFloat(currentStopOrder.stopPrice);
              if (Math.abs(curStopPrice - profitMoveStopPrice) > 0.01) {
                // 价格不一致，取消原止损单再挂新单
                await asterPrivate.fapiPrivateDeleteOrder({ symbol: TRADE_SYMBOL, orderId: currentStopOrder.orderId });
                await placeStopLossOrder(stopSide, profitMoveStopPrice);
                logTrade("stop", `盈利大于0.1u，移动止损单到盈利0.05u: ${stopSide} @ ${profitMoveStopPrice}`);
                hasStop = true; // 避免后续重复补挂
              }
            }
          }
          // ====== 盈利移动止损单逻辑结束 ======

          if (!hasStop) {
            // 补挂止损单
            await placeStopLossOrder(stopSide, toPrice1Decimal(stopPrice));
          }
          if (!hasTrailing) {
            // 补挂止盈单
            await placeTrailingStopOrder(stopSide, toPrice1Decimal(activationPrice), Math.abs(pos.positionAmt));
            logTrade("order", `补挂动态止盈单: ${stopSide} TRAILING_STOP_MARKET activationPrice=${toPrice1Decimal(activationPrice)} callbackRate=${TRAILING_CALLBACK_RATE}`);
          }
          // 止损
          if (pnl < -LOSS_LIMIT || pos.unrealizedProfit < -LOSS_LIMIT) {
            await asterPrivate.fapiPrivateDeleteAllOpenOrders({ symbol: TRADE_SYMBOL });
            await marketClose(direction === "long" ? "SELL" : "BUY");
            lastOpenOrderPrice = null;
            lastOpenOrderSide = null;
            lastCloseOrderPrice = null;
            lastCloseOrderSide = null;
            lastStopOrderSide = null;
            lastStopOrderPrice = null;
            lastStopOrderId = null;
            logTrade("close", `止损平仓: ${direction === "long" ? "SELL" : "BUY"}`);
            totalTrades++;
            totalProfit += pnl;
            continue;
          }
          // 盈利时，价格反向穿越SMA30，动态挂平仓单
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
                closePrice = sell1;
              } else {
                closeSide = "BUY";
                closePrice = buy1;
              }
              if (lastCloseOrderSide !== closeSide || lastCloseOrderPrice !== closePrice) {
                needCloseOrder = true;
              }
              if (needCloseOrder && closeSide && closePrice) {
                await asterPrivate.fapiPrivateDeleteAllOpenOrders({ symbol: TRADE_SYMBOL });
                pendingCloseOrder = await placeOrder(closeSide, closePrice, Math.abs(pos.positionAmt), true);
                lastCloseOrderSide = closeSide;
                lastCloseOrderPrice = closePrice;
                closeOrder = { side: closeSide, price: closePrice, amount: Math.abs(pos.positionAmt) };
                logTrade("order", `动态挂平仓单: ${closeSide} @ ${closePrice}`);
              }
            } else {
              // 价格回归趋势方向，撤销平仓单
              if (pendingCloseOrder) {
                await asterPrivate.fapiPrivateDeleteAllOpenOrders({ symbol: TRADE_SYMBOL });
                pendingCloseOrder = null;
                lastCloseOrderSide = null;
                lastCloseOrderPrice = null;
                logTrade("order", `撤销平仓挂单`);
              }
            }
          } else {
            // 非盈利或未触发平仓逻辑时，清空平仓挂单跟踪
            lastCloseOrderSide = null;
            lastCloseOrderPrice = null;
          }
        }
        // 实时打印状态
        printStatus({
          ticker,
          ob,
          sma: lastSMA30,
          trend,
          openOrder: (Math.abs(pos.positionAmt) < 0.00001) ? (lastOpenOrderSide && lastOpenOrderPrice ? { side: lastOpenOrderSide, price: lastOpenOrderPrice, amount: TRADE_AMOUNT } : null) : null,
          closeOrder: (Math.abs(pos.positionAmt) > 0.00001) ? (lastCloseOrderSide && lastCloseOrderPrice ? { side: lastCloseOrderSide, price: lastCloseOrderPrice, amount: Math.abs(pos.positionAmt) } : null) : null,
          stopOrder: (Math.abs(pos.positionAmt) > 0.00001) ? (lastStopOrderSide && lastStopOrderPrice ? { side: lastStopOrderSide, stopPrice: lastStopOrderPrice } : null) : null,
          pos,
          pnl,
          unrealized: pos.unrealizedProfit,
          tradeLog,
          totalProfit,
          totalTrades
        });
        lastPrice = price; // 记录本次价格，供下次判断穿越
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {
      // 不再自动撤销所有挂单
      // await asterPrivate.fapiPrivateDeleteAllOpenOrders({ symbol: TRADE_SYMBOL });
      lastOpenOrderPrice = null;
      lastOpenOrderSide = null;
      lastCloseOrderPrice = null;
      lastCloseOrderSide = null;
      lastStopOrderSide = null;
      lastStopOrderPrice = null;
      lastStopOrderId = null;
      logTrade("error", `策略异常: ${e}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

trendStrategy();
