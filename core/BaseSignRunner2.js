let { config } = require('../config.js')(runtime, this)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, this)
let commonFunctions = singletonRequire('CommonFunction')
let WidgetUtils = singletonRequire('WidgetUtils')
let FloatyInstance = singletonRequire('FloatyUtil')
let runningQueueDispatcher = singletonRequire('RunningQueueDispatcher')
let automator = singletonRequire('Automator')
let logUtils = singletonRequire('LogUtils')
let signTaskService = singletonRequire('SignTaskService')
let OpenCvUtil = require('../lib/OpenCvUtil.js')
let formatDate = require('../lib/DateUtil.js')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let storageFactory = singletonRequire('StorageFactory')
let logFloaty = singletonRequire('LogFloaty')
let BaseSignRunner = require('./BaseSignRunner.js')
let WarningFloaty = singletonRequire('WarningFloaty')
let YoloTrainHelper = singletonRequire('YoloTrainHelper')
let YoloDetection = singletonRequire('YoloDetectionUtil')

function BaseSignRunner2 () {
  BaseSignRunner.call(this);
  this.restartLimit = 3

  this.getFloatyInstance = function () {
    return FloatyInstance
  }

  /**
   * 统一控制所有浮窗的显示/隐藏（一次性清屏，调试/截图/暂停任务时用）。
   * 覆盖三类浮窗：
   *   - 主状态浮窗 FloatyInstance（hide/restore）
   *   - 日志浮窗 logFloaty（hide/show）
   *   - 矩形提示浮窗 WarningFloaty（清空所有已绘制矩形 → canvas 空 → 窗口移出屏幕）
   * @param {boolean} visible true=显示 false=隐藏
   */
  this.setAllFloatyVisible = function (visible) {
    if (visible) {
      try { FloatyInstance.restore() } catch (e) {}
      try { logFloaty.show() } catch (e) {}
      try { WarningFloaty.enableTip() } catch (e) {}
    } else {
      try { FloatyInstance.hide() } catch (e) {}
      try { logFloaty.hide() } catch (e) {}
      try {
        // WarningFloaty.clearAll(clearType) 按 drawType 删除匹配项；删除「非 clearType」之外的项，故需枚举当前所有在用的 drawType：
        //   undefined          → yoloCheckAll 命中时直接 addRectangle 未传 drawType 的矩形
        //   'abc'              → 本类 addRectangle 包装器（line 668）传入的矩形
        //   'yolo'             → 若后续 yoloCheckAll 改为传 drawType='yolo'
        // 注：WarningFloaty 无「清空全部」公共方法，drawType 新增时需在此补充。
        WarningFloaty.clearAll()        // 删除 drawType===undefined 的矩形（yolo 矩形）
        WarningFloaty.clearAll('abc')   // 删除 drawType==='abc' 的矩形
        WarningFloaty.clearAll('yolo')  // 预留：drawType==='yolo' 的矩形
      } catch (e) {
        logUtils.errorInfo('setAllFloatyVisible 清理 WarningFloaty 异常：' + e)
      }
    }
    return visible
  }

  /**
   * 等待跳过按钮并点击
   */
  this.awaitAndSkip = function (checkingList, useBack) {
    let skip = null
    checkingList = checkingList || ['\\s*允许\\s*', '\\s*跳过\\s*', '\\s*下次再说\\s*']
    checkingList.forEach(checkContent => {
      FloatyInstance.setFloatyText('准备查找是否存在' + checkContent)
      skip = WidgetUtils.widgetGetOne(checkContent, 2000)
      if (skip !== null) {
        if (useBack) {
          automator.back()
        } else {
          automator.clickCenter(skip)
        }
        sleep(1000)
      }
    })
    return skip
  }

  this.getMainTask = function (name) {
    name = name || this.name
    return config.supported_signs.find(task => task.name === name)
  }

  this.getPackage = function () {
    return ''
  }
  this.getDialogText = function () {
    return ''
  }
  this.getTimeout = function () {
    // 2026-07-17 优化：原固定 3000ms，被全脚本所有 findText/clickText 与返回等待共用。
    //   在快速真机上偏保守——单次「找不到」就空等 3s，整个运行累计（如 756 次「继续浏览」信号、
    //   273 次任务返回）被大量吃掉。降到 2000ms 在不影响正常元素渲染（原生 UI 通常 <1s 出现，
    //   WebView 浏览按钮在 taskSleep 之后才查找，此时已加载完）的前提下，整体提速约 1/3。
    //   若上传后发现个别任务被「漏点/跳过」（即 findText 偶发 miss 导致任务没点到就被当完成），
    //   把此处改回 3000 即可恢复，不影响其它逻辑。
    return 2000
  }
  this.clickText = function (text, timeout, region, clickIt, loopCnt, findType) {
    clickIt = clickIt===undefined?true:clickIt
    findType = findType || 3
    // region = region || [0,0, device.width, device.height]
    let appendFilter = null
    if (region && region.constructor === Array) {
      appendFilter = (matcher) => {
        return matcher.boundsInside(region[0], region[1], region[0]+region[2], region[1]+region[3])
      }
      this.addRectangle(text, region)
    }
    let element = null
    if ((findType&1) !== 0) {
      element = WidgetUtils.widgetGetOne(text, timeout, null, null, appendFilter)
      if (element) {
        clickIt?this.displayButtonAndClick(element, text):0
        return element
      }
    }
    if ((findType&2) !== 0) {
      this.pushLog("ocr点 "+text)
      element = this.captureAndCheckByOcr(text, text, region, null, clickIt, loopCnt||1)
    }
    return element
  }

  this.showRegion = function(text, region, matcher) {
    if (region && region.constructor === Array) {
      this.addRectangle(text, region)
      if (matcher) {
        return matcher.boundsInside(region[0], region[1], region[0]+region[2], region[1]+region[3])
      }
    }
    return matcher
  }

  this.findText = function(text, region, timeout, loopCnt, findType) {
    timeout = timeout || 1000
    findType = findType || 3
    // region = region || [0,0, device.width, device.height]
    let appendFilter = null
    if (region && region.constructor === Array) {
      appendFilter = (matcher) => {
        return matcher.boundsInside(region[0], region[1], region[0]+region[2], region[1]+region[3])
      }
      this.addRectangle(text, region)
    }
    let element = null
    if ((findType&1) !== 0) {
      this.pushLog("text找 "+text)
      element = WidgetUtils.widgetGetOne(text, timeout, null, null, appendFilter)
      if (element) {
        this.pushLog(`找到 ${text} at:${element.bounds()}`)
        return element
      }
    }
    if ((findType&2) !== 0) {
      this.pushLog("ocr找 "+text)
      return this.captureAndCheckByOcr(text, text, region, null, false, loopCnt||1)
    }
    return null
  }
  this.findObject = function (obj, relation) {
    relation = relation||'or'
    logUtils.debugInfo(['查找目标：{} {}', relation, JSON.stringify(obj)])
    let findCount = 0
    let lst = Object.keys(obj)
    for (let index=0;index<lst.length;++index ) {
      let key = lst[index]
      let value = obj[key]
      if (value.constructor === Object) {
        let count = this.findObject(value, key)
        if (key === 'and' && count === Object.keys(value).length) {
          findCount++
        }
        if (key === 'or' && count > 0) {
          findCount++
        }
      } else if (value.constructor === Array) {
        if (this.findText(key, value, this.getTimeout())) {
          findCount++
        }
      }
      logUtils.debugInfo(['查找结果：{} {}', key, findCount])
      if (relation === 'and' && findCount !== (index+1)) {
        break
      }
      if (relation === 'or' && findCount > 0) {
        break
      }
    }
    return findCount
  }
  this.getTitle = function () {
    let ele = idContains('fb').findOnce()
    if (!ele) {
        ele = WidgetUtils.widgetGetOne('返回', 2000)
        for (let i=0;i<2&&ele;++i) {
          ele = ele.parent()
        }
    }
    let a = 16
    let b = 65
    let c = 1064
    let d = 202
    if (ele) {
        a = ele.bounds().left
        b = ele.bounds().top
        c = ele.bounds().right
        d = ele.bounds().bottom
        a = a>0?a-1:0
        b = b>0?b-1:0
        c = c<device.width?c+1:c
        d = d<device.height?d+1:d
    }
    let lst = textMatches(/.*/).boundsInside(a,b, c,d).find()
    let txt = ''
    if (!lst || lst.length === 0) lst = descMatches(/.*/).boundsInside(a,b, c,d).find()
    lst.forEach(element => {
        if (txt) {
            txt += '/'
        }
        txt += element.text()
    });
    txt = txt || this.captureAndGetOcrText('title', [0, device.height*0.4, device.width, device.height*0.2])
    logUtils.debugInfo(['getTitle {}, {}', txt, currentActivity()])
    return txt
  }
  // 2026-07-17 优化：dismissAnr 在 backTo/goBack/主循环高频调用，每次都做 4 次查找(text+ocr × 2关键词 ≈4s)，
  //   而 backTo 在任务循环里每个任务完成都调一次，数百次调用累积十几分钟纯空耗（且绝大多数时候根本无 ANR 弹窗）。
  //   加 20s 降频：ANR 弹窗不会在 20s 内反复弹出，距上次实际检测不足 20s 直接跳过，省下绝大部分空耗。
  let _lastAnrCheck = 0
  this.dismissAnr = function () {
    // 京东长时间浏览/卡顿会触发系统「应用无响应」弹窗(com.android.server.am.AppNotRespondingDialog)，
    // 其按钮为「等待/关闭应用」(没有「确定」)。原 backTo 里 clickText('确定') 永远点不到，弹窗长期盖屏，
    // 导致后续「返回」按钮找不到而超时，整轮任务被拖死(见 2026-07-17 06:50 ANR 日志)。
    // 这里改点「等待」让京东继续运行；若「等待」缺失则兜底点「确定」。
    let now = new Date().getTime()
    if (now - _lastAnrCheck < 20000) {
      return false  // 降频：20s 内已检测过，跳过本次空耗
    }
    _lastAnrCheck = now
    if (this.findText('没有响应', null, 1000) || this.findText('应用无响应', null, 1000)) {
      if (this.clickText('等待', 1000, null, true)) {
        this.pushLog('检测到ANR「应用无响应」弹窗，已点击「等待」恢复')
        sleep(1500)
        return true
      }
      if (this.clickText('确定', 1000, null, true)) {
        this.pushLog('检测到ANR弹窗，已点击「确定」')
        sleep(1500)
        return true
      }
    }
    return false
  }
  function doubleBack() {
    automator.back()
    sleep(500)
    automator.back()
  }
  function backToPackageAndWait(_this, backToWait) {
    let cnt = 0
    const pkg = _this.getPackage()
    while (commonFunctions.myCurrentPackage() != pkg && pkg) {
      logUtils.debugInfo(['{}当前页面不是 {}双击返回', commonFunctions.myCurrentPackage(), pkg])
      if (commonFunctions.myCurrentPackage().includes('com.miui')) {
        return
      }
      automator.back()
      if (++cnt > 3) {
        sleep(400)
        automator.back()
        sleep(400)
      }
      if (cnt > 5) {
        break
      }
      while (backToWait) {
        if (_this.findText(backToWait, null, _this.getTimeout())) {
          sleep(1000)
          continue
        }
        break
      }
    }
  }
  function _needDoubleBack(DOUBLE_BACK_ACTIVITIES) {
    let a = String(currentActivity())
    return DOUBLE_BACK_ACTIVITIES.some(k => a.includes(k))
  }
  this.backTo = function (backTo, activity, backToWait) {
    logUtils.debugInfo(['backTo in'])
    // 2026-07-18：需「双击返回」退出的 Activity 白名单（小游戏/小程序容器等多层页面，单返回退不出）。
    //   后续遇到同类页面，直接往此数组加关键字即可，逻辑无需改动。
    const DOUBLE_BACK_ACTIVITIES = ['MantoActivityUp1']
    const t = new  Date().getTime()
    let element = null
    sleep(this.getTimeout())
    // 2026-07-17 修复：京东无响应(ANR)弹窗按钮是「等待/关闭应用」而非「确定」，
    //   原 clickText('确定') 永远点不到→弹窗盖屏→后续「返回」超时卡死整轮。改走 dismissAnr()。
    this.dismissAnr()
    backToPackageAndWait(this, backToWait)
    let _this = this
    function goBack(backToWait) {
      _this.pushLog(['back'])
      let isDb = _needDoubleBack(DOUBLE_BACK_ACTIVITIES)
      automator.back()
      if (isDb) {
        sleep(400)
        automator.back()
      }
      sleep(_this.getTimeout())
    }
    let timeout = 90000 // 1.5分钟超时，2分钟手机就锁屏了
    let find = false
    let count = 0
    while (new Date().getTime() - t < timeout && ++count < 100) {
      let currentAct = currentActivity()
      // 2026-07-24 修复：导航回退时若已落到桌面(Launcher)，继续 back 无意义（桌面 back 无反应），
      //   会一直循环到 90s 超时后被迫 killCurrentApp+重启京东，表现为用户看到的"退出应用"。
      //   改为直接重新拉起目标应用回到首页，由外层 pipeLine 的 beforeFind/openHome 重新进入任务页，
      //   避免整段强制重启京东（种豆得豆/农场任务此前频繁触发此问题）。
      if (currentAct.toLowerCase().includes('launcher')) {
        logUtils.debugInfo(['backTo 已在桌面，重新拉起应用回到首页'])
        home()
        return null
      }
      this.dismissAnr()
      while (backToWait) {
        if (backToWait && _this.findText(backToWait, null, _this.getTimeout())) {
          sleep(1000)
          continue
        }
        break
      }
      if (activity && activity !== currentAct) {
        logUtils.debugInfo(['activity, 目标：{} 当前：{}', activity, currentAct])
        goBack(backToWait)
        if (currentAct === currentActivity()) {
          if (count<= 4) {
            this.pushLog('activity未变化，可能是有弹窗？')
            this.closeDialogByImage()
          } else {
            this.pushLog('activity未变化，双击返回')
            doubleBack()
          }
        }
        continue
      }
      if (backTo.constructor === String || backTo.constructor === RegExp) {
        element = this.findText(backTo, null, this.getTimeout())
        if (!element) {
          goBack(backToWait)
          continue
        }
        find = true
        break
      } else if (backTo.constructor === Object) {
        let findCount = this.findObject(backTo)
        if (findCount === 0) {
          goBack(backToWait)
          continue
        }
        find = true
        break
      }
    }
    logUtils.debugInfo(['backTo结束 {}', currentActivity()])
    if (!find && (new Date().getTime() - t >= timeout)) {
      this.pushWarningLog('无法退出，重启APP')
      commonFunctions.killCurrentApp()
      home()
    }
    return element
  }

  this.findWidget = function(info) {
    let clickMine = null
    while (1) {
      if (info.node) {
        clickMine = info.node
        info.node = null
        if (clickMine) {
          break
        }
      }
      if (info.text) {
        this.pushLog(`准备查找 ${info.text}`)
        let findType = 3
        for (let i=0;i<2;i++) {
          clickMine = this.findText(info.text, info.region, this.getTimeout(), null, findType)
          if (clickMine) {
            if (automator.checkCenterClickable(clickMine)) {
              break
            } else {
              findType = 2
              continue
            }
          }
          break
        }
        if (clickMine && automator.checkCenterClickable(clickMine)) {
          logUtils.debugInfo(['{}[{}]位置:{}', info.text.toString(), (clickMine.text&&clickMine.text())||'', clickMine.bounds()])
          break
        }
        clickMine = null
      }
      if (info.allText && info.allTextIndex !== null) {
        this.pushLog(`准备找所有 ${info.allText}`)
        clickMine = null
        let lst = this.showRegion(info.allText, info.region, textMatches(info.allText)).find() ||
          this.showRegion(info.allText, info.region,descMatches(info.allText)).find()
        let index = info.allTextIndex < 0 ? lst.length + info.allTextIndex : info.allTextIndex
        if (lst.length > index) {
          clickMine = lst[index]
          break
        }
      }
      if(info.id) {
        this.pushLog(`准备ID查找 ${info.id}`)
        clickMine = WidgetUtils.widgetGetById(info.id, 3000)
        if (clickMine) {
          break
        }
      }
      if (info.notFound) {
        this.pushLog(`notFound begin`)
        clickMine = info.notFound()
        this.pushLog(`notFound end`)
        if (clickMine) {
          break
        }
      }
      this.pushLog(`没找到节点`)
      break
    }
    return clickMine;
  }

  /**
   * 根据配置信息找位置、点击、等待元素
   * 
   * @param {Object} info 动作
   */
  this.action = function(info) {
    logUtils.debugInfo(['action begin {} {}', info.text||info.id||info.allText, currentActivity()])
    let activity = info.backToByActivity==false? '' : currentActivity()
    activity = activity.startsWith('android')?'':activity
    let retObj = {node:null, waitFor:null}
    let clickMine = this.findWidget(info)
    retObj.node = clickMine
    if (clickMine) {
      try {
        let txt = '↑' + (info.text||info.id||'操作位置')
        logUtils.debugInfo([`{} at {} action`, clickMine.text(), JSON.stringify(this.boundsToPosition(clickMine.bounds()))])
        this.displayButtonAndClick(clickMine, txt.toString())
        // this.closeDialogByImage()
        if (info.waitFor) {
          sleep(1000)
          let lst = info.waitFor.forEach?info.waitFor:[info.waitFor]
          let t1 = new Date().getTime()
          while ((new Date().getTime()) - t1 < 20000) {
            for (let txt of lst) {
              if (this.findText(txt, null, this.getTimeout())) {
                t1 = 0
                break
              }
            }
          }
          info.find = true
        } else {
          info.find = true
        }
        if (info.sleep) {
          logUtils.debugInfo(['sleep begin {}', currentActivity()])
          info.sleep(info)
          logUtils.debugInfo(['sleep end {}', currentActivity()])
        } else if (info.timeout) {
          sleep(info.timeout)
        }
        if (!info.backTo) {
          logUtils.debugInfo(['action end {} {}', info.text||info.id||info.allText, currentActivity()])
          return retObj
        }
        this.backTo(info.backTo, activity, info.backToWait)
      } catch (err) {
        this.pushWarningLog(`查找 ${info.text} 发生异常`)
        logUtils.debugInfo(['err:{} at line {}', err, err.stack])
        if (clickMine.click) {
          logUtils.debugInfo(['by click'])
          clickMine.click()
          // this.closeDialogByImage()
        }
      }
    }
    logUtils.debugInfo(['action end {} {}', info.text||info.id||info.allText, currentActivity()])
    return retObj
  }

  function 退出快速验证() {
    if (currentActivity().includes('JDRiskHandleActivity')) {
      logUtils.debugInfo(['退出快速验证'])
      automator.back()
      sleep(2000)
    }
  }
  
  /**
   * 根据动作序列执行操作
   * 
   * @param {Array} actList 动作序列
   */
  // 硬上限：防 pipeLine 在 loopFilter 项上死循环
  const MAX_PIPELINE_LOOP = 30     // 单 loopFilter 项 do...while 上限
  const MAX_PIPELINE_TOTAL = 120   // 单次任务总上限
  const WIDGET_DUMP_SCREEN_W = 360 // 诊断帧截图缩放目标宽度
  const NAV_RESET_THRESHOLD = 1    // openHome 连续失败阈值：≤则轻复位(backTo)，>则硬重启(kill+relaunch)
  const NAV_RECOVER_MAX = 3        // 导航自愈最大尝试次数（前缀重放兜底，超出则由上层 setUpAutoStart 兜底）

  /**
   * 框架级「回到首页」方法，子类可覆盖 launchApp() 决定如何打开目标应用。
   * @param {number} failCount 连续失败次数（由 pipeLine 内导航自愈累计）
   *   failCount===0      ：初始确保打开（非失败场景），直接 launchApp
   *   首次失败(≤阈值)    ：仅 backTo 轻复位，不杀进程
   *   多次失败(>阈值)    ：killCurrentApp + 回桌面 + launchApp 硬重启
   */
  this.openHome = function(failCount) {
    if (failCount == null) failCount = 0
    if (failCount === 0) {
      return this.launchApp()
    }
    if (failCount <= NAV_RESET_THRESHOLD) {
      this.pushLog(`openHome 轻复位 failCount=${failCount}`)
      this.backToHome()
      return true
    }
    this.pushLog(`openHome 硬重启 failCount=${failCount}`)
    commonFunctions.killCurrentApp()
    home()
    return this.launchApp()
  }
  // 子类覆盖：真正如何打开目标应用（启动+回到首页+登录校验），返回 bool
  this.launchApp = function() {
    this.pushLog('launchApp 未实现，请子类覆盖')
    return false
  }

  /**
   * 导航自愈：当前节点 beforeFind 失败（页面丢失）后，重放其之前的前缀节点，
   * 重新打开任务列表（重开列表）。前缀节点 p.resetReplay===false 时只跑 beforeFind、不跑 action
   * （避免误进子页，如 binDayTask2 的「京喜领豆」入口）。
   * @returns {boolean} 是否成功回到当前节点可继续的状态
   */
  this._navRecover = function(actList, idx) {
    for (let i = 0; i < idx; i++) {
      let p = actList[i]
      if (p.beforeFind) {
        if (!p.beforeFind(p)) return false
      }
      if (p.resetReplay !== false && !p.loopFilter && p.text) {
        if (!this.action(p)) return false
      }
    }
    // 重探当前节点
    if (actList[idx].beforeFind) {
      return actList[idx].beforeFind(actList[idx])
    }
    return true
  }

  this.pipeLine = function(actList) {
    let value = device.getMusicVolume()
    this._pipelineLoopGuard = 0
    let _navFailCount = 0
    for (let idx = 0; idx < actList.length; idx++) {
      let info = actList[idx]
      let clickMine = null
      let count = 0
      do {
        count += 1
        this._pipelineLoopGuard = (this._pipelineLoopGuard || 0) + 1
        let retObj = {}
        let ok = (!currentActivity().toLowerCase().includes('launcher'))
        // ---- 导航自愈：beforeFind 失败 ----
        if (info.beforeFind || !ok) {
          if (ok) {
            this.pushLog(`beforeFind begin`)
            ok = info.beforeFind(info)
            this.pushLog(`beforeFind end ${ok}`)
          }
          if (!ok) {
            _navFailCount += 1
            this.openHome(_navFailCount)                  // 轻/重复位（backTo 或 kill+relaunch）
            let recovered = this._navRecover(actList, idx)  // 重放前缀重开任务列表
            if (!recovered) {
              _navFailCount += 1
              this.openHome(_navFailCount)                // 仍失败：加重试（硬重启）
              recovered = this._navRecover(actList, idx)
            }
            if (!recovered) {
              this.pushWarningLog(`导航自愈失败，跳过节点 ${info.text||info.id||info.allText||''}`)
              break  // 不标完成，跳出 do...while
            }
            _navFailCount = 0
            ok = true
          }
          if (!ok) break
        }
        if (info.loopFilter) {
          退出快速验证()
          let txt = info.text
          let appendFilter = (matcher) => {
            if (info.appendFilter) {
              return info.appendFilter(matcher)
            }
            if (info.boundsInside) {
              return matcher.boundsInside(info.boundsInside[0],info.boundsInside[1],info.boundsInside[2],info.boundsInside[3],)
            }
            if (info.boundsContains) {
              return matcher.boundsContains(info.boundsContains[0],info.boundsContains[1], info.boundsContains[2], info.boundsContains[3])
            }
            return matcher
          }
          let lst = WidgetUtils.widgetGetAll(info.text, device.model=='Redmi Note 5'?10000:5000, null, appendFilter)||[]
          if (lst.length === 0 && info.ocr) {
            logUtils.debugInfo([`widgetGetAll 失败，ocr查找 ${info.text}`])
            let region = info.boundsInside ? [info.boundsInside[0],info.boundsInside[1], 
              info.boundsInside[2]-info.boundsInside[0], info.boundsInside[3]-info.boundsInside[1]] : null
            lst = this.findTextOcr(info.text, info.text, region, this.getTimeout())
          }
          this.pushLog(`loopFilter begin ${info.text} len=${lst.length}`)
          device.setMusicVolume(0)
          info.loopFilter(lst, info)
          this.pushLog(`loopFilter end ${currentActivity()}`)
          device.setMusicVolume(value)
          clickMine = 1
        } else {
          退出快速验证()
          retObj = this.action(info)
          clickMine = retObj.node
          if (clickMine) {
            break
          }
        }
      } while (info.loopFilter && !info.end && count < (info.maxLoop || MAX_PIPELINE_LOOP) && this._pipelineLoopGuard < MAX_PIPELINE_TOTAL)
      if ((count >= (info.maxLoop || MAX_PIPELINE_LOOP) || this._pipelineLoopGuard >= MAX_PIPELINE_TOTAL) && !info.end) {
        this.pushWarningLog(`pipeLine 硬上限触发 item=${count} total=${this._pipelineLoopGuard} ${info.text||info.id||info.allText||''}`)
        try { this._dumpPipelineDiagnostics && this._dumpPipelineDiagnostics(info) } catch (e) { logUtils.debugInfo(['dump diag err:' + e]) }
        info.end = true   // 兜底退出，避免死循环
      }
      if (!clickMine) {
        this.pushWarningLog(`act未找到 ${info.text} point:${info.point}`)
        if (info.end) {
          continue
        }
        if (info.point) {
          FloatyInstance.setFloatyInfo(info.point, info.text||info.id)
          automator.click(info.point.x, info.point.y)
          sleep(1000)
        }
        // 导航/查找失败：交给 openHome 轻/重复位（不再整段重跑子任务）
        _navFailCount += 1
        this.openHome(_navFailCount)
        break
      }
    }
  }

  this.swipeWidget = function(widget, subx, suby) {
    subx = subx||-300
    suby = suby||-10
    let x = widget.bounds?widget.bounds().centerX():widget[0]
    let y = widget.bounds?widget.bounds().centerY():widget[1]
    let txt = widget.text?widget.text():widget[2]
    x= Math.min(x, config.device_width-1)
    y= Math.min(y, config.device_height-1)
    logUtils.debugInfo(['移动控件：{} [{},{}],[{},{}]', txt, x, y, x+subx, y+suby])
    swipe(x, y, x+subx, y+suby, 600)
    return widget
  }
  function randomHexColor() {
    var hex = Math.floor(Math.random() * 16777216).toString(16);
    while (hex.length < 6) {
    hex = '0' + hex;
    }
    return '#' + hex;
  }
  this.addRectangle = function(txt, region, color) {
    let fltType = 'abc'
    // 限制悬浮窗标签文本长度，避免绘制溢出屏幕或相互重叠
    const MAX_FLOATY_TEXT_LENGTH = 50
    if (txt != null && ('' + txt).length > MAX_FLOATY_TEXT_LENGTH) {
      txt = ('' + txt).substring(0, MAX_FLOATY_TEXT_LENGTH - 1) + '…'
    }
    let lst = [region[0], region[1], region[2], region[3]]
    const sub = Math.floor(Math.random() * (11 - 1) + 1)
    if (lst[0] === 0) {
      lst[0] = lst[0] + sub
      lst[3] = lst[3] - sub*2
    }
    color = color || randomHexColor()
    WarningFloaty.addRectangle(txt, lst, color, fltType)
    // setTimeout(() => {
    //   WarningFloaty.clearAll(fltType)
    //   console.log('clearAll', fltType)
    // }, 3000)
    if (this.textThreadA) {
      return
    }
    let that = this
    this.textThreadA = threads.start(function () {
      while (1) {
        sleep(10000)
        WarningFloaty.clearAll(fltType)
      }
      console.log('clearAll', fltType)
      that.textThreadA = null
    })
  } 
  function checkByCenter() {
    left = device.width/2 - 5
    top = device.height/2 - 5
    right = device.width/2 + 5
    bottom = device.height/2 + 5
    let lst = selector().boundsContains(left, top, right, bottom).find()
    lst = lst.filter(item => {
      if (item.childCount() === 0) {
        return true
      }
      return false
    })
    logUtils.debugInfo(['中心点的元素层数{}', lst.length])
  }
  function lonelyIsland(element) {
    if (!element) return true
    let p = element.parent()
    while (p && p.childCount() === 1) {
      element = p
      p = element.parent()
    }
    if (!p || p.childCount() <= 1) {
      return true
    }
    let cb = element.bounds();
    let maxSub = 10
    console.log('element', element.boundsInParent())
    let lst = p.children()
    for (let c of lst) {
      if (!c) continue
      console.log(c.boundsInParent())
      if (c === element || c.bounds().equals(element.bounds())) continue
      if (c.bounds().width() > (device.width - 20)) {
        continue
      }
      let nb = c.bounds(); 
      // 水平相邻：在同一行，且右/左间距 ≤ 8px 
      if (Math.abs(cb.top  - nb.top) < maxSub && 
        (Math.abs(cb.right  - nb.left)  <= maxSub || Math.abs(cb.left  - nb.right) <= maxSub)) {
        console.log(`!lonelyIsland=`, c)
          return false
      }
      // 垂直相邻：在同一列，且下/上间距 ≤ 8px 
      else if (Math.abs(cb.left  - nb.left) < maxSub &&
       (Math.abs(cb.bottom  - nb.top) <= maxSub || Math.abs(cb.top - nb.bottom) <= maxSub)) {
        console.log(`!lonelyIsland=`, c)
          return false
      }
      if (cb.contains(nb) || nb.contains(cb)) {
        console.log(`contains lonelyIsland=`, c)
          return false
      }
      //console.log('cc=', c)
    }
    return true
  }
    /**
   * 增强版弹窗关闭 (v3 - 通用 X 按钮识别优先)
   *
   * 关闭策略优先级:
   *   0) 双开选择器 XSpaceResolveActivity -> 直接选默认实例
   *   1) ★ 通用 X 关闭按钮: 全屏扫描"小正方形 Image 控件 + 孤立(lonelyIsland) + 位于弹窗顶部"
   *      不依赖任何文字或 YOLO, 是识别弹窗 X 的通用方法
   *   2) 文字关闭: 上部文字命中 getDismissPatterns()(开心收下/知道了/关闭...)
   *   3) YOLO close_icon
   *   4) 各区域控件遍历: 命中 getDismissPatterns() 文字
   *   5) OCR 兜底: 全屏识别关闭/取消文字或 × 符号
   *   6) _modal id 兜底
   *
   * @param type  位掩码: 1=底部中 2=右侧 4=右上 8=id兜底 16=中下横条  (type>0 才真正扫描)
   *              type 为假值(0/undefined 未传)时仅做 excludeTxt 检查后立即返回(安全)
   */
  this.closeDialogByImage = function(txt, type, excludeTxt, excludeRegion, inside) {
    sleep(1000)
    type = type || 7
    let subs = []
    let sub = 83
    let left = device.width / 2 - sub
    let top = device.height * 0.5
    let right = device.width / 2 + sub
    let bottom = device.height

    if (![undefined, null].includes(excludeTxt)) {
      let ele = this.findText(excludeTxt, excludeRegion, this.getTimeout(), 1, 2)
      console.log(`excludeTxt=`, excludeTxt, ele)
      if (ele !== null) {
        return false
      }
    }
    let rects = []
    if (inside) {
      rects.push(inside)
    }
    if (type&1) {
      rects.push([left, top, right, bottom*0.9])
      subs.push(165)
    }
    sub = device.model == 'Redmi Note 5' ? 75 : 90
    if (type&2) {
      rects.push([device.width - sub*2, device.height*0.12, device.width, device.height*0.7])
      subs.push(150)
    }
    if (type&4) {
      rects.push([device.width*0.5, device.height*0.2, device.width, device.height*0.5])
      subs.push(150)
    }
    // ═══ 1) ★ 通用 X 关闭按钮识别(首选) ═══
    if (this.findCloseXIcon && this.findCloseXIcon()) {
      logUtils.debugInfo(['closeDialogByImage: 通用 X 按钮已关闭弹窗'])
      return true
    }

    // ═══ 2) 文字关闭 ═══
    txt = txt || this.getDialogText()
    if ((txt && this.clickText(txt, 2000, [0, device.height * 0.3, device.width, device.height * 0.4], true))) {
      return true
    }

    // ═══ 3) YOLO close_icon ═══
    let find = this.yoloCheck('关闭弹窗', { labelRegex: 'close_icon' }, true)
    if (find) return find

    // ═══ 4) 各区域控件遍历(文字命中 dismiss 正则) ═══
    find = false
    let ndx = -1
    for (let pos of rects) {
      ndx += 1
      this.addRectangle('检测', [pos[0], pos[1], pos[2] - pos[0], pos[3] - pos[1]])
      let lst = selector().visibleToUser().boundsInside(pos[0], pos[1], pos[2], pos[3]).find()
      lst.forEach(element => {
        let rect = element.bounds()
        if (find) return
        if (element.childCount() > 0) {
          logUtils.debugInfo(`filter by childCount ${element.childCount()}`)
          return
        }
        let text = element.text() || element.contentDescription
        let blackList = ['1165ee54f2045e45']
        if (blackList.includes(text)) {
          logUtils.debugInfo(`filter by blackList ${text}`)
          return
        }
        if (rect.width() > subs[ndx] || rect.width() < 60) {
          logUtils.debugInfo(`filter by width ${rect.width()}`)
          return
        }
        sub = Math.abs(rect.width() - rect.height())
        if (sub > 10) {
            logUtils.debugInfo(`filter by size ${sub}`)
            return
        }
        if (text && !element.className().includes('Image')) {
          if (!text.includes('关闭')) {
            logUtils.debugInfo(`filter by text ${text} ${element.className()}`)
            return
          }
        }
        if (element.className().includes('Image') && text && /[\u4e00-\u9fa5]/.test(text)) {
          // 含中文内容
          if (!text.includes('关闭')) {
            logUtils.debugInfo(`filter by text ${text} ${element.className()}`)
            return
          }
        }
        if (!lonelyIsland(element)) {
          logUtils.debugInfo(`filter by lonelyIsland ${element}`)
          return
        }
        console.log(text, 'close=', element)
        // YoloTrainHelper.saveImageWithLabels(
        //   commonFunctions.captureScreen(), '签到页面', 
        //   [{name:'关闭按钮', shape: 'rectangle', region:[rct.left,rct.top,rct.width(),rct.height()]}], 
        //   'jd', true
        // )
        this.addRectangle('关闭', [rect.left, rect.top, rect.width(), rect.height()])
        let p = element
        for (let i=0;i<3&&p;++i) {
          p = p.parent()
          console.log('parent=', p?p.bounds():null)
          find = true
        }
        if (!find) {
          logUtils.debugInfo(['过滤掉了'])
          return
        }
        let img = images.clip(commonFunctions.captureScreen(),
          element.bounds().left, element.bounds().top, element.bounds().width(), element.bounds().height())
        console.log('img=', images.toBase64(img))
        this.displayButtonAndClick(element, 'close button')
      });
      if (find) break
    }
    let checkDialog = false
    if (!find) {
      checkDialog = type&8
      logUtils.debugInfo(['没有找到弹窗, 尝试id检查{}', checkDialog])
    }
    if (!checkDialog) { 
      return find
    }
    return this.closeById(rects, type)
  }

  /**
   * 向上查找可点击节点（含自身），最多回溯 depth 层祖先。
   * 用于 closeDialogByImage 第 4 步：过滤掉“空文字、不可点击”的装饰控件误判。
   * @param {UiObject} element 起点控件
   * @param {number} depth 最多回溯的祖先层数
   * @return {UiObject|null} 命中的可点击节点，找不到返回 null
   */
  this._findClickableAncestor = function (element, depth) {
    let cur = element
    for (let i = 0; i <= (depth || 3) && cur; ++i) {
      try {
        if (typeof cur.clickable === 'function' && cur.clickable()) return cur
      } catch (e) { /* 部分节点无 clickable，忽略 */ }
      try { cur = cur.parent() } catch (e) { break }
    }
    return null
  }

  /**
   * ★ 通用 X / 关闭按钮识别 (几何 + 类名, 不依赖文字与 YOLO)
   * 特征: 小尺寸(24~120px) 近正方形 的 ImageView/Image 控件, 孤立(lonelyIsland),
   *       通常位于弹窗右上角/顶部, 但也可能是弹窗底部正中的圆形 X(如"限时福利红包"弹窗).
   * 兜底策略通过"弹窗上下文"(居中弹窗容器) 允许底部 X, 同时用 click/孤立性 排除底部导航栏误点.
   * @return {boolean} 是否成功识别并点击
   */
  this.findCloseXIcon = function () {
    try {
      let sh = device.height, sw = device.width
      let all = selector().visibleToUser().find()

      // 检测"居中弹窗容器": JD 很多弹窗没有 Dialog/BottomSheet 类名, 但有一个明显居中、四周留边的大容器
      let _hasCenteredDialog = function (nodes) {
        try {
          for (let i = 0; i < nodes.size(); i++) {
            let e = nodes.get(i)
            let b = e.bounds()
            let w = b.width(), h = b.height()
            // 容器显著居中: 宽度>0.55W 高度>0.22H, 四周留边, 水平居中
            if (w > sw * 0.55 && h > sh * 0.22 &&
                b.left > sw * 0.03 && b.right < sw * 0.97 &&
                b.top > sh * 0.05 && b.bottom < sh * 0.95) {
              let cx = b.centerX()
              if (Math.abs(cx - sw / 2) < sw * 0.15) {
                // 不是全屏页面主体: 至少一侧留较大边距
                if (b.left > sw * 0.08 || b.right < sw * 0.92 || b.top > sh * 0.08 || b.bottom < sh * 0.92) {
                  return true
                }
              }
            }
          }
        } catch (e) {}
        return false
      }

      // 判定是否处于弹窗上下文: 类名 Dialog/... 或 居中弹窗容器
      let inDialogByClass = false
      for (let i = 0; i < all.size(); i++) {
        let cls = (all.get(i).className() || '')
        if (/Dialog|PopupDecor|BottomSheet|AlertDialog/i.test(cls)) { inDialogByClass = true; break }
      }
      let inDialog = inDialogByClass || _hasCenteredDialog(all)

      let textCands = [], iconCands = []
      // 关闭语义正则: 明确"关闭"词(边界匹配, 排除"已关闭订阅提醒"这类订阅开关), 或带圈✕
      // 不放宽到单独"×"字符, 以免误匹配商品名(如"蒙牛×18盒")
      let closeRe = /^(关闭|关闭按钮|关闭任务面板|关闭本页|close|收起|dismiss)$|关闭弹窗|关闭本页|✕/i
      for (let i = 0; i < all.size(); i++) {
        let e = all.get(i)
        let cls = (e.className() || '')
        let t = String(e.text() || '').trim(), de = String(e.contentDescription || '').trim()
        // 注意：blob 带分隔空格，纯文本「关闭」会变成「关闭 」导致末尾空格破坏 closeRe 的 ^(关闭)$ 锚定匹配，
        // 故整体 trim，使精确「关闭」按钮也能走策略1最快路径（仍排除「已关闭订阅提醒」等含「关闭」的非关闭词）。
        let blob = (t + ' ' + de).trim()
        // 策略1(最高优先): 带"关闭"语义的可点控件(Button / ImageView 均可), 直接命中真实弹窗关闭键
        if (closeRe.test(blob) && (e.clickable() || /Button/.test(cls))) {
          let b = e.bounds(); let cx = b.centerX(), cy = b.centerY()
          let score = 100
          if (/关闭|close/i.test(blob)) score += 200
          if (cx > sw * 0.6) score += 50      // 右上角 X 优先
          if (cy < sh * 0.25) score += 30     // 顶部 X 优先
          textCands.push({ e: e, score: score, cx: cx, cy: cy, b: b })
          continue
        }
        // 策略2(兜底): 纯图标 X, 仅当图标本身带关闭语义 或 当前确在弹窗上下文中, 严防误点首页装饰
        // 关键约束: 之前仅靠"孤立小正方形 ImageView + 位置靠上"打分, 会把首页金刚区装饰角标(如"送礼新品"dot, desc='')误判为 X
        if (/Image|ImageView/.test(cls) && e.childCount() === 0) {
          let b = e.bounds(); let w = b.width(), h = b.height()
          if (w < 24 || w > 120 || h < 24 || h > 120) continue
          if (Math.abs(w - h) > 18) continue
          let cy = b.centerY(), cx = b.centerX()
          if (cy < sh * 0.1) continue           // 排除状态栏
          let isBottom = cy > sh * 0.6
          if (isBottom) {
            // 底部候选只允许在弹窗上下文里, 且本身可点(导航栏图标多不可点或为兄弟行)
            if (!inDialog) continue
            if (!e.clickable()) continue
          }
          if (!lonelyIsland(e)) continue
          let hasCloseDesc = /关闭|close|✕|收起/i.test(blob)
          if (!hasCloseDesc && !inDialog) continue   // 无语义且非弹窗上下文 → 跳过(根治首页装饰误点)
          let score = (sh - cy) / sh * 100
          if (hasCloseDesc) score += 200
          if (cx > sw * 0.6) score += 30
          if (cy < sh * 0.25) score += 20
          // 底部正中 X 在弹窗上下文里额外加权(真实案例: 限时福利红包弹窗底部圆圈X)
          if (isBottom && Math.abs(cx - sw / 2) < sw * 0.12 && inDialog) score += 60
          iconCands.push({ e: e, score: score, cx: cx, cy: cy, b: b })
        }
      }
      let useText = textCands.length > 0
      let cands = useText ? textCands : iconCands
      if (cands.length === 0) return false
      cands.sort(function (a, b) { return b.score - a.score })
      let best = cands[0]
      let via = useText ? 'text' : 'icon'
      let label = (best.e.text() || best.e.contentDescription || '')
      logUtils.debugInfo(['findCloseXIcon 命中: x=' + best.cx + ' y=' + best.cy +
        ' score=' + best.score.toFixed(1) + ' via=' + via + ' label=' + label + ' inDialog=' + inDialog])
      this.addRectangle('关闭X', [best.b.left, best.b.top, best.b.width(), best.b.height()])
      this.displayButtonAndClick(best.e, 'close X')
      return true
    } catch (err) {
      logUtils.debugInfo(['findCloseXIcon 异常: ' + err])
      return false
    }
  }

  /** 处理小米双开选择器 XSpaceResolveActivity */
  this._handleXSpaceSelector = function (defaultIndex) {
    defaultIndex = defaultIndex || 0
    try {
      let act = currentActivity()
      if (!act || !act.includes('XSpace')) return false
      logUtils.debugInfo(['检测到双开选择器: ' + act])
      let options = textMatches(/./).boundsInside(device.width * 0.15, device.height * 0.45,
        device.width * 0.85, device.height * 0.80).find()
      if (options && options.length > defaultIndex) {
        let t = options[defaultIndex]
        logUtils.debugInfo(['双开: 点击第' + defaultIndex + '个 ' + t.bounds().centerX() + ',' + t.bounds().centerY()])
        automator.click(t.bounds().centerX(), t.bounds().centerY())
        sleep(2000)
        return true
      } else {
        logUtils.debugInfo(['双开: 选项不足 ' + (options ? options.length : 0)])
        automator.click(device.width * 0.33, device.height * 0.65)
        sleep(2000)
        return true
      }
    } catch (e) {
      logUtils.debugInfo(['_handleXSpaceSelector 异常: ' + e])
      return false
    }
  }

  /** OCR 兜底找弹窗关闭/确认按钮(或 × 符号) */
  this._ocrFindDismissButton = function (pattern) {
    try {
      if (typeof localOcrUtil === 'undefined' || !localOcrUtil) return false
      let screen = commonFunctions.captureScreen()
      if (!screen) return false
      let results = localOcrUtil.recognizeWithBounds(screen, null, null)
      if (screen && typeof screen.recycle === 'function') {
        try { screen.recycle() } catch (e) {}
      }
      if (!results || !results.length) return false
      let cands = []
      let re = new RegExp(pattern)
      for (let r of results) {
        if (!r.label || !r.bounds) continue
        let cy = (r.bounds.top + r.bounds.bottom) / 2
        if (cy < device.height * 0.35) continue
        // 命中关闭文案, 或独立的 ×/X 符号
        if (re.test(r.label) || /^[×xX✕]$/.test(r.label.trim())) {
          cands.push({ label: r.label, x: r.bounds.centerX(), y: r.bounds.centerY(), cy: cy })
        }
      }
      cands.sort(function (a, b) { return a.cy - b.cy })
      if (cands.length > 0) {
        let b = cands[0]
        logUtils.debugInfo(['_ocrFindDismissButton: ' + b.label + ' ' + b.x + ',' + b.y])
        automator.click(b.x, b.y)
        sleep(1000)
        return true
      }
      return false
    } catch (e) {
      logUtils.debugInfo(['_ocrFindDismissButton 异常: ' + e])
      return false
    }
  }

  /** 通用弹窗关闭/确认文案(供文字与 OCR 兜底使用) */
  this.getDismissPatterns = function () {
    return '关闭|✕|×|x|X|收下|知道了|好的|确认|确定|同意|允许|暂不|暂不使用|' +
           '以后再说|残忍离开|取消|跳过|下次再说|不用了|关闭弹窗|立即体验|' +
           '开心收下|去使用|查看|前往|稍后|不再提示'
  }
  this.closeById = function(rects, type) {
    let index = 0
    console.log(type, 'rects.length', rects.length)
    for (let tp of [1,2]) {
      if (tp&type === 0 || !rects[index]) continue
      let rect = rects[index++]
      let x = null, y = null, sub = null, maxy=rect[3], miny=rect[1]
      if (tp == 1) {
        x = device.width/2
        y = device.height - 100
        sub = -50
      }
      if (this.closeDialog('.*?_modal', null, x, y, sub, maxy, miny)) {
        return true
      }
    }
    return false
  }
  this.closeDialog = function(regx, timeout, x, y, sub, maxy, miny) {
    timeout = timeout || 2000
    const times = 40
    cnt = times
    x= x || (device.width-80)
    y= y || 200
    sub = sub||50
    let regxType = ''
    while (cnt--) {
      if (maxy && y >= maxy) {
        break
      }
      if (miny && y <= miny) {
        break
      }
      let ele = null
      if (!regxType || regxType == 'text') {
        ele = this.findText(regx, null, timeout)
        regxType = ele?'text':regxType
      }
      if (!ele && (!regxType || regxType == 'id')) {
        ele = WidgetUtils.widgetGetById(regx, timeout)
        regxType = ele?'id':regxType
      }
      if (ele) {
        this.displayButtonPoint({x,y}, 'X')
        automator.click(x, y)
        if (y + sub > device.height) {
            break
        }
        if (y + sub < 0) {
            break
        }
        y+=sub
        sleep(500)
        if (cnt ==0 && this.findText(regx, null, timeout)) {
            cnt = times
            y = 100
        }
        continue
      }
      break
    }
    return cnt < times-1
  }
  this.displayButtonPoint = function (point, desc, delay, clickIt) {
    if (point) {
      logUtils.debugInfo(['{} at：{}', desc, JSON.stringify(point)])
      FloatyInstance.setFloatyInfo(
        {
          x: point.x,
          y: point.y
        },
        desc||'point')
      sleep(delay || 1000)
      if (clickIt) {
        automator.click(point.x, point.y)
      }
    }
    return point
  }
  this.captureAndCheckByOcr = function (regex, content, region, delay, clickIt, loop) {
    let options = {}
    if (typeof content === 'object' && content != null) {
      options = content || {}
      options.loop = loop
    } else {
      options.content = content || regex
      options.region = region || null
      options.delay = delay || 800
      options.clickIt = clickIt || false
      options.loop = loop === undefined ? 3 : loop
    }
    if (!localOcrUtil.enabled) {
      logUtils.warnInfo('当前AutoJS不支持OCR')
      this.pushLog('当前AutoJS不支持OCR')
      return null
    }
    if (typeof options.loop === 'undefined') {
      options.loop = 3
    }
    content = options.content || regex
    region = options.region || null
    delay = options.delay || 800
    clickIt = options.clickIt || false
    loop = options.loop
    FloatyInstance.hide()
    logFloaty.hide()
    sleep(40)
    let screen = commonFunctions.captureScreen()
    FloatyInstance.restore()
    logFloaty.show()
    logUtils.debugInfo('准备OCR查找目标：' + content + ' 正则：' + regex)
    if (screen) {
      let findText = localOcrUtil.recognizeWithBounds(screen, region, regex)
      if (findText && findText.length > 0) {
        let collect = findText[0].bounds
        logUtils.debugInfo(['OCR找到了目标 [{}]: {} at {},{}', content, findText[0].label, collect.centerX(), collect.centerY()])
        FloatyInstance.setFloatyInfo({
          x: collect.centerX(),
          y: collect.centerY()
        }, '找到了 ' + content)
        sleep(delay)
        if (clickIt) {
          automator.click(collect.centerX(), collect.centerY())
          sleep(delay)
        }
        return this.wrapOcrPointWithBounds(collect, findText[0].label)
      } else if (loop-- > 1) {
        sleep(delay)
        this.pushLog('未找到目标：' + content + ' 剩余次数：' + loop)
        logUtils.debugInfo(['未找到目标「{}」进行下一次查找，剩余尝试次数：{}', content, loop])
        logUtils.debugForDev(['图片数据：[data:image/png;base64,{}]', images.toBase64(images.clip(screen, config.device_width / 2, config.device_height * 0.7, config.device_width - config.device_width / 2, config.device_height - config.device_height * 0.7))])
        return this.captureAndCheckByOcr(regex, content, region, delay, clickIt, loop)
      }
    } else {
      logUtils.errorInfo('截图失败')
    }
    FloatyInstance.setFloatyText('ocr未找到 ' + content)
    sleep(delay)
    return null
  }
  this.findTextOcr = function (regex, content, region) { 
    FloatyInstance.hide()
    logFloaty.hide()
    sleep(40)
    let screen = commonFunctions.captureScreen()
    FloatyInstance.restore()
    logFloaty.show()
    logUtils.debugInfo('准备OCR查找目标：' + content + ' 正则：' + regex)
    if (screen) {
      let findText = localOcrUtil.recognizeWithBounds(screen, region, regex)
      let lst = []
      for (let item of findText) {
        lst.push(this.wrapOcrPointWithBounds(item.bounds, item.label))
      }
      return lst
    } else {
      logUtils.errorInfo('截图失败')
    }
  }
  this.wrapOcrPointWithBounds = function (ocrPoint, label) {
    if (!ocrPoint) {
      return null
    }
    if (!ocrPoint.bounds) {
      let newPoint = Object.create(ocrPoint)
      newPoint.bounds = () => ocrPoint
      newPoint.text = () => label
      return newPoint
    }
    return ocrPoint
  }  
  this.allText = function(ele, loop) {
    if (!ele || !ele.text) {
        return ''
    }
    let txt = ele.text() || ele.desc() || ''
    ele.children().forEach(item => {
      let b = this.allText(item, 1)
      if (b) {
          if (txt) txt += ' '
          txt += b
      }
    })
    txt = (!loop && txt) ? txt + '\n':txt
    return txt
  }
  /**
   * yolo查找所有匹配的对象
   * @param {string} desc 描述信息
   * @param {object} filter 过滤配置 可信度 label 等等
   * @return {array}
   */
  this.yoloCheckAll = function (desc, filter) {
    let img = null
    let results = []
    let tryTime = 5
    WarningFloaty.clearAll()
    logUtils.debugInfo(['通过YOLO查找：{} props: {}', desc, JSON.stringify(filter)])
    do {
      sleep(400)
      img = commonFunctions.captureScreen()
      results = YoloDetection.forward(img, filter) || []
    } while (results.length <= 0 && tryTime-- > 0)
    if (results.length > 0) {
      img = commonFunctions.captureScreen()
      return results.map(result => {
        let { x, y, width, height, label, confidence } = result
        let left = x, top = y
        WarningFloaty.addRectangle('找到：' + desc, [left, top, width, height])
        logUtils.debugInfo(['通过YOLO找到目标：{} label: {} confidence: {}', desc, label, confidence])
        if (confidence < 0.9) {
          YoloTrainHelper.saveImage(img, desc + 'yolo准确率低', 'low_predict', config.yolo_save_low_predict)
        }
        return { x: left + width / 2, y: top + height / 2, width: width, height: height, left: left, top: top, label: label }
      })
    } else {
      logUtils.debugInfo(['未能通过YOLO找到：{}', desc])
      YoloTrainHelper.saveImage(img, 'yolo查找失败' + desc, config.yolo_save_check_failed)
    }
    return null
  }

  this.yoloCheck = function (desc, filter, click) {
    try {
      let results = this.yoloCheckAll(desc, filter)
      if (results && results.length > 0) {
        let node = results[0]
        if (click) {
          // this.addRectangle('yolo close', [node.top, node.left, node.width, node.height])
          automator.click(node.x, node.y)
          sleep(1000)
        }
        return node
      }
    } catch (e) {
      logUtils.errorInfo(e)
    }
    return null
  }
    this.bounds2Region = function(bounds) {
      if (!bounds) return
      let region = null
      if (bounds.constructor === Array) {
        region = [bounds[0], bounds[1],   bounds[2]-bounds[0], bounds[3]-bounds[1]]
      } else if (bounds.centerX) {
        region = [bounds.left, bounds.top, bounds.width(), bounds.height()]
      }
      return region
    }

  /**
   * abstract funcs
   */
  this.exec = () => { }

  this.notifyOper = function() {
    let store = this.createStoreOperator('notify_token', { pushPlusToken: '', wxpusherToken: '', channel: '',
      logSite: '', logToken:'', logDir: ''
     }, true)
    if (!this.notify) {
      this.notify = new NotifyOper(this, store, 'unisign')
    }
    return this.notify
  }
  function NotifyOper(_this, tokenStore, taskName) {
    this.notifyMsg = ''
    this.storeKey = `${taskName}_notifyMsg`
    this.tokenStore = tokenStore
    this.storage = storages.create(`${taskName}_group`);
    this.appendNotifyMsg = function(ele, allChild) {
      allChild = allChild===undefined ? true:allChild
      let obj = this.storageOp(this.storeKey, false)
      if (!this.notifyMsg && obj && obj.msg) {
        this.sendNotifyMsg('上次任务进展', obj.msg)
      }
      if (allChild) {
          this.notifyMsg += _this.allText(ele)
      } else {
        let txt = ele.text() || ''
        ele.children().forEach(item => {
            let b = item.text()
            if (b) {
                if (txt) txt += ' '
                txt += b
            }
        })
        if (txt) txt += '\n';
        this.notifyMsg += txt
      }
      this.storageOp(this.storeKey, true, { msg: this.notifyMsg })
    }
    this.appendMsg = function(msg) {
      let obj = this.storageOp(this.storeKey, false)
      if (!this.notifyMsg && obj && obj.msg) {
        this.sendNotifyMsg('上次任务进展', obj.msg)
      }
      this.notifyMsg += msg
    }
    this.storageOp = function(k, isPut, v) {
      if (isPut) {
        this.storage.put(k, JSON.stringify(v))
      } else {
        let s = this.storage.get(k,v)
        if (s) {
            return JSON.parse(s)
        }
        return s
      }
    }
    this.wxpusher = function(title, content, token) {
        let url = `https://wxpusher.zjiecode.com/api/send/message`
        let data = {
            appToken: token.split('/')[0],
            content,
            summary: title,
            contentType: 1,
            uids: [token.split('/')[1]],
            verifyPay: false,
            verifyPayType: 0
        }
        const options = {
            headers: {
            'Content-Type': 'application/json',
            }
        };
        let rsp = http.postJson(url, data, options)
        console.log(rsp.body.string())

    }
    this.pushplus = function(title, content, token) {
        let url = `http://www.pushplus.plus/send`
        let data = {
            title,
            content,
            token
        }
        const options = {
            headers: {
            'Content-Type': 'application/json',
            }
        };
        let rsp = http.postJson(url, data, options)
        console.log(rsp.body.string())
    }
    this.sendNotifyMsg = function(title, content) {
      if (tokenStore.getValue().channel === 'wxpusher') {
        this.wxpusher(title, content||this.notifyMsg, tokenStore.getValue().wxpusherToken)
      }
      if (tokenStore.getValue().channel === 'pushplus') {
        this.pushplus(title, content||this.notifyMsg, tokenStore.getValue().pushPlusToken)
      }
      if (!content) {
        try{
          this.sendLog()
        } catch(e) {          
          commonFunctions.printExceptionStack(e)
        }
        this.storageOp('notifyMsg', true, { msg: '' })
        launch('com.termux')
      }
    }
    this.sendLog = function (localPath) {
      const SERVER = tokenStore.getValue().logSite; 
      if (!SERVER) return
      const TOKEN  = tokenStore.getValue().logToken;
      const REMOTE_DIR = tokenStore.getValue().logDir;
      let LOCAL_FILE = localPath || files.cwd().split('/脚本/')[0] + '/脚本/.logs/autojs-log4j.txt'
      let filename = files.getName(LOCAL_FILE)
      let bak = LOCAL_FILE+'.bak'
      files.copy(LOCAL_FILE, bak)
      LOCAL_FILE = bak
      const mimeType = "application/octet-stream"; // 或根据 files.getMimeType  动态获取       
      const putUrl = `${SERVER}/api/fs/put`;      // 直传接口 
      importPackage(Packages["okhttp3"])
      importClass(java.io.File)
      importClass(java.util.concurrent.TimeUnit); 
      const file = new File(LOCAL_FILE);
      const mediaType = MediaType.parse("application/octet-stream");  // 二进制即可 
      const requestBody = RequestBody.create(mediaType,  file);
      let request = new Request.Builder()
        .url(putUrl)
        .put(requestBody)
      request.addHeader('authorization', TOKEN)
      request.addHeader('File-Path', encodeURIComponent(REMOTE_DIR + "/" + filename))
      request.addHeader('Content-Type', mimeType)
      request.addHeader('Content-Length', file.length())
      request.addHeader('Overwrite', 'true')
      console.log(file.length(), request.toString())
      request = request.build()
      let response = null
      let result = null
      try {
        let okHttpClient = new OkHttpClient()
        response = okHttpClient.newCall(request).execute()
        if (response != null && response.body() != null) {
          let resultString = response.body().string()
          logUtils.debugInfo(['请求结果：{}', resultString])
        }
      } catch (e) {
        commonFunctions.printExceptionStack(e)
      } finally {
        files.remove(LOCAL_FILE)
        if (response !== null) {
          response.close()
        }
      }
    }
  }
}
/**
 * 初始化自定义存储，用于每日数据缓存
 */
BaseSignRunner2.prototype.initStorages = () => { }
BaseSignRunner2.prototype.constructor = BaseSignRunner2
module.exports = BaseSignRunner2