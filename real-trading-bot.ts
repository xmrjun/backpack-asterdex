import { pro as ccxt } from "ccxt";
import dotenv from 'dotenv';

// 明确加载.env文件
dotenv.config();
import { EnhancedWebSocketManager } from "./utils/enhanced-websocket-manager.js";
import AsterAPI from "./aster-api.js";
import { SimpleTrader } from "./utils/simple-trader.js";
import { tradeHistory } from "./utils/trade-history.js";
import { globalAdaptiveLock } from "./utils/adaptive-lock.js";
import { globalConnectionPool } from "./utils/connection-pool.js";
import { globalPerformanceMonitor } from "./utils/performance-monitor.js";
import { RealFeeTracker } from "./utils/real-fee-tracker.js";
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

// 🚀 增强双WebSocket价格管理器 - 激活AsterDx高级功能
const priceManager = new EnhancedWebSocketManager(
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

// 🚀 简化的交易执行器
const simpleTrader = new SimpleTrader(asterPrivate, backpackPrivate);

// 符号转换函数
function getBackpackSymbol(asterSymbol: string): string {
  if (asterSymbol === "BTCUSDT") return "BTC/USDC:USDC";
  if (asterSymbol === "ETHUSDT") return "ETH/USDC:USDC";
  return asterSymbol;
}

// 替换为自适应时间锁管理
async function waitForTradeLock(): Promise<void> {
  const lockDuration = await globalAdaptiveLock.waitForOptimalTiming();
  log(`⏰ 自适应时间锁: ${lockDuration}ms`, 'info');
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
let stats: any = {
  dailyVolume: 0,
  dailyTrades: 0,
  dailyProfit: 0,
  positions: [],
  // 使用持仓管理器的getter，保持兼容性
  get currentGroup() {
    return globalPositionManager.getCurrentGroup();
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
      order = await asterPrivate.createOrder(TRADE_SYMBOL, 'limit', side.toLowerCase() as 'buy' | 'sell', amount, price, params);
    } else {
      // 市价单 - 使用CCXT标准方法
      order = await asterPrivate.createMarketOrder(TRADE_SYMBOL, side.toLowerCase() as 'buy' | 'sell', amount, undefined, params);
    }

    log(`[AsterDex] ${side} ${amount} @ ${price || 'Market'} | 订单ID: ${order?.id}`, 'success');
    return order;
  } catch (error) {
    log(`[AsterDx] 下单失败: ${error}`, 'error');
    return null;
  }
}

// 执行加仓 - 使用Race-First优化
async function executeAddPosition(type: any, prices: any) {
  // 🔒 应用自适应时间锁
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
    // 准备订单参数
    const asterSide = type === 'buy_aster_sell_backpack' ? 'BUY' : 'SELL';
    const backpackSide = type === 'buy_aster_sell_backpack' ? 'Ask' : 'Bid';
    const backpackSymbol = getBackpackSymbol(TRADE_SYMBOL);

    log(`📤 Race-First并发下单: [AsterDx] ${asterSide} | [Backpack] ${backpackSide} | 数量: ${TRADE_AMOUNT}`, 'info');

    // 🚀 使用Race-First执行引擎，极速并发下单
    const raceResult = await globalRaceExecutor.executeRaceOrders(
      () => placeAsterOrder(asterSide, TRADE_AMOUNT),
      () => backpackPrivate.createMarketOrder(backpackSymbol, backpackSide, TRADE_AMOUNT),
      'open'
    );

    // 更新自适应时间锁统计
    globalAdaptiveLock.updateExecutionTime(raceResult.totalExecutionTime, raceResult.bothSuccessful);

    // 检查结果
    const asterSuccess = raceResult.results.find(r => r.exchange === 'aster')?.success;
    const backpackSuccess = raceResult.results.find(r => r.exchange === 'backpack')?.success;

    if (!asterSuccess) {
      const asterError = raceResult.results.find(r => r.exchange === 'aster')?.error;
      log(`❌ [AsterDx] 下单失败: ${asterError}`, 'error');
    }
    if (!backpackSuccess) {
      const backpackError = raceResult.results.find(r => r.exchange === 'backpack')?.error;
      log(`❌ [Backpack] 下单失败: ${backpackError}`, 'error');
    }

    log(`⚡ Race执行统计: 总时间${raceResult.totalExecutionTime.toFixed(2)}ms | 时间差${raceResult.timeDifference.toFixed(2)}μs | 首完成${raceResult.firstCompleted}`, 'info');

    // 监控单边风险
    await globalRaceExecutor.monitorSingleSideRisk(raceResult, 5000);

    // 只有两边都成功才记录仓位
    if (raceResult.bothSuccessful) {
      // 🔍 查询实际成交价格（重要！）
      const asterOrder = raceResult.results.find(r => r.exchange === 'aster')?.order;
      const backpackOrder = raceResult.results.find(r => r.exchange === 'backpack')?.order;

      // 如果AsterDx返回的avgPrice是0，等待并查询
      let asterActualPrice = asterOrder?.avgPrice || asterOrder?.price || prices.asterPrice;
      if (asterOrder?.orderId && (!asterActualPrice || asterActualPrice === '0' || asterActualPrice === 0)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          const orderDetail = await asterPrivate.fetchOrder(asterOrder.orderId, TRADE_SYMBOL);
          asterActualPrice = orderDetail.avgPrice || prices.asterPrice;
          log(`📊 AsterDx实际成交价格: ${asterActualPrice}`, 'info');
        } catch (e) {
          log(`⚠️ 无法查询AsterDx成交价格，使用市场价: ${prices.asterPrice}`, 'warn');
        }
      }

      // Backpack通常立即返回成交价格
      const backpackActualPrice = backpackOrder?.price || prices.backpackPrice.lastPrice;

      // 记录仓位（包含实际成交价格）
      const position = {
        asterSide: type === 'buy_aster_sell_backpack' ? 'BUY' : 'SELL',
        backpackSide: type === 'buy_aster_sell_backpack' ? 'Ask' : 'Bid',
        amount: TRADE_AMOUNT,
        asterPrice: parseFloat(asterActualPrice),  // 实际成交价
        backpackPrice: parseFloat(backpackActualPrice),  // 实际成交价
        asterOrderId: asterOrder?.orderId || asterOrder?.id,
        backpackOrderId: backpackOrder?.id,
        timestamp: Date.now(),
        spread: prices.spread,
        status: 'open'  // 标记为未平仓
      };

      group.positions.push(position);
      stats.positions.push(position);
      group.totalAmount += TRADE_AMOUNT;

      stats.dailyTrades++;
      stats.dailyVolume += TRADE_AMOUNT * prices.asterPrice;  // 单边交易量，不需要乘2

      log(`✅ 加仓成功 | 第${group.positions.length}仓 | 累计: ${group.totalAmount.toFixed(6)} | 今日交易量: ${stats.dailyVolume.toFixed(2)} USDT`, 'success');
    } else {
      log(`❌ 单边下单失败，跳过本次交易`, 'error');
      log(`⚠️ 如有单边持仓，请手动检查交易所并平仓`, 'warn');
      return;
    }

  } catch (error) {
    log(`加仓失败: ${error}`, 'error');
  }
}

// 平仓所有持仓 - 使用Race-First优化
async function closeAllPositions() {
  // 🔒 应用自适应时间锁
  await waitForTradeLock();

  const group = stats.currentGroup;
  if (!group.direction) return;

  const holdTime = Date.now() - group.firstOpenTime;
  const totalAmount = parseFloat(String(group.totalAmount || 0));
  log(`🔄 开始Race-First平仓 | 方向: ${group.direction} | 总持仓: ${totalAmount.toFixed(6)} | 持仓时间: ${(holdTime/60000).toFixed(1)}分钟`, 'warn');

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

      log(`🔄 Race-First平仓第${i+1}/${positionsToClose.length}个仓位 | 数量: ${position.amount}`, 'info');

      // 准备平仓参数
      const asterCloseSide = position.asterSide === 'BUY' ? 'SELL' : 'BUY';
      const backpackCloseSide = position.backpackSide === 'Ask' ? 'Bid' : 'Ask';

      // 🚀 使用Race-First执行引擎，极速并发平仓
      const raceResult = await globalRaceExecutor.executeRaceOrders(
        () => placeAsterOrder(asterCloseSide, position.amount, undefined, true),
        () => backpackPrivate.createMarketOrder(
          getBackpackSymbol(TRADE_SYMBOL),
          backpackCloseSide,
          position.amount,
          undefined,
          undefined,
          { reduceOnly: true }
        ),
        'close'
      );

      // 更新自适应时间锁统计
      globalAdaptiveLock.updateExecutionTime(raceResult.totalExecutionTime, raceResult.bothSuccessful);

      if (raceResult.bothSuccessful) {
        closedCount++;
        log(`✅ 第${i+1}个仓位Race平仓完成 | 时间差${raceResult.timeDifference.toFixed(2)}μs`, 'success');
      } else {
        // 监控单边风险
        await globalRaceExecutor.monitorSingleSideRisk(raceResult, 3000);

        // 记录失败详情
        raceResult.results.forEach(result => {
          if (!result.success) {
            log(`❌ ${result.exchange} 平仓失败: ${result.error}`, 'error');
          }
        });
      }
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
  log('🚀 启动 AsterDx <-> Backpack Race-First优化交易机器人', 'success');
  log(`目标: ${DAILY_VOLUME_TARGET} USDT交易量, ${DAILY_TRADES_TARGET}笔交易`, 'info');
  log(`交易符号: ${TRADE_SYMBOL} (${TRADE_AMOUNT}) → ${getBackpackSymbol(TRADE_SYMBOL)}`, 'info');

  // 初始化连接池预热
  log('🔥 预热连接池...', 'info');
  await globalConnectionPool.warmupConnections();

  // 初始化双WebSocket价格管理器
  log('🚀 初始化增强双WebSocket价格管理器...', 'info');
  await priceManager.initializeAll();

  // 初始化真实费用追踪器
  log('💰 初始化费用追踪器...', 'info');
  const feeTracker = new RealFeeTracker(priceManager.asterSDK, backpackPrivate);

  // 🚀 激活AsterDx高级WebSocket功能
  log('📊 注册WebSocket实时数据回调...', 'info');

  // 订单状态更新回调
  priceManager.onOrderStatusUpdate((orders) => {
    orders.forEach(order => {
      log(`📊 订单更新: ${order.symbol} ${order.side} ${order.status} 价格:${order.avgPrice} 数量:${order.executedQty}`, 'info');

      // 🚀 更新到持仓管理器
      globalPositionManager.updatePosition({
        orderId: order.orderId.toString(),
        symbol: order.symbol,
        side: order.side,
        amount: parseFloat(order.executedQty || '0'),
        price: parseFloat(order.avgPrice || '0'),
        exchange: 'AsterDx',
        openTime: order.updateTime,
        status: order.status
      });

      // 兼容性：更新统计数据中的订单状态
      const existingPos = stats.positions.find(p => p.orderId === order.orderId);
      if (existingPos) {
        existingPos.status = order.status;
        existingPos.avgPrice = order.avgPrice;
        existingPos.executedQty = order.executedQty;
        existingPos.updateTime = order.updateTime;
      }
    });
  });

  // 账户余额变化回调
  priceManager.onAccountBalanceUpdate((balances) => {
    balances.forEach(balance => {
      if (parseFloat(balance.walletBalance) > 0) {
        log(`💰 余额更新: ${balance.asset} 钱包:${balance.walletBalance} 可用:${balance.availableBalance}`, 'info');
      }
    });
  });

  // 成交记录推送回调
  priceManager.onTradeExecution((trade) => {
    const profit = parseFloat(trade.executedQty) * parseFloat(trade.executedPrice);
    log(`📈 成交执行: ${trade.symbol} ${trade.side} 数量:${trade.executedQty} 价格:${trade.executedPrice} 手续费:${trade.commission}${trade.commissionAsset}`, 'success');

    // 更新日交易统计
    stats.dailyTrades++;
    stats.dailyVolume += profit;
  });

  // 🚀 注册Backpack私有WebSocket回调
  priceManager.onBackpackOrderUpdate((data) => {
    log(`📊 Backpack订单更新: ${JSON.stringify(data)}`, 'info');

    // 🚀 更新到持仓管理器
    if (data.orderId && data.status) {
      globalPositionManager.updatePosition({
        orderId: data.orderId.toString(),
        symbol: data.symbol || TRADE_SYMBOL,
        side: data.side || 'unknown',
        amount: parseFloat(data.executedQty || '0'),
        price: parseFloat(data.avgPrice || '0'),
        exchange: 'Backpack',
        openTime: data.updateTime || Date.now(),
        status: data.status
      });
    }
  });

  priceManager.onBackpackBalanceUpdate((data) => {
    log(`💰 Backpack余额更新: ${JSON.stringify(data)}`, 'info');
  });

  priceManager.onBackpackTradeExecution((data) => {
    log(`📈 Backpack成交执行: ${JSON.stringify(data)}`, 'success');
  });

  log('✅ AsterDx + Backpack增强WebSocket功能已激活', 'success');

  // 🚀 启动时同步持仓状态
  log('🔄 启动时同步持仓状态...', 'info');
  try {
    // 查询AsterDx账户信息 (包含持仓)
    const asterAccount = await asterPrivate.fetchBalance();
    const asterPositions = asterAccount.positions || [];

    // 查询Backpack持仓
    const backpackPositions = await backpackPrivate.fetchPositions([`${TRADE_SYMBOL.replace('USDT', '/USDC:USDC')}`]);

    // 同步到持仓管理器
    await globalPositionManager.syncWithExchange(asterPositions, backpackPositions);

    log(`✅ 持仓同步完成: ${globalPositionManager.getSummary()}`, 'success');
    log(`📊 AsterDx账户: ${asterPositions.length}个持仓, Backpack: ${backpackPositions.length}个持仓`, 'info');
  } catch (error) {
    log(`⚠️ 持仓同步失败: ${error.message}`, 'warn');
  }

  // 注册实时费用监听
  priceManager.onRealFee((feeData: any) => {
    log(`💰 实时费用: ${feeData.exchange} ${feeData.side} $${feeData.fee.toFixed(4)} (${(feeData.feeRate*10000).toFixed(1)}bp) ${feeData.isMaker ? 'Maker' : 'Taker'}`, 'info');
  });

  // 显示连接状态和性能统计
  setInterval(() => {
    log(priceManager.getPriceStats(), 'info');
    log(priceManager.getEnhancedStatus(), 'info');

    // 显示优化统计
    const raceStats = globalRaceExecutor.getStats();
    const lockStats = globalAdaptiveLock.getStats();
    const connectionStats = globalConnectionPool.getConnectionStats();

    log(`⚡ 性能优化统计:`, 'info');
    log(`   Race平均执行: ${raceStats.averageExecutionTime.toFixed(2)}ms | 平均时间差: ${raceStats.averageTimeDifference.toFixed(2)}μs`, 'info');
    log(`   自适应锁: ${lockStats.currentLockDuration}ms | 连续失败: ${lockStats.consecutiveFailures} | 网络状况: ${(lockStats.networkCondition * 100).toFixed(0)}%`, 'info');
    log(`   连接池: Aster=${connectionStats.asterConnections} | Backpack=${connectionStats.backpackConnections} | 预热=${connectionStats.isWarmedUp}`, 'info');
  }, 30000);

  // 每小时显示真实费用报告
  setInterval(async () => {
    try {
      const report = await feeTracker.generateRealTimeReport();
      log(report, 'info');
    } catch (error) {
      log(`⚠️ 费用报告生成失败: ${error.message}`, 'warn');
    }
  }, 3600000); // 1小时

  // 🚀 定期持仓验证 (每5分钟)
  setInterval(async () => {
    try {
      log('🔄 定期持仓验证...', 'info');
      const asterAccount = await asterPrivate.fetchBalance();
      const asterPositions = asterAccount.positions || [];
      const backpackPositions = await backpackPrivate.fetchPositions([`${TRADE_SYMBOL.replace('USDT', '/USDC:USDC')}`]);
      await globalPositionManager.syncWithExchange(asterPositions, backpackPositions);

      // 清理已平仓订单
      globalPositionManager.removeClosedPositions();

      log(`✅ 持仓验证完成: ${globalPositionManager.getSummary()}`, 'info');
    } catch (error) {
      log(`⚠️ 持仓验证失败: ${error.message}`, 'warn');
    }
  }, 300000);

  // 等待3秒让WebSocket连接建立
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 主循环 - 每3秒检查一次
  setInterval(async () => {
    await checkPricesAndTrade();
  }, 3000);

  // 统计报告 - 每60秒一次 (优化日志频率)
  setInterval(() => {
    printStats();
    globalPerformanceMonitor.printStats();
  }, 60000);

  log('✅ Race-First优化机器人已启动，极速监听价差套利...', 'success');
}

// 优雅退出
process.on('SIGINT', async () => {
  log('正在关闭Race-First优化机器人...', 'warn');

  // 关闭双WebSocket连接
  try {
    priceManager.cleanup();
    log('🔌 双WebSocket连接已关闭', 'info');
  } catch (error) {
    log(`❌ 关闭WebSocket连接失败: ${error}`, 'error');
  }

  // 关闭连接池
  try {
    globalConnectionPool.destroy();
  } catch (error) {
    log(`❌ 关闭连接池失败: ${error}`, 'error');
  }

  // 显示最终性能统计
  globalPerformanceMonitor.printStats();
  globalAdaptiveLock.reset();

  await closeAllPositions();
  printStats();
  process.exit(0);
});

main().catch(error => {
  log(`启动失败: ${error}`, 'error');
  process.exit(1);
});