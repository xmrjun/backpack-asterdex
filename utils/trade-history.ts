// 交易历史记录管理器
import fs from 'fs';
import path from 'path';

interface TradeRecord {
  id: string;
  openTime: number;
  closeTime?: number;
  direction: string;

  // 开仓数据
  asterOpenPrice: number;
  backpackOpenPrice: number;
  asterOpenOrderId?: string;
  backpackOpenOrderId?: string;

  // 平仓数据
  asterClosePrice?: number;
  backpackClosePrice?: number;
  asterCloseOrderId?: string;
  backpackCloseOrderId?: string;

  // 交易数据
  amount: number;
  spread: number;

  // 盈亏计算
  asterPnL?: number;  // AsterDx盈亏
  backpackPnL?: number;  // Backpack盈亏
  totalPnL?: number;  // 总盈亏（未计手续费）
  netPnL?: number;  // 净盈亏（已计手续费）

  // 手续费
  asterOpenFee?: number;
  asterCloseFee?: number;
  backpackOpenFee?: number;
  backpackCloseFee?: number;
  totalFees?: number;

  status: 'open' | 'closed';
}

export class TradeHistoryManager {
  private historyFile: string;
  private currentTrades: Map<string, TradeRecord>;

  constructor() {
    this.historyFile = path.join(process.cwd(), 'data', 'trade-history.json');
    this.currentTrades = new Map();
    this.loadHistory();
  }

  // 加载历史记录
  private loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, 'utf-8');
        const history = JSON.parse(data);
        history.forEach((trade: TradeRecord) => {
          if (trade.status === 'open') {
            this.currentTrades.set(trade.id, trade);
          }
        });
        console.log(`📚 加载了 ${this.currentTrades.size} 个未平仓交易`);
      }
    } catch (error) {
      console.error('❌ 加载交易历史失败:', error);
    }
  }

  // 保存历史记录
  private saveHistory() {
    try {
      const allTrades = Array.from(this.currentTrades.values());
      const dir = path.dirname(this.historyFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.historyFile, JSON.stringify(allTrades, null, 2));
    } catch (error) {
      console.error('❌ 保存交易历史失败:', error);
    }
  }

  // 记录开仓
  recordOpen(params: {
    asterPrice: number;
    backpackPrice: number;
    amount: number;
    spread: number;
    direction: string;
    asterOrderId?: string;
    backpackOrderId?: string;
  }): string {
    const id = `trade_${Date.now()}`;
    const trade: TradeRecord = {
      id,
      openTime: Date.now(),
      direction: params.direction,
      asterOpenPrice: params.asterPrice,
      backpackOpenPrice: params.backpackPrice,
      asterOpenOrderId: params.asterOrderId,
      backpackOpenOrderId: params.backpackOrderId,
      amount: params.amount,
      spread: params.spread,
      status: 'open'
    };

    this.currentTrades.set(id, trade);
    this.saveHistory();

    console.log(`📝 记录开仓: ${id}`);
    console.log(`  AsterDx: ${params.asterPrice}, Backpack: ${params.backpackPrice}`);

    return id;
  }

  // 记录平仓
  recordClose(tradeId: string, params: {
    asterClosePrice: number;
    backpackClosePrice: number;
    asterCloseOrderId?: string;
    backpackCloseOrderId?: string;
    asterOpenFee?: number;
    asterCloseFee?: number;
    backpackOpenFee?: number;
    backpackCloseFee?: number;
  }) {
    const trade = this.currentTrades.get(tradeId);
    if (!trade) {
      console.error(`❌ 未找到交易记录: ${tradeId}`);
      return;
    }

    // 更新平仓数据
    trade.closeTime = Date.now();
    trade.asterClosePrice = params.asterClosePrice;
    trade.backpackClosePrice = params.backpackClosePrice;
    trade.asterCloseOrderId = params.asterCloseOrderId;
    trade.backpackCloseOrderId = params.backpackCloseOrderId;

    // 计算盈亏
    if (trade.direction === 'buy_aster_sell_backpack') {
      // AsterDx做多，Backpack做空
      trade.asterPnL = (params.asterClosePrice - trade.asterOpenPrice) * trade.amount;
      trade.backpackPnL = (trade.backpackOpenPrice - params.backpackClosePrice) * trade.amount;
    } else {
      // AsterDx做空，Backpack做多
      trade.asterPnL = (trade.asterOpenPrice - params.asterClosePrice) * trade.amount;
      trade.backpackPnL = (params.backpackClosePrice - trade.backpackOpenPrice) * trade.amount;
    }

    trade.totalPnL = trade.asterPnL + trade.backpackPnL;

    // 计算手续费
    trade.asterOpenFee = params.asterOpenFee || 0;
    trade.asterCloseFee = params.asterCloseFee || 0;
    trade.backpackOpenFee = params.backpackOpenFee || 0;
    trade.backpackCloseFee = params.backpackCloseFee || 0;
    trade.totalFees = trade.asterOpenFee + trade.asterCloseFee + trade.backpackOpenFee + trade.backpackCloseFee;

    // 净盈亏
    trade.netPnL = trade.totalPnL - trade.totalFees;
    trade.status = 'closed';

    this.saveHistory();

    console.log(`📝 记录平仓: ${tradeId}`);
    console.log(`  毛利: ${trade.totalPnL?.toFixed(4)} USDT`);
    console.log(`  手续费: ${trade.totalFees?.toFixed(4)} USDT`);
    console.log(`  净利: ${trade.netPnL?.toFixed(4)} USDT`);
  }

  // 检查是否有未平仓位
  hasOpenPositions(): boolean {
    return Array.from(this.currentTrades.values()).some(t => t.status === 'open');
  }

  // 获取未平仓交易
  getOpenTrades(): TradeRecord[] {
    return Array.from(this.currentTrades.values()).filter(t => t.status === 'open');
  }

  // 获取今日统计
  getTodayStats() {
    const today = new Date().setHours(0, 0, 0, 0);
    const trades = Array.from(this.currentTrades.values()).filter(
      t => t.openTime >= today
    );

    return {
      totalTrades: trades.length,
      closedTrades: trades.filter(t => t.status === 'closed').length,
      openTrades: trades.filter(t => t.status === 'open').length,
      totalVolume: trades.reduce((sum, t) => sum + t.amount * (t.asterOpenPrice || 0), 0),
      totalPnL: trades.filter(t => t.status === 'closed').reduce((sum, t) => sum + (t.netPnL || 0), 0),
      totalFees: trades.reduce((sum, t) => sum + (t.totalFees || 0), 0)
    };
  }

  // 生成报告
  generateReport(): string {
    const stats = this.getTodayStats();
    return `
📊 今日交易报告
================
总交易数: ${stats.totalTrades}
已平仓: ${stats.closedTrades}
未平仓: ${stats.openTrades}
总交易量: ${stats.totalVolume.toFixed(2)} USDT
总盈亏: ${stats.totalPnL.toFixed(4)} USDT
总手续费: ${stats.totalFees.toFixed(4)} USDT
净利率: ${stats.totalVolume > 0 ? (stats.totalPnL / stats.totalVolume * 100).toFixed(2) : 0}%
`;
  }
}

// 导出单例
export const tradeHistory = new TradeHistoryManager();