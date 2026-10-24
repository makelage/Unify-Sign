// ============================================================
// AI 手机控制服务 (基于 WebSocket)
// 版本: 2.1.0
// 功能: 为 AI 提供完整的安卓手机操控能力
// 指令集: widget_info / click / long_press / swipe / drag /
//         input / press_key / scroll / screenshot /
//         launch_app / stop_app / get_current_app / list_apps / app_info /
//         get_device_info / get_battery / get_screen_size / get_orientation /
//         wait_for_widget / wait_for_text / wait_for_app /
//         set_clipboard / get_clipboard / show_toast /
//         start_keep_awake / stop_keep_awake /
//         open_usage_settings / get_idle_info        (防锁屏: 授权/查看系统空闲时间)
//         operate / hello / log /
//         file_list / file_download / file_upload  (F1 文件管理: 列出/下载/上传)
//         find_text / click_text                  (F2 OCR 文字查找/点击: 控件树找不到时自动 OCR 兜底)
// ============================================================

let localOcrUtil = require('./lib/LocalOcrUtil.js')
let singletonRequire = require('./lib/SingletonRequirer.js')(runtime, this)
let BaseSignRunner2 = require('./core/BaseSignRunner2.js')
let automator = singletonRequire('Automator')
let widgetUtils = singletonRequire('WidgetUtils')
let commonFunctions = singletonRequire('CommonFunction')
let runningQueueDispatcher = singletonRequire('RunningQueueDispatcher')
runningQueueDispatcher.checkDuplicateRunning(engines.myEngine().id)
let FloatyInstance = singletonRequire('FloatyUtil')
checkAndLoadDex('./lib/autojs-common.dex')
importClass(com.tony.autojs.search.UiObjectTreeBuilder)
importClass(java.util.concurrent.CountDownLatch)
importClass(android.util.Base64)
importClass(android.content.Context)
importClass(android.content.Intent)
importClass(android.provider.Settings)
importClass(android.app.usage.UsageStatsManager)

// ============================================================
// 通用控件查找方法（参考 BaseSignRunner2.js findText）
// ============================================================
const FIND_TIMEOUT = 5000  // 默认查找超时
// ============================================================
// baseSignRunner 懒加载与空闲销毁
// 说明: baseSignRunner 仅在 find_text / click_text 指令真正需要 OCR/控件查找时才初始化；
//       服务启动、防锁屏滑动等并不依赖它（后者只用到 FloatyUtil 单例，见 keepAwakeSwipe）。
//       长时间空闲时（默认 5 分钟无 find_text/click_text 调用）自动置空引用释放对象，
//       下次需要时再 new 一个（构造函数只绑定运行时单例引用，开销极低）。
// ============================================================
const BASE_SIGN_RUNNER_IDLE_MS = 5 * 60 * 1000   // 空闲阈值：5 分钟
let baseSignRunnerRef = null
let baseSignRunnerLastUsed = 0

// 按需获取 baseSignRunner：不存在则创建，并刷新最后使用时间
function getBaseSignRunner () {
  if (baseSignRunnerRef === null) {
    baseSignRunnerRef = new BaseSignRunner2()
    console.log('[baseSignRunner] 已按需初始化')
  }
  baseSignRunnerLastUsed = new Date().getTime()
  return baseSignRunnerRef
}

// 空闲超过阈值则销毁（隐藏浮窗并置空引用），由定时器周期性调用
function destroyBaseSignRunner () {
  if (baseSignRunnerRef === null) return
  let idle = new Date().getTime() - baseSignRunnerLastUsed
  if (idle < BASE_SIGN_RUNNER_IDLE_MS) return
  try { FloatyInstance.hide() } catch (e) {}
  baseSignRunnerRef = null
  console.log('[baseSignRunner] 空闲 ' + Math.floor(idle / 1000) + ' 秒，已销毁释放资源')
}

// 将 baseSignRunner.findText / clickText 返回的控件统一成 WS 响应结构。
// 注意：baseSignRunner 的 OCR 分支返回的是 bounds 包装对象，没有 isOcrResult 标记，
// 因此用是否具备 UiObject 特征（存在 className 方法）来区分 widget / ocr 来源。
function normalizeMatch(widget) {
  if (!widget) return null
  let b = widget.bounds()
  let box = { left: b.left, top: b.top, right: b.right, bottom: b.bottom }
  let isOcr = !!(widget.isOcrResult) || (typeof widget.className !== 'function')
  return {
    found: true,
    source: isOcr ? 'ocr' : 'widget',
    x: b.centerX(),
    y: b.centerY(),
    label: (typeof widget.text === 'function' ? widget.text() : '') || '',
    box: [box.left, box.top, box.right, box.bottom]
  }
}

function escapeRegex (text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildRegionFilter (region) {
  if (!region || !Array.isArray(region) || region.length < 4) {
    return null
  }
  let [left, top, width, height] = region
  return (matcher) => matcher.boundsInside(left, top, left + width, top + height)
}

function toWidgetMatch (widget) {
  if (!widget) {
    return null
  }
  let b = widget.bounds()
  return {
    source: 'widget',
    text: widget.text && widget.text() ? widget.text() : (widget.contentDescription || ''),
    label: widget.text && widget.text() ? widget.text() : (widget.contentDescription || ''),
    x: b.centerX(),
    y: b.centerY(),
    box: [b.left, b.top, b.right, b.bottom]
  }
}

function toOcrMatch (item) {
  if (!item) {
    return null
  }
  let b = item.bounds || {}
  let centerX = b.centerX != null ? b.centerX : ((b.left || 0) + (b.right || 0)) / 2
  let centerY = b.centerY != null ? b.centerY : ((b.top || 0) + (b.bottom || 0)) / 2
  return {
    source: 'ocr',
    text: item.label || '',
    label: item.label || '',
    x: centerX,
    y: centerY,
    box: [b.left, b.top, b.right, b.bottom]
  }
}

function findTextMatches (text, region, timeout, contains, useOcr) {
  if (text === '' || typeof text === 'undefined' || text === null) {
    return []
  }
  timeout = timeout || FIND_TIMEOUT
  contains = contains !== false
  useOcr = useOcr !== false
  let pattern = text
  let results = []
  let matchesRequestedText = (label) => {
    label = String(label || '')
    return contains ? label.indexOf(String(text)) !== -1 : label === String(text)
  }

  try {
    let appendFilter = buildRegionFilter(region)
    let widgets = WidgetUtils.widgetGetAll(pattern, timeout, null, appendFilter) || []
    for (let widget of widgets) {
      let match = toWidgetMatch(widget)
      if (match && matchesRequestedText(match.label)) {
        results.push(match)
      }
    }
    if (results.length > 0) {
      return results
    }
  } catch (e) {
    console.warn('控件树批量查找异常:', e)
  }

  if (useOcr && localOcrUtil) {
    let screen = null
    try {
      screen = captureScreen()
      if (screen) {
        let found = localOcrUtil.recognizeWithBounds(screen, region || null, pattern) || []
        for (let item of found) {
          let match = toOcrMatch(item)
          if (match && matchesRequestedText(match.label)) {
            results.push(match)
          }
        }
      }
    } catch (e) {
      console.warn('OCR批量查找异常:', e)
    } finally {
      if (screen) releaseImage(screen)
    }
  }

  return results
}

/**
 * 点击控件（参考 BaseSignRunner.js displayButtonAndClick）
 * @param {UiObject} widget - 控件
 * @returns {boolean} 是否点击成功
 */
function clickWidget(widget) {
  if (!widget) {
    return false
  }
  // OCR结果直接点击坐标
  if (widget.isOcrResult) {
    let b = widget.bounds()
    click(b.centerX(), b.centerY())
    markActivity()
    return true
  }
  // 控件树控件的点击逻辑
  if (typeof widget.clickable !== 'undefined' && widget.clickable()) {
    widget.click()
    markActivity()
    return true
  }
  if (automator.checkCenterClickable(widget)) {
    automator.clickCenter(widget)
    markActivity()
    return true
  }
  // 不可点击，用坐标点击
  let b = widget.bounds()
  click(b.centerX(), b.centerY())
  markActivity()
  return true
}

/**
 * 可靠坐标点按：优先找坐标处的控件并向上回溯到最近的可点击祖先，用 accessibility 点击
 * （MIUI 启动应用/图标的可靠路径，不受「USB 调试(安全设置)」限制）；找不到可点击祖先才
 * 回退 AutoX 全局 click(x,y)，最后才回退 input tap（该命令在 MIUI 无权限时会被静默丢弃，
 * shell 退出码恒为 0，不可作为成功依据）。
 * @returns {{ok: boolean, via: string}} ok 是否真正下发；via 路径(widget|global|shell|none)
 */
function clickAtPoint(x, y, widgets) {
  // 1) 找坐标处的控件，向上找最近的可点击祖先，accessibility 点击
  try {
    widgets = widgets || []
    // 面积从小到大，优先点最小的那个（最靠近手指的叶子）
    widgets.sort((a, b) => a.bounds().width() * a.bounds().height() - b.bounds().width() * b.bounds().height())
    for (let w of widgets) {
      let node = w
      let guard = 0
      while (node && guard++ < 12) {
        try {
          if (node.clickable && node.clickable()) {
            node.click()
            return { ok: true, via: 'widget' }
          }
        } catch (e) {}
        try { node = node.parent ? node.parent() : null } catch (e) { node = null }
      }
    }
  } catch (e) {}
  // 2) 兜底：AutoX 全局坐标点击（依赖 RootAutomator/注入）
  try {
    showRunnerFloaty()
    FloatyInstance.setFloatyInfo( {x: x, y: y}, '↑')
    if (automator.click(x, y) === true) return { ok: true, via: 'global' }
  } catch (e) {}
  // 3) 最后兜底：input tap（MIUI 无权限时静默丢弃，via=shell 仅表示命令发出，不代表生效）
  try {
    let r = shell("input tap " + Math.round(x) + " " + Math.round(y), true)
    if (r && r.code === 0) return { ok: true, via: 'shell' }
  } catch (e) {}
  return { ok: false, via: 'none' }
}

let plugin_websocket = (() => {
  try {
    return plugins.load('com.tony.websocket')
  } catch (e) {
    toastLog('当前未安装websocket插件，加载失败' + e)
    exit()
  }
})()

if (!requestScreenCapture()) {
  toastLog('请求截图权限失败')
  exit()
}
auto.waitFor()

// ============================================================
// 文件管理（F1）相关常量
// ============================================================
const FILE_ROOT = files.getSdcardPath()   // sdcard 根目录，即用户可见的内部存储根目录
const FILE_MAX_BYTES = 15 * 1024 * 1024                        // 单次读写上限 ~15MB，防止 OOM

let connectedClients = []

// ============================================================
// 防锁屏定时器状态
// 说明: 优先使用"系统真实空闲时间"（UsageStatsManager，需授权使用情况权限）决定要不要滑动：
//       系统空闲达到阈值且屏幕亮着才滑动，避免在你手动用手机时误打扰；
//       未授权时回退到"距上次远程指令"计时（原行为）。屏幕已灭时保持心跳避免自动任务卡死。
// ============================================================
let lastActivityTime = new Date().getTime()   // 最近一次操作时间戳
let keepAwakeThread = null                      // 防锁屏线程句柄
let keepAwakeConfig = null                      // 防锁屏配置缓存
const KEEP_AWAKE_IDLE_MS = 60 * 1000            // 空闲阈值：1分钟
const KEEP_AWAKE_CHECK_MS = 60 * 1000           // 防锁屏线程循环周期：1分钟（与控件树抓取同周期）
const KEEP_AWAKE_SWIPE_PX = 30                  // 防锁屏滑动距离(px)
const LOCK_GRACE_MS = 10 * 60 * 1000            // mainJD 未运行时的锁屏宽限：10分钟
const WIDGET_LOG_BASE = files.join(files.getSdcardPath(), '脚本', 'widget_log')  // 控件树日志根目录：每天一个子目录
const WIDGET_DUMP_SCREEN_W = 360          // 截图缩小后的目标宽度(px)，高度按比例；1080→360 约 1/3

// 标记发生了用户操作（点击/滑动等），刷新空闲计时
function markActivity () {
  lastActivityTime = new Date().getTime()
}

// 获取当前Activity（兼容处理）
function getCurrentActivitySafe() {
  try {
    return currentActivity() || ''
  } catch (e) {
    return ''
  }
}

// 获取系统真实空闲时间（全系统最近一次用户交互距今毫秒数）。
// 需要"使用情况访问权限"，未授权或无数据时返回 -1（调用方应回退到 WS 计时）。
function getSystemIdleMs () {
  try {
    let ctx = context
    let usm = ctx.getSystemService('usagestats')
    if (!usm) return -1
    let now = java.lang.System.currentTimeMillis()
    let stats = usm.queryUsageStats(
      android.app.usage.UsageStatsManager.INTERVAL_BEST,
      now - 60 * 60 * 1000,
      now
    )
    if (!stats || stats.isEmpty()) return -1
    let maxUsed = 0
    let it = stats.iterator()
    while (it.hasNext()) {
      let t = it.next().getLastTimeUsed()
      if (t > maxUsed) maxUsed = t
    }
    if (maxUsed <= 0) return -1
    return now - maxUsed
  } catch (e) {
    return -1
  }
}

// 未授权使用情况权限时，仅提示一次（避免刷屏）
let usageWarned = false

// 综合决策：是否滑动防锁屏
function computeIdleDecision (idleMs, mainJdStopTime) {
  let sysIdle = getSystemIdleMs()
  let shouldAct = mainJdStopTime <= 0? true : (new Date().getTime() - mainJdStopTime) < LOCK_GRACE_MS
  if (sysIdle >= 0) {
    // 已拿到系统空闲时间
    if (!device.isScreenOn()) {
      // 屏幕已灭
      return { shouldAct: false, reason: '屏幕已灭(系统空闲' + Math.floor(sysIdle / 1000) + '秒)，保持心跳' }
    }
    if (sysIdle >= idleMs) {
      return { shouldAct: shouldAct, reason: '系统空闲' + Math.floor(sysIdle / 1000) + '秒' }
    }
    return { shouldAct: false, reason: '系统活跃(空闲' + Math.floor(sysIdle / 1000) + '秒)，不打扰' }
  }
  // 回退：距上次远程指令计时
  let idle = new Date().getTime() - lastActivityTime
  if (idle >= idleMs) {
    return { shouldAct: shouldAct, reason: '距上次指令' + Math.floor(idle / 1000) + '秒(未授权使用情况权限)' }
  }
  return { shouldAct: false, reason: '距上次指令' + Math.floor(idle / 1000) + '秒' }
}

// 打开"使用情况访问权限"设置页（引导用户授权，以便获取系统空闲时间）
function openUsageAccessSettings () {
  try {
    let intent = new android.content.Intent(android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS)
    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    return true
  } catch (e) {
    return false
  }
}

// 判断 mainJD.js 是否正在运行（遍历所有脚本引擎的 source，匹配 "mainJD"）
function isMainJdRunning () {
  try {
    let all = engines.all()
    return all.some(e => e.getSource().toString().includes('mainJD'))    
  } catch (e) {
    // 查询失败时保守返回 false，交由锁屏宽限逻辑处理
    commonFunctions.printException('isMainJdRunning', e)
  }
  return false
}

// 安全地读取当前包名/Activity（无前台时避免抛错）
function safeCurrentPackage () {
  try { return currentPackage() || '' } catch (e) { return '' }
}
function safeCurrentActivity () {
  try { return currentActivity() || '' } catch (e) { return '' }
}

// 日期/时间格式化
function fmtDate (date, pattern) {
  let sdf = new java.text.SimpleDateFormat(pattern)
  return sdf.format(new java.util.Date(date.getTime()))
}

// 递归统计控件树节点数（供 phone_control.html 历史列表显示 nodeCount 用）
function countWidgetNodes (node) {
  if (!node) return 0
  let n = 1
  if (node.children && node.children.length) {
    for (let i = 0; i < node.children.length; i++) {
      n += countWidgetNodes(node.children[i])
    }
  }
  return n
}

// 抓取当前控件树 + 缩放截图，写入"当天目录"（每天一个子目录，每分钟一个文件）。
// 产出文件与 phone_control.html「打开文件 / 导出」单条快照格式完全兼容：
//   { id, ts, time, screenshot(data:image/jpeg;base64,...), naturalWidth,
//     naturalHeight, nodeCount, packageName, activity, widgetTree }
// 注意：screenshot 内嵌“缩放后”图的 base64 以控制体积，但 naturalWidth/Height 仍填
//       设备原始尺寸(1080x2400)，这样 phone_control.html 内点击坐标映射(natural→显示)
//       与控件树坐标保持一致（HTML 的截图显示尺寸按 natural 比例算，与图自身像素无关）。
// 只落盘 JSON 一个文件（截图已内嵌 base64，统一用 phone_control.html 查看）。
// 目录：<WIDGET_LOG_BASE>/yyyy-MM-dd/HH-mm-ss.json
function dumpWidgetInfoToFile () {
  let now = new Date()
  let dateStr = fmtDate(now, 'yyyy-MM-dd')
  let dir = files.join(WIDGET_LOG_BASE, dateStr)
  let stamp = fmtDate(now, 'HH-mm-ss')
  let jsonPath = files.join(dir, stamp + '.json')
  if (!files.exists(jsonPath)) {
    files.ensureDir(jsonPath)
  }

  // —— 复用 buildWidgetResult 完成控件树+截图抓取（修复 2026-07-20 防锁屏线程只跑一轮）——
  // 原实现在 keep-awake 无 Looper 的后台线程里直接调 requestWidgetInfos()/captureScreen()，
  // 这两个调用在无 Looper 线程中会阻塞，导致线程卡死、循环不再推进（见 15:23 ScriptThread-66 仅打出一次 running:true）。
  // buildWidgetResult 内部用 threads.start + CountDownLatch 在独立子线程里完成抓取，已在 widget_info 指令等多处验证可用。
  let res = buildWidgetResult({})
  let tree = null
  let widgetError = null
  if (res.code === 'success' && res.widgetInfo) {
    try { tree = JSON.parse(res.widgetInfo) } catch (e) { widgetError = '控件树解析失败: ' + e }
  } else {
    widgetError = res.msg || '控件树获取失败'
  }

  // —— 截图：沿用 buildWidgetResult 返回的 base64，缩放到目标宽度（与 phone_control.html 兼容、控体积）——
  let imgBase64 = res.imgBase64 || null
  if (imgBase64 && WIDGET_DUMP_SCREEN_W > 0) {
    try {
      // ⚠️ 本 Auto.js M 的 images.scale 第2/3参数是“缩放倍数”(非目标尺寸)，用 ratio 因子避免 OOM
      let img = images.fromBase64(imgBase64)
      let ratio = WIDGET_DUMP_SCREEN_W / img.width
      let s = images.scale(img, ratio, ratio)
      imgBase64 = images.toBase64(s, 'jpg')
      releaseImage(s)
      releaseImage(img)
    } catch (e) {
      // 缩放失败：退回原图 base64，不阻断写入
      console.warn('[widget_dump] 截图缩放失败，使用原图:', e)
    }
  }
  let screenshotError = imgBase64 ? null : '截图获取失败'

  if (!tree && !imgBase64) {
    console.warn('[widget_dump] 控件树与截图均失败，跳过写入: ' + jsonPath)
    return false
  }

  // naturalWidth/Height 取设备原始尺寸（截图优先；截图失败则用树根 boundsInfo 兜底）
  let devW = res.width || (tree && tree.boundsInfo ? (tree.boundsInfo.right || 0) : 0)
  let devH = res.height || (tree && tree.boundsInfo ? (tree.boundsInfo.bottom || 0) : 0)
  let nodeCount = tree ? countWidgetNodes(tree) : 0
  let rec = {
    id: String(now.getTime()),
    ts: now.getTime(),
    time: fmtDate(now, 'yyyy-MM-dd HH:mm:ss'),
    screenshot: imgBase64 ? ('data:image/jpeg;base64,' + imgBase64) : '',
    naturalWidth: devW,
    naturalHeight: devH,
    nodeCount: nodeCount,
    packageName: safeCurrentPackage(),
    activity: safeCurrentActivity(),
    widgetTree: tree,
    widgetError: widgetError || undefined,
    screenshotError: screenshotError || undefined
  }

  try {
    files.write(jsonPath, JSON.stringify(rec))
    console.log('[widget_dump] 已写入(兼容 phone_control.html): ' + jsonPath +
      (imgBase64 ? (' 截图base64 ' + imgBase64.length + 'B') : ' (无截图)') +
      ' 节点' + nodeCount)
    return true
  } catch (e) {
    console.error('[widget_dump] 写入失败:', e)
    return false
  }
}

// 防锁屏滑动（屏幕中心向上/左滑 px 像素，隐藏浮窗，刷新空闲计时）
function keepAwakeSwipe (px) {
  let cx = Math.floor(device.width / 2)
  let cy = Math.floor(device.height / 2)
  if (safeCurrentActivity().indexOf('launcher') !== -1) {
    swipe(cx, cy, cx - px, cy, 300)
  } else {
    swipe(cx, cy, cx, cy - px, 300)
  }
  markActivity()
  try { FloatyInstance.hide() } catch (e) {}
}

// 在独立线程中运行防锁屏循环（避免 WebSocket 工作线程缺少 Looper 导致 setInterval 崩溃）
// 循环周期：KEEP_AWAKE_CHECK_MS（默认 1 分钟，由 startKeepAwakeThread 的 checkMs 参数决定）。
// 每轮行为：
//   - mainJD.js 运行期间：抓取控件树写入"当天目录"（组件信息），并按条件判定是否滑动防锁屏；
//   - mainJD.js 未运行：给 10 分钟宽限（宽限期内仍按原有空闲判定保持常亮），
//     宽限期满后停止一切防锁屏动作，屏幕按系统设置自然锁定。
function startKeepAwakeThread (idleMs, checkMs, swipePx) {
  // 若已存在线程，先中断
  if (keepAwakeThread !== null) {
    try { keepAwakeThread.interrupt() } catch (e) {}
    keepAwakeThread = null
  }
  keepAwakeConfig = { idleMs, checkMs, swipePx }
  keepAwakeThread = threads.start(function () {
    // 捕获当前线程以便循环中判断是否被中断
    let t = threads.currentThread()
    let mainJdStopTime = -1        // 最近一次检测到 mainJD 未运行的时间戳
                                   //   -1: 当前运行中；>=0: 未运行起点；-2: 已打印过允许锁屏日志
    while (!t.isInterrupted()) {
      try {
        sleep(checkMs)
        let running = isMainJdRunning()
        let now = new Date().getTime()
        console.log('[防锁屏] mainJD 运行中:', running, mainJdStopTime, now)

        if (running) {
          // —— mainJD 运行期间 ——
          mainJdStopTime = -1
          // 1) 每轮（1分钟）抓取控件树并写入"当天目录"（仅 mainJD 运行期间）
          try {
            console.log('dumpWidgetInfoToFile begin')
            if (dumpWidgetInfoToFile()) {
              console.log('[防锁屏] mainJD 运行中：已抓取控件树')
            }
            console.log('dumpWidgetInfoToFile end')
          } catch (e) {
            console.error('[防锁屏] 控件树抓取异常:', e)
          }
          // 2) 根据条件判定是否滑动防锁屏（系统空闲判定避免打扰手动操作）
          let decision = computeIdleDecision(idleMs, mainJdStopTime)
          if (decision.shouldAct) {
            keepAwakeSwipe(swipePx)
            swipePx = 0 - swipePx
            console.log('[防锁屏] ' + decision.reason + '，已滑动防锁屏')
          }
        } else {
          // —— mainJD 未运行 ——
          if (mainJdStopTime < 0) {
            mainJdStopTime = new Date().getTime()
          }
          let decision = computeIdleDecision(idleMs, mainJdStopTime)
          if (decision.shouldAct) {
            keepAwakeSwipe(swipePx)
            swipePx = 0 - swipePx
            console.log('[防锁屏] ' + decision.reason + '，已滑动防锁屏(宽限期内)')
          }
        }
      } catch (err) {
        // 被中断唤醒属正常
        if (!t.isInterrupted()) {
          console.error('[防锁屏] 定时器执行异常:', err)
        }
      }
    }
    console.log('[防锁屏] 线程已退出')
  })
  return keepAwakeThread
}

function stopKeepAwakeThread () {
  if (keepAwakeThread !== null) {
    try { keepAwakeThread.interrupt() } catch (e) {}
    keepAwakeThread = null
  }
  keepAwakeConfig = null
}
let socketServer = plugin_websocket.createServer(8212, {
  onOpen: function (conn, handshake) {
    let address = conn.getRemoteSocketAddress() + ''
    console.log('client connect', address)
    connectedClients.push({
      address: address,
      conn: conn
    })
  },

  onClose: function (conn, code, reason, remote) {
    let address = conn.getRemoteSocketAddress() + ''
    let index = -1
    for (let i = 0; i < connectedClients.length; i++) {
      let c = connectedClients[i]
      if (c.address == address) {
        console.log('client disconnected', address)
        index = i
      }
    }
    if (index > -1) {
      connectedClients.splice(index, 1)
    }
  },

  onMessage: function (conn, message) {
    handleRequest(conn, message)
  },

  onError: function (conn, ex) {
    printException('WebSocket', ex)
    // 不再退出，只记录日志，连接断开时会自动清理
  },
  onStart: function () {
    toastLog('AI手机控制服务已启动 端口:8212')
    let ipAddress = getIpAddress()
    console.log('服务地址:', ipAddress)
  }
})

socketServer.start()

// 服务启动即默认开启防锁屏定时器（手机常锁屏，避免运行时被锁）
// 仍可通过 stop_keep_awake 显式关闭，或再次 start_keep_awake 重置参数
try {
  markActivity()
  startKeepAwakeThread(KEEP_AWAKE_IDLE_MS, KEEP_AWAKE_CHECK_MS, KEEP_AWAKE_SWIPE_PX)
  console.log('[防锁屏] 服务启动，已默认开启防锁屏定时器')
} catch (e) {
  console.error('[防锁屏] 默认启动失败:', e)
}
// 单一定时器（每 10 秒一次）：
//  · 浮窗自动隐藏：每次 tick 都检查——调用 BaseSignRunner2 相关指令显示浮窗后，距最后一次
//    显示超过 FLOATY_AUTO_HIDE_MS 则隐藏全部浮窗，避免 yoloCheckAll 矩形框/主状态窗永久残留。
//  · 空闲销毁检查：baseSignRunner 自上次使用后空闲超过 5 分钟即销毁（见 destroyBaseSignRunner /
//    getBaseSignRunner）。因销毁本身需空闲 >5min，无需每 10s 都查——用计数器每 3 个 tick
//    （≈30s）执行一次即可，与原 30s 节奏一致，避免无谓频繁检查。
const FLOATY_AUTO_HIDE_MS = 4000  // 调用结束后 4 秒自动隐藏浮窗
let floatyShownAt = 0
let _idleCheckTick = 0
setInterval(function () {
  // 浮窗自动隐藏：每 tick 检查
  try {
    if (floatyShownAt && new Date().getTime() - floatyShownAt >= FLOATY_AUTO_HIDE_MS) {
      if (baseSignRunnerRef && typeof baseSignRunnerRef.setAllFloatyVisible === 'function') {
        baseSignRunnerRef.setAllFloatyVisible(false)
      } else {
        FloatyInstance.hide()
      }
      floatyShownAt = 0
    }
  } catch (e) {}
  // 空闲销毁检查：每 3 个 tick（≈30s）执行一次
  if ((_idleCheckTick++ % 3) === 0) {
    try { destroyBaseSignRunner() } catch (e) {}
  }
}, 10000)

// ============================================================
// 调用 BaseSignRunner2 前显示浮窗
// 说明: find_text / click_text / yolo_detect / yolo_click 在调用 BaseSignRunner2 相关方法前，
//       先 showRunnerFloaty() 显示全部浮窗（主状态窗 + 日志窗 + 矩形提示窗），并记录
//       floatyShownAt；随后由上方唯一的 setInterval（周期 10s）在「最后一次显示后
//       FLOATY_AUTO_HIDE_MS 毫秒」自动隐藏，避免浮窗（尤其 yoloCheckAll 矩形框）永久残留。
// ============================================================

// 调用 BaseSignRunner2 前显示所有浮窗
function showRunnerFloaty () {
  try {
    let runner = getBaseSignRunner()
    if (runner && typeof runner.setAllFloatyVisible === 'function') {
      runner.setAllFloatyVisible(true)
    } else {
      FloatyInstance.restore()   // 兜底：旧版本 runner 无该方法时至少显示主状态浮窗
    }
    floatyShownAt = new Date().getTime()
  } catch (e) {
    console.error('[floaty] 显示浮窗失败: ' + e)
  }
}

events.on('exit', function () {
  stopKeepAwakeThread()
  socketServer.stop()
})

// ============================================================
// 通用堆栈打印函数
// ============================================================
function printException (tag, e) {
  let stack = e.stack || ''
  // 过滤 Auto.js 内部栈，只保留用户代码相关行
  let lines = stack.split('\n').filter(line =>
    line.includes('.js') && !line.includes('autojs')
  )
  if (lines.length === 0) {
    lines = stack.split('\n').slice(0, 5)  // 默认取前5行
  }
  console.error('[' + tag + '] 异常: ' + e.message || e)
  console.error('[' + tag + '] 堆栈:')
  lines.forEach(line => console.error('  ' + line.trim()))
}

// ============================================================
// 统一响应封装
// ============================================================
function wrapResp (requestData, code, message, dataAppender) {
  let response = { code, message }
  if (typeof requestData.callbackId != 'undefined') {
    response.callbackId = requestData.callbackId
  }
  if (typeof dataAppender === 'function') {
    dataAppender(response)
  }
  return JSON.stringify(response)
}

// ============================================================
// 安全发送响应（连接断开时不抛异常）
// ============================================================
function safeSend(conn, message) {
  try {
    if (conn && typeof conn.send === 'function') {
      // 兼容：调用方可能传 JSON 字符串（wrapResp 已 stringify）或裸 JS 对象（file_chunk/file_single）。
      // Auto.js 的 conn.send(对象) 会调用对象.toString() 变成 "[object Object]"，导致客户端 json.loads 失败、
      // 一直等帧直到超时。故此处对裸对象统一序列化为 JSON 字符串。
      if (message !== null && typeof message === 'object') {
        message = JSON.stringify(message)
      }
      conn.send(message)
    }
  } catch (e) {
    // 连接已断开，忽略发送错误
    // console.log('发送响应失败，连接已断开')
  }
}

// ============================================================
// 指令路由表
// ============================================================
const requestDispatcher = {

  // ---- 原有指令（保留）----

  widget_info: (conn, requestData) => {
    let getResult = buildWidgetResult(requestData)
    safeSend(conn, wrapResp(requestData, getResult.code, getResult.msg, (r) => {
      Object.assign(r, getResult)
      r.type = 'widgetInfo'
    }))
  },

  operate: (conn, requestData) => {
    console.log('执行脚本：', requestData.name, requestData.data)
    engines.execScript(requestData.name || 'tmp.js', requestData.data, requestData.config)
    safeSend(conn, wrapResp(requestData, 'success', '操作成功'))
  },

  // ---- F1: 文件管理 (列出目录 / 下载 / 上传) ----

  /**
   * 列出目录内容
   * 参数: { path?(相对脚本根目录或绝对路径，默认根目录), recursive?(是否递归，默认false) }
   * 返回: { path, isDir, count, files:[{name,path,isDir,size,lastModified,readable,writable,hidden}] }
   */
  file_list: (conn, requestData) => {
    try {
      let { path, recursive } = requestData
      let target = resolvePath(path)
      if (!files.exists(target)) {
        safeSend(conn, wrapResp(requestData, 'error', '路径不存在: ' + target))
        return
      }
      if (!files.isDir(target)) {
        // 路径是单个文件，直接返回其元信息
        safeSend(conn, wrapResp(requestData, 'success', '获取成功', (r) => {
          r.path = target
          r.isDir = false
          r.files = [fileMeta(target)]
        }))
        return
      }
      let result = []
      collectDir(target, result, !!recursive)
      safeSend(conn, wrapResp(requestData, 'success', '获取成功', (r) => {
        r.path = target
        r.isDir = true
        r.count = result.length
        r.files = result
      }))
    } catch (e) {
      printException('file_list', e)
      safeSend(conn, wrapResp(requestData, 'error', '列出目录失败: ' + e.message))
    }
  },

  /**
   * 下载文件（返回 base64 编码内容，二进制/文本通用）
   * 参数: { path }
   * 返回: { path, size, lastModified, encoding:'base64', content }
   */
  file_download: (conn, requestData) => {
    try {
      let { path, mode } = requestData
      if (!path) {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: path'))
        return
      }
      let target = resolvePath(path)
      if (!files.exists(target)) {
        safeSend(conn, wrapResp(requestData, 'error', '文件不存在: ' + target))
        return
      }
      if (files.isDir(target)) {
        safeSend(conn, wrapResp(requestData, 'error', '目标为目录，无法下载: ' + target))
        return
      }
      const cs = 262144  // 分片大小由服务端自行决定，客户端不再传 chunkSize
      // mode==='single'：单消息整文件返回（兼容旧客户端 / 诊断用，< FILE_MAX_BYTES 即 15MB）
      if (mode === 'single') {
        console.log('[file_download] 单消息模式: ' + target)
        sendSingleFrame(conn, requestData, target)
        return
      }
      // 默认走分片流式下载（优化大文件）；流式在发送任何分片前失败则回退单消息，避免客户端永久等待
      try {
        streamDownload(conn, target, requestData.callbackId, requestData.reqId, cs)
      } catch (e) {
        console.log('[file_download] 流式失败，回退单消息: ' + e.message)
        sendSingleFrame(conn, requestData, target)
      }
    } catch (e) {
      printException('file_download', e)
      safeSend(conn, wrapResp(requestData, 'error', '下载失败: ' + e.message))
    }
  },

  /**
   * 上传文件（JSON 中携带 base64 内容，一次性写入，自动创建父目录）
   * 参数: { path 或 fileName(二者其一), content(base64字符串), overwrite?(默认false) }
   * 返回: { path, size }
   */
  file_upload: (conn, requestData) => {
    try {
      // 分片上传模式：客户端逐块发送，mode:'chunk' + reqId + seq + done 标识
      if (requestData.mode === 'chunk') {
        handleUploadChunk(conn, requestData)
        return
      }
      // —— 单消息整文件上传（原逻辑，向后兼容）——
      let { path, content, overwrite, fileName } = requestData
      if (!content) {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: content(base64)'))
        return
      }
      if (!path && !fileName) {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: path 或 fileName'))
        return
      }
      let target = resolvePath(fileName && !path ? fileName : path)
      finalizeUpload(conn, requestData, target, content, !!overwrite)
    } catch (e) {
      printException('file_upload', e)
      safeSend(conn, wrapResp(requestData, 'error', '上传失败: ' + e.message))
    }
  },

  hello: (conn, requestData) => {
    safeSend(conn, JSON.stringify({
      type: 'hello',
      data: {
        message: 'hello, this is AI Phone Control Server v2.0',
        capabilities: Object.keys(requestDispatcher)
      }
    }))
  },

  log: (conn, requestData) => {
    let currentAddress = conn.getRemoteSocketAddress() + ''
    connectedClients.forEach(oc => {
      if (oc.address == currentAddress) return
      if (oc.conn.isOpen()) {
        safeSend(oc.conn, JSON.stringify({ type: 'log_dispatcher', message: requestData.data }))
      }
    })
  },

  // ---- N1: 精准操作指令 ----

  /**
   * 点击操作
   * 参数: { x, y } 坐标点击 或 { widgetId } 按控件id点击
   */
  click: (conn, requestData) => {
    try {
      let beforeActivity = getCurrentActivitySafe()
      let widgetInfo = null
      let tapped = true
      var tapVia = ''
      if (requestData.widgetId) {
        let widget = id(requestData.widgetId).findOne(3000)
        if (!widget) {
          safeSend(conn, wrapResp(requestData, 'error', '未找到控件: ' + requestData.widgetId))
          return
        }
        tapped = clickWidget(widget) !== false
        tapVia = 'widget'
        let b = widget.bounds()
        widgetInfo = {
          label: widget.text() || widget.desc() || '',
          box: [b.left, b.top, b.right, b.bottom]
        }
      } else if (typeof requestData.x !== 'undefined' && typeof requestData.y !== 'undefined') {
        // 查找点击位置处的控件信息
        try {
          let widgets = boundsContains(requestData.x-1, requestData.y-1, requestData.x+1, requestData.y+1).find()
          widgets = widgets.filter(w => w && w.childCount() === 0 && (w.bounds().width() !== device.width && w.bounds().height() !== device.height))  // 只保留叶子控件
          console.log('click: found widgets at (' + requestData.x + ',' + requestData.y + '):', widgets.length)
          widgets.sort((a, b) => { return a.bounds().width()*a.bounds().height() - b.bounds().width()*b.bounds().height() }) // 按面积从小到大排序，优先选择最小的控件
          widgets.forEach(w => console.log('widget:', w))
          for (let w of widgets) {
            let b = w.bounds()
            widgetInfo = {
              label: w.text() || w.desc() || '',
              box: [b.left, b.top, b.right, b.bottom]
            }
            break
          }
        } catch (e) {printException('click', e)}
        let cr = clickAtPoint(requestData.x, requestData.y, )
        tapped = cr.ok
        tapVia = cr.via
      } else {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: 需要 x,y 坐标或 widgetId'))
        return
      }
      markActivity()
      // 等待Activity切换完成（最多等待2秒）
      let afterActivity = beforeActivity
      for (let i = 0; i < 40; i++) {
        sleep(100)
        let curr = getCurrentActivitySafe()
        if (curr && curr !== beforeActivity) {
          afterActivity = curr
          break
        }
      }
      let code = 'success'
      let message = '点击成功'
      if (!tapped) {
        code = 'error'
        message = '点按未生效：系统未接受该坐标点按，请检查 AutoX 的 RootAutomator/注入权限或开启「USB 调试(安全设置)」（MIUI 会静默丢弃无权限的 input tap）'
      }
      safeSend(conn, wrapResp(requestData, code, message, (r) => {
        r.beforeActivity = beforeActivity
        r.afterActivity = afterActivity
        r.tapped = tapped
        r.tapVia = tapVia
        if (widgetInfo) {
          r.label = widgetInfo.label
          r.box = widgetInfo.box
        }
      }))
    } catch (e) {
      printException('click', e)
      safeSend(conn, wrapResp(requestData, 'error', '点击失败: ' + e.message))
    }
  },

  /**
   * 长按操作
   * 参数: { x, y } 或 { widgetId }，可选 { duration } 长按时长(ms)
   */
  long_press: (conn, requestData) => {
    try {
      let duration = requestData.duration || 1000
      if (requestData.widgetId) {
        let widget = id(requestData.widgetId).findOne(3000)
        if (!widget) {
          safeSend(conn, wrapResp(requestData, 'error', '未找到控件: ' + requestData.widgetId))
          return
        }
        if (duration && duration !== 1000) {
          // 自定义时长：用控件中心坐标模拟长按
          let b = widget.bounds()
          let cx = b.centerX()
          let cy = b.centerY()
          longClick(cx, cy, duration)
        } else {
          widget.longClick()
        }
      } else if (typeof requestData.x !== 'undefined' && typeof requestData.y !== 'undefined') {
        longClick(requestData.x, requestData.y, duration)
      } else {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数'))
        return
      }
      markActivity()
      safeSend(conn, wrapResp(requestData, 'success', '长按成功'))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '长按失败: ' + e))
    }
  },

  /**
   * 滑动操作
   * 参数: { x1, y1, x2, y2, duration(可选，默认300ms) }
   */
  swipe: (conn, requestData) => {
    try {
      let { x1, y1, x2, y2, duration } = requestData
      if (typeof x1 === 'undefined') {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: 需要 x1,y1,x2,y2'))
        return
      }
      swipe(x1, y1, x2, y2, duration || 300)
      markActivity()
      safeSend(conn, wrapResp(requestData, 'success', '滑动成功'))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '滑动失败: ' + e))
    }
  },

  /**
   * 拖拽操作
   * 参数: { x1, y1, x2, y2, duration(可选，默认500ms) }
   */
  drag: (conn, requestData) => {
    try {
      let { x1, y1, x2, y2, duration } = requestData
      if (typeof x1 === 'undefined') {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: 需要 x1,y1,x2,y2'))
        return
      }
      // Auto.js 使用 gesture 实现拖拽
      gesture(duration || 500, [x1, y1], [x2, y2])
      markActivity()
      safeSend(conn, wrapResp(requestData, 'success', '拖拽成功'))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '拖拽失败: ' + e))
    }
  },

  /**
   * 文字输入
   * 参数: { text, widgetId(可选) }
   * 优先通过剪贴板输入解决中文问题
   */
  input: (conn, requestData) => {
    try {
      let { text, widgetId, useClipboard } = requestData
      if (typeof text === 'undefined') {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: text'))
        return
      }
      if (widgetId) {
        let widget = id(widgetId).findOne(3000)
        if (!widget) {
          safeSend(conn, wrapResp(requestData, 'error', '未找到控件: ' + widgetId))
          return
        }
        widget.setText(text)
      } else if (useClipboard) {
        // 通过剪贴板粘贴（解决中文输入问题）
        setClip(text)
        sleep(200)
        paste()
      } else {
        // 直接输入到当前焦点控件
        setText(text)
      }
      safeSend(conn, wrapResp(requestData, 'success', '输入成功'))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '输入失败: ' + e))
    }
  },

  /**
   * 按键操作
   * 参数: { keyCode } 键码 或 { key } 键名
   * 常用键名: back, home, recent, volume_up, volume_down, power, menu, enter
   */
  press_key: (conn, requestData) => {
    try {
      const keyMap = {
        back: 4,
        home: 3,
        recent: 187,
        app_switch: 187,
        volume_up: 24,
        volume_down: 25,
        power: 26,
        menu: 82,
        enter: 66,
        delete: 67,
        search: 84,
        camera: 27,
        tab: 61,
        space: 62
      }
      let key = requestData.key ? ('' + requestData.key).toLowerCase() : null
      let keyCode = requestData.keyCode
      if (!keyCode && key) {
        keyCode = keyMap[key]
      }
      if (!keyCode) {
        safeSend(conn, wrapResp(requestData, 'error', '无效的键名或键码'))
        return
      }
      // AutoX.js 没有 device.pressKey：返回键/主页键用全局 back()/home()，
      // 其余键用全局 KeyCode(code) 模拟；device.pressKey 仅在确实存在时作为兜底。
      if (key === 'back') {
        back()
      } else if (key === 'home') {
        home()
      } else {
        try {
          if (typeof device !== 'undefined' && device && typeof device.pressKey === 'function') {
            device.pressKey(keyCode)
          } else {
            KeyCode(keyCode)
          }
        } catch (err) {
          KeyCode(keyCode)
        }
      }
      markActivity()
      // 等待Activity切换完成（最多等待2秒）
      let beforeActivity = getCurrentActivitySafe()
      let afterActivity = beforeActivity
      for (let i = 0; i < 20; i++) {
        sleep(100)
        let curr = getCurrentActivitySafe()
        if (curr && curr !== beforeActivity) {
          afterActivity = curr
          break
        }
      }
      safeSend(conn, wrapResp(requestData, 'success', '按键成功', (r) => {
        r.beforeActivity = beforeActivity
        r.afterActivity = afterActivity
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '按键失败: ' + e))
    }
  },

  /**
   * 滚动指定控件
   * 参数: { direction: 'up'|'down'|'left'|'right', widgetId(可选), steps(可选) }
   */
  scroll: (conn, requestData) => {
    try {
      let { direction, widgetId, steps } = requestData
      direction = direction || 'down'
      steps = steps || 1
      if (widgetId) {
        let widget = id(widgetId).findOne(3000)
        if (!widget) {
          safeSend(conn, wrapResp(requestData, 'error', '未找到控件: ' + widgetId))
          return
        }
        for (let i = 0; i < steps; i++) {
          if (direction === 'down') widget.scrollForward()
          else if (direction === 'up') widget.scrollBackward()
          else if (direction === 'right') widget.scrollForward()
          else if (direction === 'left') widget.scrollBackward()
        }
      } else {
        // 没有指定控件则滚动屏幕中心区域
        let screenH = device.height
        let screenW = device.width
        let cx = screenW / 2
        for (let i = 0; i < steps; i++) {
          if (direction === 'down') swipe(cx, screenH * 0.7, cx, screenH * 0.3, 300)
          else if (direction === 'up') swipe(cx, screenH * 0.3, cx, screenH * 0.7, 300)
          else if (direction === 'right') swipe(screenW * 0.2, screenH / 2, screenW * 0.8, screenH / 2, 300)
          else if (direction === 'left') swipe(screenW * 0.8, screenH / 2, screenW * 0.2, screenH / 2, 300)
          sleep(100)
        }
      }
      markActivity()
      safeSend(conn, wrapResp(requestData, 'success', '滚动成功'))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '滚动失败: ' + e))
    }
  },

  // ---- N2: 截图增强 ----

  /**
   * 增强截图（支持区域裁剪，可选附带控件树）
   * 参数: {
   *   region: { left, top, right, bottom }(可选),
   *   withWidgets: true(可选，同时返回控件树),
   *   format: 'jpg'|'png'(可选，默认jpg)
   * }
   */
  screenshot: (conn, requestData) => {
    try {
      let screen = captureScreen()
      if (!screen) {
        safeSend(conn, wrapResp(requestData, 'error', '截图失败'))
        return
      }
      let clipped = null
      // 区域裁剪
      if (requestData.region) {
        let { left, top, right, bottom } = requestData.region
        clipped = images.clip(screen, left, top, right - left, bottom - top)
      }
      let img = clipped || screen
      let format = requestData.format || 'jpg'
      let imgBase64 = images.toBase64(img, format)
      let w = img.width
      let h = img.height
      safeSend(conn, wrapResp(requestData, 'success', '截图成功', (r) => {
        r.imgBase64 = imgBase64
        r.width = w
        r.height = h
        r.timestamp = new Date().getTime()
        r.format = format
      }))
      if (clipped) releaseImage(clipped)
      releaseImage(screen)
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '截图失败: ' + e))
    }
  },

  // ---- N3: App 管理 ----

  /**
   * 启动 App
   * 参数: { packageName } 或 { appName }
   */
  launch_app: (conn, requestData) => {
    try {
      let { packageName, appName } = requestData
      if (packageName) {
        app.launch(packageName)
      } else if (appName) {
        let pkg = app.getPackageName(appName)
        if (!pkg) {
          safeSend(conn, wrapResp(requestData, 'error', '未找到应用: ' + appName))
          return
        }
        app.launch(pkg)
      } else {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: packageName 或 appName'))
        return
      }
      safeSend(conn, wrapResp(requestData, 'success', 'App启动成功'))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', 'App启动失败: ' + e))
    }
  },

  /**
   * 停止 App
   * 参数: { packageName }
   */
  stop_app: (conn, requestData) => {
    try {
      let { packageName } = requestData
      if (!packageName) {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: packageName'))
        return
      }
      app.kill(packageName)
      safeSend(conn, wrapResp(requestData, 'success', 'App已停止'))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', 'App停止失败: ' + e))
    }
  },

  /**
   * 获取当前前台 App 信息
   */
  get_current_app: (conn, requestData) => {
    try {
      let pkg = currentPackage()
      let activity = currentActivity()
      safeSend(conn, wrapResp(requestData, 'success', '获取成功', (r) => {
        r.packageName = pkg
        r.activity = activity
        r.appName = app.getAppName(pkg) || pkg
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '获取失败: ' + e))
    }
  },

  /**
   * 获取已安装应用列表
   * 参数: { includeSystem: false(可选，是否包含系统应用) }
   */
  list_apps: (conn, requestData) => {
    try {
      // 通过 pm list packages 获取
      let includeSystem = requestData.includeSystem || false
      let cmd = includeSystem ? 'pm list packages' : 'pm list packages -3'
      let result = shell(cmd, true)
      let packages = result.result.split('\n')
        .filter(line => line.startsWith('package:'))
        .map(line => line.replace('package:', '').trim())
        .filter(p => p.length > 0)
      safeSend(conn, wrapResp(requestData, 'success', '获取成功', (r) => {
        r.apps = packages.map(pkg => ({
          packageName: pkg,
          appName: app.getAppName(pkg) || pkg
        }))
        r.count = packages.length
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '获取应用列表失败: ' + e))
    }
  },

  /**
   * 获取指定 App 信息
   * 参数: { packageName }
   */
  app_info: (conn, requestData) => {
    try {
      let { packageName } = requestData
      if (!packageName) {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: packageName'))
        return
      }
      let info = app.getAppName(packageName)
      safeSend(conn, wrapResp(requestData, 'success', '获取成功', (r) => {
        r.packageName = packageName
        r.appName = info || packageName
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '获取App信息失败: ' + e))
    }
  },

  // ---- N4: 设备状态读取 ----

  /**
   * 获取设备基本信息
   */
  get_device_info: (conn, requestData) => {
    try {
      safeSend(conn, wrapResp(requestData, 'success', '获取成功', (r) => {
        r.brand = device.brand
        r.model = device.model
        r.sdkInt = device.sdkInt
        r.release = device.release
        r.width = device.width
        r.height = device.height
        r.serial = device.serial
        r.imei = device.imei
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '获取设备信息失败: ' + e))
    }
  },

  /**
   * 获取电池信息
   */
  get_battery: (conn, requestData) => {
    try {
      safeSend(conn, wrapResp(requestData, 'success', '获取成功', (r) => {
        r.level = device.battery
        r.isCharging = device.isCharging
        r.voltage = device.voltage
        r.temperature = device.temperature
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '获取电池信息失败: ' + e))
    }
  },

  /**
   * 获取屏幕尺寸
   */
  get_screen_size: (conn, requestData) => {
    try {
      safeSend(conn, wrapResp(requestData, 'success', '获取成功', (r) => {
        r.width = device.width
        r.height = device.height
        r.density = device.screenDensity
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '获取屏幕尺寸失败: ' + e))
    }
  },

  /**
   * 获取屏幕方向
   */
  get_orientation: (conn, requestData) => {
    try {
      safeSend(conn, wrapResp(requestData, 'success', '获取成功', (r) => {
        r.orientation = device.screenOrientation === 0 ? 'portrait' : 'landscape'
        r.value = device.screenOrientation
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '获取方向失败: ' + e))
    }
  },

  // ---- N5: 等待与流程控制 ----

  /**
   * 等待指定控件出现
   * 参数: { widgetId(可选), widgetText(可选), timeout(可选，默认10000ms) }
   */
  wait_for_widget: (conn, requestData) => {
    try {
      let { widgetId, widgetText, timeout } = requestData
      timeout = timeout || 10000
      let widget = null
      if (widgetId) {
        widget = id(widgetId).findOne(timeout)
      } else if (widgetText) {
        widget = text(widgetText).findOne(timeout)
      } else {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: widgetId 或 widgetText'))
        return
      }
      if (widget) {
        safeSend(conn, wrapResp(requestData, 'success', '控件已出现', (r) => {
          r.bounds = widget.bounds()
          r.found = true
        }))
      } else {
        safeSend(conn, wrapResp(requestData, 'timeout', '等待控件超时'))
      }
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '等待控件失败: ' + e))
    }
  },

  /**
   * 等待屏幕上出现指定文字
   * 参数: { text, timeout(可选，默认10000ms), contains(可选，是否模糊匹配) }
   */
  wait_for_text: (conn, requestData) => {
    try {
      let { text: targetText, timeout, contains } = requestData
      timeout = timeout || 10000
      if (!targetText) {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: text'))
        return
      }
      let widget = null
      if (contains) {
        widget = textContains(targetText).findOne(timeout)
      } else {
        widget = text(targetText).findOne(timeout)
      }
      if (widget) {
        safeSend(conn, wrapResp(requestData, 'success', '文字已出现', (r) => {
          r.found = true
          r.bounds = widget.bounds()
        }))
      } else {
        safeSend(conn, wrapResp(requestData, 'timeout', '等待文字超时'))
      }
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '等待文字失败: ' + e))
    }
  },

  /**
   * 等待指定 App 来到前台
   * 参数: { packageName, timeout(可选，默认10000ms) }
   */
  wait_for_app: (conn, requestData) => {
    try {
      let { packageName, timeout } = requestData
      timeout = timeout || 10000
      if (!packageName) {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: packageName'))
        return
      }
      let start = new Date().getTime()
      while (new Date().getTime() - start < timeout) {
        if (currentPackage() === packageName) {
          safeSend(conn, wrapResp(requestData, 'success', 'App已到前台'))
          return
        }
        sleep(300)
      }
      safeSend(conn, wrapResp(requestData, 'timeout', '等待App超时'))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '等待App失败: ' + e))
    }
  },

  // ---- N6: 剪贴板 & 通知 ----

  /**
   * 设置剪贴板内容
   * 参数: { text }
   */
  set_clipboard: (conn, requestData) => {
    try {
      let { text } = requestData
      if (typeof text === 'undefined') {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: text'))
        return
      }
      setClip(text)
      safeSend(conn, wrapResp(requestData, 'success', '剪贴板设置成功'))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '设置剪贴板失败: ' + e))
    }
  },

  /**
   * 读取剪贴板内容
   */
  get_clipboard: (conn, requestData) => {
    try {
      let content = getClip()
      safeSend(conn, wrapResp(requestData, 'success', '获取成功', (r) => {
        r.text = content
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '获取剪贴板失败: ' + e))
    }
  },

  /**
   * 在手机上显示 Toast 消息
   * 参数: { message, duration(可选，'long'|'short'，默认'short') }
   */
  show_toast: (conn, requestData) => {
    try {
      let { message, duration } = requestData
      if (!message) {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: message'))
        return
      }
      if (duration === 'long') {
        toastLog(message)
      } else {
        toast(message)
      }
      safeSend(conn, wrapResp(requestData, 'success', 'Toast显示成功'))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', 'Toast显示失败: ' + e))
    }
  },

  // ---- N7: 防锁屏定时器 ----

  /**
   * 启动防锁屏定时器
   * 说明: 服务启动时已默认开启（无需 AI 再发本指令）。本指令用于重新设置参数或恢复被关闭的定时器。
   *       每隔10秒检查一次，若1分钟内没有点击/滑动等操作，
   *       则从屏幕中间向上滑动50px防止锁屏。
   * 参数: { idleMs?(空闲阈值ms，默认60000), checkMs?(检查间隔ms，默认10000), swipePx?(滑动距离px，默认50) }
   */
  start_keep_awake: (conn, requestData) => {
    try {
      let idleMs = requestData.idleMs || KEEP_AWAKE_IDLE_MS
      let checkMs = requestData.checkMs || KEEP_AWAKE_CHECK_MS
      let swipePx = requestData.swipePx || KEEP_AWAKE_SWIPE_PX

      markActivity()
      startKeepAwakeThread(idleMs, checkMs, swipePx)

      console.log('[防锁屏] 定时器已启动 idleMs=' + idleMs + ' checkMs=' + checkMs + ' swipePx=' + swipePx)
      safeSend(conn, wrapResp(requestData, 'success', '防锁屏定时器已启动', (r) => {
        r.idleMs = idleMs
        r.checkMs = checkMs
        r.swipePx = swipePx
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '启动防锁屏定时器失败: ' + e))
    }
  },

  /**
   * 关闭防锁屏定时器
   * 说明: AI 结束操作的最后一个指令。
   */
  stop_keep_awake: (conn, requestData) => {
    try {
      if (keepAwakeThread !== null) {
        stopKeepAwakeThread()
        console.log('[防锁屏] 定时器已关闭')
        safeSend(conn, wrapResp(requestData, 'success', '防锁屏定时器已关闭'))
      } else {
        safeSend(conn, wrapResp(requestData, 'success', '防锁屏定时器未启动，无需关闭'))
      }
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '关闭防锁屏定时器失败: ' + e))
    }
  },

  /**
   * 打开"使用情况访问权限"设置页
   * 说明: 授权后防锁屏才能读取系统真实空闲时间（避免在你手动用手机时误滑动）。
   *       未授权时自动回退到"距上次远程指令"计时。
   */
  open_usage_settings: (conn, requestData) => {
    try {
      let ok = openUsageAccessSettings()
      if (ok) {
        console.log('[防锁屏] 已打开使用情况访问权限设置页')
        safeSend(conn, wrapResp(requestData, 'success', '已打开设置页，请授予"使用情况访问权限"'))
      } else {
        safeSend(conn, wrapResp(requestData, 'error', '打开设置页失败'))
      }
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '打开设置页失败: ' + e))
    }
  },

  /**
   * 查询当前空闲判定信息（用于调试/验证系统空闲时间是否生效）
   * 返回: { systemIdleMs, source('system'|'ws'), screenOn, lastActivityIdleMs }
   */
  get_idle_info: (conn, requestData) => {
    try {
      let sysIdle = getSystemIdleMs()
      let wsIdle = new Date().getTime() - lastActivityTime
      safeSend(conn, wrapResp(requestData, 'success', '空闲判定信息', (r) => {
        r.systemIdleMs = sysIdle
        r.source = sysIdle >= 0 ? 'system' : 'ws'
        r.screenOn = device.isScreenOn()
        r.lastActivityIdleMs = wsIdle
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '查询失败: ' + e))
    }
  },

  // ---- F2: OCR 文字查找 / 点击（控件树找不到时自动 OCR 兜底）----

  /**
   * 查找屏幕上的文字（控件树优先，匹配不到自动用 OCR 兜底）
   * 参数: {
   *   text: 要找的文字/正则,
   *   contains?(默认false): true 则模糊包含匹配,
   *   region?( [left, top, width, height] 可选，限定识别区域),
   *   useOcr?(默认true): 是否允许 OCR 兜底,
   *   ocrOnly?(默认false): true 则跳过控件树直接走 OCR
   * }
   * 返回: { found, source('widget'|'ocr'), x, y, label, bounds, matches?(ocr 多匹配数组) }
   */
  find_text: (conn, requestData) => {
    try {
      let { text, contains, region, useOcr, ocrOnly } = requestData
      if (!text) {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: text'))
        return
      }
      let findType = ocrOnly ? 2 : (useOcr === false ? 1 : 3)
      showRunnerFloaty()   // 调用 BaseSignRunner2 前显示浮窗
      let widget = getBaseSignRunner().findText(text, region, 1500, 1, findType)
      let match = normalizeMatch(widget)
      if (match) {
        safeSend(conn, wrapResp(requestData, 'success', '找到文字', (r) => { Object.assign(r, match) }))
      } else {
        safeSend(conn, wrapResp(requestData, 'success', '未找到文字', (r) => { r.found = false }))
      }
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '查找文字失败: ' + e))
    }
  },

  /**
   * 批量查找文字结果（控件树 + OCR），返回所有命中的位置。
   * 参数: { text, contains?(默认true), region?([left, top, width, height]), timeout?(默认5000), useOcr?(默认true) }
   * 返回: { count, matches:[{source, text, x, y, box}] }
   */
  find_texts: (conn, requestData) => {
    try {
      let { text, contains, region, timeout, useOcr } = requestData
      if (!text) {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: text'))
        return
      }
      let matches = findTextMatches(text, region, timeout || FIND_TIMEOUT, contains, useOcr)
      safeSend(conn, wrapResp(requestData, 'success', '查找完成', (r) => {
        r.count = matches.length
        r.matches = matches
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '批量查找文字失败: ' + e))
    }
  },

  /**
   * 点击屏幕上的文字（控件树优先，匹配不到自动 OCR 兜底并点击中心）
   * 参数同 find_text
   */
  click_text: (conn, requestData) => {
    try {
      let { text, contains, region, useOcr, ocrOnly } = requestData
      if (!text) {
        safeSend(conn, wrapResp(requestData, 'error', '缺少参数: text'))
        return
      }
      let findType = ocrOnly ? 2 : (useOcr === false ? 1 : 3)
      showRunnerFloaty()   // 调用 BaseSignRunner2 前显示浮窗
      let widget = getBaseSignRunner().clickText(text, 2000, region, true, 1, findType)
      let match = normalizeMatch(widget)
      if (match) {
        safeSend(conn, wrapResp(requestData, 'success', '点击成功', (r) => { Object.assign(r, match) }))
      } else {
        safeSend(conn, wrapResp(requestData, 'success', '未找到可点击的文字', (r) => { r.found = false }))
      }
    } catch (e) {
      commonFunctions.printExceptionStack(e)
      safeSend(conn, wrapResp(requestData, 'error', '点击文字失败: ' + e))
    }
  },

  /**
   * 整屏 OCR 文字识别（返回所有识别到的文字及坐标，用于调试/定位）
   * 参数: { region?([l,t,w,h]), pattern?(正则字符串，默认匹配任意非空文字) }
   * 返回: { count, items:[{ x, y, label, bounds:{left,top,right,bottom,centerX,centerY} }] }
   */
  ocr_dump: (conn, requestData) => {
    try {
      if (!localOcrUtil) {
        safeSend(conn, wrapResp(requestData, 'error', 'OCR 尚未加载或不可用(localOcrUtil 为 null)'))
        return
      }
      let region = requestData.region || null
      let pattern = requestData.pattern ? new RegExp(requestData.pattern) : /.{1,30}/
      let screen = captureScreen()
      if (!screen) {
        safeSend(conn, wrapResp(requestData, 'error', 'OCR 截图失败'))
        return
      }
      try {
        let found = localOcrUtil.recognizeWithBounds(screen, region, pattern)
        let items = (found || []).map(it => {
          let r = ocrBoundsToRect(it.bounds)
          return { x: r.centerX, y: r.centerY, label: it.label, bounds: r }
        })
        // 按 y 升序、再 x 升序排序，便于阅读
        items.sort((a, b) => (a.bounds.top - b.bounds.top) || (a.bounds.left - b.bounds.left))
        safeSend(conn, wrapResp(requestData, 'success', 'OCR 识别完成', (r) => {
          r.count = items.length
          r.items = items
        }))
      } finally {
        releaseImage(screen)
      }
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', 'OCR 识别失败: ' + e))
    }
  },

  /**
   * 智能弹窗处理（参考 BaseSignRunner2.js 的 closeDialogByImage / awaitAndSkip，
   * 但增强为：先识别弹窗类型和内容，再决定处理策略，而非一律关闭）
   *
   * 参数:
   *   { action?: "detect" | "close" | "click_inner" | "click_inner_then_close" }
   *     默认 "detect" — 仅识别不操作
   *   { clickInnerCta?: boolean }  同 action="click_inner_then_close"
   *   { skipPatterns?: string[] }  自定义跳过按钮文字列表(默认 ['允许','跳过','下次再说','我知道了'])
   *
   * 返回(detect):
   *   { type: "success"|"verification"|"skip"|"ad"|"none"|"unknown",
   *     content: string,          // 弹窗内关键文字
   *     ctaButtons: [...],        // 内部可点击CTA按钮 [{x,y,label}]
   *     closeButton?: {...},      // 检测到的关闭按钮
   *     suggestion: string        // 建议操作 }
   */
  handle_popup: (conn, requestData) => {
    try {
      let action = requestData.action || 'detect'

      // --- 1) OCR 扫描整屏文字 ---
      let screen = captureScreen()
      if (!screen) {
        safeSend(conn, wrapResp(requestData, 'error', '截图失败'))
        return
      }
      let allText = []
      try {
        let raw = localOcrUtil.recognizeWithBounds(screen, null, /.{1,30}/)
        if (raw && raw.length) {
          allText = raw.map(it => ({
            label: it.label,
            x: ocrBoundsToRect(it.bounds).centerX,
            y: ocrBoundsToRect(it.bounds).centerY,
            bounds: ocrBoundsToRect(it.bounds)
          }))
        }
      } finally {
        releaseImage(screen)
      }

      // --- 2) 分类弹窗类型 ---
      let fullContent = allText.map(t => t.label).join(' ')
      let popupType = 'none'
      let suggestion = '未检测到弹窗'

      // 成功/结果类
      if (/签到成功|获得\s*\d+\s*京?豆|领取成功|任务完成|恭喜.*获得/.test(fullContent)) {
        popupType = 'success'
        suggestion = '签到/任务已成功完成，记录结果后关闭弹窗继续下一步'
      }
      // 验证类
      else if (/快速验证|安全验证|滑动验证|拼图验证|人机验证/.test(fullContent)) {
        popupType = 'verification'
        suggestion = '按返回键关闭验证弹窗（或人工处理）'
      }
      // 跳过/允许类
      else if (/允许|跳过|下次再说|我知道了|稍后再说|暂不/.test(fullContent)) {
        popupType = 'skip'
        suggestion = '点击跳过/允许/我知道了等按钮'
      }
      // 广告类
      else if (/广告|推广|关注|订阅|立即下载|打开.*APP|查看详情/.test(fullContent)) {
        popupType = 'ad'
        suggestion = '广告弹窗，建议直接关闭'
      }
      // 有弹窗但无法分类
      else if (allText.length > 0 && /弹|窗|提示|通知|提醒|领|签|奖|得/.test(fullContent)) {
        popupType = 'unknown'
        suggestion = '检测到疑似弹窗但无法自动分类，建议人工确认或截图检查'
      }

      // --- 3) 提取内部 CTA 按钮（红色/高亮按钮特征：含"去"/"立即"/"领取"等动作词）---
      let ctaButtons = []
      for (let t of allText) {
        if (/^(去|立即|点击|领取|开始|参与|逛|看看|做|抢|刮|喊)/.test(t.label) ||
            /(签到|领豆|赚|奖励|京豆|抽奖|红包)$/.test(t.label)) {
          ctaButtons.push({ x: t.x, y: t.y, label: t.label, bounds: t.bounds })
        }
      }

      // --- 4) 检测关闭按钮（× / 关闭 / 右下角小图标）---
      let closeButton = null
      for (let t of allText) {
        if (/^[×x✕❌]$|^关闭$/.test(t.label.trim())) {
          closeButton = { x: t.x, y: t.y, label: t.label, bounds: t.bounds }
          break
        }
      }

      let result = {
        type: popupType,
        content: fullContent,
        ctaButtons: ctaButtons,
        closeButton: closeButton,
        suggestion: suggestion
      }

      // --- 5) 根据动作执行操作 ---
      if (action === 'close' || action === 'click_inner' || action === 'click_inner_then_close') {
        // 先点内部 CTA（如果有）
        if ((action === 'click_inner' || action === 'click_inner_then_close') && ctaButtons.length > 0) {
          let btn = ctaButtons[0]
          click(btn.x, btn.y)
          sleep(1500)
          result.actionTaken = 'clicked_cta: ' + btn.label
        }
        // 关闭弹窗（优先级：skip/关闭文字键 → × 关闭 → back 键）
        let closed = false
        if (!closed) {
          // 策略 A：找跳过/允许类按钮
          let skips = requestData.skipPatterns || ['允许', '跳过', '下次再说', '我知道了']
          for (let sp of skips) {
            for (let t of allText) {
              if (t.label.indexOf(sp) !== -1) {
                click(t.x, t.y)
                closed = true
                result.closeMethod = 'clicked: ' + t.label
                break
              }
            }
            if (closed) break
          }
        }
        if (!closed && closeButton) {
          click(closeButton.x, closeButton.y)
          closed = true
          result.closeMethod = 'clicked_close: ' + closeButton.label
        }
        if (!closed) {
          back()
          closed = true
          result.closeMethod = 'press_back'
        }
        result.closed = closed
      }

      safeSend(conn, wrapResp(requestData, 'success', '弹窗处理完成', (r) => Object.assign(r, result)))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '弹窗处理失败: ' + e))
    }
  },

  // ============================================================
  // YOLO 检测支持（直接复用 core/BaseSignRunner2 的 yoloCheck / yoloCheckAll）
  // ============================================================

  /**
   * YOLO 目标检测（关闭按钮 / 自定义标签）。
   * 直接调用 getBaseSignRunner().yoloCheckAll(desc, {labelRegex}) —— 即 BaseSignRunner2 内部实现：
   *   内部 commonFunctions.captureScreen() + YoloDetection.forward(img, filter)（机端模型），
   *   最多重试 5 次，返回 {x:centerX, y:centerY, width, height, left, top, label}[]。
   * 另始终回传截图 base64，供 PC 侧(phone.py / yolo_infer.py)在机端未检出时兜底推理。
   * 参数:
   *   { labelRegex?: string }  标签正则（默认 'close_icon'）
   * 返回:
   *   { imgBase64, width, height, boxes:[{class,name,conf,x,y,width,height,cx,cy,w,h}],
   *     source: 'ondevice'|'screenshot_only', note, timestamp }
   */
  yolo_detect: (conn, requestData) => {
    try {
      let labelRegex = requestData.labelRegex || 'close_icon'
      showRunnerFloaty()   // 调用 BaseSignRunner2 前显示浮窗
      let runner = getBaseSignRunner()
      // 直接复用 BaseSignRunner2.yoloCheckAll（含截图重试 + YoloDetection.forward）
      let results = runner.yoloCheckAll('YOLO检测', { labelRegex: labelRegex })
      // 单独截一张用于回传/绘制（yoloCheckAll 内部截图不回传）
      let shot = captureScreen()
      let imgBase64 = shot ? images.toBase64(shot, 'jpg') : ''
      if (shot) releaseImage(shot)
      let W = shot ? shot.width : 1080
      let H = shot ? shot.height : 2400
      let boxes = []
      if (results && results.length > 0) {
        for (let n of results) {
          // n: {x:centerX, y:centerY, width, height, left, top, label}
          boxes.push({
            class: 0,
            name: n.label || 'close_icon',
            conf: 1,
            x: n.left, y: n.top, width: n.width, height: n.height,
            cx: n.x / W, cy: n.y / H,
            w: n.width / W, h: n.height / H
          })
        }
      }
      safeSend(conn, wrapResp(requestData, 'success', 'YOLO检测完成', (r) => {
        r.imgBase64 = imgBase64
        r.width = W
        r.height = H
        r.boxes = boxes
        r.source = boxes.length > 0 ? 'ondevice' : 'screenshot_only'
        r.note = boxes.length > 0 ? '' : '机端 yoloCheckAll 未检出'
        r.timestamp = new Date().getTime()
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', 'YOLO检测失败: ' + e))
    }
  },

  /**
   * YOLO 检测并（可选）点击最高置信度目标（默认关闭按钮）。
   * 直接调用 getBaseSignRunner().yoloCheck(desc, {labelRegex}, click) —— 即 BaseSignRunner2 内部实现：
   *   第 3 参数 click 由客户端控制（requestData.click，默认 true）：
   *     true  → 内部 automator.click(中心坐标) + sleep(1000)，返回点中的节点
   *     false → 仅检测返回节点，不点击（等价于 yolo_detect 但走 yoloCheck 单目标路径）
   */
  yolo_click: (conn, requestData) => {
    try {
      let labelRegex = requestData.labelRegex || 'close_icon'
      // 第3参数默认 true（保持原行为），可由客户端 requestData.click 覆盖
      let click = requestData.click === undefined ? true : !!requestData.click
      showRunnerFloaty()   // 调用 BaseSignRunner2 前显示浮窗
      let runner = getBaseSignRunner()
      // 直接复用 BaseSignRunner2.yoloCheck(..., click)：click 由客户端控制
      let node = runner.yoloCheck('YOLO点击', { labelRegex: labelRegex }, click)
      let shot = captureScreen()
      let imgBase64 = shot ? images.toBase64(shot, 'jpg') : ''
      if (shot) releaseImage(shot)
      let W = shot ? shot.width : 1080
      let H = shot ? shot.height : 2400
      if (!node) {
        safeSend(conn, wrapResp(requestData, 'success', '机端未检出，已回传截图供PC推断',
          (r) => {
            r.imgBase64 = imgBase64; r.width = W; r.height = H
            r.boxes = []; r.source = 'screenshot_only'; r.timestamp = new Date().getTime()
          }))
        return
      }
      // node: {x:centerX, y:centerY, width, height, left, top, label}
      let b = {
        class: 0, name: node.label || 'close_icon', conf: 1,
        x: node.left, y: node.top, width: node.width, height: node.height,
        cx: node.x / W, cy: node.y / H, w: node.width / W, h: node.height / H
      }
      safeSend(conn, wrapResp(requestData, 'success', click ? '已点击YOLO目标' : 'YOLO检测完成(未点击)', (r) => {
        r.imgBase64 = imgBase64; r.width = W; r.height = H
        r.boxes = [b]; r.source = 'ondevice'
        r.clicked = click ? { x: Math.round(node.x), y: Math.round(node.y), name: node.label, conf: 1 } : null
        r.timestamp = new Date().getTime()
      }))
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', 'YOLO点击失败: ' + e))
    }
  }
}

// ============================================================
// 请求处理
// ============================================================
function handleRequest (conn, message) {
  try {
    let requestData = JSON.parse(message)
    let handler = requestDispatcher[requestData.type]
    if (handler) {
      handler(conn, requestData, message)
    } else {
      console.log('当前操作类型未定义：', requestData.type)
      safeSend(conn, wrapResp(requestData, 'error', '当前操作类型未定义：' + requestData.type))
    }
  } catch (e) {
    printException('handleRequest', e)
    safeSend(conn, wrapResp({}, 'error', '执行异常: ' + e.message))
  }
}

// ============================================================
// 控件树构建（保留原有逻辑）
// ============================================================
function buildWidgetResult (requestData) {
  if (auto.clearCache) {
    auto.clearCache()
  }
  let countDown = new CountDownLatch(2)
  let resultObj = {}
  let widgetResult = []
  threads.start(function () {
    let widgetStart = new Date().getTime()
    widgetResult = requestWidgetInfos()
    resultObj.widgetCost = new Date().getTime() - widgetStart
    countDown.countDown()
  })
  threads.start(function () {
    let screen = null
    let captureStart = new Date().getTime()
    if (requestData.takeScreenshotByA11y && automator.takeScreenshot) {
      screen = automator.takeScreenshot()
    } else {
      screen = captureScreen()
    }
    let captureCost = new Date().getTime() - captureStart
    if (screen) {
      let imgBase64 = images.toBase64(screen, 'jpg')
      resultObj.imgBase64 = imgBase64
      resultObj.captureCost = captureCost
      resultObj.width = screen.width
      resultObj.height = screen.height
      resultObj.convertCost = new Date().getTime() - captureStart - captureCost
      releaseImage(screen)
    }
    countDown.countDown()
  })
  countDown.await()
  if (widgetResult[0]) {
    return Object.assign(resultObj, {
      code: 'success',
      msg: '获取控件信息成功',
      widgetInfo: widgetResult[1],
    })
  } else {
    return Object.assign(resultObj, {
      code: 'error',
      msg: widgetResult[1],
    })
  }
}

let maxDepth = -1
function requestWidgetInfos () {
  maxDepth = -1
  let treeNodeBuilder = null
  let supportOld = false
  try {
    treeNodeBuilder = new UiObjectTreeBuilder(runtime.getAccessibilityBridge())
    supportOld = true
  } catch (e) {
    treeNodeBuilder = new UiObjectTreeBuilder(null)
  }

  function buildTreeNode () {
    if (supportOld) {
      return treeNodeBuilder.buildTreeNode()
    } else {
      return treeNodeBuilder.buildTreeNode(runtime.accessibilityBridge.windowRoots())
    }
  }

  let start = new Date()
  let nodeList = buildTreeNode()
  if (nodeList.size() <= 0) {
    toastLog('获取根节点失败')
    return [false, '获取根节点失败']
  }
  let root = nodeList.get(0)
  if (root) {
    // 直接构建树形结构，一次遍历完成
    let treeRoot = buildTreeNodeRecursive(root, 0, 0)
    let packageName = null
    let content = JSON.stringify(treeRoot, (key, value) => {
      if (typeof value === 'undefined' || value === false) return undefined
      if (key == 'packageName') {
        if (packageName) return undefined
        else packageName = value
      }
      if (key == 'boundsInfo') {
        value = { left: value.left, top: value.top, right: value.right, bottom: value.bottom }
      }
      return value
    })
    return [true, content]
  } else {
    return [false, '获取根节点数据失败']
  }
}

// 直接构建带 children 属性的树形结构（一次遍历，无二次转换）
function buildTreeNodeRecursive (root, depth, index) {
  if (root.root == null) return null
  let node = new UiObjectInfo(root.root, depth, index)
  let childList = root.getChildList()
  if (childList.size() > 0) {
    node.children = []
    let childArray = toArray(childList)
    for (let i = 0; i < childArray.length; i++) {
      let child = buildTreeNodeRecursive(childArray[i], depth + 1, i)
      if (child) node.children.push(child)
    }
  }
  return node
}

function UiObjectInfo (uiObject, depth, index) {
  this.content = uiObject.text() || uiObject.desc() || ''
  this.isDesc = typeof uiObject.desc() !== 'undefined' && uiObject.desc() !== '' && uiObject.desc() != null
  this.id = uiObject.id()
  this.boundsInfo = uiObject.bounds()
  this.depth = depth
  this.index = index
  this.indexInParent = uiObject.indexInParent()
  this.visible = uiObject.visibleToUser()
  this.visibleToUser = uiObject.visibleToUser()
  this.clickable = uiObject.clickable()
  this.drawingOrder = uiObject.drawingOrder()
  this.className = uiObject.className()
  this.packageName = uiObject.packageName()
  this.mDepth = uiObject.depth()
  this.checkable = uiObject.checkable()
  this.checked = uiObject.checked()
  this.focusable = uiObject.focusable()
  this.focused = uiObject.focused()
  this.accessibilityFocused = uiObject.accessibilityFocused()
  this.selected = uiObject.selected()
  this.longClickable = uiObject.longClickable()
  this.enabled = uiObject.enabled()
  this.password = uiObject.password()
  this.scrollable = uiObject.scrollable()
  this.row = uiObject.row()
  this.column = uiObject.column()
  this.rowSpan = uiObject.rowSpan()
  this.columnSpan = uiObject.columnSpan()
  this.rowCount = uiObject.rowCount()
  this.columnCount = uiObject.columnCount()
  this.desc = uiObject.desc()
  this.text = uiObject.text()
  this.isEmpty = function (v) { return typeof v === 'undefined' || v === null || v === '' }
  this.hasUsableInfo = function () { return !(this.isEmpty(this.content) && this.isEmpty(this.id)) }
}

// ============================================================
// 工具函数
// ============================================================

function getIpAddress () {
  try {
    importClass(java.net.InetAddress)
    importClass(java.net.NetworkInterface)
    importClass(java.util.Enumeration)
    let networkInterfaces = NetworkInterface.getNetworkInterfaces()
    let ipAddresses = []
    while (networkInterfaces.hasMoreElements()) {
      let networkInterface = networkInterfaces.nextElement()
      let inetAddresses = networkInterface.getInetAddresses()
      while (inetAddresses.hasMoreElements()) {
        let inetAddress = inetAddresses.nextElement()
        if (!inetAddress.isLoopbackAddress() && inetAddress.isSiteLocalAddress()) {
          ipAddresses.push(inetAddress.getHostAddress())
        }
      }
    }
    return ipAddresses
  } catch (e) {
    console.error(e)
  }
}

function toArray (javaList) {
  const array = []
  for (let i = 0; i < javaList.size(); i++) {
    array.push(javaList.get(i))
  }
  return array
}

// 统一 OCR 识别入口：返回 [{ bounds, label }]，bounds 为原始对象（交给 ocrBoundsToRect 归一化）
// 安全释放 Image 并主动触发 GC。
// 背景: 反复调用 captureScreen / OCR(mlkit) 时，引擎会持续分配内存，
// 若仅 recycle 而 GC 不及时，Dalvik 堆会被吃满导致 OutOfMemoryError(见 2026-07-12 服务 OOM 日志)。
// 这里在 recycle 后强制 System.gc()，缓解累积压力。
function releaseImage (img) {
  if (img) { try { img.recycle() } catch (e) {} }
  try { java.lang.System.gc() } catch (e) {}
}

function doOcr (screen, region, text) {
  let raw = []
  if (localOcrUtil) {
    let found = localOcrUtil.recognizeWithBounds(screen, region || null, text)
    if (found && found.length) {
      raw = found.map(it => ({ bounds: it.bounds, label: it.label }))
    }
  }
  return raw
}

// 将 OCR 返回的 bounds（可能带 left/right/top/bottom 或 centerX()/centerY()）统一成矩形
function ocrBoundsToRect (b) {
  let left, top, right, bottom
  if (b && typeof b.left === 'number') {
    left = b.left; top = b.top; right = b.right; bottom = b.bottom
  } else if (b && typeof b.centerX === 'function') {
    let cx = b.centerX(), cy = b.centerY()
    let w = (b.width && typeof b.width === 'function') ? b.width() : 0
    let h = (b.height && typeof b.height === 'function') ? b.height() : 0
    left = cx - w / 2; top = cy - h / 2; right = cx + w / 2; bottom = cy + h / 2
  } else {
    return { left: 0, top: 0, right: 0, bottom: 0, centerX: 0, centerY: 0 }
  }
  return { left, top, right, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 }
}

// ============================================================
// 文件管理（F1）辅助函数
// ============================================================

// 路径解析：绝对路径直接使用；相对路径解析到脚本根目录
function resolvePath (p) {
  if (!p) return FILE_ROOT
  if (p.startsWith('/') || p.startsWith('file://')) {
    return p.replace(/^file:\/\//, '')
  }
  return files.join(FILE_ROOT, p)
}

// 确保目标文件的父目录存在（不存在则创建）
function ensureParentDir (filePath) {
  let parent = new java.io.File(filePath).getParent()
  if (parent && !files.exists(parent)) {
    if (!files.ensureDir(parent + '/')) {
      throw new Error('无法创建父目录: ' + parent)
    }
  }
  return filePath
}

// 读取文件并以 base64 返回（带大小保护）
function readFileBase64 (filePath) {
  let bytes = files.readBytes(filePath)
  if (bytes.length > FILE_MAX_BYTES) {
    throw new Error('文件过大(' + bytes.length + '字节)，超过上限 ' + FILE_MAX_BYTES)
  }
  return Base64.encodeToString(bytes, Base64.DEFAULT)
}

// 将 base64 内容写入文件（自动建目录，overwrite 控制是否覆盖）
function writeFileBase64 (filePath, base64Content, overwrite) {
  if (files.exists(filePath) && !overwrite) {
    throw new Error('文件已存在，且 overwrite=false: ' + filePath)
  }
  ensureParentDir(filePath)
  let bytes = Base64.decode(base64Content, Base64.DEFAULT)
  files.writeBytes(filePath, bytes)
  return filePath
}

// 单个文件/目录的元信息
function fileMeta (p) {
  let f = new java.io.File(p)
  return {
    name: f.getName(),
    path: p,
    isDir: files.isDir(p),
    size: f.length(),
    lastModified: f.lastModified(),
    readable: f.canRead(),
    writable: f.canWrite(),
    hidden: f.isHidden()
  }
}

// ==================== 文件分片流式传输（内置于 file_download / file_upload）====================
// 单消息整文件下载（兼容旧客户端 / 诊断用）：base64 整文件，单帧返回。受 FILE_MAX_BYTES(15MB) 保护。
function sendSingleFrame (conn, requestData, target) {
  try {
    let f = new java.io.File(target)
    let size = f.length()
    let lastModified = f.lastModified()
    let b64 = readFileBase64(target)
    safeSend(conn, {
      type: 'file_single',
      callbackId: requestData.callbackId,
      reqId: requestData.reqId,
      code: 'success',
      message: '下载成功',
      path: target,
      size: size,
      lastModified: lastModified,
      encoding: 'base64',
      content: b64
    })
    console.log('[sendSingleFrame] 完成: ' + target + ' size=' + size)
  } catch (e) {
    printException('file_download(single)', e)
    safeSend(conn, wrapResp(requestData, 'error', '下载失败: ' + e.message))
  }
}

// 分片下载(file_download 默认路径)：逐块读文件并以 { type:'file_chunk', callbackId, reqId, seq, size, received, lastModified, content(base64), done } 推送。
//   客户端按 callbackId(phone.py) 或 reqId(phone_control.html) 累积 content，done:true 时拼接 base64 解码即原文件字节（UTF-8 安全）。
//   带详细日志：开始/进度(每50片)/完成/异常，便于通过非流式下载 autojs-log4j.txt 定位挂起点。
function streamDownload (conn, target, cbId, reqId, chunkSize) {
  let fis = null
  let seq = 0
  let received = 0
  let sentChunks = 0
  try {
    let f = new java.io.File(target)
    let size = f.length()
    let lastModified = new java.io.File(target).lastModified()
    console.log('[streamDownload] 开始: ' + target + ' size=' + size + ' chunkSize=' + chunkSize)
    fis = new java.io.FileInputStream(f)
    let buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, chunkSize)
    let read
    while ((read = fis.read(buf)) !== -1) {
      let b64 = Base64.encodeToString(buf, 0, read, Base64.DEFAULT)
      received += read
      seq++
      safeSend(conn, {
        type: 'file_chunk',
        callbackId: cbId,
        reqId: reqId,
        seq: seq,
        size: size,
        received: received,
        lastModified: lastModified,
        content: b64,
        done: false
      })
      sentChunks++
      if (seq % 50 === 0) {
        console.log('[streamDownload] 进度 seq=' + seq + ' received=' + received + '/' + size)
      }
    }
    safeSend(conn, {
      type: 'file_chunk',
      callbackId: cbId,
      reqId: reqId,
      seq: seq,
      size: size,
      received: received,
      lastModified: lastModified,
      content: '',
      done: true
    })
    console.log('[streamDownload] 完成: ' + target + ' chunks=' + sentChunks + ' received=' + received)
  } catch (e) {
    printException('file_download(stream)', e)
    console.log('[streamDownload] 异常 seq=' + seq + ' sentChunks=' + sentChunks + ' received=' + received + ': ' + e.message)
    safeSend(conn, {
      type: 'file_chunk',
      callbackId: cbId,
      reqId: reqId,
      seq: 0, size: 0, received: 0, content: '', done: true,
      error: '流式下载失败: ' + e.message
    })
    // 仅在尚未发送任何分片时抛出，让 file_download 回退到单消息；已发分片则客户端会收到错误帧
    if (sentChunks === 0) throw e
  } finally {
    if (fis) { try { fis.close() } catch (e) {} }
  }
}

// 分片上传缓冲：reqId -> { finalPath, overwrite, b64 }
let _uploadChunkBuf = {}

// 分片上传：按 reqId 逐片解码并流式追加写盘（内存恒定在单分片大小，避免整文件 base64 驻留导致 OOM）
// 关键：base64 必须按 4 字符组解码，故用 pending 缓冲只解码完整组，余下留到 done 时解码；
// 总 base64 长度必为 4 的倍数（b64encode 自带 padding），故 done 时 pending 也必 4 对齐，可安全解码。
function handleUploadChunk (conn, requestData) {
  let { reqId, seq, content, done, path, fileName, overwrite } = requestData
  if (!reqId) {
    safeSend(conn, wrapResp(requestData, 'error', '分片上传缺少 reqId'))
    return
  }
  let buf = _uploadChunkBuf[reqId]
  if (!buf) {
    if (seq !== 0) {
      safeSend(conn, wrapResp(requestData, 'error', '分片序号错乱: 期望从 seq=0 起始'))
      return
    }
    if (!path && !fileName) {
      safeSend(conn, wrapResp(requestData, 'error', '缺少参数: path 或 fileName'))
      return
    }
    let finalPath = resolvePath(fileName && !path ? fileName : path)
    if (files.exists(finalPath) && !overwrite) {
      safeSend(conn, wrapResp(requestData, 'error', '文件已存在，且 overwrite=false: ' + finalPath))
      return
    }
    ensureParentDir(finalPath)
    try {
      buf = {
        finalPath: finalPath,
        overwrite: !!overwrite,
        fos: new java.io.FileOutputStream(finalPath, false),
        pending: '',
        size: 0
      }
      _uploadChunkBuf[reqId] = buf
    } catch (e) {
      safeSend(conn, wrapResp(requestData, 'error', '无法创建输出流: ' + e.message))
      return
    }
  }
  if (content) {
    try {
      buf.pending += content
      let usable = buf.pending.length - (buf.pending.length % 4)   // 仅解码完整的 4 字符组
      if (usable > 0) {
        let decodable = buf.pending.substring(0, usable)
        buf.pending = buf.pending.substring(usable)
        let bytes = Base64.decode(decodable, Base64.DEFAULT)
        buf.fos.write(bytes)
        buf.size += bytes.length
        if (seq % 50 === 0) buf.fos.flush()   // 周期性 flush，降低进程崩溃丢数据风险
      }
    } catch (e) {
      try { buf.fos.close() } catch (_) {}
      try { files.remove(buf.finalPath) } catch (_) {}
      delete _uploadChunkBuf[reqId]
      safeSend(conn, wrapResp(requestData, 'error', '分片解码/写盘失败: ' + e.message))
      return
    }
  }
  if (done) {
    try {
      if (buf.pending.length > 0) {
        let bytes = Base64.decode(buf.pending, Base64.DEFAULT)
        buf.fos.write(bytes)
        buf.size += bytes.length
      }
      buf.fos.flush(); buf.fos.close()
    } catch (e) {
      try { buf.fos.close() } catch (_) {}
      try { files.remove(buf.finalPath) } catch (_) {}
      delete _uploadChunkBuf[reqId]
      safeSend(conn, wrapResp(requestData, 'error', '末片解码/写盘失败: ' + e.message))
      return
    }
    delete _uploadChunkBuf[reqId]
    finalizeUpload(conn, requestData, buf.finalPath, buf.size, buf.overwrite)
  }
}

// 统一收尾：写盘 + 回包；若上传的是本服务脚本自身则触发自更新重启（put -f 工作流）
// content: base64 字符串（单消息模式，需解码写盘）或 数字（分片流式模式，已是字节数，文件已落盘）
function finalizeUpload (conn, requestData, finalPath, content, overwrite) {
  let written, size
  if (typeof content === 'number') {
    written = finalPath
    size = content
  } else {
    written = writeFileBase64(finalPath, content, overwrite)
    size = new java.io.File(written).length()
  }
  // 先发成功回包（含 {code:'success'}），确保客户端收到后再重启
  safeSend(conn, wrapResp(requestData, 'success', '上传成功', (r) => {
    r.path = written
    r.size = size
  }))
  console.log('[finalizeUpload] 已写入: ' + written + ' size=' + size)
  // 自更新重启判定：用规范路径比较，消除 /sdcard 与 /storage/emulated/0 符号链接导致的字符串不一致
  let src = engines.myEngine().getSource().toString()
  let selfMatch = false
  try {
    selfMatch = new java.io.File(written).getCanonicalPath() === new java.io.File(src).getCanonicalPath()
  } catch (e) { selfMatch = (written === src) }
  if (selfMatch) {
    console.log('[finalizeUpload] 自更新重启: ' + written)
    // 主线程延迟 500ms（让回包在网络层发送完成）后再退出并由 Auto.js 重新拉起；
    // 用主线程 exit()（与旧版一致，已验证可被 setUpAutoStart 的定时任务重新拉起），避免子线程 exit 行为不确定
    sleep(500)
    runningQueueDispatcher.setUpAutoStart(written, 2)
    exit()
  }
}

// 递归收集目录内容（非递归时仅当前层）
function collectDir (dir, out, recursive) {
  let list = files.listDir(dir)
  for (let i = 0; i < list.length; i++) {
    let name = list[i]
    let full = files.join(dir, name)
    let meta = fileMeta(full)
    out.push(meta)
    if (recursive && meta.isDir) {
      collectDir(full, out, true)
    }
  }
}
