import { pro as ccxt } from "ccxt";
import dotenv from 'dotenv';

// 明确加载.env文件
dotenv.config();
import { WebSocketPriceManager } from "./websocket-price-manager.js";
import AsterAPI from "./aster-api.js";
import {
  TRADE_SYMBOL,
  TRADE_AMOUNT,
  ARB_THRESHOLD,
  CLOSE_DIFF,
  LEVERAGE,
  MAX_POSITION_SIZE,
  MAX_ADD_POSITIONS,
  ADD_POSITION_SPREAD,
  FORCE_CLOSE_TIME,
  DAILY_VOLUME_TARGET,
  DAILY_TRADES_TARGET,
} from "./config.js";

// 🚀 双WebSocket价格管理器
const priceManager = new WebSocketPriceManager(
  process.env.ASTER_API_KEY!,
  process.env.ASTER_API_SECRET!
);

// 交易配置 - 混合API
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

// 符号转换函数
function getBackpackSymbol(asterSymbol: string): string {
  if (asterSymbol === "BTCUSDT") return "BTC/USDC:USDC";
  if (asterSymbol === "ETHUSDT") return "ETH/USDC:USDC";
  return asterSymbol;
}

// 时间锁管理
let lastTradeTime = 0;
const TRADE_LOCK_DURATION = 3000; // 3秒时间锁

// 检查和等待时间锁
async function waitForTradeLock(): Promise<void> {
  const now = Date.now();
  const timeSinceLastTrade = now - lastTradeTime;

  if (timeSinceLastTrade < TRADE_LOCK_DURATION) {
    const waitTime = TRADE_LOCK_DURATION - timeSinceLastTrade;
    log(`⏰ 时间锁等待 ${waitTime}ms | 上次交易: ${new Date(lastTradeTime).toLocaleTimeString()}`, 'info');
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  lastTradeTime = Date.now();
}

// 🔄 双WebSocket价格获取函数 - 替代旧的单独实现

// 🚀 获取双WebSocket实时价格
async function getAsterPrice() {
  const asterPrice = priceManager.getAsterPrice();

  if (asterPrice) {
    return {
      bid: asterPrice.bid,
      ask: asterPrice.ask,
      lastPrice: asterPrice.lastPrice,
      source: 'WebSocket'
    };
  } else {
    log('⚠️ AsterDx WebSocket价格无效，使用备用方案', 'warn');
    throw new Error('AsterDx WebSocket price unavailable');
  }
}

async function getBackpackPrice() {
  const backpackPrice = priceManager.getBackpackPrice();

  if (backpackPrice) {
    return {
      bid: backpackPrice.bid,
      ask: backpackPrice.ask,
      lastPrice: backpackPrice.lastPrice,
      source: 'WebSocket'
    };
  } else {
    log('⚠️ Backpack WebSocket价格无效，回退到CCXT', 'warn');
    const backpackSymbol = getBackpackSymbol(TRADE_SYMBOL);
    const backpackTicker = await backpackPrivate.fetchTicker(backpackSymbol);

    if (!backpackTicker?.last) {
      throw new Error('Backpack价格数据不可用');
    }

    return {
      bid: backpackTicker.bid || backpackTicker.last,
      ask: backpackTicker.ask || backpackTicker.last,
      lastPrice: backpackTicker.last,
      source: 'CCXT'
    };
  }
}

// 价格精度修正函数
function fixBackpackPrice(price: number, symbol: string): string {
  if (symbol.includes("ETH")) {
    return (Math.round(price * 100) / 100).toFixed(2); // ETH tickSize: 0.01
  }
  if (symbol.includes("BTC")) {
    return (Math.round(price * 10) / 10).toFixed(1); // BTC tickSize: 0.1
  }
  return price.toFixed(2);
}

// 统计数据
let stats = {
  dailyVolume: 0,
  dailyTrades: 0,
  dailyProfit: 0,
  positions: [],
  currentGroup: {
    direction: null,
    totalAmount: 0,
    positions: [],
    firstOpenTime: 0,
  }
};

function log(message: string, type = 'info') {
  const timestamp = new Date().toLocaleString();
  const prefix = { info: '📊', success: '✅', error: '❌', warn: '⚠️' }[type] || '📊';
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

// 交易锁，防止并发执行
let isTrading = false;

// 获取价格并计算价差
async function checkPricesAndTrade() {
  if (isTrading) {
    log('🔒 交易进行中，跳过本轮检查', 'debug');
    return;
  }

  isTrading = true;
  try {
    // 1. 获取AsterDx价格 (WebSocket优先)
    const asterPrice = await getAsterPrice();
    const asterBid = asterPrice.bid;  // 买价（买单最高价）
    const asterAsk = asterPrice.ask;  // 卖价（卖单最低价）

    // 2. 获取Backpack价格 (WebSocket优先)
    const backpackPrice = await getBackpackPrice();
    const backpackBid = backpackPrice.bid;
    const backpackAsk = backpackPrice.ask;
    const backpackMidPrice = (backpackBid + backpackAsk) / 2;

    // 3. 计算价差 (以Backpack为基准)
    const asterMidPrice = (asterBid + asterAsk) / 2; // AsterDex中间价
    const priceDiff = backpackMidPrice - asterMidPrice; // Backpack价格 - AsterDex价格

    // 4. 显示价格信息 (包含数据源)
    const sourceIcon = asterPrice.source === 'WebSocket' ? '📡' : '🌐';
    const backpackIcon = backpackPrice.source === 'WebSocket' ? '📡' : '🌐';
    log(`💰 AsterDx: ${asterBid.toFixed(2)}/${asterAsk.toFixed(2)} (${asterMidPrice.toFixed(2)}) ${sourceIcon} | Backpack: ${backpackBid.toFixed(2)}/${backpackAsk.toFixed(2)} (${backpackMidPrice.toFixed(2)}) ${backpackIcon} | 价差: ${priceDiff.toFixed(2)}`);

    const group = stats.currentGroup;

    // 5. 交易逻辑
    if (!group.direction) {
      // 无持仓，寻找开仓机会
      if (Math.abs(priceDiff) > ARB_THRESHOLD) {
        if (priceDiff > 0) {
          // Backpack价格高: Backpack开空 + AsterDex开多
          await executeAddPosition('buy_aster_sell_backpack', {
            asterPrice: asterAsk,
            backpackPrice: backpackPrice,
            spread: priceDiff
          });
        } else {
          // AsterDex价格高: AsterDex开空 + Backpack开多
          await executeAddPosition('sell_aster_buy_backpack', {
            asterPrice: asterBid,
            backpackPrice: backpackPrice,
            spread: Math.abs(priceDiff)
          });
        }
      }
    } else {
      // 有持仓，检查加仓或平仓
      const currentSpread = Math.abs(priceDiff); // 当前价差绝对值
      const holdTime = Date.now() - group.firstOpenTime;

      log(`📊 持仓状态: ${group.direction} | 总量: ${group.totalAmount.toFixed(6)} | 仓位数: ${group.positions.length}/${MAX_ADD_POSITIONS} | 当前价差: ${currentSpread.toFixed(2)}`);

      // 平仓条件 - 价差小于25U
      if (currentSpread <= CLOSE_DIFF) {
        await closeAllPositions();
      }
      // 加仓条件
      else if (group.positions.length < MAX_ADD_POSITIONS && group.totalAmount < MAX_POSITION_SIZE) {
        const EPS = 0.1; // 容差值，允许0.1U的误差
        const requiredSpread = ARB_THRESHOLD + (group.positions.length * ADD_POSITION_SPREAD);

        // 检查价差方向是否和持仓方向一致
        const spreadDirection = priceDiff > 0 ? 'buy_aster_sell_backpack' : 'sell_aster_buy_backpack';

        if (spreadDirection === group.direction && currentSpread >= requiredSpread - EPS) {
          const prices = spreadDirection === 'buy_aster_sell_backpack'
            ? { asterPrice: asterAsk, backpackPrice: backpackPrice, spread: currentSpread }
            : { asterPrice: asterBid, backpackPrice: backpackPrice, spread: currentSpread };
          await executeAddPosition(group.direction, prices);
        }
      }
    }

  } catch (error) {
    log(`获取价格失败: ${error}`, 'error');
  } finally {
    isTrading = false; // 释放交易锁
  }
}

// AsterDex下单函数 - 使用CCXT binance适配器 (币安API格式)
async function placeAsterOrder(side: "BUY" | "SELL", amount: number, price?: number, reduceOnly = false) {
  try {
    // 构建订单参数 - 币安API格式
    const params: any = {};
    if (reduceOnly) {
      params.reduceOnly = true;
    }

    let order;
    if (price) {
      // 限价单
      order = await asterPrivate.createOrder(TRADE_SYMBOL, 'limit', side.toLowerCase(), amount, price, params);
    } else {
      // 市价单 - 使用CCXT标准方法
      order = await asterPrivate.createMarketOrder(TRADE_SYMBOL, side.toLowerCase(), amount, undefined, params);
    }

    log(`[AsterDex] ${side} ${amount} @ ${price || 'Market'} | 订单ID: ${order?.id}`, 'success');
    return order;
  } catch (error) {
    log(`[AsterDx] 下单失败: ${error}`, 'error');
    return null;
  }
}

// 执行加仓
async function executeAddPosition(type, prices) {
  // 🔒 应用3秒时间锁
  await waitForTradeLock();

  const group = stats.currentGroup;

  if (!group.direction) {
    group.direction = type;
    group.firstOpenTime = Date.now();
    log(`🎯 初次开仓 [${type}] | 价差: ${prices.spread.toFixed(2)} USDT`, 'success');
  } else {
    log(`📈 执行加仓 [${type}] | 价差: ${prices.spread.toFixed(2)} USDT | 第${group.positions.length + 1}仓`, 'success');
  }

  try {
    let asterSuccess = false;
    let backpackSuccess = false;

    // AsterDex下单 (使用市价单)
    if (type === 'buy_aster_sell_backpack') {
      log(`[AsterDex] 市价买入 ${TRADE_AMOUNT}`, 'success');
      const asterOrder = await placeAsterOrder('BUY', TRADE_AMOUNT);
      asterSuccess = asterOrder?.id;
    } else {
      log(`[AsterDex] 市价卖出 ${TRADE_AMOUNT}`, 'success');
      const asterOrder = await placeAsterOrder('SELL', TRADE_AMOUNT);
      asterSuccess = asterOrder?.id;
    }

    // Backpack 5x杠杆合约下单
    if (asterSuccess) {
      const backpackSide = type === 'buy_aster_sell_backpack' ? 'Ask' : 'Bid';
      const backpackSymbol = getBackpackSymbol(TRADE_SYMBOL);
      log(`[Backpack] ${backpackSide} ${TRADE_AMOUNT} @ ${prices.backpackPrice}`, 'success');

      const backpackOrder = await backpackPrivate.createMarketOrder(
        getBackpackSymbol(TRADE_SYMBOL),
        backpackSide,
        TRADE_AMOUNT
      );

      backpackSuccess = backpackOrder?.id;
    }

    // 只有两边都成功才记录仓位
    if (asterSuccess && backpackSuccess) {
      // 记录仓位
      const position = {
        asterSide: type === 'buy_aster_sell_backpack' ? 'BUY' : 'SELL',
        backpackSide: type === 'buy_aster_sell_backpack' ? 'Ask' : 'Bid',
        amount: TRADE_AMOUNT,
        asterPrice: prices.asterPrice,
        backpackPrice: prices.backpackPrice,
        timestamp: Date.now(),
        spread: prices.spread,
      };

      group.positions.push(position);
      stats.positions.push(position);
      group.totalAmount += TRADE_AMOUNT;

      stats.dailyTrades++;
      stats.dailyVolume += TRADE_AMOUNT * prices.asterPrice * 2;

      log(`✅ 加仓成功 | 第${group.positions.length}仓 | 累计: ${group.totalAmount.toFixed(6)} | 今日交易量: ${stats.dailyVolume.toFixed(2)} USDT`, 'success');
    } else {
      log(`❌ 对冲失败，开始清理单边订单`, 'error');

      // 如果AsterDx下单成功但Backpack失败，需要反向平仓AsterDx
      if (asterSuccess && !backpackSuccess) {
        log(`🔄 AsterDx成功但Backpack失败，平仓AsterDx单边持仓`, 'warn');
        const reverseSide = type === 'buy_aster_sell_backpack' ? 'SELL' : 'BUY';
        await placeAsterOrder(reverseSide, TRADE_AMOUNT, undefined, true);
      }

      // 如果Backpack成功但AsterDx失败 (理论上不会发生，因为Backpack在AsterDx成功后才下单)
      if (!asterSuccess && backpackSuccess) {
        log(`🔄 Backpack成功但AsterDx失败，平仓Backpack单边持仓`, 'warn');
        const backpackCloseSide = type === 'buy_aster_sell_backpack' ? 'Bid' : 'Ask';
        await backpackPrivate.createMarketOrder(
          getBackpackSymbol(TRADE_SYMBOL),
          backpackCloseSide,
          TRADE_AMOUNT,
          undefined,
          undefined,
          { reduceOnly: true }
        );
      }
    }

  } catch (error) {
    log(`加仓失败: ${error}`, 'error');
  }
}

// 平仓所有持仓
async function closeAllPositions() {
  // 🔒 应用3秒时间锁
  await waitForTradeLock();

  const group = stats.currentGroup;
  if (!group.direction) return;

  const holdTime = Date.now() - group.firstOpenTime;
  log(`🔄 开始平仓 | 方向: ${group.direction} | 总持仓: ${group.totalAmount.toFixed(6)} | 持仓时间: ${(holdTime/60000).toFixed(1)}分钟`, 'warn');

  try {
    const positionsToClose = [...group.positions]; // 复制数组避免修改影响循环
    let closedCount = 0;

    for (let i = 0; i < positionsToClose.length; i++) {
      const position = positionsToClose[i];

      // 🔒 每个仓位平仓前都等待3秒并重新检查价差
      if (i > 0) { // 第一个仓位不等待，后续仓位等待
        await waitForTradeLock();

        // 重新获取最新价差 (使用WebSocket价格)
        try {
          const asterPrice = await getAsterPrice();
          const backpackTicker = await backpackPrivate.fetchTicker(getBackpackSymbol(TRADE_SYMBOL));

          const asterAsk = asterPrice.ask;
          const asterBid = asterPrice.bid;
          const backpackPrice = backpackTicker.price;
          const currentPriceDiff = backpackPrice - (asterAsk + asterBid) / 2;
          const currentSpread = Math.abs(currentPriceDiff);

          log(`🔍 重新检查价差 | 当前价差: ${currentSpread.toFixed(2)} USDT | 平仓阈值: ${CLOSE_DIFF} USDT`, 'info');

          // 如果价差重新变大，停止继续平仓
          if (currentSpread > CLOSE_DIFF + 5) { // 加5U缓冲避免频繁触发
            log(`⚠️ 价差重新变大(${currentSpread.toFixed(2)} > ${CLOSE_DIFF + 5})，停止继续平仓 | 已平仓: ${closedCount}/${positionsToClose.length}`, 'warn');
            break;
          }
        } catch (error) {
          log(`❌ 重新检查价差失败: ${error} | 继续平仓`, 'error');
        }
      }

      log(`🔄 平仓第${i+1}/${positionsToClose.length}个仓位 | 数量: ${position.amount}`, 'info');

      // AsterDx平仓
      const asterCloseSide = position.asterSide === 'BUY' ? 'SELL' : 'BUY';
      await placeAsterOrder(asterCloseSide, position.amount, undefined, true);

      // Backpack 5x杠杆合约平仓
      const backpackCloseSide = position.backpackSide === 'Ask' ? 'Bid' : 'Ask';
      await backpackPrivate.createMarketOrder(
        getBackpackSymbol(TRADE_SYMBOL),
        backpackCloseSide,
        position.amount,
        undefined,
        undefined,
        { reduceOnly: true }
      );

      closedCount++;
      log(`✅ 第${i+1}个仓位平仓完成`, 'success');
    }

    log(`📊 平仓汇总: ${closedCount}/${positionsToClose.length} 个仓位已平仓`, 'info');

    // 清空持仓 - 只清空已平仓的部分
    if (closedCount === positionsToClose.length) {
      // 全部平仓完成
      stats.positions = [];
      stats.currentGroup = {
        direction: null,
        totalAmount: 0,
        positions: [],
        firstOpenTime: 0,
      };
      log(`🎉 全部平仓完成 | 本轮交易结束`, 'success');
    } else {
      // 部分平仓，更新剩余仓位
      const remainingPositions = group.positions.slice(closedCount);
      stats.positions = remainingPositions;
      stats.currentGroup.positions = remainingPositions;
      stats.currentGroup.totalAmount = remainingPositions.reduce((sum, pos) => sum + pos.amount, 0);
      log(`⚠️ 部分平仓完成 | 剩余仓位: ${remainingPositions.length}个 | 剩余数量: ${stats.currentGroup.totalAmount.toFixed(6)}`, 'warn');
    }

  } catch (error) {
    log(`平仓失败: ${error}`, 'error');
  }
}

// 统计报告
function printStats() {
  const volumeProgress = (stats.dailyVolume / DAILY_VOLUME_TARGET * 100).toFixed(1);
  const tradesProgress = (stats.dailyTrades / DAILY_TRADES_TARGET * 100).toFixed(1);

  console.log('\n=== 📊 今日交易统计 ===');
  console.log(`交易量: ${stats.dailyVolume.toFixed(2)} / ${DAILY_VOLUME_TARGET} USDT (${volumeProgress}%)`);
  console.log(`交易笔数: ${stats.dailyTrades} / ${DAILY_TRADES_TARGET} (${tradesProgress}%)`);
  console.log(`当前持仓: ${stats.positions.length}`);
  console.log(`盈亏: ${stats.dailyProfit.toFixed(2)} USDT`);
  console.log('========================\n');
}

// 主程序
async function main() {
  log('🚀 启动 AsterDex <-> Backpack 真实5x杠杆对冲交易机器人', 'success');
  log(`目标: ${DAILY_VOLUME_TARGET} USDT交易量, ${DAILY_TRADES_TARGET}笔交易`, 'info');
  log(`交易符号: ${TRADE_SYMBOL} (${TRADE_AMOUNT}) → ${getBackpackSymbol(TRADE_SYMBOL)}`, 'info');

  // 初始化双WebSocket价格管理器
  log('🚀 初始化双WebSocket价格管理器...', 'info');
  await priceManager.initializeAll();

  // 显示连接状态
  setInterval(() => {
    log(priceManager.getPriceStats(), 'info');
  }, 10000);

  // 等待3秒让WebSocket连接建立
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 主循环 - 每3秒检查一次
  setInterval(async () => {
    await checkPricesAndTrade();
  }, 3000);

  // 统计报告 - 每30秒一次
  setInterval(printStats, 30000);

  log('✅ 机器人已启动，正在监听真实价格差价...', 'success');
}

// 优雅退出
process.on('SIGINT', async () => {
  log('正在关闭机器人...', 'warn');

  // 关闭双WebSocket连接
  try {
    priceManager.cleanup();
    log('🔌 双WebSocket连接已关闭', 'info');
  } catch (error) {
    log(`❌ 关闭WebSocket连接失败: ${error}`, 'error');
  }

  await closeAllPositions();
  printStats();
  process.exit(0);
});

main().catch(error => {
  log(`启动失败: ${error}`, 'error');
  process.exit(1);
});