/**
 * LlmVisionHelper —— 多模态大模型视觉兜底（基于 Ollama 云端 API + gemma4:31b）
 *
 * 用途：JD 自动化里「确定性方法（控件树/OCR/YOLO/固定坐标）全部失败后」的最后一层视觉兜底，
 *       当前开放能力：定位弹窗关闭按钮。后续可扩展弹窗语义判断、WebView 任务描述识别等。
 *
 * 设计约定：
 *   1. 默认关闭（llm_enabled=false），开启方式：在脚本根目录放 llm_config.json 覆盖配置；
 *   2. 坐标一律由模型返回 0~1 归一化值，此处乘以屏幕尺寸转为设备像素，并做合法性校验；
 *   3. 单次运行有调用次数硬上限（llm_max_calls_per_run），防止失控烧钱/卡死；
 *   4. 网络闪断（实测 ollama.com 偶发 SSL 错误）自动重试；4xx（key/模型问题）不重试直接失败；
 *   5. 模型即使设了 format:'json' 仍可能返回 ```json 围栏，解析时必须剥离；
 *   6. 任何失败都返回 null，由调用方回落原有逻辑——LLM 只是兜底，不是主路径。
 *
 * 配置（llm_config.json，放在 files.cwd() 或 files.cwd()/lib 下）：
 *   {
 *     "llm_enabled": true,
 *     "llm_url": "https://ollama.com/api/chat",
 *     "llm_api_key": "留空则读脚本根目录 llm_key.txt（含密钥，不入库）",
 *     "llm_model": "gemma4:31b",
 *     "llm_timeout_ms": 30000,
 *     "llm_max_calls_per_run": 30,
 *     "llm_max_image_width": 720,
 *     "llm_jpeg_quality": 50
 *   }
 */

try {
  importPackage(Packages['okhttp3'])
} catch (e) {
  //
}
try {
  importClass('okhttp3.OkHttpClient')
  importClass('okhttp3.MediaType')
  importClass('okhttp3.RequestBody')
  importClass('okhttp3.Request')
} catch (e) {
  //
}

const DEFAULT_CONFIG = {
  // 总开关：默认关闭，所有调用方都应先过 isEnabled()
  llm_enabled: false,
  llm_url: 'https://ollama.com/api/chat',
  // ollama 云端 key：优先取 llm_config.json 的 llm_api_key；为空时回退读脚本根目录 llm_key.txt（不入库）
  llm_api_key: '',
  llm_model: 'gemma4:31b',
  llm_timeout_ms: 30000,
  // 单次运行（本模块被 require 起一次）的调用硬上限
  llm_max_calls_per_run: 30,
  // 截图降缩放：宽 720（1220x2712 设备实测 base64 约 50KB，往返约 2.2s）
  llm_max_image_width: 720,
  llm_jpeg_quality: 50,
}

const CLOSE_BUTTON_PROMPT = '这是手机APP（京东）的截图。请找出当前页面中弹窗/浮层的关闭按钮（通常是X形状图标、或写着"关闭/取消"的按钮，一般位于弹窗的右上角或顶部）。' +
  '如果没有弹窗或找不到关闭按钮，has_popup 或 close_button 给 false/null。' +
  '严格按如下JSON格式回答，不要输出多余内容：' +
  '{"has_popup": true或false, "close_button": {"x": 0到1之间的归一化横坐标, "y": 0到1之间的归一化纵坐标} 或 null, "description": "弹窗和关闭按钮的简要描述"}'

function LlmVisionHelper () {
  this.config = Object.assign({}, DEFAULT_CONFIG)
  this._callCount = 0
  this._client = null
  this._loadConfig()
}

LlmVisionHelper.prototype._loadConfig = function () {
  let paths = []
  try {
    paths.push(files.join(files.cwd(), 'llm_config.json'))
    paths.push(files.join(files.cwd(), 'lib', 'llm_config.json'))
  } catch (e) {
    //
  }
  for (let p of paths) {
    try {
      if (files.exists(p)) {
        let override = JSON.parse(files.read(p))
        Object.assign(this.config, override)
        console.log('[LlmVision] 已加载配置: ' + p)
        break
      }
    } catch (e) {
      console.log('[LlmVision] 配置读取失败: ' + p + ' ' + e)
    }
  }
  // key 不在配置里时，回退读脚本根目录 llm_key.txt（该文件含密钥，不纳入 git）
  if (!this.config.llm_api_key) {
    try {
      let keyPath = files.join(files.cwd(), 'llm_key.txt')
      if (files.exists(keyPath)) {
        this.config.llm_api_key = files.read(keyPath).trim()
        console.log('[LlmVision] 已从 llm_key.txt 加载 key')
      } else {
        console.log('[LlmVision] 未配置 llm_api_key 且 llm_key.txt 不存在，LLM 调用将失败')
      }
    } catch (e) {
      console.log('[LlmVision] 读取 llm_key.txt 失败: ' + e)
    }
  }
}

LlmVisionHelper.prototype.isEnabled = function () {
  return !!this.config.llm_enabled
}

/**
 * 应用外部配置（可视化配置 config.js/storages 注入），优先级高于 llm_config.json / llm_key.txt
 * 仅覆盖传入且非空的字段；llm_api_key 为空时跳过，保留 llm_key.txt 兜底
 * @param external 形如 { llm_enabled, llm_url, llm_api_key, llm_model, llm_timeout_ms, llm_max_calls_per_run }
 */
LlmVisionHelper.prototype.applyExternalConfig = function (external) {
  if (!external) {
    return
  }
  let applied = []
  Object.keys(external).forEach(key => {
    let v = external[key]
    if (v === undefined || v === null || v === '') {
      return
    }
    this.config[key] = v
    applied.push(key)
  })
  if (applied.length > 0) {
    console.log('[LlmVision] 已应用可视化配置: ' + applied.join(',') + ' enabled=' + this.config.llm_enabled)
  }
}

LlmVisionHelper.prototype.getCallCount = function () {
  return this._callCount
}

LlmVisionHelper.prototype.resetBudget = function () {
  this._callCount = 0
}

LlmVisionHelper.prototype.getClient = function () {
  if (!this._client) {
    this._client = new OkHttpClient().newBuilder()
      .callTimeout(this.config.llm_timeout_ms, java.util.concurrent.TimeUnit.MILLISECONDS)
      .build()
  }
  return this._client
}

/**
 * 截图并压缩为 base64（供 messages.images 使用）
 * @param region 可选 [left, top, right, bottom] 设备像素裁剪区域
 * @returns {{b64: string, screenWidth: number, screenHeight: number}} 或 null
 */
LlmVisionHelper.prototype.captureForLlm = function (region) {
  let img = null
  let clipped = null
  let small = null
  try {
    img = captureScreen()
    if (!img) {
      // 截图权限未授予时（如独立/intent 启动的流程），懒申请一次；
      // 真实签到流程中 mainJD 已提前授权，此处不会触发（同进程内再次申请直接返回 true）
      console.log('[LlmVision] 截图为空，尝试懒申请截图权限')
      try {
        requestScreenCapture(false)
        img = captureScreen()
      } catch (e2) {
        console.log('[LlmVision] 懒申请截图权限异常: ' + e2)
      }
    }
    if (!img) {
      console.log('[LlmVision] 截图失败（无权限或截图为空）')
      return null
    }
    let W = img.getWidth()
    let H = img.getHeight()
    if (region && region.length === 4) {
      let l = Math.max(0, Math.min(region[0], W - 1))
      let t = Math.max(0, Math.min(region[1], H - 1))
      let r = Math.max(l + 1, Math.min(region[2], W))
      let b = Math.max(t + 1, Math.min(region[3], H))
      clipped = images.clip(img, l, t, r - l, b - t)
    }
    let src = clipped || img
    // images.scale 的参数是缩放倍数（非目标尺寸）
    let ratio = Math.min(1, this.config.llm_max_image_width / src.getWidth())
    small = ratio < 1 ? images.scale(src, ratio, ratio) : src
    let b64
    try {
      b64 = images.toBase64(small, 'jpg', this.config.llm_jpeg_quality)
    } catch (e) {
      b64 = images.toBase64(small, 'jpg')
    }
    return { b64: b64, screenWidth: W, screenHeight: H }
  } catch (e) {
    console.log('[LlmVision] 截图压缩异常: ' + e)
    return null
  } finally {
    if (small && small !== img) { try { small.recycle() } catch (e) {} }
    if (clipped) { try { clipped.recycle() } catch (e) {} }
    if (img) { try { img.recycle() } catch (e) {} }
  }
}

/**
 * 剥离模型输出中的 ```json 围栏并提取 JSON 对象
 */
LlmVisionHelper.prototype.parseJsonContent = function (content) {
  if (!content) return null
  let txt = String(content).trim()
  txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let start = txt.indexOf('{')
  let end = txt.lastIndexOf('}')
  if (start < 0 || end <= start) {
    console.log('[LlmVision] 响应中未找到 JSON: ' + txt.substring(0, 200))
    return null
  }
  try {
    return JSON.parse(txt.substring(start, end + 1))
  } catch (e) {
    console.log('[LlmVision] JSON 解析失败: ' + txt.substring(0, 200))
    return null
  }
}

/**
 * 通用多模态问答
 * @param prompt 提示词
 * @param opts {img: base64(可选，不传则自动截图), region: 裁剪区域, temperature, retries}
 * @returns 解析后的 JSON 对象，失败返回 null
 */
LlmVisionHelper.prototype.askVision = function (prompt, opts) {
  opts = opts || {}
  if (!this.isEnabled()) {
    return null
  }
  if (this._callCount >= this.config.llm_max_calls_per_run) {
    console.log('[LlmVision] 已达单次运行调用上限(' + this.config.llm_max_calls_per_run + ')，跳过本次调用')
    return null
  }
  let capture = null
  let b64 = opts.img
  if (!b64) {
    capture = this.captureForLlm(opts.region)
    b64 = capture && capture.b64
  }
  if (!b64) {
    return null
  }
  let requestData = {
    model: this.config.llm_model,
    messages: [{ role: 'user', content: prompt, images: [b64] }],
    stream: false,
    format: 'json',
    options: { temperature: opts.temperature || 0.1 },
  }
  let body = RequestBody.create(MediaType.parse('application/json'), JSON.stringify(requestData))
  let request = new Request.Builder()
    .url(this.config.llm_url)
    .method('POST', body)
    .addHeader('Authorization', 'Bearer ' + this.config.llm_api_key)
    .addHeader('Content-Type', 'application/json')
    .build()
  let retries = opts.retries === undefined ? 2 : opts.retries
  let start = new Date().getTime()
  while (retries-- >= 0) {
    this._callCount++
    try {
      let response = this.getClient().newCall(request).execute()
      let respBody = response.body().string()
      if (!response.isSuccessful()) {
        console.log('[LlmVision] 请求失败 code=' + response.code() + ' body=' + respBody.substring(0, 200))
        // 4xx（key 失效/模型不存在/参数错误）重试无意义，直接失败；408/429/5xx 可重试
        if (response.code() >= 400 && response.code() < 500 && response.code() !== 408 && response.code() !== 429) {
          return null
        }
        continue
      }
      let obj = JSON.parse(respBody)
      let content = obj.message && obj.message.content
      let parsed = this.parseJsonContent(content)
      console.log('[LlmVision] 调用成功 耗时=' + (new Date().getTime() - start) + 'ms 累计调用=' + this._callCount)
      return parsed
    } catch (e) {
      console.log('[LlmVision] 请求异常(剩余重试' + retries + '): ' + e)
    }
  }
  return null
}

/**
 * 定位弹窗关闭按钮（LLM 兜底能力一）
 * @param opts {region, retries}
 * @returns {{x: number, y: number, hasPopup: boolean, description: string}} 设备像素坐标；
 *          hasPopup=false 表示模型判断当前没有弹窗；null 表示调用失败（网络/解析/预算）
 */
LlmVisionHelper.prototype.findCloseButton = function (opts) {
  opts = opts || {}
  if (!this.isEnabled()) {
    return null
  }
  let capture = this.captureForLlm(opts.region)
  if (!capture) {
    return null
  }
  let result = this.askVision(CLOSE_BUTTON_PROMPT, { img: capture.b64, retries: opts.retries })
  if (!result) {
    return null
  }
  if (result.has_popup === false || !result.close_button) {
    return { hasPopup: false, description: result.description || '' }
  }
  let cb = result.close_button
  let W = capture.screenWidth || device.width
  let H = capture.screenHeight || device.height
  let x = Math.round(Number(cb.x) * W)
  let y = Math.round(Number(cb.y) * H)
  if (!isFinite(x) || !isFinite(y) || x < 0 || x > W || y < 0 || y > H) {
    console.log('[LlmVision] 坐标非法: ' + JSON.stringify(cb))
    return null
  }
  return { x: x, y: y, hasPopup: true, description: result.description || '' }
}

module.exports = new LlmVisionHelper()
