
let { config } = require('../config.js')(runtime, this)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, this)

let widgetUtils = singletonRequire('WidgetUtils')
let automator = singletonRequire('Automator')
let commonFunctions = singletonRequire('CommonFunction')
let FloatyInstance = singletonRequire('FloatyUtil')
let logUtils = singletonRequire('LogUtils')
let signFailedUtil = singletonRequire('SignFailedUtil')
let YoloTrainHelper = singletonRequire('YoloTrainHelper')
let warningFloaty = singletonRequire('WarningFloaty')
let NotificationHelper = singletonRequire('Notification')
// 多模态 LLM 视觉兜底（默认关闭，llm_config.json 里 llm_enabled=true 开启）
let llmVision = null
try {
  llmVision = require('../lib/LlmVisionHelper.js')
} catch (e) {
  console.log('[JingDongBeans2] LlmVisionHelper 加载失败，LLM 兜底禁用: ' + e)
}
// 可视化配置（config.js/storages）注入 LLM 参数，优先级高于 llm_config.json / llm_key.txt
if (llmVision && typeof llmVision.applyExternalConfig === 'function') {
  llmVision.applyExternalConfig({
    llm_enabled: config.llm_enabled,
    llm_url: config.llm_url,
    llm_api_key: config.llm_api_key,
    llm_model: config.llm_model,
    llm_timeout_ms: config.llm_timeout_ms,
    llm_max_calls_per_run: config.llm_max_calls_per_run,
  })
}
function myApp(runner) {
  let _app = app
  this.launchPackage = function (packageName) {
    logUtils.debugInfo(['launchPackage'])
    // sleep(1000)
    // _app.launchPackage(packageName)
    shuangKai(runner)
  }
  this.startActivity = function (intent) {
    _app.startActivity(intent)
    shuangKai(runner)
  }
}

function appendFilter(selector) {
  return selector.classNameContains('Image')
}

function shuangKai(runner) {
  home()
  sleep(500)
  home()
  sleep(500)
  home()
  sleep(2000)
  let ele = widgetUtils.widgetGetById('.*?clear_icon')
  if (ele) {
    runner.displayButtonAndClick(ele, '清理')
  }
  let shuangKai = textMatches(/京东/).find()
  let len = shuangKai?shuangKai.length:0
  runner.pushLog(`双开应用 len=${len}`)
  if (shuangKai&&shuangKai.length>0) {
    let task = runner.getMainTask()
    let name = task?task.name:`taskName:${runner.name}`
    let index = Math.min(shuangKai.length-1, (task&&task.number||0))
    runner.appIndex = index
    runner.pushLog(`点击第${index}个 ${name}`)
    console.log('双开', shuangKai.length, index, task)
    automator.click(shuangKai[index].bounds().centerX(), shuangKai[index].bounds().centerY() - 100)
    widgetUtils.widgetWaiting('首页', '双开找到首页', 5000)
    // for (let i=0;i<3;++i) {
    //   runner.displayButtonAndClick(shuangKai[index], `京东${i}`)
    //   sleep(2000)
    //   if (commonFunctions.myCurrentPackage() === runner._package_name) {
    //     break
    //   }
    //   runner.pushLog(commonFunctions.myCurrentPackage())
    //   if (i == 0) {
    //     automator.click(shuangKai[index].bounds().centerX(), shuangKai[index].bounds().centerY() - 50)
    //     sleep(2000)
    //     if (commonFunctions.myCurrentPackage() === runner._package_name) {
    //       break
    //     }
    //     runner.pushLog(commonFunctions.myCurrentPackage())
    //   }
    // }
  }
}
function getAncestorsWithin3Levels(node) {
    let ancestors = [];
    let current = node;
    for (let i = 0; i < 3 && current != null &&current.parent; i++) {
        current = current.parent(); 
        if (current)  ancestors.push(current); 
    }
    return ancestors;
}
 
function hasCommonParentWithin3Levels(node1, node2) {
    const list1 = getAncestorsWithin3Levels(node1);
    const list2 = getAncestorsWithin3Levels(node2);
 
    for (let i = 0; i < list1.length;  i++) {
        for (let j = 0; j < list2.length;  j++) {
            if (list1[i].bounds().equals(list2[j].bounds())) {
                return true;
            }
        }
    }
    return false;
}
function boundsInsideText(a,b,c,d, callback, btn) {
  let lst = textMatches(/.+/).boundsInside(a,b,c,d).find()
  if (!lst) lst = descMatches(/.+/).boundsInside(a,b,c,d).find() 
  if (callback) {
    return callback(lst)
  }
  let t = ''
  lst.forEach(e => {
    if (btn&&btn.parent&&!hasCommonParentWithin3Levels(btn, e)) {
      return
    }
      if (t) t += '#'
      t += e.text()
  })
  return t
}

function getTaskInfo(btn, sub, callback, baseRunner) {
  logUtils.debugInfo(['btn={},{}', btn.text()||btn.desc(), btn.bounds()])
  sub = sub||140
  let rect = btn.bounds()
  let a = 0
  let b = rect.centerY()-sub
  let c = device.width
  let d = rect.centerY()+sub
  if (btn.parent && currentActivity().includes('MainFrameActivity')) {
    let parent = btn.parent()
    a = parent.bounds().left
    b = parent.bounds().top
    c = parent.bounds().right
    d = parent.bounds().bottom
  }
  if (baseRunner) {
    baseRunner.addRectangle('任务信息', [a,b,c-a,d-b])
  } else {
    let fltType = 'rect' 
    WarningFloaty.addRectangle('任务信息', [a,b,c-a,d-b], null, fltType)
    sleep(1000)
    WarningFloaty.clearAll(fltType)
  }
  return boundsInsideText(a,b,c,d, callback, btn)
}

let BaseSignRunner = require('./BaseSignRunner.js')
function BeanCollector () {
  let _this = this
  let _app = app
  this.initStorages = function () {
    this.dailyTaskStorage = this.createStoreOperator('jingdong_daily_task', { executed: false })
    this.luckySignFailedCounter = this.createStoreOperator('luckySignFailed', { count: 0 })
  }
  BaseSignRunner.call(this)
  const _package_name = 'com.jingdong.app.mall'
  const jingdongConfig = config.jingdong_config
  this.executedTaskList = []
  this.retryTime = 0
  this.subTasks = config.supported_signs.filter(task => task.taskCode === 'JingDong')[0].subTasks || [
    {
      taskCode: 'beanSign',
      taskName: '签到',
      enabled: true,
    },
    {
      taskCode: 'doubleSign',
      taskName: '双签领豆',
      enabled: false,
    },
    {
      taskCode: 'plantBean',
      taskName: '种豆得豆',
      enabled: true,
    },
    {
      taskCode: 'drugSign',
      taskName: '京东买药',
      enabled: true,
    },
    {
      taskCode: 'luckySign',
      taskName: '幸运奖励',
      enabled: true,
    },
    {
      taskCode: 'gameCenter',
      taskName: '互动游戏',
      enabled: true,
    },
    {
      taskCode: 'dailyTask',
      taskName: '每日领取',
      enabled: true,
    },
  ]
  /***********************
   * 综合操作
   ***********************/
  this.setApp = function (obj) {
    _app = obj
  }

  /**
   * 通过我的进入签到页面
   */
  function openSignPage (retry) {
    if (openHome()) {
      _this.pushLog('查找 秒杀 入口')
      let plantEntry = widgetUtils.widgetGetOne('秒杀',)
      if (_this.displayButtonAndClick(plantEntry, '秒杀')) {
        sleep(1000)
        return true
      }
    } else if (!retry) {
      commonFunctions.killCurrentApp()
      sleep(1000)
      return openSignPage(true)
    }
    return false
  }

  function openMine (retry) {
    if (commonFunctions.myCurrentPackage() != _package_name) {
      _app.launchPackage(_package_name)
      _this.pushLog('打开京东APP')
      sleep(2000)
    }
    if (widgetUtils.widgetWaiting('我的')) {
      let myWidget = widgetUtils.widgetGetOne('我的')
      automator.clickCenter(myWidget)
      return true
    } else if (!retry) {
      commonFunctions.killCurrentApp()
      sleep(1000)
      return openMine(true)
    }
    return false
  }
  function getRandomInt(max) {
    return Math.floor(Math.random() * max);
  }

  function openHome () {
    if (commonFunctions.myCurrentPackage() != _package_name) {
      _app.launchPackage(_package_name)
      _this.pushLog('打开京东APP')
      sleep(2000)
    }
    if ((descContains('首页').boundsInside(0, config.device_height * 0.8, config.device_width, config.device_height).findOne(1000))) {
      _this.pushLog('点击 首页 控件')
      let myWidget = descContains('首页').boundsInside(0, config.device_height * 0.8, config.device_width, config.device_height).findOne(1000)
      return _this.displayButtonAndClick(myWidget, '首页')
    }
    return false
  }

  function openPlant () {
    if (openHome()) {
      sleep(2000)
      let plantEntry = widgetUtils.widgetGetOne('种豆得豆')
      if (_this.displayButtonAndClick(plantEntry, '种豆得豆')) {
        if (!widgetUtils.widgetWaiting('我的收获值')) {
          _this.pushLog('无法找到我的收获值，打开失败')
          return false
        }
        _this.checkIfWeeklyReward()
        return true
      }
    } else {
      _this.pushLog('打开失败')
    }
    return false
  }

  function verifySignOpened (timeout) {
    let verifyWidget = widgetUtils.widgetCheck('京东秒杀', timeout || 2000)
    if (verifyWidget) {
      logUtils.debugInfo(['找到京东秒杀控件，签到页面已打开 等待3秒 以确保页面加载完成'])
      sleep(3000)
      return true
    }
    return false
  }
  /**
   * 执行签到
   * @returns 
   */
  this.execDailySign = function () {
    if (this.isSubTaskExecuted(SIGN)) {
      this.pushLog('今日已完成签到')
      return true
    }
    this.pushLog('执行每日签到')

    if (!openSignPage()) {
      if (widgetUtils.widgetCheck("今日已签到", 2000)) {
        this.pushLog('今日已完成签到')
        this.setSubTaskExecuted(SIGN)
        return true
      }
      this.pushErrorLog('进入签到页面失败')
      return false
    }
    this.awaitAndSkip()
    if (verifySignOpened()) {
      // 等待加载动画
      sleep(1000)
      this.closePopup()

      this.pushLog('检查是否有签到按钮或已完成签到')
      YoloTrainHelper.saveImage(commonFunctions.captureScreen(), '签到页面', 'jingdong_sign', config.save_yolo_jingdong)
      let signBtn = widgetUtils.widgetGetOne('签到领豆')
      if (this.displayButtonAndClick(signBtn, '签到按钮')) {
        logUtils.debugInfo(['点击了签到按钮'])
        clicked = true
      } else {
        let region = [0, 0, config.device_width, config.device_height * 0.5]
        if (this.captureAndCheckByOcr('签到领豆', '领取按钮', region, null, true, 3)) {
          this.pushLog('OCR找到签到按钮：签到领豆')
          clicked = true
        } else {
          this.pushLog('未找到签到按钮 使用坐标点击')
          warnInfo('坐标点击签到不稳定，界面容易变化，请时刻注意坐标是否准确，否则可能导致签到失败。如果坐标不正确请在设置中修改坐标', true)
          FloatyInstance.setFloatyInfo({ x: jingdongConfig.sign_posi_x, y: jingdongConfig.sign_posi_y }, '坐标点击签到')
          sleep(1000)
          automator.click(jingdongConfig.sign_posi_x, jingdongConfig.sign_posi_y)
          clicked = true
        }
      }

      if (clicked) {
        // 二次校验是否正确签到
        checking = widgetUtils.widgetCheck('.*连签\\d+天', 1000)
        YoloTrainHelper.saveImage(commonFunctions.captureScreen(), '签到执行后', 'jingdong_sign', config.save_yolo_jingdong)
        if (!checking) {
          if (this.captureAndCheckByOcr('赚更多京豆', '赚更多京豆', null, null, false)) {
            checking = true
          }
        }
        if (checking) {
          this.setSubTaskExecuted(SIGN)
          this.pushLog('二次校验，签到完成')
        } else {
          this.pushLog('二次校验失败，签到未完成')
        }
      } else {
        YoloTrainHelper.saveImage(commonFunctions.captureScreen(), '未找到签到按钮', 'jingdong_sign', config.save_yolo_jingdong)
      }

      back()
    } else {
      this.pushErrorLog('打开签到页面失败')
    }
  }

  /**
   * 幸运奖励 稳定10豆子
   * @returns 
   */
  this.execLuckySign = function () {
    if (this.isSubTaskExecuted(LUCKY_SIGN)) {
      this.pushLog('幸运奖励已经执行过')
      return true
    }

    this.pushLog('执行幸运奖励')
    if (!openSignPage()) {
      this.pushErrorLog('进入签到页面失败')
      return false
    }
    if (verifySignOpened()) {
      // 等待加载动画
      sleep(1000)
      this.closePopup()
      let maxWait = 5
      this.pushLog('等待幸运奖励' + maxWait)
      let luckyRegion = null
      while (!(luckyRegion = this.captureAndCheckByOcr('幸运奖励', '幸运奖励')) && maxWait-- > 0) {
        sleep(1000)
        this.replaceLastLog('等待幸运奖励' + maxWait)
      }
      this.pushLog('查找是否存在 点击领取')
      let region = null
      if (luckyRegion) {
        region = widgetUtils.boundsToRegion(luckyRegion.bounds())
        region[3] = region[3] * 5
        warningFloaty.addRectangle('OCR检查区域', region)
      }
      if (this.captureAndCheckByOcr('点击领取', '点击领取', region, null, true)) {
        this.setSubTaskExecuted(LUCKY_SIGN)
      } else {
        this.pushLog('检查是否存在 已领取')
        if (this.captureAndCheckByOcr('已领取', '已领取', region)) {
          this.pushLog('当前已领取')
          this.luckySignFailedCounter.updateStorageValue(storeValue => storeValue.count = 0)
          this.setSubTaskExecuted(LUCKY_SIGN)
        } else {
          this.pushWarningLog('无法找到点击领取，暂时无法确定是否完成了签到')
          this.luckySignFailedCounter.updateStorageValue(storeValue => storeValue.count += 1)
          if (this.luckySignFailedCounter.getValue().count >= 3) {
            this.pushWarningLog('累计失败3次，跳过幸运签到，可能已经不存在该任务了')
            this.luckySignFailedCounter.updateStorageValue(storeValue => storeValue.count = 0)
            this.setSubTaskExecuted(LUCKY_SIGN)
            NotificationHelper.createNotification('幸运签到失败，可能没有该任务', '累计失败3次，跳过幸运签到，请手动检查', 'jingdong:luckysign')
          }
        }
      }
      back()
    } else {
      this.pushErrorLog('打开签到页面失败')
    }
  }

  this.execDrugSign = function () {
    if (this.isSubTaskExecuted(DRUG_SIGN)) {
      this.pushLog('已执行过买药签到')
      return true
    }
    this.pushLog('执行买药签到')
    let drugSigner = new DrugSigner()
    drugSigner.openDrugSignPage()
    drugSigner.checkDailySign()
    drugSigner.checkSimpleTask()
    // 任务完成后执行
    // this.setSubTaskExecuted(DRUG_SIGN)
  }

  /**
   * 执行种豆得豆
   *
   * @returns 
   */
  this.execPlantBean = function (doubleCheck) {
    if (this.isSubTaskExecuted(BEAN)) {
      this.pushLog('种豆得豆子任务已经执行过')
      return true
    }
    this.pushLog('执行种豆得豆')
    logUtils.debugInfo(['种豆得豆子任务信息{}', JSON.stringify(BEAN)])
    if (openPlant()) {
      if (this.doDailyTasks()) {
        // 完成后标记任务完成
        this.setSubTaskExecuted(BEAN)
      }
    } else {
      this.pushLog('打开种豆得豆失败')
    }

  }

  // 领取每周京豆奖励
  this.checkIfWeeklyReward = function () {
    let reward = widgetUtils.widgetGetOne('收下京豆', 1000)
    this.displayButtonAndClick(reward, '收下京豆')
  }


  this.doDailyTasks = function (reopen) {

    let skipTask = []

    function getNextExecuteTask (container) {
      let offset = 0
      try {
        let taskEntry = container.child(offset + 2)
        let taskTitleWidget = container.child(offset + 3)
        let taskTitle = taskTitleWidget.text()
        if (taskEntry.childCount() == 0) {
          _this.pushLog(taskTitle + '任务已经执行完毕，跳过处理')
          return { taskExecuteCount: '0' }
        }
        let taskExecuteCount = taskEntry.child(0).text()
        while (skipTask.indexOf(taskTitle) > -1 && offset + 2 < container.childCount()) {
          offset += 2
          taskEntry = container.child(offset + 2)
          taskTitleWidget = container.child(offset + 3)
          taskTitle = taskTitleWidget.text()
          if (taskEntry.childCount() == 0) {
            _this.pushLog(taskTitle + '任务已经执行完毕，跳过处理')
            return { taskExecuteCount: '0' }
          }
          taskExecuteCount = taskEntry.child(0).text()
        }
        if (skipTask.indexOf(taskTitle) > -1) {
          taskExecuteCount = '0'
          _this.pushWarningLog('所有任务重复，当前无可执行任务')
        } else {
          skipTask.push(taskTitle)
        }
        return { taskEntry, taskTitle, taskExecuteCount }
      } catch (e) {
        _this.pushErrorLog('提取任务信息异常' + e)
        commonFunctions.printExceptionStack(e)
        return { taskExecuteCount: '0' }
      }
    }
    // 校验入口并执行对应的任务，白名单维护
    while (true) {
      let taskAnchor = widgetUtils.widgetGetOne('好友助力', 2000)
      if (taskAnchor) {
        let { taskEntry, taskTitle, taskExecuteCount } = getNextExecuteTask(taskAnchor.parent())
        if (/0/.test(taskExecuteCount)) {
          this.pushLog('无可执行任务')
          break
        }
        this.pushLog('执行任务：' + taskTitle)
        if (taskTitle.indexOf('关注店铺') > -1) {
          this.pushLog('执行关注店铺任务')
          this.displayButtonAndClick(taskEntry, '关注店铺')
          doBrowseShop.apply(this)
        } else if (taskTitle.indexOf('双签') > -1) {
          this.pushLog('执行双签任务')
          this.displayButtonAndClick(taskEntry, '双签任务')
          this.doDoubleSign(taskEntry)
        } else if (taskTitle.indexOf('关注频道') > -1) {
          this.pushLog('执行关注频道任务')
          this.displayButtonAndClick(taskEntry, '关注频道')
          checkFollowChannel.apply(this)
        } else if (taskTitle.indexOf('健康免单') > -1) {
          this.pushLog('执行健康免单任务')
          this.displayButtonAndClick(taskEntry, taskTitle)
          let limit = 10
          this.pushLog('等待任务完成' + limit + 's')
          while (limit-- > 0) {
            sleep(1000)
            this.replaceLastLog('等待任务完成' + limit + 's')
          }
          automator.back()
          sleep(1000)
          this.captureAndCheckByOcr('离开会场', null, null, null, true)
        } else {
          this.pushLog('执行普通任务')
          this.displayButtonAndClick(taskEntry, taskTitle)
          let limit = 10
          this.pushLog('等待任务完成' + limit + 's')
          while (limit-- > 0) {
            sleep(1000)
            this.replaceLastLog('等待任务完成' + limit + 's')
          }
          this.backToPlant()
        }
        // 确保当前在种豆得豆界面
        this.ensurePlant()
        sleep(500)
      } else {
        this.pushErrorLog('无法找到 好友助力 按钮，关键信息锚点丢失，请检查')
        break
      }
    }
    // 最终执行收集操作
    this.backAndCollectAllReward()
    // 读取任务列表并执行操作
    return true
  }

  this.backToPlant = function () {
    automator.back()
    if (widgetUtils.widgetWaiting('我的收获值', 2000)) {
      return true
    } else {
      commonFunctions.minimize(_package_name)
      return openPlant()
    }
  }

  this.ensurePlant = function () {
    if (!widgetUtils.widgetCheck('我的收获值', 2000)) {
      this.pushWarningLog('当前不在种豆得豆界面')
      commonFunctions.minimize(_package_name)
      if (!openPlant()) {
        commonFunctions.killCurrentApp()
        openPlant()
      }
    }
  }

  this.backAndCollectAllReward = function () {
    if (!widgetUtils.widgetCheck('我的收获值', 2000)) {
      automator.back()
      sleep(1000)
      if (!widgetUtils.widgetCheck('我的收获值', 2000)) {
        this.pushWarningLog('未打开京豆界面')
        commonFunctions.minimize(_package_name)
        if (!openPlant()) {
          commonFunctions.killCurrentApp()
          openPlant()
        }
      }
    }
    // 计算下一次执行时间
    this.checkCountdownAndSetNext()
    // 执行收集
    this.doCollectBalls()
  }

  this.doCollectBalls = function () {
    let collectableBalls = null
    let countDown = new java.util.concurrent.CountDownLatch(1)
    this.pushLog('查找是否有可收集奖励')
    threads.start(function () {
      collectableBalls = selector().clickable().untilFind()
      countDown.countDown()
    })
    countDown.await(5, java.util.concurrent.TimeUnit.SECONDS)
    if (collectableBalls && collectableBalls.length > 0) {
      let hasCollectable = false
      balls = collectableBalls.map(target => {
        let childCount = target.childCount()
        let title = '', canCollect = false
        if (childCount == 3) {
          title = target.child(2).text()
          rewardText = target.child(1).text()
          canCollect = /\d+/.test(rewardText) && title.indexOf('明日领取') < 0
        } else if (childCount == 2) {
          rewardText = target.child(0).text()
          title = target.child(1).text()
          canCollect = /\+\d+/.test(rewardText) && rewardText != '+0' && title.indexOf('明日领取') < 0
        }
        return { title, canCollect, target: target }
      }).filter(target => target.canCollect).forEach(target => {
        hasCollectable = true
        this.displayButtonAndClick(target.target, '可收集' + target.title)
        let checkDialog = widgetUtils.widgetGetOne('开心收下', 1000)
        this.displayButtonAndClick(checkDialog, '开心收下')
        sleep(500)
      })
      if (hasCollectable) {
        return this.doCollectBalls()
      }
    } else {
      this.pushWarningLog('未找到任何可收集的奖励球')
    }
    return false
  }

  this.checkCountdownAndSetNext = function () {
    let collectCountdown = widgetUtils.widgetGetOne('.*剩(\\d{2}:?){3}', null, true)
    if (collectCountdown) {
      let countdown = collectCountdown.content
      let result = /(\d+):(\d+):(\d+)/.exec(countdown)
      let remain = parseInt(result[1]) * 60 + parseInt(result[2]) + 1
      FloatyInstance.setFloatyInfo({
        x: collectCountdown.target.bounds().centerX(),
        y: collectCountdown.target.bounds().centerY()
      }, '剩余时间：' + remain + '分')
      this.pushLog('检测到种豆得豆倒计时：' + remain + '分')
      this.pushLog('控件信息：' + countdown)
      sleep(1000)

      if (remain >= (jingdongConfig.plant_min_gaps || 120)) {
        let settingMinGaps = jingdongConfig.plant_min_gaps || 120
        logUtils.logInfo(['倒计时：{} 超过{}分，设置{}分钟后来检查', remain, settingMinGaps, settingMinGaps])
        remain = settingMinGaps
      }
      this.createNextSchedule(this.taskCode + ':' + BEAN.taskCode, new Date().getTime() + remain * 60000)
      this.hadSetSchedule = true
    } else {
      this.pushLog('未检测到倒计时，当前可能已经没有了')
      let currentHourOfDay = new Date().getHours()
      if (currentHourOfDay <= 21) {
        this.pushWarningLog('当前未到达夜间9点，可能单纯找不到控件，直接设置两小时的倒计时')
        this.createNextSchedule(this.taskCode + ':' + BEAN.taskCode, new Date().getTime() + 120 * 60000)
      }
    }
  }

  this.doDoubleSign = function (signBtn) {
    if (signBtn) {
      signBtn.click()
    }
    sleep(1000)
    if (this.checkDoubleCheckDone()) {
      this.setSubTaskExecuted(DOUBLE_SIGN)
      return this.backToPlant()
    }
    this.pushLog('等待自动打开京东金融签到界面')
    sleep(5000)
    this.pushLog('等待领金贴界面')
    if (widgetUtils.widgetCheck('签到领金贴')) {
      this.pushLog('进入领金贴界面')
      sleep(1000)
      this.pushLog('清除空间缓存')
      auto.clearCache && auto.clearCache()
      sleep(1000)
      // todo 双签逻辑
      let signBtn = widgetUtils.widgetGetOne('签到领金贴')
      this.displayButtonAndClick(signBtn, '签到领金贴')
    }
    this.pushLog('重新打开京东APP')
    _app.launchPackage(_package_name)
    sleep(1000)
    if (this.checkDoubleCheckDone()) {
      this.setSubTaskExecuted(DOUBLE_SIGN)
    }
    return this.backToPlant()
  }

  /**
   * @deprecated 该死的京东 又改了界面
   * @param {*} btns 
   * @returns 
   */
  this.findFirstAndDoTask = function (btns) {
    let taskInfo = btns.map(btn => { return { title: btn.parent().child(0).text(), btn: btn } }).find(task => {
      return _this.executedTaskList.indexOf(task.title) == -1
    })
    if (!taskInfo) {
      this.pushLog('当前任务都已经执行过')
      return false
    }
    let title = taskInfo.title
    this.executedTaskList.push(title)
    this.pushLog('找到了任务按钮 点击进入任务:' + title)
    taskInfo.btn.click()
    if (title.indexOf('关注店铺') > -1) {
      this.pushLog('执行关注店铺任务')
      doBrowseShop.apply(this)
      // 关注店铺任务
      return this.backToTaskDrawer()
    }
    let limit = 10
    this.pushLog('等待任务完成' + limit + 's')
    while (limit-- > 0) {
      sleep(1000)
      this.replaceLastLog('等待任务完成' + limit + 's')
    }
    return this.backToTaskDrawer()
  }

  this.backToTaskDrawer = function () {
    this.pushLog('返回任务抽屉')
    if (commonFunctions.myCurrentPackage() != _package_name) {
      this.pushLog('当前未打开京东APP')
      _app.launchPackage(_package_name)
      sleep(2000)
    }
    automator.back()
    sleep(1000)
    let limit = 5
    if (!widgetUtils.widgetCheck('.*做任务 得更多收获值.*', 2000)) {
      this.pushWarningLog("未能打开抽屉")
    }
    let success = false
    while (!(success = widgetUtils.widgetCheck('.*做任务 得更多收获值.*', 2000)) && limit-- > 0) {
      // 如果回到了种豆界面，尝试点击
      if (this.captureAndCheckByOcr('瓜分更多京豆|赚收获值', null, null, null, true)) {
        this.pushLog('找到了瓜分更多京豆')
        continue
      }
      // 回到了首页，直接校验并进入
      if ((descContains('首页').boundsInside(0, config.device_height * 0.8, config.device_width, config.device_height).findOne(1000))) {
        this.pushLog('当前在首页')
        openPlant()
        this.openTaskDrawer()
        continue
      }
      // 未知界面，继续返回
      this.replaceLastLog('尝试返回任务抽屉 触发返回' + limit)
      automator.back()
    }
    if (!success) {
      if (!openPlant()) {
        commonFunctions.killCurrentApp()
        openPlant()
      }
      return this.openTaskDrawer()
    }
    return true
  }

  this.openTaskDrawer = function () {
    if (widgetUtils.widgetCheck('.*做任务 得更多收获值.*', 2000)) {
      return true
    }
    if (this.captureAndCheckByOcr('瓜分更多京豆|赚收获值', null, null, null, true)) {
      this.pushLog('找到了瓜分更多京豆')
    } else {
      this.pushErrorLog('查找瓜分更多京豆失败')
      return false
    }
    return widgetUtils.widgetCheck('.*做任务 得更多收获值.*', 2000)
  }

  function doBrowseShop (limit) {
    limit = limit || 0
    if (limit >= 6) {
      this.pushLog('关注店铺个数过多 返回上级 检查是否已完成')
      return this.backToPlant()
    }
    let target = widgetUtils.widgetGetOne('进店并关注', 1000)
    if (this.displayButtonAndClick(target)) {
      this.pushLog('等待进入店铺页面')
      sleep(3000)
      if (this.displayButtonAndClick(widgetUtils.widgetGetOne('已关注'))) {
        this.pushLog('取消关注店铺')
        sleep(1000)
        this.displayButtonAndClick(widgetUtils.widgetGetOne('取消关注'))
        sleep(1000)
      }
      this.pushLog('返回关注店铺页面')
      automator.back()
      sleep(1000)
      return doBrowseShop.apply(this, [limit + 1])
    } else {
      return this.backToPlant()
    }
  }

  function checkFollowChannel () {
    widgetUtils.widgetWaiting('进入并关注')
    doFollowChannel.apply(this, [0])
    return this.backToPlant()
  }

  function doFollowChannel (limit) {
    limit = limit || 0
    if (limit > 3) {
      this.pushLog('关注频道过多 直接返回 重新校验是否有关注频道入口')
      return false
    }
    let target = widgetUtils.widgetGetOne('进入并关注', 1000)
    if (this.displayButtonAndClick(target)) {
      this.pushLog('等待进入频道页面')
      sleep(3000)
      if (this.displayButtonAndClick(widgetUtils.widgetGetOne('已关注'))) {
        this.pushLog('取消关注频道')
        sleep(1000)
      }
      this.pushLog('返回关注频道页面')
      automator.back()
      sleep(1000)
      return doFollowChannel.apply(this, [limit + 1])
    }
    return false
  }

  this.taskDialogOpened = function () {
    let target = widgetUtils.widgetGetOne('完成任务越多，瓜分京豆越多哦.*', 2000)
    if (target && target.bounds().height() > 0) {
      this.pushLog('检测到 任务抽屉已打开，退出重新进入种豆界面')
      commonFunctions.minimize()
      return true
    }
    return false
  }

  this.closePopup = function () {
    let okBtn = widgetUtils.widgetGetOne('.*知道了.*', 2000)
    if (okBtn) {
      okBtn.click()
      sleep(1500)
    }
  }

  this.doubleSign = function (recheck) {
    if (this.isSubTaskExecuted(DOUBLE_SIGN)) {
      this.pushLog('双签任务已执行')
      return
    }
    this.pushLog('执行双签任务')
    if (!openSignPage()) {
      this.pushLog('打开秒杀界面失败')
      if (!recheck) {
        commonFunctions.minimize()
        return this.doubleSign(true)
      }
    }
    if (this.captureAndCheckByOcr('赚更多京豆', null, null, null, true)) {
      this.pushLog('打开了赚更多京豆界面')
      let entered = this.captureAndCheckByOcr('双签领豆', null, null, null, true)
      let limit = 5
      while (limit-- > 0 && !entered && !(entered = this.captureAndCheckByOcr('双签领豆', null, null, null, true, 1))) {
        // 从底部向上滑动，直到找到目标控件
        automator.swipe(500, config.device_height - 300 * config.scaleRate, 500, 500 * config.scaleRate, 1000)
        sleep(100)
      }
      if (entered) {
        this.pushLog('打开了双签领豆界面')
        this.doDoubleSign(null)
      } else {
        this.pushErrorLog('未能找到双签领豆入口')
      }
    } else {
      this.pushErrorLog('未能找到赚更多京豆入口')
    }
  }


  this.checkDoubleCheckDone = function () {
    sleep(1000)
    this.pushLog('查找是否存在 点击领奖|查看奖励')
    let reward = widgetUtils.widgetGetOne('点击领奖|查看奖励', 3000)
    if (this.displayButtonAndClick(reward)) {
      sleep(1000)
      // 可能有需要点击领取的按钮
      if (this.displayButtonAndClick(widgetUtils.widgetGetOne('.*领取', 1000))) {
        sleep(1000)
      }
      return widgetUtils.widgetCheck('查看奖励', 2000)
    }
    return false
  }

  this.exec = function () {
    let failed = false
    // 京豆签到
    this.execDailySign()
    // 种豆得豆
    this.execPlantBean()
    // 京东买药
    this.execDrugSign()
    // 双签领豆
    this.doubleSign()
    // 幸运奖励
    this.execLuckySign()
    // 互动游戏
    new GameCenter().exec()
    // 每日任务
    new DailyTask().exec()

    this.setExecuted()
    if (failed) {
      if (this.retryTime++ >= 3) {
        this.pushLog('重试次数过多，签到失败')
        commonFunctions.minimize(_package_name)
        return
      }
      this.pushLog('关闭并重新打开京东APP，只支持MIUI手势')
      commonFunctions.killCurrentApp()
      sleep(3000)
      this.exec()
      return
    }
    commonFunctions.minimize(_package_name)
  }


  function DrugSigner () {
    let parentThis = _this
    this.openDrugSignPage = function () {
      _this.pushLog('准备打开京东买药页面，先最小化回到桌面')
      commonFunctions.minimize(_package_name)
      openDrugSignPage()
    }

    this.checkDailySign = function (recheck) {
      sleep(1000)
      let entrySuceess = false
      parentThis.pushLog('查找是否存在关闭弹窗按钮')
      let btn = selector().filter(node => {
        let bd = node.bounds();
        return bd.centerX() == config.device_width / 2 && bd.width() / bd.height() == 1 && bd.width() < 110 && bd.centerY() > config.device_height / 2 && bd.centerY() < config.device_height * 0.8
      }).findOne(2000)
      if (btn) {
        parentThis.pushLog('找到关闭弹窗按钮, 点击关闭')
        automator.clickCenter(btn)
      }
      if (parentThis.captureAndCheckByOcr('签到奖励|马上签到', '签到奖励', null, null, true)) {
        parentThis.pushLog('点击了签到奖励')
        sleep(1000)
        // 可能存在弹窗，二次校验是否存在入口
        if (parentThis.captureAndCheckByOcr('签到奖励|马上签到', '签到奖励', null, null, true)) {
          entrySuceess = true
        }
      } else {
        // TODO 关闭弹窗，或者通过弹窗进入
        let entry = widgetUtils.widgetGetOne('签到领京豆', 3000)
        entrySuceess = parentThis.displayButtonAndClick(entry, '签到领京豆')
      }

      if (entrySuceess) {
        sleep(1000)
        let signBtn = widgetUtils.widgetGetOne('签到领奖励')
        let signSuccess = false
        if (parentThis.displayButtonAndClick(signBtn, '签到领奖励')) {
          signSuccess = true
        } else {
          parentThis.pushErrorLog('无法通过控件获取 签到领奖励 尝试OCR获取')
          if (parentThis.captureAndCheckByOcr('签到领奖励', null, null, null, true)) {
            parentThis.pushLog('通过OCR找到了 签到领奖励按钮 直接点击')
            signSuccess = true
          }
        }

        if (!signSuccess) {
          parentThis.pushLog('未能找到签到领奖励，今日签到可能已完成，需要确保当前界面为 签到领奖励界面')
          if (widgetUtils.widgetCheck('您已连续签到.*', 2000)) {
            parentThis.pushLog('找到了关键控件，今日签到已完成')
            signSuccess = true
          } else if (parentThis.captureAndCheckByOcr('您已连续签到.*', null, null, null, false)) {
            parentThis.pushLog('OCR 找到关键信息')
            signSuccess = true
          }
        }
        if (signSuccess) {
          parentThis.pushLog('当前在签到领奖励界面，设置今日签到完成')
          parentThis.setSubTaskExecuted(DRUG_SIGN)
        } else {
          parentThis.pushErrorLog('无法确认当前是否在签到任务页面 等待重试')
          if (!recheck) {
            parentThis.pushWarningLog('重试签到')
            return this.checkDailySign(true)
          }
        }
      }
    }

    this.checkSimpleTask = function () {
      let limit = 3
      parentThis.pushLog('查找是否存在领奖励按钮')
      while (limit-- > 0 && parentThis.captureAndCheckByOcr('领奖励', '领取奖励', null, null, true)) {
        sleep(1000)
      }
      // TODO 完成每日任务
    }


    function openDrugSignPage () {
      // let url = 'openapp.jdmobile://virtual?params=' + encodeURIComponent(buildParams())
      // console.log('url:', url)
      // app.startActivity({
      //   action: 'android.intent.action.VIEW',
      //   data: url,
      //   packageName: 'com.jingdong.app.mall'
      // })
      if (openHome()) {
        sleep(2000)
        let drugEntry = widgetUtils.widgetGetOne('看病买药')
        if (_this.displayButtonAndClick(drugEntry, '看病买药')) {
          if (!widgetUtils.widgetWaiting('问问我|低价购|买药秒送')) {
            _this.pushLog('无法找到买药界面元素，打开失败')
            return false
          }
          return true
        }
      } else {
        _this.pushLog('打开失败')
      }
      return false

    }

    function buildUrlParams () {
      let params = [
        'utm_user=plusmember',
        'gx=RnAoFNvDvpxGHheQeSnihXDdWirjP_lfCFEYixY',
        'gxd=RnAoy2FdYDaPyM5EqI1xXgjvwH1850Q',
        'ad_od=share',
        'utm_source=androidapp',
        'utm_medium=appshare',
        'utm_term=Wxfriends_shareid86482f3fa7963bbd174053140530292934_none_none'
      ]
      console.log('url params:', JSON.stringify(params))
      return params.join('&')
    }


    function buildParams () {
      let params = {
        "category": "jump",
        "des": "m",
        "sourceValue": "babel-act",
        "sourceType": "babel",
        "url": "https://jdhm.jd.com/jdhhome/?" + buildUrlParams(),
        "M_sourceFrom": "H5",
        "msf_type": "click",
      }

      return JSON.stringify(params)
    }
  }

  function GameCenter() {
    let parentThis = _this

    this.exec = function () {
      if (parentThis.isSubTaskExecuted(GAME_CENTER)) {
        parentThis.pushLog('互动游戏任务已完成')
        return true
      }
      parentThis.pushLog('执行互动游戏任务')
      if (this.openGameCenter()) {
        return this.checkAndSign()
      }
      return false
    }

    this.openGameCenter = function () {
      if (openMine()) {
        let gameCenter = widgetUtils.widgetGetOne('互动游戏')
        if (parentThis.displayButtonAndClick(gameCenter, '游戏中心')) {
          sleep(1000)
          return widgetUtils.widgetWaiting('.*(互动游戏|海量京豆|已连续打卡|东东农场).*')
        } else {
          parentThis.pushErrorLog('无法点击互动游戏')
        }
      } else {
        parentThis.pushWarningLog('打开 我的 界面失败')
      }
      return false
    }

    this.checkAndSign = function () {
      parentThis.pushLog('查找是否存在签到按钮')
      let signBtn = widgetUtils.widgetGetOne('签到', 3000)
      if (parentThis.displayButtonAndClick(signBtn, '签到')) {
        parentThis.setSubTaskExecuted(GAME_CENTER)
        parentThis.pushLog('签到成功')
      } else {
        parentThis.pushWarningLog('未能找到签到按钮，可能已完成签到')
        // TODO 校验是否已完成签到
        if (widgetUtils.widgetCheck('已签', 3000)) {
          parentThis.setSubTaskExecuted(GAME_CENTER)
          parentThis.pushLog('今日已经签到成功')
        } else {
          parentThis.pushWarningLog('未能找到已签按钮')
        }
      }
    }
  }

  function DailyTask() {
    let parentThis = _this
    this.exec = function () {
      if (parentThis.isSubTaskExecuted(DAILY_TASK)) {
        parentThis.pushLog('每日任务已经执行完毕')
        return true
      }
      parentThis.pushLog('执行每日任务')
      if (this.openTaskPage()) {
        this.doTasks()
        this.checkTaskDone()
      }
    }

    this.openTaskPage = function () {
      if (openMine()) {
        sleep(1000)
        let beanCenter = widgetUtils.widgetGetOne('京豆可抵')
        let entered = false, limit = 3
        do {
          if (parentThis.displayButtonAndClick(beanCenter, '京豆可抵')) {
            entered = widgetUtils.widgetWaiting('.*(再领.*京豆).*')
          }
          if (!entered) {
            beanCenter = widgetUtils.widgetGetOne('京豆可抵')
          }
        } while(!entered && --limit > 0)
        if (!entered) {
          parentThis.pushErrorLog('进入每日任务界面失败')
        } else {
          return true
        }
      } else {
        parentThis.pushWarningLog('打开 我的 界面失败')
      }
      return false
    }

    this.ensureTaskPageOpened = function () {
      if (!widgetUtils.widgetCheck('再领.*京豆', 2000)) {
        parentThis.pushErrorLog('未能打开任务页面')
        // 尝试检测是否在上一层
        let beanCenter = widgetUtils.widgetGetOne('京豆可抵', 2000)
        if (parentThis.displayButtonAndClick(beanCenter, '京豆可抵')) {
          sleep(1000)
          return widgetUtils.widgetWaiting('.*(再领.*京豆).*')
        }
        commonFunctions.minimize()
        return this.openTaskPage()
      }
      return true
    }

    this.doTasks = function () {
      this.ensureTaskPageOpened()
      if (this.openDrawer()) {
        let collect = widgetUtils.widgetGetOne('领奖励', 1000)
        if (parentThis.displayButtonAndClick(collect)) {
          // 点击后就得重新关闭抽屉再打开，否则无法获取到控件信息😅
          let target = selector().clickable().depth(17).findOne(2000)
          if (target) {
            parentThis.pushLog('关闭抽屉，重新打开')
            target.click()
          } else {
            parentThis.pushWarningLog('无法找到关闭按钮')
            automator.back()
          }
          sleep(1000)
          return this.doTasks()
        }
        // 执行循环逛一逛任务
        let browseBtn = widgetUtils.widgetGetOne('逛一逛|去关注')
        if (parentThis.displayButtonAndClick(browseBtn)) {
          parentThis.pushLog('逛一逛5秒')
          let limit = 10
          while (!widgetUtils.widgetCheck('点击立即返回', 1000) && limit > 0) {
            parentThis.replaceLastLog('逛一逛中，等待' + --limit + 's')
          }
          automator.back()
          let target = selector().clickable().depth(17).findOne(2000)
          if (target) {
            parentThis.pushLog('关闭抽屉，重新打开')
            target.click()
          } else {
            parentThis.pushWarningLog('无法找到关闭按钮')
            automator.back()
          }
          sleep(1000)
          return this.doTasks()
        } else {
          parentThis.pushWarningLog('无法找到逛一逛按钮 可能任务执行完毕')
          if (widgetUtils.widgetCheck('去下单', 2000)) {
            parentThis.pushLog('任务执行完毕')
            parentThis.setSubTaskExecuted(DAILY_TASK)
          } else {
            parentThis.pushWarningLog('打开抽屉失败，关闭并重新打开')
            automator.back()
            sleep(1000)
            return //this.doTasks()
          }
        }
      }
    }

    this.openDrawer = function () {
      let target = widgetUtils.widgetGetOne('再领.*京豆')
      return parentThis.displayButtonAndClick(target)
    }

    this.checkTaskDone = function () {

    }
  }

  // ===== merged from JingDongBeans2 (v2): full fold — preserves BeanCollector2 behavior (JingDongSign2 subTasks + v2 exec/closePopup) =====
  let _app2 = new myApp(_this)
  // 覆写基类通用钩子：京东安全验证页(JDRiskHandleActivity 滑块/拼图)的处理。
  // 返回 true 表示确实关闭了安全验证弹窗；基类 pipeLine 据此累计 _riskCount，连续超限即放弃本任务避免反复回首页。
  this.退出快速验证 = function () {
    // 京东安全验证页(JDRiskHandleActivity：滑块/拼图验证码)无法用脚本求解，
    // 检测到就直接按返回键关闭界面即可，不需要复杂处理；返回 true 表示确实关掉了验证页。
    if (currentActivity().includes('JDRiskHandleActivity')) {
      logUtils.debugInfo(['退出快速验证：检测到安全验证弹窗，按返回键关闭'])
      automator.back()
      sleep(2000)
      return true
    }
    return false
  }
  this.task = config.supported_signs.find(task => {
    return ['JingDongSign2', ].includes(task.taskCode)
  })
  this.subTasks = this.task ? this.task.subTasks : []
  console.log('subTasks=',this.subTasks)
  const binSign = this.subTasks.filter(task => task.taskCode == 'binSign')[0]
  const plantBean = this.subTasks.filter(task => task.taskCode == 'plantBean')[0]
  const binTask = this.subTasks.filter(task => task.taskCode == 'binTask')[0]
  const SIGN = this.subTasks.filter(task => task.taskCode == 'beanSign')[0]
  const BEAN = this.subTasks.filter(task => task.taskCode == 'plantBean')[0]
  const DOUBLE_SIGN = this.subTasks.filter(task => task.taskCode == 'doubleSign')[0]
  const DRUG_SIGN = this.subTasks.filter(task => task.taskCode == 'drugSign')[0]
  const LUCKY_SIGN = this.subTasks.filter(task => task.taskCode == 'luckySign')[0]
  const GAME_CENTER = this.subTasks.filter(task => task.taskCode == 'gameCenter')[0]
  const DAILY_TASK = this.subTasks.filter(task => task.taskCode == 'dailyTask')[0]
  const fruits = this.subTasks.filter(task => task.taskCode == 'fruits')[0]
  this.loopCounter = this.createStoreOperator('loopCounter', { count: 0, maxCount: 20 })
  this.appIndex = 0
  const FIND_TIMEOUT = device.model == 'Redmi Note 5' ? 3500 : 2500
  const notifyOper = this.notifyOper()

  const HOME_PAGE_MSG =  {
    and: {
      '我的': [0, device.height*0.8, device.width, device.height*0.2],
      '购物车': [0, device.height*0.8, device.width, device.height*0.2],
      '消息|新品|逛': [0, device.height*0.8, device.width, device.height*0.2],
    }
  }
  function swipeLeftOrRight(left) {
    if (left) {
        swipe(device.width-200, device.height/2-100, 200, device.height/2, 1000)
    } else {
        swipe(200, device.height/2, device.width-200, device.height/2-100, 1000)
    }
    sleep(2000)
  }
  function clearByDesktopBtn(pkg) {
    home()
    sleep(2000)
    // for (let i=0;i<3;++i) {
    //   swipeLeftOrRight(1)
    // }
    let name = app.getAppName(pkg)
    let ele = widgetUtils.widgetGetOne(name, FIND_TIMEOUT)
    if (!ele) return
    automator.click(ele.bounds().centerX(), ele.bounds().centerY() - 360)
    _this.pushLog('已经清理进程')
  }
  // 框架级 openHome(failCount) 的子类实现点：本函数只负责「如何打开京东」
  // （启动+回到首页+登录校验）。轻/重复位决策由基类 openHome 根据 failCount 决定
  // （failCount<=NAV_RESET_THRESHOLD 走 backTo，否则 killCurrentApp+home+本函数）。
  this.launchApp = function () {
    let pkgName = _this.getPackage()
    _this.pushLog(`重开应用 当前package${pkgName},目标${_package_name}`)
    if (pkgName !== _package_name) {
      recents()
      sleep(2000)
      let ele = widgetUtils.widgetGetOne('本机共有.*', FIND_TIMEOUT)
      if (ele) {
        _this.displayButtonAndClick(ele, '清除进程')
        _this.pushLog('已清理进程')
      } else {
        clearByDesktopBtn(pkgName)
      }
    }
    if (commonFunctions.myCurrentPackage() != pkgName) {
      _app2.launchPackage(pkgName)
      _this.pushLog('打开京东APP')
      sleep(2000)
    }
    if (pkgName !== _package_name) { // blackbox
      let task = _this.getMainTask()
      for (let i=0;i<task.number;++i) {
        swipeLeftOrRight(1)
      }
      _this.clickText('京东', FIND_TIMEOUT, null, true)
      widgetUtils.widgetWaiting('首页', 30000)
    }
    let msg = HOME_PAGE_MSG
    _this.backTo(msg)
      let myWidget = descContains('首页').boundsInside(0, config.device_height * 0.8, config.device_width, config.device_height).findOne(1000)
    if (myWidget) {
      _this.pushLog('点击 首页 控件')
      let ret = _this.displayButtonAndClick(myWidget, '首页')
      sleep(3000)
      if (_this.findText('立即登录', null, FIND_TIMEOUT, 1, 1)) {
        notifyOper.appendMsg('未登陆\n')
        throw new Error('未登陆')
      }
      return true
    }
      return false
  }

  // 保留原 openHome() 调用语义（初始确保打开京东）：委托给框架 openHome(0)
  function openHome () {
    return _this.openHome(0)
  }
  this.backToHome = function() {
    this.backTo(HOME_PAGE_MSG)
  }
  this.getPackage = function () {
    let task = this.getMainTask()
    let pkg = (task&&task.package) || _package_name
    if (pkg.includes(',')) {
      for (let tmp of pkg.split(',')) {
        let name = app.getAppName(pkg)
        if (name) {
          task.package = tmp
          task.packageName = name
          pkg = tmp
          break
        }
      }
    }
    return pkg
  }
  this.getDialogText = function () {
    if (this.findText('.*可抵.*')) {
      return '离开会场|开心收下|立即领取|狠心离开|残忍退出|继续寻宝|我?知道了|.*领奖|直接退出|关闭任务面板|关闭弹窗｜签到.*|.*立即返回'
    }
    if (this.findText('种豆得豆')) {
      return '离开会场|开心收下|立即领取|狠心离开|残忍退出|继续寻宝|我?知道了|直接退出|关闭任务面板|关闭弹窗｜签到.*|领京豆|.*立即返回'
    }
    return '离开会场|开心收下|立即领取|狠心离开|残忍退出|继续寻宝|我?知道了|.*领奖|直接退出|关闭任务面板|关闭弹窗｜签到.*|.*立即返回'
  }
  this.getTimeout = function () {
    return FIND_TIMEOUT
  }

  this.testf = function () {
    this.京喜领京豆()
    sleep(5000)
    exit()
  }

  this.exec = function () {
    /**
     * 京东签到任务主流程：
     * 按顺序执行以下任务：
     * 1. getUserInfo() - 获取用户信息（账号、快递等）
     * 2. binSignTask() - 秒杀京豆签到任务
     * 3. binDayTask() - 秒杀京豆每日任务（做任务领京豆）
     * 4. plantBeanTask() - 种豆得豆任务
     * 5. plantFruit() - 东东农场任务
     * 6. 京喜领京豆() - 京喜自营领京豆任务
     * 7. 天天领红包() - 天天领红包任务
     *
     * 每次运行前会检查运行次数，超过maxCount则不执行
     * 若遇到"未登陆"错误会跳过而不是抛出异常
     */
    this.setApp(_app2)
    if (this.test) {
      this.setTest()
      // this.testf()
    }
    home()
    sleep(500)
    home()
    sleep(2000)
    const loopValue = this.loopCounter.getValue()
    this.pushLog('运行次数：'+loopValue.count)
    if (loopValue.count > loopValue.maxCount) {
      return
    }
    this.loopCounter.updateStorageValue(storeValue => storeValue.count += 1)
    try {
      this.getUserInfo()
      this.binSignTask()
      this.binDayTask()
      this.binDayTask2()
      this.plantBeanTask()
      this.plantFruit()
      this.京喜领京豆()
      this.天天领红包()
      //this.exec()
    } catch(err) {
      if (err.message !== '未登陆') {
        throw err
      }
    }
  }
  this.getUserInfo = function () {
    /**
     * 获取用户信息流程：
     * 1. 调用openHome()打开京东首页并初始化
     * 2. 在"我的"区域查找"我的"按钮并点击
     * 3. 等待"红包"出现确认进入我的页面
     * 4. 查找"头像"获取账号信息（昵称等）
     * 5. 查找"待收货"查看快递信息
     * 6. 遍历快递列表获取快递状态（等待收货/申请退款/确认收货）
     * 7. 返回首页
     */
    if (!openHome()) {
      _this.pushLog('打开京东失败')
      return
    }
    this.pushLog('获取用户信息')
    let lst = [
      {
        region: HOME_PAGE_MSG.and.我的,
        text: '我的',
        waitFor: ['红包',],
        sleep: (info) => {
          sleep(2000)
          let ele = this.findText('头像', [0,0, device.width, device.height*0.3], FIND_TIMEOUT, 1, 1)
          if (ele) {
            [a,b,c,d]  = [ele.bounds().right, ele.bounds().top, device.width*0.8, ele.bounds().bottom]
            _this.addRectangle('账号信息', [a,b,c-a,d-b])
            txt = boundsInsideText(a,b,c,d, null, null)
            this.pushLog('账号信息:'+txt)
          }
          notifyOper.appendMsg('账号：' + txt+'\n')
          ele = this.findText(/待收货.*/, null, FIND_TIMEOUT)
          if (!ele) {
              return
          }
          if (ele.parent&&ele.parent()) {
            txt = _this.allText(ele.parent())
          } else {
            a=ele.bounds().left-20, b=ele.bounds().top-20,
            c = ele.bounds().right-20, d = ele.bounds().bottom+20
            txt = boundsInsideText(a,b,c,d)
          }
          if (!txt.match(/\d+/)) {
              logUtils.debugInfo(['没有待收货, {}', txt])
              this.clickText('首页', FIND_TIMEOUT, null, true)
              return
          }
          this.displayButtonAndClick(ele, '待收货')
          sleep(FIND_TIMEOUT)
          let lst = textMatches(/等待收货|申请退款|确认收货/).find() || descMatches(/等待收货|申请退款|确认收货/).find()
          for (let i=0;i<lst.length;i+=2) {
            if (!lst[i] || !lst[i+1]) continue
            let bi = null, bj = null
            try { bi = lst[i].bounds(); bj = lst[i+1].bounds() } catch (e) { continue }
            [a,b,c,d] = [0, bi.bottom, device.width, bj.top]
            txt = boundsInsideText(a,b,c,d)
            console.log(txt)
            notifyOper.appendMsg('快递：' + txt + '\n')
          }
          this.backTo(HOME_PAGE_MSG)
          this.clickText('首页', FIND_TIMEOUT, null, true)
        }
      },
    ]
    this.pipeLine(lst)
  }
  this.closePopup = function () {
    if (this.closeDialogByImage()) {
      return true
    }
    // 常规手段（X图标/文字/YOLO）关不掉时，LLM 视觉兜底定位关闭按钮
    return _this.llmClosePopupFallback('closePopup')
  }
  /**
   * LLM 视觉兜底：多模态模型定位弹窗关闭按钮并点击。
   * 仅当 llmVision.isEnabled() 为 true 时生效；任何失败都返回 false，调用方继续走原有逻辑。
   * @param scene 场景标识，仅用于日志
   * @returns 是否执行了 LLM 定位并点击（点了不代表一定关成功，由调用方复检）
   */
  this.llmClosePopupFallback = function (scene) {
    if (!llmVision || !llmVision.isEnabled()) {
      return false
    }
    let btn = null
    try {
      btn = llmVision.findCloseButton()
    } catch (e) {
      _this.pushLog(`[LLM] ${scene} 调用异常：${e}，回落原逻辑`)
      return false
    }
    if (!btn) {
      _this.pushLog(`[LLM] ${scene} 定位失败（网络/解析/预算），回落原逻辑`)
      return false
    }
    if (btn.hasPopup === false) {
      _this.pushLog(`[LLM] ${scene} 模型判断当前无弹窗`)
      return false
    }
    _this.pushLog(`[LLM] ${scene} 定位关闭按钮 (${btn.x},${btn.y}) ${btn.description}`)
    automator.click(btn.x, btn.y)
    sleep(1500)
    return true
  }
  function doBeanSign() { 
    let lst = [
      {
        region: [1,1,device.width-1, device.height * 0.5],
        text: '秒杀',
        waitFor: ['(京豆)?可抵',],
        sleep: function (info) {
          sleep(5000)
          if (_this.clickText('点击领取', FIND_TIMEOUT, info.region, true)) {
            _this.closeDialogByImage(null, 1)
          }
        }
      },
      {
        id: '(home)?SignButton',
        text: /签到领豆|赚更多.*?|赚京豆/,
        region: [0,0,device.width, device.height * 0.5],
        waitFor: ['(做任务|立即|明细).*'],
        sleep: function(info) {
          if (_this.findText(info.waitFor[0], null, FIND_TIMEOUT)) {
            sleep(1000)
            return
          }
          _this.clickText(info.text, FIND_TIMEOUT, info.region, true)
        }
      },
    ]
    return lst
  }
  this.binSignTask  = function () {
    /**
     * 京豆签到任务流程：
     * 1. 检查是否已执行过（isSubTaskExecuted），今日已完成则跳过
     * 2. 调用doBeanSign()执行签到：
     *    2.1 调用openHome()打开京东首页
     *    2.2 在首页上半部分查找"秒杀"入口并点击
     *    2.3 等待5秒让页面加载
     *    2.4 查找签到按钮（id含SignButton或text匹配"签到领豆|赚更多|赚京豆"）
     *    2.5 点击签到按钮
     * 3. 任务完成后标记为已执行（setSubTaskExecuted）
     */
    if (this.isSubTaskExecuted(binSign)) {
      this.pushLog('今日已完成签到')
      return true
    }
    if (!openHome()) {
      _this.pushLog('打开京东失败')
      return
    }
    let lst = doBeanSign()
    this.pipeLine(lst)
    if (lst&&lst[1].find&&binSign) {
      this.setSubTaskExecuted(binSign)
    }
  }
  this.binDayTask = function () {
    /** 秒杀京豆每日任务（做任务领京豆）。导航自愈由框架 pipeLine + openHome 接管，不再整段重跑。 */
    if (this.isSubTaskExecuted(binTask)) {
      this.pushLog('今日已完成京豆任务')
      return true
    }
    this.pushLog('开始京豆任务')
    let txtInTaskPage = '.*\\+\\d次|可抵.*'
    if (!openHome()) {
      _this.pushLog('打开京东失败')
      return
    }
    let key = `signTaskCount${this.appIndex}`
    that = this
    let lst = doBeanSign().concat([
      {
        region: [0,0,device.width, device.height * 0.4],
        text: '全?部任务',
        waitFor: ['签到日历',],
        sleep: function (info) {
          sleep(FIND_TIMEOUT)
        },
        notFound: function (info) {
          let ele = _this.findText('箭头|签到日历', [device.width/2, device.height*0.1, device.width/2, device.height*0.3], FIND_TIMEOUT)
          if (!ele) {
            _this.pushLog('未找到"箭头"或"签到日历"')
            return
          }
          let x = ele.bounds().centerX()
          let y = ele.bounds().centerY() + 350
          _this.displayButtonPoint({x,y}, '全部任务', null, true)
          return null
        }
      },
      {
        beforeFind: function () {
          let anchor = _this.findText(lst[2].waitFor[0], null, FIND_TIMEOUT) // 签到日历
          if (!anchor) {
            return false // 重启任务
          }
          for (let i=0;i<2;++i) {
            anchor = _this.findText(this.text+'|已刮卡', _this.bounds2Region(this.boundsInside), FIND_TIMEOUT) // 去完成|去浏览|去刮卡
            if (anchor) {
              break
            }
            _this.action(lst[2])
          }
          if (!anchor) {
            return false // 重启任务
          }
          let cx = device.width / 2
          let baseY = device.height * 0.8
          if (this.endCount > 0) {
            // 上一轮没有可点任务：可见范围内已无可做任务，向上滚动加载后续任务
            _this.swipeWidget([cx, baseY, `天天领豆列表${this.endCount}`], -10, -300)
          } else {
            // 上一轮点过任务或首轮：先上滑再下滑回原位，刷新当前可视区（让刚完成的任务重渲染）
            _this.swipeWidget([cx, baseY, `天天领豆列表${this.endCount}`], -10, -300)
            sleep(800)
            _this.swipeWidget([cx, baseY, `天天领豆列表${this.endCount}`], 10, 300)
          }
          if (this.endCount === undefined) {
            let anchor = _this.findText('.*\\+1次', null, FIND_TIMEOUT)
            if (anchor && anchor.parent && anchor.parent()) {
              let b = anchor.parent().bounds()
              this.boundsInside = [0, b.top, device.width, device.height]
            }
          }
          sleep(1000)
          return true
        },
        boundsInside: [0, device.height*0.4, device.width, device.height],
        text: '去完成|去浏览|去刮卡',
        backTo: {
          '签到日历|可抵.*': [0, device.height*0.1, device.width, device.height*0.4],
          and: HOME_PAGE_MSG.and,
        },
        ocr: true,
        blackList: ['订阅', '通过1关', '访问互动', '我的', '更多', ],
        repeatList: [],
        backToWait: '继续浏览.*',
        end: false,
        timeout: device.model == 'Redmi Note 5' ? 4500 : 3500,
        parent: null,
        emptyCount:0,
        taskCount: {max:3,},
        loopFilter: _this.finishTasks,
        maxLoop: 50,
        sleep:  function(info) {
          _this.loopCounter.updateStorageValue(storeValue => {
            storeValue[key] = storeValue[key]?storeValue[key]+1:1
          })
          if (_this.clickText('立即刮卡', FIND_TIMEOUT, null, true)) {
            sleep(FIND_TIMEOUT+1000)
            _this.action(lst[2])
            sleep(FIND_TIMEOUT)
            return
          }
          sleep(info.timeout)
          倒计时(info, _this)
          if (_this.clickText('^(马上签到|领)$', FIND_TIMEOUT, null, true)) {
            sleep(info.timeout)
            _this.clickText('签到领京豆', FIND_TIMEOUT, null, true)
          }
          if (info.hasPop) {
            _this.closeDialogByImage(null, 1)
          } else {
            _this.closeDialogByImage(null, 0)
          }
        },
      },
    ])
    this.pipeLine(lst)
    if (lst[3].end&&binTask) {      
      this.setSubTaskExecuted(binTask)
    }
    let count = this.loopCounter.getValue()[key]||0
    notifyOper.appendMsg(`秒杀任务数量：${count}\n`)
    this.backTo(HOME_PAGE_MSG)
    this.pushLog('结束京豆任务')
  }
  this.handlePointProductsTask = function () {
    let btn = _this.findTextOcr('点2个商品|再点.*个', '点2个商品浮动按钮')
    if (!btn || btn.length === 0) return
    _this.pushLog('检测到"点2个商品"浮动按钮，开始完成商品点击任务')
    let category = _this.findTextOcr('京豆抵现金', '京豆抵现金分类')
    let topY = device.height * 0.75
    if (category && category.length > 0) {
      topY = category[0].bounds().bottom + 20
    }
    for (let i = 0; i < 2; i++) {
      let images = className('android.widget.ImageView').clickable(true).boundsInside(0, topY, device.width, device.height).find()
      if (images && images.size() > 0) {
        let img = images.get(0)
        let b = img.bounds()
        automator.click(b.centerX(), b.centerY())
        sleep(FIND_TIMEOUT + 3000)
        _this.backTo('天天领豆', 'com.jd.lib.babel.view.activity.BabelActivity')
        sleep(FIND_TIMEOUT)
      }
    }
    if (_this.clickText('点击领取', FIND_TIMEOUT, null, true)) {
      sleep(FIND_TIMEOUT)
      _this.pushLog('已领取"点2个商品"任务奖励')
    }
  }
  this.binDayTask2 = function () { 
    if (this.isSubTaskExecuted(binTask)) {
      this.pushLog('今日已完成京豆任务')
      return true
    }
    this.pushLog('开始京豆任务2')
    if (!openHome()) {
      _this.pushLog('打开京东失败')
      return
    }
    let textInTasklist = '去完成|已刮卡|去浏览'
    let key = `signTaskCount${this.appIndex}`
    that = this
    let lst = doBeanSign().concat([
      {
        // 导航自愈时只跑 beforeFind（回到天天领豆页），不跑 action（避免误点「京喜领豆」钻进子页）
        resetReplay: false,
        beforeFind: function () {
          _this.backTo('天天领豆', 'com.jd.lib.babel.view.activity.BabelActivity')
          if (_this.clickText('明细',FIND_TIMEOUT, [0,0, device.width, device.height*0.3], true)) {
          _this.clickText('明细',FIND_TIMEOUT, [0,0, device.width, device.height*0.3], true)
          _this.backTo('天天领豆', 'com.jd.lib.babel.view.activity.BabelActivity')
          }
          sleep(FIND_TIMEOUT)
          return true
        },
        region: [0,device.height * 0.1,device.width, device.height * 0.5],
        text: '.*领京豆',
        waitFor: ['查看明细|记录',],
        sleep: function (info) {
          sleep(FIND_TIMEOUT)
          _this.handlePointProductsTask()
        },
        notFound: function (info) {
          let text = '全?部任务'
          let ele = _this.findText(text, this.region, FIND_TIMEOUT)
          if (!ele) return ele
          let x = 140
          let y = ele.bounds().centerY() - 10
          for (let i=0;i<2&&ele;++i) {
            _this.displayButtonPoint({x,y}, '领京豆', null, true)
            sleep(FIND_TIMEOUT)
            if (_this.findText(this.waitFor[0], null, FIND_TIMEOUT)) {
              break
            }
          }
          return null
        }
      },
      {
        region: [0,0,device.width, device.height * 0.4],
        text: '全?部任务',
        waitFor: [textInTasklist,],
        sleep: function (info) {
          sleep(FIND_TIMEOUT)
        },
        notFound: function (info) {
          let ele = _this.findText('记录', [device.width/2, device.height*0.2, device.width/2, device.height*0.3], FIND_TIMEOUT)
          if (!ele) {
            _this.pushLog('未找到"记录"')
            return
          }
          let x = ele.bounds().centerX()
          let y = ele.bounds().centerY() - 140
          this.point = {x,y}
          _this.displayButtonPoint({x,y}, '全部任务', null, true)
          return null
        }
      },
      {
        openTaskList: function () {
          logUtils.debugInfo(['openTaskList begin {}', currentActivity()])
          let region = _this.bounds2Region(this.boundsInside)
          for (let i=0;i<3;++i) {
            _this.action(lst[3]) // 全部任务
            sleep(FIND_TIMEOUT)
            if (_this.findText(textInTasklist, region, FIND_TIMEOUT)) {
              break
            }
            _this.backTo(this.backTo)
          }
          logUtils.debugInfo(['openTaskList end'])
        },
        beforeFind: function () {
          if (!_this.findText('查看明细|记录', null, FIND_TIMEOUT)) {
            if (!_this.findText('签到日历', null, FIND_TIMEOUT)) {
              return false // 重启任务
            }
            _this.action(lst[2]) // 领京豆
          }
          let region = _this.bounds2Region(this.boundsInside)
          let anchor = _this.findText(textInTasklist, region, FIND_TIMEOUT) // .*加1次.*
          if (!anchor) {
            this.openTaskList()
            anchor = _this.findText(textInTasklist, region, FIND_TIMEOUT)
            if (!anchor) return false
          }
          let cx = device.width / 2
          let baseY = device.height * 0.8
          if (this.endCount > 0) {
            // 上一轮没有可点任务：可见范围内已无可做任务，向上滚动加载后续任务
            _this.swipeWidget([cx, baseY, `京豆列表${this.endCount}`], -10, -300)
          } else {
            // 上一轮点过任务或首轮：先上滑再下滑回原位，刷新当前可视区（让刚完成的任务重渲染）
            _this.swipeWidget([cx, baseY, `京豆列表${this.endCount}`], -10, -300)
            sleep(800)
            _this.swipeWidget([cx, baseY, `京豆列表${this.endCount}`], 10, 300)
          }
          if (this.endCount === undefined) {
            if (anchor && anchor.parent && anchor.parent()) {
              let b = anchor.parent().bounds()
              this.boundsInside = [0, b.top, device.width, device.height]
            } else {
              let top = lst[3].node?lst[3].node.bounds().bottom:(lst[3].point?lst[3].point.y:this.boundsInside[1])
              this.boundsInside[1] = top
            }
          }
          sleep(1000)
          return true
        },
        boundsInside: [0, device.height*0.4, device.width, device.height],
        text: '.*(去完成|去浏览|去刮卡)',
        backTo: {
          '查看明细|记录': [0, device.height*0.1, device.width, device.height*0.4],
          and: HOME_PAGE_MSG.and,
        },
        ocr: true,
        blackList: ['订阅', '通过1关', '访问互动', '我的', '更多', '参与1局' ],
        maxLoop: 50,
        repeatList: [],
        backToWait: '继续浏览.*',
        end: false,
        timeout: device.model == 'Redmi Note 5' ? 4500 : 3500,
        parent: null,
        emptyCount:0,
        taskCount: {max:3,},
        loopFilter: _this.finishTasks,
        sleep:  function(info) {
          _this.loopCounter.updateStorageValue(storeValue => {
            storeValue[key] = storeValue[key]?storeValue[key]+1:1
          })
          sleep(FIND_TIMEOUT)
          if (_this.clickText('立即刮卡', FIND_TIMEOUT, lst[3].region, true)) {
            sleep(FIND_TIMEOUT+1000)
            this.openTaskList()
            return
          }
          sleep(info.timeout)
          倒计时(info, _this)
          if (_this.clickText('^(马上签到|领)$', FIND_TIMEOUT, null, true)) {
            sleep(info.timeout)
            _this.clickText('签到领京豆', FIND_TIMEOUT, null, true)
          }
          if (info.hasPop) {
            _this.closeDialogByImage(null, 1)
          } else {
            _this.closeDialogByImage(null, 0)
          }
        },
      },
    ])
    this.pipeLine(lst)
    if (lst[4].end&&binTask) {      
      this.setSubTaskExecuted(binTask)
    }
    let count = this.loopCounter.getValue()[key]||0
    notifyOper.appendMsg(`秒杀任务数量：${count}\n`)
    this.backTo(HOME_PAGE_MSG)
    this.pushLog('结束京豆任务')
  }
  this.plantBeanTask = function () {
    /**
     * 种豆得豆任务流程：
     * 1. 检查是否已执行过，今日已完成则跳过
     * 2. 调用openHome()打开京东首页（框架级，导航自愈接管）
     * 4. 点击"种豆得豆"入口进入
     * 5. 处理可能的弹窗（如"有人夺取"收获值弹窗）
     * 6. 如果是周一且9点后，收取上期京豆
     * 7. 处理可能的领奖弹窗
     * 8. 点击"赚收获值"进入任务列表
     * 9. 循环执行可完成的任务：
     *    9.1 查找"去逛逛|去领取|去签到|去看看|逛一逛|去关注|去完成"类任务
     *    9.2 获取任务描述，判断是否在黑名单中（好友助力/最牛挑战/提醒/百度/首页）
     *    9.3 关注频道/关注店铺任务需要特殊处理（进入并关注6次）
     *    9.4 普通任务：点击执行，等待超时，处理倒计时（继续浏览N）
     *    9.5 任务完成后返回任务列表
     * 10. 任务完成后调用collectBeanTask()收取分数气泡（+10/+15/+20等）
     * 11. 调用collectBeanFriends()收取好友偷的水滴
     * 12. 返回首页
     */
    let task = plantBean
    if (this.isSubTaskExecuted(task)) {
      this.pushLog('今日已完成京豆任务')
      return true
    }
    if (!openHome()) {
      _this.pushLog('打开京东失败')
      return
    }
    this.pushLog('开始种豆得豆')
    let txtInTaskPage = '做任务.*?收获值'
    let that = this
    let finished = false
    let key = `beanTaskCount${this.appIndex}`
    let lst = [
      {
        region: [0,0, device.width, device.height*0.5],
        text: '种豆得豆',
        waitFor: ['赚收获值',],
        // backTo: '秒杀',
        sleep:  (info) => {
          sleep(_this.getTimeout())
          // 「有人夺取」弹窗：标题是图片渲染(控件树无"有人夺取"文本)，仅「点击领奖」是原生按钮；
          // 旧 closeDialog 固定点(width-80,250) 打空(真实关闭X在~y165且非原生控件)，这里直接点「点击领奖」领取并关闭弹窗
          _this.clickText('点击领奖.*', 6000, [0, device.height*0.4, device.width, device.height*0.5], true)
          let dt = new Date()
          if (dt.getDay() === 1 && dt.getHours() > 9) {
            // 收上期
            // myutil.clickText(/上期/)
            if (_this.findText('TZ4l9U.*', null, FIND_TIMEOUT, 2)) {
              _this.clickText('收下京豆', FIND_TIMEOUT, null, true)
              sleep(_this.getTimeout())
            } else if (_this.clickText('收下京豆', FIND_TIMEOUT, null, true) ) {                
              sleep(_this.getTimeout())
            }
          }
          if (_this.clickText('点击领奖.*', 5000, [0,device.height*0.5, device.width, device.height*0.3], true)) {
            sleep(2000)
            _this.closeDialogByImage(null, 2)
            _this.clickText('明天继续.*|我知道了', 5000, [0,device.height*0.5, device.width, device.height*0.3], true)
          }
          _this.closeDialogByImage(null, 2, null, null, [device.width-180, 200, device.width, device.height*0.4])
          // 2026-09-21 修复：关闭种豆得豆签到弹窗（WebView 渲染，closeDialogByImage 无法关闭）
          // 签到弹窗含"明天继续来领"文字，关闭按钮在弹窗右上角（WebView 内渲染）
          let signPopup = _this.findTextOcr('明天继续.*领', '明天继续来领')
          if (signPopup && signPopup.length > 0) {
            let b = signPopup[0].bounds()
            _this.pushLog('检测到种豆得豆签到弹窗，点击右上角关闭')
            // 关闭按钮在弹窗右上角：水平接近屏幕右边缘，垂直在弹窗文字上方
            automator.click(Math.round(device.width * 0.94), Math.round(b.top - device.height * 0.07))
            sleep(1500)
            // 复检：固定坐标没关掉（改版/偏移）时，LLM 视觉兜底重新定位关闭按钮
            if (_this.findTextOcr('明天继续.*领', '种豆签到弹窗复检')) {
              _this.llmClosePopupFallback('种豆签到弹窗')
            }
          }
        }
      },
      {
        region: [device.width*0.4,device.height*0.4, device.width*0.6, device.height * 0.4],
        text: '赚收获值',
        ocr: true,
        waitFor: [txtInTaskPage,],
        notFound: function() {
          let ele = _this.findText('好友助力', [0,device.height*0.3, device.width, device.height * 0.4], FIND_TIMEOUT, 2)
          if (!ele) {
            return null
          }
          let bounds = ele.bounds()
          bounds.left = device.width - 200
          bounds.right = device.width
          return _this.wrapOcrPointWithBounds(bounds, '赚收获值')
        },
        timeout: device.model == 'Redmi Note 5' ? 4500 : 2000,
      },
      {
        boundsInside: [0, device.height*0.3, device.width, device.height],
        beforeFind: function () {
          // 2026-07-24 修复：先确认确实在种豆任务列表内（找得到 txtInTaskPage），
          //   若找不到说明页面已丢失（被弹窗顶走/回退到首页/App 被重启），
          //   尝试通过前缀重进（点"种豆得豆"→"赚收获值"），仍进不去则 return false，
          //   交给 pipeLine 的 openHome/_navRecover 重新进入，而不是永远返回 true 导致死循环或回退逃逸。
          let ele = _this.findText(txtInTaskPage, null, FIND_TIMEOUT)
          if (!ele) {
            _this.pushLog('beforeFind: 任务列表内未找到，尝试重进种豆任务')
            if (_this.clickText('种豆得豆', FIND_TIMEOUT, lst[0].region, true)) {
              sleep(FIND_TIMEOUT)
              _this.clickText('赚收获值', FIND_TIMEOUT, lst[1].region, true)
              sleep(FIND_TIMEOUT)
            }
            ele = _this.findText(txtInTaskPage, null, FIND_TIMEOUT)
            if (!ele) {
              return false  // 仍进不去：交给外层导航自愈
            }
          }
          this.boundsInside[1] = ele.bounds().bottom
          // 滚动刷新可视区（保留原逻辑）
          let sw = [device.width / 2, device.height * 0.8, `种豆任务列表${this.endCount}`]
          _this.swipeWidget(sw, -10, -300)
          if (!(this.endCount > 0)) {
            sleep(1000)
            sw = [device.width / 2, device.height * 0.8 - 300, `种豆任务列表${this.endCount}`]
            _this.swipeWidget(sw, 10, 300)
          }
          sleep(1000)
          return true
        },
        text: '去逛逛|去领取|去签到|去看看|逛一逛|去关注|去完成',
        backTo: {
          '做任务.*': [0, 0, device.width, device.height*0.5], // txtInTaskPage
          and: HOME_PAGE_MSG.and,
          '我的收获值.*': [0, 0, device.width, device.height*0.5],
        },
        blackList: ['好友助力', '最牛挑战', '提醒', '百度','首页', '通过1关', '打1局'],
        taskCount: {max:3,},
        desc: '', // 任务描述内容
        end: false,
        timeout: device.model == 'Redmi Note 5' ? 12000 : 12000,
        loopFilter:  this.finishTasks,
        sleep:  (info) => {
          _this.loopCounter.updateStorageValue(storeValue => {
            storeValue[key] = storeValue[key]?storeValue[key]+1:1
          })
          _this.pushLog(`sleep ${info.timeout}`)
          let name = ['关注频道', '关注店铺'].filter(item => info.desc.includes(item))
          if (name.length > 0) {
            name = name[0]==='关注频道'?'进入并关注':'进店并关注'
            widgetUtils.widgetWaiting(name, '等待页面加载', 30000)
            for (let i=0;i<6;i++) {
              _this.clickText(name, FIND_TIMEOUT, null, true)
              sleep(3000)
              this.backTo(name)
              sleep(1000)
            }
            return
          }
          sleep(info.timeout)
          倒计时(info, _this)
        },
        collect: (info) => {
          automator.click(device.width/2, 100)
          // 守护豆田"开保护罩"弹窗（右上角 ×）会挡住收分和采摘
          // 弹窗文案"58:51后自动打开..."OCR 常识别不到；优先 LLM 定位关闭按钮，失败回落固定位置连续点
          if (!_this.llmClosePopupFallback('守护豆田保护罩弹窗')) {
            for (let i = 0; i < 3; i++) {
              automator.click(device.width - 70, 180)
              sleep(500)
            }
          }
          // 收尾先关一次弹窗：扩到 1|2|16 覆盖中下/右上/中下横条，避免进入时残留的「开心收下」挡住收分
          _this.closeDialogByImage(null, 1|2|16)
          sleep(2000)
          _this.closeDialog(txtInTaskPage, 2000)
          sleep(1000)
          finished = _this.collectBeanTask() > 0
          sleep(2000)
          _this.collectBeanFriends()
        }
      },
    ]
    this.pipeLine(lst)
    this.pushLog('结束种豆得豆')
    let count = this.loopCounter.getValue()[key]||0
    notifyOper.appendMsg(`种豆得豆任务数量：${count}\n`)
    this.backTo(HOME_PAGE_MSG)
    if (finished&&task) {      
      this.setSubTaskExecuted(task)
    }
  }
  function getRandomItem(arr) {
    if (arr.length === 0) {
      return null
    }
    const randomIndex = Math.floor(Math.random() * arr.length);
    return arr[randomIndex];
  }
  this.collectBeanFriends = function () {
    /**
     * 收取好友水滴流程：
     * 1. 在页面底部区域查找"去采摘|去收取"按钮并点击
     * 2. 等待2秒让页面加载
     * 3. 查找"今日剩余.*次"获取剩余采摘次数
     * 4. 若次数为0则退出
     * 5. 循环采摘好友（最多5次）：
     *    5.1 尝试点击"被Ta偷过|商家|京东外卖"类好友
     *    5.2 若找不到则获取区域内的所有好友节点并点击第一个
     *    5.3 等待4秒让页面加载
     *    5.4 点击"继续采摘"继续下一个好友
     * 6. 点击"更多"返回按钮返回上级页面
     */
    sleep(1000)
    // 进入守护豆田页后先关闭"开保护罩"弹窗（右上角 ×），否则"去采摘"和"今日剩余"都会被挡住
    // 优先 LLM 定位关闭按钮，失败/未开启回落固定位置连续点
    if (!_this.llmClosePopupFallback('守护豆田保护罩弹窗')) {
      for (let i = 0; i < 3; i++) {
        automator.click(device.width - 70, 180)
        sleep(500)
      }
    }
    let region = [0, device.height*0.7, device.width, device.height*0.2]
    this.addRectangle('好友范围', region)
    if (!this.clickText('去采摘|去收取', FIND_TIMEOUT, region)) {
      this.pushLog('未找到[去采摘|去收取]')
      return
    }
    sleep(2000)
    region = [0, device.height*0.5, device.width, device.height*0.3]
    node = this.findText('今日剩余.*', region, FIND_TIMEOUT)
    if (!node) {
      this.pushLog('未找到关键元素，退出2collectBeanFriends')
      return
    }
    let txt = node.text()
    let match = txt.match(/(\d+)次/)
    if (match && parseInt(match[1]) < 1) {
      this.pushLog('今日剩余采摘次数为0')
      return
    }
    node = node.parent()
    if (!node || node.childCount() < 1) {
      this.pushLog('获取剩余次数父节点失败，退出collectBeanFriends')
      return
    }
    node = node.child(0)
    let inside = [node.bounds().left, node.bounds().top, node.bounds().right, node.bounds().bottom]
    region = [0, inside[1], device.width, inside[3]-inside[1]]
    this.addRectangle('好友范围', region)
    for (let i=0;i<5; ++i) {
      if (!this.clickText('被Ta偷过|商家|京东外卖', FIND_TIMEOUT)) {
        let nodes = []
        let txt = boundsInsideText(inside[0], inside[1], inside[2], inside[3], (lst) => { nodes = lst }, null)
        this.pushLog('好友数量' + (nodes!==null?nodes.length:0) + ` $${txt}`)
        if (!nodes || nodes.length === 0) break
        node = nodes[0]
        if (!node || typeof node.bounds !== 'function') {
          this.pushLog('好友节点不是控件对象，跳过本次采摘')
          break
        }
        this.displayButtonAndClick(node, '好友'+node.text())
      }
      sleep(4000)
      // 采摘好友后常弹出「京豆奖励+3 / 赚京豆」浮层或「开心收下」优惠券，
      // 不关弹窗会导致后续点击与返回被遮挡而卡死，必须先关
      this.closeDialogByImage(null, 1|16)
      this.clickText('继续采摘', FIND_TIMEOUT)
    }
    region = [0, device.height*0.05, device.width, device.height*0.3]
    node = this.findText('更多', region, FIND_TIMEOUT)
    if (node) {
      node = node.parent().child(0)
      this.displayButtonAndClick(node, '返回')
    } else {
      this.pushLog('未找到返回按钮，尝试返回')
      automator.back()
    }
  }
  this.collectBeanTask = function(regx) {
    /**
     * 收取分数气泡流程（种豆得豆/东东农场通用）：
     * 1. 在页面上半部分（0.1H~0.4H）查找分数气泡（+10/+15/+20/+25/+50等）
     * 2. 循环查找并点击（最多10次）：
     *    2.1 在区域中查找所有数字开头的分数节点
     *    2.2 点击每个分数节点领取奖励
     *    2.3 处理弹窗（开心收下等）
     *    2.4 若连续3次没找到分数则退出
     * 3. 返回点击的分数数量
     * 注：如果任务描述包含"50"且不是"明日"，说明是大额奖励
     */
    let region = [0, device.height*0.1, device.width, device.height*0.4]
    this.addRectangle('分数范围', region)
    let appendFilter = (matcher) => {
      return matcher.boundsInside(region[0],region[1],region[0]+region[2],region[1]+region[3])
    }
    let clicked30 = false
    let zeroCount = 0
    let taskCount = 0
    for (let i = 0; i < 10; i++) {
      let nodes = widgetUtils.widgetGetAll(regx||/\+?[1-9]\d*/, 5000, null, appendFilter)
      if (!nodes || nodes.length === 0) {
        zeroCount++
        if (zeroCount >= 3) {
          break
        }
        continue
      }
      let count = 0
      nodes.forEach(node => {
        let txt = this.allText(node.parent())
        this.pushLog(txt)
        if (txt.includes('50')) {
          if (txt.includes('明日')) {
            return
          }
          clicked30 = true
        }
        count++
        taskCount++
        this.displayButtonAndClick(node, '分数')
        // 中奖「开心收下」弹窗按钮约在 0.64H，type&16 只扫 0.70H~0.92H 扫不到；
        // 改 1|16：type&1 区域(0.5H~0.9H)能覆盖到 0.64H 的「开心收下」
        this.closeDialogByImage(null, 1|16)
        sleep(1000)
      })
      if (count === 0) {
        zeroCount++
        if (zeroCount >= 3) {
          break
        }
        continue
      }
      if (regx) break
    }
    return taskCount
  }
  // 完成东东农场任务
  // 具体操作：
  // 打开京东
  // 点击首页
  // 点击东东农场
  // 点击签到，再点击签到
  // 返回到有“再浇”的页面，点击领水滴，从底部会出现一个任务列表（可上下滚动）
  // 扫描任务列表中的任务，判断其是否可完成，点击列表右边的按钮完成任务
  // 异常场景处理：如果一个任务做了3次没有完成，则放到黑名单中
  //   点击完成按钮后可能出现弹窗，要处理弹窗
  // 按返回键直到回到任务列表（需要记住列表界面的特征）
  // 循环完成所有可完成的任务
  // 如果水滴数量大于120则满水，过程中可能会出现弹窗，要处理掉才能浇下一次
  // 返回到京东首页
  this.plantFruit = function () {
    /**
     * 东东农场任务流程：
     * 1. 检查是否已执行过，今日已完成则跳过
     * 2. 调用openHome()打开京东首页（框架级，导航自愈接管）
     * 4. 点击"东东农场"入口进入
     * 5. 等待页面加载，检查"再浇"或"攻略"确认进入成功
     * 6. 处理可能的弹窗
     * 7. 签到：
     *    7.1 查找"签到"按钮并点击
     *    7.2 处理签到确认（点击签到/已连续N天）
     *    7.3 等待签到完成
     * 8. 点击"领水滴"进入任务列表
     * 9. 循环执行可完成的任务：
     *    9.1 查找"去完成|去逛逛|去领取|去签到|去看看|逛一逛|去关注"类任务
     *    9.2 获取任务描述，判断是否在黑名单中（好友助力/开启定时/下单/中国移动/健康抽免单/快手/百度/小组件）
     *    9.3 普通任务：点击执行，等待超时
     *    9.4 任务完成后返回任务列表
     * 10. 任务完成后开始浇水（collect回调）：
     *    10.1 关闭弹窗
     *    10.2 查找"点击水壶浇水"按钮
     *    10.3 循环浇水直到水滴不足（每次浇水后检查弹窗）
     *    10.4 处理"开心收下"等弹窗
     * 11. 返回首页
     */
    let task = fruits
    if (this.isSubTaskExecuted && this.isSubTaskExecuted(task)) {
      this.pushLog('今日已完东东农场')
      return true
    }
    if (!openHome()) {
      _this.pushLog('打开京东失败')
      return
    }
    sleep(this.getTimeout())
    this.pushLog('开始东东农场')
    let txtInTaskPage = '做任务.*?领水滴'
    let 浇水btnText = '.*?点击水壶浇水|浇\\d+次.*'
    that = this
    let key = `fruitTaskCount${this.appIndex}`
    let collect = false
    let 再浇 = [0, device.height*0.4, device.width, device.height*0.4]
    let lst = [
      {
        region: [0,0,device.width, device.height * 0.5],
        text: '东东农场',
        waitFor: ['再浇.*', "攻略"],
        sleep:  (info) => {
          that.closeDialogByImage(null, 1)
          console.log('纠正位置', info.waitFor[0])
          let ele = _this.findText(info.waitFor[0], null, FIND_TIMEOUT)
          if (!ele) {
            info.end = _this.findText('.*?繁忙.*', null, FIND_TIMEOUT)
            console.log('end?', info.end)
            return
          }
          notifyOper.appendMsg(ele.text() + '\n')
          // 再浇[1] = ele.bounds().top - 1
          // 再浇[3] = ele.bounds().height() + 1
          that.addRectangle('再浇', 再浇)
          lst[1].region[1] = ele.bounds().bottom
          lst[3].region[1] = ele.bounds().bottom
          sleep(3000)
        },
      },
      {
        region: [0,device.height*0.55, device.width, device.height * 0.3],
        text: '.*签到(页面)?',
        ocr: true,
        // id: 'expo_sign_icon',
        waitFor: ['签到记录','已签到'],
        notFound: function () {
          let ele = _this.findText('点击开炮', [0,device.height*0.3, device.width, device.height * 0.4], FIND_TIMEOUT, 2)
          if (!ele) {
            return null
          }
          let bounds = ele.bounds()
          bounds.top += 200
          bounds.bottom += 200
          return _this.wrapOcrPointWithBounds(bounds, '假签到')
        },
      },
      {
        region: [0,device.height*0.3, device.width, device.height * 0.4],
        text: '点击签到.*|已连续.*',
        waitFor: ['明天再来', '已签到'],
        backToByActivity: false,
        backTo: {
          '再浇.*': 再浇,
          "领水滴":[0,device.height*0.5,device.width,device.height*0.3],
          and: HOME_PAGE_MSG.and,
        },
        notFound: function () {
          _this.backTo(this.backTo)
        },
      },
      {
        region: [0,device.height*0.55, device.width, device.height * 0.3],
        beforeFind: function () {
          let ele = _this.findText(浇水btnText, this.region, FIND_TIMEOUT, 1, 1)
          if (!ele) {
            _this.pushWarningLog('没有找到水滴数量')
            return true
          }
          let water = ((ele.text()||ele.contentDescription).match(/[0-9]+/g)||['0']).map(Number).pop()
          if (water > 10*20) {
            return true
          }
          _this.pushWarningLog('水滴不足')
          lst[4].blackList.push('浇水')
          return true
        },
        text: '.*领水滴(页面)?',
        // id: 'expo_task_icon',
        ocr: true,
        waitFor: [txtInTaskPage,],
        sleep:  (info) => {
          console.log('纠正位置', info.waitFor[0])
          let ele = widgetUtils.widgetGetOne(info.waitFor[0], FIND_TIMEOUT)
          if (!ele) {
            info.end = widgetUtils.widgetGetOne('.*?繁忙.*', FIND_TIMEOUT)
            return
          }
          lst[4].boundsInside[1] = ele.bounds().bottom - 20
          sleep(3000)
        },
      },
      {
        boundsInside: [0, device.height*0.3, device.width, device.height],
        beforeFind: function () {
          let ele = null
          for (let i=0;i<2;++i) {
            ele = _this.findText(txtInTaskPage, null, FIND_TIMEOUT)
            if (ele) break
          }
          if (!ele) {
            let ret = _this.action(lst[3])
            if (!ret || !ret.node) {
              return false
            }
          }
          let taskTitle = ele
          ele = [device.width/2,device.height*0.8, `农场任务列表${this.endCount}`]
          _this.swipeWidget(ele, -10, -300)
          if (!(this.endCount > 0)) {
            sleep(1000)
          ele = [device.width/2,device.height*0.8-300, `农场任务列表${this.endCount}`]
          _this.swipeWidget(ele, 10, 300)
          }
          if (taskTitle) {
            this.boundsInside[1] = taskTitle.bounds().bottom -50
          }
          _this.addRectangle("任务列表", [this.boundsInside[0], this.boundsInside[1], device.width, device.height-this.boundsInside[1]])
          sleep(1000)
          return true
        },
        text: '.*?(去完成|去逛逛|去领取|去签到|去看看|逛一逛|去关注|去浇水|去领奖|领奖励).*',
        // text: '.*?(点击去|去领取).*',
        backTo: {
          '做任务.*?领水滴': [0, 0, device.width, device.height*0.5],
          '再浇.*': 再浇,
          // '东东农场': [0,0, device.width, device.height*0.5],
          and: HOME_PAGE_MSG.and,
        },
        blackList: ['好友助力', '开启定时','下单', '中国移动', '健康抽免单','快手', '百度', '小组件', '打1局', ],
        maxLoop: 50,
        taskCount: {max:3,},
        desc: '', // 任务描述内容
        end: false,
        timeout: device.model == 'Redmi Note 5' ? 5000 : 3000,
        ocr: true,
        loopFilter:  this.finishTasks,
        sleep:  function(info) {
          _this.loopCounter.updateStorageValue(storeValue => {
            storeValue[key] = storeValue[key]?storeValue[key]+1:1
          })
          _this.pushLog(`sleep ${info.timeout}`)
          sleep(500)
          if ((info.node&&info.node.text().includes('领取'))||info.desc.includes('领取')) {
            sleep(info.timeout)
            return
          }
          if (widgetUtils.widgetGetOne('东东农场', FIND_TIMEOUT)&&!widgetUtils.widgetGetOne(txtInTaskPage, FIND_TIMEOUT)) {
            _this.pushLog('可能出现了弹窗')
            sleep(3000)
            _this.closeDialogByImage(null, 1)
            _this.clickText(lst[3].text, FIND_TIMEOUT, lst[3].region, true)
            return
          }
          sleep(info.timeout)
          _this.退出直播()
        },
        collect: function(info) {
          _this.closeDialogByImage(null, 2)
          _this.closeDialog(txtInTaskPage, 2000)
          sleep(1000)
          collect = true
          let ele = _this.findText(浇水btnText, this.region, FIND_TIMEOUT, 1)
          if (!ele) {
            _this.pushWarningLog('没有找到水滴数量')
            return
          }
          let water = ((ele.text()||ele.contentDescription).match(/[0-9]+/g)||['0']).map(Number).pop()
          for (let i=0;i<30&&water>200; ++i) {
            _this.pushLog(`浇水${water}`)
            ele = _this.clickText(浇水btnText, _this.getTimeout(), this.region) 
            if (!ele) {
              break
            }
            water = ((ele.text()||ele.contentDescription).match(/[0-9]+/g)||['0']).map(Number).pop()
            sleep(1000)
            // 浇水达到 N 次会弹出中奖弹窗（"恭喜中奖啦"/主按钮"买买买"），
            // 其关闭 X 是 WebView 内空文字可点击 TextView（实测 bounds 962,467-1036,539，中心 999,503），
            // findCloseXIcon 只扫 Image/ImageView 会跳过它，文字正则与 YOLO close_icon 也识别不到，
            // 需按右上角坐标强制点击关闭，绝不能点"买买买"（会跳领券/商品页）。
            if (_this.findText('买买买|浇水次数达到', null, FIND_TIMEOUT, 1, 1)) {
              _this.pushLog('命中浇水中奖弹窗，点击右上角X关闭')
              automator.click(Math.round(device.width * 0.925), Math.round(device.height * 0.21))
              sleep(1500)
              // 复检：固定坐标没关掉时，LLM 视觉兜底重新定位
              if (_this.findText('买买买|浇水次数达到', null, FIND_TIMEOUT, 1, 1)) {
                _this.llmClosePopupFallback('浇水中奖弹窗')
              }
            }
            let loopCount = 0
            while (_this.closeDialogByImage('开心收下', 1&2) && loopCount++ < 10) {
              sleep(1000)
            }
          }
        }
      },
    ]
    this.pipeLine(lst)
    this.pushLog('结束东东农场')
    let count = this.loopCounter.getValue()[key]||0
    notifyOper.appendMsg(`东东农场任务数量：${count}\n`)
    this.backTo(HOME_PAGE_MSG)
    if (collect&&task) {
      this.setSubTaskExecuted && this.setSubTaskExecuted(task)
    }
  }
  this.天天领红包 = function() {
    /**
     * 天天领红包任务流程：
     * 1. 检查是否已执行过，今日已完成则跳过
     * 2. 调用openHome()打开京东首页
     * 3. 点击"新品"入口（红包入口在这里）
     * 4. 等待"gif"或"新品试用"确认进入
     * 5. 查找红包入口（匹配"有红包|日领红包|天天领红包|红包加"）
     * 6. 进入后点击"去完成|去领取"执行任务
     * 7. 等待任务完成，处理倒计时（继续浏览N）
     * 8. 点击"领京豆"领取奖励
     * 9. 处理可能的弹窗
     * 10. 返回首页
     */
    if (!openHome()) {
      _this.pushLog('打开京东失败')
      return
    }
    sleep(this.getTimeout())
    this.pushLog('开始天天领红包')
    let txtInTaskPage = '累计领红包'
    that = this
    let key = `redpTaskCount${this.appIndex}`
    let collect = false
    let lst = [
      {
        region: [0,0,device.width, device.height * 0.3],
        text: '新品',
        ocr: true,
        waitFor: ['.*gif', "新品试用"],
        sleep:  (info) => {
          that.closeDialogByImage(null, 1)
          sleep(3000)
        },
        notFound: function ()  {
          return _this.findText(this.text, null, FIND_TIMEOUT)
        }
      },
      {
        region: [device.width*0.3,device.height*0.3,device.width*0.7, device.height * 0.6],
        allText: '.*gif',
        allTextIndex: -1,
        text: '.*有红包.*|.*日领红包.*|天天领红包.*|.*红包加.*',
        ocr: true,
        waitFor: ['累计领红包','红包可抵现'],
        timeout: 3000,
        notFound: function ()  {
          let ele = [device.width/2,device.height*0.8, '任务列表']
          _this.swipeWidget(ele, -10, -300)
          sleep(1000)
          this.notFound = null
          return _this.findWidget(this)
        }
      },
      {
        boundsInside: [0, device.height*0.3, device.width, device.height],
        beforeFind: function (info) {
          let ele = _this.findText('累计领红包', null, FIND_TIMEOUT)
          if (!ele) {
            if (!_this.clickText(lst[1].text, FIND_TIMEOUT, lst[1].region, true)) {
              return false
            }
          }
          ele = [device.width/2,device.height*0.8, `任务列表${this.endCount}`]
          _this.swipeWidget(ele, -10, -300)
          if (!(this.endCount > 0)) {
            ele = [device.width/2,device.height*0.8-300, `任务列表${this.endCount}`]
            _this.swipeWidget(ele, 10, 300)
          }
          ele = _this.findText(txtInTaskPage, null, FIND_TIMEOUT)
          if (ele) {
            this.boundsInside[1] = ele.bounds().bottom
          }
          _this.addRectangle("任务列表", [this.boundsInside[0], this.boundsInside[1], device.width, device.height-this.boundsInside[1]])
          sleep(1000)
          ele = _this.findText('点我寻宝', [device.width-100, device.height*0.5, 80, device.height*0.5], FIND_TIMEOUT)
          if (ele) {
            _this.swipeWidget(ele, 10, 0-(device.height*0.5))
            sleep(1000)
          }
          return true
        },
        text: '去完成|去?领取$',
        backTo: {
          '累计领红包': [0, device.height*0.4, device.width, device.height*0.5],
          '新品': [0,0, device.width, device.height*0.3],
          and: HOME_PAGE_MSG.and,
        },
        backToWait: '继续浏览.*',
        blackList: ['好友助力', '开启定时','下单', '首页', '校园', '视频领', '水果'],
        taskCount: {max:3,},
        desc: '', // 任务描述内容
        end: false,
        timeout: device.model == 'Redmi Note 5' ? 5000 : 3000,
        ocr: true,
        loopFilter:  this.finishTasks,
        sleep:  (info) => {
          _this.loopCounter.updateStorageValue(storeValue => {
            storeValue[key] = storeValue[key]?storeValue[key]+1:1
          })
          _this.pushLog(`sleep ${info.timeout}`)
          sleep(info.timeout)
          倒计时(info, _this)
          _this.clickText('.*?领京豆')
          _this.closeDialogByImage(null, 1|2|8, txtInTaskPage)
          let ele = [device.width/2,device.height*0.8, `任务列表${this.endCount}`]
          _this.swipeWidget(ele, -10, -300)
        },
        collect: (info) => {
          this.closeDialogByImage(null, 2)
          this.closeDialog(txtInTaskPage, 2000)
          sleep(1000)
          collect = true
        }
      },
    ]
    this.pipeLine(lst)
    this.pushLog('结束天天领红包')
    let count = this.loopCounter.getValue()[key] ||0
    notifyOper.appendMsg(`天天领红包任务数量：${count}\n`)
    this.backTo(HOME_PAGE_MSG)
  }
  this.京喜领京豆 = function() {
    /**
     * 京喜领京豆任务流程：
     * 1. 检查重试次数，超过3次则退出
     * 2. 调用openHome()打开京东首页
     * 3. 点击"京喜自营"入口进入
     * 4. 若未找到京喜自营入口，尝试通过"全部频道"进入
     * 5. 查找"领京豆"进入任务页面
     * 6. 循环执行可完成的任务：
     *    6.1 查找"去完成|去领取"类任务
     *    6.2 获取任务描述，判断是否在黑名单中（好友助力/开启定时/看病买/分享）
     *    6.3 普通任务：点击执行，等待超时
     *    6.4 处理可能的弹窗
     *    6.5 任务完成后返回任务列表
     * 7. 返回首页
     */
    if (!openHome()) {
      _this.pushLog('打开京东失败')
      return
    }
    sleep(this.getTimeout())
    this.pushLog('开始京喜领京豆')
    let txtInTaskPage = '做任务领京豆'
    that = this
    let key = `jingxiTaskCount${this.appIndex}`
    let collect = false
    let 全部频道 = {
      region: [0,device.height * 0.1,device.width, device.height * 0.4],
      text: '全部频道',
      waitFor: ['京喜自营', "互动游戏"],
      sleep:  (info) => {
        that.closeDialogByImage(null, 1|2|8)
        sleep(3000)
      },
    }
    let lst = [
      {
        region: [0,device.height * 0.1,device.width, device.height * 0.5],
        text: '京喜自营',
        ocr: true,
        waitFor: ['京喜自营','好券'],
        timeout: 10000,
        notFound: function () {
          let ele = that.findText('种豆得豆|秒杀', null, that.getTimeout())
          if (!ele) {
            that.pushWarningLog('没找到种豆得豆')
            this.end = true
            return
          }
          let point = [device.width-200, ele.bounds().centerY()]
          that.swipeWidget(point, 0-point[0]+100, 10)
          sleep(1000)
          that.action(全部频道)
          this.notFound = null
          this.end = true
          return that.findWidget(this)
        },
      },
      {
        region: [0,device.height * 0.0,device.width, device.height * 0.4],
        text: '(领\\d*)?京豆',
        ocr: true,
        timeout: 3000,
        waitFor: [txtInTaskPage,'去完成'],
        notFound: function () {
          this.end = true
          return null
        },
        beforeFind: function (info) {
          for (let i=0;i<3;++i) {
            if (!that.closeDialogByImage(null, 1|2|8, info.text)) break
            sleep(3000)
          }
          return that.findText(this.text, this.region, 5000, 1, 1)
        },
        sleep:  function(info) {
          _this.pushLog(`1 sleep ${info.timeout}`)
          sleep(info.timeout)
          for (let i=0;i<3&&_this.findText(txtInTaskPage, null, FIND_TIMEOUT, 1, 2)!==null;++i) {
            if (!that.closeDialogByImage(null, 1|2|8, txtInTaskPage)) break
            sleep(3000)
          }
          let ele = that.findText('订阅提醒', null, FIND_TIMEOUT)
          if (ele) {
            let x = device.width/2
            let y = ele.bounds().bottom + 50
            that.closeDialog('订阅提醒', FIND_TIMEOUT, x,y)
          }
          !that.findText(txtInTaskPage, null, FIND_TIMEOUT, 1) && that.clickText(info.text, FIND_TIMEOUT, info.region, true, 1, 2)
        },
      },
      {
        boundsInside: [0, device.height*0.3, device.width, device.height],
        beforeFind: function () {
          if (!_this.findText('做任务领京豆', null, FIND_TIMEOUT)) {
            let ret = !_this.action(lst[1])
            if (!ret || !ret.node) {
              return false
            }
          }
          let ele = [device.width/2,device.height*0.8, `自营任务列表${this.endCount}`]
          that.swipeWidget(ele, -10, -300)
          if (!(this.endCount > 0)) {
            sleep(1000)
          ele = [device.width/2,device.height*0.8-300, `自营任务列表${this.endCount}`]
          that.swipeWidget(ele, 10, 300)
          }
          if (this.endCount === undefined) {
            ele = that.findText(txtInTaskPage, null, FIND_TIMEOUT)
            if (ele) {
              this.boundsInside[1] = ele.bounds().bottom
            }
          }
          that.addRectangle("任务列表", [this.boundsInside[0], this.boundsInside[1], device.width, device.height-this.boundsInside[1]])
          sleep(1000)
          return true
        },
        text: '(去完成|去?领取)$',
        backTo: {
          '做任务领京豆': [0, device.height*0.3, device.width, device.height*0.5],
          '已领取': [0,0, device.width, device.height*0.5],
          and: HOME_PAGE_MSG.and,
        },
        backToWait: '继续浏览.*',
        backToByActivity: false,
        blackList: ['好友助力', '开启定时', '分享', ],
        taskCount: {max:3,},
        desc: '', // 任务描述内容
        end: false,
        timeout: device.model == 'Redmi Note 5' ? 5000 : 3000,
        ocr: true,
        loopFilter:  this.finishTasks,
        sleep:  function(info) {
          _this.pushLog(`2 sleep ${info.timeout}`)
          sleep(info.timeout)
          _this.loopCounter.updateStorageValue(storeValue => {
            storeValue[key] = storeValue[key]?storeValue[key]+1:1
          })
          _this.closeDialogByImage(null, 1|8, `${txtInTaskPage}|权益中心`)
          _this.退出直播()
        },
        collect: (info) => {
          that.closeDialogByImage(null, 2|8, txtInTaskPage)
          that.closeDialog(txtInTaskPage, 2000)
          sleep(1000)
          collect = true
        }
      },
    ]
    this.pipeLine(lst)
    this.pushLog('结束京喜领京豆')
    let count = this.loopCounter.getValue()[key]||0
    notifyOper.appendMsg(`京喜领京豆任务数量：${count}\n`)
    this.backTo(HOME_PAGE_MSG)
  }
  function 倒计时(info, that) {
    let loop = 0
    while (info.loopFilter&&loop++<30 && that.findText('继续浏览\\d+', null, 1000)) {
      sleep(1000)
    }
  }
  function inBlacks(txt, blackList, repeatList) {
    if (!blackList) return false
    let ret = blackList.some(black => txt.match(black))
    if (ret) {
      let all = blackList.join('%')
      _this.pushLog(`${txt} 在黑名单中 ${all}`)
    } else if (repeatList) {
      ret = repeatList.some(item => txt === item)
      if (ret) {
        _this.pushLog(`${txt} 重复 ${ret}`)
      }
    }
    return ret
  }
  this.finishTasks = function (lst, info) {
    if (info.endCount === undefined) {
      info.endCount = 0
    } else {
      info.endCount++
    }
    info.end = info.endCount >= 3
    lst.sort((a, b) => a.bounds().top - b.bounds().top)
    let i = 0
    for (let ele of lst) {
      i++
      if (!automator.checkCenterClickable(ele)) continue
      let txt = ele.text() || ele.desc() || ''
      info.node = ele
      _this.displayButton(ele, txt)
      if (!txt.includes('领取')) {
        txt = getTaskInfo(ele, null, null, _this) || '' // 获取任务信息
        info.desc = txt
        let block = inBlacks(txt, info.blackList) // 是否黑名单
        logUtils.debugInfo(['{} 任务:{}', block, txt])
        if (block) {
          continue
        }
        // 任务次数超限？
        info.taskCount[txt] = info.taskCount[txt] ? info.taskCount[txt] + 1 : 1
        if (info.taskCount[txt] > info.taskCount.max) {
          info.blackList.push(txt)
          continue
        }
        _this.pushLog(txt)
        // 匹配任务时间
        let match = txt.match(/(\d+)(s|秒)/)
        info.timeout = info.timeout||3000
        if (match) {
          let addon = device.model == 'Redmi Note 5' ? 6 : 2
          info.timeout = (parseInt(match[1])+addon) * 1000
        }
      } else {
        _this.pushLog(txt)
      }
      info.end = false
      info.endCount = 0
      // 执行任务
      if (!_this.specialTask(txt, info, ele)) {
        _this.action(info)
      }

      if (info.end) return
      break
    }
    if (i === lst.length && info.endCount !== 0) {  
      let point = [device.width*0.5, device.height-150, 'finishTasks']
      _this.swipeWidget(point, 10, -400)
    }
    if (info.end && info.collect) {
      _this.pushLog('开始收集')
      info.collect(info)
    }
  }
  this.specialTask = function (taskText, info, node) {
    let finished = false
    if (taskText.includes('京豆xxx')) {
      this.displayButton(node, taskText)
      this.pushLog(taskText.split('|')[0])
      this.action(info)
      finished = true
    }
    logUtils.debugInfo(['specialTask {}', finished])
    return finished
  }
  this.退出直播 = function () {
    let ele = this.findText('直播', [1,1, device.width-1, device.height*0.3], FIND_TIMEOUT, null, 1)
    if (!ele) {
      return
    }
    let x = 60
    let y = ele.bounds().centerY()
    this.displayButtonPoint({x,y}, '退出直播', null, true)
  }
}
BeanCollector.prototype = Object.create(BaseSignRunner.prototype)
BeanCollector.prototype.constructor = BeanCollector

module.exports = new BeanCollector()
