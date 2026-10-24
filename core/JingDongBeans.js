
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

let BaseSignRunner = require('./BaseSignRunner2.js')
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
  const SIGN = this.subTasks.filter(task => task.taskCode == 'beanSign')[0]
  const BEAN = this.subTasks.filter(task => task.taskCode == 'plantBean')[0]
  const DOUBLE_SIGN = this.subTasks.filter(task => task.taskCode == 'doubleSign')[0]
  const DRUG_SIGN = this.subTasks.filter(task => task.taskCode == 'drugSign')[0]
  const LUCKY_SIGN = this.subTasks.filter(task => task.taskCode == 'luckySign')[0]
  const GAME_CENTER = this.subTasks.filter(task => task.taskCode == 'gameCenter')[0]
  const DAILY_TASK = this.subTasks.filter(task => task.taskCode == 'dailyTask')[0]

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
}
BeanCollector.prototype = Object.create(BaseSignRunner.prototype)
BeanCollector.prototype.constructor = BeanCollector

module.exports = new BeanCollector()
