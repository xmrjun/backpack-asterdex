import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as bot from './bot';

// mock 依赖
vi.mock('ccxt', () => ({
  pro: {
    binance: vi.fn(() => ({
      fapiPrivatePostOrder: vi.fn(async () => ({ orderId: 'aster123' })),
      fapiPrivateGetOrder: vi.fn(async () => ({ status: 'FILLED' })),
    })),
    bitget: vi.fn(() => ({
      privateMixPostV2MixOrderPlaceOrder: vi.fn(async () => ({ data: { orderId: 'bitget123' } })),
      privateMixGetV2MixOrderDetail: vi.fn(async () => ({ data: { state: 'filled' } })),
    })),
  },
}));

// mock config
vi.mock('./config', () => ({
  TRADE_SYMBOL: 'BTCUSDT',
  TRADE_AMOUNT: 0.001,
  ARB_THRESHOLD: 0.001,
  CLOSE_DIFF: 10,
}));

describe('bot.ts 核心功能', () => {
  it('placeAsterOrder 应返回 order', async () => {
    const order = await bot.placeAsterOrder('BUY', 0.001, 10000);
    expect(order).toHaveProperty('orderId');
  });

  it('placeBitgetOrder 应返回 order', async () => {
    const order = await bot.placeBitgetOrder('buy', 0.001, 10000);
    expect(order).toHaveProperty('data');
    expect(order.data).toHaveProperty('orderId');
  });

  it('waitAsterFilled 应返回 true', async () => {
    const filled = await bot.waitAsterFilled('aster123');
    expect(filled).toBe(true);
  });

  it('waitBitgetFilled 应返回 true', async () => {
    const filled = await bot.waitBitgetFilled('bitget123');
    expect(filled).toBe(true);
  });

  it('closeAllPositions 应能正常调用', async () => {
    const spyAster = vi.spyOn(bot, 'placeAsterOrder').mockResolvedValue({});
    const spyBitget = vi.spyOn(bot, 'placeBitgetOrder').mockResolvedValue({});
    await bot.closeAllPositions();
    expect(spyAster).toHaveBeenCalled();
    expect(spyBitget).toHaveBeenCalled();
    spyAster.mockRestore();
    spyBitget.mockRestore();
  });
}); 