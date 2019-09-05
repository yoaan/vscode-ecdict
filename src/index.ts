import { createReadStream, createWriteStream, existsSync } from 'fs'
import { statAsync, mkdirAsync, getConfigDir } from './util'
import got from 'got'
import path, { join } from 'path'
import readline from 'readline'
import * as vscode from 'vscode'

const ecdictName = 'ecdict.csv'
const ecdictUrl = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv'

const ecdictData = new Map()

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Note: context.storagePath is undefined...
  const configDir = getConfigDir()
  const storagePath = path.join(configDir, 'vscode-translator')
  const stat = await statAsync(storagePath)
  if (!stat || !stat.isDirectory()) {
    await mkdirAsync(storagePath)
  }

  const ecdictPath = join(storagePath, ecdictName)
  if (!existsSync(ecdictPath)) {
    await download(ecdictPath, ecdictUrl, 'ECDICT')
    await ecdictInit(ecdictPath)
  } else {
    await ecdictInit(ecdictPath)
  }

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(['*'], {
      provideHover(document, position): vscode.Hover | null {
        const word = getWord(document, position)
        if (!word || !ecdictData.has(word)) {
          return null
        }
        const words = ecdictData.get(word)
        let values = [`**${word}**`]
        if (words.phonetic) {
          values = values.concat(['', `**音标：**${words.phonetic}`])
        }
        if (words.definition) {
          values = values.concat(['', '**英文解释：**', '', ...words.definition.split('\\n').map((line: string) => line.replace(/^"/, ''))])
        }
        if (words.translation) {
          values = values.concat(['', '**中文解释：**', '', ...words.translation.split('\\n').map((line: string) => line.replace(/^"/, ''))])
        }
        if (words.pos) {
          values = values.concat(['', `**词语位置：**${words.pos.replace(/\n/, ' ')}`])
        }
        return new vscode.Hover(values.join('\n\r'))
      }
    })
  )
}

function getWord(document?: vscode.TextDocument, position?: vscode.Position): string {
  const editor = vscode.window.activeTextEditor
  if (!editor) return

  if (!document) document = editor.document

  let text = ''
  let range: vscode.Range
  const selection = editor.selection
  if (selection.isEmpty) {
    // no selection or hover position, select current word
    if (!position) position = editor.selection.active
    range = document.getWordRangeAtPosition(position)
  } else {
    // has selection, no hover position
    if (!position) {
      range = new vscode.Range(selection.start, selection.end)
    } else {
      // if hover position is in the selection area
      if (selection.anchor.line === position.line
        && position.character >= selection.start.character
        && position.character <= selection.end.character) {
        range = new vscode.Range(selection.start, selection.end)
      } else {
        // hover position is not in the selection area
        range = document.getWordRangeAtPosition(position)
      }
    }
  }
  text = document.getText(range)
  if (text.trim() !== '') return text
  return null
}

export async function download(path: string, url: string, name: string): Promise<void> {
  let statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
  statusItem.text = `Downloading ${name} data...`
  statusItem.show()

  return new Promise((resolve, reject) => {
    try {
      got
        .stream(url)
        .on('downloadProgress', progress => {
          let p = (progress.percent * 100).toFixed(0)
          statusItem.text = `${p}% Downloading ${name} data...`
        })
        .on('end', () => {
          statusItem.hide()
          resolve()
        })
        .on('error', e => {
          reject(e)
        })
        .pipe(createWriteStream(path))
    } catch (e) {
      reject(e)
    }
  })
}

async function ecdictInit(ecdictPath: string): Promise<void> {
  return new Promise(resolve => {
    readline
      .createInterface(createReadStream(ecdictPath), undefined, undefined, false)
      .on('line', (line: string) => {
        const items = line.split(',')
        if (items.length < 5) {
          return
        }
        ecdictData.set(items[0].toLowerCase(), {
          phonetic: items[1] || '',
          definition: items[2] || '',
          translation: items[3] || '',
          pos: items[4] || ''
        })
      })
      .on('close', () => {
        resolve()
      })
  })
}
