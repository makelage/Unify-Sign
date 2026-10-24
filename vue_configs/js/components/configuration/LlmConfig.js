/**
 * 大模型视觉兜底配置（LLM / Ollama 云端）
 * 部署位置：vue_configs/js/components/configuration/LlmConfig.js
 * 路由：/advance/llm
 */
const LlmConfig = {
  mixins: [mixin_common],
  name: 'LlmConfig',
  data() {
    return {
      modelOptions: [
        { text: 'gemma4:31b', value: 'gemma4:31b' },
        { text: 'gemma3:27b', value: 'gemma3:27b' },
        { text: 'qwen2.5vl:32b', value: 'qwen2.5vl:32b' },
      ],
      configs: {
        // 多模态 LLM 视觉兜底总开关
        llm_enabled: true,
        // ollama 云端 API 地址
        llm_url: 'https://ollama.com/api/chat',
        // ollama 云端 key（留空则回退读脚本根目录 llm_key.txt）
        llm_api_key: '',
        // 模型名称
        llm_model: 'gemma4:31b',
        // 单次请求超时（毫秒）
        llm_timeout_ms: 30000,
        // 单次运行调用次数硬上限（防止失控烧钱）
        llm_max_calls_per_run: 30,
      },
      // Key 输入框明文/密文切换
      keyVisible: false
    }
  },
  methods: {

  },
  template: `
  <div>
    <tip-block>多模态大模型视觉兜底：当控件树、OCR、YOLO 等确定性方法全部失败后，由大模型识别弹窗关闭按钮位置。LLM 只是兜底，不是主路径；关闭后不影响其他功能。</tip-block>
    <tip-block>当前使用 Ollama 云端服务，key 在 ollama.com 官网申请。此处配置保存在本机（Auto.js  storages），不会上传。</tip-block>
    <tip-block>注意：本页面无「保存」按钮，修改后点左上角返回箭头离开本页即自动保存。</tip-block>
    <switch-cell title="启用大模型兜底" v-model="configs.llm_enabled" />
    <template v-if="configs.llm_enabled">
      <van-field v-model="configs.llm_url" label="API 地址" type="text" placeholder="https://ollama.com/api/chat" input-align="right" />
      <van-field v-model="configs.llm_api_key" label="Ollama Key" :type="keyVisible ? 'text' : 'password'" placeholder="留空则读 llm_key.txt" input-align="right">
        <template #right-icon>
          <span style="color:#1989fa;font-size:13px;white-space:nowrap" @click="keyVisible = !keyVisible">{{ keyVisible ? '隐藏' : '显示' }}</span>
        </template>
      </van-field>
      <van-cell title="模型">
        <template #right-icon>
          <van-dropdown-menu active-color="#1989fa" class="cell-dropdown">
            <van-dropdown-item v-model="configs.llm_model" :options="modelOptions" />
          </van-dropdown-menu>
        </template>
      </van-cell>
      <number-field v-model="configs.llm_timeout_ms" label="请求超时" placeholder="毫秒">
        <template #right-icon><span>毫秒</span></template>
      </number-field>
      <number-field v-model="configs.llm_max_calls_per_run" label="单次运行调用上限" placeholder="次">
        <template #right-icon><span>次</span></template>
      </number-field>
      <tip-block>单次运行（每轮签到）最多调用上述次数，防止网络异常时失控计费。</tip-block>
    </template>
  </div>
  `
}
