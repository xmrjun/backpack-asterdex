import { Aster, CreateOrderParams, AsterOrder } from "../exchanges/aster";
import { TRADE_SYMBOL, TRADE_AMOUNT, TRAILING_CALLBACK_RATE } from "../config";

// 工具函数
export function toPrice1Decimal(price: number) {
  return Math.floor(price * 10) / 10;
}
export function toQty3Decimal(qty: number) {
  return Math.floor(qty * 1000) / 1000;
}

export function isOperating(orderTypeLocks: { [key: string]: boolean }, type: string) {
  return !!orderTypeLocks[type];
}

export function lockOperating(orderTypeLocks: { [key: string]: boolean }, orderTypeUnlockTimer: { [key: string]: NodeJS.Timeout | null }, orderTypePendingOrderId: { [key: string]: string | null }, type: string, logTrade: (type: string, detail: string) => void, timeout = 3000) {
  orderTypeLocks[type] = true;
  if (orderTypeUnlockTimer[type]) clearTimeout(orderTypeUnlockTimer[type]!);
  orderTypeUnlockTimer[type] = setTimeout(() => {
    orderTypeLocks[type] = false;
    orderTypePendingOrderId[type] = null;
    logTrade("error", `${type}操作超时自动解锁`);
  }, timeout);
}

export function unlockOperating(orderTypeLocks: { [key: string]: boolean }, orderTypeUnlockTimer: { [key: string]: NodeJS.Timeout | null }, orderTypePendingOrderId: { [key: string]: string | null }, type: string) {
  orderTypeLocks[type] = false;
  orderTypePendingOrderId[type] = null;
  if (orderTypeUnlockTimer[type]) clearTimeout(orderTypeUnlockTimer[type]!);
  orderTypeUnlockTimer[type] = null;
}

export async function deduplicateOrders(aster: Aster, openOrders: AsterOrder[], orderTypeLocks: { [key: string]: boolean }, orderTypeUnlockTimer: { [key: string]: NodeJS.Timeout | null }, orderTypePendingOrderId: { [key: string]: string | null }, type: string, side: string, logTrade: (type: string, detail: string) => void) {
  const sameTypeOrders = openOrders.filter(o => o.type === type && o.side === side);
  if (sameTypeOrders.length <= 1) return;
  sameTypeOrders.sort((a, b) => {
    const ta = b.updateTime || b.time || 0;
    const tb = a.updateTime || a.time || 0;
    return ta - tb;
  });
  const toCancel = sameTypeOrders.slice(1);
  const orderIdList = toCancel.map(o => o.orderId);
  if (orderIdList.length > 0) {
    try {
      lockOperating(orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type, logTrade);
      await aster.cancelOrders({ symbol: TRADE_SYMBOL, orderIdList });
      logTrade("order", `去重撤销重复${type}单: ${orderIdList.join(",")}`);
    } catch (e) {
      logTrade("error", `去重撤单失败: ${e}`);
    } finally {
      unlockOperating(orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type);
    }
  }
}

export async function placeOrder(aster: Aster, openOrders: AsterOrder[], orderTypeLocks: { [key: string]: boolean }, orderTypeUnlockTimer: { [key: string]: NodeJS.Timeout | null }, orderTypePendingOrderId: { [key: string]: string | null }, side: "BUY" | "SELL", price: number, amount: number, logTrade: (type: string, detail: string) => void, reduceOnly = false) {
  const type = "LIMIT";
  if (isOperating(orderTypeLocks, type)) return;
  const params: CreateOrderParams = {
    symbol: TRADE_SYMBOL,
    side,
    type,
    quantity: toQty3Decimal(amount),
    price: toPrice1Decimal(price),
    timeInForce: "GTX",
  };
  if (reduceOnly) params.reduceOnly = "true";
  params.price = toPrice1Decimal(params.price!);
  await deduplicateOrders(aster, openOrders, orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type, side, logTrade);
  lockOperating(orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type, logTrade);
  try {
    const order = await aster.createOrder(params);
    orderTypePendingOrderId[type] = order.orderId;
    logTrade(
      "order",
      `挂单: ${side} @ ${params.price} 数量: ${params.quantity} reduceOnly: ${reduceOnly}`
    );
    return order;
  } catch (e) {
    unlockOperating(orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type);
    throw e;
  }
}

export async function placeStopLossOrder(aster: Aster, openOrders: AsterOrder[], orderTypeLocks: { [key: string]: boolean }, orderTypeUnlockTimer: { [key: string]: NodeJS.Timeout | null }, orderTypePendingOrderId: { [key: string]: string | null }, tickerSnapshot: any, side: "BUY" | "SELL", stopPrice: number, logTrade: (type: string, detail: string) => void) {
  const type = "STOP_MARKET";
  if (isOperating(orderTypeLocks, type)) return;
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
    type,
    stopPrice: toPrice1Decimal(stopPrice),
    closePosition: "true",
    timeInForce: "GTC",
    quantity: toQty3Decimal(TRADE_AMOUNT),
  };
  params.stopPrice = toPrice1Decimal(params.stopPrice!);
  await deduplicateOrders(aster, openOrders, orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type, side, logTrade);
  lockOperating(orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type, logTrade);
  try {
    const order = await aster.createOrder(params);
    orderTypePendingOrderId[type] = order.orderId;
    logTrade("stop", `挂止损单: ${side} STOP_MARKET @ ${params.stopPrice}`);
    return order;
  } catch (e) {
    unlockOperating(orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type);
    throw e;
  }
}

export async function marketClose(aster: Aster, openOrders: AsterOrder[], orderTypeLocks: { [key: string]: boolean }, orderTypeUnlockTimer: { [key: string]: NodeJS.Timeout | null }, orderTypePendingOrderId: { [key: string]: string | null }, side: "SELL" | "BUY", logTrade: (type: string, detail: string) => void) {
  const type = "MARKET";
  if (isOperating(orderTypeLocks, type)) return;
  const params: CreateOrderParams = {
    symbol: TRADE_SYMBOL,
    side,
    type,
    quantity: toQty3Decimal(TRADE_AMOUNT),
    reduceOnly: "true",
  };
  await deduplicateOrders(aster, openOrders, orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type, side, logTrade);
  lockOperating(orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type, logTrade);
  try {
    const order = await aster.createOrder(params);
    orderTypePendingOrderId[type] = order.orderId;
    logTrade("close", `市价平仓: ${side}`);
  } catch (e) {
    unlockOperating(orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type);
    throw e;
  }
}

export function calcStopLossPrice(entryPrice: number, qty: number, side: "long" | "short", loss: number) {
  if (side === "long") {
    return entryPrice - loss / qty;
  } else {
    return entryPrice + loss / Math.abs(qty);
  }
}

export function calcTrailingActivationPrice(entryPrice: number, qty: number, side: "long" | "short", profit: number) {
  if (side === "long") {
    return entryPrice + profit / qty;
  } else {
    return entryPrice - profit / Math.abs(qty);
  }
}

export async function placeTrailingStopOrder(aster: Aster, openOrders: AsterOrder[], orderTypeLocks: { [key: string]: boolean }, orderTypeUnlockTimer: { [key: string]: NodeJS.Timeout | null }, orderTypePendingOrderId: { [key: string]: string | null }, side: "BUY" | "SELL", activationPrice: number, quantity: number, logTrade: (type: string, detail: string) => void) {
  const type = "TRAILING_STOP_MARKET";
  if (isOperating(orderTypeLocks, type)) return;
  const params: CreateOrderParams = {
    symbol: TRADE_SYMBOL,
    side,
    type,
    quantity: toQty3Decimal(quantity),
    reduceOnly: "true",
    activationPrice: toPrice1Decimal(activationPrice),
    callbackRate: TRAILING_CALLBACK_RATE,
    timeInForce: "GTC",
  };
  params.activationPrice = toPrice1Decimal(params.activationPrice!);
  await deduplicateOrders(aster, openOrders, orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type, side, logTrade);
  lockOperating(orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type, logTrade);
  try {
    const order = await aster.createOrder(params);
    orderTypePendingOrderId[type] = order.orderId;
    logTrade(
      "order",
      `挂动态止盈单: ${side} TRAILING_STOP_MARKET activationPrice=${params.activationPrice} callbackRate=${TRAILING_CALLBACK_RATE}`
    );
    return order;
  } catch (e) {
    unlockOperating(orderTypeLocks, orderTypeUnlockTimer, orderTypePendingOrderId, type);
    throw e;
  }
}
