// 获取持仓信息
export function getPosition(accountSnapshot: any, TRADE_SYMBOL: string) {
  if (!accountSnapshot)
    return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
  const pos = accountSnapshot.positions?.find((p: any) => p.symbol === TRADE_SYMBOL);
  if (!pos) return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
  return {
    positionAmt: parseFloat(pos.positionAmt),
    entryPrice: parseFloat(pos.entryPrice),
    unrealizedProfit: parseFloat(pos.unrealizedProfit),
  };
}

// 计算SMA30
export function getSMA30(klineSnapshot: any[]) {
  if (!klineSnapshot || klineSnapshot.length < 30) return null;
  const closes = klineSnapshot.slice(-30).map((k) => parseFloat(k.close));
  return closes.reduce((a, b) => a + b, 0) / closes.length;
}
