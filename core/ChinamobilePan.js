/**
 * 云盘签到
 *
 * 2026-10-10 优化（依据真机 widget dump 校准）：
 *   - 设备分辨率 1220x2712，移动云盘 APP 版本 13.2.4。
 *   - 旧逻辑通过 title_right_opt_2 / 「我的工具」父节点进入签到页，但新版本「我的工具」
 *     仅在首页下拉二楼 drawer 中，且其 notFound 兜底会点到无意义的末子节点，导致无法进入签到页。
 *   - 新版本首页右上角存在专用签到图标 actionbar_sign，点击直接进入「云朵中心」H5 活动页。
 *     依据云朵中心活动规则：进入活动页面即完成每日签到（奖励 +3 云朵），无需再点「签到」按钮。
 *   - 「发现新版本」升级弹窗的关闭按钮 bn_cancel 无文字，仅靠文本正则点不掉，改为按 ID 点击。
 */
let { config } = require('../config.js')(runtime, global)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, this)
let FloatyInstance = singletonRequire('FloatyUtil')
let widgetUtils = singletonRequire('WidgetUtils')
let automator = singletonRequire('Automator')
let commonFunctions = singletonRequire('CommonFunction')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let logUtils = singletonRequire('LogUtils')
let BaseSignRunner = require('./BaseSignRunner2.js')

// 移动云盘包名 / 云朵中心相关资源ID（依据真机 widget dump 校准）
const YD_PACKAGE = 'com.chinamobile.mcloud'
const YD_SIGN_ICON_ID = 'com.chinamobile.mcloud:id/actionbar_sign'   // 首页右上角签到图标，点击进入「云朵中心」
const YD_UPGRADE_CANCEL_ID = 'com.chinamobile.mcloud:id/bn_cancel'   // 「发现新版本」弹窗关闭按钮
const YD_HOME_SEARCH_HINT = '搜索全盘文件'                            // 首页稳定存在的搜索框提示，用于确认首页已加载

function isPositionValid(x, y) {
  if (x < 0 || y < 0 || x >= config.device_width || y >= config.device_height) {
    return false
  }
  return true
}

function SignRunner () {
  BaseSignRunner.call(this)
  this.panConfig = config.yd_pan_config
  this.task = config.supported_signs.filter(task => {
    console.log(task.taskCode)
    return ['ChinamobilePan', 'Chinamobile'].includes(task.taskCode)
  })[0]
  console.log('subTasks=',this.task)
  this.subTasks = this.task ? this.task.subTasks : []
  const ChinamobilePan = this.subTasks.find(task => task.taskCode == 'ChinamobilePan')
  const aliPan = this.subTasks.find(task => task.taskCode == 'aliPan')
  const _this = this

  /**
   * 关闭「发现新版本」升级弹窗。
   * 该弹窗的取消按钮（bn_cancel）没有文字，仅用文本正则去匹配「新版本」只能命中标题
   * 「发现新版本」这种无点击意义的 TextView，无法真正关闭弹窗；这里直接按资源 ID 点击关闭按钮。
   */
  this._skipUpgradeDialog = function () {
    let cancel = widgetUtils.widgetGetById(YD_UPGRADE_CANCEL_ID, 2000)
    if (cancel) {
      logUtils.debugInfo(['关闭「发现新版本」升级弹窗'])
      automator.clickCenter(cancel)
      sleep(800)
    }
  }

  this.yidongYunPan = function() {
    if (ChinamobilePan && this.isSubTaskExecuted(ChinamobilePan)) {
      return
    }
    launch(YD_PACKAGE)
    // 1) 先尝试跳过开屏/权限/版本更新等弹窗（版本更新弹窗靠文本匹配点不掉，下面专用方法处理）
    this.awaitAndSkip(['\\s*允许\\s*', '\\s*取消\\s*', /.*新版本.*/, '\\s*稍后\\s*', '\\s*跳过\\s*', '以后再说'])
    this._skipUpgradeDialog()
    // 2) 等待首页真正加载（搜索框提示稳定存在）
    widgetUtils.widgetWaiting(YD_HOME_SEARCH_HINT, 10000)
    // 首页加载后版本更新弹窗可能才弹出，再兜底关一次
    this._skipUpgradeDialog()
    // 3) 点击右上角签到图标进入云朵中心（进入即完成每日签到，活动规则：进入页面 +3 云朵）
    let lst = [
      {
        id: YD_SIGN_ICON_ID,
        timeout: 6000,
        waitFor: ['做任务', '本月已签到', '周一'],
        notFound: function() {
          // 兜底：首页云朵任务区的「签到得AI豆」卡片（位于首页下方，可能需滚动才可见）
          return widgetUtils.widgetGetOne('签到得AI豆')
        }
      }
    ]
    this.pipeLine(lst)
    if (lst[0].find) {
      // 进入云朵中心即视为完成当日签到；尽力领取页面顶部气泡奖励（任务完成后的领取入口）
      this._claimCloudCenterBubble()
      ChinamobilePan && this.setSubTaskExecuted(ChinamobilePan)
    }
    logUtils.debugInfo(['移动云盘结束'])
    automator.back()
    automator.back()
    sleep(3000)
    !config._debugging && commonFunctions.minimize(YD_PACKAGE)
  }

  /**
   * 进入云朵中心后，尝试领取页面顶部气泡奖励。
   * 活动规则：任务完成后需点击活动页面顶部气泡获得奖励。这里仅做尽力而为的轻量领取，
   * 找不到或领取失败不影响签到完成状态（签到在进入云朵中心时即已完成）。
   */
  this._claimCloudCenterBubble = function () {
    let node = widgetUtils.widgetGetOne('领取', 1500)
    if (node) {
      logUtils.debugInfo(['领取云朵中心顶部气泡奖励'])
      automator.clickCenter(node)
      sleep(1200)
    }
  }

  this.aliPan = function() {
    if (aliPan && this.isSubTaskExecuted(aliPan)) {
      return
    }
    let _package_name = 'com.alicloud.databox'
    launch(_package_name)
    sleep(1000)
    this.awaitAndSkip(['\\s*允许\\s*', '\\s*取消\\s*', '\\s*稍后\\s*', '以后再说'])
    let lst = [
      {
        text: '^我的$',
        region: [0,config.device_height * 0.8,config.device_width, config.device_height-1],
        waitFor: ['^福利社$',]
      },
      {
        text: '^福利社$',
        region: [0,config.device_height*0.5, config.device_width, config.device_height*0.3],
        waitFor: ['.*?福利码.*',]
      },
      {
        text: '^每日签到.*',
        region: [0,0,config.device_width, config.device_height*0.5],
        waitFor: ['我的奖励',]
      },
      {
        text: '^领取$',
        region: [0,config.device_height*0.2,config.device_width, config.device_height*0.7],
        point: this.panConfig?this.panConfig.lingQu:{},
        timeout: 2000,
      },
    ]
    this.pipeLine(lst)
    for (let info of lst.reverse()) {
      if (info.find) {
        automator.back()
        sleep(1000)
      }
    }
    if (lst[lst.length-1].find) {      
      aliPan && this.setSubTaskExecuted(aliPan)
    }
    sleep(3000)
    !config._debugging && commonFunctions.minimize(_package_name)
  }

  this.exec = function () {
    this.yidongYunPan()
    this.aliPan()
    this.setExecuted()
  }
}

SignRunner.prototype = Object.create(BaseSignRunner.prototype)
SignRunner.prototype.constructor = SignRunner
module.exports = new SignRunner()
