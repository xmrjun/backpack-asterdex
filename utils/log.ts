import chalk from "chalk";
import { AsterTicker, AsterDepth, AsterOrder } from "../exchanges/aster";

export interface TradeLogItem {
  time: string;
  type: string;
  detail: string;
}

export function logTrade(tradeLog: TradeLogItem[], type: string, detail: string) {
  tradeLog.push({ time: new Date().toLocaleString(), type, detail });
  if (tradeLog.length > 1000) tradeLog.shift();
}

export function printStatus({
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
        `盘口 买一: ${ob.bids?.[0]?.[0] ?? "-"} 卖一: ${ob.asks?.[0]?.[0] ?? "-"}`
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
        `持仓: ${pos.positionAmt > 0 ? "多" : "空"} 开仓价: ${pos.entryPrice} 当前浮盈亏: ${pnl?.toFixed(4) ?? "-"} USDT 账户浮盈亏: ${unrealized?.toFixed(4) ?? "-"}`
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
