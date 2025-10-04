// 简化的交易执行器 - 保持模块化，简化逻辑
import { AsterAPI } from '../aster-api.js';
import ccxt from 'ccxt';
import { tradeHistory } from './trade-history.js';

export interface SimpleTradeResult {
  success: boolean;
  asterOrder?: any;
  backpackOrder?: any;
  asterSuccess: boolean;
  backpackSuccess: boolean;
  error?: string;
}

export class SimpleTrader {
  private asterPrivate: AsterAPI;
  private backpackPrivate: ccxt.backpack;

  constructor(asterPrivate: AsterAPI, backpackPrivate: ccxt.backpack) {
    this.asterPrivate = asterPrivate;
    this.backpackPrivate = backpackPrivate;
  }

  // 检查是否有未平仓位（最简单的方式）
  async hasOpenPositions(): Promise<boolean> {
    try {
      // 使用交易历史管理器检查（最可靠）
      if (tradeHistory.hasOpenPositions()) {
        console.log('📊 本地记录显示有未平仓位');
        return true;
      }

      // 双重验证：查询交易所实际仓位
      const [asterResult, backpackResult] = await Promise.allSettled([
        this.asterPrivate.fetchPositions(),
        this.backpackPrivate.fetchPositions(['BTC/USDC:USDC'])
      ]);

      let hasAsterPos = false;
      if (asterResult.status === 'fulfilled') {
        hasAsterPos = asterResult.value.some((p: any) =>
          p.symbol === 'BTCUSDT' && Math.abs(parseFloat(p.positionAmt || 0)) > 0.001
        );
      }

      let hasBackpackPos = false;
      if (backpackResult.status === 'fulfilled') {
        hasBackpackPos = backpackResult.value.some((p: any) =>
          parseFloat(p.contracts || 0) > 0.001
        );
      }

      const actualHasPos = hasAsterPos || hasBackpackPos;
      if (actualHasPos) {
        console.log(`🔍 实际仓位检查: AsterDx=${hasAsterPos}, Backpack=${hasBackpackPos}`);
      }

      return actualHasPos;
    } catch (error) {
      console.error('❌ 仓位检查失败:', error);
      return true; // 安全起见，有错误时拒绝开仓
    }
  }

  // 简单的并发开仓（去掉复杂的Race逻辑）
  async openPosition(direction: 'buy_aster_sell_backpack' | 'sell_aster_buy_backpack', amount: number): Promise<SimpleTradeResult> {
    console.log(`🚀 执行简单开仓: ${direction}, 数量: ${amount}`);

    // 检查是否已有仓位
    if (await this.hasOpenPositions()) {
      return {
        success: false,
        asterSuccess: false,
        backpackSuccess: false,
        error: '已有未平仓位，拒绝开新仓'
      };
    }

    const asterSide = direction === 'buy_aster_sell_backpack' ? 'BUY' : 'SELL';
    const backpackSide = direction === 'buy_aster_sell_backpack' ? 'Ask' : 'Bid';

    console.log(`📤 并发下单: AsterDx ${asterSide} | Backpack ${backpackSide}`);

    // 简单的并发下单
    const [asterResult, backpackResult] = await Promise.allSettled([
      this.asterPrivate.createMarketOrder('BTCUSDT', asterSide, amount),
      this.backpackPrivate.createMarketOrder('BTC/USDC:USDC', backpackSide, amount)
    ]);

    const asterSuccess = asterResult.status === 'fulfilled' && asterResult.value?.orderId;
    const backpackSuccess = backpackResult.status === 'fulfilled' && backpackResult.value?.id;

    console.log(`📊 下单结果: AsterDx=${asterSuccess ? '✅' : '❌'}, Backpack=${backpackSuccess ? '✅' : '❌'}`);

    if (asterSuccess && backpackSuccess) {
      // 🎯 双边成功：获取实际成交价格
      const asterOrder = asterResult.value;
      const backpackOrder = backpackResult.value;

      // AsterDx可能需要查询成交价格
      let asterActualPrice = parseFloat(asterOrder.avgPrice || asterOrder.price || '0');
      if (asterActualPrice === 0 && asterOrder.orderId) {
        console.log('⏳ 等待AsterDx成交，查询实际价格...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          const orderDetail = await this.asterPrivate.fetchOrder(asterOrder.orderId, 'BTCUSDT');
          asterActualPrice = parseFloat(orderDetail.avgPrice || '0');
          console.log(`📊 AsterDx实际成交价: ${asterActualPrice}`);
        } catch (e) {
          console.warn('⚠️ 无法查询AsterDx成交价格');
        }
      }

      const backpackActualPrice = parseFloat(backpackOrder.price || '0');

      // 记录到交易历史
      const tradeId = tradeHistory.recordOpen({
        asterPrice: asterActualPrice || 0,
        backpackPrice: backpackActualPrice || 0,
        amount,
        spread: Math.abs(asterActualPrice - backpackActualPrice),
        direction,
        asterOrderId: asterOrder.orderId,
        backpackOrderId: backpackOrder.id
      });

      console.log(`✅ 开仓成功! 交易ID: ${tradeId}`);
      console.log(`💰 成交价格: AsterDx=${asterActualPrice}, Backpack=${backpackActualPrice}`);

      return {
        success: true,
        asterOrder,
        backpackOrder,
        asterSuccess: true,
        backpackSuccess: true
      };

    } else {
      // ❌ 单边失败：直接跳过（不尝试清理）
      if (!asterSuccess) {
        console.error('❌ AsterDx下单失败:', asterResult.status === 'rejected' ? asterResult.reason : '未知错误');
      }
      if (!backpackSuccess) {
        console.error('❌ Backpack下单失败:', backpackResult.status === 'rejected' ? backpackResult.reason : '未知错误');
      }

      return {
        success: false,
        asterSuccess,
        backpackSuccess,
        asterOrder: asterSuccess ? asterResult.value : null,
        backpackOrder: backpackSuccess ? backpackResult.value : null,
        error: '单边下单失败，已跳过'
      };
    }
  }

  // 简单的平仓逻辑
  async closeAllPositions(): Promise<boolean> {
    console.log('🔄 开始平仓所有持仓...');

    const openTrades = tradeHistory.getOpenTrades();
    if (openTrades.length === 0) {
      console.log('📊 无未平仓位');
      return true;
    }

    for (const trade of openTrades) {
      try {
        console.log(`🔄 平仓交易: ${trade.id}`);

        // 确定平仓方向
        const asterCloseSide = trade.direction === 'buy_aster_sell_backpack' ? 'SELL' : 'BUY';
        const backpackCloseSide = trade.direction === 'buy_aster_sell_backpack' ? 'Bid' : 'Ask';

        // 并发平仓
        const [asterResult, backpackResult] = await Promise.allSettled([
          this.asterPrivate.createOrder('BTCUSDT', 'MARKET', asterCloseSide, trade.amount.toString(), undefined, { reduceOnly: 'true' }),
          this.backpackPrivate.createMarketOrder('BTC/USDC:USDC', backpackCloseSide, trade.amount, undefined, undefined, { reduceOnly: true })
        ]);

        const asterSuccess = asterResult.status === 'fulfilled';
        const backpackSuccess = backpackResult.status === 'fulfilled';

        if (asterSuccess && backpackSuccess) {
          // 获取平仓价格
          const asterCloseOrder = asterResult.value;
          const backpackCloseOrder = backpackResult.value;

          let asterClosePrice = parseFloat(asterCloseOrder.avgPrice || asterCloseOrder.price || '0');
          if (asterClosePrice === 0 && asterCloseOrder.orderId) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
              const orderDetail = await this.asterPrivate.fetchOrder(asterCloseOrder.orderId, 'BTCUSDT');
              asterClosePrice = parseFloat(orderDetail.avgPrice || '0');
            } catch (e) {
              console.warn('⚠️ 无法查询AsterDx平仓价格');
            }
          }

          const backpackClosePrice = parseFloat(backpackCloseOrder.price || '0');

          // 记录平仓数据
          tradeHistory.recordClose(trade.id, {
            asterClosePrice,
            backpackClosePrice,
            asterCloseOrderId: asterCloseOrder.orderId,
            backpackCloseOrderId: backpackCloseOrder.id
          });

          console.log(`✅ 平仓成功: ${trade.id}`);
        } else {
          console.error(`❌ 平仓失败: ${trade.id}`);
        }
      } catch (error) {
        console.error(`❌ 平仓异常: ${trade.id}`, error);
      }
    }

    return true;
  }
}