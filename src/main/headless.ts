/**
 * 纯 Node 无头入口，打包为 `out/main/headless.js`。
 *
 * 两种跑法：
 *   `node out/main/headless.js --export <jsonl>`
 *   `ELECTRON_RUN_AS_NODE=1 <ChatArk 可执行文件> out/main/headless.js --export-worker <jsonl>`
 * 后者复用应用自带的 Node，无需用户机上装 Node，且不启动 Chromium（实测冷启动 0.07 s）。
 *
 * 本文件**绝不** import electron：run-as-node 模式下 `require('electron')` 只返回字符串。
 */
import { runHeadlessCli, silenceEpipe } from './headless/cli'

silenceEpipe()

void runHeadlessCli(process.argv, process.env, {
  stdin: process.stdin,
  execPath: process.execPath,
  scriptPath: __filename
}).then((code) => process.exit(code))
