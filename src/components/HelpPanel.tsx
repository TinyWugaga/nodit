import { Check, CircleHelp, Copy, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { isTyping } from '../hooks'
import { useProject } from '../store'
import { Frame } from './Frame'

function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable: the text is still selectable */
    }
  }
  return (
    <div className="help-cmd">
      <pre className="mono">{children}</pre>
      <button type="button" className="icon-btn" aria-label="複製指令" title="複製" onClick={() => void copy()}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}

const C = ({ children }: { children: ReactNode }) => <code className="mono">{children}</code>

function Steps({ children }: { children: ReactNode }) {
  return <ol className="help-steps">{children}</ol>
}

function Note({ children }: { children: ReactNode }) {
  return <p className="help-note">{children}</p>
}

type Actions = { openInit: () => void; openSwitcher: () => void }

type Section = { id: string; group: string; title: string; body: (a: Actions) => ReactNode }

const SECTIONS: Section[] = [
  {
    id: 'overview',
    group: '開始',
    title: 'Nodit 是什麼',
    body: () => (
      <>
        <p>
          Nodit 把專案 <C>docs/</C> 裡的 ADR、Milestone、Task 畫成可編輯的關聯圖。markdown 檔是唯一的資料來源：在 UI 上的修改會以最小 diff
          寫回檔案；人或 AI 直接改檔案時，畫面也會即時更新。
        </p>
        <ul>
          <li>
            <b>Graph Canvas</b>：卡片、連線、拖曳排版，用 Inspector 編輯內容。
          </li>
          <li>
            <b>Architecture</b>：渲染 <C>docs/ARCHITECTURE.md</C>，支援 mermaid，文中的 <C>ADR-001</C>、<C>MS-01</C>、<C>T-001</C> 會連到卡片。
          </li>
          <li>
            <b>Tasks</b>：依 status 分欄的看板，拖曳換欄只改 <C>status</C>。
          </li>
        </ul>
        <p>Nodit 是本地工具：server 只綁 127.0.0.1，一個 server 同一時間開一個專案。</p>
      </>
    ),
  },
  {
    id: 'install',
    group: '開始',
    title: '安裝',
    body: () => (
      <>
        <p>
          需要 Node.js 22.22 以上。套件名稱是 <C>@tinywugaga/nodit</C>，安裝後的指令是 <C>nodit</C>：
        </p>
        <Cmd>npm install -g @tinywugaga/nodit</Cmd>
        <p>也可以裝成專案的 devDependency，讓整個團隊用同一個版本：</p>
        <Cmd>{'npm install -D @tinywugaga/nodit\nnpx --no nodit'}</Cmd>
        <Note>
          用 npx 時一律加 <C>--no</C>：它只執行專案裡已安裝的版本。不加的話，本地找不到時 npx 會從 npm 下載套件來執行。
        </Note>
        <p>
          開發 Nodit 本身時，從原始碼安裝：<C>npm install</C>、<C>npm run build</C>、<C>npm link</C>。
        </p>
      </>
    ),
  },
  {
    id: 'new-project',
    group: '導入專案',
    title: '建立空白專案',
    body: ({ openInit }) => (
      <>
        <p>從一個空資料夾開始，讓 Nodit 建好資料夾與設定：</p>
        <Steps>
          <li>
            建立資料夾並進版控：
            <Cmd>{'mkdir my-project && cd my-project\ngit init'}</Cmd>
          </li>
          <li>
            初始化。Nodit 會先列出計畫，確認後才寫入：
            <Cmd>nodit init</Cmd>
            會產生 <C>nodit.config.json</C>、<C>docs/decisions</C>、<C>docs/milestones</C>、<C>docs/tasks</C>、<C>docs/ARCHITECTURE.md</C>、
            <C>.gitignore</C> 規則，以及 AI 指令檔（AGENTS.md、CLAUDE.md 的 Nodit 區塊與 <C>.claude/skills</C>）。不需要 AI 指令檔時加{' '}
            <C>--no-ai</C>。
          </li>
          <li>
            啟動並開啟 UI：
            <Cmd>nodit</Cmd>
          </li>
          <li>
            用 Toolbar 的 <b>Add Node</b>（或按 <kbd>A</kbd> <kbd>M</kbd> <kbd>T</kbd>）建立第一張 ADR、Milestone、Task。
          </li>
        </Steps>
        <p>
          也可以先直接執行 <C>nodit</C>，再從 UI 初始化：頂部橫幅的「開始 init」，或 Sidebar 底部的火箭按鈕。
        </p>
        <button type="button" className="btn" onClick={openInit}>
          開啟 init 面板
        </button>
      </>
    ),
  },
  {
    id: 'existing-project',
    group: '導入專案',
    title: '既有專案導入 Nodit',
    body: ({ openInit }) => (
      <>
        <p>
          在已經有程式碼與文件的 repo 加入 Nodit。init 只會新增檔案或附加內容，不會覆寫你的內容，建議先 commit 目前的修改，方便檢查 diff。
        </p>
        <Steps>
          <li>
            先看計畫、不寫入：
            <Cmd>{'cd your-project\nnodit init --dry-run'}</Cmd>
          </li>
          <li>
            確認後執行 <C>nodit init</C>，或在 UI 的 init 面板勾選要套用的項目。各項目的處理方式：
            <ul>
              <li>
                <b>Create</b>：檔案不存在，新建。
              </li>
              <li>
                <b>Append</b>：AGENTS.md、CLAUDE.md 已存在，在檔尾附加獨立的 <C>{'<!-- nodit:start -->'}</C> 區塊，原內容不動。
              </li>
              <li>
                <b>Conflict</b>：例如 <C>docs/ARCHITECTURE.md</C> 已存在而且不是 Nodit 建立的，會保留原檔並略過。
              </li>
            </ul>
          </li>
          <li>
            文件不在預設路徑時，改 <C>nodit.config.json</C> 的 <C>paths</C>，例如把 ADR 指到 <C>docs/adr</C>。存檔後 Nodit 會自動改監聽新路徑。
          </li>
          <li>
            啟動 <C>nodit</C>，到 Sidebar 的 <b>Diagnostics</b> 檢查舊文件。
          </li>
        </Steps>
        <h4>舊文件沒有 frontmatter 怎麼辦</h4>
        <p>
          沒有 frontmatter 的 markdown 會以唯讀卡片顯示（標示 legacy），ID、標題、狀態都是從檔名與 H1 推測的。要讓它可以編輯，在檔案開頭補上 frontmatter：
        </p>
        <Cmd>{'---\nid: ADR-001\ntype: adr\ntitle: 採用 PostgreSQL\nstatus: accepted\n---'}</Cmd>
        <p>
          可以點 Diagnostics 裡的項目開啟 raw 編輯器修改，存檔前會驗證格式；也可以請 AI 依 init 寫入的 skills 批次轉換。受管段落是 ADR 的{' '}
          <C>## Context</C>、<C>## Decision</C>、<C>## Consequences</C>，Milestone 的 <C>## Goal</C>，Task 的 <C>## Description</C>。
        </p>
        <Note>檔名的編號只是用來推測 ID。ID 規則是 ADR-001、MS-01、T-001，補零位數是下限。</Note>
        <button type="button" className="btn" onClick={openInit}>
          開啟 init 面板
        </button>
      </>
    ),
  },
  {
    id: 'nodit-project',
    group: '導入專案',
    title: '開啟已導入 Nodit 的專案',
    body: ({ openSwitcher, openInit }) => (
      <>
        <p>
          例如 clone 一個隊友已經 init 過的 repo。判斷方式：根目錄有 <C>nodit.config.json</C>。這種專案不需要再 init，直接開：
        </p>
        <Cmd>{'git clone <repo-url>\ncd <repo>\nnodit'}</Cmd>
        <p>
          或在已經開著的 Nodit 裡，點 Header 的專案名稱切換過去。卡片座標存在 <C>.nodit/layout.json</C> 並進版控，所以排版會和隊友一致。
        </p>
        <ul>
          <li>
            寫入鎖與 token（<C>.nodit/writer.lock</C>、<C>owner.json</C>、<C>token</C>）是本地狀態，init 已把它們加進 <C>.gitignore</C>。
          </li>
          <li>
            AI 指令檔已在 repo 裡。用 AI 前先確認本機有 <C>nodit</C> 指令，或 repo 已把 Nodit 裝成 devDependency（見「安裝」），skills 會呼叫它。
          </li>
          <li>
            init 面板若出現 <b>Update</b> 項目，代表 repo 的 AI 指令檔是舊版模板，套用即可升級；手動改過的檔案會列為 Conflict 並保留。
          </li>
        </ul>
        <div className="help-actions">
          <button type="button" className="btn" onClick={openSwitcher}>
            切換專案
          </button>
          <button type="button" className="btn" onClick={openInit}>
            檢查 AI 指令檔版本
          </button>
        </div>
      </>
    ),
  },
  {
    id: 'switch',
    group: '導入專案',
    title: '切換專案',
    body: ({ openSwitcher }) => (
      <>
        <p>點 Header 的專案名稱開啟切換面板，三種方式擇一：</p>
        <ul>
          <li>輸入絕對路徑（可用 <C>~</C> 開頭）後按「開啟」。</li>
          <li>
            <b>Recent</b>：最近開過的專案，存在 <C>~/.nodit/recent.json</C>。
          </li>
          <li>
            <b>Browse</b>：逐層瀏覽資料夾，含 <C>nodit.config.json</C>、<C>docs/</C> 或 <C>.git</C> 的資料夾會標示 repo；雙擊直接開啟。
          </li>
        </ul>
        <p>
          可瀏覽範圍預設是家目錄。repo 放在別處時用 <C>nodit --browse-root &lt;path&gt;</C> 啟動。
        </p>
        <Note>
          切換會丟掉尚未存檔的修改（會先詢問）。其他分頁會顯示「專案已切換」並停止寫入，重新載入即可。想同時看兩個專案，要用不同 port 開兩個 server：
          <C>nodit ../other --port 4320</C>。
        </Note>
        <button type="button" className="btn" onClick={openSwitcher}>
          開啟切換面板
        </button>
      </>
    ),
  },
  {
    id: 'legacy-import',
    group: '導入專案',
    title: '匯入舊版瀏覽器資料',
    body: () => (
      <>
        <p>舊版 Nodit 把資料存在瀏覽器 localStorage。搬到新版的步驟：</p>
        <Steps>
          <li>在舊版頁面按 Header 的封存按鈕，下載 JSON。</li>
          <li>
            在已 init、還沒有任何卡片的專案匯入：Header 的上傳按鈕，或 <C>nodit import nodit-legacy-localstorage.json</C>。
          </li>
        </Steps>
        <p>
          舊代號合法而且不重複時沿用，否則改配新編號；座標會併入 <C>.nodit/layout.json</C>。中斷後用同一個檔案重跑即可續跑。
        </p>
      </>
    ),
  },
  {
    id: 'canvas',
    group: '日常操作',
    title: '編輯卡片與關聯',
    body: () => (
      <>
        <ul>
          <li>
            <b>新增</b>：Toolbar 的 Add Node，或 <kbd>A</kbd> ADR、<kbd>M</kbd> Milestone、<kbd>T</kbd> Task。會在 <C>docs/</C> 建檔並配發編號。
          </li>
          <li>
            <b>編輯</b>：選取卡片後在右側 Inspector 修改。文字欄位 400ms 後自動存檔，下拉選單立即存檔。
          </li>
          <li>
            <b>連線</b>：從卡片邊緣的把手拖到另一張卡片。關聯寫在來源端的 frontmatter（<C>implements</C>、<C>milestone</C>、<C>depends</C>、
            <C>supersedes</C>、<C>relates</C>），方向由 Nodit 依類型決定。
          </li>
          <li>
            <b>刪除</b>：選取一張卡片或一條線後按 <kbd>Delete</kbd>。
          </li>
          <li>
            <b>搜尋</b>：<kbd>⌘K</kbd> 篩選卡片，Sidebar 與畫布同步過濾。
          </li>
        </ul>
        <p>
          <b>Tasks</b> 看板可依 milestone、assignee 或 priority 分組；拖到另一欄只改 status，跨組拖曳停用。統計只算已存檔的值，不受搜尋影響。
        </p>
        <p>
          <b>Architecture</b> 直接渲染 <C>docs/ARCHITECTURE.md</C>，在編輯器裡改檔，頁面會即時更新。
        </p>
      </>
    ),
  },
  {
    id: 'ai',
    group: '日常操作',
    title: '與 AI 協作',
    body: () => (
      <>
        <p>
          init 寫入的 AGENTS.md、CLAUDE.md 區塊與 <C>.claude/skills</C>（nodit-adr、nodit-milestone、nodit-task、nodit-architecture）會教 AI 照 Nodit 的格式寫卡片與架構文件。已開著的 AI
          工作階段要重開才會載入。
        </p>
        <p>建卡片建議讓 AI 用 CLI，由 Nodit 配發不重複的編號：</p>
        <Cmd>{'nodit new task "加入 SSE 重連" --milestone MS-01 --implements ADR-007'}</Cmd>
        <p>
          server 運作中時，<C>new</C>、<C>init</C>、<C>import</C> 會經由它的 API 寫入，UI 會即時看到。AI 直接手寫檔案也可以，撞號會出現在 Diagnostics。
        </p>
      </>
    ),
  },
  {
    id: 'shortcuts',
    group: '參考',
    title: '快捷鍵',
    body: () => (
      <table className="help-keys">
        <tbody>
          {(
            [
              ['?', '開關這份說明'],
              ['⌘K', '搜尋卡片'],
              ['N', '開啟 Add Node 選單'],
              ['A / M / T', '新增 ADR / Milestone / Task'],
              ['V', '選取工具'],
              ['H', '平移工具'],
              ['F', '縮放到全部卡片'],
              ['Delete', '刪除選取的卡片或連線'],
              ['Esc', '清除搜尋、關閉選單'],
            ] as const
          ).map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
  },
  {
    id: 'troubleshooting',
    group: '參考',
    title: '疑難排解',
    body: () => (
      <dl className="help-faq">
        <dt>寫入時顯示 token 或 session 不符</dt>
        <dd>server 重啟後 token 會改變，重新整理頁面即可。尚未送出的草稿只存在記憶體，重新整理會遺失。</dd>
        <dt>存檔回報衝突</dt>
        <dd>檔案在你編輯期間被別人或 AI 改過。到 Inspector 選擇重新套用或捨棄草稿。</dd>
        <dt>寫入鎖已過期</dt>
        <dd>
          Nodit 非正常結束後鎖不會自動回收。停止這個專案的所有 Nodit 程序（包括會呼叫 <C>nodit</C> 的 AI 工具），再手動刪除 <C>.nodit/writer.lock</C>、
          <C>.nodit/owner.json</C>、<C>.nodit/token</C>。
        </dd>
        <dt>改了標題，檔名沒變</dt>
        <dd>這是預期行為。檔案以 ID 識別，檔名中的 slug 可以和標題不同。</dd>
        <dt>卡片是唯讀的</dt>
        <dd>legacy（沒有 frontmatter）或格式無效的文件只能用 raw 編輯修正，原因列在 Diagnostics。</dd>
      </dl>
    ),
  },
]

const GROUPS = [...new Set(SECTIONS.map((s) => s.group))]

export function HelpPanel() {
  const { open, setOpen, setInitOpen, setSwitcherOpen } = useProject(
    useShallow((s) => ({ open: s.helpOpen, setOpen: s.setHelpOpen, setInitOpen: s.setInitOpen, setSwitcherOpen: s.setSwitcherOpen })),
  )
  const [active, setActive] = useState(SECTIONS[0].id)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault()
        setOpen(!useProject.getState().helpOpen)
      } else if (e.key === 'Escape' && useProject.getState().helpOpen) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  useEffect(() => {
    const body = bodyRef.current
    if (!open || !body) return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id.replace(/^help-/, ''))
      },
      { root: body, rootMargin: '0px 0px -70% 0px' },
    )
    body.querySelectorAll('section[id]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [open])

  if (!open) return null

  const actions: Actions = {
    openInit: () => {
      setOpen(false)
      setInitOpen(true)
    },
    openSwitcher: () => {
      setOpen(false)
      setSwitcherOpen(true)
    },
  }

  const jump = (id: string) => {
    setActive(id)
    bodyRef.current?.querySelector(`#help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="modal" role="dialog" aria-label="Nodit 說明手冊" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal__panel modal__panel--wide help">
        <Frame />
        <header className="modal__head">
          <span className="sec-head__tag label-caps">
            <CircleHelp size={12} /> Guide
          </span>
          <span className="mono muted">如何使用 Nodit · 按 ? 開關</span>
          <button type="button" className="icon-btn" aria-label="關閉" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </header>

        <div className="help__layout">
          <nav className="help__toc" aria-label="說明目錄">
            {GROUPS.map((g) => (
              <div key={g} className="help__toc-group">
                <span className="label-caps">{g}</span>
                {SECTIONS.filter((s) => s.group === g).map((s) => (
                  <button key={s.id} type="button" className={active === s.id ? 'is-active' : ''} aria-current={active === s.id ? 'true' : undefined} onClick={() => jump(s.id)}>
                    {s.title}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="help__body" ref={bodyRef}>
            {SECTIONS.map((s) => (
              <section key={s.id} id={`help-${s.id}`} className="help__section">
                <h3>{s.title}</h3>
                {s.body(actions)}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
