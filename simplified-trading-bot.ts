// 简化版交易机器人 - 保持模块化，简化逻辑
import { pro as ccxt } from "ccxt";
import dotenv from 'dotenv';

dotenv.config();
import { EnhancedWebSocketManager } from "./utils/enhanced-websocket-manager.js";
import AsterAPI from "./aster-api.js";
import { SimpleTrader } from "./utils/simple-trader.js";
import { tradeHistory } from "./utils/trade-history.js";
import {
  TRADE_SYMBOL,
  TRADE_AMOUNT,
  ARB_THRESHOLD,
  CLOSE_DIFF,
  DAILY_VOLUME_TARGET,
  DAILY_TRADES_TARGET,
} from "./config.js";

// 🚀 初始化交易所连接
const asterPrivate = new AsterAPI({
  apiKey: process.env.ASTER_API_KEY!,
  secret: process.env.ASTER_API_SECRET!
});

const backpackPrivate = new ccxt.backpack({
  apiKey: process.env.BACKPACK_API_KEY,
  secret: process.env.BACKPACK_SECRET_KEY,
  sandbox: false,
  options: {
    defaultType: 'swap',
  }
});

// 🚀 简化的交易执行器
const simpleTrader = new SimpleTrader(asterPrivate, backpackPrivate);

// 🚀 增强WebSocket价格管理器
const priceManager = new EnhancedWebSocketManager(
  process.env.ASTER_API_KEY!,
  process.env.ASTER_API_SECRET!,
  process.env.BACKPACK_API_KEY!,
  process.env.BACKPACK_SECRET_KEY!
);

// 符号转换函数
function getBackpackSymbol(asterSymbol: string): string {
  if (asterSymbol === "BTCUSDT") return "BTC/USDC:USDC";
  if (asterSymbol === "ETHUSDT") return "ETH/USDC:USDC";
  return asterSymbol;
}

// 统计数据
let stats = {
  dailyVolume: 0,
  dailyTrades: 0,
  dailyProfit: 0,
};

// 交易锁，防止并发执行
let isTrading = false;

function log(message: string, type = 'info') {
  const timestamp = new Date().toLocaleString();
  const prefix = { info: '📊', success: '✅', error: '❌', warn: '⚠️' }[type] || '📊';
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

// 简化的开仓逻辑
async function executeOpenPosition(type: 'buy_aster_sell_backpack' | 'sell_aster_buy_backpack', prices: any) {
  log(`🎯 执行开仓 [${type}] | 价差: ${prices.spread.toFixed(2)} USDT`, 'success');

  try {
    // 🚀 使用简化的交易器
    const result = await simpleTrader.openPosition(type, TRADE_AMOUNT);

    if (result.success) {
      // 更新统计
      stats.dailyTrades++;
      stats.dailyVolume += TRADE_AMOUNT * prices.asterPrice;

      const todayStats = tradeHistory.getTodayStats();
      log(`✅ 开仓成功 | 今日第${todayStats.totalTrades}笔 | 今日交易量: ${stats.dailyVolume.toFixed(2)} USDT`, 'success');
    } else {
      log(`❌ 开仓失败: ${result.error}`, 'error');
    }

  } catch (error) {
    log(`开仓异常: ${error}`, 'error');
  }
}

// 简化的平仓逻辑
async function executeCloseAllPositions() {
  log('🔄 执行平仓...', 'info');

  try {
    const success = await simpleTrader.closeAllPositions();
    if (success) {
      const todayStats = tradeHistory.getTodayStats();
      log(`✅ 平仓完成 | 今日盈亏: ${todayStats.totalPnL.toFixed(4)} USDT`, 'success');
    }
  } catch (error) {
    log(`平仓异常: ${error}`, 'error');
  }
}

// 简化的价格检查和交易逻辑
async function checkPricesAndTrade() {
  if (isTrading) {
    return;
  }

  try {
    isTrading = true;

    // 获取价格
    const asterPrice = priceManager.getAsterPrice();
    const backpackPrice = priceManager.getBackpackPrice();

    if (!asterPrice || !backpackPrice || !asterPrice.isValid || !backpackPrice.isValid) {
      return;
    }

    const prices = {
      asterPrice,
      backpackPrice,
      isValid: true,
      spread: 0
    };

    // 计算价差
    const asterBid = prices.asterPrice.bid || prices.asterPrice.lastPrice;
    const asterAsk = prices.asterPrice.ask || prices.asterPrice.lastPrice;
    const backpackBid = prices.backpackPrice.bid || prices.backpackPrice.lastPrice;
    const backpackAsk = prices.backpackPrice.ask || prices.backpackPrice.lastPrice;

    const spread1 = backpackBid - asterAsk; // AsterDx买入，Backpack卖出
    const spread2 = asterBid - backpackAsk; // AsterDx卖出，Backpack买入

    prices.spread = Math.max(spread1, spread2);

    // 简化的交易决策
    const hasOpenTrades = await simpleTrader.hasOpenPositions();

    if (!hasOpenTrades && prices.spread > ARB_THRESHOLD) {
      // 开仓
      if (spread1 > spread2) {
        await executeOpenPosition('buy_aster_sell_backpack', {
          ...prices,
          spread: spread1,
          asterPrice: asterAsk,
          backpackPrice: backpackBid
        });
      } else {
        await executeOpenPosition('sell_aster_buy_backpack', {
          ...prices,
          spread: spread2,
          asterPrice: asterBid,
          backpackPrice: backpackAsk
        });
      }
    } else if (hasOpenTrades && prices.spread < CLOSE_DIFF) {
      // 平仓
      await executeCloseAllPositions();
    }

    // 显示状态
    const todayStats = tradeHistory.getTodayStats();
    log(`💰 AsterDx: ${asterBid?.toFixed(1)}/${asterAsk?.toFixed(1)} | Backpack: ${backpackBid?.toFixed(1)}/${backpackAsk?.toFixed(1)} | 价差: ${prices.spread.toFixed(2)} | 持仓: ${todayStats.openTrades}`, 'info');

  } catch (error) {
    log(`价格检查异常: ${error}`, 'error');
  } finally {
    isTrading = false;
  }
}

// 统计报告
function printStats() {
  const todayStats = tradeHistory.getTodayStats();
  console.log('\n=== 📊 今日交易统计 ===');
  console.log(`交易量: ${stats.dailyVolume.toFixed(2)} / ${DAILY_VOLUME_TARGET} USDT (${(stats.dailyVolume / DAILY_VOLUME_TARGET * 100).toFixed(1)}%)`);
  console.log(`交易笔数: ${todayStats.totalTrades} / ${DAILY_TRADES_TARGET} (${(todayStats.totalTrades / DAILY_TRADES_TARGET * 100).toFixed(1)}%)`);
  console.log(`当前持仓: ${todayStats.openTrades}`);
  console.log(`今日盈亏: ${todayStats.totalPnL.toFixed(4)} USDT`);
  console.log(`手续费: ${todayStats.totalFees.toFixed(4)} USDT`);
  console.log('========================');
}

// 主程序
async function main() {
  log('🚀 启动简化版 AsterDx <-> Backpack 套利机器人', 'success');
  log(`交易参数: ${TRADE_SYMBOL} (${TRADE_AMOUNT}) | 开仓阈值: ${ARB_THRESHOLD} | 平仓阈值: ${CLOSE_DIFF}`, 'info');

  try {
    // 初始化WebSocket
    await priceManager.initializeAll();

    // 注册WebSocket回调
    priceManager.onTradeExecution((trade) => {
      log(`📈 成交执行: ${trade.symbol} ${trade.side} 数量:${trade.executedQty} 价格:${trade.executedPrice}`, 'success');
    });

    log('✅ WebSocket连接已建立', 'success');

    // 主循环：简化的价格监控
    setInterval(checkPricesAndTrade, 3000); // 3秒检查一次

    // 统计报告
    setInterval(printStats, 60000); // 1分钟报告一次

    log('✅ 简化版套利机器人已启动，监听价差机会...', 'success');

  } catch (error) {
    log(`启动失败: ${error}`, 'error');
    process.exit(1);
  }
}

// 优雅退出
process.on('SIGINT', async () => {
  log('正在关闭简化版机器人...', 'warn');
  await priceManager.cleanup();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  log(`未捕获异常: ${error.message}`, 'error');
});

process.on('unhandledRejection', (reason) => {
  log(`未处理的Promise拒绝: ${reason}`, 'error');
});

main();