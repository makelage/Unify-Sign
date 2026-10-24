
module.exports = {
  // 配置自定义的签到任务定义信息
  supported_signs: [
    {
      name: '移动云盘签到',
      taskCode: 'ChinamobilePan',
      script: 'ChinamobilePan.js',
      enabled: true,
      subTasks: [
        {
          taskCode: 'ChinamobilePan',  // 定义子任务编号
          taskName: '移动云盘签到',     // 子任务名称
          enabled: true,           // 是否启用子任务
        },
        {
          taskCode: 'aliPan', 
          taskName: '阿里云盘签到',
          enabled: true,
        },
      ]
    },
    {
      name: '京东签到2',
      taskCode: 'JingDongSign2',
      script: 'JingDongBeans2.js',
      enabled: true,
      subTasks: [
        {
          taskCode: 'binSign',  // 定义子任务编号
          taskName: '京豆签到1',     // 子任务名称
          enabled: true,           // 是否启用子任务
        },
        {
          taskCode: 'binTask',
          taskName: '京豆任务2',
          enabled: true,
        },
        {
          taskCode: 'plantBean',
          taskName: '种豆得豆3',
          enabled: true,
        },
        {
          taskCode: 'fruits',
          taskName: '种水果',
          enabled: true,
        },
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
    },
    {
      name: '京东账号1',
      taskCode: 'jingdong_account0',
      script: 'JingDongBeans2.js',
      package: 'com.jingdong.app.mall',
      number: 1,
      enabled: true,
      subTasks: [
      ]
    },
    {
      name: '京东账号2',
      taskCode: 'jingdong_account1',
      script: 'JingDongBeans2.js',
      package: 'com.jingdong.app.mall',
      number: 2,
      enabled: true,
      subTasks: [
      ]
    },
  ]
}
