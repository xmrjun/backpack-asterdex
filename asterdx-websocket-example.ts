#!/usr/bin/env node

/**
 * AsterDx WebSocket 实现示例代码
 * 展示如何使用 AsterDx WebSocket 获取实时价格数据
 */

import { WebSocketPriceManager } from './websocket-price-manager.js';
import { Aster } from './exchanges/aster.js';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 示例1: 使用完整的 WebSocketPriceManager (推荐)
async function exampleWithPriceManager() {
    console.log('🚀 示例1: 使用 WebSocketPriceManager');

    // 创建价格管理器实例
    const priceManager = new WebSocketPriceManager(
        process.env.ASTER_API_KEY!,
        process.env.ASTER_API_SECRET!
    );

    try {
        // 初始化双WebSocket连接
        await priceManager.initializeAll();
        console.log('✅ WebSocket连接初始化完成');

        // 实时价格监控
        const priceMonitor = setInterval(() => {
            const asterPrice = priceManager.getAsterPrice();
            const backpackPrice = priceManager.getBackpackPrice();

            if (asterPrice && backpackPrice) {
                console.log(`📈 AsterDx: ${asterPrice.bid.toFixed(2)}/${asterPrice.ask.toFixed(2)} (${asterPrice.lastPrice.toFixed(2)})`);
                console.log(`📈 Backpack: ${backpackPrice.bid.toFixed(2)}/${backpackPrice.ask.toFixed(2)} (${backpackPrice.lastPrice.toFixed(2)})`);

                const spread = Math.abs(asterPrice.lastPrice - backpackPrice.lastPrice);
                console.log(`💰 价差: ${spread.toFixed(2)} USDT`);

                if (spread > 120) {
                    console.log('🎯 套利机会！价差超过120 USD');
                }

                console.log('---');
            } else {
                console.log('⚠️ 价格数据不可用');
                console.log(priceManager.getPriceStats());
            }
        }, 5000); // 每5秒输出一次

        // 10分钟后停止监控
        setTimeout(() => {
            clearInterval(priceMonitor);
            priceManager.cleanup();
            console.log('📊 价格监控已停止');
        }, 10 * 60 * 1000);

    } catch (error) {
        console.error('❌ WebSocket连接失败:', error);
    }
}

// 示例2: 直接使用 Aster SDK (底层实现)
async function exampleWithAsterSDK() {
    console.log('🔧 示例2: 直接使用 Aster SDK');

    const asterSDK = new Aster(
        process.env.ASTER_API_KEY!,
        process.env.ASTER_API_SECRET!,
        'BTCUSDT'
    );

    // 价格数据存储
    let currentPrice = {
        bid: 0,
        ask: 0,
        lastPrice: 0,
        updateTime: 0
    };

    try {
        // 等待WebSocket连接建立
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 订阅ticker价格流
        asterSDK.watchTicker('BTCUSDT', (ticker: any) => {
            if (ticker && ticker.symbol === 'BTCUSDT') {
                currentPrice.lastPrice = parseFloat(ticker.lastPrice || 0);
                currentPrice.updateTime = Date.now();

                console.log(`📡 Ticker更新: ${ticker.symbol} = ${ticker.lastPrice} USDT`);
            }
        });

        // 订阅深度数据
        asterSDK.watchDepth('BTCUSDT', (depth: any) => {
            if (depth && depth.bids && depth.asks &&
                depth.bids.length > 0 && depth.asks.length > 0) {

                currentPrice.bid = parseFloat(depth.bids[0][0]);
                currentPrice.ask = parseFloat(depth.asks[0][0]);
                currentPrice.updateTime = Date.now();

                console.log(`📊 深度更新: Bid=${currentPrice.bid} Ask=${currentPrice.ask}`);
            }
        });

        // 定时输出价格统计
        const statsMonitor = setInterval(() => {
            const age = Date.now() - currentPrice.updateTime;
            const isValid = age < 30000 && currentPrice.bid > 0 && currentPrice.ask > 0;

            console.log('\n=== 📊 AsterDx价格统计 ===');
            console.log(`最新价: ${currentPrice.lastPrice} USDT`);
            console.log(`买一价: ${currentPrice.bid} USDT`);
            console.log(`卖一价: ${currentPrice.ask} USDT`);
            console.log(`数据年龄: ${(age / 1000).toFixed(1)}秒`);
            console.log(`数据状态: ${isValid ? '✅ 有效' : '❌ 无效'}`);
            console.log('========================\n');
        }, 10000); // 每10秒输出统计

        // 5分钟后停止
        setTimeout(() => {
            clearInterval(statsMonitor);
            console.log('🔚 AsterDx SDK监控已停止');
        }, 5 * 60 * 1000);

    } catch (error) {
        console.error('❌ AsterDx SDK连接失败:', error);
    }
}

// 示例3: 套利机会检测
async function exampleArbitrageDetection() {
    console.log('🎯 示例3: 套利机会检测');

    const priceManager = new WebSocketPriceManager(
        process.env.ASTER_API_KEY!,
        process.env.ASTER_API_SECRET!
    );

    await priceManager.initializeAll();

    // 套利参数
    const OPEN_THRESHOLD = 120;  // 120 USD开仓阈值
    const CLOSE_THRESHOLD = 80;  // 80 USD平仓阈值
    const TRADE_AMOUNT = 0.02;   // 0.02 BTC交易量

    let inPosition = false;
    let positionDirection = '';

    const arbitrageDetector = setInterval(() => {
        const asterPrice = priceManager.getAsterPrice();
        const backpackPrice = priceManager.getBackpackPrice();

        if (!asterPrice || !backpackPrice) {
            console.log('⚠️ 价格数据不完整');
            return;
        }

        // 计算价差
        const asterMid = (asterPrice.bid + asterPrice.ask) / 2;
        const backpackMid = (backpackPrice.bid + backpackPrice.ask) / 2;
        const spread = Math.abs(asterMid - backpackMid);

        // 确定套利方向
        let direction = '';
        if (asterMid < backpackMid) {
            direction = 'buy_aster_sell_backpack';
        } else {
            direction = 'buy_backpack_sell_aster';
        }

        console.log(`📊 AsterDx: ${asterMid.toFixed(2)} | Backpack: ${backpackMid.toFixed(2)} | 价差: ${spread.toFixed(2)} USD`);

        // 开仓逻辑
        if (!inPosition && spread > OPEN_THRESHOLD) {
            console.log(`🚀 开仓信号！方向: ${direction}, 价差: ${spread.toFixed(2)} USD`);
            console.log(`📋 模拟交易: ${TRADE_AMOUNT} BTC`);
            inPosition = true;
            positionDirection = direction;
        }

        // 平仓逻辑
        if (inPosition && spread < CLOSE_THRESHOLD) {
            console.log(`✅ 平仓信号！价差: ${spread.toFixed(2)} USD`);
            console.log(`📋 平仓方向: ${positionDirection}`);
            inPosition = false;
            positionDirection = '';
        }

        // 持仓状态
        if (inPosition) {
            console.log(`📈 持仓中: ${positionDirection} | 当前价差: ${spread.toFixed(2)} USD`);
        }

    }, 3000); // 每3秒检测一次

    // 30分钟后停止
    setTimeout(() => {
        clearInterval(arbitrageDetector);
        priceManager.cleanup();
        console.log('🔚 套利检测已停止');
        process.exit(0);
    }, 30 * 60 * 1000);
}

// 示例4: 连接状态监控
async function exampleConnectionMonitoring() {
    console.log('🔍 示例4: 连接状态监控');

    const priceManager = new WebSocketPriceManager(
        process.env.ASTER_API_KEY!,
        process.env.ASTER_API_SECRET!
    );

    await priceManager.initializeAll();

    const connectionMonitor = setInterval(() => {
        const status = priceManager.getConnectionStatus();
        const stats = priceManager.getPriceStats();

        console.log('\n=== 🔍 连接状态监控 ===');
        console.log(stats);
        console.log(`AsterDx连接: ${status.aster ? '🟢 正常' : '🔴 异常'}`);
        console.log(`Backpack连接: ${status.backpack ? '🟢 正常' : '🔴 异常'}`);

        // 连接质量评估
        const asterPrice = priceManager.getAsterPrice();
        const backpackPrice = priceManager.getBackpackPrice();

        if (asterPrice) {
            const age = Date.now() - asterPrice.updateTime;
            console.log(`AsterDx数据新鲜度: ${(age / 1000).toFixed(1)}秒`);
        }

        if (backpackPrice) {
            const age = Date.now() - backpackPrice.updateTime;
            console.log(`Backpack数据新鲜度: ${(age / 1000).toFixed(1)}秒`);
        }

        console.log('=====================\n');
    }, 15000); // 每15秒监控一次

    // 持续监控，按Ctrl+C退出
    process.on('SIGINT', () => {
        console.log('\n📊 停止连接监控...');
        clearInterval(connectionMonitor);
        priceManager.cleanup();
        process.exit(0);
    });
}

// 主函数 - 选择运行哪个示例
async function main() {
    console.log('🎯 AsterDx WebSocket 实现示例');
    console.log('================================');
    console.log('1. 完整价格管理器示例');
    console.log('2. 底层SDK示例');
    console.log('3. 套利机会检测');
    console.log('4. 连接状态监控');
    console.log('================================\n');

    // 检查API密钥
    if (!process.env.ASTER_API_KEY || !process.env.ASTER_API_SECRET) {
        console.error('❌ 请在.env文件中配置ASTER_API_KEY和ASTER_API_SECRET');
        process.exit(1);
    }

    // 选择运行示例 (可以通过命令行参数选择)
    const example = process.argv[2] || '1';

    switch (example) {
        case '1':
            await exampleWithPriceManager();
            break;
        case '2':
            await exampleWithAsterSDK();
            break;
        case '3':
            await exampleArbitrageDetection();
            break;
        case '4':
            await exampleConnectionMonitoring();
            break;
        default:
            console.log('❌ 无效的示例编号，请使用 1-4');
            console.log('用法: npx tsx asterdx-websocket-example.ts [1|2|3|4]');
            process.exit(1);
    }
}

// 运行示例
if (require.main === module) {
    main().catch(error => {
        console.error('❌ 示例运行失败:', error);
        process.exit(1);
    });
}

export {
    exampleWithPriceManager,
    exampleWithAsterSDK,
    exampleArbitrageDetection,
    exampleConnectionMonitoring
};