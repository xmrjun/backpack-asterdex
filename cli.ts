#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import {
  startArbBot,
  getStats,
  getLogs,
  resetStats,
} from "./bot";

const program = new Command();

program
  .name("bitget-aster-bot")
  .description("专业双平台套利机器人 CLI")
  .version("1.0.0");

function clearScreen() {
  process.stdout.write("\x1Bc");
}

function printOrderbook({ asterOrderbook, bitgetOrderbook, diff1, diff2 }: any) {
  const table = new Table({
    head: [
      chalk.cyan("平台"),
      chalk.cyan("买一价"),
      chalk.cyan("卖一价"),
      chalk.cyan("买一量"),
      chalk.cyan("卖一量")
    ],
    colAligns: ["center", "right", "right", "right", "right"]
  });
  table.push([
    "Aster",
    asterOrderbook?.bids?.[0]?.[0] ?? "-",
    asterOrderbook?.asks?.[0]?.[0] ?? "-",
    asterOrderbook?.bids?.[0]?.[1] ?? "-",
    asterOrderbook?.asks?.[0]?.[1] ?? "-"
  ]);
  table.push([
    "Bitget",
    bitgetOrderbook?.bids?.[0]?.[0] ?? "-",
    bitgetOrderbook?.asks?.[0]?.[0] ?? "-",
    bitgetOrderbook?.bids?.[0]?.[1] ?? "-",
    bitgetOrderbook?.asks?.[0]?.[1] ?? "-"
  ]);
  console.log(table.toString());
  console.log(
    chalk.yellow(
      `Bitget买一-Aster卖一: ${diff1?.toFixed(2) ?? "-"} USDT    Aster买一-Bitget卖一: ${diff2?.toFixed(2) ?? "-"} USDT`
    )
  );
}

function printStats(stats: any) {
  const table = new Table({
    head: [chalk.green("累计交易次数"), chalk.green("累计交易金额"), chalk.green("累计收益(估算)USDT")],
    colAligns: ["center", "center", "center"]
  });
  table.push([
    stats.totalTrades,
    stats.totalAmount,
    stats.totalProfit?.toFixed(2)
  ]);
  console.log(table.toString());
}

function printTradeLog(log: any) {
  let color = chalk.white;
  if (log.type === "open") color = chalk.green;
  if (log.type === "close") color = chalk.blue;
  if (log.type === "error") color = chalk.red;
  console.log(color(`[${log.time}] [${log.type}] ${log.detail}`));
}

program
  .command("start")
  .description("启动套利机器人，实时显示行情、价差、交易记录和统计")
  .action(async () => {
    clearScreen();
    let lastOrderbook: any = {};
    let lastStats: any = getStats();
    let lastLogLen = 0;
    let logs = getLogs();
    let spinner = ora("机器人启动中...").start();
    setTimeout(() => spinner.stop(), 1000);
    // 实时刷新
    function render() {
      clearScreen();
      console.log(chalk.bold.bgCyan("  Bitget-Aster 套利机器人  "));
      if (lastOrderbook.asterOrderbook && lastOrderbook.bitgetOrderbook) {
        printOrderbook(lastOrderbook);
      } else {
        console.log(chalk.gray("等待 orderbook 数据..."));
      }
      printStats(lastStats);
      console.log(chalk.bold("\n最近交易/异常记录："));
      logs.slice(-10).forEach(printTradeLog);
      console.log(chalk.gray("按 Ctrl+C 退出"));
    }
    // 启动主循环
    startArbBot({
      onOrderbook: (ob) => {
        lastOrderbook = ob;
        render();
      },
      onTrade: () => {
        logs = getLogs();
        lastStats = getStats();
        render();
      },
      onLog: () => {
        logs = getLogs();
        render();
      },
      onStats: (s) => {
        lastStats = s;
        render();
      }
    });
    // 定时刷新，防止无事件时界面卡死
    const intervalId = setInterval(render, 2000);
    // 监听 Ctrl+C，优雅退出
    process.on("SIGINT", () => {
      clearInterval(intervalId);
      console.log(chalk.red("\n已终止套利机器人。"));
      process.exit(0);
    });
  });

program
  .command("log")
  .description("查看全部历史下单/平仓/异常记录")
  .action(() => {
    const logs = getLogs();
    if (!logs.length) {
      console.log(chalk.gray("暂无记录"));
      return;
    }
    logs.forEach(printTradeLog);
  });

program
  .command("reset")
  .description("重置统计数据")
  .action(() => {
    resetStats();
    console.log(chalk.yellow("统计数据已重置。"));
  });

program.parse(); 