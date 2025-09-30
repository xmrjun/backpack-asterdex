// 交易配置 - 5倍杠杆刷量设置
export const TRADE_SYMBOL = "BTCUSDT"; // 切换到BTC获得更大价差机会
export const LEVERAGE = 5; // 5倍杠杆
// 加仓策略设置
export const TRADE_AMOUNT = TRADE_SYMBOL === "ETHUSDT" ? 0.02 : 0.02; // 每次开仓：ETH 0.02个, BTC 0.02个

// 加仓策略参数 - 禁用加仓
export const MAX_POSITION_SIZE = TRADE_SYMBOL === "ETHUSDT" ? 0.02 : 0.02; // 最大持仓：ETH 0.02个, BTC 0.02个
export const MAX_ADD_POSITIONS = 1; // 不加仓，只做一次
export const ADD_POSITION_SPREAD = 9999; // 设置很高，禁用加仓

// 开平仓参数
export const ARB_THRESHOLD = 120; // 120U价差开仓
export const CLOSE_DIFF = 80; // 80U价差平仓
export const PROFIT_DIFF_LIMIT = 5;
export const LOSS_LIMIT = 0.5;
export const MAX_SPREAD = 100;

// 交易频率设置
export const TRADE_INTERVAL = 50; // 50ms检查一次
export const MIN_TRADE_INTERVAL = 100; // 最小交易间隔100ms

// 测试模式目标 (无限制)
export const DAILY_VOLUME_TARGET = Infinity; // 无交易量限制
export const DAILY_TRADES_TARGET = Infinity; // 无交易笔数限制

// 加仓策略风险控制
export const MAX_POSITION_COUNT = 1; // 只做1个交易对的加仓
export const DAILY_LOSS_LIMIT = 200; // 日亏损限制200 USDT
export const FORCE_CLOSE_TIME = 30 * 60 * 1000; // 30分钟强制平仓

// 动态参数（保留但调整）
export const STOP_LOSS_DIST = 0.2;
export const TRAILING_PROFIT = 0.5;
export const TRAILING_CALLBACK_RATE = 0.3;