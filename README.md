# dsh-session-unfold

一个 DeepSeek Harness（DSH）Web 客户端插件：把侧边栏那份「一列标题 + 几天前」的会话列表，换成一个全屏的会话平铺视图——每个会话一张卡片，卡片里是这个会话最近几条消息，状态一眼可见，点一下直接进去。

## 它解决什么

DSH 的会话列表只给你标题和时间，任务一多就完全看不出「哪些在跑、哪些等我拍板、哪些已经完事」。这个插件把这些信息铺开成一张大屏：

- 顶栏「新建窗口」会新建一个会话，并把对应卡片加入大屏；大屏不关闭，一个窗口对应一个会话
- 每个窗口默认显示用户消息、Markdown 格式的助手回复，以及助手的澄清提问和你的选择，可切换为仅显示用户消息
- 支持置顶窗口，置顶状态与顺序和侧栏会话置顶共用同一份数据
- 可切换显示子智能体窗口，默认隐藏
- 每个窗口都能拖动右下角自由调整大小，并吸附对齐其它窗口
- 支持批量永久删除窗口及对应会话，删除前需二次确认
- 点击标题即可修改窗口标题，会话标题同步更新
- 每张卡片有独立的“打开会话”按钮，点击卡片空白处不再跳转
- 按状态分组排序：进行中 → 待确定 → 已完成，看得见的永远是当前在处理的
- 卡片上直接回一句话，不用先切会话
- 每张卡片显示所属工作区，跨工作区也不会认错

## 功能

| 能力 | 说明 |
| --- | --- |
| 全屏任务大屏 | 左下角「任务大屏」按钮打开，铺满窗口，Esc 或右上角 ✕ 关闭 |
| 新建窗口 | 顶栏「新建窗口」在当前/最近工作区创建一个新会话，并把对应卡片加入大屏；不跳转会话，大屏保持打开，一个窗口对应一个会话 |
| 每格一个消息窗 | 默认显示用户消息和 Markdown 格式的助手回复；工具调用不显示。窗口顶部「全部 / 仅用户」开关可只保留用户消息 |
| 澄清提问 | 助手用 `ask_user_question` 提出的澄清问题按助手消息显示（问题、选项说明），用户的选择紧随其后以用户消息显示；跳过的问题标注「已跳过」。问题与回答通过工具调用 id 配对，不会重复或错位 |
| 进行中高亮 | 状态为「进行中」的窗口，最后一条用户消息气泡显示为绿色 |
| 权限审批同步 | 会话出现待处理的权限审批时，卡片显示工具名与原因，并可直接“允许一次”或“拒绝”；审批完成后自动消失 |
| 历史消息 | 卡片顶部「加载更早消息」按钮通过 Session 事件窗口向上分页，逐页加载更早的消息 |
| 状态分组 | 进行中 / 待确定 / 已完成，完全由会话运行状态自动推断，用户不能手动修改 |
| 排序 | 置顶窗口优先，其次按 进行中 → 待确定 → 已完成，同状态内按最近活跃时间倒序 |
| 窗口置顶 | 卡片右上角置顶按钮调用侧栏相同的会话 pin 服务；置顶顺序与侧栏一致，侧栏置顶也会同步到大屏 |
| 子智能体窗口 | 顶栏「子智能体」开关控制是否显示子智能体会话窗口，默认隐藏；卡片带“子”标识。子智能体窗口为纯只读视图：不提供输入、标题编辑、置顶、审批操作、批量选择或打开会话按钮 |
| 搜索 | 按任务标题或工作区名过滤 |
| 状态筛选 | 只看某一类状态 |
| 窗口大小 | 拖动卡片右下角调整宽高，靠近其它卡片宽高时自动吸附；双击手柄或点顶栏 ↺ 恢复默认；尺寸记在本地 |
| 批量管理 | 顶栏“批量管理”进入多选；可全选当前、清除选择 |
| 永久删除窗口 | 删除窗口即删除对应会话：调用 `session-delete` 插件的 `delete-session` 命令，永久删除会话记录并停止正在运行的工作；需二次确认，无法恢复 |
| 修改标题 | 点击卡片标题进入行内编辑，回车保存、Esc 取消；调用会话 rename，同步修改对话标题 |
| 打开会话 | 卡片右上角独立按钮；点击卡片正文、气泡或空白处不会再跳转 |
| 输入双向同步 | 卡片输入框与对应会话的真实输入框内容实时双向同步，共享同一份草稿 |
| 输入框换行 | 输入框为自动增高的多行文本框，内容超出宽度自动换行；Shift+Enter 换行，Enter 发送 |
| 内联回复 | 卡片底部输入框，回车直接进该会话队列 |
| 工作区标签 | 标题行右侧显示所属工作区 |
| 运行中徽标 | 侧边栏按钮上的绿色数字，显示当前有几个任务在跑 |
| 中英双语 | 跟随 DSH 的界面语言 |

## 安装

```sh
dsh plugin --profile web add @yornii/dsh-session-unfold
```

包还没发到 npm 时，先从源码装：

```sh
dsh plugin --profile web add github:yornii/dsh-session-unfold
```

也可以把本仓库克隆到本地，在 DSH 的插件管理器里安装包含 `package.json` 的那个目录（`plugin_manager` 的 `install_bundle`，target 传目录的绝对路径）。安装返回 `application: applied` 后刷新 Web 页面，左下角会出现「任务大屏」。

永久删除窗口依赖一个单独的 `session-delete` 插件提供的 `delete-session` 命令；未安装并启用该插件时，删除会提示命令不可用。

卸载：在插件管理器里移除 `@yornii/dsh-session-unfold` 即可，本插件不改动 DSH 的任何原有文件。

## 配置

不需要额外配置。以下数据存在浏览器本地（不会写入会话日志，也不影响 Host）：

| localStorage 键 | 内容 |
| --- | --- |
| `dsh.task-board.card-size.v1` | 会话 id → 卡片尺寸 `{ w, h }` |

状态派生规则（只读）：运行中记为「进行中」；非主视图会话刚结束且完成提醒未读时记为「已完成」；其余记为「待确定」。

## 实现要点

- 纯客户端插件：Host 半身是空实现，全部逻辑在 `client.js`（单文件，无构建步骤）
- 注册两个槽位，不覆盖任何已有 UI：
  - `sidebar.footer.action`：启动按钮
  - `shell.overlay`：全屏大屏
- 新建窗口调用 `ctx.sessions.create({ workspaceId })`（侧栏 New Session 使用的同一个 Host `session/create` 端点），成功后把新 Session 的 id 直接加入大屏；不调用会导航的 `uiWorkspace.startSession()`，因此大屏保持打开。工作区选择复刻 New Session：主视图当前 Session 所属工作区优先，否则最近活跃工作区；按钮由 `useRemoteAccess('session/create')` 门控
- 每个卡片通过 `ctx.sessions.retain(sessionId, { source: 'taskBoard' })` 拿到该会话的最近事件窗口，订阅变化后重新折叠，卸载时释放引用
- 卡片把 `user/message` 与 `assistant/message` 折叠成同一时间线；助手回复用内置的安全 Markdown 子集渲染（标题、粗体、斜体、行内代码、代码块、列表、表格、引用、链接）；工具调用不进入卡片。「全部 / 仅用户」开关只过滤视图，不改变底层事件窗口。窗口尺寸用 Pointer Events 拖动，靠近其它卡片尺寸时吸附并写入 localStorage
- `ask_user_question` 不在 `assistant/message` 里：问题在 `tool/call` 的 `arguments.questions`，回答在同 `callId` 的 `tool/result` 里。折叠时把问题渲染成一条助手气泡（标题加粗、问题正文、选项与说明的列表），再用配对结果补一条用户气泡（每题一行，`header：所选答案`，被跳过或空选的题显示「已跳过」）；没有结果的提问只显示问题，错误结果不产生回答气泡。其他工具调用仍然不显示
- 窗口置顶读取 `useWorkspaces().pinnedSessionIds` 并按该顺序排在普通窗口之前；卡片按钮调用 `uiWorkspace.pinSession` / `unpinSession`，因此侧栏与大屏的置顶状态、顺序始终一致
- 子智能体窗口来自 `useSessions().byId` 中 `origin === 'subagent'` 的行，由顶栏开关控制是否加入卡片列表，默认不加入。子智能体卡片是纯只读视图：不渲染输入框、标题编辑、置顶、审批按钮、批量选择框或「打开会话」按钮
- 历史消息使用 `binding.session.loadOlder()`：它向当前事件窗口前插一页（至少 50 条消息、两个 turn），`eventSource` 的 `hasMore` 决定是否继续显示「加载更早消息」
- 标题编辑调用 `binding.session.rename(title)`，成功后标题投影会同步到侧栏会话标题
- 输入框通过 `sessions.scope(sessionId)` 拿到 `conversation.input.for(scope)`，订阅其 InputState 的 `draft`，并用 `actions.setDraft(text)` 回写；两边始终读写同一份会话草稿
- 输入框使用自动增高的 `textarea`，按 `scrollHeight` 调整高度，超过 `96px` 后内部滚动
- 卡片状态只读：从 `shell.overlay` 标准 prop `useSessionStatus` 读取 `running` / `completionUnread`，卡片标题前仅显示状态点和文字，没有手动修改入口，也不写入 localStorage
- 权限审批读取同一个 `useSessionStatus`：`pendingInteraction.kind === 'approval'` 时渲染卡片横幅，按钮直接调用 `approval.answer('allowed-once')` / `approval.answer('rejected')`，不跳转会话
- 批量删除即永久删除会话：对每个选中窗口执行 `ctx.remote.commands.execute(sessionId, '/delete-session <id>', [])`，复用 `session-delete` 插件的 Host 逻辑来停止活动、校验会话目录并删除记录；需第二次确认，失败时保留对应窗口。插件需与 `session-delete` 同时启用
- 已归档会话通过 `useWorkspaces().archivedSessionIds` 从大屏过滤，恢复归档后会重新出现
- 会话列表来自槽位标准 prop `useSessions`；列表接口在超大会话库上可能很慢，此时退回用控制通道已填充的 `byId` 渲染，避免长时间空屏
- 内联回复调用 `binding.session.prompt([{ type: 'text', text }], 'queue')`
- 样式全部使用宿主主题变量（`--dsw-alias-*`、`--dsw-radius-*`），明暗主题自动跟随

## 自检

```bash
node --check client.js
node tools/render-test.mjs
```

`tools/render-test.mjs` 是一个离线渲染冒烟测试：用假 Host 加载 `client.js`，喂若干合成会话，把大屏渲染成 HTML 后断言卡片结构、完整消息时间线、可调尺寸与控件存在性。它不依赖浏览器，可在 CI 里跑。

## 已知限制

- 状态和窗口尺寸只记录在本机浏览器，换机器不同步
- 实时刷新、跳转导航、状态持久化这三条依赖真实运行中的 Web 页面，离线冒烟测试覆盖不到
- DSH 本身没有永久删除会话的接口；本插件的批量删除通过 `session-delete` 的 `delete-session` 命令完成，未启用该插件时删除会失败。删除后的会话不能从“已归档”恢复
- 输入双向同步的是草稿文本；卡片没有会话输入框里的引用 chip/附件预览，从卡片改写草稿时这些富段落会退化为纯文本
- 权限审批卡片只覆盖审批类交互；计划审阅、提问等其他 pending interaction 仍需进入会话处理
- 澄清提问按工具调用 id 配对问题与回答：timed 模式下提问到期后以迟到回复送达的回答走 `user-question-reply` 用户消息，卡片只显示问题、不显示这条迟到回答；问题与结果被分页切开时，需要「加载更早消息」才能显示回答
- 大屏初始显示 12 个窗口，更多任务靠底部「再看 N 个」翻页，未做虚拟滚动

## 许可

[MIT](LICENSE)
