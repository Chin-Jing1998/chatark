/**
 * 自动导出日志：轮转阈值与 `.1` 覆盖、行格式（ts/pid 前置）与取值转义。
 * 全部写入临时目录。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, closeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { appendLogLine, openLogFd, rotateIfLarge } from './export-log'

let root = ''
let logPath = ''

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'chatark-log-'))
  logPath = path.join(root, 'logs', 'auto-export.log')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** 取最后一行并拆成 k=v 段（不解析引号，仅用于结构断言）。 */
function lastLine(): string {
  const lines = readFileSync(logPath, 'utf8').trimEnd().split('\n')
  return lines[lines.length - 1]
}

describe('appendLogLine', () => {
  it('首两段固定为 ts 与 pid，其后按传入顺序追加', () => {
    appendLogLine(logPath, { mode: 'launcher', result: 'spawned', ms: 12 })
    const parts = lastLine().split(' ')
    expect(parts[0].startsWith('ts=')).toBe(true)
    expect(new Date(parts[0].slice(3)).getTime()).not.toBeNaN()
    expect(parts[1]).toBe(`pid=${process.pid}`)
    expect(parts.slice(2)).toEqual(['mode=launcher', 'result=spawned', 'ms=12'])
  })

  it('含空格 / 等号 / 引号 / 反斜杠或空串的取值加引号并转义', () => {
    appendLogLine(logPath, {
      title: '答复 审查意见',
      q: 'a=b',
      quoted: '他说"好"',
      win: 'C:\\Users',
      empty: ''
    })
    const line = lastLine()
    expect(line).toContain('title="答复 审查意见"')
    expect(line).toContain('q="a=b"')
    expect(line).toContain('quoted="他说\\"好\\""')
    expect(line).toContain('win="C:\\\\Users"')
    expect(line).toContain('empty=""')
  })

  it('取值里的换行转义成字面量，一条记录仍只占一行', () => {
    appendLogLine(logPath, { reason: '第一行\n第二行\r' })
    const raw = readFileSync(logPath, 'utf8')
    expect(raw.trimEnd().split('\n')).toHaveLength(1)
    expect(lastLine()).toContain('reason="第一行\\n第二行\\r"')
  })

  it('目录不存在时自动创建，多次调用逐行追加', () => {
    appendLogLine(logPath, { n: 1 })
    appendLogLine(logPath, { n: 2 })
    expect(readFileSync(logPath, 'utf8').trimEnd().split('\n').length).toBe(2)
  })

  it('路径不可写时静默失败，不抛异常', () => {
    // 把目录位置占成文件，mkdir 必然失败
    const blocked = path.join(root, 'blocked')
    writeFileSync(blocked, 'x', 'utf8')
    expect(() => appendLogLine(path.join(blocked, 'a.log'), { n: 1 })).not.toThrow()
  })
})

describe('rotateIfLarge', () => {
  it('未超阈值不动文件', () => {
    appendLogLine(logPath, { n: 1 })
    const before = readFileSync(logPath, 'utf8')
    rotateIfLarge(logPath, 1024 * 1024)
    expect(existsSync(`${logPath}.1`)).toBe(false)
    expect(readFileSync(logPath, 'utf8')).toBe(before)
  })

  it('超阈值改名为 .1，原路径腾空', () => {
    appendLogLine(logPath, { payload: 'x'.repeat(200) })
    const size = statSync(logPath).size
    rotateIfLarge(logPath, size - 1)
    expect(existsSync(logPath)).toBe(false)
    expect(readFileSync(`${logPath}.1`, 'utf8')).toContain('payload=')
  })

  it('再次轮转覆盖上一代 .1（只保留一代）', () => {
    appendLogLine(logPath, { gen: 'old' })
    rotateIfLarge(logPath, 0)
    appendLogLine(logPath, { gen: 'new' })
    rotateIfLarge(logPath, 0)
    expect(readFileSync(`${logPath}.1`, 'utf8')).toContain('gen=new')
  })

  it('日志尚不存在时不抛异常', () => {
    expect(() => rotateIfLarge(logPath, 0)).not.toThrow()
  })
})

describe('openLogFd', () => {
  it('返回可用 fd 且目录被创建；已有内容不被截断', () => {
    appendLogLine(logPath, { n: 1 })
    const fd = openLogFd(logPath)
    expect(fd).toBeGreaterThan(0)
    closeSync(fd)
    expect(readFileSync(logPath, 'utf8')).toContain('n=1')
  })
})
